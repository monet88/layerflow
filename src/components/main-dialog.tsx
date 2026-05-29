import { useEffect, useState } from 'react';
import { storage } from 'uxp';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/divider/sp-divider.js';
import { ModelSelector, type ModelValue } from './model-selector';
import { PromptInput } from './prompt-input';
import { ReferenceImages } from './reference-images';
import { getModelDefinition, listModels } from '../providers/model-registry';
import type { GenerationMode, MainDialogState, ReferenceImage } from '../types/ui-state';
import { getRecentPrompts, type RecentPrompt } from '../storage/settings-storage';

const REFERENCE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

interface MainDialogProps {
  mode: GenerationMode;
  error?: string | null;
  onModeChange: (mode: GenerationMode) => void;
  onDismissError?: () => void;
  onRetryPlacement?: () => void;
  onGenerate: (state: MainDialogState) => void;
  onSettings: () => void;
  onCancel: () => void;
}

export function MainDialog({
  mode,
  error,
  onModeChange,
  onDismissError,
  onRetryPlacement,
  onGenerate,
  onSettings,
  onCancel,
}: MainDialogProps) {
  const [model, setModel] = useState<ModelValue>('flux-fill-pro');
  const [prompt, setPrompt] = useState('');
  const [recentPrompts, setRecentPrompts] = useState<RecentPrompt[]>([]);
  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);

  const selectedModel = getModelDefinition(model);
  const canRunSelectedMode = selectedModel.capabilities.includes(mode);
  const actionLabel = mode === 'generate' ? 'Generate' : 'Inpaint Selection';

  useEffect(() => {
    setRecentPrompts(getRecentPrompts());
  }, []);

  useEffect(() => {
    if (canRunSelectedMode) return;
    const nextModel = listModels().find((item) => item.capabilities.includes(mode));
    if (nextModel) setModel(nextModel.id);
  }, [canRunSelectedMode, mode]);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    onGenerate({
      prompt,
      recentPrompts,
      selectedModel: model,
      referenceImages: refImages,
    });
  };

  const handleAddReference = async () => {
    try {
      const fs = storage.localFileSystem;
      const file = await fs.getFileForOpening({ types: REFERENCE_IMAGE_EXTS });
      if (!file || Array.isArray(file)) return;
      const data = await file.read({ format: fs.formats.binary });
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      setRefImages((prev) => [...prev, { name: file.name, bytes }]);
    } catch (err) {
      console.warn('InpaintKit: reference image picker failed', err);
    }
  };

  return (
    <div className="dialog-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0, color: '#fff', fontSize: 14 }}>
          {mode === 'generate' ? 'Generate Image' : 'Inpaint Selection'}
        </h3>
        <sp-action-button size="s" onClick={onSettings} title="Settings">
          ⚙
        </sp-action-button>
      </div>

      {error && (
        <div
          style={{
            background: '#5c1d1d',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <span>{error}</span>
          {onRetryPlacement && (
            <span style={{ color: '#d6d6d6' }}>
              Image is cached. Retry placement without rerunning generation.
            </span>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            {onRetryPlacement && (
              <sp-button size="s" variant="secondary" onClick={onRetryPlacement}>
                Retry Placement
              </sp-button>
            )}
            {onDismissError && (
              <sp-action-button size="s" onClick={onDismissError} title="Dismiss">
                ✕
              </sp-action-button>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="section-label">Mode</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <sp-button
            variant={mode === 'generate' ? 'cta' : 'secondary'}
            onClick={() => onModeChange('generate')}
          >
            Generate
          </sp-button>
          <sp-button
            variant={mode === 'inpaint' ? 'cta' : 'secondary'}
            onClick={() => onModeChange('inpaint')}
          >
            Inpaint
          </sp-button>
        </div>
        <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 6 }}>
          Generate fills the canvas. Inpaint edits the current Photoshop selection.
        </div>
      </div>

      <ModelSelector value={model} onChange={setModel} capability={mode} />
      {!canRunSelectedMode && (
        <div style={{ fontSize: 11, color: '#ef5350' }}>
          Pick a model that supports {mode}.
        </div>
      )}
      {mode === 'inpaint' && (
        <div style={{ fontSize: 11, color: '#9e9e9e' }}>
          Make a selection in Photoshop before running Inpaint.
        </div>
      )}
      {selectedModel.providerId === 'chatgpt-backend' && (
        <div style={{ fontSize: 11, color: '#9e9e9e' }}>
          ChatGPT {mode} may take 2+ minutes and requires the backend session to be connected.
        </div>
      )}
      <sp-divider size="s"></sp-divider>
      <PromptInput value={prompt} onChange={setPrompt} recentPrompts={recentPrompts} />
      <ReferenceImages
        images={refImages}
        onAdd={handleAddReference}
        onRemove={(i) => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
      />

      <div className="button-row">
        <sp-button variant="secondary" onClick={onCancel}>
          Cancel
        </sp-button>
        <sp-button variant="cta" onClick={handleGenerate} disabled={!prompt.trim() || !canRunSelectedMode}>
          {actionLabel}
        </sp-button>
      </div>
    </div>
  );
}
