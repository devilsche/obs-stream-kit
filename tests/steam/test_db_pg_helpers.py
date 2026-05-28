"""Tests fuer steam/db_pg.py Compat-Layer.

Roundtrip-Tests fuer upsert+get-Paare und Multi-Tenant-Isolation.
Skipped wenn OBS_KIT_PG_DSN_TEST nicht gesetzt ist.
"""
import os
import pytest

try:
    from core import db as core_db
    from steam import db_pg
    HAS_PG = True
except ImportError:
    HAS_PG = False


@pytest.fixture
def pg():
    if not HAS_PG:
        pytest.skip("psycopg2 nicht installiert")
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
    import core.init_schema as init
    schema_path = os.path.join(os.path.dirname(init.__file__), "schema.sql")
    with open(schema_path) as f:
        schema_sql = f.read()
    with conn.cursor() as cur:
        cur.execute(schema_sql)
        cur.execute(db_pg.PG_SCHEMA)
        cur.execute(
            "INSERT INTO users (display_name, is_admin) VALUES ('A',TRUE) "
            "RETURNING id"
        )
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'t1','T1') RETURNING id", (uid,))
        t1 = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'t2','T2') RETURNING id", (uid,))
        t2 = cur.fetchone()["id"]
    conn.commit()
    yield conn, t1, t2
    conn.close()


# ── Owned Games ─────────────────────────────────────────────────────────────


def test_owned_games_roundtrip(pg):
    conn, t1, _ = pg
    games = [
        {"appid": 578080, "name": "PUBG",
         "playtime_forever": 1200, "playtime_2weeks": 60,
         "img_icon_url": "abc", "img_logo_url": "def",
         "rtime_last_played": 1700000000},
    ]
    db_pg.upsert_owned_games(conn, t1, "STEAM_1", games)
    row = db_pg.get_owned_game(conn, t1, "STEAM_1", 578080)
    assert row is not None
    assert row["name"] == "PUBG"
    assert row["playtime_forever_min"] == 1200
    assert row["img_icon_url"].endswith("abc.jpg")


def test_owned_games_tenant_isolation(pg):
    conn, t1, t2 = pg
    db_pg.upsert_owned_games(conn, t1, "STEAM_1", [
        {"appid": 1, "name": "T1-Game", "playtime_forever": 10,
         "playtime_2weeks": 0, "img_icon_url": None, "img_logo_url": None}
    ])
    db_pg.upsert_owned_games(conn, t2, "STEAM_1", [
        {"appid": 1, "name": "T2-Game", "playtime_forever": 99,
         "playtime_2weeks": 0, "img_icon_url": None, "img_logo_url": None}
    ])
    r1 = db_pg.get_owned_game(conn, t1, "STEAM_1", 1)
    r2 = db_pg.get_owned_game(conn, t2, "STEAM_1", 1)
    assert r1["name"] == "T1-Game"
    assert r2["name"] == "T2-Game"
    assert r1["playtime_forever_min"] == 10
    assert r2["playtime_forever_min"] == 99


# ── Achievements ────────────────────────────────────────────────────────────


def test_insert_unlock_idempotent(pg):
    conn, t1, _ = pg
    first = db_pg.insert_unlock_if_new(
        conn, t1, "STEAM_1", 100, "ACH_FIRST_KILL", 1700000000,
        display_name="First Kill", description="Frag #1",
        icon_url="http://x/i.png")
    assert first is True
    again = db_pg.insert_unlock_if_new(
        conn, t1, "STEAM_1", 100, "ACH_FIRST_KILL", 1700000000)
    assert again is False
    undisp = db_pg.get_undisplayed_unlocks(conn, t1, "STEAM_1")
    assert len(undisp) == 1
    assert undisp[0]["achievement_api_name"] == "ACH_FIRST_KILL"


def test_unlocks_tenant_isolation(pg):
    conn, t1, t2 = pg
    db_pg.insert_unlock_if_new(conn, t1, "STEAM_X", 5, "A", 100)
    db_pg.insert_unlock_if_new(conn, t2, "STEAM_X", 5, "B", 200)
    u1 = db_pg.get_undisplayed_unlocks(conn, t1, "STEAM_X")
    u2 = db_pg.get_undisplayed_unlocks(conn, t2, "STEAM_X")
    assert [r["achievement_api_name"] for r in u1] == ["A"]
    assert [r["achievement_api_name"] for r in u2] == ["B"]
    # Mark t1's displayed; t2 must remain undisplayed
    db_pg.mark_displayed(conn, t1, "STEAM_X", 5, "A")
    assert db_pg.get_undisplayed_unlocks(conn, t1, "STEAM_X") == []
    u2 = db_pg.get_undisplayed_unlocks(conn, t2, "STEAM_X")
    assert len(u2) == 1


# ── App Schema (GLOBAL) ─────────────────────────────────────────────────────


def test_app_schema_is_global(pg):
    conn, t1, t2 = pg
    db_pg.upsert_app_schema(conn, 578080, "PUBG", 50, '{"foo":"bar"}')
    s = db_pg.get_app_schema(conn, 578080)
    assert s["game_name"] == "PUBG"
    assert s["achievement_count"] == 50
    # Schema-Tabelle ist global → kein tenant_id-Param
    # (Test passt automatisch wenn die Funktionssignatur ohne tenant_id ist.)
    db_pg.upsert_global_achievement_pct(conn, 578080, '{"ACH":42.5}')
    pct_json, ts = db_pg.get_global_achievement_pct(conn, 578080)
    assert "42.5" in pct_json
    assert ts is not None


# ── Progress (per-tenant) ───────────────────────────────────────────────────


def test_progress_tenant_isolation(pg):
    conn, t1, t2 = pg
    db_pg.upsert_progress(conn, t1, "S", 9, 5)
    db_pg.upsert_progress(conn, t2, "S", 9, 17)
    r1 = db_pg.get_progress(conn, t1, "S", 9)
    r2 = db_pg.get_progress(conn, t2, "S", 9)
    assert r1["unlocked_count"] == 5
    assert r2["unlocked_count"] == 17
