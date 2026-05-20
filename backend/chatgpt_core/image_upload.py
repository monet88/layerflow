import os
import base64
import time
from pathlib import Path
from io import BytesIO
from typing import Any, Dict
from PIL import Image

from .errors import ensure_ok

def _decode_image_base64(self, image: str) -> bytes:
    """Decode a base64 image string or data URI into raw bytes.

    Security: Only accepts base64 strings and data URIs.
    Local file path fallback was removed to prevent path-traversal attacks
    when this function is wired to HTTP endpoints with user-controlled input.
    """
    if not image:
        raise ValueError("Empty image input")
    payload = image.split(",", 1)[1] if image.startswith("data:") and "," in image else image
    return base64.b64decode(payload)

def _upload_image(self, image: str, file_name: str = "image.png") -> Dict[str, Any]:
    """Upload a base64 image and return the upstream file_id metadata."""
    data = self._decode_image_base64(image)
            
    img = Image.open(BytesIO(data))
    width, height = img.size
    mime_type = Image.MIME.get(img.format, "image/png")
    path = "/backend-api/files"
    response = self.session.post(
        self.base_url + path,
        headers=self._headers(path, {"Content-Type": "application/json", "Accept": "application/json"}),
        json={"file_name": file_name, "file_size": len(data), "use_case": "multimodal", "width": width,
              "height": height},
        timeout=60,
    )
    ensure_ok(response, path)
    upload_meta = response.json()
    time.sleep(0.5)
    response = self.session.put(
        upload_meta["upload_url"],
        headers={
            "Content-Type": mime_type,
            "x-ms-blob-type": "BlockBlob",
            "x-ms-version": "2020-04-08",
            "Origin": self.base_url,
            "Referer": self.base_url + "/",
            "User-Agent": self.user_agent,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.8",
        },
        data=data,
        timeout=120,
    )
    ensure_ok(response, "image_upload")
    path = f"/backend-api/files/{upload_meta['file_id']}/uploaded"
    response = self.session.post(
        self.base_url + path,
        headers=self._headers(path, {"Content-Type": "application/json", "Accept": "application/json"}),
        data="{}",
        timeout=60,
    )
    ensure_ok(response, path)
    return {
        "file_id": upload_meta["file_id"],
        "file_name": file_name,
        "file_size": len(data),
        "mime_type": mime_type,
        "width": width,
        "height": height,
    }
