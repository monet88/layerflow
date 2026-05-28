import {
  AUTH_BASE_URL,
  CODEX_CLIENT_ID,
  DEVICE_AUTH_INTERVAL_PADDING_SECONDS,
  DEVICE_AUTH_MIN_POLL_SECONDS,
  DEVICE_AUTH_TOKEN_URL,
  DEVICE_AUTH_USERCODE_URL,
  DEVICE_REDIRECT_URI,
  DEVICE_VERIFICATION_URL,
  OAUTH_TOKEN_URL,
  REFRESH_SCOPE,
} from '../constants/oauth';
import { CancelledError } from '../providers/provider-interface';
import { request } from '../services/network-client';
import {
  DeviceAuthGrant,
  DeviceAuthSession,
  DeviceAuthStartResponse,
  OAuthTokenResponse,
} from './oauth-types';

export class DeviceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

function getMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  if (typeof record.error_description === 'string' && record.error_description) {
    return record.error_description;
  }
  if (typeof record.message === 'string' && record.message) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error) {
    return record.error;
  }
  return fallback;
}

function getJsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

function normalizePollMs(intervalSeconds?: number): number {
  const padded = (intervalSeconds ?? 5) + DEVICE_AUTH_INTERVAL_PADDING_SECONDS;
  return Math.max(padded, DEVICE_AUTH_MIN_POLL_SECONDS) * 1000;
}

async function parseJson(res: Awaited<ReturnType<typeof request>>): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function startDeviceAuth(signal?: AbortSignal): Promise<DeviceAuthSession> {
  const res = await request(DEVICE_AUTH_USERCODE_URL, {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    signal,
  });
  const raw = (await parseJson(res)) as DeviceAuthStartResponse | undefined;
  if (!res.ok) {
    throw new DeviceAuthError(getMessage(raw, 'Could not start ChatGPT device authorization.'));
  }

  const deviceAuthId = raw?.device_auth_id ?? raw?.device_code;
  const userCode = raw?.user_code;
  if (!deviceAuthId || !userCode) {
    throw new DeviceAuthError('ChatGPT authorization response was missing the device code.');
  }

  return {
    deviceAuthId,
    userCode,
    verificationUri:
      raw?.verification_uri_complete ?? raw?.verification_uri ?? DEVICE_VERIFICATION_URL,
    expiresAt: Date.now() + (raw?.expires_in ?? 900) * 1000,
    pollIntervalMs: normalizePollMs(raw?.interval),
  };
}

export async function pollForAuthorizationCode(
  session: DeviceAuthSession,
  signal?: AbortSignal,
): Promise<DeviceAuthGrant> {
  let pollIntervalMs = session.pollIntervalMs;

  while (Date.now() < session.expiresAt) {
    const res = await request(DEVICE_AUTH_TOKEN_URL, {
      method: 'POST',
      headers: getJsonHeaders(),
      body: JSON.stringify({
        device_auth_id: session.deviceAuthId,
        user_code: session.userCode,
      }),
      signal,
    });
    const raw = (await parseJson(res)) as DeviceAuthGrant | undefined;

    if (res.ok) {
      if (raw?.authorization_code && raw.code_verifier) {
        return raw;
      }
      throw new DeviceAuthError('ChatGPT authorization completed but no code was returned.');
    }

    if (raw?.error === 'slow_down' || res.status === 429) {
      pollIntervalMs += 5000;
      await delay(pollIntervalMs, signal);
      continue;
    }
    if (res.status === 403 || res.status === 404 || raw?.error === 'authorization_pending') {
      await delay(pollIntervalMs, signal);
      continue;
    }
    if (res.status === 410 || raw?.error === 'expired_token') {
      throw new DeviceAuthError('The ChatGPT device code expired. Start again.');
    }
    if (res.status === 401 || raw?.error === 'access_denied') {
      throw new DeviceAuthError('ChatGPT authorization was denied.');
    }

    throw new DeviceAuthError(getMessage(raw, 'ChatGPT authorization failed.'));
  }

  throw new DeviceAuthError('The ChatGPT device code expired. Start again.');
}

async function exchangeForm(
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<OAuthTokenResponse> {
  const res = await request(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });
  const raw = (await parseJson(res)) as OAuthTokenResponse | undefined;
  if (!res.ok || !raw?.access_token) {
    throw new DeviceAuthError(getMessage(raw, 'ChatGPT token exchange failed.'));
  }
  return raw;
}

export async function exchangeAuthorizationCode(
  grant: DeviceAuthGrant,
  signal?: AbortSignal,
): Promise<OAuthTokenResponse> {
  if (!grant.authorization_code || !grant.code_verifier) {
    throw new DeviceAuthError('ChatGPT authorization code exchange is missing required fields.');
  }

  return await exchangeForm(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: grant.authorization_code,
      redirect_uri: DEVICE_REDIRECT_URI,
      client_id: CODEX_CLIENT_ID,
      code_verifier: grant.code_verifier,
    }),
    signal,
  );
}

export async function refreshAccessToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<OAuthTokenResponse> {
  if (!refreshToken) {
    throw new DeviceAuthError('Missing ChatGPT refresh token.');
  }

  return await exchangeForm(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: REFRESH_SCOPE,
    }),
    signal,
  );
}

export function getDeviceAuthHelpUrl(): string {
  return `${AUTH_BASE_URL}/codex/device`;
}
