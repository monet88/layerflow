import { useCallback, useEffect, useState } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/button/sp-button.js';
import type { StoredChatGptTokens } from '../auth/oauth-types';
import { normalizeBackendUrl, SUPPORTED_BACKEND_ORIGINS } from '../auth/backend-url';
import { disconnectChatGpt, getChatGptConnectionStatus } from '../auth/token-manager';
import { useSpEvent } from '../hooks/use-sp-event';
import { ChatGptLoginModal } from './chatgpt-login-modal';
import { ConnectionStatus } from './connection-status';
import { ChatGPTBackendProvider } from '../providers/backend-provider';
import type { ProviderId } from '../providers/provider-interface';
import { saveCredential, loadCredentials } from '../storage/secure-storage';
import { getUserPreferences, saveUserPreferences } from '../storage/settings-storage';

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

type ChatGptStatus = Awaited<ReturnType<typeof getChatGptConnectionStatus>>;

interface SettingsDialogProps {
  onClose: () => void;
}

function defaultProviderFromCredentials(
  preferred: ProviderId | undefined,
  credentials: Awaited<ReturnType<typeof loadCredentials>>,
): ProviderId {
  if (preferred) return preferred;
  if (credentials.chatgptBackendUrl || credentials.chatgptBackendApiKey) {
    return 'chatgpt-backend';
  }
  if (credentials.replicate) return 'replicate';
  return 'falai';
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>('falai');
  const [falaiApiKey, setFalaiApiKey] = useState('');
  const [replicateApiKey, setReplicateApiKey] = useState('');
  const [chatgptBackendUrl, setChatgptBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [chatgptBackendApiKey, setChatgptBackendApiKey] = useState('');
  const [chatGptStatus, setChatGptStatus] = useState<ChatGptStatus>({ state: 'disconnected' });

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [credentials, preferences, status] = await Promise.all([
          loadCredentials(),
          Promise.resolve(getUserPreferences()),
          getChatGptConnectionStatus(),
        ]);
        if (!active) return;
        setFalaiApiKey(credentials.falai ?? '');
        setReplicateApiKey(credentials.replicate ?? '');
        setChatgptBackendUrl(credentials.chatgptBackendUrl ?? DEFAULT_BACKEND_URL);
        setChatgptBackendApiKey(credentials.chatgptBackendApiKey ?? '');
        setProvider(defaultProviderFromCredentials(preferences.lastProvider, credentials));
        setChatGptStatus(status);
      } catch (error) {
        if (!active) return;
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const handleProviderChange = useCallback((event: Event) => {
    setProvider((event.target as HTMLElement & { value: string }).value as ProviderId);
    setError(null);
  }, []);
  const providerRef = useSpEvent<EventTarget>('change', handleProviderChange);

  const falaiKeyRef = useSpEvent<EventTarget>('input', useCallback((event: Event) => {
    setFalaiApiKey((event.target as HTMLInputElement).value);
  }, []));
  const replicateKeyRef = useSpEvent<EventTarget>('input', useCallback((event: Event) => {
    setReplicateApiKey((event.target as HTMLInputElement).value);
  }, []));
  const backendUrlRef = useSpEvent<EventTarget>('input', useCallback((event: Event) => {
    setChatgptBackendUrl((event.target as HTMLInputElement).value);
  }, []));
  const backendApiKeyRef = useSpEvent<EventTarget>('input', useCallback((event: Event) => {
    setChatgptBackendApiKey((event.target as HTMLInputElement).value);
  }, []));

  const validateChatGptSettings = useCallback((): string => {
    const apiKey = chatgptBackendApiKey.trim();
    if (!apiKey) {
      throw new Error('ChatGPT backend API key is required.');
    }
    return normalizeBackendUrl(chatgptBackendUrl);
  }, [chatgptBackendApiKey, chatgptBackendUrl]);

  const saveAllCredentials = useCallback(async (): Promise<void> => {
    await Promise.all([
      saveCredential('FALAI', falaiApiKey.trim()),
      saveCredential('REPLICATE', replicateApiKey.trim()),
      saveCredential('CHATGPT_BACKEND_URL', chatgptBackendUrl.trim()),
      saveCredential('CHATGPT_BACKEND_API_KEY', chatgptBackendApiKey.trim()),
    ]);
    saveUserPreferences({ lastProvider: provider });
  }, [chatgptBackendApiKey, chatgptBackendUrl, falaiApiKey, provider, replicateApiKey]);

  const handleSave = useCallback(async (): Promise<void> => {
    setIsSaving(true);
    setError(null);
    try {
      if (provider === 'chatgpt-backend') {
        validateChatGptSettings();
      } else if (chatgptBackendUrl.trim()) {
        normalizeBackendUrl(chatgptBackendUrl);
      }
      await saveAllCredentials();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [onClose, provider, saveAllCredentials, validateChatGptSettings]);

  const handleAuthorized = useCallback(
    async (tokens: StoredChatGptTokens): Promise<void> => {
      const backendUrl = validateChatGptSettings();
      const apiKey = chatgptBackendApiKey.trim();
      await Promise.all([
        saveCredential('CHATGPT_BACKEND_URL', backendUrl),
        saveCredential('CHATGPT_BACKEND_API_KEY', apiKey),
      ]);
      saveUserPreferences({ lastProvider: 'chatgpt-backend' });
      const backendProvider = new ChatGPTBackendProvider({ backendUrl, apiKey });
      await backendProvider.registerSession(tokens);
      setChatGptStatus(await getChatGptConnectionStatus());
      setError(null);
    },
    [chatgptBackendApiKey, validateChatGptSettings],
  );

  const handleDisconnect = useCallback(async (): Promise<void> => {
    await disconnectChatGpt();
    setChatGptStatus({ state: 'disconnected' });
    setError(null);
  }, []);

  const handleOpenLogin = useCallback((): void => {
    try {
      validateChatGptSettings();
      setError(null);
      setShowLogin(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [validateChatGptSettings]);

  const busy = isLoading || isSaving;

  return (
    <div className="dialog-container" style={{ position: 'relative' }}>
      <h3 style={{ margin: 0, color: '#fff', fontSize: 14 }}>Settings</h3>

      <div>
        <div className="section-label">Provider</div>
        <sp-picker
          ref={providerRef as React.Ref<HTMLElement>}
          value={provider}
          disabled={busy}
          style={{ width: '100%' }}
        >
          <sp-menu>
            <sp-menu-item value="falai">fal.ai (API Key)</sp-menu-item>
            <sp-menu-item value="replicate">Replicate (API Key)</sp-menu-item>
            <sp-menu-item value="chatgpt-backend">ChatGPT Subscription (Backend)</sp-menu-item>
          </sp-menu>
        </sp-picker>
      </div>

      {provider === 'falai' && (
        <div>
          <div className="section-label">fal.ai API Key</div>
          <sp-textfield
            ref={falaiKeyRef as React.Ref<HTMLElement>}
            value={falaiApiKey}
            type="password"
            placeholder="fal_..."
            style={{ width: '100%' }}
          ></sp-textfield>
        </div>
      )}

      {provider === 'replicate' && (
        <div>
          <div className="section-label">Replicate API Key</div>
          <sp-textfield
            ref={replicateKeyRef as React.Ref<HTMLElement>}
            value={replicateApiKey}
            type="password"
            placeholder="r8_..."
            style={{ width: '100%' }}
          ></sp-textfield>
        </div>
      )}

      {provider === 'chatgpt-backend' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className="section-label">Backend URL</div>
            <sp-textfield
              ref={backendUrlRef as React.Ref<HTMLElement>}
              value={chatgptBackendUrl}
              placeholder={DEFAULT_BACKEND_URL}
              style={{ width: '100%' }}
            ></sp-textfield>
          </div>
          <div>
            <div className="section-label">Backend API Key</div>
            <sp-textfield
              ref={backendApiKeyRef as React.Ref<HTMLElement>}
              value={chatgptBackendApiKey}
              type="password"
              placeholder="sk_..."
              style={{ width: '100%' }}
            ></sp-textfield>
          </div>
          <p style={{ fontSize: 11, color: '#aaa', margin: 0 }}>
            ChatGPT images are sent to your backend as uploaded files. Allowed origins:{' '}
            {SUPPORTED_BACKEND_ORIGINS.join(', ')}.
          </p>
          <ConnectionStatus
            status={chatGptStatus}
            busy={busy}
            onSignIn={handleOpenLogin}
            onDisconnect={() => void handleDisconnect()}
          />
        </div>
      )}

      {isLoading && <div style={{ fontSize: 12, color: '#9e9e9e' }}>Loading settings…</div>}
      {error && <div style={{ fontSize: 12, color: '#ef5350' }}>{error}</div>}

      <div className="button-row">
        <sp-button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </sp-button>
        <sp-button variant="cta" disabled={busy} onClick={() => void handleSave()}>
          Save
        </sp-button>
      </div>

      {showLogin && (
        <ChatGptLoginModal
          onClose={() => setShowLogin(false)}
          onAuthorized={handleAuthorized}
        />
      )}
    </div>
  );
}
