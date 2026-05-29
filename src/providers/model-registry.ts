// Model registry: single source of truth mapping UI-facing model IDs to provider endpoints.
// Sprint 2 extends this with resolution buckets, cost hints, and reference-image flags.

import { FALAI_MODELS } from './falai-provider';
import { ProviderError, ProviderId } from './provider-interface';

export type Capability = 'generate' | 'inpaint';
export type ResolutionOption = 1024 | 2048 | 4096 | 1536;

export interface ModelDefinition {
  id: string;
  label: string;
  providerId: ProviderId;
  capabilities: Capability[];
  // Endpoint used per capability. Some models (GPT Image 2) have separate slugs for generate vs edit.
  endpointByCapability: Partial<Record<Capability, string>>;
  // Supported max-dimension buckets, ascending. Used by `selectResolutionBucket`.
  resolutions: ResolutionOption[];
  defaultResolution: ResolutionOption;
  costHint: string;
  supportsReferenceImages: boolean;
}

export const REPLICATE_MODELS = {
  NANO_BANANA_PRO: 'fofr/nano-banana-pro',
  SEEDREAM_5_LITE: 'bytedance/seedream-5-lite',
} as const;

const REGISTRY: Record<string, ModelDefinition> = {
  'flux-fill-pro': {
    id: 'flux-fill-pro',
    label: 'Flux Fill Pro (fal.ai) — inpainting',
    providerId: 'falai',
    capabilities: ['inpaint'],
    endpointByCapability: {
      inpaint: FALAI_MODELS.FLUX_FILL_PRO,
    },
    resolutions: [1024, 2048],
    defaultResolution: 1024,
    costHint: '$0.05/img',
    supportsReferenceImages: false,
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    label: 'Nano Banana 2 (fal.ai) — fast',
    providerId: 'falai',
    capabilities: ['generate'],
    endpointByCapability: {
      generate: FALAI_MODELS.NANO_BANANA_2,
    },
    resolutions: [1024, 2048, 4096],
    defaultResolution: 1024,
    costHint: '$0.04/img',
    supportsReferenceImages: true,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (fal.ai) — premium',
    providerId: 'falai',
    capabilities: ['generate', 'inpaint'],
    endpointByCapability: {
      generate: FALAI_MODELS.GPT_IMAGE_2_GENERATE,
      inpaint: FALAI_MODELS.GPT_IMAGE_2_EDIT,
    },
    resolutions: [1024, 1536, 2048],
    defaultResolution: 1024,
    costHint: '$0.08/img',
    supportsReferenceImages: true,
  },
  'gpt-image-2-chatgpt': {
    id: 'gpt-image-2-chatgpt',
    label: 'GPT Image 2 (ChatGPT) — subscription',
    providerId: 'chatgpt-backend',
    capabilities: ['generate', 'inpaint'],
    endpointByCapability: {
      generate: 'gpt-image-2',
      inpaint: 'gpt-image-2',
    },
    resolutions: [1024],
    defaultResolution: 1024,
    costHint: 'ChatGPT sub',
    supportsReferenceImages: false,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro (Replicate)',
    providerId: 'replicate',
    capabilities: ['generate', 'inpaint'],
    endpointByCapability: {
      generate: REPLICATE_MODELS.NANO_BANANA_PRO,
      inpaint: REPLICATE_MODELS.NANO_BANANA_PRO,
    },
    resolutions: [1024, 2048, 4096],
    defaultResolution: 1024,
    costHint: '$0.035/img',
    supportsReferenceImages: true,
  },
  'seedream-5-lite': {
    id: 'seedream-5-lite',
    label: 'Seedream 5 Lite (Replicate)',
    providerId: 'replicate',
    capabilities: ['generate', 'inpaint'],
    endpointByCapability: {
      generate: REPLICATE_MODELS.SEEDREAM_5_LITE,
      inpaint: REPLICATE_MODELS.SEEDREAM_5_LITE,
    },
    resolutions: [1024, 2048],
    defaultResolution: 1024,
    costHint: '$0.035/img',
    supportsReferenceImages: false,
  },
};

export function getModelDefinition(modelId: string): ModelDefinition {
  const def = REGISTRY[modelId];
  if (!def) {
    throw new ProviderError(`Unknown model: ${modelId}`, 'falai');
  }
  return def;
}

export function listModels(): ModelDefinition[] {
  return Object.values(REGISTRY);
}

// Returns the provider-specific endpoint for a (model, capability) pair.
// Throws if the model does not declare that capability — pipeline must call assertCapability first.
export function resolveEndpoint(modelId: string, capability: Capability): string {
  const def = getModelDefinition(modelId);
  const endpoint = def.endpointByCapability[capability];
  if (!endpoint) {
    throw new ProviderError(
      `Model "${modelId}" has no endpoint for capability "${capability}".`,
      def.providerId,
    );
  }
  return endpoint;
}

export function providerIdForModel(modelId: string): ProviderId {
  return getModelDefinition(modelId).providerId;
}
