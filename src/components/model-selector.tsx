import { useCallback } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import { useSpEvent } from '../hooks/use-sp-event';
import { listModels, type Capability } from '../providers/model-registry';

export const MODEL_OPTIONS = listModels().map((m) => ({
  value: m.id,
  label: `${m.label} — ${m.costHint}`,
  provider: m.providerId,
  capabilities: m.capabilities,
}));

export type ModelValue = string;

interface ModelSelectorProps {
  value: ModelValue;
  onChange: (value: ModelValue) => void;
  capability?: Capability;
}

export function ModelSelector({ value, onChange, capability }: ModelSelectorProps) {
  const handleChange = useCallback((e: Event) => {
    onChange((e.target as HTMLElement & { value: string }).value);
  }, [onChange]);

  const pickerRef = useSpEvent<EventTarget>('change', handleChange);
  const options = capability
    ? MODEL_OPTIONS.filter((opt) => opt.capabilities.includes(capability))
    : MODEL_OPTIONS;

  return (
    <div>
      <div className="section-label">AI Model</div>
      <sp-picker ref={pickerRef as React.Ref<HTMLElement>} value={value} style={{ width: '100%' }}>
        <sp-menu>
          {options.map(opt => (
            <sp-menu-item key={opt.value} value={opt.value}>
              {opt.label}
            </sp-menu-item>
          ))}
        </sp-menu>
      </sp-picker>
    </div>
  );
}
