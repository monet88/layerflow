// Provider registry: maps a ProviderId (and optionally a model id) to a Provider instance.
// Sprint 1 ships fal.ai; Sprint 2 adds Replicate; Sprint 3 will add the ChatGPT backend.

import { FalAIProvider } from './falai-provider';
import { ReplicateProvider } from './replicate-provider';
import { providerIdForModel } from './model-registry';
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
    case 'replicate': {
      const key = credentials.replicate;
      if (!key) {
        throw new ProviderError(
          'Replicate API key not configured. Open Settings and add your key.',
          'replicate',
        );
      }
      return new ReplicateProvider(key);
    }
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

// Returns the ProviderId responsible for a given UI model identifier.
// Delegates to model-registry — single source of truth for model → provider mapping.
export function providerForModel(modelId: string): ProviderId {
  return providerIdForModel(modelId);
}
