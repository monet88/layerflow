import { useRef, useState } from 'react';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import { MainDialog } from './components/main-dialog';
import { SettingsDialog } from './components/settings-dialog';
import { ProgressDialog } from './components/progress-dialog';
import type { ActiveDialog, MainDialogState } from './types/ui-state';
import {
  isGenerationInFlight,
  PlacementError,
  ProgressUpdate,
  runGenerate,
  runInpaint,
} from './services/generation-service';
import { getModelDefinition } from './providers/model-registry';
import './styles/global.css';

export function App() {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>('main');
  const [mode] = useState<'generate' | 'inpaint'>('generate');
  const [progressMessage, setProgressMessage] = useState('Generating...');
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const dispatch = async (state: MainDialogState, signal: AbortSignal): Promise<void> => {
    const onProgress = (update: ProgressUpdate): void => {
      setProgressMessage(update.message);
      if (update.stage === 'done') setActiveDialog(null);
    };
    const def = getModelDefinition(state.selectedModel);
    const wantsInpaint = mode === 'inpaint' || !def.capabilities.includes('generate');
    const referenceImages = state.referenceImages.map((img) => img.bytes);
    if (wantsInpaint) {
      await runInpaint({
        prompt: state.prompt,
        model: state.selectedModel,
        referenceImages,
        onProgress,
        signal,
      });
    } else {
      await runGenerate({
        prompt: state.prompt,
        model: state.selectedModel,
        referenceImages,
        onProgress,
        signal,
      });
    }
  };

  const handleGenerate = async (state: MainDialogState): Promise<void> => {
    setError(null);
    if (isGenerationInFlight()) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setProgressMessage('Preparing...');
    setActiveDialog('progress');

    try {
      await dispatch(state, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        setActiveDialog('main');
        return;
      }
      const message =
        err instanceof PlacementError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
      setActiveDialog('main');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleCancelProgress = (): void => {
    abortControllerRef.current?.abort();
    setActiveDialog('main');
  };

  return (
    <sp-theme scale="medium" color="dark">
      {activeDialog === 'main' && (
        <MainDialog
          mode={mode}
          error={error}
          onDismissError={() => setError(null)}
          onGenerate={handleGenerate}
          onSettings={() => setActiveDialog('settings')}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === 'settings' && <SettingsDialog onClose={() => setActiveDialog('main')} />}
      {activeDialog === 'progress' && (
        <ProgressDialog message={progressMessage} onCancel={handleCancelProgress} />
      )}
      {activeDialog === null && (
        <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
          Use Plugins → InpaintKit → Generate or Inpaint
        </div>
      )}
    </sp-theme>
  );
}
