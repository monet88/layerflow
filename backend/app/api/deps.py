import hmac
import re
from typing import Optional
from fastapi import Header, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

security_scheme = HTTPBearer(auto_error=False)

# Only alphanumeric, underscore, hyphen; 1-64 chars. Prevents path traversal
# if user_id ever appears in filesystem paths, log filenames, or exports.
_USER_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")

def verify_app_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_scheme),
) -> str:
    """Validate that the incoming request has the correct APP_API_KEY in the Bearer Authorization header."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not hmac.compare_digest(credentials.credentials, settings.APP_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid App API Key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials

def get_user_id(x_user_id: str = Header(..., alias="X-User-Id")) -> str:
    """Retrieve and validate the X-User-Id header from the request."""
    user_id = x_user_id.strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-User-Id header is required and cannot be empty",
        )
    if not _USER_ID_PATTERN.match(user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-User-Id must be 1-64 alphanumeric characters, underscores, or hyphens",
        )
    return user_id


def get_chatgpt_access_token(
    x_chatgpt_access_token: Optional[str] = Header(None, alias="X-ChatGPT-Access-Token"),
) -> Optional[str]:
    token = (x_chatgpt_access_token or "").strip()
    if not token:
        return None
    if len(token) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-ChatGPT-Access-Token must be at least 10 characters",
        )
    return token
