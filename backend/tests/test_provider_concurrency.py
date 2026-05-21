"""CO-1 regression: blocking PoW + HTTP work runs in a thread pool so two
concurrent ``edit_image`` calls overlap instead of serializing.

Strategy: stub the entire chatgpt_core flow with sleep-heavy fakes, then
run two ``edit_image`` calls under ``asyncio.gather`` and assert wall-clock
time is closer to a single run than to the sum. The threshold is generous
(< 1.7x of one run) to absorb CI jitter while still catching a regression
to a synchronous-in-event-loop implementation, which would land at ~2x.
"""

import asyncio
import time
from io import BytesIO

import pytest
from PIL import Image

from app.providers.chatgpt_web import ChatGPTWebProvider


SLEEP_SECS = 0.4


def _png_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGBA", (8, 8), (0, 255, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


class _FakeSSE:
    def iter_lines(self):
        yield b'data: {"conversation_id": "cid"}'
        yield b"data: [DONE]"

    def close(self):
        pass


class _Req:
    token = "t"
    proof_token = ""
    turnstile_token = ""
    so_token = ""
    raw_finalize = {}


def _stub_blocking_flow(monkeypatch):
    """Replace every chatgpt_core call the provider makes with a sleep stub."""
    import app.providers.chatgpt_web as mod

    def _slow_upload(self, *_a, **_kw):
        time.sleep(SLEEP_SECS)
        return {
            "file_id": "f",
            "file_name": "n",
            "file_size": 1,
            "mime_type": "image/png",
            "width": 8,
            "height": 8,
        }

    monkeypatch.setattr(mod.OpenAIBackendAPI, "_upload_image", _slow_upload, raising=True)
    monkeypatch.setattr(mod.OpenAIBackendAPI, "_bootstrap", lambda self: None, raising=True)
    monkeypatch.setattr(
        mod.OpenAIBackendAPI,
        "_get_chat_requirements",
        lambda self: _Req(),
        raising=True,
    )
    monkeypatch.setattr(
        mod.OpenAIBackendAPI,
        "_prepare_image_conversation",
        lambda self, *a, **kw: "conduit",
        raising=True,
    )
    monkeypatch.setattr(
        mod.OpenAIBackendAPI,
        "_start_image_generation",
        lambda self, *a, **kw: _FakeSSE(),
        raising=True,
    )
    monkeypatch.setattr(
        mod.OpenAIBackendAPI,
        "_poll_image_results",
        lambda self, *a, **kw: (["fid"], []),
        raising=True,
    )
    monkeypatch.setattr(
        mod.OpenAIBackendAPI,
        "_resolve_image_urls",
        lambda self, *a, **kw: ["http://example.invalid/img.png"],
        raising=True,
    )

    monkeypatch.setattr(
        ChatGPTWebProvider,
        "_download_first",
        lambda self, urls: b"\x89PNG\r\n\x1a\nfake",
        raising=True,
    )


@pytest.mark.asyncio
async def test_concurrent_edits_run_in_parallel(monkeypatch):
    _stub_blocking_flow(monkeypatch)

    provider_a = ChatGPTWebProvider(access_token="x" * 32, proxy=None)
    provider_b = ChatGPTWebProvider(access_token="y" * 32, proxy=None)

    async def _one(provider):
        return await provider.edit_image(
            image_bytes=_png_bytes(),
            mask_bytes=None,
            prompt="hi",
            user_id="u",
        )

    start = time.perf_counter()
    await asyncio.gather(_one(provider_a), _one(provider_b))
    elapsed = time.perf_counter() - start

    # Sequential would be >= 2 * SLEEP_SECS. Parallel via asyncio.to_thread
    # finishes near SLEEP_SECS. Allow generous slack for CI jitter.
    assert elapsed < SLEEP_SECS * 1.7, (
        f"edits appear to be serialized: elapsed={elapsed:.3f}s, "
        f"expected < {SLEEP_SECS * 1.7:.3f}s"
    )
