export const SUPPORTED_BACKEND_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://[::1]:8000',
] as const;

const SUPPORTED_BACKEND_ORIGIN_SET = new Set<string>(SUPPORTED_BACKEND_ORIGINS);

export class InvalidBackendUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackendUrlError';
  }
}

export function validateBackendUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidBackendUrlError('Backend URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidBackendUrlError('Backend URL is not a valid URL.');
  }

  if (parsed.username || parsed.password) {
    throw new InvalidBackendUrlError('Backend URL must not contain credentials.');
  }
  if (parsed.hash) {
    throw new InvalidBackendUrlError('Backend URL must not contain a fragment.');
  }
  if (SUPPORTED_BACKEND_ORIGIN_SET.has(parsed.origin)) {
    return parsed;
  }

  throw new InvalidBackendUrlError(
    `Backend URL must use one of the UXP manifest allowlisted origins: ${SUPPORTED_BACKEND_ORIGINS.join(', ')}.`,
  );
}

export function normalizeBackendUrl(raw: string): string {
  const parsed = validateBackendUrl(raw);
  return parsed.href.replace(/\/$/, '');
}
