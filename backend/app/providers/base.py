from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

class BaseImageProvider(ABC):
    """Abstract interface for InpaintKit image edit providers."""

    @abstractmethod
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
        """Generate/edit an image using the specified provider."""
        pass

    async def close(self) -> None:
        """Release any resources held by the provider."""
        pass
