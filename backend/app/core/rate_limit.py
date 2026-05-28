"""Per-IP rate limiter using slowapi.

Keyed on client IP rather than X-User-Id because the rate limiter fires
before authentication middleware validates the header — an attacker could
rotate X-User-Id values to bypass per-user buckets. IP-based keying is
safe for the single-process MVP deployment.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from app.core.errors import PROVIDER_RATE_LIMITED


limiter = Limiter(key_func=get_remote_address)


def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> JSONResponse:
    """Return the same error envelope shape used elsewhere so the plugin can
    branch on ``code`` without parsing prose.
    """
    retry_after = getattr(exc, "retry_after", None)
    headers = {"Retry-After": str(retry_after)} if retry_after else {}
    return JSONResponse(
        status_code=429,
        content={
            "detail": {
                "message": "Rate limit reached. Please wait and try again.",
                "code": PROVIDER_RATE_LIMITED,
            }
        },
        headers=headers,
    )
