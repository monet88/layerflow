"""Per-user rate limiter using slowapi.

Keyed on the X-User-Id header (the same value that authenticates the user
to the backend) rather than client IP, since multiple plugin installs may
share an egress IP behind NAT but each has a distinct user_id.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from app.core.errors import PROVIDER_RATE_LIMITED


def _user_id_key(request: Request) -> str:
    """Rate-limit key: X-User-Id when present, otherwise client IP."""
    user_id = request.headers.get("X-User-Id")
    if user_id:
        return f"user:{user_id}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=_user_id_key)


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
