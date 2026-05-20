import { useCallback } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import { useSpEvent } from '../hooks/use-sp-event';

export const MODEL_OPTIONS = [
  { value: 'flux-fill-pro', label: 'Flux Fill Pro (fal.ai) — inpainting', provider: 'falai' },
  { value: 'nano-banana-2', label: 'Nano Banana 2 (fal.ai) — fast', provider: 'falai' },
] as const;

export type ModelValue = typeof MODEL_OPTIONS[number]['value'];

interface ModelSelectorProps {
  value: ModelValue;
  onChange: (value: ModelValue) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const handleChange = useCallback((e: Event) => {
    onChange((e.target as HTMLElement & { value: string }).value as ModelValue);
  }, [onChange]);

  const pickerRef = useSpEvent<EventTarget>('change', handleChange);

  return (
    <div>
      <div className="section-label">AI Model</div>
      <sp-picker ref={pickerRef as React.Ref<HTMLElement>} value={value} style={{ width: '100%' }}>
        <sp-menu>
          {MODEL_OPTIONS.map(opt => (
            <sp-menu-item key={opt.value} value={opt.value}>
              {opt.label}
            </sp-menu-item>
          ))}
        </sp-menu>
      </sp-picker>
    </div>
  );
}
