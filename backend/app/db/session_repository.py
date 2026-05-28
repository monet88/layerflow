from typing import Optional
from app.db.sqlite import get_db_connection


class SessionRepository:
    def save_session(self, user_id: str, encrypted_token: str) -> None:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO user_sessions (user_id, encrypted_access_token, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    encrypted_access_token = excluded.encrypted_access_token,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, encrypted_token),
            )
            conn.commit()

    def get_session(self, user_id: str) -> Optional[str]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT encrypted_access_token FROM user_sessions WHERE user_id = ?",
                (user_id,),
            )
            row = cursor.fetchone()
            if row:
                return row["encrypted_access_token"]
            return None

    def delete_session(self, user_id: str) -> None:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
            conn.commit()
