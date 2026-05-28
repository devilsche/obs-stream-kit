import os
import sqlite3
import pytest
from core import db as core_db, migrate_sqlite_to_pg as migrate


@pytest.fixture
def fresh_pg(monkeypatch):
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST muss 'test' im DB-Namen enthalten")
    conn = core_db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    # Identity-Schema + pubg + steam laden
    from core import init_schema
    from pubg import db_pg as pubg_pg
    from steam import db_pg as steam_pg
    with conn.cursor() as cur:
        with open(os.path.join(os.path.dirname(init_schema.__file__), "schema.sql")) as f:
            cur.execute(f.read())
        cur.execute(pubg_pg.PG_SCHEMA)
        cur.execute(steam_pg.PG_SCHEMA)
        cur.execute(
            "INSERT INTO users (display_name, is_admin) VALUES ('A',TRUE) RETURNING id"
        )
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'a','Admin') RETURNING id", (uid,))
        tid = cur.fetchone()["id"]
    conn.commit()
    yield conn, tid
    conn.close()


def test_migrate_pubg_players(fresh_pg, tmp_path):
    conn, tid = fresh_pg
    sqlite_path = tmp_path / "pubg.db"
    sq = sqlite3.connect(str(sqlite_path))
    sq.executescript("""
        CREATE TABLE players (
            account_id TEXT PRIMARY KEY, name TEXT, platform TEXT,
            is_self INTEGER, first_seen_at TEXT, last_polled_at TEXT);
        INSERT INTO players VALUES ('account.x','LuCKoR','steam',1,'2026-01-01',NULL);
        INSERT INTO players VALUES ('account.y','Mate','steam',0,'2026-01-02',NULL);
    """)
    sq.commit()
    sq.close()
    migrate.migrate_pubg(str(sqlite_path), conn, tid)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM players WHERE tenant_id = %s", (tid,))
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT name FROM players WHERE account_id='account.x' AND tenant_id=%s", (tid,))
        assert cur.fetchone()["name"] == "LuCKoR"
