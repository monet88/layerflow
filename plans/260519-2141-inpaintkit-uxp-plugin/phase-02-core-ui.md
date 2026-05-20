---
title: "Phase 2: Core UI"
sprint: 1
status: pending
priority: P1
effort: 5h
depends_on: [phase-01]
---

# Phase 2: Core UI

**Priority:** P1 — Blocks Phase 5 (pipeline needs dialogs)
**Estimated effort:** 5h
**Status:** pending
**Blocked by:** Phase 1

---

## Context Links

- [plan.md](./plan.md) — Overview
- [researcher-uxp-report.md](../reports/researcher-uxp-report.md) — SWC React gotchas (section 5)

---

## Overview

Build the three modal dialogs (Main, Settings, Progress) and shared UI components using Spectrum Web Components inside React. No real Photoshop calls or provider logic yet — dialogs open, form fields work, state is managed, cancel/close works.

---

## Key Insights

- React does NOT attach event listeners to Web Component elements automatically for **value-change events** (`change`, `input`). These need `ref` + manual `addEventListener` via the `useSpEvent` hook.
- **Exception:** `click` events on `sp-button` and `sp-action-button` DO work with React's `onClick` prop. Only use `useSpEvent` for `change`/`input` events on `sp-picker`, `sp-textfield`, `sp-slider`, etc.
- Use `class` (not `className`) in SWC elements — they are Custom Elements, not React DOM elements.
- No self-closing SWC tags: `<sp-button></sp-button>` not `<sp-button />`.
- Wrap all UI in `<sp-theme scale="medium" color="dark">` for Spectrum tokens.
- SWC version is locked at 0.37.0 in UXP v8 — do not independently update `@spectrum-web-components`.
- UXP modals are React component trees rendered conditionally, NOT native `dialog` elements. UXP does not support `HTMLDialogElement`.
- State management: React `useState` + `useReducer` is sufficient. No Zustand needed at this phase.

---

## Requirements

**Functional:**
- Main dialog: model dropdown, prompt textarea, recent prompts (3 chips), reference images upload, Cancel + Generate buttons
- Settings dialog: provider dropdown, provider-specific config section (API key input or OAuth section), Disconnect button
- Progress dialog: status text label, Cancel button, indeterminate spinner
- Dialogs open/close via React state; no Photoshop integration yet (buttons log to console)
- Recent prompts: clicking a chip populates the prompt textarea
- Provider dropdown change: shows/hides the correct config section

**Non-functional:**
- Follows Adobe Spectrum visual language (dark theme)
- All interactive elements have accessible labels
- No layout overflow at 300px panel width
- Typecheck passes

---

## Architecture

```
src/
├── App.tsx                          # View router: which dialog is active
├── components/
│   ├── main-dialog.tsx              # Generation dialog (main entry point)
│   ├── settings-dialog.tsx          # Provider config
│   ├── progress-dialog.tsx          # Generation in progress
│   ├── prompt-input.tsx             # Textarea + recent chips
│   ├── model-selector.tsx           # AI model dropdown
│   └── reference-images.tsx         # Optional reference file picker
├── hooks/
│   └── use-sp-event.ts              # Helper: SWC ref + addEventListener
└── types/
    └── ui-state.ts                  # Dialog state, form state types
```

**State shape (App level):**

```typescript
type ActiveDialog = 'main' | 'settings' | 'progress' | null;

interface AppState {
  activeDialog: ActiveDialog;
  // passed down as props to dialogs
}
```

Form data lives inside each dialog as local state. Only dialog-switching state lives in `App.tsx`.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/App.tsx` | Replace placeholder; dialog routing |
| `src/components/main-dialog.tsx` | Main generation UI |
| `src/components/settings-dialog.tsx` | Provider config UI |
| `src/components/progress-dialog.tsx` | In-progress overlay |
| `src/components/prompt-input.tsx` | Prompt textarea + recent chips |
| `src/components/model-selector.tsx` | Model/provider dropdown |
| `src/components/reference-images.tsx` | File picker for reference images |
| `src/hooks/use-sp-event.ts` | SWC event listener helper |
| `src/types/ui-state.ts` | UI type definitions |
| `src/styles/global.css` | CSS custom properties, base layout |

---

## Implementation Steps

### Step 2.1 — Install Spectrum Web Components

> **Important:** UXP v8 bundles SWC 0.37.0 internally — the runtime provides `<sp-button>`, `<sp-textfield>`, etc. as built-in Custom Elements. The npm packages below are installed ONLY for TypeScript types and Vite bundling of side-effect imports (component registration). If UXP runtime already registers these elements, the npm imports become no-ops. `[VERIFY_AT_RUNTIME]` — if components render blank, check if UXP already provides them and remove the npm packages.

```bash
npm install \
  @spectrum-web-components/theme@0.37.0 \
  @spectrum-web-components/button@0.37.0 \
  @spectrum-web-components/textfield@0.37.0 \
  @spectrum-web-components/picker@0.37.0 \
  @spectrum-web-components/menu@0.37.0 \
  @spectrum-web-components/action-button@0.37.0 \
  @spectrum-web-components/field-label@0.37.0 \
  @spectrum-web-components/progress-circle@0.37.0 \
  @spectrum-web-components/divider@0.37.0 \
  @spectrum-web-components/icons-workflow@0.37.0
```

> If @0.37.0 does not exist on npm, try without version pin and check runtime compatibility. SWC version must match what UXP v8 expects — mismatched versions cause blank renders.

### Step 2.2 — Create `src/hooks/use-sp-event.ts`

SWC events (click, change, input) must be attached via `addEventListener`, not React's `onClick`/`onChange`:

```typescript
import { useEffect, useRef } from 'react';

// Attaches a native DOM event listener to a Web Component ref.
// Cleans up on unmount. Use instead of React synthetic events on SWC elements.
export function useSpEvent<T extends EventTarget>(
  eventName: string,
  handler: (e: Event) => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener(eventName, handler);
    return () => el.removeEventListener(eventName, handler);
  }, [eventName, handler]);
  return ref;
}
```

### Step 2.3 — Create `src/types/ui-state.ts`

```typescript
export type ActiveDialog = 'main' | 'settings' | 'progress' | null;
export type ProviderId = 'falai' | 'replicate' | 'chatgpt-backend';

export interface MainDialogState {
  prompt: string;
  recentPrompts: string[];
  selectedModel: string;
  referenceImagePaths: string[];
}

export interface SettingsState {
  provider: ProviderId;
  falaiApiKey: string;
  replicateApiKey: string;
  chatgptBackendUrl: string;          // e.g., http://localhost:8000 or https://backend.example.com
  chatgptBackendApiKey: string;       // shared secret to backend (APP_API_KEY)
  chatgptOAuthStatus: 'disconnected' | 'pending' | 'connected';
}

export interface ProgressState {
  message: string;      // "Uploading...", "Generating..."
  canCancel: boolean;
}
```

### Step 2.4 — Create `src/styles/global.css`

```css
:root {
  --panel-padding: 12px;
  --gap-sm: 8px;
  --gap-md: 12px;
  --gap-lg: 16px;
}

body {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow-x: hidden;
}

#root {
  width: 100%;
  height: 100%;
}

.dialog-container {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--panel-padding);
  width: 100%;
  box-sizing: border-box;
}

.button-row {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  margin-top: var(--gap-md);
}

.recent-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--spectrum-gray-600);
  margin-bottom: 4px;
}
```

### Step 2.5 — Create `src/components/model-selector.tsx`

```typescript
import React, { useCallback } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import { useSpEvent } from '../hooks/use-sp-event';

export const MODEL_OPTIONS = [
  { value: 'flux-fill-pro', label: 'Flux Fill Pro (fal.ai) — inpainting', provider: 'falai' },
  { value: 'nano-banana-2', label: 'Nano Banana 2 (fal.ai) — fast', provider: 'falai' },
] as const;

export type ModelValue = typeof MODEL_OPTIONS[number]['value'];

interface Props {
  value: ModelValue;
  onChange: (value: ModelValue) => void;
}

export function ModelSelector({ value, onChange }: Props) {
  const handleChange = useCallback((e: Event) => {
    onChange((e.target as HTMLElement & { value: string }).value as ModelValue);
  }, [onChange]);

  const pickerRef = useSpEvent<EventTarget>('change', handleChange);

  return (
    <div>
      <div className="section-label">AI Model</div>
      <sp-picker ref={pickerRef} value={value} style={{ width: '100%' }}>
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
```

### Step 2.6 — Create `src/components/prompt-input.tsx`

```typescript
import React, { useCallback } from 'react';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import { useSpEvent } from '../hooks/use-sp-event';

interface Props {
  value: string;
  onChange: (value: string) => void;
  recentPrompts: string[];
}

export function PromptInput({ value, onChange, recentPrompts }: Props) {
  const handleInput = useCallback((e: Event) => {
    onChange((e.target as HTMLInputElement).value);
  }, [onChange]);

  const textRef = useSpEvent<EventTarget>('input', handleInput);

  return (
    <div>
      <div className="section-label">Prompt</div>
      <sp-textfield
        ref={textRef}
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
```

### Step 2.7 — Create `src/components/reference-images.tsx`

```typescript
import React from 'react';
import '@spectrum-web-components/button/sp-button.js';

interface Props {
  paths: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function ReferenceImages({ paths, onAdd, onRemove }: Props) {
  return (
    <div>
      <div className="section-label">Reference Images (optional)</div>
      {paths.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.split('/').pop()}
          </span>
          <sp-action-button size="s" onClick={() => onRemove(i)}>✕</sp-action-button>
        </div>
      ))}
      <sp-button variant="secondary" size="s" onClick={onAdd}>
        Add Reference Image
      </sp-button>
    </div>
  );
}
```

> Note: `onAdd` triggers the UXP file picker in Phase 6 (Step 6.4). For now, it's a no-op or console.log.

### Step 2.8 — Create `src/components/progress-dialog.tsx`

```typescript
import React from 'react';
import '@spectrum-web-components/progress-circle/sp-progress-circle.js';
import '@spectrum-web-components/button/sp-button.js';

interface Props {
  message: string;
  onCancel: () => void;
}

export function ProgressDialog({ message, onCancel }: Props) {
  return (
    <div className="dialog-container" style={{ alignItems: 'center', paddingTop: 32 }}>
      <sp-progress-circle size="l" indeterminate></sp-progress-circle>
      <p style={{ color: '#fff', fontSize: 13, marginTop: 12 }}>{message}</p>
      <sp-button variant="secondary" onClick={onCancel}>
        Cancel
      </sp-button>
    </div>
  );
}
```

### Step 2.9 — Create `src/components/settings-dialog.tsx`

```typescript
import React, { useState, useCallback } from 'react';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/button/sp-button.js';
import { ProviderId } from '../types/ui-state';
import { useSpEvent } from '../hooks/use-sp-event';

interface Props {
  onClose: () => void;
  onSave: (provider: ProviderId, key: string) => void;
}

export function SettingsDialog({ onClose, onSave }: Props) {
  const [provider, setProvider] = useState<ProviderId>('falai');
  const [apiKey, setApiKey] = useState('');
  const [oauthStatus, setOauthStatus] = useState<'disconnected' | 'pending' | 'connected'>('disconnected');

  const handleProviderChange = useCallback((e: Event) => {
    setProvider((e.target as HTMLElement & { value: string }).value as ProviderId);
  }, []);
  const pickerRef = useSpEvent<EventTarget>('change', handleProviderChange);

  const handleKeyInput = useCallback((e: Event) => {
    setApiKey((e.target as HTMLInputElement).value);
  }, []);
  const keyRef = useSpEvent<EventTarget>('input', handleKeyInput);

  return (
    <div className="dialog-container">
      <h3 style={{ margin: 0, color: '#fff', fontSize: 14 }}>Settings</h3>

      <div>
        <div className="section-label">Provider</div>
        <sp-picker ref={pickerRef} value={provider} style={{ width: '100%' }}>
          <sp-menu>
            <sp-menu-item value="falai">fal.ai (API Key)</sp-menu-item>
            <sp-menu-item value="replicate">Replicate (API Key)</sp-menu-item>
            <sp-menu-item value="chatgpt-backend">ChatGPT Subscription (Backend + OAuth)</sp-menu-item>
          </sp-menu>
        </sp-picker>
      </div>

      {(provider === 'falai' || provider === 'replicate') && (
        <div>
          <div className="section-label">
            {provider === 'falai' ? 'fal.ai API Key' : 'Replicate API Key'}
          </div>
          <sp-textfield
            ref={keyRef}
            value={apiKey}
            type="password"
            placeholder={provider === 'falai' ? 'fal_...' : 'r8_...'}
            style={{ width: '100%' }}
          ></sp-textfield>
        </div>
      )}

      {provider === 'chatgpt-backend' && (
        <div>
          <div className="section-label">ChatGPT Backend</div>
          <p style={{ fontSize: 11, color: '#aaa', margin: '4px 0 8px' }}>
            Routes through your ChatGPT2API backend, which uses your ChatGPT Plus/Pro session. Unofficial — may break without notice.
          </p>
          {/* Phase 9 wires Backend URL + APP_API_KEY inputs and the OAuth flow.
              Backend URL must be https:// (localhost http allowed for dev). */}
          {oauthStatus === 'disconnected' && (
            <sp-button variant="secondary" onClick={() => setOauthStatus('pending')}>
              Connect ChatGPT Account
            </sp-button>
          )}
          {oauthStatus === 'connected' && (
            <>
              <p style={{ color: '#4caf50', fontSize: 12 }}>Connected</p>
              <sp-button variant="secondary" onClick={() => setOauthStatus('disconnected')}>
                Disconnect
              </sp-button>
            </>
          )}
        </div>
      )}

      <div className="button-row">
        <sp-button variant="secondary" onClick={onClose}>Cancel</sp-button>
        <sp-button variant="cta" onClick={() => onSave(provider, apiKey)}>Save</sp-button>
      </div>
    </div>
  );
}
```

### Step 2.10 — Create `src/components/main-dialog.tsx`

```typescript
import React, { useState } from 'react';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/divider/sp-divider.js';
import { ModelSelector, ModelValue } from './model-selector';
import { PromptInput } from './prompt-input';
import { ReferenceImages } from './reference-images';
import { MainDialogState } from '../types/ui-state';

interface Props {
  mode: 'generate' | 'inpaint';  // set by which menu item was clicked
  onGenerate: (state: MainDialogState) => void;
  onSettings: () => void;
  onCancel: () => void;
}

export function MainDialog({ mode, onGenerate, onSettings, onCancel }: Props) {
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
    onGenerate({ prompt, recentPrompts, selectedModel: model, referenceImagePaths: refImages });
  };

  return (
    <div className="dialog-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#fff', fontSize: 14 }}>
          {mode === 'generate' ? 'Generate Image' : 'Inpaint Selection'}
        </h3>
        <sp-action-button size="s" onClick={onSettings} title="Settings">⚙</sp-action-button>
      </div>

      <ModelSelector value={model} onChange={setModel} />
      <sp-divider size="s"></sp-divider>
      <PromptInput value={prompt} onChange={setPrompt} recentPrompts={recentPrompts} />
      <ReferenceImages
        paths={refImages}
        onAdd={() => console.log('TODO: file picker in Phase 7')}
        onRemove={i => setRefImages(prev => prev.filter((_, idx) => idx !== i))}
      />

      <div className="button-row">
        <sp-button variant="secondary" onClick={onCancel}>Cancel</sp-button>
        <sp-button variant="cta" onClick={handleGenerate} disabled={!prompt.trim()}>
          Generate
        </sp-button>
      </div>
    </div>
  );
}
```

### Step 2.11 — Update `src/App.tsx`

```typescript
import React, { useState } from 'react';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import { MainDialog } from './components/main-dialog';
import { SettingsDialog } from './components/settings-dialog';
import { ProgressDialog } from './components/progress-dialog';
import { ActiveDialog, MainDialogState, ProviderId } from './types/ui-state';
import './styles/global.css';

export function App() {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>('main');
  const [mode] = useState<'generate' | 'inpaint'>('generate');
  const [progressMessage, setProgressMessage] = useState('Generating...');

  const handleGenerate = (state: MainDialogState) => {
    console.log('Generate triggered:', state);
    setProgressMessage('Uploading...');
    setActiveDialog('progress');
    // Phase 5 will replace this with real pipeline
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
```

---

## Success Criteria

- [ ] All three dialogs render without blank screens
- [ ] Model dropdown changes state (console.log confirms)
- [ ] Prompt textarea accepts input; recent chips populate textarea on click
- [ ] Settings dialog shows correct section for each provider
- [ ] Generate button disabled when prompt is empty
- [ ] Progress spinner appears after clicking Generate
- [ ] Cancel in progress dialog returns to main dialog
- [ ] `npm run typecheck` passes with 0 errors
- [ ] No console errors in UDT DevTools

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SWC components render blank (version lock) | Medium | High | Check UXP runtime version; match SWC version to what UXP bundles |
| React synthetic events don't fire on SWC | High (known gotcha) | Medium | Already mitigated: `useSpEvent` hook for all SWC interactions |
| `sp-textfield` multiline prop not supported in UXP SWC | Medium | Low | Fallback to `<textarea>` with manual Spectrum CSS styling |
| `sp-theme` color tokens not loading | Medium | Medium | Verify `sp-theme.js` and `themes.js` are both imported |
| Panel too narrow for layout | Low | Low | Use `width: 100%; box-sizing: border-box` on all containers |

---

## Rollback Plan

All changes are UI files only. No Photoshop state touched. Rollback = revert to Phase 1's placeholder `App.tsx`. Zero risk of document corruption.
