from fastapi import APIRouter, Depends
from app.api.deps import verify_app_api_key

router = APIRouter()

@router.get("/v1/models", dependencies=[Depends(verify_app_api_key)])
def list_models():
    """List available models in OpenAI-compatible structure."""
    return {
        "object": "list",
        "data": [
            {
                "id": "gpt-image-2",
                "object": "model",
                "created": 1710000000,
                "owned_by": "openai"
            }
        ]
    }
