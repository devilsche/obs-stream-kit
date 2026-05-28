import os
import base64
import pytest
from core import crypto, db as core_db, seed_admin


@pytest.fixture
def fresh_pg(monkeypatch):
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST muss 'test' im DB-Namen enthalten")
    monkeypatch.setenv("OBS_KIT_PG_DSN", dsn)
    monkeypatch.setenv("OBS_KIT_MASTER_KEY",
                       base64.b64encode(crypto.generate_key()).decode())
    conn = core_db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    from core import init_schema
    with conn.cursor() as cur:
        with open(os.path.join(os.path.dirname(init_schema.__file__),
                               "schema.sql")) as f:
            cur.execute(f.read())
    conn.commit()
    yield conn
    conn.close()


def test_seed_creates_admin_tenant(fresh_pg, tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text(
        "Twitch-Channel: LuCKoR_HD\n"
        "Client-ID: tw-id\n"
        "Client-Secret: tw-secret\n"
        "Steam API Key: steam-abc\n"
        "Steam ID: 7656\n"
        "PUBG API Key: pubg-key\n"
        "FTP-Backup-Host: ftp.host\n"
    )
    pubg_cfg = tmp_path / "pubg.json"
    pubg_cfg.write_text('{"nick":"LuCKoR","platform":"steam"}')

    seed_admin.run(secrets_path=str(secrets), pubg_config_path=str(pubg_cfg))

    with fresh_pg.cursor() as cur:
        cur.execute("SELECT id, is_admin FROM users")
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0]["is_admin"] is True
        cur.execute("SELECT id, slug FROM tenants")
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0]["id"] == 1
        cur.execute("SELECT pubg_name, pubg_platform FROM tenant_credentials")
        creds = cur.fetchone()
        assert creds["pubg_name"] == "LuCKoR"
        assert creds["pubg_platform"] == "steam"
        cur.execute("SELECT count(*) AS n FROM widget_tokens")
        assert cur.fetchone()["n"] == 1


def test_seed_idempotent(fresh_pg, tmp_path, capsys):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Twitch-Channel: x\n")
    pubg_cfg = tmp_path / "pubg.json"
    pubg_cfg.write_text('{"nick":"x","platform":"steam"}')
    seed_admin.run(secrets_path=str(secrets), pubg_config_path=str(pubg_cfg))
    seed_admin.run(secrets_path=str(secrets), pubg_config_path=str(pubg_cfg))
    out = capsys.readouterr().out
    assert "schon vorhanden" in out.lower()
    with fresh_pg.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM tenants")
        assert cur.fetchone()["n"] == 1
