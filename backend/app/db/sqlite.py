import sqlite3
import os
import threading
from typing import Generator
from contextlib import contextmanager
from app.core.config import settings

_local = threading.local()


def _get_thread_connection() -> sqlite3.Connection:
    """Return a per-thread reusable connection. WAL + busy_timeout set once."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    db_path = settings.SQLITE_PATH
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    _local.conn = conn
    return conn


@contextmanager
def get_db_connection() -> Generator[sqlite3.Connection, None, None]:
    """Yield a per-thread SQLite connection. Caller uses `with` block."""
    yield _get_thread_connection()


def init_db() -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                user_id TEXT PRIMARY KEY,
                encrypted_access_token TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
