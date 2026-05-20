"""Centralized HTTP error normalization for the backend API.

Maps internal exceptions (provider errors, validation failures, upstream timeouts)
to consistent HTTP responses. All routes should use these helpers instead of
raising HTTPException with inline detail strings.
"""

import logging
from typing import Optional
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base application error with HTTP status mapping."""

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        *,
        user_message: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        # user_message is safe to expose to client; message stays server-side only
        self.user_message = user_message or "An unexpected error occurred."


class ProviderError(AppError):
    """Upstream AI provider returned an error."""

    def __init__(self, message: str, *, user_message: Optional[str] = None) -> None:
        super().__init__(
            message,
            status_code=status.HTTP_502_BAD_GATEWAY,
            user_message=user_message or "AI provider returned an error. Please try again.",
        )


class ProviderTimeoutError(AppError):
    """Upstream AI provider timed out."""

    def __init__(self, message: str, timeout_secs: float = 0) -> None:
        super().__init__(
            message,
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            user_message=f"Image generation timed out after {int(timeout_secs)}s. Please try again.",
        )


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
            user_message=message,  # validation messages are safe to expose
        )


def raise_http_from_app_error(exc: AppError) -> None:
    """Convert an AppError to HTTPException, logging internals server-side only."""
    logger.error("AppError [%d]: %s", exc.status_code, str(exc))
    raise HTTPException(
        status_code=exc.status_code,
        detail=exc.user_message,
    )
