"""ChatGPT Web reverse-proxy image edit provider.

Real implementation wiring chatgpt_core/ into the FastAPI backend. The full
flow (bootstrap → sentinel chat-requirements + PoW → 3-step Azure upload →
prepare conduit → start SSE → poll conversation → resolve file URLs →
download bytes) is CPU/IO heavy and synchronous (curl-cffi). We run it
inside ``asyncio.to_thread`` so the FastAPI event loop is not blocked while
two users edit images concurrently.
"""

import asyncio
import base64
import io
import json
import logging
import time
from typing import Any, Dict, Optional

from PIL import Image

from app.core.config import settings
from app.core.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderReconnectRequiredError,
    ProviderTimeoutError,
)
from app.providers.base import BaseImageProvider
from chatgpt_core.client import OpenAIBackendAPI
from chatgpt_core.errors import (
    ImagePollTimeoutError,
    InvalidAccessTokenError,
    UpstreamHTTPError,
)
from chatgpt_core.sse_parser import iter_sse_payloads
from app.core.url_security import is_safe_url

logger = logging.getLogger(__name__)


class ChatGPTWebProvider(BaseImageProvider):
    """Reverse-proxy provider that drives ChatGPT Web's image edit pipeline.

    IMPORTANT: This class is NOT thread-safe.  ``_run_flow_sync`` mutates
    ``self.api_client`` state (PoW script sources, session cookies).  The
    service layer MUST create a new instance per request — never cache or
    share a provider across concurrent ``edit_image`` calls.
    """

    def __init__(self, access_token: str = "", proxy: Optional[str] = None) -> None:
        access_token = (access_token or "").strip()
        if not access_token:
            raise ProviderAuthError("Missing access token")
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
        if not prompt or not prompt.strip():
            raise ValueError("prompt is required")
        if not image_bytes:
            raise ValueError("image bytes are required")
        if n > 1:
            raise ValueError(
                "ChatGPT Web provider does not support n > 1"
            )

        poll_timeout = float(
            getattr(settings, "CHATGPT_POLL_TIMEOUT", self.DEFAULT_POLL_TIMEOUT_SECS)
        )
        return await asyncio.to_thread(
            self._run_flow_sync,
            image_bytes=image_bytes,
            mask_bytes=mask_bytes,
            prompt=prompt.strip(),
            model=model,
            poll_timeout=poll_timeout,
        )

    DEFAULT_POLL_TIMEOUT_SECS = 150.0

    def _run_flow_sync(
        self,
        image_bytes: bytes,
        mask_bytes: Optional[bytes],
        prompt: str,
        model: str,
        poll_timeout: float = DEFAULT_POLL_TIMEOUT_SECS,
    ) -> Dict[str, Any]:
        """Blocking ChatGPT pipeline. Must be called via asyncio.to_thread."""
        try:
            self.api_client._bootstrap()

            composed = self._composite_mask(image_bytes, mask_bytes)
            image_b64 = base64.b64encode(composed).decode("ascii")

            upload = self.api_client._upload_image(image_b64, file_name="source.png")
            requirements = self.api_client._get_chat_requirements()
            conduit = self.api_client._prepare_image_conversation(prompt, requirements, model)
            sse_response = self.api_client._start_image_generation(
                prompt, requirements, conduit, model, references=[upload]
            )
            conversation_id = self._extract_conversation_id(sse_response)
            if not conversation_id:
                raise ProviderError("ChatGPT did not return a conversation id")

            file_ids, sediment_ids = self.api_client._poll_image_results(
                conversation_id, timeout_secs=poll_timeout
            )
            urls = self.api_client._resolve_image_urls(conversation_id, file_ids, sediment_ids)
            if not urls:
                raise ProviderError("ChatGPT returned no downloadable image urls")

            png_bytes = self._download_first(urls)
            return {
                "created": int(time.time()),
                "data": [{"b64_json": base64.b64encode(png_bytes).decode("ascii")}],
            }
        except ProviderError:
            raise
        except InvalidAccessTokenError as exc:
            raise ProviderAuthError(str(exc)) from exc
        except ImagePollTimeoutError as exc:
            raise ProviderTimeoutError(
                str(exc), timeout_secs=poll_timeout
            ) from exc
        except UpstreamHTTPError as exc:
            self._raise_from_upstream(exc)
        except Exception as exc:
            logger.exception("ChatGPT provider flow failed")
            raise ProviderError(f"ChatGPT image edit failed: {exc}") from exc

    _MAX_IMAGE_PIXELS = 4096 * 4096

    @staticmethod
    def _open_image_safe(data: bytes) -> Image.Image:
        """Open image with pixel budget check without mutating the global."""
        img = Image.open(io.BytesIO(data))
        pixels = img.size[0] * img.size[1]
        if pixels > ChatGPTWebProvider._MAX_IMAGE_PIXELS:
            raise ValueError(
                f"Image too large: {pixels} pixels exceeds "
                f"{ChatGPTWebProvider._MAX_IMAGE_PIXELS} limit"
            )
        return img.convert("RGBA")

    @staticmethod
    def _composite_mask(image_bytes: bytes, mask_bytes: Optional[bytes]) -> bytes:
        """Produce a single PNG: mask alpha = 0 → transparent edit zone.

        Internal convention is alpha=0 means "edit this pixel", which matches
        what ChatGPT Web expects on the inpaint upload (transparent regions
        are repainted). When no mask is supplied we return the source as-is.
        """
        source = ChatGPTWebProvider._open_image_safe(image_bytes)
        if not mask_bytes:
            buf = io.BytesIO()
            source.save(buf, format="PNG")
            return buf.getvalue()

        mask = ChatGPTWebProvider._open_image_safe(mask_bytes)
        if mask.size != source.size:
            mask = mask.resize(source.size, Image.NEAREST)
        alpha = mask.split()[3]
        source.putalpha(alpha)
        buf = io.BytesIO()
        source.save(buf, format="PNG")
        return buf.getvalue()

    @staticmethod
    def _extract_conversation_id(sse_response) -> str:
        """Walk SSE payloads looking for the conversation id, then close stream."""
        try:
            for payload in iter_sse_payloads(sse_response):
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                cid = data.get("conversation_id")
                if cid:
                    return str(cid)
                inner = data.get("v")
                if isinstance(inner, dict):
                    cid = inner.get("conversation_id")
                    if cid:
                        return str(cid)
            return ""
        finally:
            close = getattr(sse_response, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

    def _download_first(self, urls: list[str]) -> bytes:
        from urllib.parse import urlparse
        last_exc: Optional[Exception] = None
        for url in urls:
            if not is_safe_url(url):
                raise ProviderError(f"SSRF block: URL is not safe to download: {url}")
            response = None
            try:
                parsed_url = urlparse(url)
                parsed_base = urlparse(self.api_client.base_url)
                url_host = (parsed_url.hostname or "").lower()
                base_host = (parsed_base.hostname or "").lower()
                is_external = bool(url_host and url_host != base_host)
                popped_headers = {}
                if is_external:
                    # Pop Authorization and OAI-* headers
                    to_pop = [h for h in self.api_client.session.headers if h.lower() == "authorization" or h.lower().startswith("oai-")]
                    for h in to_pop:
                        popped_headers[h] = self.api_client.session.headers.pop(h)
                try:
                    response = self.api_client.session.get(url, stream=True, timeout=30)
                    if 200 <= response.status_code < 300:
                        chunks = []
                        total_bytes = 0
                        max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
                        for chunk in response.iter_content():
                            total_bytes += len(chunk)
                            if total_bytes > max_bytes:
                                raise RuntimeError(
                                    f"Download size exceeded maximum allowed budget of {settings.MAX_UPLOAD_MB}MB"
                                )
                            chunks.append(chunk)
                        content = b"".join(chunks)
                        if content:
                            return content
                    last_exc = RuntimeError(
                        f"download failed: status={response.status_code}"
                    )
                finally:
                    for h, val in popped_headers.items():
                        self.api_client.session.headers[h] = val
            except Exception as exc:
                last_exc = exc
                continue
            finally:
                if response is not None:
                    try:
                        response.close()
                    except Exception:
                        pass
        if last_exc is not None:
            raise ProviderError(f"Failed to download generated image: {last_exc}") from last_exc
        else:
            raise ProviderError("Failed to download generated image")

    async def close(self) -> None:
        """Close the curl-cffi session to release resources and connection pool."""
        try:
            self.api_client.close()
        except Exception:
            pass

    @staticmethod
    def _raise_from_upstream(exc: UpstreamHTTPError) -> None:
        status_code = exc.status_code
        if status_code == 401:
            raise ProviderAuthError("ChatGPT rejected access token") from exc
        if status_code == 403:
            raise ProviderReconnectRequiredError(
                "ChatGPT requires reconnection (subscription or session)"
            ) from exc
        if status_code == 429:
            raise ProviderRateLimitError(
                "ChatGPT rate limit hit", retry_after=exc.retry_after
            ) from exc
        raise ProviderError(f"ChatGPT upstream error ({status_code})") from exc
