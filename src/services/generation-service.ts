// Generation pipeline: orchestrates UI → Photoshop reads → provider call → place result.
// Two entrypoints: runGenerate (text-to-image) and runInpaint (selection-based edit).
// Single-flight lock prevents concurrent executeAsModal collisions (RT7).

import { exportDocumentRegion } from '../photoshop/export-image';
import { placeResultAsSmartObject } from '../photoshop/place-result';
import { DocInfo, getDocumentInfo } from '../photoshop/document-utils';
import {
  expandRectForInpaintContext,
  getSelectionBounds,
  getSelectionMask,
} from '../photoshop/selection';
import { getModelDefinition, resolveEndpoint } from '../providers/model-registry';
import { getProvider, providerForModel } from '../providers/provider-registry';
import {
  CancelledError,
  ContentPolicyError,
  ProviderError,
  RateLimitError,
  ResultItem,
} from '../providers/provider-interface';
import { resizeMaskToMatch, selectResolutionBucket } from './image-processing';
import { fetchBytes } from './network-client';
import { loadCredentials } from '../storage/secure-storage';
import { saveRecentPrompt } from '../storage/settings-storage';

export type ProgressStage =
  | 'preparing'
  | 'exporting'
  | 'uploading'
  | 'generating'
  | 'placing'
  | 'done';

export interface ProgressUpdate {
  stage: ProgressStage;
  percent: number;
  message: string;
}

export interface PipelineOptions {
  prompt: string;
  model: string;
  referenceImages?: Uint8Array[];
  onProgress: (update: ProgressUpdate) => void;
  signal: AbortSignal;
}

export class ModelCapabilityError extends Error {
  constructor(model: string, capability: 'generate' | 'inpaint') {
    super(`Model "${model}" does not support ${capability}. Pick a different model.`);
    this.name = 'ModelCapabilityError';
  }
}

export class GenerationInProgressError extends Error {
  constructor() {
    super('A generation is already in progress. Cancel it first or wait for it to finish.');
    this.name = 'GenerationInProgressError';
  }
}

export interface PlacementErrorPayload {
  cachedBytes: Uint8Array;
}

export class PlacementError extends Error {
  readonly cachedBytes: Uint8Array;
  constructor(message: string, cachedBytes: Uint8Array) {
    super(message);
    this.name = 'PlacementError';
    this.cachedBytes = cachedBytes;
  }
}

let isGenerating = false;

function acquireLock(): void {
  if (isGenerating) throw new GenerationInProgressError();
  isGenerating = true;
}

function releaseLock(): void {
  isGenerating = false;
}

export function isGenerationInFlight(): boolean {
  return isGenerating;
}

function assertCapability(model: string, capability: 'generate' | 'inpaint'): void {
  const def = getModelDefinition(model);
  if (!def.capabilities.includes(capability)) {
    throw new ModelCapabilityError(model, capability);
  }
}

function emitProgress(
  onProgress: (u: ProgressUpdate) => void,
  stage: ProgressStage,
  percent: number,
  message: string,
): void {
  // Wrap onProgress so a faulty consumer cannot crash the pipeline.
  try {
    onProgress({ stage, percent, message });
  } catch (err) {
    console.error('InpaintKit: progress callback threw', err);
  }
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError();
}

async function resolveImageUrls(results: ResultItem[]): Promise<ResultItem[]> {
  return Promise.all(
    results.map(async (item) => {
      if (item.imageUrl && (!item.pngBytes || item.pngBytes.length === 0)) {
        const bytes = await fetchBytes(item.imageUrl);
        return { ...item, pngBytes: bytes, imageUrl: undefined };
      }
      return item;
    }),
  );
}

function userMessageFor(err: unknown): string {
  if (err instanceof RateLimitError) {
    return 'Rate limit reached. Wait a few seconds and try again.';
  }
  if (err instanceof ContentPolicyError) {
    return 'This prompt was blocked by content policy. Try rephrasing.';
  }
  if (err instanceof ModelCapabilityError) {
    return err.message;
  }
  if (err instanceof CancelledError) {
    return 'Cancelled.';
  }
  if (err instanceof ProviderError) {
    return err.message;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('No document open')) return msg;
  if (msg.includes('No selection')) return msg;
  if (/timed?\s*out|timeout/i.test(msg)) {
    return 'Connection timed out. Check your internet connection and try again.';
  }
  if (/api key|not configured/i.test(msg)) return msg;
  return `Generation failed: ${msg}`;
}

function rememberPrompt(prompt: string, model: string): void {
  try {
    saveRecentPrompt(prompt, model);
  } catch (err) {
    console.warn('InpaintKit: failed to persist recent prompt', err);
  }
}

export async function runGenerate(opts: PipelineOptions): Promise<void> {
  const { prompt, model, onProgress, signal, referenceImages } = opts;

  acquireLock();
  try {
    assertCapability(model, 'generate');
    const def = getModelDefinition(model);

    emitProgress(onProgress, 'preparing', 5, 'Preparing...');
    let docInfo: DocInfo;
    try {
      docInfo = getDocumentInfo();
    } catch (e) {
      throw new Error(userMessageFor(e));
    }
    checkSignal(signal);

    const providerId = providerForModel(model);
    const credentials = await loadCredentials();
    const provider = getProvider(providerId, credentials);
    const endpoint = resolveEndpoint(model, 'generate');
    const bucket = selectResolutionBucket(docInfo.width, docInfo.height, def.resolutions);
    const refs = def.supportsReferenceImages
      ? referenceImages?.filter((b) => b && b.length > 0)
      : undefined;

    emitProgress(onProgress, 'generating', 30, 'Generating image...');
    let results: ResultItem[];
    try {
      results = await provider.generate({
        prompt,
        model: endpoint,
        width: bucket,
        height: bucket,
        referenceImages: refs,
        signal,
      });
    } catch (e) {
      throw new Error(userMessageFor(e));
    }
    checkSignal(signal);

    emitProgress(onProgress, 'generating', 75, 'Processing result...');
    results = await resolveImageUrls(results);
    if (!results[0]?.pngBytes?.length) {
      throw new Error('Provider returned empty image data.');
    }
    const generatedBytes = results[0].pngBytes;

    emitProgress(onProgress, 'placing', 85, 'Placing layer...');
    const targetRect = {
      left: 0,
      top: 0,
      right: docInfo.width,
      bottom: docInfo.height,
      width: docInfo.width,
      height: docInfo.height,
    };
    try {
      await placeResultAsSmartObject({
        pngBytes: generatedBytes,
        targetRect,
        layerName: `InpaintKit: ${prompt.slice(0, 40)}`,
      });
    } catch (e) {
      throw new PlacementError(
        `Placement failed: ${(e as Error).message}. The generated image is cached — retry placement or save to disk.`,
        generatedBytes,
      );
    }

    emitProgress(onProgress, 'done', 100, 'Done');
    rememberPrompt(prompt, model);
  } finally {
    releaseLock();
  }
}

export async function runInpaint(opts: PipelineOptions): Promise<void> {
  const { prompt, model, onProgress, signal, referenceImages } = opts;

  acquireLock();
  try {
    assertCapability(model, 'inpaint');
    const def = getModelDefinition(model);

    emitProgress(onProgress, 'preparing', 5, 'Reading selection...');
    const bounds = getSelectionBounds();
    if (!bounds) {
      throw new Error(
        'No selection found. Make a selection (lasso, marquee, etc.) before using Inpaint.',
      );
    }

    let docInfo: DocInfo;
    try {
      docInfo = getDocumentInfo();
    } catch (e) {
      throw new Error(userMessageFor(e));
    }

    const expandedBounds = expandRectForInpaintContext(bounds, docInfo.width, docInfo.height);
    checkSignal(signal);

    emitProgress(onProgress, 'exporting', 15, 'Exporting region...');
    let sourceImage: Uint8Array;
    try {
      sourceImage = await exportDocumentRegion(expandedBounds);
    } catch (e) {
      throw new Error(`Export failed: ${(e as Error).message}`);
    }
    checkSignal(signal);

    emitProgress(onProgress, 'exporting', 30, 'Reading selection mask...');
    let maskResult: { data: Uint8Array; width: number; height: number };
    try {
      // Mask is read at expandedBounds so dimensions match sourceImage exactly (RT1 fix).
      maskResult = await getSelectionMask(expandedBounds);
    } catch (e) {
      throw new Error(`Mask extraction failed: ${(e as Error).message}`);
    }
    checkSignal(signal);

    const providerId = providerForModel(model);
    const credentials = await loadCredentials();
    const provider = getProvider(providerId, credentials);
    const endpoint = resolveEndpoint(model, 'inpaint');
    const bucket = selectResolutionBucket(
      expandedBounds.width,
      expandedBounds.height,
      def.resolutions,
    );
    const refs = def.supportsReferenceImages
      ? referenceImages?.filter((b) => b && b.length > 0)
      : undefined;

    const uploadMessage =
      providerId === 'chatgpt-backend'
        ? 'Uploading image to GPT Image 2 (this may take 2+ minutes)...'
        : 'Uploading to AI...';
    emitProgress(onProgress, 'uploading', 45, uploadMessage);
    let results: ResultItem[];
    try {
      results = await provider.inpaint({
        prompt,
        model: endpoint,
        sourceImage,
        maskImage: maskResult.data,
        maskWidth: maskResult.width,
        maskHeight: maskResult.height,
        width: bucket,
        height: bucket,
        referenceImages: refs,
        signal,
      });
    } catch (e) {
      throw new Error(userMessageFor(e));
    }
    checkSignal(signal);

    emitProgress(onProgress, 'generating', 80, 'Processing result...');
    results = await resolveImageUrls(results);
    if (!results[0]?.pngBytes?.length) {
      throw new Error('Provider returned empty image data.');
    }
    const inpaintedBytes = results[0].pngBytes;

    emitProgress(onProgress, 'placing', 90, 'Placing layer...');
    // Mask is sized to expandedBounds; place-result expects mask matching the target rect.
    const placementMask = resizeMaskToMatch(
      maskResult,
      expandedBounds.width,
      expandedBounds.height,
    );
    try {
      await placeResultAsSmartObject({
        pngBytes: inpaintedBytes,
        targetRect: expandedBounds,
        maskData: {
          data: placementMask,
          width: expandedBounds.width,
          height: expandedBounds.height,
        },
        layerName: `InpaintKit: ${prompt.slice(0, 40)}`,
      });
    } catch (e) {
      throw new PlacementError(
        `Placement failed: ${(e as Error).message}. The inpainted image is cached — retry placement or save to disk.`,
        inpaintedBytes,
      );
    }

    emitProgress(onProgress, 'done', 100, 'Done');
    rememberPrompt(prompt, model);
  } finally {
    releaseLock();
  }
}
