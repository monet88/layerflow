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
