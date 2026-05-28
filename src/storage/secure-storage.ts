// Encrypted credential storage backed by UXP secureStorage (per-plugin isolated keychain).
// Stores raw API keys; UI normalizes empty strings to undefined.

import { storage } from 'uxp';
import { ProviderCredentials } from '../providers/provider-interface';

const KEYS = {
  FALAI: 'inpaintkit.credentials.falai',
  REPLICATE: 'inpaintkit.credentials.replicate',
  CHATGPT_BACKEND_URL: 'inpaintkit.credentials.chatgpt-backend-url',
  CHATGPT_BACKEND_API_KEY: 'inpaintkit.credentials.chatgpt-backend-api-key',
} as const;

type CredentialKey = keyof typeof KEYS;

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
  await Promise.all((Object.keys(KEYS) as CredentialKey[]).map((k) => clearCredential(k)));
}
