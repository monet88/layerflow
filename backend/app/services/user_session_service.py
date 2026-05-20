from typing import Optional
from app.db.session_repository import SessionRepository
from app.core.security import cipher

class UserSessionService:
    """Manages user sessions, handles access token encryption/decryption, and maps to the repository."""

    def __init__(self) -> None:
        self.repo = SessionRepository()

    def store_token(self, user_id: str, access_token: str) -> None:
        encrypted_token = cipher.encrypt(access_token)
        self.repo.save_session(user_id, encrypted_token)

    def get_token(self, user_id: str) -> Optional[str]:
        encrypted_token = self.repo.get_session(user_id)
        if not encrypted_token:
            return None
        return cipher.decrypt(encrypted_token)

    def has_session(self, user_id: str) -> bool:
        return self.repo.get_session(user_id) is not None

    def clear_session(self, user_id: str) -> None:
        self.repo.delete_session(user_id)
