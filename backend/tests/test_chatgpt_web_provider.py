"""ChatGPTWebProvider unit tests.

Covers the upstream-error → typed-AppError mapping the provider performs
inside its synchronous flow. Each test stubs a single chatgpt_core method
to inject the failure point so no real network call is made.
"""

import asyncio
from io import BytesIO

import pytest
from PIL import Image

from app.core.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderReconnectRequiredError,
    ProviderTimeoutError,
)
from app.providers.chatgpt_web import ChatGPTWebProvider
from chatgpt_core.errors import ImagePollTimeoutError, UpstreamHTTPError


def _png_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _provider() -> ChatGPTWebProvider:
    return ChatGPTWebProvider(access_token="x" * 32, proxy=None)


class _ClosableSSE:
    def __init__(self, lines):
        self._lines = lines
        self.closed = False

    def iter_lines(self):
        yield from self._lines

    def close(self):
        self.closed = True


def test_constructor_rejects_blank_token():
    with pytest.raises(ProviderAuthError):
        ChatGPTWebProvider(access_token="   ", proxy=None)


def test_edit_image_rejects_empty_prompt():
    provider = _provider()
    with pytest.raises(ValueError):
        asyncio.run(
            provider.edit_image(
                image_bytes=_png_bytes(),
                mask_bytes=None,
                prompt="   ",
                user_id="u1",
            )
        )


def test_extract_conversation_id_reads_nested_payload_and_closes_stream():
    sse = _ClosableSSE([
        b'data: {"v": {"conversation_id": "conversation-123"}}',
        b"data: [DONE]",
    ])

    assert ChatGPTWebProvider._extract_conversation_id(sse) == "conversation-123"
    assert sse.closed is True


def test_extract_conversation_id_ignores_malformed_payloads_and_closes_stream():
    sse = _ClosableSSE([
        b"data: not-json",
        b'data: {"message": "no id here"}',
        b"data: [DONE]",
    ])

    assert ChatGPTWebProvider._extract_conversation_id(sse) == ""
    assert sse.closed is True


def test_upstream_401_maps_to_provider_auth_error(monkeypatch):
    provider = _provider()

    def _raise_401(self, *_a, **_kw):
        raise UpstreamHTTPError("upload", 401, "unauth", retry_after=None)

    monkeypatch.setattr(
        provider.api_client.__class__, "_upload_image", _raise_401, raising=True
    )

    with pytest.raises(ProviderAuthError):
        asyncio.run(
            provider.edit_image(
                image_bytes=_png_bytes(),
                mask_bytes=None,
                prompt="hi",
                user_id="u1",
            )
        )


def test_upstream_403_maps_to_reconnect_required(monkeypatch):
    provider = _provider()

    def _raise_403(self, *_a, **_kw):
        raise UpstreamHTTPError("requirements", 403, "forbidden", retry_after=None)

    monkeypatch.setattr(
        provider.api_client.__class__, "_upload_image", _raise_403, raising=True
    )

    with pytest.raises(ProviderReconnectRequiredError):
        asyncio.run(
            provider.edit_image(
                image_bytes=_png_bytes(),
                mask_bytes=None,
                prompt="hi",
                user_id="u1",
            )
        )


def test_upstream_429_maps_to_rate_limit_with_retry_after(monkeypatch):
    provider = _provider()

    def _raise_429(self, *_a, **_kw):
        raise UpstreamHTTPError("upload", 429, "slow down", retry_after=42)

    monkeypatch.setattr(
        provider.api_client.__class__, "_upload_image", _raise_429, raising=True
    )

    with pytest.raises(ProviderRateLimitError) as excinfo:
        asyncio.run(
            provider.edit_image(
                image_bytes=_png_bytes(),
                mask_bytes=None,
                prompt="hi",
                user_id="u1",
            )
        )
    assert excinfo.value.retry_after == 42


def test_poll_timeout_maps_to_provider_timeout_error(monkeypatch):
    provider = _provider()

    # Walk the flow up to polling, then raise ImagePollTimeoutError.
    monkeypatch.setattr(
        provider.api_client.__class__,
        "_upload_image",
        lambda self, *a, **kw: {
            "file_id": "f",
            "file_name": "n",
            "file_size": 1,
            "mime_type": "image/png",
            "width": 8,
            "height": 8,
        },
        raising=True,
    )
    monkeypatch.setattr(
        provider.api_client.__class__, "_bootstrap", lambda self: None, raising=True
    )

    class _Req:
        token = "t"
        proof_token = ""
        turnstile_token = ""
        so_token = ""
        raw_finalize = {}

    monkeypatch.setattr(
        provider.api_client.__class__,
        "_get_chat_requirements",
        lambda self: _Req(),
        raising=True,
    )
    monkeypatch.setattr(
        provider.api_client.__class__,
        "_prepare_image_conversation",
        lambda self, *a, **kw: "conduit",
        raising=True,
    )

    class _FakeSSE:
        def iter_lines(self):
            yield b'data: {"conversation_id": "abc"}'
            yield b"data: [DONE]"

        def close(self):
            pass

    monkeypatch.setattr(
        provider.api_client.__class__,
        "_start_image_generation",
        lambda self, *a, **kw: _FakeSSE(),
        raising=True,
    )

    def _raise_timeout(self, *_a, **_kw):
        raise ImagePollTimeoutError("timed out")

    monkeypatch.setattr(
        provider.api_client.__class__,
        "_poll_image_results",
        _raise_timeout,
        raising=True,
    )

    with pytest.raises(ProviderTimeoutError):
        asyncio.run(
            provider.edit_image(
                image_bytes=_png_bytes(),
                mask_bytes=None,
                prompt="hi",
                user_id="u1",
            )
        )


def test_unknown_upstream_status_maps_to_generic_provider_error(monkeypatch):
    provider = _provider()

    def _raise_500(self, *_a, **_kw):
        raise UpstreamHTTPError("upload", 500, "boom", retry_after=None)

    monkeypatch.setattr(
        provider.api_client.__class__, "_upload_image", _raise_500, raising=True
    )

    with pytest.raises(ProviderError) as excinfo:
        asyncio.run(
            provider.edit_image(
                image_bytes=_png_bytes(),
                mask_bytes=None,
                prompt="hi",
                user_id="u1",
            )
        )
    # Generic ProviderError, not one of the typed subclasses.
    assert not isinstance(excinfo.value, ProviderAuthError)
    assert not isinstance(excinfo.value, ProviderRateLimitError)
    assert not isinstance(excinfo.value, ProviderReconnectRequiredError)
