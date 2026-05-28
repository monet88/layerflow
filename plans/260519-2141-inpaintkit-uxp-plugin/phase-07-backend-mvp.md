---
title: "Phase 7: Backend MVP (Fork chatgpt2api)"
sprint: 3
status: complete
priority: P2
effort: 5h
depends_on: []
---

# Phase 7: Backend MVP (Fork chatgpt2api)

## Context Links

- [plan.md](./plan.md) — Overview
- [/docs/development-roadmap.md](../../docs/development-roadmap.md) — Sprint 3 details
- [researcher-openai-api-report.md](../reports/researcher-openai-api-report.md) — API format reference
- [/home/monet/dev/chatgpt2api](file:///home/monet/dev/chatgpt2api) — Upstream source (basketikun/chatgpt2api)

## Port Strategy

**Use `/xia` from `/home/monet/dev/chatgpt2api` to port the backend image generation core.** Key files to port/adapt:

| chatgpt2api Source | InpaintKit Target | Adaptation |
|-------------------|-------------------|-----------|
| `services/openai_backend_api.py` | `chatgpt_core/openai_backend_api.py` | Strip chat/non-image methods, keep image flow only |
| `utils/helper.py` (PoW functions) | `chatgpt_core/pow_solver.py` | Extract `build_proof_token`, `build_legacy_requirements_token`, `parse_pow_resources` |
| SSE parsing (in openai_backend_api) | `chatgpt_core/sse_parser.py` | Extract `iter_sse_payloads` |
| `services/protocol/openai_v1_image_edit.py` | `app/api/routes/images.py` | Adapt request handling to FastAPI route |
| `services/image_task_service.py` | `app/services/image_edit_service.py` | Simplify: remove task queue, sync execution |
| `services/config.py` (partial) | `app/core/config.py` | Keep image-related config only |

**Key adaptations from chatgpt2api → InpaintKit backend:**
- chatgpt2api has account pool (multi-account rotation) → InpaintKit uses single per-user token
- chatgpt2api has web admin UI + gallery → Remove entirely
- chatgpt2api has multiple storage backends (git, DB, JSON) → InpaintKit uses SQLite only
- chatgpt2api has chat completion + anthropic protocol → Remove, keep image-only
- chatgpt2api has content filter + CPA service → Remove
- chatgpt2api task service is async queue → InpaintKit is sync-per-request (plugin waits)
- chatgpt2api uses threading for tasks → InpaintKit uses async/await (FastAPI native)

## Architecture Decision

**Decision:** Fork and adapt `chatgpt2api` rather than rewriting the ChatGPT Web reverse proxy from scratch.

**Rationale:** chatgpt2api already implements the full complexity:
- PoW (Proof of Work) token solving (`build_proof_token`, `build_legacy_requirements_token`)
- Turnstile token handling
- Browser fingerprint impersonation (curl-cffi + Chrome/Edge TLS)
- 3-step Azure Blob file upload flow
- Conversation SSE parsing (`iter_sse_payloads`)
- Image result polling with exponential backoff
- Dual download paths (file-service:// and sediment://)
- Model slug mapping (gpt-image-2 → gpt-5-3)

Reimplementing this would add ~20h of effort and constant maintenance against OpenAI's anti-bot updates.

**What we strip:** Account pooling, web admin UI, multi-user auth key management, chat completion, anthropic protocol adapter, registration service, CPA service, backup service, content filter, image gallery/thumbnails, git storage. Keep ONLY image generation core.

## Overview

Fork chatgpt2api into `backend/`, strip to image-only functionality, add InpaintKit-specific API layer (per-user token storage, OpenAI-compatible `/v1/images/edits` endpoint, Docker packaging).

## Requirements

**Functional:**
- `GET /health` — no auth, returns service status
- `GET /v1/models` — returns available models (gpt-image-2)
- `POST /v1/images/edits` — OpenAI-compatible image edit endpoint (multipart/form-data)
- `POST /auth/chatgpt/session` — store user's access_token (encrypted per-user)
- `GET /auth/chatgpt/session/status` — check if user has connected session
- API key auth on all non-health endpoints (`Authorization: Bearer <APP_API_KEY>`)
- `X-User-Id` header to identify which user's ChatGPT token to use
- Structured error responses (OpenAI-compatible shape)
- Docker + Docker Compose for deployment

**Non-functional:**
- Per-user session isolation (never route through another user's token)
- Never log access tokens
- Encrypted token storage (Fernet)
- SQLite for MVP
- All tests pass with mock provider (no ChatGPT access needed)

## Project Structure

```
backend/
├── pyproject.toml
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── README.md
├── main.py
├── app/
│   ├── api/routes/
│   │   ├── health.py
│   │   ├── models.py
│   │   ├── images.py
│   │   └── auth.py
│   ├── core/
│   │   ├── config.py
│   │   ├── errors.py
│   │   ├── security.py
│   │   └── logging.py
│   ├── db/
│   │   ├── sqlite.py
│   │   └── session_repository.py
│   ├── providers/
│   │   ├── base.py
│   │   ├── mock_provider.py
│   │   └── chatgpt_web.py          # Adapted from chatgpt2api
│   └── services/
│       ├── image_edit_service.py
│       └── user_session_service.py
├── chatgpt_core/                    # Extracted from chatgpt2api (minimal)
│   ├── __init__.py
│   ├── openai_backend_api.py       # Core: bootstrap, sentinel, upload, generate, poll
│   ├── pow_solver.py               # PoW challenge solving (from chatgpt2api utils)
│   ├── sse_parser.py               # SSE stream parsing
│   └── types.py                    # ChatRequirements, FileReference, etc.
└── tests/
    ├── test_health.py
    ├── test_models.py
    ├── test_auth.py
    └── test_images_mock.py
```

## Implementation Steps

1. **Fork setup:** Create `backend/` directory, initialize pyproject.toml with dependencies (FastAPI, uvicorn, pydantic, python-multipart, pytest, cryptography, curl-cffi, Pillow)
2. **Extract chatgpt_core:** Copy from chatgpt2api ONLY these modules:
   - `services/openai_backend_api.py` → `chatgpt_core/openai_backend_api.py` (strip non-image methods)
   - PoW/proof token utilities → `chatgpt_core/pow_solver.py`
   - SSE parsing → `chatgpt_core/sse_parser.py`
   - Types/dataclasses → `chatgpt_core/types.py`
3. **Strip openai_backend_api.py:** Remove chat completion, model listing, account pool references. Keep only:
   - `_bootstrap()`, `_bootstrap_headers()`
   - `_build_fp()`, `_headers()`
   - `_get_chat_requirements()`, `_build_requirements()`
   - `_prepare_image_conversation()`
   - `_upload_image()`, `_decode_image_base64()`
   - `_start_image_generation()`
   - `_poll_image_results()`, `_extract_image_tool_records()`
   - `_get_file_download_url()`, `_get_attachment_download_url()`, `_resolve_image_urls()`
   - `_image_model_slug()`, `_image_headers()`
4. **Implement InpaintKit API layer:** config.py (with `ENCRYPTION_KEY` Fernet validator + CORS origins list), security.py (Fernet wrapper using `settings.ENCRYPTION_KEY`), errors.py, logging.py (redact tokens). Wire `CORSMiddleware` in `main.py`.
5. **Implement session storage:** SQLite + session_repository (store/retrieve encrypted tokens per user_id). Encryption performed by `security.py` using validated key from config — startup fails fast if `ENCRYPTION_KEY` is missing or weak.
6. **Implement routes:** health, models, auth (POST/GET session), images/edits
7. **Implement image_edit_service:** Orchestrate: validate user → get stored token → instantiate chatgpt_core → call generate → return OpenAI-compatible response
8. **Implement mock_provider:** Echo input image for testing
9. **Create Dockerfile + docker-compose.yml**
10. **Write pytest tests** (10 test cases covering all endpoints with mock provider)
11. **Write README** with curl examples and deployment instructions

## Key Modules from chatgpt2api (What We Keep)

| chatgpt2api Source | InpaintKit Target | Purpose |
|-------------------|-------------------|---------|
| `services/openai_backend_api.py` | `chatgpt_core/openai_backend_api.py` | Core reverse proxy (image-only) |
| `utils/helper.py` (PoW functions) | `chatgpt_core/pow_solver.py` | PoW token solving |
| SSE parsing in openai_backend_api | `chatgpt_core/sse_parser.py` | Parse SSE conversation stream |
| Config (partial) | `app/core/config.py` | Env vars, defaults |

## What We Remove from chatgpt2api

- `services/account_service.py` — No account pool (single-user per-token)
- `services/auth_service.py` — Replace with simpler API key + per-user token
- `services/cpa_service.py` — Not needed
- `services/backup_service.py` — Not needed
- `services/content_filter.py` — Not needed (plugin handles prompt)
- `services/image_storage_service.py` — Not needed (return inline b64)
- `services/image_tags_service.py` — Not needed
- `services/log_service.py` — Replace with standard Python logging
- `services/proxy_service.py` — Not needed
- `services/register/` — Not needed
- `services/protocol/` — Replace with our own thin route handlers
- Web admin UI — Not needed
- All storage backends except minimal SQLite

## Environment Variables

```
APP_API_KEY=dev-app-key                   # required, shared secret with plugin
IMAGE_PROVIDER=mock                        # mock | chatgpt_web
SQLITE_PATH=/app/data/app.sqlite
MAX_UPLOAD_MB=20
ENCRYPTION_KEY=                            # REQUIRED — Fernet key (urlsafe base64, 44 chars). Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
LOG_LEVEL=warning
CHATGPT_BASE_URL=https://chatgpt.com
ALLOWED_ORIGINS=app://uxp-internal,http://localhost:8000,http://127.0.0.1:8000,http://[::1]:8000  # comma-separated; UXP panel uses an opaque app:// origin in newer UXP versions
```

**Startup assertions (`app/core/config.py`):**

```python
import base64
from cryptography.fernet import Fernet, InvalidToken

class Settings(BaseSettings):
    APP_API_KEY: str
    ENCRYPTION_KEY: str
    ALLOWED_ORIGINS: str = "app://uxp-internal,http://localhost:8000,http://127.0.0.1:8000,http://[::1]:8000"
    # ... other fields ...

    @field_validator("ENCRYPTION_KEY")
    @classmethod
    def _validate_fernet_key(cls, v: str) -> str:
        if not v or v.startswith("dev-only") or v == "change-me":
            raise ValueError(
                "ENCRYPTION_KEY is required and must be a real Fernet key. "
                'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        # Round-trip test: instantiating Fernet validates the key shape.
        try:
            Fernet(v.encode())
        except (ValueError, InvalidToken) as exc:
            raise ValueError(f"ENCRYPTION_KEY is not a valid Fernet key: {exc}") from exc
        return v

    @field_validator("APP_API_KEY")
    @classmethod
    def _reject_default_app_key(cls, v: str) -> str:
        if not v or v == "dev-app-key" and os.getenv("ENV") == "production":
            raise ValueError("APP_API_KEY must be set to a non-default value in production")
        return v
```

**CORS middleware (`main.py`):**

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-User-Id"],
    max_age=86400,
)
```

> Note: UXP plugin requests typically arrive without a browser-style `Origin` header, so CORS is mostly a defensive measure for browser-based dev tools and any future web admin. Keep `allow_origins` tight rather than `*`.

## Success Criteria

- [ ] `docker compose up --build` starts backend on localhost:8000
- [ ] Backend refuses to start when `ENCRYPTION_KEY` is missing, default, or not a valid Fernet key
- [ ] CORS preflight (`OPTIONS`) succeeds for an allowed origin and is rejected for a disallowed one
- [ ] `GET /health` returns ok without auth
- [ ] `GET /v1/models` returns model list with valid API key
- [ ] `POST /auth/chatgpt/session` stores encrypted token
- [ ] `GET /auth/chatgpt/session/status` returns connected status
- [ ] `POST /v1/images/edits` with mock provider returns b64_json
- [ ] All 10 pytest tests pass
- [ ] Token never appears in logs
- [ ] chatgpt_core imports cleanly without chatgpt2api's other dependencies

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Upstream chatgpt2api changes break extracted code | Pin extraction to specific commit hash; periodic manual sync |
| PoW algorithm changes | chatgpt_core is isolated — update only that module |
| curl-cffi version breaks TLS fingerprint | Pin curl-cffi version; test against chatgpt.com after updates |
| SQLite concurrent writes | Acceptable for MVP (single user per deployment) |
