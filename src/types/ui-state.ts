import type { RecentPrompt } from '../storage/settings-storage';

export type ActiveDialog = 'main' | 'settings' | 'progress' | null;
export type ProviderId = 'falai' | 'replicate' | 'chatgpt-backend';

// A reference image picked from disk: filename for display + raw PNG/JPG bytes for upload.
export interface ReferenceImage {
  name: string;
  bytes: Uint8Array;
}

export interface MainDialogState {
  prompt: string;
  recentPrompts: RecentPrompt[];
  selectedModel: string;
  referenceImages: ReferenceImage[];
}

export interface SettingsState {
  provider: ProviderId;
  falaiApiKey: string;
  replicateApiKey: string;
  chatgptBackendUrl: string;
  chatgptBackendApiKey: string;
  chatgptOAuthStatus: 'disconnected' | 'pending' | 'connected';
}

export interface ProgressState {
  message: string;
  canCancel: boolean;
}
