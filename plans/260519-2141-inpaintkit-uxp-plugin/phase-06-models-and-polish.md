---
title: "Phase 6: Models, History, and Resolution Bucketing"
sprint: 2
status: pending
priority: P2
effort: 12h
depends_on: [phase-05]
---

# Phase 6: Models, History, and Resolution Bucketing

## Context Links

- [plan.md](./plan.md) — Overview
- [/docs/development-roadmap.md](../../docs/development-roadmap.md) — Sprint 2 details

## Overview

Add Replicate as second direct provider, expand model selection (Nano Banana Pro, Seedream 5 Lite), implement UX features from InpaintKit v1.1-v1.5: resolution bucketing, reference images, prompt history.

## Requirements

**Functional:**
- Replicate provider: API key auth, prediction create + poll pattern
- Models: Nano Banana Pro (Replicate), Seedream 5 Lite (Replicate)
- Auto resolution bucketing: derive 1K/2K/4K from cropped selection max dimension
- Reference images: optional file picker, send alongside prompt
- Recent prompts: store last 3 successful prompts, show as clickable chips
- Output format: PNG when source has transparency, JPG otherwise

**Non-functional:**
- Model metadata (name, provider, cost hint, resolution options) in a single registry file
- Resolution bucketing logic decoupled from provider code

## Architecture

```
src/
├── providers/
│   ├── replicate-provider.ts     # Replicate: create prediction + poll status
│   └── model-registry.ts         # Model metadata: id, provider, resolutions, cost
├── components/
│   ├── prompt-input.tsx           # Updated: recent prompts chips below textarea (string[] → RecentPrompt[])
│   ├── model-selector.tsx         # Updated: more models, cost hints
│   └── reference-images.tsx       # Updated: file picker, preview thumbnails (from Phase 2 skeleton)
├── types/
│   └── ui-state.ts                # Updated: recentPrompts: string[] → RecentPrompt[]
├── services/
│   ├── image-processing.ts       # Updated: resolution bucketing
│   └── generation-service.ts     # Updated: pass model to saveRecentPrompt(prompt, model)
└── photoshop/
    └── document-utils.ts          # Updated: transparency detection for PNG/JPG switch
```

## Implementation Steps

### Step 6.1 — Create `model-registry.ts`

Central model metadata registry. All providers use this to look up model capabilities.

```typescript
export interface ModelDefinition {
  id: string;
  label: string;
  provider: 'falai' | 'replicate';
  endpoint: string;              // provider-specific model slug for default capability
  endpointByCapability?: {       // when generate vs inpaint hit different model slugs
    generate?: string;
    inpaint?: string;
  };
  capabilities: ('inpaint' | 'generate')[];
  resolutions: number[];         // supported max dimensions (e.g., [1024, 2048, 4096])
  defaultResolution: number;
  costHint: string;              // e.g., "$0.04/img", "$0.035/img"
  supportsReferenceImages: boolean;
}

export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  'flux-fill-pro': {
    id: 'flux-fill-pro',
    label: 'Flux Fill Pro (fal.ai)',
    provider: 'falai',
    endpoint: 'fal-ai/flux-pro/v1/fill',
    capabilities: ['inpaint'],
    resolutions: [1024, 2048],
    defaultResolution: 1024,
    costHint: '$0.05/img',
    supportsReferenceImages: false,
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    label: 'Nano Banana 2 (fal.ai)',
    provider: 'falai',
    endpoint: 'fal-ai/nano-banana-2',
    capabilities: ['generate'],  // No mask-based inpainting — uses reference images for editing
    resolutions: [1024, 2048, 4096],
    defaultResolution: 1024,
    costHint: '$0.04/img',
    supportsReferenceImages: true,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (fal.ai)',
    provider: 'falai',
    endpoint: 'openai/gpt-image-2/edit',  // default = inpaint endpoint
    endpointByCapability: {
      generate: 'openai/gpt-image-2',     // text-to-image
      inpaint:  'openai/gpt-image-2/edit', // mask-based edit
    },
    capabilities: ['inpaint', 'generate'],
    resolutions: [1024, 1536, 2048],
    defaultResolution: 1024,
    costHint: '$0.08/img',
    supportsReferenceImages: true,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro (Replicate)',
    provider: 'replicate',
    endpoint: 'fofr/nano-banana-pro',
    capabilities: ['inpaint', 'generate'],
    resolutions: [1024, 2048, 4096],
    defaultResolution: 1024,
    costHint: '$0.035/img',
    supportsReferenceImages: true,
  },
  'seedream-5-lite': {
    id: 'seedream-5-lite',
    label: 'Seedream 5 Lite (Replicate)',
    provider: 'replicate',
    endpoint: 'bytedance/seedream-5-lite',
    capabilities: ['inpaint', 'generate'],
    resolutions: [1024, 2048],
    defaultResolution: 1024,
    costHint: '$0.035/img',
    supportsReferenceImages: false,
  },
};

export function getModelDefinition(id: string): ModelDefinition {
  const def = MODEL_REGISTRY[id];
  if (!def) throw new Error(`Unknown model: ${id}`);
  return def;
}

/**
 * Resolve provider endpoint slug for a given (model, capability).
 * Falls back to `endpoint` when the model uses one slug for both modes.
 */
export function resolveEndpoint(model: ModelDefinition, capability: 'generate' | 'inpaint'): string {
  return model.endpointByCapability?.[capability] ?? model.endpoint;
}

export function getModelsForProvider(provider: string): ModelDefinition[] {
  return Object.values(MODEL_REGISTRY).filter(m => m.provider === provider);
}
```

### Step 6.2 — Create `replicate-provider.ts`

Implements same `Provider` interface from Phase 4. Uses prediction create + poll pattern.

**Replicate API notes (verified against official docs 2026-05-20):**
- Auth: `Authorization: Bearer {api_token}` (NOT "Key" like fal.ai)
- Official models: `POST /v1/models/{owner}/{name}/predictions` (no version needed)
- Non-official: `POST /v1/predictions` with `version` hash
- File inputs: data URIs only for < 256KB. For larger images (inpainting source/mask), upload first via `POST https://api.replicate.com/v1/files` then pass the returned URL.
- Poll statuses: `starting` → `processing` → `succeeded` | `failed` | `canceled`
- Cancel: `POST /v1/predictions/{id}/cancel` — call when AbortSignal fires to stop server-side processing

```typescript
import type { Provider, GenerateOptions, InpaintOptions, ResultItem } from './provider-interface';
import { NetworkClient, RateLimitError } from '../services/network-client';
import { bytesToBase64, invertMaskConvention, bytesToDataUri } from '../services/image-processing';

const REPLICATE_API = 'https://api.replicate.com/v1';
const POLL_INTERVAL = 2000;  // 2 seconds
const MAX_POLL_TIME = 120_000; // 2 minutes
// Replicate recommends data URIs only for files < 256KB.
// Inpainting images are typically 500KB-3MB, so we must upload first.
const DATA_URI_MAX_BYTES = 256 * 1024;

export class ReplicateProvider implements Provider {
  readonly id = 'replicate';
  readonly label = 'Replicate';
  readonly supportedModels = ['nano-banana-pro', 'seedream-5-lite'];

  constructor(private apiKey: string, private networkClient: NetworkClient) {}

  async generate(options: GenerateOptions): Promise<ResultItem[]> {
    return this._run(options.model, {
      prompt: options.prompt,
      width: options.width ?? 1024,
      height: options.height ?? 1024,
      ...(options.referenceImages?.length ? {
        reference_image: await this._fileInput(options.referenceImages[0]),
      } : {}),
    }, options.signal);
  }

  async inpaint(options: InpaintOptions): Promise<ResultItem[]> {
    const invertedMask = invertMaskConvention(options.maskImage);
    return this._run(options.model, {
      prompt: options.prompt,
      image: await this._fileInput(options.sourceImage),
      mask: await this._fileInput(invertedMask),  // Replicate: white=edit
      width: options.width,
      height: options.height,
    }, options.signal);
  }

  /** Upload file if > 256KB (Replicate data URI limit), otherwise use inline data URI */
  private async _fileInput(data: Uint8Array): Promise<string> {
    if (data.byteLength <= DATA_URI_MAX_BYTES) {
      return bytesToDataUri(data);
    }
    // Upload to Replicate file hosting and return the URL
    const res = await this.networkClient.checkedRequest(`${REPLICATE_API}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    });
    return res.urls?.get ?? res.url;
  }

  /** Create prediction → poll until succeeded/failed → download output */
  private async _run(modelSlug: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ResultItem[]> {
    // Use official models endpoint: POST /v1/models/{owner}/{name}/predictions
    const createRes = await this.networkClient.checkedRequest(
      `${REPLICATE_API}/models/${modelSlug}/predictions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait',  // Wait up to 60s for fast models before falling back to poll
        },
        body: JSON.stringify({ input }),
      }
    );

    // If Prefer:wait returned a completed prediction, skip polling
    if (createRes.status === 'succeeded') {
      return this._extractOutput(createRes.output, signal);
    }

    const predictionId = createRes.id;
    const predictionUrl = createRes.urls?.get ?? `${REPLICATE_API}/predictions/${predictionId}`;

    // Register cancel handler: abort signal → cancel prediction server-side
    const cancelOnAbort = () => {
      this.networkClient.checkedRequest(`${REPLICATE_API}/predictions/${predictionId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      }).catch(() => {}); // best-effort cancel
    };
    signal?.addEventListener('abort', cancelOnAbort, { once: true });

    try {
      // Poll for completion
      const result = await this._pollPrediction(predictionUrl, signal);
      return this._extractOutput(result.output, signal);
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
    }
  }

  private async _extractOutput(output: string | string[], signal?: AbortSignal): Promise<ResultItem[]> {
    const outputUrls = Array.isArray(output) ? output : [output];
    const items: ResultItem[] = [];
    for (const url of outputUrls) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const imgBytes = await this.networkClient.fetchBytes(url);
      items.push({ pngBytes: imgBytes });
    }
    return items;
  }

  private async _pollPrediction(url: string, signal?: AbortSignal): Promise<{ output: string | string[]; status: string }> {
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_POLL_TIME) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const res = await this.networkClient.checkedRequest(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (res.status === 'succeeded') return res;
      if (res.status === 'failed' || res.status === 'canceled') {
        throw new Error(`Replicate prediction failed: ${res.error || 'unknown error'}`);
      }
      // Wait before next poll
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error('Replicate prediction timed out after 2 minutes');
  }
}
```

### Step 6.3 — Resolution bucketing in `image-processing.ts`

```typescript
/** Resolution buckets: pick closest supported size based on selection max dimension */
export type ResolutionBucket = 1024 | 2048 | 4096;

const BUCKETS: ResolutionBucket[] = [1024, 2048, 4096];

/**
 * Auto-select resolution bucket from cropped selection dimensions.
 * Strategy: use the smallest bucket that covers the max dimension.
 * Falls back to model's default if selection is smaller than 1K.
 */
export function selectResolutionBucket(
  selectionWidth: number,
  selectionHeight: number,
  supportedResolutions: number[],
): ResolutionBucket {
  const maxDim = Math.max(selectionWidth, selectionHeight);

  // Filter to only model-supported buckets, ascending
  const available = BUCKETS
    .filter(b => supportedResolutions.includes(b))
    .sort((a, b) => a - b);

  if (available.length === 0) return 1024; // safe fallback

  // Smallest bucket that covers the max dimension
  for (const bucket of available) {
    if (bucket >= maxDim) return bucket;
  }

  // Selection larger than all buckets → use largest available
  return available[available.length - 1] as ResolutionBucket;
}
```

### Step 6.4 — Update `src/components/reference-images.tsx` (file picker + thumbnails)

```typescript
import React from 'react';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';

interface Props {
  paths: string[];
  onAdd: () => void;       // triggers UXP file picker (Phase 3 storage API)
  onRemove: (index: number) => void;
}

export function ReferenceImages({ paths, onAdd, onRemove }: Props) {
  return (
    <div>
      <div class="section-label">Reference Images (optional)</div>
      {paths.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.split('/').pop()}
          </span>
          <sp-action-button size="s" onClick={() => onRemove(i)}>✕</sp-action-button>
        </div>
      ))}
      <sp-button variant="secondary" size="s" onClick={onAdd} disabled={paths.length >= 3}>
        Add Reference Image
      </sp-button>
    </div>
  );
}
```

### Step 6.5 — Recent prompts storage + chips

```typescript
// In settings-storage.ts — add to existing file from Phase 4

const MAX_RECENT_PROMPTS = 3;

export interface RecentPrompt {
  text: string;
  model: string;
  timestamp: number;
}

export function getRecentPrompts(): RecentPrompt[] {
  try {
    const raw = localStorage.getItem('inpaintkit_recent_prompts');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveRecentPrompt(prompt: string, model: string): void {
  const existing = getRecentPrompts().filter(p => p.text !== prompt);
  const updated = [{ text: prompt, model, timestamp: Date.now() }, ...existing].slice(0, MAX_RECENT_PROMPTS);
  localStorage.setItem('inpaintkit_recent_prompts', JSON.stringify(updated));
}
```

### Step 6.6 — Prompt chips UI in `prompt-input.tsx`

Add recent prompt chips below the textarea:

```typescript
// Addition to PromptInput component from Phase 2
const recentPrompts = getRecentPrompts();

{recentPrompts.length > 0 && (
  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
    {recentPrompts.map((rp, i) => (
      <sp-action-button
        key={i}
        size="xs"
        onClick={() => onPromptChange(rp.text)}
        title={rp.text}
        style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {rp.text.length > 20 ? rp.text.slice(0, 20) + '…' : rp.text}
      </sp-action-button>
    ))}
  </div>
)}
```

### Step 6.7 — PNG/JPG output format detection in `document-utils.ts`

```typescript
/**
 * Detect if source document region has transparency.
 * If transparent → output as PNG (preserves alpha).
 * If opaque → output as JPG (smaller file size).
 */
export function detectOutputFormat(sourcePixels: Uint8Array, width: number, height: number): 'png' | 'jpg' {
  // sourcePixels is RGBA buffer (4 bytes per pixel)
  for (let i = 3; i < sourcePixels.length; i += 4) {
    if (sourcePixels[i] < 255) return 'png'; // found transparent pixel
  }
  return 'jpg';
}
```

### Step 6.8 — Register Replicate provider in `provider-registry.ts`

```typescript
// Addition to existing registry from Phase 4
import { ReplicateProvider } from './replicate-provider';

// In getProvider():
case 'replicate':
  if (!credentials.replicate) throw new Error('Replicate API key required. Add it in Settings.');
  return new ReplicateProvider(credentials.replicate, networkClient);
```

### Step 6.9 — Update `model-selector.tsx` with cost hints

```typescript
// MODEL_OPTIONS updated to pull from registry
import { MODEL_REGISTRY, type ModelDefinition } from '../providers/model-registry';

const MODEL_OPTIONS = Object.values(MODEL_REGISTRY).map(m => ({
  value: m.id,
  label: `${m.label} — ${m.costHint}`,
  provider: m.provider,
}));
```

## Success Criteria

- [ ] Replicate provider works end-to-end (create + poll + download)
- [ ] Nano Banana Pro generates 4K output from selection
- [ ] Seedream 5 Lite generates at $0.035/image cost tier
- [ ] Resolution auto-selects 1K/2K/4K based on selection size
- [ ] Reference images sent to supporting models
- [ ] Recent prompts show after first successful generation
- [ ] PNG/JPG output format selected based on source transparency

## Risk Assessment

- Replicate cold start can be slow (20-60s) — show clear progress message
- Resolution bucketing thresholds need empirical tuning in real PS workflows
- Reference images increase upload size — may hit UXP fetch limit, XHR fallback critical
- Replicate model slugs may change — keep in model-registry.ts for easy update
