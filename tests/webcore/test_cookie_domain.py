"""Tests: OBSKIT_COOKIE_DOMAIN setzt Domain= im Set-Cookie-Header (oder nicht).

Kein echter DB-Zugriff nötig — die Verbindung wird vollständig gemockt.
"""
import uuid
from contextlib import contextmanager
from unittest import mock

# OAuth/Cookie liegt im API-Service (bp_auth), nicht im Frontend.
from api_app import create_app


# ---------------------------------------------------------------------------
# Minimaler Mock für psycopg2-Connection + Cursor
# ---------------------------------------------------------------------------

class _FakeCursor:
    """Simuliert den Cursor-Kontext-Manager mit vorkonfigurierten Antworten."""

    def __init__(self, rows):
        # rows: Liste von dicts, die nacheinander per fetchone() zurückgegeben werden
        self._rows = list(rows)
        self._idx = 0

    def execute(self, *args, **kwargs):
        pass

    def fetchone(self):
        if self._idx < len(self._rows):
            r = self._rows[self._idx]
            self._idx += 1
            return r
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _make_conn():
    """Erstellt eine Fake-DB-Connection, die den OAuth-Callback-Pfad bedient.

    _lookup_or_create_user benötigt zwei cursor()-Aufrufe:
      1. SELECT users WHERE twitch_user_id = ...  → None (kein existing user)
      2. SELECT users WHERE is_admin=TRUE ... → None (kein admin-claim)
      3. INSERT INTO users ... RETURNING id, is_admin, is_approved
         → {"id": 1, "is_admin": False, "is_approved": False}

    Alle drei fetchone()-Aufrufe kommen aus einem einzigen cursor()-Block
    (with conn.cursor() as cur: drei cur.execute/cur.fetchone-Paare).
    Danach sessions.create: ein weiterer cursor()-Block mit
      INSERT INTO user_sessions ... RETURNING id → {"id": <uuid>}
    """
    fake_sid = str(uuid.uuid4())

    # Antwort-Sequenz pro cursor()-Aufruf
    # _lookup_or_create_user öffnet EINEN with-Block und ruft fetchone() dreimal:
    lookup_cursor = _FakeCursor([
        None,                                              # kein existing user
        None,                                              # kein admin-claim
        {"id": 1, "is_admin": False, "is_approved": False},  # INSERT result
    ])
    # sessions.create öffnet einen zweiten with-Block
    session_cursor = _FakeCursor([{"id": fake_sid}])

    call_count = [0]

    class _FakeConn:
        @contextmanager
        def cursor(self):
            idx = call_count[0]
            call_count[0] += 1
            if idx == 0:
                yield lookup_cursor
            else:
                yield session_cursor

        def commit(self):
            pass

        def close(self):
            pass

    return _FakeConn()


def _login_response(app):
    """Führt den OAuth-Callback durch und gibt die Response zurück."""
    client = app.test_client()
    with mock.patch("webcore.auth.exchange_code", return_value="tok"), \
         mock.patch("webcore.auth.get_user_info",
                    return_value={"id": "123", "display_name": "x",
                                  "profile_image_url": "", "avatar_url": ""}):
        with client.session_transaction() as s:
            s["oauth_state"] = "st"
        return client.get("/app/oauth/callback?state=st&code=c")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_cookie_has_domain_when_configured():
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: _make_conn()
    app.config["OBSKIT_COOKIE_DOMAIN"] = ".stats-overlay.info"

    r = _login_response(app)
    set_cookie = "".join(r.headers.get_all("Set-Cookie"))
    # Werkzeug/RFC 6265 normalisiert ".stats-overlay.info" → "stats-overlay.info"
    # (führender Punkt wird entfernt — Browsers ignorieren ihn ohnehin).
    assert "Domain=stats-overlay.info" in set_cookie


def test_cookie_host_only_by_default():
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: _make_conn()
    app.config["OBSKIT_COOKIE_DOMAIN"] = None

    r = _login_response(app)
    set_cookie = "".join(r.headers.get_all("Set-Cookie"))
    assert "Domain=" not in set_cookie
