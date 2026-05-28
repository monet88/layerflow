import { useEffect, useState } from 'react';
import { storage } from 'uxp';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/divider/sp-divider.js';
import { ModelSelector, type ModelValue } from './model-selector';
import { PromptInput } from './prompt-input';
import { ReferenceImages } from './reference-images';
import type { MainDialogState, ReferenceImage } from '../types/ui-state';
import { getRecentPrompts, type RecentPrompt } from '../storage/settings-storage';

const REFERENCE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

interface MainDialogProps {
  mode: 'generate' | 'inpaint';
  error?: string | null;
  onDismissError?: () => void;
  onGenerate: (state: MainDialogState) => void;
  onSettings: () => void;
  onCancel: () => void;
}

export function MainDialog({
  mode,
  error,
  onDismissError,
  onGenerate,
  onSettings,
  onCancel,
}: MainDialogProps) {
  const [model, setModel] = useState<ModelValue>('flux-fill-pro');
  const [prompt, setPrompt] = useState('');
  const [recentPrompts, setRecentPrompts] = useState<RecentPrompt[]>([]);
  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);

  useEffect(() => {
    setRecentPrompts(getRecentPrompts());
  }, []);

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
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          {onDismissError && (
            <sp-action-button size="s" onClick={onDismissError} title="Dismiss">
              ✕
            </sp-action-button>
          )}
        </div>
      )}

      <ModelSelector value={model} onChange={setModel} />
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
        <sp-button variant="cta" onClick={handleGenerate} disabled={!prompt.trim()}>
          Generate
        </sp-button>
      </div>
    </div>
  );
}
