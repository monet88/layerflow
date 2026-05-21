import base64
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from starlette.datastructures import UploadFile as StarletteUploadFile
from app.providers.chatgpt_web import ChatGPTWebProvider
from chatgpt_core.client import OpenAIBackendAPI

@pytest.fixture(autouse=True)
def disable_rate_limiting():
    from app.api.routes.images import limiter
    was_enabled = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = was_enabled

def test_endpoint_closes_upload_files(client):
    close_calls = []
    original_close = StarletteUploadFile.close
    
    async def spy_close(self):
        close_calls.append(self)
        await original_close(self)
        
    with patch("app.api.routes.images.image_service.edit_image", new_callable=AsyncMock) as mock_edit, \
         patch.object(StarletteUploadFile, "close", spy_close):
        mock_edit.return_value = {"status": "success"}
        
        from io import BytesIO
        img_bytes = BytesIO(b"dummy image content")
        mask_bytes = BytesIO(b"dummy mask content")
        
        response = client.post(
            "/v1/images/edits",
            headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
            files={
                "image": ("image.png", img_bytes, "image/png"),
                "mask": ("mask.png", mask_bytes, "image/png"),
            },
            data={"prompt": "draw a cat", "model": "gpt-image-2"},
        )
        assert response.status_code == 200
        
        filenames_closed = [getattr(f, "filename", None) for f in close_calls]
        assert "image.png" in filenames_closed
        assert "mask.png" in filenames_closed

def test_endpoint_closes_files_on_error(client):
    close_calls = []
    original_close = StarletteUploadFile.close
    
    async def spy_close(self):
        close_calls.append(self)
        await original_close(self)
        
    with patch("app.api.routes.images.image_service.edit_image", new_callable=AsyncMock) as mock_edit, \
         patch.object(StarletteUploadFile, "close", spy_close):
        mock_edit.side_effect = ValueError("invalid value")
        
        from io import BytesIO
        img_bytes = BytesIO(b"dummy image content")
        
        response = client.post(
            "/v1/images/edits",
            headers={"Authorization": "Bearer test-api-key", "X-User-Id": "user123"},
            files={
                "image": ("image.png", img_bytes, "image/png"),
            },
            data={"prompt": "draw a cat", "model": "gpt-image-2"},
        )
        assert response.status_code == 400
        
        filenames_closed = [getattr(f, "filename", None) for f in close_calls]
        assert "image.png" in filenames_closed

def test_chatgpt_provider_closes_client_session():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_close = MagicMock()
    provider.api_client.close = mock_close
    
    # Mocking all client calls inside _run_flow_sync so it runs cleanly
    provider.api_client._bootstrap = MagicMock()
    provider._composite_mask = MagicMock(return_value=b"composed")
    provider.api_client._upload_image = MagicMock(return_value={"file_id": "1"})
    provider.api_client._get_chat_requirements = MagicMock()
    provider.api_client._prepare_image_conversation = MagicMock()
    provider.api_client._start_image_generation = MagicMock()
    provider._extract_conversation_id = MagicMock(return_value="conv123")
    provider.api_client._poll_image_results = MagicMock(return_value=(["file1"], []))
    provider.api_client._resolve_image_urls = MagicMock(return_value=["http://url"])
    provider._download_first = MagicMock(return_value=b"png_bytes")
    
    import asyncio
    asyncio.run(provider.edit_image(b"source", None, "prompt", "user123"))
    asyncio.run(provider.close())
        
    mock_close.assert_called_once()

def test_chatgpt_provider_closes_session_on_error():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_close = MagicMock()
    provider.api_client.close = mock_close
    
    provider.api_client._bootstrap = MagicMock(side_effect=RuntimeError("bootstrap error"))
    
    import asyncio
    with pytest.raises(Exception):
        asyncio.run(provider.edit_image(b"source", None, "prompt", "user123"))
    asyncio.run(provider.close())
            
    mock_close.assert_called_once()

def test_download_first_strips_auth_header():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"downloaded_bytes"]
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_response

    provider.api_client.url_validator = lambda url: (True, ["1.2.3.4"])

    with patch("curl_cffi.requests.Session", return_value=mock_session):
        res = provider._download_first(["https://example.com/image.png"])
    assert res == b"downloaded_bytes"
    mock_session.get.assert_called_once()
    kwargs = mock_session.get.call_args[1]
    headers = kwargs.get("headers", {})
    assert "Authorization" not in headers
    assert provider.api_client.session.headers["Authorization"] == "Bearer test_token"

def test_download_first_keeps_auth_header_for_internal_url():
    provider = ChatGPTWebProvider(access_token="test_token")
    provider.api_client.base_url = "https://chatgpt.com"
    provider.api_client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"downloaded_bytes"]
    
    mock_get = MagicMock(return_value=mock_response)
    provider.api_client.session.get = mock_get
    
    provider.api_client.url_validator = lambda url: (True, [])
    
    res = provider._download_first(["https://chatgpt.com/backend-api/files/download"])
    assert res == b"downloaded_bytes"
    mock_get.assert_called_once()
    assert provider.api_client.session.headers["Authorization"] == "Bearer test_token"

def test_download_first_limits_max_size():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"a" * (1024 * 1024)] * 25
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_response
    
    provider.api_client.url_validator = lambda url: (True, ["1.2.3.4"])
    
    with patch("curl_cffi.requests.Session", return_value=mock_session):
        with pytest.raises(Exception) as excinfo:
            provider._download_first(["https://example.com/image.png"])
    assert "Download size exceeded" in str(excinfo.value)

def test_upload_image_strips_auth_header():
    client = OpenAIBackendAPI(
        access_token="test_token",
        url_validator=lambda url: (True, ["1.2.3.4"]),
    )
    client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        "file_id": "file_123",
        "upload_url": "https://azure.blob/upload"
    }
    
    mock_put_response = MagicMock()
    mock_put_response.status_code = 200
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.put.return_value = mock_put_response
    
    client.session.post = lambda url, **kwargs: mock_post_response
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"), patch("curl_cffi.requests.Session", return_value=mock_session):
        client._upload_image("base64_data")
        
    mock_session.put.assert_called_once()
    kwargs = mock_session.put.call_args[1]
    headers = kwargs.get("headers", {})
    assert "Authorization" not in headers
    assert client.session.headers["Authorization"] == "Bearer test_token"

def test_upload_image_keeps_auth_header_for_internal_url():
    client = OpenAIBackendAPI(access_token="test_token")
    client.base_url = "https://chatgpt.com"
    client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        "file_id": "file_123",
        "upload_url": "https://chatgpt.com/backend-api/upload"
    }
    
    mock_put_response = MagicMock()
    mock_put_response.status_code = 200
    
    client.session.post = lambda url, **kwargs: mock_post_response
    client.session.put = MagicMock(return_value=mock_put_response)
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"):
        client._upload_image("base64_data")
        
    client.session.put.assert_called_once()
    assert client.session.headers["Authorization"] == "Bearer test_token"

def test_upload_image_strips_auth_header_for_attacker_domain():
    client = OpenAIBackendAPI(
        access_token="test_token",
        url_validator=lambda url: (True, ["1.2.3.4"]),
    )
    client.base_url = "https://chatgpt.com"
    client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        "file_id": "file_123",
        "upload_url": "https://chatgpt.com.attacker.net/upload"
    }
    
    mock_put_response = MagicMock()
    mock_put_response.status_code = 200
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.put.return_value = mock_put_response
    
    client.session.post = lambda url, **kwargs: mock_post_response
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"), patch("curl_cffi.requests.Session", return_value=mock_session):
        client._upload_image("base64_data")
        
    mock_session.put.assert_called_once()
    kwargs = mock_session.put.call_args[1]
    headers = kwargs.get("headers", {})
    assert "Authorization" not in headers
    assert client.session.headers["Authorization"] == "Bearer test_token"

def test_download_first_closes_response():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"downloaded_bytes"]
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_response
    
    provider.api_client.url_validator = lambda url: (True, ["1.2.3.4"])
    
    with patch("curl_cffi.requests.Session", return_value=mock_session):
        res = provider._download_first(["https://example.com/image.png"])
    assert res == b"downloaded_bytes"
    mock_response.close.assert_called_once()

def test_download_first_closes_response_on_size_limit_error():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"a" * (1024 * 1024)] * 25
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_response
    
    provider.api_client.url_validator = lambda url: (True, ["1.2.3.4"])
    
    with pytest.raises(Exception):
        with patch("curl_cffi.requests.Session", return_value=mock_session):
            provider._download_first(["https://example.com/image.png"])
    mock_response.close.assert_called_once()

def test_download_first_ssrf_validation():
    provider = ChatGPTWebProvider(access_token="test_token")
    provider.api_client.url_validator = lambda url: (False, [])
    with pytest.raises(Exception) as excinfo:
        provider._download_first(["https://example.com/image.png"])
    assert "SSRF block" in str(excinfo.value)

def test_upload_image_ssrf_validation():
    client = OpenAIBackendAPI(
        access_token="test_token",
        url_validator=lambda url: (False, []),
    )
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        "file_id": "file_123",
        "upload_url": "https://azure.blob/upload"
    }
    client.session.post = lambda url, **kwargs: mock_post_response
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"):
        with pytest.raises(ValueError) as excinfo:
            client._upload_image("base64_data")
        assert "SSRF block" in str(excinfo.value)

def test_early_size_limit_middleware(client):
    headers = {
        "Authorization": "Bearer test-api-key",
        "X-User-Id": "user123",
        "Content-Length": str(4 * 1024 * 1024),
        "Content-Type": "application/json"
    }
    response = client.post("/v1/images/edits", headers=headers, content=b"x" * 100)
    assert response.status_code == 413
    assert "Request Entity Too Large" in response.text

def test_download_first_strips_oai_headers():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"downloaded_bytes"]
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_response
    
    provider.api_client.url_validator = lambda url: (True, ["1.2.3.4"])
    
    provider.api_client.session.headers["Authorization"] = "Bearer test_token"
    provider.api_client.session.headers["OAI-Device-Id"] = "device-123"
    
    with patch("curl_cffi.requests.Session", return_value=mock_session):
        res = provider._download_first(["https://example.com/image.png"])
    assert res == b"downloaded_bytes"
    mock_session.get.assert_called_once()
    kwargs = mock_session.get.call_args[1]
    headers = kwargs.get("headers", {})
    assert "Authorization" not in headers
    assert "OAI-Device-Id" not in headers
    assert "Authorization" in provider.api_client.session.headers
    assert "OAI-Device-Id" in provider.api_client.session.headers

def test_upload_image_strips_oai_headers():
    client = OpenAIBackendAPI(
        access_token="test_token",
        url_validator=lambda url: (True, ["1.2.3.4"]),
    )
    client.session.headers["Authorization"] = "Bearer test_token"
    client.session.headers["OAI-Device-Id"] = "device-123"
    
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        "file_id": "file_123",
        "upload_url": "https://azure.blob/upload"
    }
    
    mock_put_response = MagicMock()
    mock_put_response.status_code = 200
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.put.return_value = mock_put_response
    
    client.session.post = lambda url, **kwargs: mock_post_response
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"), patch("curl_cffi.requests.Session", return_value=mock_session):
        client._upload_image("base64_data")
        
    mock_session.put.assert_called_once()
    kwargs = mock_session.put.call_args[1]
    headers = kwargs.get("headers", {})
    assert "Authorization" not in headers
    assert "OAI-Device-Id" not in headers
    assert "Authorization" in client.session.headers
    assert "OAI-Device-Id" in client.session.headers

def test_url_security_ipv4_mapped_ipv6():
    from app.core.url_security import validate_and_resolve_url
    import socket
    
    with patch("socket.getaddrinfo") as mock_getaddrinfo:
        # ::ffff:127.0.0.1
        mock_getaddrinfo.return_value = [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::ffff:127.0.0.1", 0, 0, 0))
        ]
        safe, resolved = validate_and_resolve_url("https://example.com/test")
        assert not safe
        assert resolved == []

        # ::ffff:169.254.169.254
        mock_getaddrinfo.return_value = [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::ffff:169.254.169.254", 0, 0, 0))
        ]
        safe, resolved = validate_and_resolve_url("https://example.com/test")
        assert not safe
        assert resolved == []

        # ::ffff:8.8.8.8 (public IP mapped to IPv6)
        mock_getaddrinfo.return_value = [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::ffff:8.8.8.8", 0, 0, 0))
        ]
        safe, resolved = validate_and_resolve_url("https://example.com/test")
        assert safe
        assert "8.8.8.8" in resolved

def test_client_proxy_setting_preserved():
    client = OpenAIBackendAPI(access_token="test_token", proxy="http://my-proxy:8080")
    assert client.proxy == "http://my-proxy:8080"


@pytest.mark.asyncio
async def test_early_size_limit_middleware_no_double_send():
    from main import ContentLengthLimitMiddleware, ContentTooLargeError
    from starlette.responses import Response

    async def mock_app(scope, receive, send):
        try:
            await receive()
        except ContentTooLargeError:
            # Simulate app starting a response before raising/propagating error
            await send({
                "type": "http.response.start",
                "status": 500,
                "headers": [(b"content-type", b"text/plain")]
            })
            raise RuntimeError("App error after response start")

    middleware = ContentLengthLimitMiddleware(mock_app, max_content_length=10)

    async def dummy_receive():
        return {"type": "http.request", "body": b"x" * 20, "more_body": False}

    sends = []
    async def dummy_send(message):
        sends.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "headers": []
    }

    with pytest.raises(RuntimeError, match="App error after response start"):
        await middleware(scope, dummy_receive, dummy_send)

    # Verify that only the app's start message was sent (no 413 response is started)
    assert len(sends) == 1
    assert sends[0]["type"] == "http.response.start"
    assert sends[0]["status"] == 500


def test_url_security_ipv4_compatible_ipv6():
    from app.core.url_security import validate_and_resolve_url
    import socket
    
    with patch("socket.getaddrinfo") as mock_getaddrinfo:
        # ::127.0.0.1 (IPv4-compat loopback)
        mock_getaddrinfo.return_value = [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::127.0.0.1", 0, 0, 0))
        ]
        safe, resolved = validate_and_resolve_url("https://example.com/test")
        assert not safe
        assert resolved == []

        # ::169.254.169.254 (IPv4-compat link-local)
        mock_getaddrinfo.return_value = [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::169.254.169.254", 0, 0, 0))
        ]
        safe, resolved = validate_and_resolve_url("https://example.com/test")
        assert not safe
        assert resolved == []

        # ::8.8.8.8 (IPv4-compat public)
        mock_getaddrinfo.return_value = [
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::8.8.8.8", 0, 0, 0))
        ]
        safe, resolved = validate_and_resolve_url("https://example.com/test")
        assert safe
        assert "8.8.8.8" in resolved


def test_download_first_manual_redirect_ssrf_block():
    from app.providers.chatgpt_web import ChatGPTWebProvider
    provider = ChatGPTWebProvider(access_token="test_token")
    
    mock_redirect_response = MagicMock()
    mock_redirect_response.status_code = 302
    mock_redirect_response.headers = {"Location": "http://127.0.0.1/admin"}
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_redirect_response

    # Setup url_validator to allow the first URL but block 127.0.0.1
    def mock_validator(url):
        if "127.0.0.1" in url:
            return False, []
        return True, ["93.184.216.34"] # example.com IP
        
    provider.api_client.url_validator = mock_validator
    
    with patch("curl_cffi.requests.Session", return_value=mock_session):
        with pytest.raises(Exception, match="SSRF block"):
            provider._download_first(["https://example.com/redirect"])


def test_fastapi_content_too_large_handler():
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    from starlette.responses import Response
    from main import ContentTooLargeError
    
    app_test = FastAPI()
    @app_test.exception_handler(ContentTooLargeError)
    async def handler(request, exc):
        return Response("Request Entity Too Large", status_code=413)
        
    @app_test.post("/test")
    async def route():
        raise ContentTooLargeError("Too large")
        
    client = TestClient(app_test)
    response = client.post("/test")
    assert response.status_code == 413
    assert response.text == "Request Entity Too Large"


def test_download_first_ipv6_curlopt_resolve_brackets():
    from app.providers.chatgpt_web import ChatGPTWebProvider
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda *args, **kwargs: [b"downloaded_bytes"]
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.get.return_value = mock_response

    provider.api_client.url_validator = lambda url: (True, ["2001:db8::1"])
    mock_session_class = MagicMock()
    mock_session_class.return_value.__enter__.return_value = mock_session

    with patch("curl_cffi.requests.Session", mock_session_class):
        res = provider._download_first(["https://example.com/image.png"])
        
    assert res == b"downloaded_bytes"
    mock_session_class.assert_called_once()
    called_kwargs = mock_session_class.call_args[1]
    assert "curl_options" in called_kwargs
    from curl_cffi import CurlOpt
    resolve_list = called_kwargs["curl_options"][CurlOpt.RESOLVE]
    assert resolve_list == ["example.com:443:[2001:db8::1]"]


def test_upload_image_ipv6_curlopt_resolve_brackets():
    client = OpenAIBackendAPI(
        access_token="test_token",
        url_validator=lambda url: (True, ["2001:db8::1"]),
    )
    client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {"upload_url": "https://example.com/upload", "file_id": "file-123"}
    
    mock_put_response = MagicMock()
    mock_put_response.status_code = 200
    
    mock_session = MagicMock()
    mock_session.__enter__.return_value = mock_session
    mock_session.put.return_value = mock_put_response
    
    mock_session_class = MagicMock()
    mock_session_class.return_value.__enter__.return_value = mock_session
    
    client.session.post = lambda url, **kwargs: mock_post_response
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"), patch("curl_cffi.requests.Session", mock_session_class):
        client._upload_image("base64_data")
        
    mock_session_class.assert_called_once()
    called_kwargs = mock_session_class.call_args[1]
    assert "curl_options" in called_kwargs
    from curl_cffi import CurlOpt
    resolve_list = called_kwargs["curl_options"][CurlOpt.RESOLVE]
    assert resolve_list == ["example.com:443:[2001:db8::1]"]


def test_download_first_empty_resolved_ips_blocked():
    from app.providers.chatgpt_web import ChatGPTWebProvider
    provider = ChatGPTWebProvider(access_token="test_token")
    provider.api_client.url_validator = lambda url: (True, [])
    with pytest.raises(Exception, match="SSRF block"):
        provider._download_first(["https://example.com/image.png"])


def test_upload_image_empty_resolved_ips_blocked():
    client = OpenAIBackendAPI(
        access_token="test_token",
        url_validator=lambda url: (True, []),
    )
    client.session.post = lambda url, **kwargs: MagicMock(status_code=200, json=lambda: {"upload_url": "https://example.com/upload", "file_id": "file-123"})
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"):
        with pytest.raises(ValueError, match="SSRF block: Upload URL is not safe"):
            client._upload_image("base64_data")
