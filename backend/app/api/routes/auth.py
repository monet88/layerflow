import logging
from fastapi import APIRouter, Depends, Body, HTTPException, Request, status
from pydantic import BaseModel, Field
from app.api.deps import verify_app_api_key, get_user_id
from app.core.config import settings
from app.core.rate_limit import limiter
from app.services.user_session_service import UserSessionService

logger = logging.getLogger(__name__)

router = APIRouter()
session_service = UserSessionService()

class SessionPayload(BaseModel):
    access_token: str = Field(..., min_length=10)

@router.post("/auth/chatgpt/session", dependencies=[Depends(verify_app_api_key)])
@limiter.limit(settings.RATE_LIMIT_AUTH)
def connect_session(
    request: Request,
    user_id: str = Depends(get_user_id),
    payload: SessionPayload = Body(...),
):
    """Store encrypted access token for the given user ID."""
    try:
        session_service.store_token(user_id, payload.access_token)
        return {"status": "success", "message": "Session connected successfully"}
    except Exception as exc:
        logger.exception("Failed to store session for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store session. Please try again later.",
        )

@router.get("/auth/chatgpt/session/status", dependencies=[Depends(verify_app_api_key)])
def session_status(user_id: str = Depends(get_user_id)):
    """Check if the user has an active, connected session."""
    connected = session_service.has_session(user_id)
    return {"connected": connected}

@router.delete("/auth/chatgpt/session", dependencies=[Depends(verify_app_api_key)])
def disconnect_session(user_id: str = Depends(get_user_id)):
    """Clear the session token for the user ID."""
    session_service.clear_session(user_id)
    return {"status": "success", "message": "Session disconnected successfully"}
