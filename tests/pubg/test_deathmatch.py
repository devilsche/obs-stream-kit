"""Tests fuer compute_deathmatch_stats (TDM-Bestenliste).

Kills/Deaths kommen aus der Telemetrie (Kill-Events), Damage aus den
participant-Stats. BR-Matches duerfen NICHT einfliessen (nur game_mode 'tdm').
"""
from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, insert_telemetry_events)
from pubg.aggregations import compute_deathmatch_stats

SELF = "account.A"
MATE = "account.B"


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, SELF, "Das_Flip-Flop", "steam", True)
    upsert_player(conn, MATE, "Mate", "steam", False)
    return conn


def _parts(match_id, conn):
    insert_participants(conn, match_id, [
        {"account_id": SELF, "name": "Das_Flip-Flop", "team_id": 1, "place": 1,
         "kills": 2, "headshot_kills": 1, "assists": 0, "damage_dealt": 300.0},
        {"account_id": MATE, "name": "Mate", "team_id": 1, "place": 1,
         "kills": 1, "headshot_kills": 0, "assists": 1, "damage_dealt": 150.0},
    ])


def _kill(actor, target):
    return {"event_type": "Kill", "timestamp_ms": 0,
            "actor_account": actor, "target_account": target}


def test_deathmatch_leaderboard_from_telemetry(tmp_db_path):
    conn = _setup(tmp_db_path)
    insert_match(conn, "tdm1", "Italy_TDM_Main", "tdm", 0, 480,
                 "2026-06-14T18:00:00Z", None)
    _parts("tdm1", conn)
    # Telemetrie: SELF killt MATE 2x, MATE killt SELF 1x (+ ein Gegner-Kill,
    # der ignoriert werden muss, weil nicht im Roster).
    insert_telemetry_events(conn, "tdm1", [
        _kill(SELF, MATE), _kill(SELF, MATE), _kill(MATE, SELF),
        _kill("account.ENEMY", SELF),  # Gegner -> nicht im Roster -> ignoriert fuer kills
    ])
    out = compute_deathmatch_stats(conn, 1, SELF, "all")

    assert out["matchCount"] == 1
    names = [p["name"] for p in out["players"]]
    assert "account.ENEMY" not in [p["accountId"] for p in out["players"]]
    self_row = next(p for p in out["players"] if p["accountId"] == SELF)
    mate_row = next(p for p in out["players"] if p["accountId"] == MATE)
    assert self_row["kills"] == 2
    assert self_row["deaths"] == 2          # 1x von MATE + 1x von ENEMY
    assert self_row["kd"] == 1.0
    assert self_row["damage"] == 300
    assert self_row["isSelf"] is True
    assert mate_row["kills"] == 1 and mate_row["deaths"] == 2
    # Sortierung nach Kills: SELF (2) vor MATE (1)
    assert names[0] == "Das_Flip-Flop"


def test_br_matches_excluded(tmp_db_path):
    conn = _setup(tmp_db_path)
    insert_match(conn, "br1", "Erangel_Main", "squad-fpp", 0, 1800,
                 "2026-06-14T18:00:00Z", None)
    _parts("br1", conn)
    insert_telemetry_events(conn, "br1", [_kill(SELF, MATE)])
    out = compute_deathmatch_stats(conn, 1, SELF, "all")
    assert out["matchCount"] == 0
    assert out["players"] == []


def test_kd_perfect_when_no_deaths(tmp_db_path):
    conn = _setup(tmp_db_path)
    insert_match(conn, "tdm2", "Kiki_Main", "tdm", 0, 480,
                 "2026-06-14T18:00:00Z", None)
    insert_participants(conn, "tdm2", [
        {"account_id": SELF, "name": "Das_Flip-Flop", "team_id": 1, "place": 1,
         "kills": 5, "headshot_kills": 2, "assists": 0, "damage_dealt": 500.0},
    ])
    insert_telemetry_events(conn, "tdm2", [_kill(SELF, "account.X"),
                                           _kill(SELF, "account.Y")])
    out = compute_deathmatch_stats(conn, 1, SELF, "all")
    self_row = out["players"][0]
    assert self_row["deaths"] == 0
    assert self_row["kd"] == 2.0          # kills==2 als Float, keine Division
