# Provider API Verification

Verified against official documentation (2026-05-20).

---

## fal.ai

Source: `fal.ai/models` (Context7, benchmark 74.5, high reputation) + `fal.ai/docs` (benchmark 77.3).

### Authentication

```
Authorization: Key YOUR_API_KEY
```

Prefix is `Key` (not `Bearer`).

### Endpoints

| Model | Endpoint URL | Purpose |
|-------|-------------|---------|
| Flux Fill Pro | `POST https://fal.run/fal-ai/flux-pro/v1/fill` | Inpainting |
| Nano Banana 2 | `POST https://fal.run/fal-ai/nano-banana-2` | Text-to-image + reference editing |
| Nano Banana Pro | `POST https://fal.run/fal-ai/nano-banana-pro` | Text-to-image + reference editing |

### Flux Fill Pro (Inpainting)

**Params (verified):**
```json
{
  "prompt": "required",
  "image_url": "required — URL or data URI",
  "mask_url": "required — URL or data URI, white=edit region",
  "enhance_prompt": "optional boolean",
  "output_count": "optional integer 1-4 (default 1)",
  "seed": "optional integer",
  "safety_tolerance": "optional integer 1-6"
}
```

**NOT valid for Flux Fill Pro:**
- `num_inference_steps` — belongs to flux-lora models
- `strength` — belongs to flux-lora models
- `num_images` — use `output_count` instead
- `image_size` — not applicable

**Pricing:** $0.05 per megapixel (rounded up).

### Nano Banana 2 (Generation + Reference Editing)

**Params (verified):**
```json
{
  "prompt": "required",
  "num_images": "optional integer 1-4 (default 1)",
  "resolution": "optional string: '1K', '2K', '4K'",
  "aspect_ratio": "optional string: '1:1', '16:9', 'auto', etc.",
  "output_format": "optional string: 'png', 'jpeg'",
  "safety_tolerance": "optional string (level 1-6)",
  "sync_mode": "optional boolean — return data URI if true",
  "image_urls": "optional array of URLs — reference images for editing",
  "limit_generations": "optional boolean — limit to 1 output",
  "enable_web_search": "optional boolean"
}
```

**NOT valid for Nano Banana 2:**
- `image_size: { width, height }` — use `resolution` string instead
- `mask_url` — Nano Banana 2 does NOT support mask-based inpainting
- `num_inference_steps` — not applicable
- `strength` — not applicable

**Capabilities:** Generate + reference-image editing. NOT mask-based inpainting.

### Nano Banana Pro (Replicate version also exists on fal.ai)

Same params as Nano Banana 2 but via different endpoint: `POST https://fal.run/fal-ai/nano-banana-pro`

### Response Format (All fal.ai models)

```json
{
  "images": [
    { "url": "https://...", "content_type": "image/jpeg" }
  ],
  "prompt": "the prompt used"
}
```

Images are returned as URLs that must be fetched to get bytes.

### File Input (Data URI vs Upload)

fal.ai accepts `data:image/png;base64,...` strings for `image_url`, `mask_url`, and `image_urls` fields. This is the documented pattern for the REST API.

**Caveat:** Not explicitly documented for input fields in official API reference — only `sync_mode: true` for output is documented. However, community usage and fal.ai client libraries confirm data URI support for inputs. Mark as runtime-verified.

If data URIs fail (e.g., payload too large), fall back to fal.ai file upload:
- `POST https://fal.run/fal-ai/upload` (undocumented, verify at implementation time)

### Mask Convention

- **fal.ai:** White pixels (RGB=255) = area to edit/fill
- **Internal (InpaintKit):** Alpha=0 = area to edit
- **Conversion:** Provider inverts mask before sending (implemented in `image-processing.ts`)

Note: Mask convention is not explicitly documented in fal.ai API docs. Based on community consensus and standard diffusion model conventions.

### GPT Image 2 (fal.ai hosted)

Source: `fal-ai-community/skills` repo (gpt-image-2 prompting reference, verified 2026-05-20).

fal.ai hosts OpenAI's GPT Image 2 as a managed endpoint. Same auth (`Key` prefix), same response format as other fal.ai models.

**Endpoints:**

| Mode | Endpoint URL | Purpose |
|------|-------------|---------|
| Generate | `POST https://fal.run/openai/gpt-image-2` | Text-to-image |
| Edit | `POST https://fal.run/openai/gpt-image-2/edit` | Image edit with optional mask (up to 16 input images) |

**Edit params (verified from fal-ai-community/skills):**
```json
{
  "prompt": "required",
  "image_urls": "required — array of URLs or data URIs (source images)",
  "mask_image_url": "optional — URL or data URI, white=edit region",
  "image_size": "optional string: 'square', 'landscape_4_3', 'portrait_3_4', or custom",
  "quality": "optional string: 'high', 'medium', 'low'",
  "num_images": "optional integer 1-4 (default 1)",
  "output_format": "optional string: 'png', 'jpeg', 'webp'",
  "input_fidelity": "optional string: 'high' — strict preservation of non-masked areas"
}
```

**Key differences from Flux Fill Pro:**
- Uses `image_urls` (array) instead of `image_url` (string)
- Uses `mask_image_url` instead of `mask_url`
- Supports multi-image compositing (up to 16 images)
- Has `input_fidelity` param for edit preservation control
- Uses `image_size` (string presets) instead of no size param

**Pricing:** ~$0.08 per image (estimated, verify at runtime via fal.ai pricing page).

**Response format:** Same as all fal.ai models: `{ "images": [{ "url": "...", "content_type": "..." }] }`

---

## Replicate

Source: `replicate.com/docs` (Context7, benchmark 76.2, high reputation).

### Authentication

```
Authorization: Bearer YOUR_API_TOKEN
```

Prefix is `Bearer` (not `Key`).

### Endpoints

**Official models (no version hash needed):**
```
POST https://api.replicate.com/v1/models/{owner}/{name}/predictions
```

**Non-official models (version hash required):**
```
POST https://api.replicate.com/v1/predictions
Body: { "version": "owner/name:hash", "input": {...} }
```

### Create Prediction

```bash
curl -X POST \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: wait" \
  -d '{"input": {"prompt": "..."}}' \
  https://api.replicate.com/v1/models/{owner}/{name}/predictions
```

**Headers:**
- `Prefer: wait` — wait up to 60s for completion before returning (avoids polling for fast models)
- Without this header, returns immediately in `starting` state

**Response:**
```json
{
  "id": "abc123",
  "status": "starting",
  "input": {...},
  "output": null,
  "urls": {
    "get": "https://api.replicate.com/v1/predictions/abc123",
    "cancel": "https://api.replicate.com/v1/predictions/abc123/cancel"
  }
}
```

### Poll Prediction

```
GET https://api.replicate.com/v1/predictions/{id}
Authorization: Bearer $REPLICATE_API_TOKEN
```

**Status values:**
| Status | Terminal? | Meaning |
|--------|-----------|---------|
| `starting` | No | Model is booting (cold start) |
| `processing` | No | Model is running |
| `succeeded` | Yes | Output ready |
| `failed` | Yes | Error occurred (check `error` field) |
| `canceled` | Yes | Canceled by user |

### Cancel Prediction

```
POST https://api.replicate.com/v1/predictions/{id}/cancel
Authorization: Bearer $REPLICATE_API_TOKEN
```

Map `AbortSignal.abort()` → call this endpoint to stop server-side processing.

### File Inputs

| File size | Method | Format |
|-----------|--------|--------|
| < 256KB | Data URI | `data:image/png;base64,...` inline in `input` |
| > 256KB | URL | Upload first, pass URL to `input` |

**Important:** Inpainting source images (1024x1024+ PNG) are 500KB-3MB. Data URIs NOT recommended — use file upload first.

**File upload:**
```
POST https://api.replicate.com/v1/files
Authorization: Bearer $REPLICATE_API_TOKEN
Content-Type: application/octet-stream
Body: <raw bytes>
```

Returns: `{ "url": "https://...", "urls": { "get": "https://..." } }`

### Output Format

Image models typically return output as:
- Array of URL strings: `["https://replicate.delivery/..."]`
- Single URL string: `"https://replicate.delivery/..."`

URLs must be fetched to get PNG/JPEG bytes.

### Mask Convention

Same as fal.ai: white pixels (RGB=255) = area to edit. Provider inverts from internal convention before sending.

---

## ChatGPT Web API (Reverse Proxy)

Source: `/home/monet/dev/chatgpt2api/services/openai_backend_api.py` (verified 2026-05-20).
NOT an official API — reverse-engineered from ChatGPT web client behavior.

### Architecture Decision

**Fork/adapt chatgpt2api** rather than rewrite. The PoW, Turnstile, and Azure Blob upload logic is too complex to reimplement and requires ongoing maintenance against OpenAI's anti-bot updates.

### Authentication

```
Authorization: Bearer {access_token}
```

`access_token` obtained via Codex Device Code OAuth flow.

### Base URL

```
https://chatgpt.com
```

### Image Generation Flow

```
Step 1: Bootstrap
  GET /
  Headers: browser-like (Accept-Language, Sec-Ch-Ua, etc.)
  Purpose: Extract PoW script sources from HTML

Step 2: Get Chat Requirements
  POST /backend-api/sentinel/chat-requirements
  Body: { "p": legacy_requirements_token }
  Returns: { token, proofofwork: { required, seed, difficulty }, turnstile, arkose }
  Action: Solve PoW challenge → proof_token

Step 3: Upload Image(s) — 3-step Azure Blob
  3a. POST /backend-api/files
      Body: { file_name, file_size, use_case: "multimodal", width, height }
      Returns: { file_id, upload_url }
  3b. PUT {upload_url}
      Headers: Content-Type: image/png, x-ms-blob-type: BlockBlob, x-ms-version: 2020-04-08
      Body: raw image bytes
  3c. POST /backend-api/files/{file_id}/uploaded
      Body: {}
      Returns: 200 OK

Step 4: Prepare Conversation
  POST /backend-api/f/conversation/prepare
  Body: { action: "next", model, system_hints: ["picture_v2"], partial_query, ... }
  Returns: { conduit_token }

Step 5: Start Generation (SSE)
  POST /backend-api/f/conversation
  Headers: X-Conduit-Token, OpenAI-Sentinel-Chat-Requirements-Token, OpenAI-Sentinel-Proof-Token
  Body: {
    action: "next",
    messages: [{ content: { content_type: "multimodal_text", parts: [image_asset_pointers, prompt] } }],
    model: "gpt-5-3",
    system_hints: ["picture_v2"],
    ...
  }
  Returns: SSE stream (extract conversation_id from events)

Step 6: Poll Results
  GET /backend-api/conversation/{conversation_id}
  Timing: initial wait 10s, poll every 10s, timeout 120-150s
  Backoff: exponential on 429/5xx (capped 16s, +jitter)
  Look for: "file-service://FILE_ID" or "sediment://SEDIMENT_ID" in message mapping
  Terminal: message with async_task_type: "image_gen" containing file_ids

Step 7: Download Image
  Primary:   GET /backend-api/files/{file_id}/download → { download_url }
  Fallback:  GET /backend-api/conversation/{conv_id}/attachment/{sediment_id}/download → { download_url }
  Then:      GET {download_url} → image bytes
```

### Required Headers (All Requests)

| Header | Value | Source |
|--------|-------|--------|
| `Authorization` | `Bearer {access_token}` | Codex OAuth |
| `X-OpenAI-Target-Path` | Request path | Hardcoded per request |
| `X-OpenAI-Target-Route` | Request path | Same as above |
| `OAI-Device-Id` | UUID v4 | Persistent per session |
| `OAI-Session-Id` | UUID v4 | Persistent per session |
| `User-Agent` | Chrome/Edge UA string | Browser impersonation |
| `Sec-Ch-Ua` | Chrome/Edge value | Browser impersonation |
| `Sec-Ch-Ua-Mobile` | `?0` | Desktop |
| `Sec-Ch-Ua-Platform` | `"Windows"` | Browser impersonation |

### Image Generation Headers (Additional)

| Header | Value | Source |
|--------|-------|--------|
| `OpenAI-Sentinel-Chat-Requirements-Token` | JWT-like token | From step 2 |
| `OpenAI-Sentinel-Proof-Token` | PoW solution | From step 2 |
| `X-Conduit-Token` | Token string | From step 4 |
| `X-Oai-Turn-Trace-Id` | UUID v4 | Per-SSE request |

### Model Slug Mapping

| User-facing model | Conversation model slug |
|-------------------|------------------------|
| `gpt-image-2` | `gpt-5-3` |
| `codex-gpt-image-2` | `codex-gpt-image-2` (kept as-is) |
| `auto` | `auto` |

### Image Asset Pointer Format

```json
{
  "content_type": "image_asset_pointer",
  "asset_pointer": "file-service://{file_id}",
  "width": 1024,
  "height": 1024,
  "size_bytes": 524288
}
```

### Device Code OAuth (Plugin Side)

Plugin-side implementation now uses the auth endpoints above directly, stores `accessToken` / `refreshToken` in plugin secure storage, and registers the active ChatGPT session with the backend separately. Per-image edit requests use the backend API key plus `X-User-Id`; the OAuth access token is not sent on every image edit request.

From cc-switch source (`src/lib/api/auth.ts`):

**Provider:** `"codex_oauth"`

**Response shape:**
```typescript
interface ManagedAuthDeviceCodeResponse {
  provider: ManagedAuthProvider;
  device_code: string;
  user_code: string;      // 8-char code displayed to user
  verification_uri: string; // URL user opens in browser
  expires_in: number;     // seconds until code expires
  interval: number;       // minimum poll interval (seconds)
}
```

**Polling:** `interval + 3` seconds (minimum 8s). On `slow_down` or HTTP 429, increase the wait by 5s before retrying. Stop when `expires_in` reached.

**Endpoints (from research report):**
- Device code request: `POST auth.openai.com/api/accounts/deviceauth/usercode`
- Token poll: `POST auth.openai.com/api/accounts/deviceauth/token`
- Token refresh: `POST auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (Codex public client — configurable)

---

## Verification Status

| Plan Section | Status | Notes |
|-------------|--------|-------|
| fal.ai auth header | OK | `Key` prefix correct |
| fal.ai Flux Fill Pro endpoint | OK | URL matches docs |
| fal.ai Flux Fill Pro params | FIXED | Removed invalid num_inference_steps, strength; changed num_images→output_count |
| fal.ai Nano Banana 2 endpoint | OK | URL matches docs |
| fal.ai Nano Banana 2 params | FIXED | Changed image_size to resolution/aspect_ratio |
| fal.ai Nano Banana 2 capabilities | FIXED | Removed inpaint (no mask_url support) |
| fal.ai response format | OK | `{ images: [{ url, content_type }] }` |
| fal.ai data URI input | VERIFY | Community confirmed, not explicit in docs |
| fal.ai mask convention | VERIFY | Community consensus, not in API docs |
| Replicate auth header | OK | `Bearer` prefix in plan code |
| Replicate endpoint format | FIXED | Changed to /v1/models/{owner}/{name}/predictions |
| Replicate file input size | FIXED | Added upload for >256KB images |
| Replicate polling statuses | OK | succeeded/failed/canceled documented |
| Replicate cancel endpoint | FIXED | Added server-side cancel on AbortSignal |
| Replicate Prefer:wait | FIXED | Changed from respond-async to wait |
| ChatGPT image generation flow | OK | Verified against chatgpt2api source — 7-step flow documented |
| ChatGPT model slug mapping | FIXED | Added gpt-image-2 → gpt-5-3 mapping to Phase 8 |
| ChatGPT sentinel/PoW tokens | OK | Documented in Phase 8; complexity handled by chatgpt_core fork |
| ChatGPT file upload (Azure Blob) | OK | 3-step flow documented with correct headers |
| ChatGPT browser fingerprint headers | OK | All required headers documented in Phase 8 |
| ChatGPT result extraction (dual path) | OK | file-service:// and sediment:// both documented |
| ChatGPT polling behavior | OK | Initial wait 10s, interval 10s, backoff on 429 documented |
| ChatGPT architecture (fork vs rewrite) | CHANGED | Fork/adapt chatgpt2api instead of rewriting from scratch |
| Device Code OAuth flow | OK | Verified against cc-switch source; +3s buffer confirmed |
| fal.ai GPT Image 2 endpoint | OK | `openai/gpt-image-2/edit` verified from fal-ai-community/skills |
| fal.ai GPT Image 2 params | OK | image_urls (array), mask_image_url, image_size, quality, input_fidelity |
| fal.ai GPT Image 2 response | OK | Same format as other fal.ai models: `{ images: [{ url }] }` |
