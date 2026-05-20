# Research Report: OpenAI Image API & ChatGPT OAuth for Photoshop Plugin

**Date:** 2026-05-19
**Scope:** gpt-image-1/DALL-E 3 API, ChatGPT device-code OAuth, inpainting mechanics, alternative providers, multi-provider best practices.

---

## 1. OpenAI Image API — Endpoints, Models, Formats

### 1.1 Available Endpoints

| Endpoint | Purpose | Models |
|---|---|---|
| `POST /v1/images/generations` | Text-to-image, stateless | gpt-image-1, gpt-image-2, dall-e-3, dall-e-2 |
| `POST /v1/images/edits` | Inpainting/editing with mask | gpt-image-1 family, dall-e-2 |
| `POST /v1/responses` | Conversational image gen (stateful, tool-call model) | gpt-image-1, gpt-image-2 |

**Key distinction:** `/v1/images/generations` is stateless — no session memory. `/v1/responses` uses `previous_response_id` for iterative editing, matching the ChatGPT web workflow. For a Photoshop plugin doing single-shot inpainting, `/v1/images/edits` is the correct endpoint.

### 1.2 Request Format

**Generations endpoint (`/v1/images/generations`) — JSON body:**
```json
{
  "model": "gpt-image-1",
  "prompt": "A photorealistic oak tree",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "background": "auto"
}
```

**Edits endpoint (`/v1/images/edits`) — multipart/form-data:**
```
POST /v1/images/edits
Content-Type: multipart/form-data

image=<PNG file, <50MB>
mask=<PNG file with alpha channel, <4MB, same dims as image>
prompt=<string, up to 32000 chars>
model=gpt-image-1
n=1
size=1024x1024
quality=high
output_format=png
```

### 1.3 Response Format

- **gpt-image-1 family:** Always returns `b64_json` — no `url` option. Response shape:
  ```json
  {
    "created": 1714000000,
    "data": [{ "b64_json": "<base64 string>" }]
  }
  ```
- **dall-e-3 / dall-e-2:** Returns either `url` (valid 60 min) or `b64_json` based on `response_format` param. Default is `url`.

**Plugin implication:** Must decode base64 when using gpt-image-1. Cannot cache a URL and use it later.

### 1.4 Image Sizes

| Model | Supported Sizes |
|---|---|
| gpt-image-1 | 1024×1024, 1536×1024, 1024×1536, auto |
| gpt-image-2 | Arbitrary WxH (divisible by 16, ratio 1:3 to 3:1), max 2048px |
| dall-e-3 | 1024×1024, 1792×1024, 1024×1792 |
| dall-e-2 | 256×256, 512×512, 1024×1024 |

### 1.5 Quality Settings

| Model | Quality Options |
|---|---|
| gpt-image-1 | `low`, `medium`, `high` |
| dall-e-3 | `standard`, `hd` |
| dall-e-2 | N/A |

Additional gpt-image-1 parameters:
- `output_format`: `png` (default), `jpeg`, `webp`
- `background`: `transparent`, `opaque`, `auto`
- `input_fidelity`: `low` (default), `high` — controls how closely edits match source image facial/style features (gpt-image-1 and 1.5 only, not mini)

---

## 2. gpt-image-1 vs. DALL-E 3 — Differences

| Feature | gpt-image-1 | dall-e-3 |
|---|---|---|
| Release | Apr 2025 | Nov 2023 |
| Editing/inpainting | Yes | No |
| Max resolution | 2048×2048 | 1792×1024 |
| Quality tiers | 3 (low/med/high) | 2 (standard/hd) |
| Text rendering | Superior | Mediocre |
| Rate limit (API) | 5 imgs/min | 7 imgs/min |
| Speed | 6–10 sec | 20–30 sec |
| Prompt max length | 32,000 chars | 4,000 chars |
| Billing | Token-based + per-image | Per-image flat |
| Response format | b64_json only | url or b64_json |
| Org verification req. | Yes | No |
| Conversational | Yes (via /v1/responses) | No |

**Pricing (per image, approximate):**

| Model | Low quality | Medium | High |
|---|---|---|---|
| gpt-image-1 | ~$0.02 | ~$0.07 | ~$0.19 |
| gpt-image-1-mini | ~$0.005–0.006 | — | — |
| dall-e-3 standard | — | $0.04 | — |
| dall-e-3 HD | — | — | $0.08 |

**Rate limits (API keys, not ChatGPT subscriptions):**
- gpt-image-1: 5 imgs/min (Tier 1), higher tiers get more
- dall-e-3: 7 imgs/min (Tier 1)
- ChatGPT Plus (OAuth path): 50 imgs per 3-hour window

**Organization verification:** gpt-image-1 requires API Organization Verification from the developer console before use. This is a one-time identity check, not per-request.

---

## 3. OpenAI Images Edit API — Inpainting Details

### 3.1 How Inpainting Works

The edit endpoint accepts a source image + mask + prompt. The mask defines which areas the model regenerates.

**Mask semantics (RGBA PNG):**
- Alpha = 0 (transparent) → model **edits** this region
- Alpha = 255 (opaque) → model **preserves** this region

**Mask requirements:**
- Format: PNG with alpha channel
- Size: < 4MB
- Dimensions: Must exactly match source image dimensions
- Applied to: First image in the array (if multiple images provided)

**Python mask preparation pattern:**
```python
from PIL import Image
import io

mask = Image.open("mask_bw.png").convert("L")
mask_rgba = mask.convert("RGBA")
mask_rgba.putalpha(mask)  # black=transparent=edit, white=opaque=preserve
buf = io.BytesIO()
mask_rgba.save(buf, format="PNG")
mask_bytes = buf.getvalue()
```

### 3.2 Behavioral Difference: gpt-image-1 vs. dall-e-2 Inpainting

**dall-e-2:** True pixel-level inpainting — transparent mask areas are replaced, rest is preserved exactly. Predictable, precise.

**gpt-image-1:** Soft mask, prompt-guided inpainting — model uses the mask as guidance but may not respect exact pixel boundaries. It performs full image recreation influenced by the mask and prompt. Community reports confirm the model sometimes edits outside the mask area. This is by design — it produces more coherent, context-aware fills but sacrifices pixel-perfect masking.

**Plugin implication:** For Photoshop integration where users draw precise selection masks, gpt-image-1's soft masking may produce surprising edits outside the selection. Consider offering dall-e-2 as a "precise inpainting" fallback, or clearly communicating this behavior to users.

### 3.3 Multiple Image Inputs

- Up to 10 images as input to the edit endpoint
- Up to 16 images for generations with gpt-image-1
- Each image: PNG, WebP, or JPG, < 50MB
- Max prompt: 32,000 characters

### 3.4 Source Image Format for Photoshop

Photoshop exports: The plugin should export the current canvas selection as a PNG (preserve alpha if present). For the mask, export the selection as a black-and-white PNG then convert to RGBA with alpha-from-grayscale. If the selection is a Photoshop mask layer, the conversion step is still required — OpenAI does not accept grayscale-only PNGs as masks.

---

## 4. ChatGPT OAuth Device Code Flow

### 4.1 Overview

The device authorization grant (RFC 8628) lets a headless or non-browser environment authenticate a user via a secondary browser session. OpenAI's Codex CLI implements this for ChatGPT account login.

**Use case for InpaintKit:** Allows the plugin to use the user's ChatGPT Plus/Pro subscription entitlements (image generation quota included in subscription) without requiring a separate API key with billing.

### 4.2 Flow Steps

1. Plugin posts to `/deviceauth/usercode` → receives `device_code`, `user_code`, `verification_uri`
2. Plugin shows user: "Go to `https://auth.openai.com/codex/device` and enter code `ABCD-1234`"
3. Plugin polls `/deviceauth/token` every ~5 seconds (15-minute window)
4. User completes ChatGPT sign-in + MFA + workspace selection in browser
5. Poll returns `id_token`, `access_token`, `refresh_token`
6. Tokens persisted locally

### 4.3 OAuth Endpoints & Credentials

| Component | Value |
|---|---|
| Client ID | `app_EMoamEEZ73f0CkXaXp7hrann` (OpenAI's public Codex client ID) |
| Authorization endpoint | `https://auth.openai.com/oauth/authorize` |
| Token endpoint | `https://auth.openai.com/oauth/token` |
| Device verification URL | `https://auth.openai.com/codex/device` |
| User code initiation | `POST /deviceauth/usercode` |
| Token poll | `POST /deviceauth/token` |

Uses **PKCE** (Proof Key for Code Exchange) — `PkceCodes` code challenge/verifier generated client-side.

### 4.4 Token Refresh

Tokens are refreshed automatically when expiring within 5 minutes. The refresh uses the standard OAuth refresh_token grant. Codex CLI stores tokens at `~/.codex/auth.json` (plaintext) or in the OS keyring (encrypted). For a Photoshop plugin, storing in the OS credential store (macOS Keychain / Windows Credential Manager) is the right approach.

### 4.5 What API Endpoints the OAuth Token Accesses

**What it accesses:** `chatgpt.com/backend-api/codex/responses` — this is the ChatGPT internal responses endpoint, not `api.openai.com`. It exposes an OpenAI-compatible interface backed by the user's ChatGPT subscription quota.

**What it does NOT access:** `api.openai.com/v1/images/edits` directly. The OAuth token is for the ChatGPT backend API, not the developer API. Community projects expose a local proxy at `http://127.0.0.1:10531/v1` that translates OpenAI SDK calls to the ChatGPT backend format.

**Critical caveat:** Third-party use of this OAuth flow (using the Codex client ID) is unofficial and unsupported. OpenAI's backend checks for a specific system prompt shape expected by Codex CLI. If OpenAI changes this check, third-party integrations break. This is a fragile dependency — not appropriate for a production plugin distributed to customers.

**Codex authorization scope in ChatGPT settings:** In ChatGPT account settings under "Connected apps" or "Authorization," Codex appears as an authorized application. Users can revoke access there.

### 4.6 Risk Assessment for InpaintKit

| Aspect | Risk Level | Notes |
|---|---|---|
| API stability | High | Unofficial endpoint; no SLA |
| Breaking changes | High | System prompt check can change without notice |
| ToS compliance | Medium | Personal use OK; distributing a plugin using Codex credentials is gray area |
| Token security | Medium | Tokens give full ChatGPT account access |
| User experience | Low risk | Familiar browser flow, no API key management |

**Recommendation:** Use the ChatGPT OAuth flow only as an optional "use your ChatGPT subscription" convenience path. Always provide the standard API key path as primary. Do not hardcode the Codex client ID in a distributed plugin — it couples you to Codex's internal protocol.

---

## 5. Alternative Providers

### 5.1 fal.ai

**Authentication:** `FAL_KEY` env var or `fal.config({ credentials: "..." })`. Single API key, all models.

**Inpainting request (JavaScript):**
```js
const result = await fal.subscribe("fal-ai/flux-pro/v1/fill", {
  input: {
    prompt: "a garden with flowers",
    image_url: "https://...",   // or base64 data URI
    mask_url: "https://...",    // white = edit, black = preserve (INVERTED vs OpenAI)
    num_inference_steps: 25,
    strength: 0.95
  }
});
// result.images[0].url
```

**Mask convention (INVERTED from OpenAI):**
- fal.ai: white = area to fill, black = preserve
- OpenAI: transparent = edit, opaque = preserve

**Key advantages:**
- 50% market share in generative media infrastructure (State of Generative Media report)
- Cold starts 5–10s vs 20–60s on competitors; Flux 4x faster than other platforms
- Single billing for Flux Pro, SDXL, Stable Diffusion, Qwen, and more
- ~$0.03/megapixel (cheaper than OpenAI for equivalent resolution)
- Supports base64 data URIs directly (no upload step needed)
- Queue-based async + webhook support

**Inpainting models:**
- `fal-ai/flux-pro/v1/fill` — best quality inpainting
- `fal-ai/flux-lora/inpainting` — FLUX dev with LoRA
- `fal-ai/flux-kontext-lora/inpaint` — reference-image-guided
- `fal-ai/inpaint` — general SDXL inpainting

### 5.2 Replicate

**Authentication:** `REPLICATE_API_TOKEN` env var.

**Inpainting (Python):**
```python
import replicate
output = replicate.run(
    "black-forest-labs/flux-fill-pro",
    input={
        "prompt": "...",
        "image": open("image.png", "rb"),
        "mask": open("mask.png", "rb"),
        "num_inference_steps": 25,
        "strength": 0.95,
        "output_format": "webp"
    }
)
```

**Key advantages:**
- Thousands of community models, one API key
- Best for exploration and niche fine-tuned models
- Open-source models self-hostable via Cog/Docker
- Pricing: $0.01–$0.05 per image (per-second compute)

**Inpainting models:**
- `black-forest-labs/flux-fill-pro` — recommended primary
- `black-forest-labs/flux-depth-pro` — depth-aware editing
- `zsxkib/flux-dev-inpainting` — open-source community model
- `black-forest-labs/flux-kontext-pro` / `max` — natural language image editing

**Replicate vs fal.ai:** Replicate wins on model variety; fal.ai wins on speed and predictable pricing. For production inpainting in a Photoshop plugin, fal.ai's consistent latency is preferable.

### 5.3 Google Imagen (via Gemini API)

**Access:** Gemini API key (`GEMINI_API_KEY`). Paid tier required.

**Current model:** Imagen 4 (recommended starting point); Imagen 4 Ultra for max quality.

**Pricing:** $0.03/image (Imagen 3); Imagen 4 pricing similar.

**Limitation:** All generated images include a non-removable SynthID watermark. For a Photoshop plugin, watermarked images embedded in a user's design is a significant UX problem.

**Inpainting support:** Limited — Gemini API's Imagen endpoint supports text-to-image; inpainting/masking capability is not yet prominently documented in the API. Gemini multimodal can do image editing via the chat interface but not via a dedicated mask-based edit endpoint.

**Verdict:** Skip for inpainting use case until mask-based edit endpoint is clearly documented.

### 5.4 Seedream (ByteDance)

**Access:** Via third-party aggregators (getimg.ai, 3D AI Studio) rather than a direct ByteDance API. No direct public developer API documented.

**Key feature:** Seed parameter for variation consistency; real-time web search integration in Seedream 5.0.

**Verdict:** Not worth a direct integration — only accessible via aggregators, adds a dependency layer. Revisit when ByteDance publishes a first-party API.

### 5.5 Provider Comparison Matrix

| Provider | Inpainting | Speed | Price/img | Mask Convention | Direct API | Production Stability |
|---|---|---|---|---|---|---|
| OpenAI gpt-image-1 | Yes (soft mask) | 6–10s | $0.02–$0.19 | transparent=edit | Yes | High |
| OpenAI dall-e-2 | Yes (pixel-precise) | ~15s | $0.016–0.020 | transparent=edit | Yes | High |
| fal.ai Flux Fill Pro | Yes | 5–15s | ~$0.03/MP | white=edit | Yes | High |
| Replicate Flux Fill Pro | Yes | 10–30s | $0.01–0.05 | white=edit | Yes | Medium |
| Google Imagen 4 | Limited | ~5s | $0.03 | N/A | Yes | High |
| Seedream 5.0 | Unknown | Unknown | Via aggregator | N/A | No | Low |

---

## 6. Best Practices for Multi-Provider Image Generation

### 6.1 Architecture Pattern

Implement a provider abstraction layer:
```
ProviderInterface {
  generateImage(prompt, options) → base64
  inpaintImage(sourceImage, maskImage, prompt, options) → base64
}

Providers: OpenAIProvider, FalProvider, ReplicateProvider
```

Each provider handles its own mask convention normalization. The plugin always works with "transparent = edit" internally and converts before sending to providers that use inverted conventions.

### 6.2 Mask Convention Normalization

```
InpaintKit internal convention: transparent = edit (OpenAI style)

When sending to fal.ai/Replicate:
  invert alpha → white where transparent, black where opaque
```

### 6.3 Image Format Pipeline for Photoshop

```
Photoshop canvas → export PNG (with alpha) → resize to provider max size
Photoshop selection → export as grayscale PNG → convert to RGBA PNG (alpha from grayscale) → normalize mask convention
```

For gpt-image-1: ensure both image and mask are same dimensions, PNG, image < 50MB, mask < 4MB.

### 6.4 Authentication Strategy

| Auth Method | Use Case | Risk |
|---|---|---|
| OpenAI API key (standard) | Primary, enterprise users | Low |
| ChatGPT OAuth device code | Optional "use subscription" path | High (unofficial) |
| fal.ai API key | Alternative provider | Low |
| Replicate API key | Alternative provider | Low |

Never store API keys in plugin code. Use the host application's secure storage (Photoshop's `app.persistentData` or OS keychain).

### 6.5 Error Handling Priorities

1. **Rate limit (429):** Exponential backoff, surface remaining quota to user
2. **Content policy (400/safety):** Show provider-specific message, suggest rephrasing
3. **Org verification missing:** Link user to OpenAI verification page
4. **Mask dimension mismatch:** Auto-resize mask to match source before sending
5. **File too large:** Auto-compress/resize to meet provider limits before sending

### 6.6 Provider Selection Heuristic

```
User has OpenAI API key?
  → Default to gpt-image-1 (quality, text rendering, inpainting)
  
User wants pixel-precise inpainting?
  → Offer dall-e-2 or fal.ai/Replicate Flux Fill Pro
  
User wants lowest cost, high volume?
  → fal.ai (fastest, ~$0.03/MP), or gpt-image-1-mini ($0.005/img)
  
User has ChatGPT Plus subscription only?
  → ChatGPT OAuth path (unofficial, fragile — warn user)
```

---

## 7. Source Credibility Assessment

| Source | Type | Credibility |
|---|---|---|
| developers.openai.com | Official OpenAI docs | High |
| platform.openai.com | Official OpenAI API reference | High |
| developers.openai.com/codex/auth | Official Codex auth docs | High |
| fal.ai docs | Official fal.ai docs | High |
| replicate.com | Official Replicate docs | High |
| ai.google.dev | Official Google Gemini docs | High |
| OpenAI Developer Community forums | Community reports | Medium |
| Third-party blog posts (analyticsvidhya, eesel, img.ly) | Tutorials | Medium |
| github.com/tumf/opencode-openai-device-auth | Community implementation | Medium |

---

## 8. Unresolved Questions

1. **ChatGPT OAuth image endpoint:** Does `chatgpt.com/backend-api/codex/responses` support the `image_generation` tool call? Community projects suggest yes, but official documentation does not confirm the exact request schema for image generation via this path.

2. **InpaintKit's current OAuth usage:** The project file name mentions ChatGPT subscription use. It is unclear whether InpaintKit already has a working implementation of the device code flow or is starting fresh. The existing `.mp4` demo should be reviewed to understand current behavior.

3. **gpt-image-1 mask precision:** Community reports (OpenAI Developer Community, Apr–May 2025) confirm soft masking behavior replaces the entire image. OpenAI has not committed to changing this. If pixel-precise Photoshop selections are core to InpaintKit's value proposition, this is a significant limitation requiring either dall-e-2 or a non-OpenAI provider.

4. **Org verification automation:** The one-time org verification for gpt-image-1 cannot be automated — it requires manual action in the OpenAI console. Plugin onboarding UX must account for this.

5. **fal.ai real-time upload URL lifecycle:** When uploading images to fal.ai's file storage service for use as `image_url`, what is the URL expiry? Not confirmed in reviewed sources.

---

## References

- [OpenAI Image Generation Guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI Image Edit API Reference](https://developers.openai.com/api/reference/python/resources/images/methods/edit)
- [OpenAI Codex Authentication](https://developers.openai.com/codex/auth)
- [OpenAI Apps SDK Auth](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI Pricing](https://openai.com/api/pricing/)
- [OpenAI Cookbook: Generate Images with GPT Image](https://cookbook.openai.com/examples/generate_images_with_gpt_image)
- [fal.ai Flux Pro Fill Inpainting](https://fal.ai/models/fal-ai/flux-pro/v1/fill/api)
- [fal.ai SDXL Inpainting](https://fal.ai/models/fal-ai/inpaint/api)
- [Replicate FLUX Collections](https://replicate.com/collections/flux)
- [Replicate flux-dev-inpainting](https://replicate.com/zsxkib/flux-dev-inpainting)
- [Google Imagen 4 Docs](https://ai.google.dev/gemini-api/docs/models/imagen)
- [gpt-image-1 vs DALL-E 3 Comparison](https://www.openaitoolshub.org/en/blog/gpt-image-vs-dall-e)
- [openai-oauth community project](https://github.com/EvanZhouDev/openai-oauth)
- [opencode-openai-device-auth plugin](https://github.com/tumf/opencode-openai-device-auth)
- [Instagit: Codex CLI Auth Methods](https://instagit.com/openai/codex/codex-cli-authentication-methods/)
- [AI Image API Pricing Comparison 2026](https://pricepertoken.com/image)
- [OpenAI Community: gpt-image-1 inpainting behavior](https://community.openai.com/t/image-editing-inpainting-with-a-mask-for-gpt-image-1-replaces-the-entire-image/1244275)
