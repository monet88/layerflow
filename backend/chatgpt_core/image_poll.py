import time
import random
import re
import logging
from typing import Any, Dict, Tuple
from curl_cffi import requests

from .errors import UpstreamHTTPError, ImagePollTimeoutError

logger = logging.getLogger("chatgpt_core")

def _get_conversation(self, conversation_id: str) -> Dict[str, Any]:
    """Fetch the full conversation document."""
    path = f"/backend-api/conversation/{conversation_id}"
    response = self.session.get(self.base_url + path, headers=self._headers(path, {"Accept": "application/json"}),
                                timeout=60)
    from .errors import ensure_ok
    ensure_ok(response, path)
    return response.json()

def _extract_image_tool_records(self, data: Dict[str, Any]) -> list[Dict[str, Any]]:
    """Extract image tool output records from a conversation document."""
    mapping = data.get("mapping") or {}
    file_pat = re.compile(r"file-service://([A-Za-z0-9_-]+)")
    sed_pat = re.compile(r"sediment://([A-Za-z0-9_-]+)")
    records = []
    for message_id, node in mapping.items():
        message = (node or {}).get("message") or {}
        author = message.get("author") or {}
        metadata = message.get("metadata") or {}
        content = message.get("content") or {}
        if author.get("role") != "tool":
            continue
        if content.get("content_type") != "multimodal_text":
            continue
        file_ids, sediment_ids = [], []
        for part in content.get("parts") or []:
            text = (part.get("asset_pointer") or "") if isinstance(part, dict) else (
                part if isinstance(part, str) else "")
            for hit in file_pat.findall(text):
                if hit not in file_ids:
                    file_ids.append(hit)
            for hit in sed_pat.findall(text):
                if hit not in sediment_ids:
                    sediment_ids.append(hit)
        if metadata.get("async_task_type") != "image_gen" and not file_ids and not sediment_ids:
            continue
        records.append(
            {"message_id": message_id, "create_time": message.get("create_time") or 0, "file_ids": file_ids,
             "sediment_ids": sediment_ids})
    return sorted(records, key=lambda item: item["create_time"])

def _poll_image_results(self, conversation_id: str, timeout_secs: float = 120.0) -> Tuple[list[str], list[str]]:
    """Poll the conversation document until image file ids appear or budget runs out.

    - Sleeps image_poll_initial_wait_secs first (default 10s, +jitter). ChatGPT
      image generation takes ~30s; polling immediately wastes requests and trips
      a transient 429 the upstream returns within ~200ms of the SSE stream
      closing (the conversation document is not yet committed).
    - Subsequent polls are image_poll_interval_secs apart (default 10s).
    - On upstream 429 / 5xx or network errors, backs off exponentially
      (capped at 16s, +jitter) honoring Retry-After when present.
    - All sleeps stay within timeout_secs; on exhaustion raises ImagePollTimeoutError.
    """
    start = time.time()
    attempt = 0
    interval = float(getattr(self, "image_poll_interval_secs", 10.0))
    initial_wait = float(getattr(self, "image_poll_initial_wait_secs", 10.0))
    logger.info({
        "event": "image_poll_start",
        "conversation_id": conversation_id,
        "timeout_secs": timeout_secs,
        "initial_wait_secs": initial_wait,
        "interval_secs": interval,
    })

    def _remaining() -> float:
        return timeout_secs - (time.time() - start)

    if initial_wait > 0:
        jitter = random.uniform(0, min(2.0, initial_wait * 0.2))
        sleep_for = min(initial_wait + jitter, max(0.0, _remaining()))
        if sleep_for > 0:
            time.sleep(sleep_for)

    def _retry_sleep(reason: str, status_code: int | None, error: str | None, retry_after: int | None) -> bool:
        # retry_after=0 means "retry immediately" — must not be coerced via falsy check.
        base = retry_after if retry_after is not None else min(2 ** min(attempt, 4), 16)
        backoff = base + random.uniform(0, 0.5)
        remaining = _remaining()
        if remaining <= 0:
            return False
        sleep_for = min(backoff, remaining)
        log_payload: Dict[str, Any] = {
            "event": "image_poll_retry",
            "conversation_id": conversation_id,
            "attempt": attempt,
            "reason": reason,
            "sleep_secs": round(sleep_for, 2),
        }
        if status_code is not None:
            log_payload["status_code"] = status_code
        if error is not None:
            log_payload["error"] = error
        logger.warning(log_payload)
        time.sleep(sleep_for)
        return True

    while _remaining() > 0:
        attempt += 1
        try:
            conversation = self._get_conversation(conversation_id)
        except UpstreamHTTPError as exc:
            if exc.status_code in (429, 500, 502, 503, 504):
                if _retry_sleep("upstream_status", exc.status_code, None, exc.retry_after):
                    continue
                break
            raise
        except Exception as exc:
            if _retry_sleep("network", None, str(exc), None):
                continue
            break

        file_ids, sediment_ids = [], []
        for record in self._extract_image_tool_records(conversation):
            for file_id in record["file_ids"]:
                if file_id not in file_ids:
                    file_ids.append(file_id)
            for sediment_id in record["sediment_ids"]:
                if sediment_id not in sediment_ids:
                    sediment_ids.append(sediment_id)
        logger.debug({"event": "image_poll_check", "conversation_id": conversation_id, "attempt": attempt,
                      "file_ids": file_ids, "sediment_ids": sediment_ids})
        if file_ids:
            logger.info({"event": "image_poll_hit", "conversation_id": conversation_id, "file_ids": file_ids,
                         "sediment_ids": sediment_ids})
            return file_ids, sediment_ids
        if sediment_ids:
            logger.info({"event": "image_poll_hit", "conversation_id": conversation_id, "file_ids": [],
                         "sediment_ids": sediment_ids})
            return [], sediment_ids
        logger.debug({"event": "image_poll_wait", "conversation_id": conversation_id,
                      "elapsed_secs": round(time.time() - start, 1)})
        wait = min(interval, max(0.0, _remaining()))
        if wait > 0:
            time.sleep(wait)
            
    logger.info({
        "event": "image_poll_timeout",
        "conversation_id": conversation_id,
        "timeout_secs": timeout_secs,
        "attempts_made": attempt,
        "initial_wait_exhausted_budget": attempt == 0,
    })
    raise ImagePollTimeoutError(
        f"ChatGPT image generation timed out after {timeout_secs}s. "
        f"This may indicate account rate limiting or upstream queue congestion."
    )
