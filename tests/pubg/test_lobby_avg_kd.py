"""Lobby-K/D: die Abfrage lief in keinem Range.

`GROUP BY m.match_id` bei gleichzeitigem `SELECT m.played_at` ist unter
SQLite erlaubt (bare column), unter Postgres nicht — der
Primärschlüssel von `matches` ist zusammengesetzt, weshalb die
funktionale Abhängigkeit nicht greift. Der Endpoint antwortete deshalb
in **jedem** Range mit HTTP 500, und zwar seit der Migration.

Ein Test, der nur eine Range prüft, hätte gereicht; es gab keinen.
"""
import pytest

from pubg import db_pg
from pubg.aggregations import compute_lobby_avg_kd

ME = "account.A"


@pytest.fixture
def lobby(pg_compat):
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    db_pg.insert_match(conn.raw, t1, "m1", "Baltic_Main", "squad-fpp",
                       False, 1800, "2026-09-11T12:00:00Z", None)
    db_pg.insert_participants(conn.raw, t1, "m1", [{
        "account_id": ME, "name": "PEX_LuCKoR", "team_id": 1, "place": 3,
        "kills": 4, "headshot_kills": 1, "assists": 0, "dbnos": 2,
        "revives": 0, "damage_dealt": 500.0, "longest_kill": 80.0,
        "time_survived": 1200, "walk_distance": 1500.0,
        "ride_distance": 200.0, "swim_distance": 0.0,
        "weapons_acquired": 5, "heals": 2, "boosts": 1, "team_kills": 0}])
    # Lobby-Mapping mit mehr als vier Spielern — darunter greift das
    # HAVING und die Zeile fällt weg.
    db_pg.insert_team_mapping(conn.raw, t1, "m1", [
        {"account_id": ME, "team_id": 1, "kills": 4, "place": 3},
        {"account_id": "b", "team_id": 1, "kills": 2, "place": 3},
        {"account_id": "c", "team_id": 2, "kills": 6, "place": 1},
        {"account_id": "d", "team_id": 2, "kills": 1, "place": 1},
        {"account_id": "e", "team_id": 3, "kills": 0, "place": 8},
        {"account_id": "f", "team_id": 3, "kills": 3, "place": 8},
    ])
    conn.raw.commit()
    return conn, t1


@pytest.mark.parametrize("range_key", ["session", "day", "week", "month",
                                       "all"])
def test_jeder_range_laeuft_durch(lobby, range_key):
    # Der eigentliche Regressionstest: vorher warf jeder dieser Aufrufe
    # einen GroupingError.
    conn, t1 = lobby
    d = compute_lobby_avg_kd(conn, t1, ME, range_key)
    assert isinstance(d, dict)
    assert "perMatch" in d


def test_die_kennzahl_wird_gerechnet(lobby):
    conn, t1 = lobby
    d = compute_lobby_avg_kd(conn, t1, ME, "all")
    pm = d["perMatch"]
    assert len(pm) == 1
    # 16 Kills auf 6 Teilnehmer minus 2 Sieger = 4 Tode als Näherung.
    assert pm[0]["lobbyKd"] == pytest.approx(16 / 4, abs=0.01)
    assert pm[0]["matchId"] == "m1"
    assert pm[0]["playedAt"]


def test_kleine_lobby_ohne_echtes_mapping_faellt_weg(pg_compat):
    # Unter fünf Zuordnungen ist das kein Lobby-Mapping, sondern nur
    # das eigene Squad — dafür wäre die Kennzahl bedeutungslos.
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    db_pg.insert_match(conn.raw, t1, "m2", "Baltic_Main", "squad-fpp",
                       False, 1800, "2026-09-11T12:00:00Z", None)
    db_pg.insert_participants(conn.raw, t1, "m2", [{
        "account_id": ME, "name": "PEX_LuCKoR", "team_id": 1, "place": 3,
        "kills": 1, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
        "time_survived": 600, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 1, "heals": 0,
        "boosts": 0, "team_kills": 0}])
    db_pg.insert_team_mapping(conn.raw, t1, "m2", [
        {"account_id": ME, "team_id": 1, "kills": 1, "place": 3},
        {"account_id": "b", "team_id": 1, "kills": 0, "place": 3},
    ])
    conn.raw.commit()
    assert compute_lobby_avg_kd(conn, t1, ME, "all")["perMatch"] == []
