import time
from typing import Any, Dict, Optional
from curl_cffi import requests

from .errors import ensure_ok
from .pow_solver import new_uuid
from .types import ChatRequirements

CODEX_IMAGE_MODEL = "codex-gpt-image-2"

def _image_model_slug(self, model: str) -> str:
    """把标准图片模型名映射到底层 model slug。"""
    model = str(model or "").strip()
    if not model:
        return "auto"
    if model == "gpt-image-2":
        return "gpt-5-3"
    if model == CODEX_IMAGE_MODEL:
        return model
    return "auto"

def _image_headers(self, path: str, requirements: ChatRequirements, conduit_token: str = "", accept: str = "*/*") -> Dict[str, str]:
    """构造图片链路请求头。"""
    headers = {
        "Content-Type": "application/json",
        "Accept": accept,
        "OpenAI-Sentinel-Chat-Requirements-Token": requirements.token,
    }
    if requirements.proof_token:
        headers["OpenAI-Sentinel-Proof-Token"] = requirements.proof_token
    if conduit_token:
        headers["X-Conduit-Token"] = conduit_token
    if accept == "text/event-stream":
        headers["X-Oai-Turn-Trace-Id"] = new_uuid()
    return self._headers(path, headers)

def _conversation_headers(self, path: str, requirements: ChatRequirements) -> Dict[str, str]:
    """根据当前 requirements 构造对话 SSE 请求头。"""
    headers = {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
        "OpenAI-Sentinel-Chat-Requirements-Token": requirements.token,
    }
    if requirements.proof_token:
        headers["OpenAI-Sentinel-Proof-Token"] = requirements.proof_token
    if requirements.turnstile_token:
        headers["OpenAI-Sentinel-Turnstile-Token"] = requirements.turnstile_token
    if requirements.so_token:
        headers["OpenAI-Sentinel-SO-Token"] = requirements.so_token
    return self._headers(path, headers)

def _prepare_image_conversation(self, prompt: str, requirements: ChatRequirements, model: str) -> str:
    """为图片生成准备 conduit token。"""
    path = "/backend-api/f/conversation/prepare"
    payload = {
        "action": "next",
        "fork_from_shared_post": False,
        "parent_message_id": new_uuid(),
        "model": self._image_model_slug(model),
        "client_prepare_state": "success",
        "timezone_offset_min": -480,
        "timezone": "Asia/Shanghai",
        "conversation_mode": {"kind": "primary_assistant"},
        "system_hints": ["picture_v2"],
        "partial_query": {
            "id": new_uuid(),
            "author": {"role": "user"},
            "content": {"content_type": "text", "parts": [prompt]},
        },
        "supports_buffering": True,
        "supported_encodings": ["v1"],
        "client_contextual_info": {"app_name": "chatgpt.com"},
    }
    response = self.session.post(
        self.base_url + path,
        headers=self._image_headers(path, requirements),
        json=payload,
        timeout=60,
    )
    ensure_ok(response, path)
    return response.json().get("conduit_token", "")

def _start_image_generation(self, prompt: str, requirements: ChatRequirements, conduit_token: str, model: str,
                            references: Optional[list[Dict[str, Any]]] = None) -> requests.Response:
    """启动图片生成或编辑的 SSE 请求。"""
    references = references or []
    parts = [{
        "content_type": "image_asset_pointer",
        "asset_pointer": f"file-service://{item['file_id']}",
        "width": item["width"],
        "height": item["height"],
        "size_bytes": item["file_size"],
    } for item in references]
    parts.append(prompt)
    content = {"content_type": "multimodal_text", "parts": parts} if references else {"content_type": "text",
                                                                                      "parts": [prompt]}
    metadata = {
        "developer_mode_connector_ids": [],
        "selected_github_repos": [],
        "selected_all_github_repos": False,
        "system_hints": ["picture_v2"],
        "serialization_metadata": {"custom_symbol_offsets": []},
    }
    if references:
        metadata["attachments"] = [{
            "id": item["file_id"],
            "mimeType": item["mime_type"],
            "name": item["file_name"],
            "size": item["file_size"],
            "width": item["width"],
            "height": item["height"],
        } for item in references]
    payload = {
        "action": "next",
        "messages": [{
            "id": new_uuid(),
            "author": {"role": "user"},
            "create_time": time.time(),
            "content": content,
            "metadata": metadata,
        }],
        "parent_message_id": new_uuid(),
        "model": self._image_model_slug(model),
        "client_prepare_state": "sent",
        "timezone_offset_min": -480,
        "timezone": "Asia/Shanghai",
        "conversation_mode": {"kind": "primary_assistant"},
        "enable_message_followups": True,
        "system_hints": ["picture_v2"],
        "supports_buffering": True,
        "supported_encodings": ["v1"],
        "client_contextual_info": {
            "is_dark_mode": False,
            "time_since_loaded": 1200,
            "page_height": 1072,
            "page_width": 1724,
            "pixel_ratio": 1.2,
            "screen_height": 1440,
            "screen_width": 2560,
            "app_name": "chatgpt.com",
        },
        "paragen_cot_summary_display_override": "allow",
        "force_parallel_switch": "auto",
    }
    path = "/backend-api/f/conversation"
    response = self.session.post(
        self.base_url + path,
        headers=self._image_headers(path, requirements, conduit_token, "text/event-stream"),
        json=payload,
        timeout=300,
        stream=True,
    )
    ensure_ok(response, path)
    return response
