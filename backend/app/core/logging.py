import logging
import re
from typing import Any, Dict

class SensitiveFilter(logging.Filter):
    """Logging filter that redacts access tokens or auth headers from log messages."""

    # Matches typical Authorization: Bearer tokens or JSON access_token fields
    TOKEN_PATTERNS = [
        re.compile(r"Bearer\s+([a-zA-Z0-9_\-\.]+)", re.IGNORECASE),
        re.compile(r"Bearer\s+([^\"\s\)\},\n\r]+)", re.IGNORECASE),
        re.compile(r"['\"]?access_token['\"]?\s*:\s*['\"]([^'\"]+)['\"]", re.IGNORECASE),
        re.compile(r"['\"]?authorization['\"]?\s*:\s*['\"]Bearer\s+([^'\"]+)['\"]", re.IGNORECASE),
        # Catch bare JWT tokens (eyJxxx.yyy.zzz) not wrapped in Bearer prefix
        re.compile(r"eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+"),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.redact(record.msg)
        elif isinstance(record.msg, dict):
            record.msg = self.redact_dict(record.msg)
        
        if record.args:
            if isinstance(record.args, dict):
                record.args = self.redact_dict(record.args)
            else:
                new_args = []
                for arg in record.args:
                    if isinstance(arg, str):
                        new_args.append(self.redact(arg))
                    elif isinstance(arg, dict):
                        new_args.append(self.redact_dict(arg))
                    else:
                        new_args.append(arg)
                record.args = tuple(new_args)
        return True

    def redact(self, text: str) -> str:
        for pattern in self.TOKEN_PATTERNS:
            # We want to keep the "Bearer " prefix and redact the token body.
            # However, depending on the pattern group we can substitute.
            # To be simple and robust:
            text = pattern.sub("Bearer [REDACTED]", text)
        return text

    def redact_dict(self, d: Dict[str, Any]) -> Dict[str, Any]:
        new_d = {}
        for k, v in d.items():
            if k.lower() in ("access_token", "token", "authorization", "auth"):
                new_d[k] = "[REDACTED]"
            elif isinstance(v, str):
                new_d[k] = self.redact(v)
            elif isinstance(v, dict):
                new_d[k] = self.redact_dict(v)
            else:
                new_d[k] = v
        return new_d

def setup_logging(log_level: str = "INFO") -> None:
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(level=numeric_level)
    root = logging.getLogger()
    filt = SensitiveFilter()
    root.addFilter(filt)
    for handler in root.handlers:
        handler.addFilter(filt)
    
    # Also apply to standard loggers of third-party libs
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        l = logging.getLogger(name)
        l.addFilter(filt)
