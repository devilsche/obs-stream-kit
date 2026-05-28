import os
import base64
import pytest
from core import crypto, credentials, db


@pytest.fixture
def pg_conn(monkeypatch):
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    conn = db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("TRUNCATE tenant_credentials, tenants, users RESTART IDENTITY CASCADE")
        cur.execute("INSERT INTO users (display_name, is_admin) VALUES ('T', TRUE) RETURNING id")
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id, slug, display_name) "
            "VALUES (%s, 'test', 'Test') RETURNING id",
            (uid,)
        )
        tid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenant_credentials (tenant_id) VALUES (%s)", (tid,)
        )
    conn.commit()
    yield conn, tid
    conn.close()


def test_set_and_get_pubg_key(pg_conn, monkeypatch):
    conn, tid = pg_conn
    key = crypto.generate_key()
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(key).decode())
    credentials.set_pubg(conn, tid, name="LuCKoR", platform="steam", api_key="dev-key-abc")
    bundle = credentials.get(conn, tid)
    assert bundle.pubg_name == "LuCKoR"
    assert bundle.pubg_platform == "steam"
    assert bundle.pubg_api_key == "dev-key-abc"


def test_get_returns_none_for_unset_fields(pg_conn, monkeypatch):
    conn, tid = pg_conn
    key = crypto.generate_key()
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(key).decode())
    bundle = credentials.get(conn, tid)
    assert bundle.pubg_api_key is None
    assert bundle.steam_api_key is None


def test_get_missing_tenant_raises(pg_conn, monkeypatch):
    conn, _ = pg_conn
    key = crypto.generate_key()
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(key).decode())
    with pytest.raises(LookupError):
        credentials.get(conn, 99999)
