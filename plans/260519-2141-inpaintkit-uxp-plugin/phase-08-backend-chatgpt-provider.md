---
title: "Phase 8: Backend ChatGPT Provider (Adapt chatgpt2api core)"
sprint: 3
status: pending
priority: P2
effort: 4h
depends_on: [phase-07]
---

# Phase 8: Backend ChatGPT Provider (Adapt chatgpt2api core)

## Context Links

- [plan.md](./plan.md) — Overview
- [phase-07-backend-mvp.md](./phase-07-backend-mvp.md) — Fork/extraction strategy
- [/home/monet/dev/chatgpt2api/services/openai_backend_api.py](file:///home/monet/dev/chatgpt2api/services/openai_backend_api.py) — Upstream source
- [researcher-openai-api-report.md](../reports/researcher-openai-api-report.md) — OAuth token behavior
- [/docs/provider-api-verification.md](../../docs/provider-api-verification.md) — Verified API patterns

## Overview

Wire the extracted `chatgpt_core/` module (from Phase 7) into the InpaintKit backend as a real provider. This phase adapts the chatgpt2api OpenAI backend API class to work within our provider interface, adds proper error mapping, and validates the full end-to-end image generation flow.

**Key difference from original plan:** We are NOT reimplementing PoW, sentinel, Azure upload, or SSE parsing. Those were extracted in Phase 7. This phase is purely about:
1. Adapting the extracted class to fit `base.ImageEditProvider`
2. Adding InpaintKit-specific error mapping
3. Integration testing with real ChatGPT tokens

## Key Technical Details (from chatgpt2api source, verified 2026-05-20)

**Full flow:**
```
1. _bootstrap()                        → GET chatgpt.com/, extract PoW script refs
2. _get_chat_requirements()            → POST /backend-api/sentinel/chat-requirements
                                          Returns: sentinel token + PoW seed
                                          Solve: build_proof_token(seed, difficulty)
3. _upload_image(base64) [3-step]      → POST /backend-api/files (get upload_url)
                                        → PUT upload_url (Azure Blob, x-ms-blob-type: BlockBlob)
                                        → POST /backend-api/files/{file_id}/uploaded
4. _prepare_image_conversation()       → POST /backend-api/f/conversation/prepare
                                          Returns: conduit_token
5. _start_image_generation()           → POST /backend-api/f/conversation (SSE)
                                          system_hints: ["picture_v2"]
                                          content: image_asset_pointer refs + prompt
6. _poll_image_results()               → GET /backend-api/conversation/{id}
                                          Look for: file-service://FILE_ID
                                          Look for: sediment://SEDIMENT_ID
                                          Initial wait: 10s, poll interval: 10s, timeout: 120-150s
7. _resolve_image_urls()               → GET /backend-api/files/{id}/download
                                          OR: GET /backend-api/conversation/{id}/attachment/{sid}/download
```

**Required headers (all requests):**
- `X-OpenAI-Target-Path: {path}`
- `X-OpenAI-Target-Route: {path}`
- `OAI-Device-Id: {uuid}` (persistent per session)
- `OAI-Session-Id: {uuid}` (persistent per session)
- `Sec-Ch-Ua`, `Sec-Ch-Ua-Mobile`, `Sec-Ch-Ua-Platform` (Chrome/Edge values)
- `User-Agent: Mozilla/5.0 ... Chrome/143.0.0.0 ... Edge/143.0.0.0`
- `Authorization: Bearer {access_token}` (from Codex OAuth)

**Image generation headers (additional):**
- `OpenAI-Sentinel-Chat-Requirements-Token: {token}`
- `OpenAI-Sentinel-Proof-Token: {pow_token}` (from PoW challenge)
- `X-Conduit-Token: {conduit_token}` (from prepare step)
- `X-Oai-Turn-Trace-Id: {uuid}` (for SSE requests)

**Model slug mapping:**
- `gpt-image-2` → `gpt-5-3` (in conversation payload)
- `codex-gpt-image-2` → kept as-is

**Polling behavior:**
- Initial wait: 10s (generation takes ~30s, polling early triggers 429)
- Poll interval: 10s
- Total timeout: 120-150s
- Backoff on 429/5xx: exponential, capped at 16s, with jitter
- Terminal: find `async_task_type: "image_gen"` message with file_ids

## Requirements

**Functional:**
- `ChatGPTWebProvider` class implementing `base.ImageEditProvider`
- Accept access_token + image + optional mask + prompt
- Execute full chatgpt_core flow (bootstrap → generate → download)
- Return base64 encoded PNG in OpenAI-compatible format
- Handle errors: 401 (expired), 429 (rate limit), 403 (subscription)
- Retry with backoff on transient failures (max 2 retries)

**Non-functional:**
- Provider is a thin adapter around chatgpt_core (< 150 lines)
- Never log access_token value
- Clean session cleanup on errors
- Timeout configurable via env (default 180s)

## Implementation Steps

1. Create `app/providers/chatgpt_web.py` — ChatGPTWebProvider class
2. Adapt chatgpt_core's `OpenAIBackendAPI` initialization:
   - Accept `access_token` as constructor arg
   - Set `base_url` from config (default: `https://chatgpt.com`)
   - Initialize curl-cffi session with Chrome fingerprint
3. Implement `edit_image()`:
   - Call `_stream_picture_conversation(prompt, model, images=[source_image, mask])` if mask provided
   - Call `_stream_picture_conversation(prompt, model, images=[source_image])` if no mask
   - Parse SSE stream for conversation_id
   - Poll for results
   - Download and return image bytes
4. Implement error mapping (see table below)
5. Wire provider into `image_edit_service.py` (IMAGE_PROVIDER=chatgpt_web)
6. Add integration test stub (requires real token — manual verification)
7. Document manual test procedure in README

## Error Mapping

| ChatGPT Response | Provider Error Code | User Message |
|-----------------|--------------------|-|
| HTTP 401 | provider_auth_failed | ChatGPT session expired. Please sign in again. |
| HTTP 429 | provider_rate_limited | Rate limit reached. Please wait and try again. |
| HTTP 403 | provider_reconnect_required | ChatGPT subscription issue. Check your account. |
| Timeout (>180s) | provider_rate_limited | Generation timed out. Try a simpler prompt. |
| Network error | internal_error | Connection failed. Check your internet. |
| Missing file_ids after poll | internal_error | Generation completed but no image was produced. |
| PoW/Arkose required | internal_error | Anti-bot challenge failed. Try again later. |

## Success Criteria

- [ ] IMAGE_PROVIDER=chatgpt_web loads without import errors
- [ ] chatgpt_core initializes with access_token without crashing
- [ ] Provider returns structured error when access_token is invalid (mock 401)
- [ ] Provider returns structured error on timeout (mock slow response)
- [ ] Full flow works with valid ChatGPT Plus access_token (manual test)
- [ ] Generated image returned as base64 in OpenAI-compatible format
- [ ] access_token never appears in any log output
- [ ] Provider file is < 150 lines (thin adapter, not reimplementation)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Upstream chatgpt2api PoW changes | chatgpt_core isolated; sync specific commit on breakage |
| ChatGPT API changes endpoints | All paths centralized in chatgpt_core; single file to update |
| curl-cffi TLS fingerprint outdated | Pin version; test monthly against chatgpt.com |
| Rate limits vary by subscription tier | Document in README; suggest Plus/Pro for reliability |
| Image too large causes Azure upload timeout | Resize to max 4096px before upload |
