from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, insert_telemetry_events,
                     insert_team_mapping)
from pubg.aggregations import compute_match_detail


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_player(conn, "account.B", "Mate1", "steam", False)
    return conn


def _basic_match(conn, mid="m1", played_at="2026-05-15T18:00:00Z"):
    insert_match(conn, mid, "Baltic_Main", "squad-fpp", False, 1800, played_at, None)
    parts = []
    for acc, name in (("account.A", "PEX_LuCKoR"), ("account.B", "Mate1")):
        parts.append({
            "account_id": acc, "name": name, "team_id": 1,
            "place": 5, "kills": 2, "headshot_kills": 0, "assists": 0,
            "dbnos": 0, "revives": 0, "damage_dealt": 200.0,
            "longest_kill": 10.0, "time_survived": 600,
            "walk_distance": 0, "ride_distance": 0, "swim_distance": 0,
            "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0,
        })
    insert_participants(conn, mid, parts)
    insert_team_mapping(conn, mid, [
        {"account_id": "account.A", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
        {"account_id": "account.B", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
    ])
    return mid


def test_path_includes_timestamps(tmp_db_path):
    """compute_match_detail soll path als [[x, y, ts_ms], ...] liefern."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    # Plane-Cruise: 3s nach z>=150000. Position ab dann.
    events = [
        # Plane-Cruise erreicht bei ts=10000ms (z=160000)
        {"event_type": "Position", "timestamp_ms": 10000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # path-Start = 13000ms (10000 + 3000)
        {"event_type": "Position", "timestamp_ms": 15000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 110000.0, "actor_y": 110000.0, "actor_z": 80000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 30000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    # path muss 3-Tupel (x, y, ts_ms) enthalten
    assert len(me["path"]) >= 2
    for pt in me["path"]:
        assert len(pt) == 3, f"Erwarte [x, y, ts], bekommen {pt}"
        assert isinstance(pt[2], int), f"ts muss int sein, ist {type(pt[2])}"
    # Punkte sind chronologisch
    timestamps = [pt[2] for pt in me["path"]]
    assert timestamps == sorted(timestamps)


def test_member_kills_includes_actor_and_victim_coords(tmp_db_path):
    """Pro Member sollen Kill-Events mit Schuetze + Opfer-Position
    in members[i].kills landen."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        # Squad-Member A killt einen Enemy auf gegebenen Koords
        {"event_type": "Kill", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": "account.ENEMY1",
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 251000.0, "victim_y": 260500.0,
         "weapon": "WeapHK416_C", "distance": 1500.0, "damage": 100.0,
         "payload_json": None},
        # Zweiter Kill von A
        {"event_type": "Kill", "timestamp_ms": 600000,
         "actor_account": "account.A", "target_account": "account.ENEMY2",
         "actor_x": 300000.0, "actor_y": 310000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 302000.0, "victim_y": 310500.0,
         "weapon": "WeapBerylM762_C", "distance": 2200.0, "damage": 80.0,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert "kills" in me, "members[].kills field fehlt"
    assert len(me["kills"]) == 2
    k1, k2 = me["kills"]
    assert k1["actorX"] == 250000.0
    assert k1["actorY"] == 260000.0
    assert k1["victimX"] == 251000.0
    assert k1["victimY"] == 260500.0
    assert k1["tsMs"] == 500000
    assert k2["actorX"] == 300000.0
    assert k2["victimX"] == 302000.0
