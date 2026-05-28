"""CO-2 regression: ``_decode_image_base64`` must reject path-traversal
inputs after the file-path fallback was removed.
"""

import base64

import pytest

from chatgpt_core.client import OpenAIBackendAPI


def _make_client():
    # Construct the raw client without firing real network — we only need
    # the bound _decode_image_base64 method.
    return OpenAIBackendAPI(access_token="x" * 32, proxy=None)


def test_decode_rejects_empty():
    client = _make_client()
    with pytest.raises(ValueError):
        client._decode_image_base64("")


def test_decode_rejects_local_path_input():
    """Path-like strings are no longer treated as file inputs and decode
    attempts produce binascii errors instead of opening files.
    """
    client = _make_client()
    with pytest.raises(Exception):
        client._decode_image_base64("/etc/passwd")


def test_decode_accepts_bare_base64():
    client = _make_client()
    raw = b"hello-world"
    encoded = base64.b64encode(raw).decode("ascii")
    assert client._decode_image_base64(encoded) == raw


def test_decode_accepts_data_uri():
    client = _make_client()
    raw = b"\x89PNG\r\n\x1a\n"
    encoded = base64.b64encode(raw).decode("ascii")
    assert client._decode_image_base64(f"data:image/png;base64,{encoded}") == raw
