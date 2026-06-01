from unittest.mock import patch
import pytest

from app import create_app
from webcore.auth import bp_auth
from webcore.middleware import register_middleware
from webcore import sessions


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    register_middleware(app)
    app.register_blueprint(bp_auth)
    return app


def test_login_redirects_to_twitch(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    resp = app.test_client().get("/app/login")
    assert resp.status_code == 302
    assert "id.twitch.tv/oauth2/authorize" in resp.headers["Location"]
    assert "client_id=test-client-id" in resp.headers["Location"]
    assert "state=" in resp.headers["Location"]


def test_callback_creates_new_user_pending(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    state_resp = client.get("/app/login")
    state = state_resp.headers["Location"].split("state=")[1].split("&")[0]
    with patch("webcore.auth.exchange_code", return_value="acc_xyz"), \
         patch("webcore.auth.get_user_info", return_value={
             "id": "555", "login": "neu", "display_name": "Neu",
             "avatar_url": "http://a", "email": "neu@x",
         }):
        resp = client.get(f"/app/oauth/callback?code=c1&state={state}")
    assert resp.status_code == 302
    assert "/app/pending" in resp.headers["Location"]
    with conn.cursor() as cur:
        cur.execute("SELECT is_approved FROM users WHERE twitch_user_id = '555'")
        assert cur.fetchone()["is_approved"] is False


def test_callback_admin_claim(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    # Fixture hat: users(id=1) ist NICHT-Admin (kommt von _seed_user_tenant
    # die einen TestUser mit is_admin=True und twitch_user_id='999999' anlegt).
    # Wir muessen explizit einen Admin OHNE twitch_user_id anlegen fuer den Claim-Test:
    with conn.cursor() as cur:
        cur.execute("UPDATE users SET twitch_user_id = NULL WHERE is_admin = TRUE")
    conn.commit()

    app = _make_app(conn)
    client = app.test_client()
    state_resp = client.get("/app/login")
    state = state_resp.headers["Location"].split("state=")[1].split("&")[0]
    with patch("webcore.auth.exchange_code", return_value="acc_xyz"), \
         patch("webcore.auth.get_user_info", return_value={
             "id": "12345", "login": "admin", "display_name": "Admin",
             "avatar_url": "http://a", "email": "a@x",
         }):
        resp = client.get(f"/app/oauth/callback?code=c1&state={state}")
    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/app/") or resp.headers["Location"] == "/app/"
    cookies = resp.headers.getlist("Set-Cookie")
    assert any("obskit_sid=" in c for c in cookies)


def test_callback_state_mismatch_400(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    client.get("/app/login")  # legt state an
    resp = client.get("/app/oauth/callback?code=c1&state=WRONG")
    assert resp.status_code == 400


def test_logout_clears_session_and_cookie(pg_conn_test_setup):
    conn, _, _, sid = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", sid)
    resp = client.get("/app/logout")
    assert resp.status_code == 302
    assert sessions.lookup(conn, sid) is None
