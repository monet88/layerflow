// Replicate provider: implements the Provider interface via prediction create + poll pattern.
//
// API notes (verified 2026-05-20):
// - Auth: `Authorization: Bearer {api_token}` (not "Key" like fal.ai).
// - Official models endpoint: POST /v1/models/{owner}/{name}/predictions (no version hash needed).
// - File inputs: data URIs allowed only for payloads < 256KB. Larger inputs (source/mask images
//   used by inpainting) must be uploaded via POST /v1/files first; the resulting URL is then
//   embedded in the prediction input. Session 7 confirmed: throw immediately on upload failure
//   rather than fall back to base64, since Replicate will reject anything > 256KB anyway.
// - Poll statuses: starting | processing | succeeded | failed | canceled.
// - Cancel: POST /v1/predictions/{id}/cancel — best-effort fired when AbortSignal triggers.

import {
  CancelledError,
  GenerateOptions,
  InpaintOptions,
  Provider,
  ProviderError,
  ProviderId,
  ResultItem,
} from './provider-interface';
import { REPLICATE_MODELS } from './model-registry';
import { bytesToDataUri, invertMaskConvention } from '../services/image-processing';
import { checkedRequest, request } from '../services/network-client';

const REPLICATE_API = 'https://api.replicate.com/v1';
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_TIME_MS = 120_000;
const PREDICTION_CREATE_TIMEOUT_MS = 180_000;
const DATA_URI_MAX_BYTES = 256 * 1024;

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string; cancel?: string };
}

interface ReplicateFileResponse {
  id?: string;
  urls?: { get?: string };
  // Older response shape exposes a top-level `url`. Tolerate both.
  url?: string;
}

function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ReplicateProvider implements Provider {
  readonly id: ProviderId = 'replicate';
  readonly label = 'Replicate';
  readonly supportedModels: string[] = Object.values(REPLICATE_MODELS);

  constructor(private readonly apiKey: string) {
    if (!apiKey || apiKey.trim() === '') {
      throw new ProviderError('Replicate API key is missing. Add it in Settings.', 'replicate');
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async generate(options: GenerateOptions): Promise<ResultItem[]> {
    checkSignal(options.signal);
    const input: Record<string, unknown> = {
      prompt: options.prompt,
      width: options.width ?? 1024,
      height: options.height ?? 1024,
    };
    if (options.referenceImages && options.referenceImages.length > 0) {
      input.reference_image = await this.fileInput(options.referenceImages[0], options.signal);
    }
    return this.run(options.model, input, options.signal);
  }

  async inpaint(options: InpaintOptions): Promise<ResultItem[]> {
    checkSignal(options.signal);
    const invertedMask = invertMaskConvention(options.maskImage);
    const [imageInput, maskInput] = await Promise.all([
      this.fileInput(options.sourceImage, options.signal),
      this.fileInput(invertedMask, options.signal),
    ]);
    const input: Record<string, unknown> = {
      prompt: options.prompt,
      image: imageInput,
      mask: maskInput,
      width: options.width,
      height: options.height,
    };
    return this.run(options.model, input, options.signal);
  }

  // Returns a URL or data URI suitable for use as a Replicate prediction input.
  private async fileInput(data: Uint8Array, signal?: AbortSignal): Promise<string> {
    if (data.byteLength <= DATA_URI_MAX_BYTES) {
      return bytesToDataUri(data);
    }
    const res = await request(`${REPLICATE_API}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      signal,
    });
    if (!res.ok) {
      const preview = await res.text().catch(() => '');
      throw new ProviderError(
        `Replicate file upload failed: ${res.status} ${res.statusText}`,
        'replicate',
        res.status,
        preview.slice(0, 500),
      );
    }
    const parsed = (await res.json<ReplicateFileResponse>()) ?? {};
    const url = parsed.urls?.get ?? parsed.url;
    if (!url) {
      throw new ProviderError(
        'Replicate file upload returned no URL.',
        'replicate',
        res.status,
      );
    }
    return url;
  }

  // Drives a single prediction lifecycle: create → poll → extract output.
  private async run(
    modelSlug: string,
    input: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<ResultItem[]> {
    const created = await checkedRequest<ReplicatePrediction>(
      `${REPLICATE_API}/models/${modelSlug}/predictions`,
      {
        method: 'POST',
        headers: this.headers({ Prefer: 'wait' }),
        body: JSON.stringify({ input }),
        signal,
        timeoutMs: PREDICTION_CREATE_TIMEOUT_MS,
      },
      this.id,
    );

    if (created.status === 'succeeded') {
      return this.extractOutput(created, signal);
    }
    if (created.status === 'failed' || created.status === 'canceled') {
      throw new ProviderError(
        `Replicate prediction ${created.status}: ${created.error ?? 'unknown error'}`,
        'replicate',
      );
    }

    const predictionUrl = created.urls?.get ?? `${REPLICATE_API}/predictions/${created.id}`;
    const cancelUrl =
      created.urls?.cancel ?? `${REPLICATE_API}/predictions/${created.id}/cancel`;

    const cancelOnAbort = (): void => {
      void request(cancelUrl, {
        method: 'POST',
        headers: this.headers(),
      }).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancelOnAbort, { once: true });

    try {
      const finished = await this.pollPrediction(predictionUrl, signal);
      return this.extractOutput(finished, signal);
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
    }
  }

  private async pollPrediction(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<ReplicatePrediction> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_POLL_TIME_MS) {
      checkSignal(signal);
      const next = await checkedRequest<ReplicatePrediction>(
        url,
        { method: 'GET', headers: this.headers(), signal },
        this.id,
      );
      if (next.status === 'succeeded') return next;
      if (next.status === 'failed' || next.status === 'canceled') {
        throw new ProviderError(
          `Replicate prediction ${next.status}: ${next.error ?? 'unknown error'}`,
          'replicate',
        );
      }
      await delay(POLL_INTERVAL_MS, signal);
    }
    throw new ProviderError(
      'Replicate prediction timed out after 2 minutes.',
      'replicate',
    );
  }

  private extractOutput(
    prediction: ReplicatePrediction,
    signal: AbortSignal | undefined,
  ): ResultItem[] {
    checkSignal(signal);
    const { output } = prediction;
    if (!output) {
      throw new ProviderError(
        'Replicate prediction succeeded but produced no output URL.',
        'replicate',
      );
    }
    const urls = Array.isArray(output) ? output : [output];
    if (urls.length === 0) {
      throw new ProviderError('Replicate output array was empty.', 'replicate');
    }
    return urls.map((u) => ({ pngBytes: new Uint8Array(0), imageUrl: u }));
  }
}
