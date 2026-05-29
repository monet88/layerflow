// Encrypted credential storage backed by UXP secureStorage (per-plugin isolated keychain).
// Stores raw API keys; UI normalizes empty strings to undefined.

import { storage } from 'uxp';
import type { StoredChatGptTokens } from '../auth/oauth-types';
import { ProviderCredentials } from '../providers/provider-interface';

const KEYS = {
  FALAI: 'inpaintkit.credentials.falai',
  REPLICATE: 'inpaintkit.credentials.replicate',
  CHATGPT_BACKEND_URL: 'inpaintkit.credentials.chatgpt-backend-url',
  CHATGPT_BACKEND_API_KEY: 'inpaintkit.credentials.chatgpt-backend-api-key',
  CHATGPT_TOKENS: 'inpaintkit.credentials.chatgpt-tokens',
} as const;

const CREDENTIAL_KEYS = ['FALAI', 'REPLICATE', 'CHATGPT_BACKEND_URL', 'CHATGPT_BACKEND_API_KEY'] as const;

type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readKey(key: string): Promise<string | undefined> {
  try {
    const buffer = await storage.secureStorage.getItem(key);
    if (!buffer) return undefined;
    if (typeof buffer === 'string') return buffer;
    return decoder.decode(buffer);
  } catch {
    return undefined;
  }
}

async function writeKey(key: string, value: string): Promise<void> {
  await storage.secureStorage.setItem(key, encoder.encode(value));
}

async function deleteKey(key: string): Promise<void> {
  try {
    await storage.secureStorage.removeItem(key);
  } catch {
    /* ignore — already absent */
  }
}

export async function loadCredentials(): Promise<ProviderCredentials> {
  const [falai, replicate, chatgptBackendUrl, chatgptBackendApiKey] = await Promise.all([
    readKey(KEYS.FALAI),
    readKey(KEYS.REPLICATE),
    readKey(KEYS.CHATGPT_BACKEND_URL),
    readKey(KEYS.CHATGPT_BACKEND_API_KEY),
  ]);
  return { falai, replicate, chatgptBackendUrl, chatgptBackendApiKey };
}

function isStoredChatGptTokens(value: unknown): value is StoredChatGptTokens {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.expiresAt === 'number'
  );
}

export async function getChatGPTTokens(): Promise<StoredChatGptTokens | undefined> {
  const raw = await readKey(KEYS.CHATGPT_TOKENS);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStoredChatGptTokens(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function setChatGPTTokens(tokens: StoredChatGptTokens): Promise<void> {
  await writeKey(KEYS.CHATGPT_TOKENS, JSON.stringify(tokens));
}

export async function clearChatGPTTokens(): Promise<void> {
  await deleteKey(KEYS.CHATGPT_TOKENS);
}

export async function saveCredential(name: CredentialKey, value: string): Promise<void> {
  if (value === '') {
    await deleteKey(KEYS[name]);
    return;
  }
  await writeKey(KEYS[name], value);
}

export async function clearCredential(name: CredentialKey): Promise<void> {
  await deleteKey(KEYS[name]);
}

export async function clearAllCredentials(): Promise<void> {
  await Promise.all(
    (Object.keys(KEYS) as (keyof typeof KEYS)[]).map((key) => deleteKey(KEYS[key])),
  );
}
