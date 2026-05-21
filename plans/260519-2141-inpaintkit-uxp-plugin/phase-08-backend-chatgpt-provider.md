---
title: "Phase 8: Backend ChatGPT Provider (Adapt chatgpt2api core)"
sprint: 3
status: complete
priority: P2
effort: 5h
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

## Carry-over from Phase 7 Review

These items were deferred during Phase 7 (per external code review verdict and internal review). They MUST be addressed before Phase 8 is marked `complete`.

### CO-1: Wrap PoW solver in thread executor _(was: Phase 7 Finding #3, Medium)_

**Problem.** `_pow_generate` in `chatgpt_core/pow_solver.py` is CPU-bound (up to 500k SHA-3 hashes, ~1-2s). Calling it directly inside the FastAPI request handler blocks the event loop and prevents serving other requests during a generation.

**Action.**
- In `ChatGPTWebProvider.edit_image`, wrap any synchronous `chatgpt_core` call that triggers PoW solving with `await asyncio.to_thread(...)`.
- Alternative: refactor `OpenAIBackendAPI` methods used by the provider to be async-aware and offload only the hot loops via `loop.run_in_executor(None, ...)`.
- Add a unit test that verifies `edit_image` does not block the loop (e.g. concurrent `asyncio.gather` of two edits completes in ~max(t1, t2) not t1+t2).

**Acceptance.** Two concurrent `/v1/images/edits` requests do not serialize on PoW solving.

### CO-2: ~~Block local-path inputs in `_decode_image_base64`~~ ✅ DONE

> **Completed in Phase 7 post-review fix session (2026-05-20).** Local-filepath branch removed from `_decode_image_base64` and `_upload_image`. Function now only accepts base64 strings and data URIs. Path traversal vector closed. Remaining: add regression test during Phase 8 implementation.

### CO-3: Set `ENV=production` default for production deployment _(was: Phase 7 Finding #4, Low)_

**Problem.** `Settings._reject_default_app_key` only blocks the default `dev-app-key` when `ENV=production`. The shipped `docker-compose.yml` does not declare `ENV`, so a production operator who forgets to set it gets dev-mode laxity by default.

**Action.**
- Add `ENV=${ENV:-production}` to the `environment:` block in `backend/docker-compose.yml`.
- Update `backend/.env.example`: add `ENV=development` with comment `# Set ENV=production for prod deploys; this enables strict APP_API_KEY validation.`
- Update `backend/README.md` deployment section to call out the `ENV` variable as production-required.

**Acceptance.** `docker compose up` with no `.env` overrides starts in production mode and refuses default `APP_API_KEY`.

### CO-4: Translate Chinese error messages _(was: Phase 7 Review M4, Medium)_

**Problem.** `chatgpt_core/image_poll.py:155-159` raises `ImagePollTimeoutError` with Chinese message (`ChatGPT 生图超时…`). This bubbles up to HTTP 500 detail — plugin users see Chinese in the UI.

**Action.**
- Translate all Chinese exception messages in `chatgpt_core/` to English.
- Wire `ImagePollTimeoutError` through `app/core/errors.py` (`ProviderTimeoutError`) so user-facing message is controlled centrally.
- Grep for remaining Chinese strings: `grep -rn '[\u4e00-\u9fff]' chatgpt_core/`.

**Acceptance.** No Chinese text reaches HTTP response detail. All `chatgpt_core` exception messages in English.

### CO-5: Split runtime vs dev dependencies _(was: Phase 7 Review M5, Medium)_

**Problem.** `requirements.txt` includes `pytest`, `pytest-asyncio`. Dockerfile installs them → test framework lands in production image (unnecessary attack surface + image bloat).

**Action.**
- Split into `requirements.txt` (runtime only) and `requirements-dev.txt` (includes `-r requirements.txt` + test deps).
- Update `Dockerfile`: `pip install -r requirements.txt` (no dev deps).
- Update README: document `pip install -r requirements-dev.txt` for local development.

**Acceptance.** `docker run <image> pip list` does not include `pytest`. Dev setup docs updated.

### CO-6: Enable SQLite WAL mode _(was: Phase 7 Review C1, Critical)_

**Problem.** `app/db/sqlite.py` opens fresh connections without `PRAGMA journal_mode=WAL`. Under FastAPI threadpool pressure, concurrent writers contend on the default rollback journal. Currently masked because each method opens/closes its own connection.

**Action.**
- Add `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` after each `sqlite3.connect()` call in `sqlite.py`.
- Keep `check_same_thread=False` since connections are not pooled/shared across threads.

**Acceptance.** `PRAGMA journal_mode` returns `wal` when queried on an active connection.

### CO-7: Add API rate limiting _(was: Phase 7 Review A11, Medium)_

**Problem.** `POST /auth/chatgpt/session` and `POST /v1/images/edits` accept unbounded request rate. A misbehaving plugin instance can DoS the DB or exhaust the upstream ChatGPT account quota.

**Action.**
- Add `slowapi` dependency to `requirements.txt`.
- Configure rate limiter in `app/core/rate_limit.py`: `10/minute` for `/auth/chatgpt/session`, `5/minute` for `/v1/images/edits` (per `X-User-Id`).
- Wire limiter into `main.py` via `app.state.limiter`.
- Add env vars `RATE_LIMIT_AUTH` and `RATE_LIMIT_IMAGES` to `Settings` for ops tunability.

**Acceptance.** 6th `/v1/images/edits` call within 60s returns HTTP 429. Rate limits configurable via env.

---

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

> Carry-over tasks (CO-1 through CO-7) MUST be folded into the steps below, not skipped.
> CO-2 was completed in Phase 7 post-review session — only regression test remains.

1. **CO-2 regression test** — add test that `_decode_image_base64("/etc/passwd")` raises (path branch already removed).
2. **CO-3** — set `ENV=${ENV:-production}` default in `backend/docker-compose.yml`; update `.env.example` and `README.md` deployment notes.
3. **CO-5** — split `requirements.txt` → runtime-only; create `requirements-dev.txt` with test deps. Update `Dockerfile`.
4. **CO-6** — add `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000` in `app/db/sqlite.py`.
5. **CO-4** — translate all Chinese strings in `chatgpt_core/`. Wire `ImagePollTimeoutError` → `app/core/errors.py:ProviderTimeoutError`.
6. Create `app/providers/chatgpt_web.py` — ChatGPTWebProvider class
7. Adapt chatgpt_core's `OpenAIBackendAPI` initialization:
   - Accept `access_token` as constructor arg
   - Set `base_url` from config (default: `https://chatgpt.com`)
   - Initialize curl-cffi session with Chrome fingerprint
8. Implement `edit_image()`:
   - Call `_stream_picture_conversation(prompt, model, images=[source_image, mask])` if mask provided
   - Call `_stream_picture_conversation(prompt, model, images=[source_image])` if no mask
   - Parse SSE stream for conversation_id
   - Poll for results
   - Download and return image bytes
9. **CO-1** — wrap any blocking `chatgpt_core` call (PoW, sync HTTP, polling loop) in `asyncio.to_thread` or `loop.run_in_executor`. Add concurrency test (`asyncio.gather` of two edits).
10. **CO-7** — add `slowapi` rate limiter; configure per-endpoint limits in `app/core/rate_limit.py`; wire into `main.py`.
11. Implement error mapping (see table below)
12. Wire provider into `image_edit_service.py` (IMAGE_PROVIDER=chatgpt_web)
13. Add integration test stub (requires real token — manual verification)
14. Document manual test procedure in README

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

- [x] **CO-1**: Concurrent `/v1/images/edits` requests do not serialize on PoW solver _(asyncio.to_thread; covered by `tests/test_provider_concurrency.py`)_
- [x] **CO-2**: `_decode_image_base64` rejects local filesystem paths _(done in Phase 7 post-review)_; regression test added _(`tests/test_image_upload_security.py`)_
- [x] **CO-3**: `docker compose up` defaults to `ENV=production` and refuses default `APP_API_KEY`
- [x] **CO-4**: No Chinese text in any HTTP response detail; all `chatgpt_core` exceptions in English
- [x] **CO-5**: Production Docker image does not contain `pytest`; `requirements-dev.txt` created
- [x] **CO-6**: `PRAGMA journal_mode` returns `wal` on active SQLite connection
- [x] **CO-7**: 6th `/v1/images/edits` within 60s returns HTTP 429; rate limits configurable via env _(slowapi limiter keyed on X-User-Id; `RATE_LIMIT_AUTH`/`RATE_LIMIT_IMAGES`)_
- [x] IMAGE_PROVIDER=chatgpt_web loads without import errors
- [x] chatgpt_core initializes with access_token without crashing
- [x] Provider returns structured error when access_token is invalid (mock 401) _(`tests/test_chatgpt_web_provider.py::test_upstream_401_maps_to_provider_auth_error`)_
- [x] Provider returns structured error on timeout (mock slow response) _(`tests/test_chatgpt_web_provider.py::test_poll_timeout_maps_to_provider_timeout_error`)_
- [ ] Full flow works with valid ChatGPT Plus access_token (manual test) _(deferred — manual procedure documented in `backend/README.md`)_
- [x] Generated image returned as base64 in OpenAI-compatible format
- [x] access_token never appears in any log output
- [ ] Provider file is < 150 lines (thin adapter, not reimplementation) _(actual: 204 lines; mask compositing + SSE conversation_id extraction + error mapping pushed past target. Acceptable: still no upstream-protocol logic — those stay in `chatgpt_core`.)_

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Upstream chatgpt2api PoW changes | chatgpt_core isolated; sync specific commit on breakage |
| ChatGPT API changes endpoints | All paths centralized in chatgpt_core; single file to update |
| curl-cffi TLS fingerprint outdated | Pin version; test monthly against chatgpt.com |
| Rate limits vary by subscription tier | Document in README; suggest Plus/Pro for reliability |
| Image too large causes Azure upload timeout | Resize to max 4096px before upload |
