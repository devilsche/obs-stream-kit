import datetime
from pubg.db import connect, init_schema, upsert_player, get_player_by_name


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    return conn


def test_upsert_player_inserts_new(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, account_id="account.A", name="PEX_LuCKoR",
                  platform="steam", is_self=True)
    p = get_player_by_name(conn, "PEX_LuCKoR")
    assert p["account_id"] == "account.A"
    assert p["is_self"] == 1


def test_upsert_player_updates_name_on_conflict(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "OldName", "steam", False)
    upsert_player(conn, "account.A", "NewName", "steam", False)
    p = get_player_by_name(conn, "NewName")
    assert p["account_id"] == "account.A"
    assert get_player_by_name(conn, "OldName") is None


def test_insert_match_and_get(tmp_db_path):
    from pubg.db import insert_match, get_match
    conn = _setup(tmp_db_path)
    insert_match(conn, match_id="m1", map_name="Erangel_Main",
                 game_mode="squad-fpp", is_ranked=False, duration_secs=1820,
                 played_at="2026-05-04T18:00:00Z",
                 telemetry_url="https://example/tel.json")
    m = get_match(conn, "m1")
    assert m["map_name"] == "Erangel_Main"
    assert m["telemetry_fetched"] == 0


def test_insert_participants_only_for_squad(tmp_db_path):
    from pubg.db import insert_match, insert_participants, get_squad_for_match
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    upsert_player(conn, "account.C", "MateB", "steam", False)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "m1", [
        {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 5,
         "place": 3, "kills": 4, "headshot_kills": 1, "assists": 2,
         "dbnos": 3, "revives": 1, "damage_dealt": 412.0, "longest_kill": 187.5,
         "time_survived": 1690, "walk_distance": 2300.0, "ride_distance": 1100.0,
         "swim_distance": 0.0, "weapons_acquired": 8, "heals": 3, "boosts": 4,
         "team_kills": 0},
        {"account_id": "account.B", "name": "MateA", "team_id": 5,
         "place": 3, "kills": 2, "headshot_kills": 0, "assists": 4,
         "dbnos": 1, "revives": 2, "damage_dealt": 287.0, "longest_kill": 92.0,
         "time_survived": 1690, "walk_distance": 2200.0, "ride_distance": 1100.0,
         "swim_distance": 0.0, "weapons_acquired": 6, "heals": 2, "boosts": 3,
         "team_kills": 0},
    ])
    squad = get_squad_for_match(conn, "m1")
    assert len(squad) == 2
    assert {p["name"] for p in squad} == {"PEX_LuCKoR", "MateA"}


def test_get_known_match_ids_returns_set(tmp_db_path):
    from pubg.db import insert_match, get_known_match_ids
    conn = _setup(tmp_db_path)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_match(conn, "m2", "Miramar_Main", "duo-fpp", False, 1500,
                 "2026-05-04T19:00:00Z", None)
    assert get_known_match_ids(conn) == {"m1", "m2"}


def test_settings_get_set(tmp_db_path):
    from pubg.db import set_setting, get_setting
    conn = _setup(tmp_db_path)
    assert get_setting(conn, "key1") is None
    set_setting(conn, "key1", "value1")
    assert get_setting(conn, "key1") == "value1"
    set_setting(conn, "key1", "value2")
    assert get_setting(conn, "key1") == "value2"


def test_lifetime_upsert(tmp_db_path):
    from pubg.db import upsert_lifetime, get_lifetime
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_lifetime(conn, "account.A", "squad-fpp", {
        "rounds_played": 16509, "wins": 885, "top10s": 6487,
        "win_rate": 5.361, "top10_rate": 39.294, "kills": 23974,
        "kd_ratio": 1.534, "headshot_kills": 5762, "headshot_rate": 24.034,
        "avg_damage": 287.0, "longest_kill": 612.0, "time_survived_sec": 320000,
    })
    lt = get_lifetime(conn, "account.A", "squad-fpp")
    assert lt["wins"] == 885


def test_insert_telemetry_events(tmp_db_path):
    from pubg.db import insert_match, insert_telemetry_events, get_telemetry_for_match
    conn = _setup(tmp_db_path)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_telemetry_events(conn, "m1", [
        {"event_type": "Kill", "timestamp_ms": 12000,
         "actor_account": "account.A", "target_account": "account.X",
         "weapon": "Beryl", "distance": 87.0, "damage": 100.0,
         "payload_json": "{}"},
        {"event_type": "Landing", "timestamp_ms": 1000,
         "actor_account": "account.A", "target_account": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": "{}"},
    ])
    rows = get_telemetry_for_match(conn, "m1")
    assert len(rows) == 2


def test_telemetry_backlog_helper(tmp_db_path):
    from pubg.db import (insert_match, get_matches_needing_telemetry,
                         mark_telemetry_fetched, mark_telemetry_schema)
    conn = _setup(tmp_db_path)
    # played_at heute, damit Match in der Re-Fetch-Window-Cutoff (-13d) liegt
    import datetime as dt
    today_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 today_iso, "https://example/tel.json")
    insert_match(conn, "m2", "Miramar_Main", "duo-fpp", False, 1500,
                 today_iso, None)
    pending = get_matches_needing_telemetry(conn)
    assert len(pending) == 1
    assert pending[0]["match_id"] == "m1"
    mark_telemetry_fetched(conn, "m1")
    # Solange Schema-Marker fehlt → match wird als re-fetch-bedürftig
    # gemeldet (alte Schema-Version vor 2 = keine Position-Daten)
    assert len(get_matches_needing_telemetry(conn)) == 1
    mark_telemetry_schema(conn, "m1")
    # Mit aktuellem Schema-Marker → nicht mehr pending
    assert get_matches_needing_telemetry(conn) == []
