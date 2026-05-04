import json
import os
import time
from unittest.mock import MagicMock
from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, get_known_match_ids, get_match,
                     get_lifetime)
from pubg.poller import run_single_tick, refresh_lifetimes, PollerThread

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.abc123", "PEX_LuCKoR", "steam", True)
    return conn


def test_run_single_tick_imports_new_match(tmp_db_path):
    conn = _setup(tmp_db_path)
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
            }, "relationships": {"rosters": {"data": []}, "assets": {"data": []}}},
            "included": []
        }
    client.get_match.side_effect = get_match_fn

    run_single_tick(conn, client, my_player_name="PEX_LuCKoR",
                    my_account_id="account.abc123",
                    max_matches_per_tick=5)

    known = get_known_match_ids(conn)
    assert known == {"match-1", "match-2"}
    m = get_match(conn, "match-1")
    assert m["map_name"] == "Erangel_Main"


def test_run_single_tick_skips_already_known(tmp_db_path):
    conn = _setup(tmp_db_path)
    insert_match(conn, "match-1", "Erangel_Main", "squad-fpp", False, 1820,
                 "2026-05-04T18:00:00Z", None)
    client = MagicMock()
    client.platform = "steam"
    client.get_player.return_value = _load("player_response.json")
    client.extract_match_ids = lambda p: ["match-1"]
    run_single_tick(conn, client, "PEX_LuCKoR", "account.abc123", 5)
    client.get_match.assert_not_called()


def test_refresh_lifetimes_for_qualified_co_players(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    for i in range(5):
        mid = f"m{i}"
        insert_match(conn, mid, "Erangel_Main", "squad-fpp", False, 1800,
                     f"2026-05-04T1{i}:00:00Z", None)
        insert_participants(conn, mid, [
            {"account_id": "account.abc123", "name": "PEX_LuCKoR",
             "team_id": 1, "place": 5, "kills": 3, "headshot_kills": 0,
             "assists": 1, "dbnos": 1, "revives": 0, "damage_dealt": 200.0,
             "longest_kill": 50.0, "time_survived": 1500, "walk_distance": 100.0,
             "ride_distance": 0.0, "swim_distance": 0.0, "weapons_acquired": 5,
             "heals": 1, "boosts": 1, "team_kills": 0},
            {"account_id": "account.B", "name": "MateA", "team_id": 1,
             "place": 5, "kills": 2, "headshot_kills": 0, "assists": 1,
             "dbnos": 0, "revives": 0, "damage_dealt": 150.0, "longest_kill": 30.0,
             "time_survived": 1500, "walk_distance": 100.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 4, "heals": 0, "boosts": 1,
             "team_kills": 0},
        ])
    client = MagicMock()
    client.get_lifetime.return_value = _load("lifetime_response.json")
    stats = refresh_lifetimes(conn, client, min_matches=5, max_per_tick=3)
    # Self + 1 qualified co-player = 2 refreshes
    assert stats["refreshed"] == 2
    lt = get_lifetime(conn, "account.B", "all")
    assert lt is not None
    self_lt = get_lifetime(conn, "account.abc123", "all")
    assert self_lt is not None


def test_poller_thread_starts_and_stops(tmp_db_path):
    client = MagicMock()
    client.platform = "steam"
    client.get_player.return_value = {"data": [{"id": "account.A",
        "attributes": {"name": "PEX_LuCKoR"},
        "relationships": {"matches": {"data": []}}}]}
    client.extract_match_ids = lambda p: []

    # Setup conn standalone (PollerThread re-connects internally)
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    conn.close()

    t = PollerThread(db_path=tmp_db_path, client=client,
                     my_player_name="PEX_LuCKoR",
                     my_account_id="account.A",
                     interval_secs=0.1, lifetime_min_matches=5,
                     lifetime_max_per_tick=3, match_max_per_tick=5)
    t.start()
    time.sleep(0.3)
    status = t.status()
    assert status["polling"] in ("ok", "degraded", "running", "starting")
    t.stop()
    t.join(timeout=2)
    assert not t.is_alive()
