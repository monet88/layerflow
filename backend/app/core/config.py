import os
import binascii
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    ENV: str = "development"
    APP_API_KEY: str = "dev-app-key"
    IMAGE_PROVIDER: str = "mock"  # mock | chatgpt_web
    SQLITE_PATH: str = "data/app.sqlite"
    MAX_UPLOAD_MB: int = 20
    ENCRYPTION_KEY: str = ""
    LOG_LEVEL: str = "INFO"
    CHATGPT_BASE_URL: str = "https://chatgpt.com"
    CHATGPT_PROXY: Optional[str] = None
    ALLOWED_ORIGINS: str = "app://uxp-internal,http://localhost:8000"
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_IMAGES: str = "5/minute"

    @field_validator("ENCRYPTION_KEY")
    @classmethod
    def _validate_fernet_key(cls, v: str) -> str:
        v = str(v or "").strip()
        if not v or v.startswith("dev-only") or v == "change-me":
            raise ValueError(
                "ENCRYPTION_KEY is required and must be a real Fernet key. "
                'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        try:
            Fernet(v.encode())
        except (ValueError, binascii.Error, InvalidToken) as exc:
            raise ValueError(f"ENCRYPTION_KEY is not a valid Fernet key: {exc}") from exc
        return v

    @field_validator("APP_API_KEY")
    @classmethod
    def _reject_default_app_key(cls, v: str) -> str:
        v = str(v or "").strip()
        env = os.getenv("ENV", "development")
        if not v or (v == "dev-app-key" and env == "production"):
            raise ValueError("APP_API_KEY must be set to a non-default value in production")
        return v

# We allow lazy loading or loading at module level. Module level is standard for FastAPI config.
# To ensure tests can run without failure if environment is not set, we can load settings.
# However, to fail fast on startup, we instantiate settings immediately.
settings = Settings()
