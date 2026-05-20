from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
def health_check():
    """Unauthenticated health check endpoint."""
    return {"status": "ok"}
