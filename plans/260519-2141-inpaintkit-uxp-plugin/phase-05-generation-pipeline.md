---
title: "Phase 5: Generation Pipeline"
sprint: 1
status: pending
priority: P1
effort: 6h
depends_on: [phase-02, phase-03, phase-04]
---

# Phase 5: Generation Pipeline

**Priority:** P1 — The core feature
**Estimated effort:** 6h
**Status:** pending
**Blocked by:** Phase 2, Phase 3, Phase 4

---

## Context Links

- [plan.md](./plan.md) — Overview
- [researcher-architecture-report.md](../reports/researcher-architecture-report.md) — Progress pattern (section 2.2)
- [researcher-openai-api-report.md](../reports/researcher-openai-api-report.md) — Error handling priorities (section 6.5)

---

## Overview

Wire together the full generation pipeline: UI triggers → read PS state → call AI provider → place result in document. Handle progress reporting, cancellation, and all error cases. This is the phase where everything from Phases 2–4 integrates.

---

## Key Insights

**Two modes, one pipeline:**
- `generate` mode: no active selection → full canvas or a reasonable default size → pass to provider's `generate()` → place at canvas center
- `inpaint` mode: active selection required → export region + mask → pass to provider's `inpaint()` → place at selection bounds

**Progress reporting:** Use `useCallback`-stable functions passed down via props, not global state. Progress updates happen at named checkpoints: Preparing → Exporting → Uploading → Generating → Placing.

**Cancellation:** Track an `AbortController` ref in the pipeline service. When the user clicks Cancel in the progress dialog, call `abort()`. All async steps should check `signal.aborted` between steps. Network calls pass `signal` to the XHR/fetch wrapper.

**fal.ai URL images:** After the provider returns, check for `_url` property on result items; fetch the PNG bytes via `NetworkClient.request()` before placing.

**Error user messages:** Map specific error types to actionable messages:
- `RateLimitError` → "Rate limit reached. Wait X seconds and try again."
- `ContentPolicyError` → "This prompt was blocked by content policy. Try rephrasing."
- `403` with "organization" → "gpt-image-1 requires OpenAI org verification. [Link]"
- Network timeout → "Connection timed out. Check your internet connection and try again."
- No document open → "Please open a document in Photoshop first."
- No selection (inpaint mode) → "Please make a selection before using Inpaint."

**Recent prompts:** After a successful generation, prepend the prompt to the recent prompts list (max 5). Persist to `localStorage`.

---

## Requirements

**Functional:**
- `GenerationService.generate(options)` orchestrates full text-to-image flow
- `GenerationService.inpaint(options)` orchestrates full inpainting flow
- Progress callback reports 5 named stages with percentage 0–100
- Cancellation at any stage cleans up (closes temp docs, removes in-progress layers)
- On success: Smart Object layer placed, selection restored, recent prompt saved
- On error: user-friendly message surfaced to UI, no orphaned layers

**Non-functional:**
- Pipeline state does not leak between generations (no shared mutable state)
- `executeAsModal` runs for PS-side steps only; network calls happen outside modal
- Temp files always cleaned up (try/finally)

---

## Architecture

```
src/services/
└── generation-service.ts     # Orchestrates full pipeline

Data flow:

[UI: MainDialog]
  → calls GenerationService.generate() or .inpaint()
  → reports progress via callback

GenerationService.generate():
  1. getDocumentInfo()          [PS: read]
  2. select provider + model
  3. load credentials from secureStorage
  4. call provider.generate(...)     [network]
  5. place result via placeResultAsSmartObject()  [PS: write]
  6. save to recent prompts

GenerationService.inpaint():
  1. getDocumentInfo() + getSelectionBounds()   [PS: read]
  2. expandRectForInpaintContext()
  3. exportDocumentRegion(expandedRect)          [PS: read]
  4. getSelectionMask(bounds)                   [PS: read]
  5. select provider + model
  6. load credentials from secureStorage
  7. call provider.inpaint(...)                 [network]
  8. fetch image URL if needed                  [network, fal.ai only]
  9. placeResultAsSmartObject(result, expandedRect, mask)  [PS: write]
  10. save to recent prompts
```

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/services/generation-service.ts` | Create | Core pipeline |
| `src/App.tsx` | Modify | Wire Generate button → service; show errors |
| `src/components/progress-dialog.tsx` | Modify | Accept `onCancel` that calls service.cancel() |

---

## Implementation Steps

### Step 5.1 — Create `src/services/generation-service.ts`

```typescript
import { getDocumentInfo, DocInfo } from '../photoshop/document-utils';
import { getSelectionBounds, getSelectionMask, expandRectForInpaintContext } from '../photoshop/selection';
import { exportDocumentRegion } from '../photoshop/export-image';
import { placeResultAsSmartObject } from '../photoshop/place-result';
import { getProvider, providerForModel } from '../providers/provider-registry';
import { getModelDefinition } from '../providers/model-registry';
import { ProviderId, ResultItem, RateLimitError, ContentPolicyError } from '../providers/provider-interface';
import { request } from './network-client';
import { base64ToBytes } from './image-processing';
import { loadCredentials } from '../storage/secure-storage';
import { getRecentPrompts, saveRecentPrompt } from '../storage/settings-storage';

export type ProgressStage =
  | 'preparing'
  | 'exporting'
  | 'uploading'
  | 'generating'
  | 'placing'
  | 'done';

export interface ProgressUpdate {
  stage: ProgressStage;
  percent: number;
  message: string;
}

export interface PipelineOptions {
  prompt: string;
  model: string;
  quality?: 'low' | 'medium' | 'high';
  onProgress: (update: ProgressUpdate) => void;
  signal: AbortSignal;
}

export class ModelCapabilityError extends Error {
  constructor(model: string, capability: 'generate' | 'inpaint') {
    super(`Model "${model}" does not support ${capability}. Pick a different model.`);
    this.name = 'ModelCapabilityError';
  }
}

export class GenerationInProgressError extends Error {
  constructor() {
    super('A generation is already in progress. Cancel it first or wait for it to finish.');
    this.name = 'GenerationInProgressError';
  }
}

// Single-flight guard: only one runGenerate / runInpaint can be active at a time.
// Prevents two concurrent executeAsModal calls (RT7).
let isGenerating = false;
function acquireLock(): void {
  if (isGenerating) throw new GenerationInProgressError();
  isGenerating = true;
}
function releaseLock(): void {
  isGenerating = false;
}
export function isGenerationInFlight(): boolean {
  return isGenerating;
}

function assertCapability(model: string, capability: 'generate' | 'inpaint'): void {
  const def = getModelDefinition(model);
  if (!def.capabilities.includes(capability)) {
    throw new ModelCapabilityError(model, capability);
  }
}

function progress(
  onProgress: (u: ProgressUpdate) => void,
  stage: ProgressStage,
  percent: number,
  message: string,
) {
  onProgress({ stage, percent, message });
}

// Resolves any result items that returned a URL instead of inline bytes.
async function resolveImageUrls(results: ResultItem[]): Promise<ResultItem[]> {
  return Promise.all(results.map(async item => {
    if (item.imageUrl && !item.pngBytes?.length) {
      const response = await request(item.imageUrl, { method: 'GET' });
      const buffer = await response.arrayBuffer();
      return { ...item, pngBytes: new Uint8Array(buffer), imageUrl: undefined };
    }
    return item;
  }));
}

// User-friendly error messages for known error types.
function userMessageFor(err: unknown): string {
  if (err instanceof RateLimitError) {
    const wait = err.retryAfterSeconds ? ` Wait ${err.retryAfterSeconds}s.` : '';
    return `Rate limit reached.${wait} Try again in a moment.`;
  }
  if (err instanceof ContentPolicyError) {
    return `Prompt blocked by content policy. Try rephrasing: "${err.message}"`;
  }
  const msg = (err as Error)?.message ?? String(err);
  if (msg.includes('org') && msg.includes('verif')) {
    return 'gpt-image-1 requires OpenAI organization verification. Visit platform.openai.com/settings/organization/general';
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Connection timed out. Check your internet connection and try again.';
  }
  if (msg.includes('API key') || msg.includes('not configured')) {
    return msg;  // Already user-friendly from provider-registry
  }
  return `Generation failed: ${msg}`;
}

// ---- Text-to-image pipeline ----
export async function runGenerate(opts: PipelineOptions): Promise<void> {
  const { prompt, model, quality = 'high', onProgress, signal } = opts;

  acquireLock();
  try {
    assertCapability(model, 'generate');

    progress(onProgress, 'preparing', 5, 'Preparing...');
    let docInfo: DocInfo;
    try {
      docInfo = getDocumentInfo();
    } catch (e) {
      throw new Error(userMessageFor(e));
    }

    if (signal.aborted) return;

    const providerId = providerForModel(model) as ProviderId;
    const credentials = await loadCredentials();
    const provider = getProvider(providerId, credentials);

    progress(onProgress, 'generating', 30, 'Generating image...');

    let results: ResultItem[];
    try {
      results = await provider.generate({ prompt, model, quality, width: docInfo.width, height: docInfo.height });
    } catch (e) {
      throw new Error(userMessageFor(e));
    }

    if (signal.aborted) return;

    progress(onProgress, 'generating', 75, 'Processing result...');
    results = await resolveImageUrls(results);

    if (!results[0]?.pngBytes?.length) throw new Error('Provider returned empty image data.');
    // Cache result bytes BEFORE placement so a placement failure doesn't waste the generation (RT5).
    const generatedBytes = results[0].pngBytes;

    progress(onProgress, 'placing', 85, 'Placing layer...');
    const docWidth = docInfo.width;
    const docHeight = docInfo.height;
    try {
      await placeResultAsSmartObject({
        pngBytes: generatedBytes,
        targetRect: { left: 0, top: 0, right: docWidth, bottom: docHeight, width: docWidth, height: docHeight },
        layerName: `InpaintKit: ${prompt.slice(0, 40)}`,
      });
    } catch (e) {
      // Placement failed but we have the bytes — surface a placement-specific error.
      // Caller can offer "Retry placement" without re-running the (paid) generation.
      throw Object.assign(new Error(`Placement failed: ${(e as Error).message}. The generated image is cached — retry placement or save to disk.`), {
        name: 'PlacementError',
        cachedBytes: generatedBytes,
      });
    }

    progress(onProgress, 'done', 100, 'Done');
    await saveRecentPrompt(prompt, model);
  } finally {
    releaseLock();
  }
}

// ---- Inpainting pipeline ----
export async function runInpaint(opts: PipelineOptions): Promise<void> {
  const { prompt, model, quality = 'high', onProgress, signal } = opts;

  acquireLock();
  try {
    assertCapability(model, 'inpaint');

    progress(onProgress, 'preparing', 5, 'Reading selection...');
    let docInfo: DocInfo;
    const bounds = getSelectionBounds();
    try {
      docInfo = getDocumentInfo();
    } catch (e) {
      throw new Error(userMessageFor(e));
    }

    if (!bounds) throw new Error('No selection found. Make a selection (lasso, marquee, etc.) before using Inpaint.');

    const expandedBounds = expandRectForInpaintContext(bounds, docInfo.width, docInfo.height);

    if (signal.aborted) return;

    progress(onProgress, 'exporting', 15, 'Exporting region...');
    let sourceImage: Uint8Array;
    try {
      sourceImage = await exportDocumentRegion(expandedBounds);
    } catch (e) {
      throw new Error(`Export failed: ${(e as Error).message}`);
    }

    if (signal.aborted) return;

    progress(onProgress, 'exporting', 30, 'Reading selection mask...');
    let maskResult: { data: Uint8Array; width: number; height: number };
    // Mask is read at expandedBounds to match source image dimensions exactly.
    // The original selection shape is preserved within the expanded canvas.
    try {
      maskResult = await getSelectionMask(expandedBounds);
    } catch (e) {
      throw new Error(`Mask extraction failed: ${(e as Error).message}`);
    }

    if (signal.aborted) return;

    const providerId = providerForModel(model) as ProviderId;
    const credentials = await loadCredentials();
    const provider = getProvider(providerId, credentials);

    progress(onProgress, 'uploading', 45, 'Uploading to AI...');

    let results: ResultItem[];
    try {
      results = await provider.inpaint({
        prompt,
        model,
        quality,
        sourceImage,
        maskImage: maskResult.data,
        width: expandedBounds.width,
        height: expandedBounds.height,
      });
    } catch (e) {
      throw new Error(userMessageFor(e));
    }

    if (signal.aborted) return;

    progress(onProgress, 'generating', 80, 'Processing result...');
    results = await resolveImageUrls(results);

    if (!results[0]?.pngBytes?.length) throw new Error('Provider returned empty image data.');
    // Cache result bytes BEFORE placement so a placement failure doesn't waste the inpaint call (RT5).
    const inpaintedBytes = results[0].pngBytes;

    progress(onProgress, 'placing', 90, 'Placing layer...');
    try {
      await placeResultAsSmartObject({
        pngBytes: inpaintedBytes,
        targetRect: expandedBounds,
        maskData: { data: maskResult.data, width: bounds.width, height: bounds.height },
        layerName: `InpaintKit: ${prompt.slice(0, 40)}`,
      });
    } catch (e) {
      throw Object.assign(new Error(`Placement failed: ${(e as Error).message}. The inpainted image is cached — retry placement or save to disk.`), {
        name: 'PlacementError',
        cachedBytes: inpaintedBytes,
      });
    }

    progress(onProgress, 'done', 100, 'Done');
    await saveRecentPrompt(prompt, model);
  } finally {
    releaseLock();
  }
}
```

### Step 5.2 — Update `src/App.tsx` to wire generation

Key changes to `App.tsx`:
- Add `abortControllerRef = useRef<AbortController | null>(null)`
- In `handleGenerate`: determine mode, create `AbortController`, call `runGenerate` or `runInpaint`
- Pass `onProgress` callback that updates `progressMessage` state
- On success: close progress dialog, return to null state (panel idle)
- On error: close progress, show error in a dismissible alert or re-open main dialog with error banner
- `handleCancelProgress`: call `abortControllerRef.current?.abort()`, return to main dialog

```typescript
// In App.tsx:
const abortControllerRef = useRef<AbortController | null>(null);
const [error, setError] = useState<string | null>(null);
const [pipelineMode, setPipelineMode] = useState<'generate' | 'inpaint'>('generate');

const handleGenerate = async (state: MainDialogState) => {
  setError(null);
  if (isGenerationInFlight()) return;  // belt-and-suspenders alongside button-disable
  const controller = new AbortController();
  abortControllerRef.current = controller;
  setActiveDialog('progress');

  const onProgress = (update: ProgressUpdate) => {
    setProgressMessage(update.message);
    if (update.stage === 'done') setActiveDialog(null);
  };

  try {
    if (pipelineMode === 'generate') {
      await runGenerate({ prompt: state.prompt, model: state.selectedModel, onProgress, signal: controller.signal });
    } else {
      await runInpaint({ prompt: state.prompt, model: state.selectedModel, onProgress, signal: controller.signal });
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      setError((e as Error).message);
      setActiveDialog('main');
    }
  }
};

const handleCancelProgress = () => {
  abortControllerRef.current?.abort();
  setActiveDialog('main');
};
```

Error display: add a dismissible banner inside `MainDialog` when `error` prop is non-null.

### Step 5.3 — Menu entry points (entrypoints in manifest)

UXP supports `command` entry points that execute JS without opening a panel. Add these to `manifest.json` to support Plugins menu items:

```json
"entrypoints": [
  { "type": "panel", "id": "inpaintkitPanel", ... },
  {
    "type": "command",
    "id": "inpaintkitGenerate",
    "label": { "default": "Generate" }
  },
  {
    "type": "command",
    "id": "inpaintkitInpaint",
    "label": { "default": "Inpaint Selection" }
  },
  {
    "type": "command",
    "id": "inpaintkitSettings",
    "label": { "default": "Settings" }
  }
]
```

In `src/index.tsx`, register handlers for these entry points:

```typescript
const { entrypoints } = require('uxp');

entrypoints.setup({
  commands: {
    inpaintkitGenerate: { run: () => { /* set panel mode to generate; open panel */ } },
    inpaintkitInpaint: { run: () => { /* set panel mode to inpaint; open panel */ } },
    inpaintkitSettings: { run: () => { /* open panel at settings view */ } },
  },
  panels: {
    inpaintkitPanel: {
      show() {},
      hide() {},
    },
  },
});
```

> For communication between command handler and the React panel, use a simple `CustomEvent` on a shared event bus or a singleton module that the React component subscribes to via `useEffect`.

---

## Success Criteria

- [ ] Clicking Generate with a valid API key and a test prompt produces a Smart Object layer in PS
- [ ] Inpaint mode with an active selection produces a masked Smart Object layer at the selection position
- [ ] Progress dialog shows correct stage messages at each step
- [ ] Clicking Cancel during generation aborts network call and returns to main dialog without errors
- [ ] RateLimitError shows a user-friendly message (not a raw 429)
- [ ] Generating without a document open shows "No document open" error
- [ ] Inpaint mode without a selection shows "No selection found" error
- [ ] Successful generation saves prompt to recent prompts (visible next time dialog opens)
- [ ] `npm run typecheck` passes

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mask dimensions mismatch source image (OpenAI 400) | High | High | Validate before sending: mask dims must == source dims; add assertion + auto-resize |
| AbortController abort doesn't stop XHR fallback | Medium | Low | XHR ontimeout will eventually clean up; log abort but don't block UI |
| `executeAsModal` called inside another modal | Medium | High | Pipeline must never call `exportDocumentRegion` inside `placeResultAsSmartObject`'s modal |
| fal.ai URL fetch fails (URL expired) | Low | Medium | Retry once; surface error to user after 2nd failure |
| Promise rejection in progress callback causes silent failure | Medium | Medium | Wrap `onProgress` call in try/catch; never let progress update crash pipeline |
| Recent prompt persistence races (multiple rapid generations) | Low | Low | Write is atomic string update; last write wins |
| Concurrent generation triggered by rapid clicks | Medium | High | Module-level `isGenerating` lock + UI button disabled while in flight (RT7) |
| Model selected lacks requested capability (e.g. Nano Banana 2 + inpaint) | Medium | High | `assertCapability()` runs before any network call (RT8) |
| Provider returns image but PS placement fails (modal busy / disk full) | Low | Medium | Cache `pngBytes` before placement; on failure surface `PlacementError` with `cachedBytes` so caller can retry/save without re-running paid generation (RT5) |

---

## Rollback Plan

`generation-service.ts` has no persistent side effects beyond writing a layer. On error, the pipeline either places nothing or places an incomplete layer (which the user can delete). Recent prompts are additive-only and non-critical. Rollback = revert service file + undo any incorrectly placed layers in PS.

---

## Testing Strategy

UXP plugins cannot run in Node.js — the `photoshop`, `uxp`, and `imaging` modules are host-injected at runtime. Automated unit testing of Photoshop-dependent code is not feasible without Adobe's runtime.

**What we can test (unit):**
- `userMessageFor()` error mapping logic (pure function, no PS dependency)
- `resolveImageUrls()` with mocked fetch responses
- Progress stage sequencing logic

**What requires manual PS testing:**
- Full generate pipeline end-to-end
- Inpaint pipeline with active selection
- Cancellation at each stage
- Error states (no document, no selection, rate limit)

**Coverage expectation:** Backend (Phase 7) targets 80%+ automated coverage. Plugin pipeline code relies on manual QA in Photoshop with a documented test checklist (see Success Criteria above). Provider abstraction layer (Phase 4) can be partially unit-tested by mocking the network client.

---

## Error Boundary & Crash Recovery

If an unhandled error escapes the pipeline (e.g., a PS API throws unexpectedly inside `executeAsModal`), the React tree must not crash silently:

**React Error Boundary:** Wrap `<App />` in a class-based error boundary component that:
1. Catches render-time exceptions
2. Displays a "Something went wrong — click to restart" fallback UI
3. Resets `activeDialog` state to `null` on recovery

**Pipeline-level catch:** `handleGenerate` in `App.tsx` already wraps both pipelines in try/catch. For additional safety:
- If `executeAsModal` throws with `"Host is in a modal state"`, show a specific message: "Photoshop is busy. Close any open dialogs and try again."
- If an unknown error propagates past `userMessageFor()`, log it to `console.error` and surface a generic "Unexpected error. Check Developer Console for details."

**Implementation location:** Error boundary component goes in `src/components/error-boundary.tsx`. Wire it in `src/index.tsx` around the root React render.

---

## Timeout UX Behavior

Each provider has different expected response times. The progress dialog must handle timeout gracefully:

| Provider | Timeout | User experience |
|----------|---------|-----------------|
| fal.ai | 30s | Show "Taking longer than expected..." at 20s |
| Replicate | 60s | Show "Taking longer than expected..." at 40s |
| ChatGPT (backend) | 180s | Show "GPT Image generation can take 1-2 minutes..." at 30s |

**Timeout exceeded behavior:**
1. At warning threshold: update progress message (non-blocking, generation continues)
2. At hard timeout: abort the request, show error: "Generation timed out after Xs. The provider may be overloaded — try again later."
3. Cancel button remains active at all times — user can always abort

**Implementation:** Pass `timeoutMs` as part of `PipelineOptions`. Start a `setTimeout` at pipeline start that calls `abort()` on the `AbortController`. The warning message is triggered by a separate shorter timer that only updates the progress callback text.
