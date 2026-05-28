const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

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
  if (parsed.protocol === 'https:') {
    return parsed;
  }
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed;
  }

  throw new InvalidBackendUrlError(
    `Backend URL must use https:// (got ${parsed.protocol}//${parsed.hostname}). http:// is only allowed for localhost / 127.0.0.1 / ::1.`,
  );
}

export function normalizeBackendUrl(raw: string): string {
  const parsed = validateBackendUrl(raw);
  return parsed.href.replace(/\/$/, '');
}
