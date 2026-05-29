from typing import Any, cast
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.db.sqlite import init_db
from app.api.routes import health, models, auth, images

# Setup logging with redact capability
setup_logging(settings.LOG_LEVEL)

# Initialize database schema
init_db()

app = FastAPI(
    title="InpaintKit Backend",
    version="0.1.0",
    description="Backend MVP for ChatGPT reverse proxy image editing service",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, cast(Any, rate_limit_exceeded_handler))

# Custom ASGI Middleware to check Content-Length early
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from starlette.responses import Response

class ContentTooLargeError(Exception):
    """Raised when request body bytes exceed max_content_length during streaming/chunked read."""
    pass

@app.exception_handler(ContentTooLargeError)
async def content_too_large_handler(request, exc: ContentTooLargeError):
    _ = (request, exc)
    return Response("Request Entity Too Large", status_code=413)

class ContentLengthLimitMiddleware:
    def __init__(self, app: ASGIApp, max_content_length: int) -> None:
        self.app = app
        self.max_content_length = max_content_length

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in ("POST", "PUT", "PATCH"):
            content_length = None
            for key, val in scope.get("headers", []):
                if key.lower() == b"content-length":
                    try:
                        content_length = int(val)
                    except ValueError:
                        pass
                    break

            if content_length is not None and content_length > self.max_content_length:
                response = Response("Request Entity Too Large", status_code=413)
                await response(scope, receive, send)
                return

            total_read = 0
            body_too_large = False
            response_started = False

            async def wrapped_receive() -> Message:
                nonlocal total_read, body_too_large
                if body_too_large:
                    raise ContentTooLargeError()

                message = await receive()
                if message["type"] == "http.request":
                    body_len = len(message.get("body", b""))
                    total_read += body_len
                    if total_read > self.max_content_length:
                        body_too_large = True
                        raise ContentTooLargeError()
                return message

            async def wrapped_send(message: Message) -> None:
                nonlocal response_started
                if message["type"] == "http.response.start":
                    response_started = True
                await send(message)

            try:
                await self.app(scope, wrapped_receive, wrapped_send)
                return
            except Exception as exc:
                if body_too_large and not response_started:
                    response = Response("Request Entity Too Large", status_code=413)
                    await response(scope, receive, send)
                    return
                raise exc

        await self.app(scope, receive, send)

max_bytes_limit = settings.MAX_UPLOAD_MB * 1024 * 1024 + (2 * 1024 * 1024)
app.add_middleware(ContentLengthLimitMiddleware, max_content_length=max_bytes_limit)

# CORS middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-User-Id", "X-ChatGPT-Access-Token"],
    max_age=86400,
)

# Register endpoints
app.include_router(health.router)
app.include_router(models.router)
app.include_router(auth.router)
app.include_router(images.router)
