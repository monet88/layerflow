import { useState } from 'react';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import { MainDialog } from './components/main-dialog';
import { SettingsDialog } from './components/settings-dialog';
import { ProgressDialog } from './components/progress-dialog';
import type { ActiveDialog, MainDialogState, ProviderId } from './types/ui-state';
import './styles/global.css';

export function App() {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>('main');
  const [mode] = useState<'generate' | 'inpaint'>('generate');
  const [progressMessage, setProgressMessage] = useState('Generating...');

  const handleGenerate = (state: MainDialogState) => {
    console.log('Generate triggered:', state);
    setProgressMessage('Uploading...');
    setActiveDialog('progress');
  };

  const handleSaveSettings = (provider: ProviderId, key: string) => {
    console.log('Save settings:', provider, key ? '[key present]' : '[no key]');
    setActiveDialog('main');
  };

  return (
    <sp-theme scale="medium" color="dark">
      {activeDialog === 'main' && (
        <MainDialog
          mode={mode}
          onGenerate={handleGenerate}
          onSettings={() => setActiveDialog('settings')}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === 'settings' && (
        <SettingsDialog
          onClose={() => setActiveDialog('main')}
          onSave={handleSaveSettings}
        />
      )}
      {activeDialog === 'progress' && (
        <ProgressDialog
          message={progressMessage}
          onCancel={() => setActiveDialog('main')}
        />
      )}
      {activeDialog === null && (
        <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
          Use Plugins → InpaintKit → Generate or Inpaint
        </div>
      )}
    </sp-theme>
  );
}
