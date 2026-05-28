// HTTP client with proactive XHR fallback for UXP.
// Rationale: UXP fetch() silently fails (or hangs) on uploads larger than ~5MB. Above that
// threshold we go directly to XHR with a long timeout; below it, we try fetch first and fall
// back to XHR on error.

import {
  AuthError,
  CancelledError,
  ContentPolicyError,
  ProviderError,
  ProviderId,
  RateLimitError,
} from '../providers/provider-interface';

const FETCH_BYPASS_THRESHOLD_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const XHR_TIMEOUT_MS = 180_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryOnFetchFailure?: boolean;
}

export interface NetworkResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
}

function bodySize(body: string | Uint8Array | undefined): number {
  if (!body) return 0;
  if (typeof body === 'string') return body.length;
  return body.byteLength;
}

class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

function decodeXhrText(xhr: XMLHttpRequest): string {
  if (typeof xhr.response === 'string') return xhr.response;
  if (xhr.response instanceof ArrayBuffer) return new TextDecoder().decode(xhr.response);
  if (xhr.response == null) return '';
  return String(xhr.response);
}

function buildResponseFromXhr(xhr: XMLHttpRequest): NetworkResponse {
  const headers: Record<string, string> = {};
  const rawHeaders = xhr.getAllResponseHeaders();
  rawHeaders.split('\r\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headers[key] = value;
    }
  });

  return {
    ok: xhr.status >= 200 && xhr.status < 300,
    status: xhr.status,
    statusText: xhr.statusText,
    headers,
    async text() {
      return decodeXhrText(xhr);
    },
    async json<T = unknown>() {
      return JSON.parse(decodeXhrText(xhr)) as T;
    },
    async bytes() {
      if (xhr.response instanceof ArrayBuffer) return new Uint8Array(xhr.response);
      return new TextEncoder().encode(decodeXhrText(xhr));
    },
  };
}

function xhrRequest(url: string, options: RequestOptions): Promise<NetworkResponse> {
  return new Promise<NetworkResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = options.method ?? 'GET';
    xhr.open(method, url, true);
    xhr.timeout = options.timeoutMs ?? XHR_TIMEOUT_MS;
    xhr.responseType = 'arraybuffer';

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        xhr.setRequestHeader(key, value);
      }
    }

    const onAbort = () => {
      xhr.abort();
      reject(new CancelledError());
    };
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new CancelledError());
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.onload = () => resolve(buildResponseFromXhr(xhr));
    xhr.onerror = () => reject(new Error(`XHR network error: ${url}`));
    xhr.ontimeout = () => reject(new Error(`XHR timeout after ${xhr.timeout}ms: ${url}`));

    const body = options.body;
    if (body === undefined) {
      xhr.send();
    } else if (typeof body === 'string') {
      xhr.send(body);
    } else {
      // Cast: lib.dom XHR send() typings reject Uint8Array<ArrayBufferLike>, but UXP's XHR
      // accepts typed arrays at runtime. Send the underlying buffer as ArrayBuffer.
      xhr.send(body.buffer as ArrayBuffer);
    }
  });
}

async function fetchRequest(url: string, options: RequestOptions): Promise<NetworkResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? FETCH_TIMEOUT_MS);

  // Forward external abort signal into the internal controller.
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new CancelledError();
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers: options.headers,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      init.body = options.body as BodyInit;
    }
    const res = await fetch(url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers,
      text: () => res.text(),
      json: <T = unknown>() => res.json() as Promise<T>,
      bytes: async () => new Uint8Array(await res.arrayBuffer()),
    };
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError(`Fetch timeout after ${options.timeoutMs ?? FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function shouldFallbackToXhr(options: RequestOptions, err: unknown): boolean {
  if (err instanceof RequestTimeoutError) return false;
  if ((options.method ?? 'GET') === 'POST') return options.retryOnFetchFailure === true;
  return true;
}

// Low-level request: routes large bodies straight to XHR; otherwise fetch with XHR fallback.
export async function request(url: string, options: RequestOptions = {}): Promise<NetworkResponse> {
  if (options.signal?.aborted) throw new CancelledError();

  const size = bodySize(options.body);
  if (size > FETCH_BYPASS_THRESHOLD_BYTES) {
    return await xhrRequest(url, options);
  }

  try {
    return await fetchRequest(url, options);
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    if (options.signal?.aborted) throw new CancelledError();
    if (!shouldFallbackToXhr(options, err)) throw err;
    return await xhrRequest(url, options);
  }
}

function truncate(s: string, max = 500): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Wraps request() and converts non-2xx responses into typed provider errors.
export async function checkedRequest<T = unknown>(
  url: string,
  options: RequestOptions,
  providerId: ProviderId,
): Promise<T> {
  const res = await request(url, options);
  if (res.ok) {
    return await res.json<T>();
  }

  let bodyPreview = '';
  try {
    bodyPreview = truncate(await res.text());
  } catch {
    /* ignore body read failures */
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(providerId, res.status, bodyPreview);
  }
  if (res.status === 429) {
    throw new RateLimitError(providerId, res.status, bodyPreview);
  }
  if (res.status === 422 || res.status === 451) {
    throw new ContentPolicyError(providerId, res.status, bodyPreview);
  }
  throw new ProviderError(
    `Request failed: ${res.status} ${res.statusText}`,
    providerId,
    res.status,
    bodyPreview,
  );
}

// Downloads a binary resource (e.g., a generated image URL) as raw bytes.
export async function fetchBytes(url: string, options: RequestOptions = {}): Promise<Uint8Array> {
  const res = await request(url, { ...options, method: 'GET' });
  if (!res.ok) {
    throw new Error(`fetchBytes failed: ${res.status} ${res.statusText} ${url}`);
  }
  return await res.bytes();
}
