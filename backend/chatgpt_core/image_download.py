import logging
from typing import List

from .errors import ensure_ok

logger = logging.getLogger("chatgpt_core")

def _get_file_download_url(self, file_id: str) -> str:
    """Resolve a file id to a downloadable URL via the files endpoint."""
    path = f"/backend-api/files/{file_id}/download"
    response = self.session.get(self.base_url + path, headers=self._headers(path, {"Accept": "application/json"}),
                                timeout=60)
    ensure_ok(response, path)
    data = response.json()
    return data.get("download_url") or data.get("url") or ""

def _get_attachment_download_url(self, conversation_id: str, attachment_id: str) -> str:
    """Resolve a conversation attachment (sediment) id to a downloadable URL."""
    path = f"/backend-api/conversation/{conversation_id}/attachment/{attachment_id}/download"
    response = self.session.get(self.base_url + path, headers=self._headers(path, {"Accept": "application/json"}),
                                timeout=60)
    ensure_ok(response, path)
    data = response.json()
    return data.get("download_url") or data.get("url") or ""

_MAX_RESOLVE_IDS = 10

def _resolve_image_urls(self, conversation_id: str, file_ids: list[str], sediment_ids: list[str]) -> list[str]:
    """Convert image result ids (file or sediment) into downloadable URLs."""
    file_ids = file_ids[:_MAX_RESOLVE_IDS]
    sediment_ids = sediment_ids[:_MAX_RESOLVE_IDS]
    urls = []
    skip_patterns = {"file_upload"}
    for file_id in file_ids:
        if file_id in skip_patterns:
            logger.debug({
                "event": "image_file_id_skipped",
                "source": "file",
                "conversation_id": conversation_id,
                "id": file_id,
            })
            continue
        try:
            url = self._get_file_download_url(file_id)
        except Exception as exc:
            logger.debug({
                "event": "image_download_url_failed",
                "source": "file",
                "conversation_id": conversation_id,
                "id": file_id,
                "error": repr(exc),
            })
            continue
        if url:
            urls.append(url)
        else:
            logger.debug({
                "event": "image_download_url_empty",
                "source": "file",
                "conversation_id": conversation_id,
                "id": file_id,
            })
    if urls or not conversation_id:
        logger.debug({
            "event": "image_urls_resolved",
            "conversation_id": conversation_id,
            "file_ids": file_ids,
            "sediment_ids": sediment_ids,
            "urls": urls,
        })
        return urls
    for sediment_id in sediment_ids:
        try:
            url = self._get_attachment_download_url(conversation_id, sediment_id)
        except Exception as exc:
            logger.debug({
                "event": "image_download_url_failed",
                "source": "sediment",
                "conversation_id": conversation_id,
                "id": sediment_id,
                "error": repr(exc),
            })
            continue
        if url:
            urls.append(url)
        else:
            logger.debug({
                "event": "image_download_url_empty",
                "source": "sediment",
                "conversation_id": conversation_id,
                "id": sediment_id,
            })
    logger.debug({
        "event": "image_urls_resolved",
        "conversation_id": conversation_id,
        "file_ids": file_ids,
        "sediment_ids": sediment_ids,
        "urls": urls,
    })
    return urls
