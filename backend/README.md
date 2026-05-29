# InpaintKit Backend MVP

This is the backend service for the InpaintKit Photoshop Plugin. It provides an OpenAI-compatible interface for image generations and edits, validates the plugin API key, and proxies requests to ChatGPT Web endpoints securely. ChatGPT OAuth tokens stay in plugin storage and are forwarded per image request.

---

## Technical Stack
- **Framework**: FastAPI (Python 3.11-slim)
- **Database**: SQLite legacy session schema
- **HTTP Client**: `curl-cffi==0.7.4` (for TLS fingerprint bypass/impersonation)
- **Containerization**: Docker & Docker Compose

---

## Setup & Running

### 1. Direct Running (Local Python)

First, make sure you have Python 3.11 installed.

```bash
# Navigate to the backend directory
cd backend

# Create and activate virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create your .env file
cp .env.example .env
```

Open `.env` and fill in the parameters:
- `APP_API_KEY`: Secret token shared with the plugin UI (e.g. `dev-app-key`).
- `IMAGE_PROVIDER`: Set to `mock` for local echo testing, or `chatgpt_web` to run via ChatGPT.
- `ENCRYPTION_KEY`: A 32-byte urlsafe-base64 key. Generate one with:
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

Run the server:
```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Running with Docker Compose

Ensure Docker is running, then execute:

```bash
docker-compose up --build -d
```

The database file will be persisted on the host machine at `./data/app.sqlite` via a volume mount.

---

## API Endpoints & `curl` Examples

All authenticated requests require `Authorization: Bearer <APP_API_KEY>`. Image requests also include `X-User-Id: <user_id>`; when `IMAGE_PROVIDER=chatgpt_web`, they must send the current ChatGPT OAuth token in `X-ChatGPT-Access-Token`.

### 1. Health Check
Unauthenticated check to confirm the backend is up.
```bash
curl -i http://127.0.0.1:8000/health
```

### 2. Legacy ChatGPT Session Compatibility
These endpoints remain for older clients and return success/status without storing ChatGPT tokens. The plugin now sends the current OAuth token on each image request.
```bash
curl -i -X POST http://127.0.0.1:8000/auth/chatgpt/session \
  -H "Authorization: Bearer dev-app-key" \
  -H "Content-Type: application/json" \
  -d '{"access_token": "eyJhbGciOiJSUzI1NiIs..."}'

curl -i http://127.0.0.1:8000/auth/chatgpt/session/status \
  -H "Authorization: Bearer dev-app-key"

curl -i -X DELETE http://127.0.0.1:8000/auth/chatgpt/session \
  -H "Authorization: Bearer dev-app-key"
```

### 5. List Models
Returns supported model identifiers.
```bash
curl -i http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer dev-app-key"
```

### 6. Image Edits (Inpainting / Mock)
Submit an image, optional mask, and prompt. If `IMAGE_PROVIDER=mock`, the API echoes the input image; if `IMAGE_PROVIDER=chatgpt_web`, include the current ChatGPT OAuth access token.
```bash
curl -i -X POST http://127.0.0.1:8000/v1/images/edits \
  -H "Authorization: Bearer dev-app-key" \
  -H "X-User-Id: user-123" \
  -H "X-ChatGPT-Access-Token: eyJhbGciOiJSUzI1NiIs..." \
  -F "image=@/absolute/path/to/image.png" \
  -F "prompt=draw a red hat" \
  -F "model=gpt-image-2"
```

---

## Phase 8: ChatGPT Web Provider

The `chatgpt_web` provider drives the full reverse-proxy flow from a real
account: bootstrap → sentinel chat-requirements + PoW → 3-step Azure
upload → prepare conduit → start SSE → poll conversation → resolve file
URL → download bytes. The synchronous chatgpt_core pipeline runs inside
`asyncio.to_thread` so two concurrent edits do not serialize on PoW.

### Tests

```bash
pip install -r requirements-dev.txt
pytest -q
```

- `tests/test_backend.py` — health, models, legacy session compatibility, mock provider, upload size cap.
- `tests/test_image_upload_security.py` — `_decode_image_base64` rejects path-traversal input.
- `tests/test_chatgpt_web_provider.py` — upstream 401/403/429/500 + poll timeout map to typed errors.
- `tests/test_provider_concurrency.py` — two concurrent edits run in parallel via `asyncio.to_thread`.

### Manual Integration Test (real ChatGPT account)

1. Set `IMAGE_PROVIDER=chatgpt_web` and a strong `APP_API_KEY` in `.env`.
2. Start the server: `uvicorn main:app --port 8000`.
3. Capture an access token from `https://chatgpt.com/api/auth/session`
   (browser DevTools → Network → `session` response → `accessToken`).
4. Submit an edit with `X-ChatGPT-Access-Token` and a `mask` field; expect 120-150s wall time. Response shape:
   ```json
   {"created": 1700000000, "data": [{"b64_json": "iVBORw0…"}]}
   ```

Failure cases to verify:
- Expired token → `401` with `{"detail": {"code": "provider_auth_failed", …}}`.
- Subscription / session issue → `403` with `provider_reconnect_required`.
- More than 5 image edits/minute per client IP → `429` with `provider_rate_limited`.

### Deployment Notes

- `docker-compose.yml` defaults `ENV=production`, which makes the
  `APP_API_KEY=dev-app-key` default fail fast at startup. Override
  `APP_API_KEY` in the host environment before `docker-compose up`.
- `RATE_LIMIT_AUTH` and `RATE_LIMIT_IMAGES` are slowapi expressions
  (`5/minute`, `10/minute`, …); they apply per client IP address.
- **Reverse proxy:** If the backend runs behind nginx/Traefik, configure
  `ProxyHeadersMiddleware` (or equivalent) so `X-Forwarded-For` is trusted.
  Without this, all clients share a single rate-limit bucket keyed on the
  proxy's IP.
- `CHATGPT_POLL_TIMEOUT` (default 150s) controls how long the backend waits
  for ChatGPT image generation before returning a timeout error.
- SQLite runs in WAL mode with a 5s `busy_timeout` for legacy metadata writes.
  The data directory must be writable by the container user.
- `requirements-dev.txt` is dev-only (pytest + pytest-asyncio); the
  Docker image only installs `requirements.txt`.
- Logs are JSON via `app/core/logging.py`; the redaction filter masks
  `Bearer …`, `access_token`, and `Authorization` fields. Never log raw
  access tokens.
