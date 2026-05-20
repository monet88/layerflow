// Provider abstraction: interfaces, types, and error classes used by all AI providers.

export type ProviderId = 'falai' | 'replicate' | 'chatgpt-backend';

export interface GenerateOptions {
  prompt: string;
  model: string;
  width?: number;
  height?: number;
  referenceImages?: Uint8Array[];
  // Cancellation — providers MUST check signal.aborted in any polling/long-running loop.
  signal?: AbortSignal;
}

export interface InpaintOptions extends GenerateOptions {
  // PNG bytes of the source region (with context padding, already cropped/composited).
  sourceImage: Uint8Array;
  // RGBA PNG; alpha=0 means "edit this pixel" (internal convention).
  // Provider implementations are responsible for converting to provider-specific encoding.
  maskImage: Uint8Array;
}

export interface ResultItem {
  pngBytes: Uint8Array;
  // Set by providers whose response is a remote URL rather than inline bytes.
  // Phase 5 pipeline downloads via NetworkClient.fetchBytes() before placement.
  imageUrl?: string;
  revisedPrompt?: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  readonly supportedModels: string[];
  generate(options: GenerateOptions): Promise<ResultItem[]>;
  inpaint(options: InpaintOptions): Promise<ResultItem[]>;
}

export interface ProviderCredentials {
  falai?: string;
  replicate?: string;
  chatgptBackendUrl?: string;
  chatgptBackendApiKey?: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: ProviderId,
    public readonly status?: number,
    public readonly bodyPreview?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(providerId: ProviderId, status: number, bodyPreview?: string) {
    super('Rate limit exceeded. Try again in a few seconds.', providerId, status, bodyPreview);
    this.name = 'RateLimitError';
  }
}

export class ContentPolicyError extends ProviderError {
  constructor(providerId: ProviderId, status: number, bodyPreview?: string) {
    super(
      'Request rejected by provider content policy.',
      providerId,
      status,
      bodyPreview,
    );
    this.name = 'ContentPolicyError';
  }
}

export class AuthError extends ProviderError {
  constructor(providerId: ProviderId, status: number, bodyPreview?: string) {
    super(
      'Authentication failed. Check the API key in Settings.',
      providerId,
      status,
      bodyPreview,
    );
    this.name = 'AuthError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Operation was cancelled.');
    this.name = 'CancelledError';
  }
}
