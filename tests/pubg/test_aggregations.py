from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, set_setting, upsert_lifetime,
                     insert_telemetry_events)
from pubg.aggregations import (compute_session_stats, compute_last_match,
                                compute_top_mates, compute_co_player,
                                compute_mates, compute_map_distribution,
                                compute_first_fight_rate, compute_squad_compare)


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    return conn


def _add_match(conn, mid, played_at, kills, dmg, place, mate_count=1, mode="squad-fpp"):
    insert_match(conn, mid, "Erangel_Main", mode, False, 1800, played_at, None)
    parts = [{"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
              "place": place, "kills": kills, "headshot_kills": 1, "assists": 0,
              "dbnos": 0, "revives": 0, "damage_dealt": dmg, "longest_kill": 50.0,
              "time_survived": 1500, "walk_distance": 100.0, "ride_distance": 0.0,
              "swim_distance": 0.0, "weapons_acquired": 5, "heals": 0, "boosts": 0,
              "team_kills": 0}]
    for i in range(mate_count):
        upsert_player(conn, f"account.M{i}", f"Mate{i}", "steam", False)
        parts.append({
            "account_id": f"account.M{i}", "name": f"Mate{i}", "team_id": 1,
            "place": place, "kills": 1, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0})
    insert_participants(conn, mid, parts)


def test_session_stats_aggregates_after_session_start(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T18:00:00Z")
    _add_match(conn, "m1", "2026-05-04T17:00:00Z", 5, 500.0, 3)
    _add_match(conn, "m2", "2026-05-04T18:30:00Z", 4, 400.0, 1)
    _add_match(conn, "m3", "2026-05-04T19:00:00Z", 6, 600.0, 5)
    s = compute_session_stats(conn, "account.A")
    assert s["matches"] == 2
    assert s["kills"] == 10
    assert s["damage"] == 1000.0
    assert s["wins"] == 1
    assert s["bestPlace"] == 1
    assert s["kpm"] == 5.0  # 10 kills / 2 matches


def test_session_stats_includes_extended_fields(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    insert_match(conn, "ext1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "ext1", [{
        "account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
        "place": 3, "kills": 4, "headshot_kills": 1, "assists": 2,
        "dbnos": 3, "revives": 2, "damage_dealt": 412.0, "longest_kill": 187.5,
        "time_survived": 1690, "walk_distance": 2300.0, "ride_distance": 1500.0,
        "swim_distance": 50.0, "weapons_acquired": 8, "heals": 5, "boosts": 7,
        "team_kills": 0,
    }])
    s = compute_session_stats(conn, "account.A")
    assert s["totalBoosts"] == 7
    assert s["totalHeals"] == 5
    assert s["totalRevives"] == 2
    assert s["totalWeaponsAcquired"] == 8
    assert abs(s["walkKm"] - 2.3) < 0.001
    assert abs(s["rideKm"] - 1.5) < 0.001
    assert abs(s["swimKm"] - 0.05) < 0.001


def test_last_match_returns_squad_with_self_first(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T18:00:00Z")
    _add_match(conn, "m1", "2026-05-04T18:00:00Z", 4, 412.0, 3, mate_count=2)
    lm = compute_last_match(conn, "account.A")
    assert lm["matchId"] == "m1"
    assert lm["map"] == "Erangel_Main"
    assert lm["myStats"]["kills"] == 4
    assert len(lm["mates"]) == 2


def test_top_mates_filters_by_min_matches(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    for i in range(12):
        insert_match(conn, f"a{i}", "Erangel_Main", "squad-fpp", False, 1800,
                     f"2026-05-04T{i:02d}:00:00Z", None)
        insert_participants(conn, f"a{i}", [
            {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
             "place": 5, "kills": 4, "headshot_kills": 1, "assists": 0,
             "dbnos": 0, "revives": 0, "damage_dealt": 400.0, "longest_kill": 0.0,
             "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
             "team_kills": 0},
            {"account_id": "account.MA", "name": "MateA", "team_id": 1,
             "place": 5, "kills": 2, "headshot_kills": 0, "assists": 1,
             "dbnos": 0, "revives": 0, "damage_dealt": 200.0, "longest_kill": 0.0,
             "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
             "team_kills": 0},
        ])
    result = compute_top_mates(conn, "account.A",
                                sort_by="mostPlayed", limit=5, min_matches=10)
    assert len(result) == 1
    assert result[0]["name"] == "MateA"
    assert result[0]["sharedMatches"] == 12


def test_co_player_combines_shared_and_career(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    _add_match(conn, "m1", "2026-05-04T18:00:00Z", 4, 400.0, 3, mate_count=0)
    insert_participants(conn, "m1", [{
        "account_id": "account.B", "name": "MateA", "team_id": 1,
        "place": 3, "kills": 2, "headshot_kills": 0, "assists": 1,
        "dbnos": 0, "revives": 1, "damage_dealt": 200.0, "longest_kill": 50.0,
        "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
        "team_kills": 0}])
    upsert_lifetime(conn, "account.B", "all", {"rounds_played": 8000,
        "wins": 412, "top10s": 3000, "win_rate": 5.0, "top10_rate": 37.0,
        "kills": 12000, "kd_ratio": 1.5, "headshot_kills": 2000,
        "headshot_rate": 16.0, "avg_damage": 250.0, "longest_kill": 500.0,
        "time_survived_sec": 80000})
    cp = compute_co_player(conn, "account.A", "MateA")
    assert cp["sharedHistory"]["matches"] == 1
    assert cp["careerLifetime"]["wins"] == 412


def test_mates_today_aggregates_per_mate(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(3):
        _add_match(conn, f"t{i}", f"2026-05-04T1{i}:00:00Z", 4, 400.0, 3, mate_count=0)
        insert_participants(conn, f"t{i}", [{
            "account_id": "account.MA", "name": "MateA", "team_id": 1,
            "place": 3, "kills": 2, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 1, "damage_dealt": 200.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0,
        }])
    result = compute_mates(conn, "account.A", range_key="session")
    assert len(result) == 1
    assert result[0]["name"] == "MateA"
    assert result[0]["sharedMatchesToday"] == 3


def test_map_distribution_counts_by_range(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(3):
        _add_match(conn, f"e{i}", f"2026-05-04T1{i}:00:00Z", 2, 200.0, 5)
    insert_match(conn, "mir1", "Miramar_Main", "squad-fpp", False, 1800,
                 "2026-05-04T15:00:00Z", None)
    insert_participants(conn, "mir1", [{
        "account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
        "place": 1, "kills": 5, "headshot_kills": 1, "assists": 0,
        "dbnos": 0, "revives": 0, "damage_dealt": 500.0, "longest_kill": 50.0,
        "time_survived": 1800, "walk_distance": 100.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 5, "heals": 0, "boosts": 0,
        "team_kills": 0,
    }])
    out = compute_map_distribution(conn, "account.A", range_key="session")
    erangel = next(x for x in out if x["map"] == "Erangel_Main")
    assert erangel["count"] == 3
    miramar = next(x for x in out if x["map"] == "Miramar_Main")
    assert miramar["count"] == 1
    assert miramar["wins"] == 1


def test_first_fight_rate_aggregates(tmp_db_path):
    """First-Fight-Win-Rate: Squad gewinnt wenn am Fight-Ende mind. 1 Member
    noch lebt (kein Squad-Member als Kill-Victim im Fight-Cluster)."""
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    # Solo-Squad: nur account.A, mate_count=0 → squad_ids = {A}
    for i in range(4):
        _add_match(conn, f"f{i}", f"2026-05-04T1{i}:00:00Z", 2, 200.0, 5,
                    mate_count=0)
    # m0: A killt Enemy → Squad lebt → WIN
    insert_telemetry_events(conn, "f0", [
        {"event_type": "Kill", "timestamp_ms": 2000, "actor_account": "account.A",
         "target_account": "account.X", "actor_x": 1000.0, "actor_y": 1000.0,
         "victim_x": 1100.0, "victim_y": 1000.0, "weapon": "Beryl",
         "distance": 50.0, "damage": None, "payload_json": "{}"},
    ])
    # m1: Enemy killt A → Squad tot → LOSS
    insert_telemetry_events(conn, "f1", [
        {"event_type": "Kill", "timestamp_ms": 2000, "actor_account": "account.X",
         "target_account": "account.A", "actor_x": 1000.0, "actor_y": 1000.0,
         "victim_x": 1100.0, "victim_y": 1000.0, "weapon": "Beryl",
         "distance": 50.0, "damage": None, "payload_json": "{}"},
    ])
    # m2: kein engagement → nicht gezählt
    # m3: A killt Enemy → WIN
    insert_telemetry_events(conn, "f3", [
        {"event_type": "Kill", "timestamp_ms": 1500, "actor_account": "account.A",
         "target_account": "account.X", "actor_x": 500.0, "actor_y": 500.0,
         "victim_x": 600.0, "victim_y": 500.0, "weapon": "Beryl",
         "distance": 50.0, "damage": None, "payload_json": "{}"},
    ])
    res = compute_first_fight_rate(conn, "account.A", range_key="session")
    assert res["total"] == 3
    assert res["survived"] == 2
    assert abs(res["rate"] - (2/3)*100) < 0.1


def test_first_fight_cluster_multi_team(tmp_db_path):
    """Multi-Team-Fight: 3 Teams beteiligt, unser Squad überlebt."""
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    insert_match(conn, "mt1", "Erangel_Main", "squad-fpp", False, 1800,
                  "2026-05-04T18:00:00Z", None)
    upsert_player(conn, "account.M0", "Mate0", "steam", False)
    upsert_player(conn, "account.E1", "Enemy1", "steam", False)
    upsert_player(conn, "account.E2", "Enemy2", "steam", False)
    upsert_player(conn, "account.E3", "Enemy3", "steam", False)
    insert_participants(conn, "mt1", [
        {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
         "place": 1, "kills": 2, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.M0", "name": "Mate0", "team_id": 1,
         "place": 1, "kills": 1, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.E1", "name": "Enemy1", "team_id": 2,
         "place": 5, "kills": 0, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 60, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.E2", "name": "Enemy2", "team_id": 3,
         "place": 8, "kills": 0, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 80, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.E3", "name": "Enemy3", "team_id": 3,
         "place": 8, "kills": 0, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 90, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
    ])
    # Cluster: alle 3 Kills innerhalb von 30s und im Radius 200m
    # (= 20000 cm). Positionen alle nahe 1000/1000.
    insert_telemetry_events(conn, "mt1", [
        # T1: Squad-Member A killt Enemy1 (Team 2) — Fight-Start
        {"event_type": "Kill", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": "account.E1",
         "actor_x": 1000.0, "actor_y": 1000.0,
         "victim_x": 1100.0, "victim_y": 1000.0,
         "weapon": "M4", "distance": 100.0, "damage": None,
         "payload_json": "{}"},
        # T2: Mate0 killt Enemy2 (Team 3) — selber Cluster
        {"event_type": "Kill", "timestamp_ms": 75000,
         "actor_account": "account.M0", "target_account": "account.E2",
         "actor_x": 1050.0, "actor_y": 1050.0,
         "victim_x": 1150.0, "victim_y": 1050.0,
         "weapon": "M4", "distance": 100.0, "damage": None,
         "payload_json": "{}"},
        # T3: Enemy3 (Team 3) killt einen seiner eigenen? Nein — Enemy1's mate.
        # Eigentlich enemy-vs-enemy: Enemy3 schießt auf jemanden im Fight.
        # Hier: Enemy3 killt einen vom Team 2 (gibt's nicht mehr) — vereinfacht
        # als: Enemy3 wird auch noch gekillt von uns. Wir können auch sagen
        # Mate0 killt Enemy3.
        {"event_type": "Kill", "timestamp_ms": 90000,
         "actor_account": "account.M0", "target_account": "account.E3",
         "actor_x": 1080.0, "actor_y": 1080.0,
         "victim_x": 1180.0, "victim_y": 1080.0,
         "weapon": "M4", "distance": 100.0, "damage": None,
         "payload_json": "{}"},
    ])
    res = compute_first_fight_rate(conn, "account.A", range_key="session")
    assert res["total"] == 1
    assert res["survived"] == 1     # Squad lebt → WIN
    assert res["avgTeams"] == 3.0   # Team 1 (wir), Team 2, Team 3
    assert res["maxTeams"] == 3


def test_squad_compare_table(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    upsert_player(conn, "account.MB", "MateB", "steam", False)
    insert_match(conn, "sc1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "sc1", [
        {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1, "place": 3,
         "kills": 5, "headshot_kills": 1, "assists": 0, "dbnos": 0, "revives": 0,
         "damage_dealt": 500.0, "longest_kill": 0.0, "time_survived": 1500,
         "walk_distance": 0.0, "ride_distance": 0.0, "swim_distance": 0.0,
         "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0},
        {"account_id": "account.MA", "name": "MateA", "team_id": 1, "place": 3,
         "kills": 3, "headshot_kills": 0, "assists": 1, "dbnos": 0, "revives": 0,
         "damage_dealt": 300.0, "longest_kill": 0.0, "time_survived": 1500,
         "walk_distance": 0.0, "ride_distance": 0.0, "swim_distance": 0.0,
         "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0},
    ])
    res = compute_squad_compare(conn, "account.A", ["PEX_LuCKoR", "MateA"], 5)
    assert len(res["matchTable"]) == 1
    assert res["matchTable"][0]["cells"]["MateA"]["kills"] == 3
