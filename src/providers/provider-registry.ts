// Provider registry: maps a ProviderId (and optionally a model id) to a Provider instance.
// Sprint 1 ships fal.ai only — Replicate (Sprint 2) and ChatGPT backend (Sprint 3) plug in later.

import { FALAI_MODELS, FalAIProvider } from './falai-provider';
import {
  Provider,
  ProviderCredentials,
  ProviderError,
  ProviderId,
} from './provider-interface';

export function getProvider(id: ProviderId, credentials: ProviderCredentials): Provider {
  switch (id) {
    case 'falai': {
      const key = credentials.falai;
      if (!key) {
        throw new ProviderError(
          'fal.ai API key not configured. Open Settings and add your key.',
          'falai',
        );
      }
      return new FalAIProvider(key);
    }
    case 'replicate':
      throw new ProviderError(
        'Replicate provider is not implemented yet (Sprint 2).',
        'replicate',
      );
    case 'chatgpt-backend':
      throw new ProviderError(
        'ChatGPT backend provider is not implemented yet (Sprint 3).',
        'chatgpt-backend',
      );
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown provider id: ${String(exhaustive)}`);
    }
  }
}

// Returns the ProviderId responsible for a given model identifier.
// Used by Phase 5 pipeline to route a UI-selected model to the right provider.
export function providerForModel(modelId: string): ProviderId {
  const falModels = Object.values(FALAI_MODELS) as string[];
  if (falModels.includes(modelId)) return 'falai';
  // Future: Replicate model prefixes (e.g., starting with org slug "/"), backend models, etc.
  throw new ProviderError(`No provider registered for model: ${modelId}`, 'falai');
}
