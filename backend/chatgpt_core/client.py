import hashlib
import logging
import os
from typing import Any, Dict, Optional
from curl_cffi import requests

from .pow_solver import (
    build_proof_token,
    build_legacy_requirements_token,
    parse_pow_resources,
    DEFAULT_POW_SCRIPT,
    new_uuid,
)
from .turnstile import solve_turnstile_token
from .types import ChatRequirements
from .errors import ensure_ok

logger = logging.getLogger("chatgpt_core")

DEFAULT_CLIENT_VERSION = "prod-be885abbfcfe7b1f511e88b3003d9ee44757fbad"
DEFAULT_CLIENT_BUILD_NUMBER = "5955942"
CODEX_IMAGE_MODEL = "codex-gpt-image-2"

from app.core.url_security import validate_and_resolve_url as _default_url_validator
class OpenAIBackendAPI:
    """ChatGPT reverse proxy client targeting image generation endpoints."""

    # Import modularized methods
    from .image_upload import _upload_image, _decode_image_base64
    from .image_generate import (
        _prepare_image_conversation,
        _start_image_generation,
        _image_model_slug,
        _image_headers,
        _conversation_headers,
    )
    from .image_poll import _poll_image_results, _extract_image_tool_records, _get_conversation
    from .image_download import (
        _get_file_download_url,
        _get_attachment_download_url,
        _resolve_image_urls,
    )

    def __init__(
        self,
        access_token: str = "",
        proxy: Optional[str] = None,
        url_validator: Optional[Any] = None,
    ) -> None:
        """Initialize the client with optional access token and proxy."""
        self.base_url = "https://chatgpt.com"
        self.url_validator = url_validator or _default_url_validator
        self.client_version = DEFAULT_CLIENT_VERSION
        self.client_build_number = DEFAULT_CLIENT_BUILD_NUMBER
        self.access_token = access_token.strip()
        
        self.fp = self._build_fp()
        self.user_agent = self.fp["user-agent"]
        self.device_id = self.fp["oai-device-id"]
        self.session_id = self.fp["oai-session-id"]
        
        self.pow_script_sources: list[str] = []
        self.pow_data_build = ""
        
        if not proxy:
            proxy = os.environ.get("CHATGPT_PROXY")
        self.proxy = proxy.strip() if (proxy and proxy.strip()) else None
            
        session_kwargs = {"impersonate": self.fp["impersonate"], "verify": True}
        if self.proxy:
            session_kwargs["proxy"] = self.proxy
            
        self.session = requests.Session(**session_kwargs)
        self.session.headers.update({
            "User-Agent": self.user_agent,
            "Origin": self.base_url,
            "Referer": self.base_url + "/",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Priority": "u=1, i",
            "Sec-Ch-Ua": self.fp["sec-ch-ua"],
            "Sec-Ch-Ua-Arch": '"x86"',
            "Sec-Ch-Ua-Bitness": '"64"',
            "Sec-Ch-Ua-Full-Version": '"143.0.3650.96"',
            "Sec-Ch-Ua-Full-Version-List": '"Microsoft Edge";v="143.0.3650.96", "Chromium";v="143.0.7499.147", "Not A(Brand";v="24.0.0.0"',
            "Sec-Ch-Ua-Mobile": self.fp["sec-ch-ua-mobile"],
            "Sec-Ch-Ua-Model": '""',
            "Sec-Ch-Ua-Platform": self.fp["sec-ch-ua-platform"],
            "Sec-Ch-Ua-Platform-Version": '"19.0.0"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "OAI-Device-Id": self.device_id,
            "OAI-Session-Id": self.session_id,
            "OAI-Language": "en-US",
            "OAI-Client-Version": self.client_version,
            "OAI-Client-Build-Number": self.client_build_number,
        })
        
        if self.access_token:
            self.session.headers["Authorization"] = f"Bearer {self.access_token}"

    def close(self) -> None:
        """Close the curl-cffi session to release resources and connection pool."""
        self.session.close()

    def _build_fp(self) -> Dict[str, str]:
        """Generate static, user-specific or random browser fingerprints."""
        fp = {}
        if self.access_token:
            h = hashlib.sha256(self.access_token.encode("utf-8")).hexdigest()
            device_id = f"{h[0:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:32]}"
            session_id = new_uuid()
        else:
            device_id = new_uuid()
            session_id = new_uuid()

        fp["user-agent"] = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
        )
        fp["impersonate"] = "edge101"
        fp["oai-device-id"] = device_id
        fp["oai-session-id"] = session_id
        fp["sec-ch-ua"] = '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"'
        fp["sec-ch-ua-mobile"] = "?0"
        fp["sec-ch-ua-platform"] = '"Windows"'
        return fp

    def _headers(self, path: str, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Construct request headers with required target path parameters."""
        headers = dict(self.session.headers)
        headers["X-OpenAI-Target-Path"] = path
        headers["X-OpenAI-Target-Route"] = path
        if extra:
            headers.update(extra)
        return headers

    def _bootstrap_headers(self) -> Dict[str, str]:
        """Construct headers for initial page warm-up."""
        return {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Ch-Ua": self.session.headers["Sec-Ch-Ua"],
            "Sec-Ch-Ua-Mobile": self.session.headers["Sec-Ch-Ua-Mobile"],
            "Sec-Ch-Ua-Platform": self.session.headers["Sec-Ch-Ua-Platform"],
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }

    def _build_requirements(self, data: Dict[str, Any], source_p: str = "") -> ChatRequirements:
        """Parse sentinel response to produce necessary tokens."""
        if (data.get("arkose") or {}).get("required"):
            raise RuntimeError("chat requirements requires arkose token, which is not implemented")

        proof_token = ""
        proof_info = data.get("proofofwork") or {}
        if proof_info.get("required"):
            proof_token = build_proof_token(
                proof_info.get("seed", ""),
                proof_info.get("difficulty", ""),
                self.user_agent,
                script_sources=self.pow_script_sources,
                data_build=self.pow_data_build,
            )

        turnstile_token = ""
        turnstile_info = data.get("turnstile") or {}
        if turnstile_info.get("required") and turnstile_info.get("dx"):
            turnstile_token = solve_turnstile_token(turnstile_info["dx"], source_p) or ""

        return ChatRequirements(
            token=data.get("token", ""),
            proof_token=proof_token,
            turnstile_token=turnstile_token,
            so_token=data.get("so_token", ""),
            raw_finalize=data,
        )

    def _bootstrap(self) -> None:
        """Warm up the index page and extract PoW requirements."""
        response = self.session.get(
            self.base_url + "/",
            headers=self._bootstrap_headers(),
            timeout=30,
        )
        ensure_ok(response, "bootstrap")
        self.pow_script_sources, self.pow_data_build = parse_pow_resources(response.text)
        if not self.pow_script_sources:
            self.pow_script_sources = [DEFAULT_POW_SCRIPT]

    def _get_chat_requirements(self) -> ChatRequirements:
        """Retrieve ChatRequirements sentinel tokens."""
        path = "/backend-api/sentinel/chat-requirements" if self.access_token else "/backend-anon/sentinel/chat-requirements"
        context = "auth_chat_requirements" if self.access_token else "noauth_chat_requirements"
        body = {"p": build_legacy_requirements_token(self.user_agent, self.pow_script_sources, self.pow_data_build)}
        response = self.session.post(
            self.base_url + path,
            headers=self._headers(path, {"Content-Type": "application/json"}),
            json=body,
            timeout=30,
        )
        ensure_ok(response, context)
        requirements = self._build_requirements(response.json(), "" if self.access_token else body["p"])
        if not requirements.token:
            message = "missing auth chat requirements token" if self.access_token else "missing chat requirements token"
            raise RuntimeError(f"{message}: {requirements.raw_finalize}")
        return requirements
