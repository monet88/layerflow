import {
  GenerateOptions,
  InpaintOptions,
  Provider,
  ProviderError,
  ProviderId,
  CancelledError,
  ResultItem,
} from './provider-interface';
import {
  clearChatGPTTokens,
} from '../storage/secure-storage';
import { base64ToBytes, rgbaToPngBytes } from '../services/image-processing';
import { request } from '../services/network-client';
import { assertImageEditsResponse } from './backend-response';
import { normalizeBackendUrl } from '../auth/backend-url';
import { getValidToken, TokenExpiredError } from '../auth/token-manager';
import type {
  BackendErrorResponse,
  StoredChatGptTokens,
} from '../auth/oauth-types';

const REQUEST_TIMEOUT_MS = 180_000;

class BackendRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly bodyPreview?: string,
    public readonly retryAfter?: string,
  ) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

function preview(raw: string): string {
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function textChunk(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function readBackendError(res: Awaited<ReturnType<typeof request>>): Promise<BackendRequestError> {
  const raw = await res.text().catch(() => '');
  let parsed: BackendErrorResponse | undefined;
  try {
    parsed = raw ? (JSON.parse(raw) as BackendErrorResponse) : undefined;
  } catch {
    parsed = undefined;
  }

  const detail = parsed?.detail;
  const detailMessage = typeof detail === 'object' && detail !== null ? detail.message : undefined;
  const detailCode = typeof detail === 'object' && detail !== null ? detail.code : undefined;
  const message =
    detailMessage ??
    parsed?.message ??
    (typeof detail === 'string' ? detail : undefined) ??
    `ChatGPT backend request failed: ${res.status} ${res.statusText}`;
  const code = detailCode ?? parsed?.code;

  return new BackendRequestError(
    message,
    res.status,
    code,
    preview(raw),
    res.headers['retry-after'],
  );
}

function buildMultipartBody(
  boundary: string,
  options: InpaintOptions,
  maskPng: Uint8Array,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const addField = (name: string, value: string): void => {
    parts.push(
      textChunk(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  };
  const addFile = (
    name: string,
    filename: string,
    contentType: string,
    data: Uint8Array,
  ): void => {
    parts.push(
      textChunk(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
    );
    parts.push(data);
    parts.push(textChunk('\r\n'));
  };

  addFile('image', 'source.png', 'image/png', options.sourceImage);
  addFile('mask', 'mask.png', 'image/png', maskPng);
  addField('prompt', options.prompt);
  addField('model', options.model);
  addField('n', '1');
  addField('size', `${options.width ?? 1024}x${options.height ?? options.width ?? 1024}`);
  parts.push(textChunk(`--${boundary}--\r\n`));
  return concatChunks(parts);
}

function shouldRepairSession(error: BackendRequestError): boolean {
  return error.code === 'missing_session' || error.code === 'provider_auth_failed';
}

export class ChatGPTBackendProvider implements Provider {
  readonly id: ProviderId = 'chatgpt-backend';
  readonly label = 'ChatGPT Backend';
  readonly supportedModels = ['gpt-image-2'];

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(credentials: { backendUrl: string; apiKey: string }) {
    const backendUrl = credentials.backendUrl.trim();
    const apiKey = credentials.apiKey.trim();
    if (!backendUrl) {
      throw new ProviderError('ChatGPT backend URL is not configured.', 'chatgpt-backend');
    }
    if (!apiKey) {
      throw new ProviderError('ChatGPT backend API key is not configured.', 'chatgpt-backend');
    }
    this.baseUrl = normalizeBackendUrl(backendUrl);
    this.apiKey = apiKey;
  }

  async registerSession(_tokens?: StoredChatGptTokens, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new CancelledError();
  }

  async generate(options: GenerateOptions): Promise<ResultItem[]> {
    try {
      const tokens = await getValidToken(options.signal);
      try {
        return await this.sendGenerateRequest(options, tokens);
      } catch (error) {
        if (error instanceof BackendRequestError && shouldRepairSession(error)) {
          await this.registerSession(tokens, options.signal);
          return await this.sendGenerateRequest(options, tokens);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new ProviderError(error.message, this.id);
      }
      if (error instanceof BackendRequestError) {
        throw await this.toProviderError(error, true);
      }
      throw error;
    }
  }

  async inpaint(options: InpaintOptions): Promise<ResultItem[]> {
    try {
      const tokens = await getValidToken(options.signal);
      try {
        return await this.sendEditRequest(options, tokens);
      } catch (error) {
        if (error instanceof BackendRequestError && shouldRepairSession(error)) {
          await this.registerSession(tokens, options.signal);
          return await this.sendEditRequest(options, tokens);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new ProviderError(error.message, this.id);
      }
      if (error instanceof BackendRequestError) {
        throw await this.toProviderError(error, true);
      }
      throw error;
    }
  }

  private async sendGenerateRequest(options: GenerateOptions, tokens: StoredChatGptTokens): Promise<ResultItem[]> {
    const res = await request(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-User-Id': tokens.userId,
        'X-ChatGPT-Access-Token': tokens.accessToken,
      },
      body: JSON.stringify({
        prompt: options.prompt,
        model: options.model,
        n: 1,
        size: `${options.width ?? 1024}x${options.height ?? options.width ?? 1024}`,
      }),
      signal: options.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!res.ok) {
      throw await readBackendError(res);
    }

    const raw = await res.json();
    const parsed = assertImageEditsResponse(raw);
    return parsed.data.map((item) => ({
      pngBytes: item.b64_json ? base64ToBytes(item.b64_json) : new Uint8Array(0),
      imageUrl: item.url,
      revisedPrompt: item.revised_prompt,
    }));
  }

  private async sendEditRequest(options: InpaintOptions, tokens: StoredChatGptTokens): Promise<ResultItem[]> {
    if (!options.maskWidth || !options.maskHeight) {
      throw new ProviderError(
        'ChatGPT backend requires mask dimensions for upload.',
        'chatgpt-backend',
      );
    }

    const maskPng = await rgbaToPngBytes(options.maskImage, options.maskWidth, options.maskHeight);
    const boundary = `----inpaintkit-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    const body = buildMultipartBody(boundary, options, maskPng);
    const res = await request(`${this.baseUrl}/v1/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-User-Id': tokens.userId,
        'X-ChatGPT-Access-Token': tokens.accessToken,
      },
      body,
      signal: options.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!res.ok) {
      throw await readBackendError(res);
    }

    const raw = await res.json();
    const parsed = assertImageEditsResponse(raw);
    return parsed.data.map((item) => ({
      pngBytes: item.b64_json ? base64ToBytes(item.b64_json) : new Uint8Array(0),
      imageUrl: item.url,
      revisedPrompt: item.revised_prompt,
    }));
  }

  private async toProviderError(
    error: BackendRequestError,
    clearSessionIfAuthFailure: boolean,
  ): Promise<ProviderError> {
    if (shouldRepairSession(error) && clearSessionIfAuthFailure) {
      await clearChatGPTTokens();
      return new ProviderError(
        'ChatGPT session expired. Open Settings and sign in again.',
        this.id,
        error.status,
        error.bodyPreview,
      );
    }
    if (error.code === 'provider_reconnect_required') {
      return new ProviderError(
        'ChatGPT requires re-authorization. In Settings, confirm Device Code authorization for Codex is enabled, then sign in again.',
        this.id,
        error.status,
        error.bodyPreview,
      );
    }
    if (error.code === 'provider_rate_limited' || error.status === 429) {
      const suffix = error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : '';
      return new ProviderError(
        `ChatGPT is rate limited.${suffix}`,
        this.id,
        error.status,
        error.bodyPreview,
      );
    }
    if (error.code === 'provider_timeout' || error.status === 408) {
      return new ProviderError(
        'ChatGPT backend timed out after waiting for GPT Image 2. Try again.',
        this.id,
        error.status,
        error.bodyPreview,
      );
    }
    if (error.status === 413) {
      return new ProviderError(
        'Image too large for the ChatGPT backend upload limit.',
        this.id,
        error.status,
        error.bodyPreview,
      );
    }
    return new ProviderError(error.message, this.id, error.status, error.bodyPreview);
  }
}
