"""Centralized HTTP error normalization for the backend API.

Maps internal exceptions (provider errors, validation failures, upstream timeouts)
to consistent HTTP responses. All routes should use these helpers instead of
raising HTTPException with inline detail strings.
"""

import logging
from typing import Optional

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


# Stable provider error codes returned to the plugin so it can branch on
# state without parsing English prose.
PROVIDER_ERROR_CODE = "provider_error"
PROVIDER_AUTH_FAILED = "provider_auth_failed"
PROVIDER_RATE_LIMITED = "provider_rate_limited"
PROVIDER_TIMEOUT = "provider_timeout"
PROVIDER_RECONNECT_REQUIRED = "provider_reconnect_required"
PROVIDER_INTERNAL_ERROR = "internal_error"


class AppError(Exception):
    """Base application error with HTTP status mapping."""

    error_code: str = "app_error"

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        *,
        user_message: Optional[str] = None,
        error_code: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.user_message = user_message or "An unexpected error occurred."
        if error_code is not None:
            self.error_code = error_code


class ProviderError(AppError):
    """Upstream AI provider returned an error."""

    error_code: str = PROVIDER_ERROR_CODE

    def __init__(
        self,
        message: str,
        *,
        user_message: Optional[str] = None,
        status_code: int = status.HTTP_502_BAD_GATEWAY,
        error_code: Optional[str] = None,
    ) -> None:
        super().__init__(
            message,
            status_code=status_code,
            user_message=user_message or "AI provider returned an error. Please try again.",
            error_code=error_code,
        )


class ProviderAuthError(ProviderError):
    """Upstream provider rejected our credentials (e.g. expired access token)."""

    def __init__(self, message: str = "Provider authentication failed") -> None:
        super().__init__(
            message,
            user_message="ChatGPT session expired. Please sign in again.",
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code=PROVIDER_AUTH_FAILED,
        )


class ProviderRateLimitError(ProviderError):
    """Upstream provider returned a rate-limit response."""

    def __init__(
        self,
        message: str = "Provider rate limit hit",
        retry_after: Optional[int] = None,
    ) -> None:
        super().__init__(
            message,
            user_message="Rate limit reached. Please wait and try again.",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            error_code=PROVIDER_RATE_LIMITED,
        )
        self.retry_after = retry_after


class ProviderReconnectRequiredError(ProviderError):
    """Upstream provider requires the user to re-authenticate (e.g. subscription)."""

    def __init__(self, message: str = "Provider requires reconnection") -> None:
        super().__init__(
            message,
            user_message="ChatGPT subscription issue. Check your account.",
            status_code=status.HTTP_403_FORBIDDEN,
            error_code=PROVIDER_RECONNECT_REQUIRED,
        )


class ProviderTimeoutError(ProviderError):
    """Upstream AI provider timed out."""

    error_code: str = PROVIDER_TIMEOUT

    def __init__(self, message: str, timeout_secs: float = 0) -> None:
        super().__init__(
            message,
            user_message=(
                f"Image generation timed out after {int(timeout_secs)}s. "
                "Please try again."
            ),
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            error_code=PROVIDER_TIMEOUT,
        )
        self.timeout_secs = timeout_secs


class SessionError(AppError):
    """Session storage or retrieval failed."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            user_message="Session operation failed. Please try again.",
        )


class ValidationError(AppError):
    """Request validation failed beyond Pydantic model validation."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            status_code=status.HTTP_400_BAD_REQUEST,
            user_message=message,
        )


def raise_http_from_app_error(exc: AppError) -> None:
    """Convert an AppError to HTTPException, logging internals server-side only.

    Body shape: {"message": str, "code": str?}. The ``code`` field is the
    stable provider error code (e.g. ``provider_auth_failed``) so the plugin
    can branch on it without scraping prose.
    """
    logger.error("AppError [%d]: %s", exc.status_code, str(exc))
    detail: dict = {"message": exc.user_message}
    error_code = getattr(exc, "error_code", None)
    if error_code:
        detail["code"] = error_code
    raise HTTPException(
        status_code=exc.status_code,
        detail=detail,
    )
