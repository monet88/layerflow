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

        from app.core.config import settings

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
        except (ProviderError, ProviderTimeoutError):
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

    # Cap PIL pixel budget to prevent decompression bombs that bypass the
    # 20 MB upload budget.  4096×4096 = ~16.7M pixels (~67 MB RGBA RAM).
    _MAX_IMAGE_PIXELS = 4096 * 4096

    @staticmethod
    def _composite_mask(image_bytes: bytes, mask_bytes: Optional[bytes]) -> bytes:
        """Produce a single PNG: mask alpha = 0 → transparent edit zone.

        Internal convention is alpha=0 means "edit this pixel", which matches
        what ChatGPT Web expects on the inpaint upload (transparent regions
        are repainted). When no mask is supplied we return the source as-is.
        """
        saved = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = ChatGPTWebProvider._MAX_IMAGE_PIXELS
        try:
            source = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
            if not mask_bytes:
                buf = io.BytesIO()
                source.save(buf, format="PNG")
                return buf.getvalue()

            mask = Image.open(io.BytesIO(mask_bytes)).convert("RGBA")
            if mask.size != source.size:
                mask = mask.resize(source.size, Image.NEAREST)
            alpha = mask.split()[3]
            source.putalpha(alpha)
            buf = io.BytesIO()
            source.save(buf, format="PNG")
            return buf.getvalue()
        finally:
            Image.MAX_IMAGE_PIXELS = saved

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
        last_exc: Optional[Exception] = None
        for url in urls:
            try:
                response = self.api_client.session.get(url, timeout=120)
                if 200 <= response.status_code < 300 and response.content:
                    return bytes(response.content)
                last_exc = RuntimeError(
                    f"download failed: status={response.status_code}"
                )
            except Exception as exc:
                last_exc = exc
                continue
        raise ProviderError(f"Failed to download generated image: {last_exc}")

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
