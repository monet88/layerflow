import base64
from io import BytesIO
from typing import Any, cast
from PIL import Image

from app.providers.mock_provider import get_fallback_png

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_models_no_auth(client):
    response = client.get("/v1/models")
    assert response.status_code == 401

    response = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert response.status_code == 401

def test_models_auth(client):
    response = client.get("/v1/models", headers={"Authorization": "Bearer test-api-key"})
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert any(m["id"] == "gpt-image-2" for m in data["data"])


def test_cors_allows_chatgpt_access_token_header(client):
    response = client.options(
        "/v1/images/generations",
        headers={
            "Origin": "http://localhost:8000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type, X-User-Id, X-ChatGPT-Access-Token",
        },
    )
    assert response.status_code == 200
    allow_headers = response.headers["access-control-allow-headers"].lower()
    assert "x-chatgpt-access-token" in allow_headers

def test_session_status_unconnected(client):
    response = client.get(
        "/auth/chatgpt/session/status",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )
    assert response.status_code == 200
    assert response.json() == {"connected": False}

def test_connect_session(client):
    # Store token
    payload = {"access_token": "valid_token_value_longer_than_10_chars"}
    response = client.post(
        "/auth/chatgpt/session",
        json=payload,
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Backend image routes receive the current access token per request.
    response = client.get(
        "/auth/chatgpt/session/status",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )
    assert response.status_code == 200
    assert response.json() == {"connected": False}

def test_disconnect_session(client):
    # Connect first
    payload = {"access_token": "valid_token_value_longer_than_10_chars"}
    client.post(
        "/auth/chatgpt/session",
        json=payload,
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )

    # Disconnect
    response = client.delete(
        "/auth/chatgpt/session",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify status is false
    response = client.get(
        "/auth/chatgpt/session/status",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )
    assert response.json() == {"connected": False}

def test_edit_image_no_session(client, monkeypatch):
    # Temporarily set provider to chatgpt_web
    from app.core.config import settings
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "chatgpt_web")

    img_io = BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 255)).save(img_io, format="PNG")
    img_bytes = img_io.getvalue()

    response = client.post(
        "/v1/images/edits",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user_without_session"},
        files={"image": ("image.png", img_bytes, "image/png")},
        data={"prompt": "draw a cat", "model": "gpt-image-2"}
    )
    assert response.status_code == 401
    detail = response.json()["detail"]
    assert detail["code"] == "provider_auth_failed"

def test_generate_image_mock(client):
    response = client.post(
        "/v1/images/generations",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
        json={"prompt": "draw a cat", "model": "gpt-image-2"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert len(data["data"]) == 1
    decoded = base64.b64decode(data["data"][0]["b64_json"])
    assert decoded == get_fallback_png()


def test_generate_image_rejects_invalid_payload(client):
    headers = {"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    invalid_payloads = [
        {"prompt": "", "model": "gpt-image-2"},
        {"prompt": "draw a cat", "model": "unsupported"},
        {"prompt": "draw a cat", "model": "gpt-image-2", "n": 2},
        {"prompt": "draw a cat", "model": "gpt-image-2", "size": "4096x4096"},
        {"prompt": "draw a cat", "model": "gpt-image-2", "size": "1536x1536"},
    ]

    for payload in invalid_payloads:
        response = client.post(
            "/v1/images/generations",
            headers=headers,
            json=payload,
        )
        assert response.status_code == 422


def test_generate_image_chatgpt_web_requires_access_token(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "chatgpt_web")

    response = client.post(
        "/v1/images/generations",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
        json={"prompt": "draw a cat", "model": "gpt-image-2"},
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "provider_auth_failed"


def test_generate_image_chatgpt_web_uses_request_access_token(client, monkeypatch):
    from app.core.config import settings
    from app.providers.chatgpt_web import ChatGPTWebProvider
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "chatgpt_web")

    async def _generate_image(_self, *_args, **_kwargs):
        return {
            "created": 1,
            "data": [{"b64_json": base64.b64encode(get_fallback_png()).decode()}],
        }

    monkeypatch.setattr(ChatGPTWebProvider, "generate_image", _generate_image, raising=True)

    response = client.post(
        "/v1/images/generations",
        headers={
            "Authorization": "Bearer test-api-key",
            "X-User-Id": "user123",
            "X-ChatGPT-Access-Token": "valid_token_value_longer_than_10_chars",
        },
        json={"prompt": "draw a cat", "model": "gpt-image-2"},
    )
    assert response.status_code == 200
    decoded = base64.b64decode(response.json()["data"][0]["b64_json"])
    assert decoded == get_fallback_png()


def test_edit_image_mock(client):
    img_io = BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 255)).save(img_io, format="PNG")
    img_bytes = img_io.getvalue()

    response = client.post(
        "/v1/images/edits",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
        files={"image": ("image.png", img_bytes, "image/png")},
        data={"prompt": "draw a cat", "model": "gpt-image-2"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert len(data["data"]) == 1
    assert "b64_json" in data["data"][0]

    # Decode and verify it's the echoed image bytes
    decoded = base64.b64decode(data["data"][0]["b64_json"])
    assert decoded == img_bytes

def test_edit_image_size_exceeded(client):
    # Max file size set to 1MB. Create a 1.5MB dummy file
    huge_bytes = b"\x00" * (1024 * 1024 + 1000)

    response = client.post(
        "/v1/images/edits",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
        files={"image": ("large.png", huge_bytes, "image/png")},
        data={"prompt": "huge image", "model": "gpt-image-2"}
    )
    assert response.status_code == 413
    assert "exceeds maximum allowed size" in response.json()["detail"]

def test_edit_image_mask_size_exceeded(client):
    img_io = BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 255)).save(img_io, format="PNG")
    img_bytes = img_io.getvalue()
    huge_mask = b"\x00" * (1024 * 1024 + 1000)

    response = client.post(
        "/v1/images/edits",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
        files={
            "image": ("image.png", img_bytes, "image/png"),
            "mask": ("mask.png", huge_mask, "image/png"),
        },
        data={"prompt": "huge mask", "model": "gpt-image-2"}
    )
    assert response.status_code == 413
    assert "exceeds maximum allowed size" in response.json()["detail"]

def test_edit_image_chatgpt_web_auth_error(client, monkeypatch):
    """Phase 8: with a connected session, provider runs and surfaces upstream
    401 as ``provider_auth_failed``. We stub the chatgpt_core flow so no real
    network call is made.
    """
    payload = {"access_token": "valid_token_value_longer_than_10_chars"}
    client.post(
        "/auth/chatgpt/session",
        json=payload,
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
    )

    from app.core.config import settings
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "chatgpt_web")

    from chatgpt_core.errors import UpstreamHTTPError
    from app.providers import chatgpt_web as provider_module

    def _raise_401(self, *_args, **_kwargs):
        raise UpstreamHTTPError("bootstrap", 401, "unauthorized", retry_after=None)

    monkeypatch.setattr(
        provider_module.OpenAIBackendAPI,
        "_upload_image",
        _raise_401,
        raising=True,
    )

    img_io = BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 255)).save(img_io, format="PNG")
    img_bytes = img_io.getvalue()

    response = client.post(
        "/v1/images/edits",
        headers={
            "Authorization": "Bearer test-api-key",
            "X-User-Id": "user123",
            "X-ChatGPT-Access-Token": "valid_token_value_longer_than_10_chars",
        },
        files={"image": ("image.png", img_bytes, "image/png")},
        data={"prompt": "draw a cat", "model": "gpt-image-2"},
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "provider_auth_failed"

def test_logging_filter_redaction():
    import logging
    from app.core.logging import SensitiveFilter

    filt = SensitiveFilter()
    
    # Test string message filtering
    record_str = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="API call with Authorization Bearer eyJhbGciOiJSUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkwIiwi.signature and key",
        args=(),
        exc_info=None
    )
    filt.filter(record_str)
    assert "Bearer [REDACTED]" in record_str.msg
    assert "eyJhbGci" not in record_str.msg

    # Test dict message filtering
    record_dict = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg={"access_token": "secret_token_12345", "other": "public_data"},
        args=(),
        exc_info=None
    )
    filt.filter(record_dict)
    record_dict_msg = cast(dict[str, str], record_dict.msg)
    assert record_dict_msg["access_token"] == "[REDACTED]"
    assert record_dict_msg["other"] == "public_data"

    # Test dict in args filtering
    record_args = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="Log payload: %s",
        args=({"token": "secret_in_args", "nested": {"auth": "secret_auth_val"}},),
        exc_info=None
    )
    filt.filter(record_args)
    record_args_msg = cast(dict[str, Any], record_args.args)
    nested_args_msg = cast(dict[str, str], record_args_msg["nested"])
    assert record_args_msg["token"] == "[REDACTED]"
    assert nested_args_msg["auth"] == "[REDACTED]"
