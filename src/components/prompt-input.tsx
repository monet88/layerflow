import { useCallback } from 'react';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import { useSpEvent } from '../hooks/use-sp-event';

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  recentPrompts: string[];
}

export function PromptInput({ value, onChange, recentPrompts }: PromptInputProps) {
  const handleInput = useCallback((e: Event) => {
    onChange((e.target as HTMLInputElement).value);
  }, [onChange]);

  const textRef = useSpEvent<EventTarget>('input', handleInput);

  return (
    <div>
      <div className="section-label">Prompt</div>
      <sp-textfield
        ref={textRef as React.Ref<HTMLElement>}
        value={value}
        multiline
        rows={4}
        placeholder="Describe what to generate or edit..."
        style={{ width: '100%' }}
      ></sp-textfield>

      {recentPrompts.length > 0 && (
        <div className="recent-prompts">
          {recentPrompts.map((prompt, i) => (
            <sp-action-button
              key={i}
              size="s"
              onClick={() => onChange(prompt)}
              title={prompt}
            >
              {prompt.length > 28 ? prompt.slice(0, 28) + '…' : prompt}
            </sp-action-button>
          ))}
        </div>
      )}
    </div>
  );
}
