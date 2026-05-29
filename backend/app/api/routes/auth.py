from fastapi import APIRouter, Depends, Request
from app.api.deps import verify_app_api_key
from app.core.config import settings
from app.core.rate_limit import limiter

router = APIRouter()


@router.post("/auth/chatgpt/session", dependencies=[Depends(verify_app_api_key)])
@limiter.limit(settings.RATE_LIMIT_AUTH)
def connect_session(request: Request):
    _ = request
    return {"status": "success", "message": "Session handled client-side"}


@router.get("/auth/chatgpt/session/status", dependencies=[Depends(verify_app_api_key)])
def session_status():
    return {"connected": False}


@router.delete("/auth/chatgpt/session", dependencies=[Depends(verify_app_api_key)])
def disconnect_session():
    return {"status": "success", "message": "Session disconnected client-side"}
