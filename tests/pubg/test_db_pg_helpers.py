"""Tests fuer pubg/db_pg.py Compat-Layer.

Round-trip-Tests fuer upsert+get-Paare und Multi-Tenant-Isolation.
Skipped wenn OBS_KIT_PG_DSN_TEST nicht gesetzt ist.
"""
import os
import pytest

try:
    from core import db as core_db
    from pubg import db_pg
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


# ── Settings ────────────────────────────────────────────────────────────────


def test_setting_roundtrip(pg):
    conn, t1, _ = pg
    assert db_pg.get_setting(conn, t1, "foo") is None
    assert db_pg.get_setting(conn, t1, "foo", "DEF") == "DEF"
    db_pg.set_setting(conn, t1, "foo", "bar")
    assert db_pg.get_setting(conn, t1, "foo") == "bar"
    # Update
    db_pg.set_setting(conn, t1, "foo", "baz")
    assert db_pg.get_setting(conn, t1, "foo") == "baz"


def test_settings_tenant_isolation(pg):
    conn, t1, t2 = pg
    db_pg.set_setting(conn, t1, "shared", "T1-Value")
    db_pg.set_setting(conn, t2, "shared", "T2-Value")
    assert db_pg.get_setting(conn, t1, "shared") == "T1-Value"
    assert db_pg.get_setting(conn, t2, "shared") == "T2-Value"


# ── Players ─────────────────────────────────────────────────────────────────


def test_upsert_and_get_player(pg):
    conn, t1, _ = pg
    db_pg.upsert_player(conn, t1, "acc-1", "Player1", "steam", is_self=0)
    row = db_pg.get_player_by_id(conn, t1, "acc-1")
    assert row is not None
    assert row["name"] == "Player1"
    assert row["platform"] == "steam"
    assert row["is_self"] == 0

    by_name = db_pg.get_player_by_name(conn, t1, "Player1")
    assert by_name is not None
    assert by_name["account_id"] == "acc-1"


def test_upsert_player_preserves_self(pg):
    """is_self via GREATEST: einmal True, bleibt True."""
    conn, t1, _ = pg
    db_pg.upsert_player(conn, t1, "acc-self", "Me", "steam", is_self=1)
    db_pg.upsert_player(conn, t1, "acc-self", "Me", "steam", is_self=0)
    row = db_pg.get_self_player(conn, t1)
    assert row is not None
    assert row["account_id"] == "acc-self"


def test_players_tenant_isolation(pg):
    conn, t1, t2 = pg
    db_pg.upsert_player(conn, t1, "acc-x", "T1Player", "steam")
    db_pg.upsert_player(conn, t2, "acc-x", "T2Player", "steam")
    assert db_pg.get_player_by_id(conn, t1, "acc-x")["name"] == "T1Player"
    assert db_pg.get_player_by_id(conn, t2, "acc-x")["name"] == "T2Player"


# ── Matches ─────────────────────────────────────────────────────────────────


def test_insert_match_and_known_ids(pg):
    conn, t1, t2 = pg
    db_pg.insert_match(conn, t1, "m1", "Erangel", "squad", False, 1800,
                       "2026-05-28T10:00:00Z", "http://tel/1")
    db_pg.insert_match(conn, t2, "m1", "Erangel", "squad", False, 1800,
                       "2026-05-28T10:00:00Z", "http://tel/2")
    # Idempotent
    db_pg.insert_match(conn, t1, "m1", "Erangel", "squad", False, 1800,
                       "2026-05-28T10:00:00Z", "http://tel/1")

    assert db_pg.get_known_match_ids(conn, t1) == {"m1"}
    assert db_pg.get_known_match_ids(conn, t2) == {"m1"}

    m = db_pg.get_match(conn, t1, "m1")
    assert m["map_name"] == "Erangel"


def test_mark_match_schema(pg):
    conn, t1, _ = pg
    db_pg.insert_match(conn, t1, "m2", "Miramar", "squad", False, 1500,
                       "2026-05-28T11:00:00Z")
    db_pg.mark_match_schema(conn, t1, "m2", 4)
    m = db_pg.get_match(conn, t1, "m2")
    assert m["match_schema"] == 4


# ── Participants / Teams ────────────────────────────────────────────────────


def test_insert_participants_and_team_mapping(pg):
    conn, t1, _ = pg
    db_pg.insert_match(conn, t1, "m3", "Erangel", "squad", False, 1800,
                       "2026-05-28T12:00:00Z")
    db_pg.upsert_player(conn, t1, "a1", "P1", "steam")
    db_pg.upsert_player(conn, t1, "a2", "P2", "steam")
    rows = [
        {"account_id": "a1", "name": "P1", "team_id": 7, "place": 1,
         "kills": 5},
        {"account_id": "a2", "name": "P2", "team_id": 7, "place": 1,
         "kills": 3},
    ]
    db_pg.insert_participants(conn, t1, "m3", rows)

    squad = db_pg.get_squad_for_match(conn, t1, "m3")
    assert len(squad) == 2
    assert {r["account_id"] for r in squad} == {"a1", "a2"}

    mapping_rows = [
        {"account_id": "a1", "team_id": 7, "kills": 5, "place": 1,
         "time_survived": 1800},
        {"account_id": "a2", "team_id": 7, "kills": 3, "place": 1,
         "time_survived": 1700},
    ]
    db_pg.insert_team_mapping(conn, t1, "m3", mapping_rows)
    tm = db_pg.get_team_mapping_for_match(conn, t1, "m3")
    assert tm == {"a1": 7, "a2": 7}


# ── Stats ───────────────────────────────────────────────────────────────────


def test_lifetime_roundtrip(pg):
    conn, t1, _ = pg
    db_pg.upsert_player(conn, t1, "acc-L", "L", "steam")
    stats = {"rounds_played": 100, "wins": 5, "kills": 250,
             "kd_ratio": 2.5, "avg_damage": 350.0}
    db_pg.upsert_lifetime(conn, t1, "acc-L", "squad-fpp", stats)
    row = db_pg.get_lifetime(conn, t1, "acc-L", "squad-fpp")
    assert row["rounds_played"] == 100
    assert row["wins"] == 5
    assert row["kd_ratio"] == 2.5
    # Update
    db_pg.upsert_lifetime(conn, t1, "acc-L", "squad-fpp",
                          {"rounds_played": 110, "wins": 6})
    row2 = db_pg.get_lifetime(conn, t1, "acc-L", "squad-fpp")
    assert row2["rounds_played"] == 110
    assert row2["wins"] == 6


def test_season_roundtrip_and_listing(pg):
    conn, t1, _ = pg
    db_pg.upsert_player(conn, t1, "acc-S", "S", "steam")
    db_pg.upsert_season(conn, t1, "acc-S", "div.bro.s35", "squad-fpp",
                        {"rounds_played": 50, "wins": 2})
    db_pg.upsert_season(conn, t1, "acc-S", "div.bro.s34", "squad-fpp",
                        {"rounds_played": 40, "wins": 1})

    s = db_pg.get_season(conn, t1, "acc-S", "div.bro.s35", "squad-fpp")
    assert s["rounds_played"] == 50

    seasons = db_pg.get_seasons_for_player(conn, t1, "acc-S")
    season_ids = {r["season_id"] for r in seasons}
    assert season_ids == {"div.bro.s35", "div.bro.s34"}


# ── Telemetry ───────────────────────────────────────────────────────────────


def test_telemetry_roundtrip_and_marks(pg):
    conn, t1, _ = pg
    db_pg.insert_match(conn, t1, "m-tel", "Erangel", "squad", False, 1800,
                       "2026-05-28T13:00:00Z", "http://tel/x")
    events = [
        {"event_type": "Kill", "timestamp_ms": 1000,
         "actor_account": "a1", "target_account": "a2",
         "weapon": "M416", "distance": 123.4, "damage": 100.0,
         "payload_json": "{}"},
        {"event_type": "Landing", "timestamp_ms": 0,
         "actor_account": "a1", "actor_x": 1.0, "actor_y": 2.0,
         "actor_z": 3.0, "payload_json": "{}"},
    ]
    db_pg.insert_telemetry_events(conn, t1, "m-tel", events)
    rows = db_pg.get_telemetry_for_match(conn, t1, "m-tel")
    assert len(rows) == 2
    types = {r["event_type"] for r in rows}
    assert types == {"Kill", "Landing"}

    db_pg.mark_telemetry_fetched(conn, t1, "m-tel")
    db_pg.mark_telemetry_schema(conn, t1, "m-tel")
    m = db_pg.get_match(conn, t1, "m-tel")
    assert m["telemetry_fetched"] == 1
    assert m["telemetry_schema"] == db_pg.CURRENT_TELEMETRY_SCHEMA


# ── Integrity / init ────────────────────────────────────────────────────────


def test_integrity_check(pg):
    conn, _, _ = pg
    assert db_pg.integrity_check(conn) == "ok"
