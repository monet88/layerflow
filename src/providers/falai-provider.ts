// fal.ai provider implementation. Handles fal-native models (Flux Fill Pro, Nano Banana 2)
// and fal-hosted third-party models (openai/gpt-image-2, openai/gpt-image-2/edit).

import {
  CancelledError,
  GenerateOptions,
  InpaintOptions,
  Provider,
  ProviderError,
  ProviderId,
  ResultItem,
} from './provider-interface';
import { bytesToDataUri, detectPngOutputFormat, invertMaskConvention } from '../services/image-processing';
import { checkedRequest, fetchBytes } from '../services/network-client';

const FAL_RUN_BASE = 'https://fal.run';

interface FalImage {
  url: string;
  content_type?: string;
}

interface FalResponse {
  images?: FalImage[];
  prompt?: string;
}

export const FALAI_MODELS = {
  FLUX_FILL_PRO: 'fal-ai/flux-pro/v1/fill',
  NANO_BANANA_2: 'fal-ai/nano-banana-2',
  GPT_IMAGE_2_GENERATE: 'openai/gpt-image-2',
  GPT_IMAGE_2_EDIT: 'openai/gpt-image-2/edit',
} as const;

export type FalModelId = (typeof FALAI_MODELS)[keyof typeof FALAI_MODELS];

function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError();
}

function endpointUrl(modelId: string): string {
  return `${FAL_RUN_BASE}/${modelId}`;
}

function buildResults(response: FalResponse): ResultItem[] {
  const images = response.images ?? [];
  if (images.length === 0) {
    throw new ProviderError(
      'fal.ai response did not include any images.',
      'falai',
      undefined,
      JSON.stringify(response).slice(0, 500),
    );
  }
  return images.map((img) => ({
    pngBytes: new Uint8Array(0),
    imageUrl: img.url,
    revisedPrompt: response.prompt,
  }));
}

interface FluxFillPayload {
  prompt: string;
  image_url: string;
  mask_url: string;
  output_count: number;
  output_format?: 'png' | 'jpeg';
  safety_tolerance: number;
  seed?: number;
}

interface NanoBananaPayload {
  prompt: string;
  num_images: number;
  resolution: string;
  aspect_ratio: string;
  output_format: 'png' | 'jpeg';
  image_urls?: string[];
}

interface GptImage2GeneratePayload {
  prompt: string;
  image_size: string;
  quality: string;
  num_images: number;
  output_format: 'png' | 'jpeg';
}

interface GptImage2EditPayload extends GptImage2GeneratePayload {
  image_urls: string[];
  mask_image_url: string;
  input_fidelity: 'high' | 'low';
}

function aspectRatioFromDimensions(width?: number, height?: number): string {
  if (!width || !height) return '1:1';
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (ratio > 1.6) return '16:9';
  if (ratio > 1.2) return '4:3';
  if (ratio < 0.625) return '9:16';
  if (ratio < 0.83) return '3:4';
  return '1:1';
}

function imageSizeFromDimensions(width?: number, height?: number): string {
  if (!width || !height) return 'square';
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.05) return 'square';
  if (ratio > 1) return 'landscape_4_3';
  return 'portrait_3_4';
}

export class FalAIProvider implements Provider {
  readonly id: ProviderId = 'falai';
  readonly label = 'fal.ai';
  readonly supportedModels: string[] = Object.values(FALAI_MODELS);

  constructor(private readonly apiKey: string) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('fal.ai API key is missing. Add it in Settings.');
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Key ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async generate(options: GenerateOptions): Promise<ResultItem[]> {
    checkSignal(options.signal);
    switch (options.model) {
      case FALAI_MODELS.NANO_BANANA_2:
        return this.runNanoBanana(options);
      case FALAI_MODELS.GPT_IMAGE_2_GENERATE:
        return this.runGptImage2Generate(options);
      case FALAI_MODELS.FLUX_FILL_PRO:
        throw new ProviderError(
          'Flux Fill Pro requires inpaint mode (mask + source image).',
          'falai',
        );
      default:
        throw new ProviderError(
          `Unsupported fal.ai model for generate: ${options.model}`,
          'falai',
        );
    }
  }

  async inpaint(options: InpaintOptions): Promise<ResultItem[]> {
    checkSignal(options.signal);
    switch (options.model) {
      case FALAI_MODELS.FLUX_FILL_PRO:
        return this.runFluxFill(options);
      case FALAI_MODELS.GPT_IMAGE_2_EDIT:
        return this.runGptImage2Edit(options);
      case FALAI_MODELS.NANO_BANANA_2:
        throw new ProviderError(
          'Nano Banana 2 does not support mask-based inpainting; use generate with reference images instead.',
          'falai',
        );
      default:
        throw new ProviderError(
          `Unsupported fal.ai model for inpaint: ${options.model}`,
          'falai',
        );
    }
  }

  private async runFluxFill(options: InpaintOptions): Promise<ResultItem[]> {
    const invertedMask = invertMaskConvention(options.maskImage);
    const outputFormat = detectPngOutputFormat(options.sourceImage) === 'jpg' ? 'jpeg' : 'png';
    const payload: FluxFillPayload = {
      prompt: options.prompt,
      image_url: bytesToDataUri(options.sourceImage),
      mask_url: bytesToDataUri(invertedMask),
      output_count: 1,
      output_format: outputFormat,
      safety_tolerance: 4,
    };
    const response = await checkedRequest<FalResponse>(
      endpointUrl(FALAI_MODELS.FLUX_FILL_PRO),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: options.signal,
      },
      this.id,
    );
    return buildResults(response);
  }

  private async runNanoBanana(options: GenerateOptions): Promise<ResultItem[]> {
    const payload: NanoBananaPayload = {
      prompt: options.prompt,
      num_images: 1,
      resolution: '1K',
      aspect_ratio: aspectRatioFromDimensions(options.width, options.height),
      output_format: 'png',
    };
    if (options.referenceImages && options.referenceImages.length > 0) {
      payload.image_urls = options.referenceImages.map((bytes) => bytesToDataUri(bytes));
    }
    const response = await checkedRequest<FalResponse>(
      endpointUrl(FALAI_MODELS.NANO_BANANA_2),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: options.signal,
      },
      this.id,
    );
    return buildResults(response);
  }

  private async runGptImage2Generate(options: GenerateOptions): Promise<ResultItem[]> {
    const payload: GptImage2GeneratePayload = {
      prompt: options.prompt,
      image_size: imageSizeFromDimensions(options.width, options.height),
      quality: 'high',
      num_images: 1,
      output_format: 'png',
    };
    const response = await checkedRequest<FalResponse>(
      endpointUrl(FALAI_MODELS.GPT_IMAGE_2_GENERATE),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: options.signal,
      },
      this.id,
    );
    return buildResults(response);
  }

  private async runGptImage2Edit(options: InpaintOptions): Promise<ResultItem[]> {
    const invertedMask = invertMaskConvention(options.maskImage);
    const imageUrls = [bytesToDataUri(options.sourceImage)];
    if (options.referenceImages) {
      for (const ref of options.referenceImages) {
        imageUrls.push(bytesToDataUri(ref));
      }
    }
    const outputFormat = detectPngOutputFormat(options.sourceImage) === 'jpg' ? 'jpeg' : 'png';
    const payload: GptImage2EditPayload = {
      prompt: options.prompt,
      image_urls: imageUrls,
      mask_image_url: bytesToDataUri(invertedMask),
      image_size: imageSizeFromDimensions(options.width, options.height),
      quality: 'high',
      num_images: 1,
      output_format: outputFormat,
      input_fidelity: 'high',
    };
    const response = await checkedRequest<FalResponse>(
      endpointUrl(FALAI_MODELS.GPT_IMAGE_2_EDIT),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: options.signal,
      },
      this.id,
    );
    return buildResults(response);
  }
}

// Re-export network util for callers that need to download fal.ai signed URLs (Phase 5).
export { fetchBytes };
