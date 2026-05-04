import sqlite3
from pubg.db import connect, init_schema


def test_init_schema_creates_all_tables(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    names = [r[0] for r in cur.fetchall()]
    assert "players" in names
    assert "matches" in names
    assert "participants" in names
    assert "telemetry_events" in names
    assert "player_lifetime" in names
    assert "stamm_crew" in names
    assert "settings" in names


def test_init_schema_creates_qualified_co_players_view(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='view'"
    )
    names = [r[0] for r in cur.fetchall()]
    assert "qualified_co_players" in names


def test_init_schema_idempotent(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    init_schema(conn)  # Second call must not crash
