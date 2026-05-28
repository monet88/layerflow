from typing import Any
from curl_cffi import requests

class InvalidAccessTokenError(RuntimeError):
    pass

class ImagePollTimeoutError(RuntimeError):
    pass

class UpstreamHTTPError(RuntimeError):
    """Raised when an upstream HTTP call returns a non-2xx status.

    Carries structured fields (status_code, body, retry_after) so callers can
    branch on status code instead of string-matching on str(exc). The full
    body is preserved on the instance; the formatted message truncates it
    to keep log lines reasonable.
    """

    def __init__(
        self,
        context: str,
        status_code: int,
        body: Any,
        retry_after: int | None = None,
    ) -> None:
        self.context = context
        self.status_code = status_code
        self.body = body
        self.retry_after = retry_after
        import json
        if isinstance(body, (dict, list)):
            try:
                body_str = json.dumps(body, ensure_ascii=False)
            except (TypeError, ValueError):
                body_str = repr(body)
        else:
            body_str = str(body)
        
        limit = 500
        if len(body_str) > limit:
            body_str = body_str[:limit] + "…[truncated]"
        super().__init__(f"{context} failed: status={status_code}, body={body_str}")

def ensure_ok(response: requests.Response, context: str) -> None:
    if 200 <= response.status_code < 300:
        return
    body: Any = response.text
    try:
        body = response.json()
    except Exception:
        pass
    retry_after_header = response.headers.get("Retry-After") if hasattr(response, "headers") else None
    retry_after: int | None = None
    if retry_after_header is not None:
        ra_str = str(retry_after_header).strip()
        if ra_str.isdigit():
            retry_after = int(ra_str)
    raise UpstreamHTTPError(context, response.status_code, body, retry_after=retry_after)
