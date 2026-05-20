// Public type re-exports — single import surface for consumers (Phase 5 pipeline, UI).

export type {
  GenerateOptions,
  InpaintOptions,
  Provider,
  ProviderCredentials,
  ProviderId,
  ResultItem,
} from '../providers/provider-interface';

export {
  AuthError,
  CancelledError,
  ContentPolicyError,
  ProviderError,
  RateLimitError,
} from '../providers/provider-interface';
