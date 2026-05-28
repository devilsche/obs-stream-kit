"""Server-Side Sessions via user_sessions-Tabelle.

Ersetzt Flask-builtin signed-cookie session fuer Auth-relevante Daten.
Cookie enthaelt nur die Session-UUID; alle Daten sind server-side.
"""
import datetime as dt
from typing import Optional

from app.config import Config


def create(conn, user_id: int, user_agent: Optional[str] = None,
           ip: Optional[str] = None) -> str:
    """Legt neue Session an, gibt die Session-ID (UUID-String) zurueck."""
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
        days=Config.SESSION_LIFETIME_DAYS
    )
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO user_sessions (user_id, user_agent, ip, expires_at)
            VALUES (%s, %s, %s, %s) RETURNING id
        """, (user_id, user_agent, ip, expires_at))
        sid = cur.fetchone()["id"]
    conn.commit()
    return str(sid)


def lookup(conn, sid: str) -> Optional[dict]:
    """Liefert dict mit user_id, expires_at oder None wenn nicht da/abgelaufen."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, user_id, expires_at, last_seen_at
            FROM user_sessions
            WHERE id = %s::uuid AND expires_at > now()
        """, (sid,))
        return cur.fetchone()


def touch(conn, sid: str) -> None:
    """Setzt last_seen_at = now()."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE user_sessions SET last_seen_at = now()
            WHERE id = %s::uuid
        """, (sid,))
    conn.commit()


def revoke(conn, sid: str) -> None:
    """Loescht die Session."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM user_sessions WHERE id = %s::uuid", (sid,))
    conn.commit()


def revoke_all_for_user(conn, user_id: int) -> int:
    """Loescht alle Sessions des Users. Returns Count."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM user_sessions WHERE user_id = %s", (user_id,)
        )
        return cur.rowcount
