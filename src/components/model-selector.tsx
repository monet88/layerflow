import { useCallback } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import { useSpEvent } from '../hooks/use-sp-event';
import { listModels } from '../providers/model-registry';

export const MODEL_OPTIONS = listModels().map((m) => ({
  value: m.id,
  label: `${m.label} — ${m.costHint}`,
  provider: m.providerId,
}));

export type ModelValue = string;

interface ModelSelectorProps {
  value: ModelValue;
  onChange: (value: ModelValue) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const handleChange = useCallback((e: Event) => {
    onChange((e.target as HTMLElement & { value: string }).value);
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
