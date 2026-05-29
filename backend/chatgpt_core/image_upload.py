import os
import base64
import time
import logging
from pathlib import Path
from io import BytesIO
from typing import Any, Dict
from PIL import Image
from .errors import ensure_ok

logger = logging.getLogger("chatgpt_core")

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
    mime_type = Image.MIME.get(str(img.format or ""), "image/png")
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
    upload_url = upload_meta["upload_url"]
    from urllib.parse import urlparse
    parsed_url = urlparse(upload_url)
    parsed_base = urlparse(self.base_url)
    url_host = (parsed_url.hostname or "").lower()
    base_host = (parsed_base.hostname or "").lower()
    is_external = bool(url_host and url_host != base_host)

    resolved_ips = []
    if self.url_validator:
        safe, resolved_ips = self.url_validator(upload_url)
        if not safe or not resolved_ips:
            raise ValueError(f"SSRF block: Upload URL is not safe: {upload_url}")
    else:
        raise ValueError(f"SSRF block: No URL validator configured for upload URL: {upload_url}")

    if is_external:
        from curl_cffi import requests as ext_requests, CurlOpt
        curl_options = {}
        import ipaddress
        if resolved_ips and parsed_url.hostname:
            is_ip = False
            try:
                ipaddress.ip_address(parsed_url.hostname)
                is_ip = True
            except ValueError:
                pass
            if not is_ip:
                port = parsed_url.port or (443 if parsed_url.scheme == "https" else 80)
                host = parsed_url.hostname
                if ":" in host:
                    host = f"[{host}]"
                curl_options[CurlOpt.RESOLVE] = [
                    f"{host}:{port}:[{ip}]" if ":" in ip else f"{host}:{port}:{ip}"
                    for ip in resolved_ips
                ]

        proxy = getattr(self, "proxy", None) or os.environ.get("CHATGPT_PROXY")
        session_kwargs = {"impersonate": self.fp["impersonate"], "verify": True}
        if proxy and proxy.strip():
            session_kwargs["proxy"] = proxy.strip()
        if curl_options:
            session_kwargs["curl_options"] = curl_options

        with ext_requests.Session(**session_kwargs) as upload_session:
            response = upload_session.put(
                upload_url,
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
                timeout=30,
                allow_redirects=False,
            )
            ensure_ok(response, "image_upload")
    else:
        response = self.session.put(
            upload_url,
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
            timeout=30,
            allow_redirects=False,
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
