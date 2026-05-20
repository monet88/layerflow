---
title: "Phase 4: Provider Architecture + fal.ai"
sprint: 1
status: complete
priority: P1
effort: 3h
depends_on: [phase-01]
---

# Phase 4: Provider Architecture + fal.ai

## Context Links

- [plan.md](./plan.md) — Overview
- [researcher-openai-api-report.md](../reports/researcher-openai-api-report.md) — API formats, mask conventions
- [researcher-architecture-report.md](../reports/researcher-architecture-report.md) — Provider pattern (section 2.1)

## Overview

Implement the provider abstraction layer and the fal.ai provider (Sprint 1 primary). The architecture supports adding more providers later (Replicate in Sprint 2, backend/ChatGPT in Sprint 3) without changing the interface.

Sprint 1 ships with fal.ai only. This keeps the first release small and testable.

## Key Insights

**Mask conventions differ:**
- Internal convention: `transparent (alpha=0) = edit this pixel`
- fal.ai / Replicate convention: `white (RGB=255) = edit this pixel`
- Normalization happens inside each provider — callers always pass the internal convention

**fal.ai base64 URI:** fal.ai accepts `data:image/png;base64,...` URIs directly for `image_url` and `mask_url`. No file upload step needed for images <10MB.

**fal.ai models:**
- `fal-ai/flux-pro/v1/fill` — best inpainting quality (Flux Fill Pro)
- `fal-ai/nano-banana-2` — all-rounder, text rendering, fast
- `openai/gpt-image-2/edit` — GPT Image 2 via fal.ai (mask-based edit, highest quality, pay-per-call)

**Network client:** UXP `fetch()` silently fails on large (>5MB) uploads. To avoid waiting for a 30s timeout, the client proactively uses XHR instead of `fetch()` if the request body is larger than 5MB. Otherwise, it uses `fetch()` with an XHR fallback if it fails. Pattern adapted from `wuji419-bit/OpenAI-PS`.

## Requirements

**Functional:**
- `ProviderInterface`: TypeScript interface with `generate()` and `inpaint()` methods
- `ProviderRegistry`: factory keyed by provider ID, returns provider instance
- `FalAIProvider`: implements both methods for Flux Fill Pro + Nano Banana 2
- Provider normalizes mask convention internally (invert for fal.ai)
- `NetworkClient`: `fetch` with XHR fallback, configurable timeout, unified error type
- `ImageProcessor`: base64 encode/decode, mask convention inversion, data URI creation

**Non-functional:**
- No credentials hardcoded — passed as constructor args from storage
- Provider errors mapped to typed exceptions (RateLimitError, ContentPolicyError)
- Architecture extensible: adding a provider = 1 new file + registry entry

## Architecture

```
src/
├── providers/
│   ├── provider-interface.ts     # Types: Provider, GenerateOptions, InpaintOptions, ResultItem
│   ├── provider-registry.ts      # Registry: getProvider(id, credentials) → Provider
│   └── falai-provider.ts         # fal.ai: Flux Fill Pro, Nano Banana 2
├── services/
│   ├── network-client.ts         # fetch + XHR fallback, timeout, error normalization
│   └── image-processing.ts       # base64, mask inversion, data URI
├── storage/
│   ├── secure-storage.ts         # API key read/write via UXP secureStorage
│   └── settings-storage.ts       # Recent prompts, user preferences via localStorage
└── types/
    └── providers.ts              # Shared type re-exports
```

Data flow:

```
caller passes:
  sourceImage: Uint8Array (PNG bytes)
  maskImage: Uint8Array (RGBA PNG, alpha=0 = edit zone)
  prompt: string
  options: { model, width, height }

Provider does:
  1. Normalize mask convention (fal.ai: invert to white=edit)
  2. Encode to base64 data URIs
  3. Call NetworkClient.post(endpoint, payload, headers)
  4. Parse response → extract image URL or base64
  5. Return ResultItem[]
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/providers/provider-interface.ts` | TypeScript types for provider contract |
| `src/providers/provider-registry.ts` | Factory + registry (fal.ai only for now) |
| `src/providers/falai-provider.ts` | fal.ai implementation (Flux Fill Pro, Nano Banana 2, GPT Image 2) |
| `src/services/network-client.ts` | Reliable HTTP with XHR fallback |
| `src/services/image-processing.ts` | Image utilities (base64, mask inversion) |
| `src/storage/secure-storage.ts` | API key CRUD via UXP secureStorage (Phase 5 depends on this) |
| `src/storage/settings-storage.ts` | Recent prompts + user prefs via localStorage (Phase 5 depends on this) |

## Implementation Steps

1. Create `provider-interface.ts` — Provider interface, ProviderId, GenerateOptions (with signal), InpaintOptions, ResultItem (with imageUrl), error classes
2. Create `image-processing.ts` — bytesToBase64, base64ToBytes, bytesToDataUri, invertMaskConvention, resizeMaskToMatch(mask, targetWidth, targetHeight)
3. Create `network-client.ts` — request() with fetch→XHR fallback, checkedRequest() with error typing, fetchBytes() for downloading image URLs
4. Create `falai-provider.ts` — FalAIProvider implementing generate() + inpaint(). Must dispatch by model endpoint:
   - Flux Fill Pro: `image_url` + `mask_url` + `output_count`
   - Nano Banana 2: `image_urls` (array) + `resolution` + `aspect_ratio`
   - GPT Image 2: `image_urls` (array) + `mask_image_url` + `image_size` + `quality` + `input_fidelity`
5. Create `provider-registry.ts` — getProvider(), providerForModel()
6. Create `types/providers.ts` — re-export all public types
7. Create `storage/secure-storage.ts` — loadCredentials(), saveCredential(), clearCredential() via UXP secureStorage
8. Create `storage/settings-storage.ts` — getRecentPrompts(), saveRecentPrompt(), getUserPreferences()

## Provider Interface (TypeScript)

```typescript
export type ProviderId = 'falai' | 'replicate' | 'chatgpt-backend';
// Note: fal.ai provider handles both fal-native models (Flux, Nano Banana)
// AND fal-hosted third-party models (openai/gpt-image-2). Same auth, same response format.

export interface GenerateOptions {
  prompt: string;
  model: string;
  width?: number;
  height?: number;
  referenceImages?: Uint8Array[];
  signal?: AbortSignal;  // Cancellation support — providers MUST check signal.aborted in polling loops
}

export interface InpaintOptions extends GenerateOptions {
  sourceImage: Uint8Array;   // PNG bytes of region (with context padding)
  maskImage: Uint8Array;     // RGBA PNG, alpha=0 = edit zone (internal convention)
}

export interface ResultItem {
  pngBytes: Uint8Array;
  imageUrl?: string;        // Provider sets this when response is a URL (not inline bytes)
  revisedPrompt?: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  readonly supportedModels: string[];
  generate(options: GenerateOptions): Promise<ResultItem[]>;
  inpaint(options: InpaintOptions): Promise<ResultItem[]>;
}
```

## fal.ai Provider Details

**Inpainting (Flux Fill Pro):**
```
POST https://fal.run/fal-ai/flux-pro/v1/fill
Authorization: Key {api_key}
Content-Type: application/json

{
  "prompt": "...",
  "image_url": "data:image/png;base64,...",
  "mask_url": "data:image/png;base64,...",  // white=edit (inverted from internal convention)
  "output_count": 1,
  "safety_tolerance": 4
}
```

Note: Flux Fill Pro does NOT support `num_inference_steps` or `strength` params (those belong to flux-lora). Only `prompt`, `image_url`, `mask_url`, `enhance_prompt`, `output_count`, `seed`, `safety_tolerance` are valid.

**Generation (Nano Banana 2):**
```
POST https://fal.run/fal-ai/nano-banana-2
Authorization: Key {api_key}
Content-Type: application/json

{
  "prompt": "...",
  "num_images": 1,
  "resolution": "1K",
  "aspect_ratio": "1:1",
  "output_format": "png",
  "image_urls": ["data:image/png;base64,..."]
}
```

Note: Nano Banana 2 uses `resolution` (string: "1K", "2K", "4K") and `aspect_ratio` (string) — NOT `image_size: { width, height }`. Reference images are passed via `image_urls` array. Nano Banana 2 does NOT support mask-based inpainting (no `mask_url` param) — it is generate + reference image editing only.

**Response (all fal.ai models):** `{ "images": [{ "url": "https://...", "content_type": "image/png" }], "prompt": "..." }` — URLs must be fetched to get PNG bytes.

**GPT Image 2 (fal.ai hosted):**
```
POST https://fal.run/openai/gpt-image-2/edit
Authorization: Key {api_key}
Content-Type: application/json

{
  "prompt": "...",
  "image_urls": ["data:image/png;base64,..."],
  "mask_image_url": "data:image/png;base64,...",  // white=edit (inverted from internal convention)
  "image_size": "square",           // or "landscape_4_3", "portrait_3_4", custom dimensions
  "quality": "high",
  "num_images": 1,
  "output_format": "png",
  "input_fidelity": "high"          // strict preservation of non-masked areas
}
```

Note: GPT Image 2 uses `image_urls` (array) and `mask_image_url` (singular) — different from Flux Fill Pro's `image_url`/`mask_url`. Response format is the same as all fal.ai models: `{ "images": [{ "url": "...", "content_type": "..." }] }`.

**Data URI as input:** fal.ai accepts `data:image/png;base64,...` for `image_url`/`mask_url`/`image_urls` fields. This avoids a separate upload step for images <10MB. If data URIs fail at runtime, fall back to fal.ai file upload API (`POST https://fal.run/fal-ai/upload`). Mark as VERIFY during implementation.

## Network Client Strategy

```
request(url, options):
  1. If request body size > 5MB, bypass fetch and use XHR directly with 180s timeout (proactive fallback to avoid silent fetch failures).
  2. Otherwise, try fetch() with 30s timeout + AbortController.
  3. If fetch fails or timeouts → fallback to XHR with 180s timeout.
  4. Return normalized NetworkResponse
  
checkedRequest(url, options):
  1. Call request()
  2. If !ok: parse error body, throw typed errors (RateLimitError for 429, etc.)
  3. Return parsed JSON

fetchBytes(url):
  1. Call request(url, { method: 'GET' })
  2. Return response body as Uint8Array (arraybuffer)
  3. Used by providers to download generated images from URLs
```

## Success Criteria

- [ ] `FalAIProvider.inpaint()` sends correctly structured request with inverted mask (Flux Fill Pro)
- [ ] `FalAIProvider.inpaint()` sends correctly structured request for GPT Image 2 (image_urls + mask_image_url)
- [ ] `FalAIProvider.generate()` sends correct Nano Banana 2 request
- [ ] `FalAIProvider.generate()` sends correct GPT Image 2 generate request (no mask)
- [ ] `invertMaskConvention()` correctly converts alpha=0 → white pixels
- [ ] `NetworkClient.request()` falls back to XHR when fetch throws
- [ ] `RateLimitError` thrown on 429 response
- [ ] `getProvider('falai', { falai: 'key' })` returns FalAIProvider instance
- [ ] `getProvider('falai', {})` throws with user-friendly message
- [ ] `bytesToBase64` roundtrips correctly
- [ ] TypeScript compiles without errors

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| fal.ai data URI limit >10MB | Warn user; Phase 6 adds fal storage upload for large images |
| fal.ai returns URL (not base64) | Generation service (Phase 5) fetches URLs |
| XHR FormData boundary not set | Don't set Content-Type for multipart — let runtime handle |
| UXP AbortController unavailable | Wrapped in try/catch, XHR fallback always available |
