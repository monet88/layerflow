import { refreshAccessToken } from './codex-device-code';
import type { OAuthTokenResponse, StoredChatGptTokens } from './oauth-types';
import {
  clearChatGPTTokens,
  getChatGPTTokens,
  setChatGPTTokens,
} from '../storage/secure-storage';

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return atob(padded);
}

function parseJwtPayload(token?: string): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sanitizeUserId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (USER_ID_PATTERN.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) return undefined;
  const limited = normalized.slice(0, 64);
  return USER_ID_PATTERN.test(limited) ? limited : undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = sanitizeUserId(value);
    if (candidate) return candidate;
  }
  return undefined;
}

function extractUserIdFromClaims(claims?: Record<string, unknown>): string | undefined {
  if (!claims) return undefined;

  const orgs = Array.isArray(claims.organizations) ? claims.organizations : [];
  const orgIds = orgs
    .map((org) => {
      if (typeof org !== 'object' || org === null) return undefined;
      const record = org as Record<string, unknown>;
      return record.id;
    })
    .filter(Boolean);

  return firstString([
    claims.chatgpt_account_id,
    claims.account_id,
    claims.user_id,
    claims.sub,
    claims.organization_id,
    claims.org_id,
    ...orgIds,
  ]);
}

function normalizeTokenResponse(
  response: OAuthTokenResponse,
  fallback?: Partial<StoredChatGptTokens>,
): StoredChatGptTokens {
  const accessToken = response.access_token?.trim();
  const refreshToken = response.refresh_token?.trim() ?? fallback?.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new TokenExpiredError('ChatGPT token response was incomplete. Sign in again.');
  }

  const userId =
    extractUserIdFromClaims(parseJwtPayload(response.id_token)) ??
    extractUserIdFromClaims(parseJwtPayload(accessToken)) ??
    fallback?.userId;
  if (!userId) {
    throw new TokenExpiredError('Could not determine the ChatGPT account id. Sign in again.');
  }

  return {
    accessToken,
    refreshToken,
    userId,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  };
}

export async function storeChatGptTokens(
  response: OAuthTokenResponse,
  fallback?: Partial<StoredChatGptTokens>,
): Promise<StoredChatGptTokens> {
  const normalized = normalizeTokenResponse(response, fallback);
  await setChatGPTTokens(normalized);
  return normalized;
}

export async function getStoredChatGptTokens(): Promise<StoredChatGptTokens | undefined> {
  return await getChatGPTTokens();
}

export async function getValidToken(): Promise<StoredChatGptTokens> {
  const stored = await getChatGPTTokens();
  if (!stored) {
    throw new TokenExpiredError('ChatGPT is not connected. Open Settings and sign in.');
  }
  if (stored.expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return stored;
  }

  try {
    const refreshed = await refreshAccessToken(stored.refreshToken);
    return await storeChatGptTokens(refreshed, stored);
  } catch {
    await clearChatGPTTokens();
    throw new TokenExpiredError('ChatGPT session expired. Open Settings and sign in again.');
  }
}

export async function disconnectChatGpt(): Promise<void> {
  await clearChatGPTTokens();
}

export async function getChatGptConnectionStatus(): Promise<{
  state: 'disconnected' | 'connected' | 'expired';
  expiresAt?: number;
  userId?: string;
}> {
  const stored = await getChatGPTTokens();
  if (!stored) {
    return { state: 'disconnected' };
  }
  if (stored.expiresAt <= Date.now()) {
    return { state: 'expired', expiresAt: stored.expiresAt, userId: stored.userId };
  }
  return { state: 'connected', expiresAt: stored.expiresAt, userId: stored.userId };
}
