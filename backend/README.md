# InpaintKit Backend MVP

This is the backend service for the InpaintKit Photoshop Plugin. It provides an OpenAI-compatible interface for image edits, manages encrypted user access tokens in SQLite, and proxies requests to ChatGPT Web endpoints securely.

---

## Technical Stack
- **Framework**: FastAPI (Python 3.11-slim)
- **Database**: SQLite with Fernet Symmetric Encryption
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

All authenticated requests require the header `Authorization: Bearer <APP_API_KEY>` and `X-User-Id: <user_id>`.

### 1. Health Check
Unauthenticated check to confirm the backend is up.
```bash
curl -i http://127.0.0.1:8000/health
```

### 2. Connect ChatGPT Session
Store the user's ChatGPT access token (stored encrypted with AES-CBC-HMAC via Fernet).
```bash
curl -i -X POST http://127.0.0.1:8000/auth/chatgpt/session \
  -H "Authorization: Bearer dev-app-key" \
  -H "X-User-Id: user-123" \
  -H "Content-Type: application/json" \
  -d '{"access_token": "eyJhbGciOiJSUzI1NiIs..."}'
```

### 3. Check Session Status
Determine if the user is connected.
```bash
curl -i http://127.0.0.1:8000/auth/chatgpt/session/status \
  -H "Authorization: Bearer dev-app-key" \
  -H "X-User-Id: user-123"
```

### 4. Disconnect Session
Clear the user's stored token.
```bash
curl -i -X DELETE http://127.0.0.1:8000/auth/chatgpt/session \
  -H "Authorization: Bearer dev-app-key" \
  -H "X-User-Id: user-123"
```

### 5. List Models
Returns supported model identifiers.
```bash
curl -i http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer dev-app-key"
```

### 6. Image Edits (Inpainting / Mock)
Submit an image, optional mask, and prompt. If `IMAGE_PROVIDER=mock`, the API will echo back the input image.
```bash
curl -i -X POST http://127.0.0.1:8000/v1/images/edits \
  -H "Authorization: Bearer dev-app-key" \
  -H "X-User-Id: user-123" \
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

- `tests/test_backend.py` — health, models, session CRUD, mock provider, upload size cap.
- `tests/test_image_upload_security.py` — `_decode_image_base64` rejects path-traversal input.
- `tests/test_chatgpt_web_provider.py` — upstream 401/403/429/500 + poll timeout map to typed errors.
- `tests/test_provider_concurrency.py` — two concurrent edits run in parallel via `asyncio.to_thread`.

### Manual Integration Test (real ChatGPT account)

1. Set `IMAGE_PROVIDER=chatgpt_web` and a strong `APP_API_KEY` in `.env`.
2. Start the server: `uvicorn main:app --port 8000`.
3. Capture an access token from `https://chatgpt.com/api/auth/session`
   (browser DevTools → Network → `session` response → `accessToken`).
4. Store the token via `POST /auth/chatgpt/session` (curl example above).
5. Submit an edit with a `mask` field and expect 120-150s wall time. Response shape:
   ```json
   {"created": 1700000000, "data": [{"b64_json": "iVBORw0…"}]}
   ```

Failure cases to verify:
- Expired token → `401` with `{"detail": {"code": "provider_auth_failed", …}}`.
- Subscription / session issue → `403` with `provider_reconnect_required`.
- More than 5 image edits/minute per `X-User-Id` → `429` with `provider_rate_limited`.

### Deployment Notes

- `docker-compose.yml` defaults `ENV=production`, which makes the
  `APP_API_KEY=dev-app-key` default fail fast at startup. Override
  `APP_API_KEY` in the host environment before `docker-compose up`.
- `RATE_LIMIT_AUTH` and `RATE_LIMIT_IMAGES` are slowapi expressions
  (`5/minute`, `10/minute`, …); they apply per `X-User-Id` not per IP, so
  multiple installs behind a NAT each get their own bucket.
- SQLite runs in WAL mode with a 5s `busy_timeout` so the FastAPI
  threadpool can write tokens without lock conflicts. The data directory
  must be writable by the container user.
- `requirements-dev.txt` is dev-only (pytest + pytest-asyncio); the
  Docker image only installs `requirements.txt`.
- Logs are JSON via `app/core/logging.py`; the redaction filter masks
  `Bearer …`, `access_token`, and `Authorization` fields. Never log raw
  access tokens.
