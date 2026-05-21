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
        
    mock_close.assert_called_once()

def test_chatgpt_provider_closes_session_on_error():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_close = MagicMock()
    provider.api_client.close = mock_close
    
    provider.api_client._bootstrap = MagicMock(side_effect=RuntimeError("bootstrap error"))
    
    import asyncio
    with pytest.raises(Exception):
        asyncio.run(provider.edit_image(b"source", None, "prompt", "user123"))
            
    mock_close.assert_called_once()

def test_download_first_strips_auth_header():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda: [b"downloaded_bytes"]
    
    auth_header_present = []
    
    def mock_get(url, **kwargs):
        auth_header_present.append("Authorization" in provider.api_client.session.headers)
        return mock_response
        
    provider.api_client.session.get = mock_get
    provider.api_client.session.headers["Authorization"] = "Bearer test_token"
    
    res = provider._download_first(["https://example.com/image.png"])
    assert res == b"downloaded_bytes"
    assert not auth_header_present[0]
    assert "Authorization" in provider.api_client.session.headers

def test_download_first_keeps_auth_header_for_internal_url():
    provider = ChatGPTWebProvider(access_token="test_token")
    provider.api_client.base_url = "https://chatgpt.com"
    provider.api_client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda: [b"downloaded_bytes"]
    
    auth_header_present = []
    
    def mock_get(url, **kwargs):
        auth_header_present.append("Authorization" in provider.api_client.session.headers)
        return mock_response
        
    provider.api_client.session.get = mock_get
    
    res = provider._download_first(["https://chatgpt.com/backend-api/files/download"])
    assert res == b"downloaded_bytes"
    assert auth_header_present[0]
    assert "Authorization" in provider.api_client.session.headers

def test_download_first_limits_max_size():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda: [b"a" * (1024 * 1024)] * 25
    
    provider.api_client.session.get = lambda url, **kwargs: mock_response
    
    with pytest.raises(Exception) as excinfo:
        provider._download_first(["https://example.com/image.png"])
    assert "Download size exceeded" in str(excinfo.value)

def test_upload_image_strips_auth_header():
    client = OpenAIBackendAPI(access_token="test_token")
    client.session.headers["Authorization"] = "Bearer test_token"
    
    mock_post_response = MagicMock()
    mock_post_response.status_code = 200
    mock_post_response.json.return_value = {
        "file_id": "file_123",
        "upload_url": "https://azure.blob/upload"
    }
    
    mock_put_response = MagicMock()
    mock_put_response.status_code = 200
    
    auth_header_present = []
    
    def mock_put(url, **kwargs):
        auth_header_present.append("Authorization" in client.session.headers)
        return mock_put_response
        
    client.session.post = lambda url, **kwargs: mock_post_response
    client.session.put = mock_put
    
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"):
        client._upload_image("base64_data")
        
    assert not auth_header_present[0]
    assert "Authorization" in client.session.headers

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
    
    auth_header_present = []
    
    def mock_put(url, **kwargs):
        auth_header_present.append("Authorization" in client.session.headers)
        return mock_put_response
        
    client.session.post = lambda url, **kwargs: mock_post_response
    client.session.put = mock_put
    
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"):
        client._upload_image("base64_data")
        
    assert auth_header_present[0]
    assert "Authorization" in client.session.headers

def test_upload_image_strips_auth_header_for_attacker_domain():
    client = OpenAIBackendAPI(access_token="test_token")
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
    
    auth_header_present = []
    
    def mock_put(url, **kwargs):
        auth_header_present.append("Authorization" in client.session.headers)
        return mock_put_response
        
    client.session.post = lambda url, **kwargs: mock_post_response
    client.session.put = mock_put
    
    client._decode_image_base64 = lambda img: b"\x89PNG\r\n\x1a\n"
    
    from PIL import Image
    mock_img = MagicMock()
    mock_img.size = (10, 10)
    mock_img.format = "PNG"
    with patch("PIL.Image.open", return_value=mock_img), patch("time.sleep"):
        client._upload_image("base64_data")
        
    assert not auth_header_present[0]
    assert "Authorization" in client.session.headers

def test_download_first_closes_response():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda: [b"downloaded_bytes"]
    
    provider.api_client.session.get = MagicMock(return_value=mock_response)
    
    res = provider._download_first(["https://example.com/image.png"])
    assert res == b"downloaded_bytes"
    mock_response.close.assert_called_once()

def test_download_first_closes_response_on_size_limit_error():
    provider = ChatGPTWebProvider(access_token="test_token")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.iter_content = lambda: [b"a" * (1024 * 1024)] * 25
    
    provider.api_client.session.get = MagicMock(return_value=mock_response)
    
    with pytest.raises(Exception):
        provider._download_first(["https://example.com/image.png"])
    mock_response.close.assert_called_once()
