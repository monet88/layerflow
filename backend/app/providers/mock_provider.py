import base64
import time
from io import BytesIO
from typing import Any, Dict, Optional
from PIL import Image
from app.providers.base import BaseImageProvider

def get_fallback_png() -> bytes:
    img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

class MockImageProvider(BaseImageProvider):
    """Mock provider that echoes the input image or returns a 1x1 transparent PNG."""

    async def generate_image(
        self,
        prompt: str,
        user_id: str,
        model: str = "gpt-image-2",
        n: int = 1,
        size: str = "1024x1024",
    ) -> Dict[str, Any]:
        _ = (prompt, user_id, model, size)
        b64_str = base64.b64encode(get_fallback_png()).decode("ascii")
        return {
            "created": int(time.time()),
            "data": [
                {"b64_json": b64_str}
                for _ in range(n)
            ]
        }

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
        _ = (mask_bytes, prompt, user_id, model, size)
        data_bytes = image_bytes if image_bytes else get_fallback_png()
        b64_str = base64.b64encode(data_bytes).decode("ascii")
        return {
            "created": int(time.time()),
            "data": [
                {"b64_json": b64_str}
                for _ in range(n)
            ]
        }
