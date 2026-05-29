from typing import Any, Dict, Optional
from app.core.config import settings
from app.core.errors import ProviderAuthError
from app.providers.base import BaseImageProvider
from app.providers.mock_provider import MockImageProvider
class ImageEditService:
    """Orchestrates image edit requests by selecting and invoking the configured AI provider."""

    def get_provider(self, access_token: Optional[str] = None) -> BaseImageProvider:
        provider_name = settings.IMAGE_PROVIDER.lower().strip()
        if provider_name == "mock":
            return MockImageProvider()
        elif provider_name == "chatgpt_web":
            if not access_token:
                raise ProviderAuthError("No ChatGPT access token provided")
            # IMPORTANT: ChatGPTWebProvider is NOT thread-safe — create a new
            # instance per request.  Never cache or share across concurrent calls.
            from app.providers.chatgpt_web import ChatGPTWebProvider
            return ChatGPTWebProvider(access_token=access_token, proxy=settings.CHATGPT_PROXY)
        else:
            raise ValueError(f"Unknown image provider: {settings.IMAGE_PROVIDER}")

    async def generate_image(
        self,
        prompt: str,
        user_id: str,
        model: str = "gpt-image-2",
        n: int = 1,
        size: str = "1024x1024",
        access_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        provider = self.get_provider(access_token)
        try:
            return await provider.generate_image(
                prompt=prompt,
                user_id=user_id,
                model=model,
                n=n,
                size=size,
            )
        finally:
            await provider.close()

    async def edit_image(
        self,
        image_bytes: bytes,
        mask_bytes: Optional[bytes],
        prompt: str,
        user_id: str,
        model: str = "gpt-image-2",
        n: int = 1,
        size: str = "1024x1024",
        access_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        provider = self.get_provider(access_token)
        try:
            return await provider.edit_image(
                image_bytes=image_bytes,
                mask_bytes=mask_bytes,
                prompt=prompt,
                user_id=user_id,
                model=model,
                n=n,
                size=size,
            )
        finally:
            await provider.close()
