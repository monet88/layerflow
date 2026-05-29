import { useRef, useState } from 'react';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import { MainDialog } from './components/main-dialog';
import { SettingsDialog } from './components/settings-dialog';
import { ProgressDialog } from './components/progress-dialog';
import type { ActiveDialog, GenerationMode, MainDialogState } from './types/ui-state';
import {
  isGenerationInFlight,
  PlacementError,
  type PlacementErrorPayload,
  ProgressUpdate,
  retryPlacement,
  runGenerate,
  runInpaint,
} from './services/generation-service';
import './styles/global.css';

export function App() {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>('main');
  const [mode, setMode] = useState<GenerationMode>('generate');
  const [progress, setProgress] = useState<ProgressUpdate>({
    stage: 'preparing',
    percent: 0,
    message: 'Preparing...',
  });
  const [error, setError] = useState<string | null>(null);
  const [placementRecovery, setPlacementRecovery] = useState<PlacementErrorPayload | null>(null);
  const [isRetryingPlacement, setIsRetryingPlacement] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const dispatch = async (state: MainDialogState, signal: AbortSignal): Promise<void> => {
    const onProgress = (update: ProgressUpdate): void => {
      setProgress(update);
      if (update.stage === 'done') setActiveDialog(null);
    };
    const referenceImages = state.referenceImages.map((img) => img.bytes);
    if (mode === 'inpaint') {
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
    setPlacementRecovery(null);
    if (isGenerationInFlight()) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setProgress({ stage: 'preparing', percent: 0, message: 'Preparing...' });
    setActiveDialog('progress');

    try {
      await dispatch(state, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        setActiveDialog('main');
        return;
      }
      if (err instanceof PlacementError) {
        setPlacementRecovery({
          cachedBytes: err.cachedBytes,
          placementOptions: err.placementOptions,
        });
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
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

  const handleRetryPlacement = async (): Promise<void> => {
    if (!placementRecovery || isRetryingPlacement) return;
    setIsRetryingPlacement(true);
    setError(null);
    setProgress({ stage: 'placing', percent: 90, message: 'Retrying Photoshop placement only...' });
    setActiveDialog('progress');
    try {
      await retryPlacement(placementRecovery);
      setPlacementRecovery(null);
      setProgress({ stage: 'done', percent: 100, message: 'Done' });
      setActiveDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setActiveDialog('main');
    } finally {
      setIsRetryingPlacement(false);
    }
  };

  return (
    <sp-theme scale="medium" color="dark">
      {activeDialog === 'main' && (
        <MainDialog
          mode={mode}
          error={error}
          onModeChange={setMode}
          onDismissError={() => setError(null)}
          onRetryPlacement={placementRecovery ? () => void handleRetryPlacement() : undefined}
          onGenerate={handleGenerate}
          onSettings={() => setActiveDialog('settings')}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === 'settings' && <SettingsDialog onClose={() => setActiveDialog('main')} />}
      {activeDialog === 'progress' && (
        <ProgressDialog
          mode={mode}
          progress={progress}
          canCancel={!isRetryingPlacement}
          isPlacementRetry={isRetryingPlacement}
          onCancel={handleCancelProgress}
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
