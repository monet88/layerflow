export type ActiveDialog = 'main' | 'settings' | 'progress' | null;
export type ProviderId = 'falai' | 'replicate' | 'chatgpt-backend';

export interface MainDialogState {
  prompt: string;
  recentPrompts: string[];
  selectedModel: string;
  referenceImagePaths: string[];
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
