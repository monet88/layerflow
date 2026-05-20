from typing import Any, Dict, Optional
from app.providers.base import BaseImageProvider
from chatgpt_core.client import OpenAIBackendAPI

class ChatGPTWebProvider(BaseImageProvider):
    """Provider wrapper for ChatGPT Web reverse proxy.

    Stubbed for Phase 7 backend MVP, raising NotImplementedError on edit_image.
    """

    def __init__(self, access_token: str = "", proxy: Optional[str] = None) -> None:
        self.api_client = OpenAIBackendAPI(access_token=access_token, proxy=proxy)

    async def edit_image(
        self,
        image_bytes: bytes,
        mask_bytes: Optional[bytes],
        prompt: str,
        user_id: str,
        model: str = "gpt-image-2",
        n: int = 1,
        size: str = "1024x1024",
    ) -> Dict[str, Any]:
        raise NotImplementedError(
            "ChatGPT Web image editing (Inpainting) is not implemented yet in Phase 7 (scheduled for Phase 8)."
        )
