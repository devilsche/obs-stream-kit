"""Poller-Grundfunktionen gegen Postgres (der produktive Pfad).

Frueher gegen pubg/db.py (SQLite) und die Ein-Streamer-Signaturen —
beides ueberholt: der Poller ist tenant-aware und baut seine Clients
ueber eine client_factory.
"""
import json
import os
import time
from unittest.mock import MagicMock

from pubg import db_pg
from pubg.poller import (run_single_tick, refresh_lifetimes, PollerThread,
                          run_single_tick_multi)

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def _setup(pg_compat):
    conn, tenant_id, _ = pg_compat
    db_pg.upsert_player(conn.raw, tenant_id, "account.abc123", "PEX_LuCKoR",
                        "steam", 1)
    return conn, tenant_id


def _match_client():
    client = MagicMock()
    client.platform = "steam"
    client.get_player.return_value = _load("player_response.json")
    client.extract_match_ids = lambda p: ["match-1", "match-2"]

    def get_match_fn(mid):
        if mid == "match-1":
            return _load("match_response.json")
        return {
            "data": {"id": "match-2", "attributes": {
                "mapName": "Miramar_Main", "gameMode": "duo-fpp",
                "duration": 1500, "createdAt": "2026-05-04T19:00:00Z"
            }, "relationships": {"rosters": {"data": []},
                                 "assets": {"data": []}}},
            "included": []
        }
    client.get_match.side_effect = get_match_fn
    return client


def test_run_single_tick_imports_new_match(pg_compat):
    conn, tid = _setup(pg_compat)
    client = _match_client()

    run_single_tick(conn, tid, client, my_player_name="PEX_LuCKoR",
                    my_account_id="account.abc123",
                    max_matches_per_tick=5)

    known = db_pg.get_known_match_ids(conn.raw, tid)
    assert known == {"match-1", "match-2"}
    m = db_pg.get_match(conn.raw, tid, "match-1")
    assert m["map_name"] == "Erangel_Main"


def test_run_single_tick_skips_already_known(pg_compat):
    conn, tid = _setup(pg_compat)
    db_pg.insert_match(conn.raw, tid, "match-1", "Erangel_Main", "squad-fpp",
                       False, 1820, "2026-05-04T18:00:00Z", None)
    client = _match_client()
    client.extract_match_ids = lambda p: ["match-1"]
    run_single_tick(conn, tid, client, "PEX_LuCKoR", "account.abc123", 5)
    client.get_match.assert_not_called()


def test_refresh_lifetimes_for_qualified_co_players(pg_compat):
    conn, tid = _setup(pg_compat)
    db_pg.upsert_player(conn.raw, tid, "account.B", "MateA", "steam", 0)
    for i in range(5):
        mid = f"m{i}"
        db_pg.insert_match(conn.raw, tid, mid, "Erangel_Main", "squad-fpp",
                           False, 1800, f"2026-05-04T1{i}:00:00Z", None)
        db_pg.insert_participants(conn.raw, tid, mid, [
            {"account_id": "account.abc123", "name": "PEX_LuCKoR",
             "team_id": 1, "place": 5, "kills": 3, "headshot_kills": 0,
             "assists": 1, "dbnos": 1, "revives": 0, "damage_dealt": 200.0,
             "longest_kill": 50.0, "time_survived": 1500,
             "walk_distance": 100.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 5, "heals": 1,
             "boosts": 1, "team_kills": 0},
            {"account_id": "account.B", "name": "MateA", "team_id": 1,
             "place": 5, "kills": 2, "headshot_kills": 0, "assists": 1,
             "dbnos": 0, "revives": 0, "damage_dealt": 150.0,
             "longest_kill": 30.0, "time_survived": 1500,
             "walk_distance": 100.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 4, "heals": 0,
             "boosts": 1, "team_kills": 0},
        ])
    client = MagicMock()
    client.get_lifetime.return_value = _load("lifetime_response.json")
    stats = refresh_lifetimes(conn, tid, client, min_matches=5, max_per_tick=3)
    # Self + 1 qualified co-player = 2 refreshes
    assert stats["refreshed"] == 2
    assert db_pg.get_lifetime(conn.raw, tid, "account.B", "all") is not None
    assert db_pg.get_lifetime(conn.raw, tid, "account.abc123",
                              "all") is not None


def test_poller_thread_starts_and_stops():
    """PollerThread iteriert inzwischen selbst ueber alle Tenants und baut
    seine Clients per Factory — kein db_path/my_player_name mehr."""
    client = MagicMock()
    client.platform = "steam"
    client.get_player.return_value = {"data": [{"id": "account.A",
        "attributes": {"name": "PEX_LuCKoR"},
        "relationships": {"matches": {"data": []}}}]}
    client.extract_match_ids = lambda p: []

    t = PollerThread(client_factory=lambda *a, **k: client,
                     interval_secs=0.1, lifetime_min_matches=5,
                     lifetime_max_per_tick=3, match_max_per_tick=5)
    t.start()
    time.sleep(0.3)
    status = t.status()
    assert status["polling"] in ("ok", "degraded", "running", "starting",
                                 "error")
    t.stop()
    t.join(timeout=2)
    assert not t.is_alive()
