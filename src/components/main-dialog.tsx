import { useState } from 'react';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/divider/sp-divider.js';
import { ModelSelector, type ModelValue } from './model-selector';
import { PromptInput } from './prompt-input';
import { ReferenceImages } from './reference-images';
import type { MainDialogState } from '../types/ui-state';

interface MainDialogProps {
  mode: 'generate' | 'inpaint';
  onGenerate: (state: MainDialogState) => void;
  onSettings: () => void;
  onCancel: () => void;
}

export function MainDialog({ mode, onGenerate, onSettings, onCancel }: MainDialogProps) {
  const [model, setModel] = useState<ModelValue>('flux-fill-pro');
  const [prompt, setPrompt] = useState('');
  const [recentPrompts] = useState<string[]>([
    'Add soft morning light',
    'Replace background with forest',
    'Make it photorealistic',
  ]);
  const [refImages, setRefImages] = useState<string[]>([]);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    onGenerate({
      prompt,
      recentPrompts,
      selectedModel: model,
      referenceImagePaths: refImages,
    });
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

      <ModelSelector value={model} onChange={setModel} />
      <sp-divider size="s"></sp-divider>
      <PromptInput value={prompt} onChange={setPrompt} recentPrompts={recentPrompts} />
      <ReferenceImages
        paths={refImages}
        onAdd={() => {
          // Phase 6 wires the UXP file picker here
        }}
        onRemove={i => setRefImages(prev => prev.filter((_, idx) => idx !== i))}
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
