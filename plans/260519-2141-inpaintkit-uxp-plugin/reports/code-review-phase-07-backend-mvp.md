# Code Review: Phase 7 — Backend MVP

**Reviewer:** code-review skill (3-stage protocol)
**Scope:** `backend/` — full Phase 7 implementation
**Verification:** 11/11 pytest cases pass in 0.27s
**Verdict:** PASS-WITH-FIXES — block items must be cleared before Phase 8

---

## Stage 1 — Spec Compliance

| Spec Item | Status | Note |
|---|---|---|
| `GET /health` (no auth) | PASS | `app/api/routes/health.py` |
| `GET /v1/models` | PASS | `app/api/routes/models.py` |
| `POST /v1/images/edits` (multipart) | PASS | `app/api/routes/images.py` |
| `POST/GET /auth/chatgpt/session(/status)` | PASS | + extra `DELETE` endpoint, acceptable |
| Bearer + `X-User-Id` headers | PASS | `hmac.compare_digest` used |
| Fernet encryption | PASS | `app/core/security.py` |
| Reject default/invalid `ENCRYPTION_KEY` | PASS | validator in `app/core/config.py` |
| CORS middleware tight | PASS | `main.py` |
| SQLite repo + UPSERT | PASS | `app/db/session_repository.py` |
| Docker + docker-compose | PASS | non-root user, volume mount |
| Pytest tests | DEVIATION | spec says 10, code has 11 (extra `test_logging_filter_redaction`) — acceptable |
| `app/core/errors.py` | MISSING | listed in spec project structure but never created. `HTTPException` raised inline across routes → no central error normalization. Tech debt. |
| Test files split (`test_health/models/auth/images_mock.py`) | DEVIATION | merged into single `test_backend.py` — cosmetic |
| `chatgpt_core/openai_backend_api.py` as one module | DEVIATION | modularized into 11 sub-files due to 200-LOC rule. Hợp lý nhưng method-binding pattern (xem M1) cần document. |

**Stage 1 verdict:** PASS with documented deviations. Required to add `app/core/errors.py` and translate Chinese user-facing exception messages before Phase 8 wires `chatgpt_web`.

---

## Stage 2 — Code Quality

### CRITICAL

**C1. SQLite WAL mode not enabled**
`app/db/sqlite.py:5-12` — fresh connection per call, no `PRAGMA journal_mode=WAL`. Under FastAPI threadpool pressure (sync routes), concurrent writers contend. Currently masked because each method opens/closes its own connection. Add WAL pragma + `check_same_thread=False` only if pooling later.

### HIGH

**H1. Path-traversal vector in `chatgpt_core/image_upload.py:11-24`**
`_decode_image_base64(image)` treats `image` as a local path when `< 512 chars` and file exists, then `os.path.expanduser(image).read_bytes()`. Not exploitable in Phase 7 (function not wired to HTTP routes), but Phase 8 wire-up MUST pass raw bytes / explicitly-controlled paths. Otherwise an attacker controlling the multipart `image` field reads arbitrary server files.

**H2. Logging redaction does not cover bare-token leaks**
`app/core/logging.py:9-14` — only matches `Bearer <token>` and JSON `access_token` keys. A naked JWT logged via `logger.info("got token=%s", tok)` slips through. Add JWT pattern `eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+`.

**H3. Filter mutates `record.msg` when dict — formatter compatibility risk**
`logging.py:19-20` — replaces `record.msg` with redacted dict. Standard formatters call `record.getMessage()` which expects str. Test passes because tests inspect raw record. Real uvicorn/JSON loggers may break. Verify with structured logger downstream.

**H4. No request timeout on `edit_image`**
ChatGPT generation takes 120-150s; FastAPI has no default timeout → workers held indefinitely on stalled upstreams. Add `asyncio.wait_for` budget or document reverse-proxy timeout in README.

### MEDIUM

**M1. Method-binding pattern in `chatgpt_core/client.py:28-41`**
```python
class OpenAIBackendAPI:
    from .image_upload import _upload_image, _decode_image_base64
```
Rare pattern; works because module-level `def f(self, ...)` becomes bound when imported into class body. Cost: type checkers / IDEs miss `self` reference, refactor (rename `_upload_image`) hard to trace. Either use mixin classes or add module-level docstring explaining the pattern.

**M2. Blocking `time.sleep` inside `_poll_image_results`**
`chatgpt_core/image_poll.py` — sync sleeps. Phase 7 not wired to async path so OK. Phase 8 must call via `run_in_threadpool` or rewrite with `asyncio.sleep`, otherwise blocks event loop for 120s+ per request.

**M3. `_validate_fernet_key` swallows `Exception`**
`config.py:36` — broad `except Exception` masks unrelated failures (e.g. base64 import). Spec recommended `(ValueError, InvalidToken)`. Tighten.

**M4. Chinese user-facing error messages from `chatgpt_core`**
`image_poll.py:155-159` raises `ImagePollTimeoutError` with Chinese message. Bubbles to HTTP 500 detail → users see Chinese in plugin UI. Either translate or remap via planned `app/core/errors.py`.

**M5. Dev deps in production image**
`requirements.txt` includes `pytest`, `pytest-asyncio`. Dockerfile installs it → test framework lands in production image. Split `requirements.txt` (runtime) and `requirements-dev.txt` (testing) or use `pip install .[dev]` only in dev.

**M6. `curl` installed in Dockerfile but no compose healthcheck**
Dockerfile installs `curl` for healthcheck. `docker-compose.yml` has no `healthcheck:` block. Either add the block or drop curl install.

### LOW

- **L1.** `images.py:79-82` — `f"Image generation failed: {exc}"` may leak stack details. Use generic message + log details server-side.
- **L2.** `auth.py:21-25` — same pattern leaks `{exc}` to client.
- **L3.** `image_edit_service.py:24` — lazy import `ChatGPTWebProvider` inside if-branch. Move to top with try/except for fail-fast on missing deps.
- **L4.** `mock_provider.py:8` — `get_fallback_png()` recomputes per call. Cosmetic.
- **L5.** `tests/conftest.py:19` — hardcoded `"data/test_app.sqlite"` written to CWD. Fixture deletes file on teardown — risk of collision with dev DB. Switch to `tmp_path_factory`.
- **L6.** README mentions "AES-CBC-HMAC via Fernet" — Fernet is AES-128-CBC + HMAC-SHA256. Tech detail accurate.

---

## Stage 3 — Adversarial Review

### A1. Auth bypass via timing — Mitigated
`hmac.compare_digest` used. **Verdict:** Reject (false positive).

### A2. Module-level `cipher` singleton
`security.py:18` instantiates Fernet at import. Validator catches bad key. Key rotation requires service restart (no `MultiFernet`). **Verdict:** Defer — acceptable for MVP, log as risk.

### A3. UPSERT race on duplicate user_id
SQLite serializes single-writer transactions. **Verdict:** Reject — not a real risk.

### A4. Memory/disk DoS via large upload — ACCEPT (HIGH)
`images.py:25` — `await image.read()` runs **before** size check. Starlette `UploadFile` rolls to disk after 1MB (SpooledTemporaryFile), so direct OOM avoided, but attacker can still fill `/tmp` with 10GB payload before the 413 fires. Fix: read `image.size` (Starlette exposes it from Content-Length) or check the header explicitly **first**, then read.

```python
if image.size and image.size > max_bytes:
    raise HTTPException(413, ...)
```

### A5. SQL injection — Mitigated
All queries parameterized. **Verdict:** Reject.

### A6. Token leak via volume backup
SQLite holds Fernet ciphertext. `docker-compose.yml` mounts `./data:/app/data` next to `.env`. If host filesystem is compromised, attacker reads both ciphertext and key. **Verdict:** Defer — document deployment guidance (separate secret store, locked-down volume).

### A7. CORS misconfiguration — Mitigated
`allow_credentials=False` + tight origins. **Verdict:** Reject.

### A8. `X-User-Id` accepts any string — ACCEPT (MEDIUM)
`deps.py:27-35` only trims. If user_id ever appears in filesystem paths (logs, exports), `../../etc/passwd` becomes traversal. Add regex `^[a-zA-Z0-9_\-]{1,64}$`.

### A9. PoW solver fallback returns garbage — ACCEPT (HIGH)
`chatgpt_core/pow_solver.py:175-176` — if 500k iterations don't solve, returns hardcoded fallback string with `solved=False`. `build_legacy_requirements_token` ignores the flag → caller sends bogus token → upstream rejects with opaque error. Bug carried from upstream `chatgpt2api`. Phase 7 not wired so no impact, but **must fix before Phase 8**: raise `RuntimeError` when `solved=False`.

### A10. `image_poll_*` knobs not in `Settings`
`image_poll.py:67-68` — `getattr(self, ...)` with hardcoded defaults. No env override path. **Verdict:** Defer — Phase 8 should add to `Settings` for ops tunability.

### A11. No rate limiting — ACCEPT (MEDIUM)
`POST /auth/chatgpt/session` and `/v1/images/edits` accept unbounded request rate. Even with valid `APP_API_KEY`, single misbehaving plugin instance can DoS the DB / upstream account. Add `slowapi` or fronting reverse-proxy rate limit before public deploy.

---

## Verification

```
pytest tests/ -v
collected 11 items
... 11 passed in 0.27s
```

Docker build not exercised (no Docker engine in review env).

---

## Action Items (Priority Order)

### Must fix before Phase 8 wire-up

1. **A4** — Reject upload via `image.size` / Content-Length header before `read()` (`backend/app/api/routes/images.py`).
2. **A9** — `pow_solver.build_legacy_requirements_token` must raise when `_pow_generate` returns `solved=False`.
3. **H1** — Audit Phase 8 call sites for `_decode_image_base64` to ensure no untrusted string reaches the path-fallback branch. Prefer accepting `bytes` directly.
4. **M4** — Translate Chinese exception messages or normalize via `app/core/errors.py`.

### Should fix during Phase 8 prep

5. **app/core/errors.py** missing — create the module per spec for centralized HTTP error mapping; absorbs M4.
6. **A8** — Validate `X-User-Id` format in `deps.py`.
7. **M5** — Split runtime vs dev deps; rebuild Docker image without pytest.
8. **H2** — Add JWT-shaped pattern to redaction filter.
9. **L5** — Use `tmp_path_factory` for test DB to isolate from dev DB.

### Defer / document

10. **A6, A11** — Deployment hardening guide (secrets, rate-limit) before public release.
11. **M1** — Document method-binding pattern in `client.py` or refactor to mixins.
12. **C1** — Add WAL pragma if write contention shows up under load.
13. **M2** — Wrap `_poll_image_results` in `run_in_threadpool` when `chatgpt_web` provider is enabled.

---

## Open Questions

- Migrate `chatgpt_core` to mixin classes vs keep current import-into-class-body pattern?
- Expose `image_poll_initial_wait_secs` / `image_poll_interval_secs` via `Settings` in Phase 8?
- Is `app/core/errors.py` still required by the plan, or has the team accepted inline `HTTPException` as final?
