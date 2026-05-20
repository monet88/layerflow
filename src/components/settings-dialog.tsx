import { useState, useCallback } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/button/sp-button.js';
import type { ProviderId } from '../types/ui-state';
import { useSpEvent } from '../hooks/use-sp-event';

interface SettingsDialogProps {
  onClose: () => void;
  onSave: (provider: ProviderId, key: string) => void;
}

export function SettingsDialog({ onClose, onSave }: SettingsDialogProps) {
  const [provider, setProvider] = useState<ProviderId>('falai');
  const [apiKey, setApiKey] = useState('');
  const [oauthStatus, setOauthStatus] =
    useState<'disconnected' | 'pending' | 'connected'>('disconnected');

  const handleProviderChange = useCallback((e: Event) => {
    setProvider((e.target as HTMLElement & { value: string }).value as ProviderId);
  }, []);
  const pickerRef = useSpEvent<EventTarget>('change', handleProviderChange);

  const handleKeyInput = useCallback((e: Event) => {
    setApiKey((e.target as HTMLInputElement).value);
  }, []);
  const keyRef = useSpEvent<EventTarget>('input', handleKeyInput);

  return (
    <div className="dialog-container">
      <h3 style={{ margin: 0, color: '#fff', fontSize: 14 }}>Settings</h3>

      <div>
        <div className="section-label">Provider</div>
        <sp-picker
          ref={pickerRef as React.Ref<HTMLElement>}
          value={provider}
          style={{ width: '100%' }}
        >
          <sp-menu>
            <sp-menu-item value="falai">fal.ai (API Key)</sp-menu-item>
            <sp-menu-item value="replicate">Replicate (API Key)</sp-menu-item>
            <sp-menu-item value="chatgpt-backend">
              ChatGPT Subscription (Backend + OAuth)
            </sp-menu-item>
          </sp-menu>
        </sp-picker>
      </div>

      {(provider === 'falai' || provider === 'replicate') && (
        <div key={provider}>
          <div className="section-label">
            {provider === 'falai' ? 'fal.ai API Key' : 'Replicate API Key'}
          </div>
          <sp-textfield
            ref={keyRef as React.Ref<HTMLElement>}
            value={apiKey}
            type="password"
            placeholder={provider === 'falai' ? 'fal_...' : 'r8_...'}
            style={{ width: '100%' }}
          ></sp-textfield>
        </div>
      )}

      {provider === 'chatgpt-backend' && (
        <div>
          <div className="section-label">ChatGPT Backend</div>
          <p style={{ fontSize: 11, color: '#aaa', margin: '4px 0 8px' }}>
            Routes through your ChatGPT2API backend, which uses your ChatGPT Plus/Pro session.
            Unofficial — may break without notice.
          </p>
          {oauthStatus === 'disconnected' && (
            <sp-button variant="secondary" onClick={() => setOauthStatus('pending')}>
              Connect ChatGPT Account
            </sp-button>
          )}
          {oauthStatus === 'pending' && (
            <p style={{ color: '#ffa726', fontSize: 12 }}>Waiting for authorization…</p>
          )}
          {oauthStatus === 'connected' && (
            <>
              <p style={{ color: '#4caf50', fontSize: 12 }}>Connected</p>
              <sp-button variant="secondary" onClick={() => setOauthStatus('disconnected')}>
                Disconnect
              </sp-button>
            </>
          )}
        </div>
      )}

      <div className="button-row">
        <sp-button variant="secondary" onClick={onClose}>
          Cancel
        </sp-button>
        <sp-button variant="cta" onClick={() => onSave(provider, apiKey)}>
          Save
        </sp-button>
      </div>
    </div>
  );
}
