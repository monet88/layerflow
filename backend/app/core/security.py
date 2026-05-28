from cryptography.fernet import Fernet
from app.core.config import settings

class TokenCipher:
    def __init__(self, key: str) -> None:
        self.fernet = Fernet(key.encode())

    def encrypt(self, plain_text: str) -> str:
        if not plain_text:
            return ""
        return self.fernet.encrypt(plain_text.encode("utf-8")).decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        if not cipher_text:
            return ""
        return self.fernet.decrypt(cipher_text.encode("utf-8")).decode("utf-8")

cipher = TokenCipher(settings.ENCRYPTION_KEY)
