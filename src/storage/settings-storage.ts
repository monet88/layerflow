// Lightweight non-secret prefs (recent prompts, last selected model, last provider) backed
// by localStorage. Encryption is unnecessary; this data is ephemeral UX convenience only.
// Session 7 confirmed localStorage as the chosen storage backend.

import { ProviderId } from '../providers/provider-interface';

const KEYS = {
  RECENT_PROMPTS: 'inpaintkit.recent-prompts',
  PREFERENCES: 'inpaintkit.preferences',
} as const;

const RECENT_PROMPTS_LIMIT = 20;

export interface RecentPrompt {
  prompt: string;
  model: string;
  ts: number;
}

export interface UserPreferences {
  lastProvider?: ProviderId;
  lastModel?: string;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getRecentPrompts(): RecentPrompt[] {
  const raw = localStorage.getItem(KEYS.RECENT_PROMPTS);
  const parsed = safeParse<RecentPrompt[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveRecentPrompt(prompt: string, model: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const existing = getRecentPrompts().filter(
    (entry) => !(entry.prompt === trimmed && entry.model === model),
  );
  const next: RecentPrompt[] = [{ prompt: trimmed, model, ts: Date.now() }, ...existing].slice(
    0,
    RECENT_PROMPTS_LIMIT,
  );
  localStorage.setItem(KEYS.RECENT_PROMPTS, JSON.stringify(next));
}

export function clearRecentPrompts(): void {
  localStorage.removeItem(KEYS.RECENT_PROMPTS);
}

export function getUserPreferences(): UserPreferences {
  const raw = localStorage.getItem(KEYS.PREFERENCES);
  return safeParse<UserPreferences>(raw, {});
}

export function saveUserPreferences(next: Readonly<UserPreferences>): void {
  const merged: UserPreferences = { ...getUserPreferences(), ...next };
  localStorage.setItem(KEYS.PREFERENCES, JSON.stringify(merged));
}
