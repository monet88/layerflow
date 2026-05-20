import base64
from io import BytesIO
from PIL import Image

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

    # Status check
    response = client.get(
        "/auth/chatgpt/session/status",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )
    assert response.status_code == 200
    assert response.json() == {"connected": True}

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
    assert response.status_code == 400
    assert "No active session found" in response.json()["detail"]

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

def test_edit_image_not_implemented_chatgpt_web(client, monkeypatch):
    # Connect a session
    payload = {"access_token": "valid_token_value_longer_than_10_chars"}
    client.post(
        "/auth/chatgpt/session",
        json=payload,
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"}
    )

    # Set provider to chatgpt_web
    from app.core.config import settings
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "chatgpt_web")

    img_io = BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 255)).save(img_io, format="PNG")
    img_bytes = img_io.getvalue()

    response = client.post(
        "/v1/images/edits",
        headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
        files={"image": ("image.png", img_bytes, "image/png")},
        data={"prompt": "draw a cat", "model": "gpt-image-2"}
    )
    assert response.status_code == 501
    assert "not implemented yet" in response.json()["detail"]

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
    assert record_dict.msg["access_token"] == "[REDACTED]"
    assert record_dict.msg["other"] == "public_data"

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
    assert record_args.args["token"] == "[REDACTED]"
    assert record_args.args["nested"]["auth"] == "[REDACTED]"

