from pubg.replay_builder import normalize_coords


def test_normalize_coords_center_is_half():
    # Map-Mitte (4km von 8km) → 0.5/0.5
    x, y = normalize_coords(400000, 400000, mapKm=8)
    assert abs(x - 0.5) < 1e-6
    assert abs(y - 0.5) < 1e-6


def test_normalize_coords_origin_is_zero():
    x, y = normalize_coords(0, 0, mapKm=8)
    assert x == 0.0 and y == 0.0


def test_normalize_coords_clamps_out_of_range():
    # Über die Kartengrenze hinaus → geclamped auf [0,1]
    x, y = normalize_coords(9_000_000, -5000, mapKm=8)
    assert x == 1.0
    assert y == 0.0


def test_normalize_coords_sanhok_4km():
    x, y = normalize_coords(200000, 200000, mapKm=4)
    assert abs(x - 0.5) < 1e-6


from pubg.replay_builder import team_colors


def test_team_colors_assigns_distinct_per_team():
    colors = team_colors([1, 2, 3])
    assert set(colors.keys()) == {1, 2, 3}
    assert len(set(colors.values())) == 3  # alle verschieden
    for hexc in colors.values():
        assert hexc.startswith("#") and len(hexc) == 7


def test_team_colors_wraps_when_more_teams_than_palette():
    ids = list(range(1, 40))  # mehr als Palette
    colors = team_colors(ids)
    assert len(colors) == 39  # jedes Team kriegt eine Farbe (mit Wrap)
    for hexc in colors.values():
        assert hexc.startswith("#")


def test_team_colors_stable_order():
    # Gleiche Input-Menge → gleiche Zuordnung (sortiert nach team_id)
    a = team_colors([3, 1, 2])
    b = team_colors([1, 2, 3])
    assert a == b


from pubg.replay_builder import extract_events


def _raw_fixture():
    """Minimaler Raw-Blob: 1 Landing, 1 Position, 1 Hit, 1 Knock, 1 Kill."""
    return [
        {"_T": "LogParachuteLanding", "_D": "2026-05-01T10:00:10Z",
         "character": {"accountId": "acc.A", "name": "LuCKoR",
                       "location": {"x": 400000, "y": 400000, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:15Z",
         "character": {"accountId": "acc.A", "name": "LuCKoR",
                       "location": {"x": 410000, "y": 405000, "z": 100}}},
        {"_T": "LogPlayerTakeDamage", "_D": "2026-05-01T10:01:30Z",
         "attacker": {"accountId": "acc.A", "name": "LuCKoR",
                      "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "damageCauserName": "WeapAK47_C"},
        {"_T": "LogPlayerMakeGroggy", "_D": "2026-05-01T10:01:31Z",
         "attacker": {"accountId": "acc.A", "name": "LuCKoR",
                      "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "damageCauserName": "WeapAK47_C", "distance": 5000},
        {"_T": "LogPlayerKillV2", "_D": "2026-05-01T10:01:35Z",
         "killer": {"accountId": "acc.A", "name": "LuCKoR",
                    "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "killerDamageInfo": {"damageCauserName": "WeapAK47_C", "distance": 5000}},
    ]


def test_extract_events_types_and_count():
    events, _ = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    types = [e["type"] for e in events]
    assert "landing" in types
    assert "position" in types
    assert "hit" in types
    assert "knock" in types
    assert "kill" in types


def test_extract_events_sorted_by_ts():
    events, _ = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    ts = [e["ts"] for e in events]
    assert ts == sorted(ts)


def test_extract_events_normalizes_coords():
    events, _ = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    landing = next(e for e in events if e["type"] == "landing")
    assert abs(landing["x"] - 0.5) < 1e-6  # 400000/800000
    assert abs(landing["y"] - 0.5) < 1e-6


def test_extract_events_hit_has_both_endpoints():
    events, _ = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    hit = next(e for e in events if e["type"] == "hit")
    assert "ax" in hit and "ay" in hit and "tx" in hit and "ty" in hit
    assert hit["actorId"] == "acc.A"
    assert hit["targetId"] == "acc.B"


def test_extract_events_kill_has_weapon_distance():
    """Waffe kommt als Name AUS DEM SPIEL, nicht als interne ID —
    WeapAK47_C heisst dort AKM, WeapFNFal_C heisst SLR."""
    events, _ = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    kill = next(e for e in events if e["type"] == "kill")
    assert kill["weapon"] == "AKM"
    assert kill["distance"] == 5000


def test_extract_events_position_interval_thins():
    # Zwei Position-Events 200ms auseinander, interval=1000 → nur erstes bleibt
    raw = [
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:00.000Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 1, "y": 1, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:00.200Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 2, "y": 2, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:01.500Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 3, "y": 3, "z": 100}}},
    ]
    events, _ = extract_events(raw, mapKm=8, position_interval_ms=1000)
    pos = [e for e in events if e["type"] == "position"]
    assert len(pos) == 2  # 0.0s und 1.5s; 0.2s wird verworfen


from pubg.replay_builder import build_replay


def test_build_replay_structure():
    raw = _raw_fixture()
    team_mapping = {"acc.A": 1, "acc.B": 2}
    names = {"acc.A": "LuCKoR", "acc.B": "Enemy"}
    result = build_replay(
        raw, match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping=team_mapping, names=names)
    assert result["matchId"] == "m1"
    assert result["mapName"] == "Baltic_Main"
    assert result["durationMs"] > 0
    # Teams: zwei Teams, jeweils mit Farbe + Spielern
    teams = {t["teamId"]: t for t in result["teams"]}
    assert set(teams.keys()) == {1, 2}
    assert teams[1]["color"].startswith("#")
    assert teams[1]["players"][0]["name"] == "LuCKoR"
    assert len(result["events"]) > 0


def test_build_replay_duration_from_last_event():
    raw = _raw_fixture()
    result = build_replay(
        raw, match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping={"acc.A": 1, "acc.B": 2},
        names={"acc.A": "LuCKoR", "acc.B": "Enemy"})
    # Erstes Event 10:00:10, letztes 10:01:35 → 85000ms
    assert result["durationMs"] == 85000


def test_build_replay_empty_raw_returns_empty_events():
    result = build_replay(
        [], match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping={}, names={})
    assert result["events"] == []
    assert result["durationMs"] == 0


def test_extract_events_zone_from_gamestate():
    raw = [
        {"_T": "LogGameStatePeriodic", "_D": "2026-05-01T10:05:00Z",
         "gameState": {
             "safetyZonePosition": {"x": 400000, "y": 400000, "z": 0},
             "safetyZoneRadius": 200000,
             "poisonGasWarningPosition": {"x": 300000, "y": 300000, "z": 0},
             "poisonGasWarningRadius": 100000,
         }},
    ]
    events, _ = extract_events(raw, mapKm=8, position_interval_ms=1000)
    z = next(e for e in events if e["type"] == "zone")
    assert abs(z["safeX"] - 0.5) < 1e-6
    assert abs(z["safeY"] - 0.5) < 1e-6
    assert abs(z["safeR"] - 0.25) < 1e-6      # 200000/800000
    assert abs(z["nextX"] - 0.375) < 1e-6     # 300000/800000
    assert abs(z["nextR"] - 0.125) < 1e-6     # 100000/800000


def test_extract_events_zone_radius_zero_is_none():
    raw = [
        {"_T": "LogGameStatePeriodic", "_D": "2026-05-01T10:00:00Z",
         "gameState": {
             "safetyZonePosition": {"x": 0, "y": 0, "z": 0},
             "safetyZoneRadius": 0,
             "poisonGasWarningPosition": {"x": 0, "y": 0, "z": 0},
             "poisonGasWarningRadius": 0,
         }},
    ]
    events, _ = extract_events(raw, mapKm=8, position_interval_ms=1000)
    z = next(e for e in events if e["type"] == "zone")
    assert z["safeR"] is None
    assert z["nextR"] is None


# ── DB-Squad-Fallback: flache telemetry_events-Rows → Replay ────────────────

from pubg.replay_builder import db_rows_to_raw_events, build_replay_from_db  # noqa: E402


def _row(**kw):
    base = {"event_type": None, "timestamp_ms": 0, "actor_account": None,
            "target_account": None, "actor_x": None, "actor_y": None,
            "actor_z": None, "actor_health": None, "victim_x": None,
            "victim_y": None, "weapon": None, "distance": None,
            "damage": None, "seat_index": None}
    base.update(kw)
    return base


def test_db_rows_landing_becomes_a_landing_event():
    raw = db_rows_to_raw_events([_row(
        event_type="Landing", timestamp_ms=1_700_000_000_000,
        actor_account="account.A", actor_x=400000, actor_y=400000,
        actor_z=500)])
    assert raw[0]["_T"] == "LogParachuteLanding"
    assert raw[0]["character"]["accountId"] == "account.A"
    assert raw[0]["character"]["location"]["x"] == 400000
    # _D muss ISO sein, sonst kann extract_events den Timestamp nicht lesen
    assert raw[0]["_D"].endswith("Z")


def test_db_rows_kill_carries_weapon_and_both_positions():
    raw = db_rows_to_raw_events([_row(
        event_type="Kill", timestamp_ms=1_700_000_060_000,
        actor_account="account.A", target_account="account.B",
        actor_x=100000, actor_y=100000, victim_x=110000, victim_y=110000,
        weapon="WeapHK416_C", distance=1234.5)])
    e = raw[0]
    assert e["_T"] == "LogPlayerKillV2"
    assert e["killer"]["accountId"] == "account.A"
    assert e["victim"]["accountId"] == "account.B"
    assert e["killerDamageInfo"]["damageCauserName"] == "WeapHK416_C"
    assert e["killerDamageInfo"]["distance"] == 1234.5


def test_db_rows_knock_maps_to_make_groggy():
    raw = db_rows_to_raw_events([_row(
        event_type="Knock", timestamp_ms=1_700_000_030_000,
        actor_account="account.A", target_account="account.B",
        weapon="WeapM16A4_C")])
    assert raw[0]["_T"] == "LogPlayerMakeGroggy"
    assert raw[0]["attacker"]["accountId"] == "account.A"


def test_db_rows_vehicle_rows_keep_id_and_seat():
    raw = db_rows_to_raw_events([
        _row(event_type="VehicleEnter", timestamp_ms=1_700_000_010_000,
             actor_account="account.A", weapon="BP_Motorbike_04_C_1",
             seat_index=0, actor_x=1, actor_y=2),
        _row(event_type="VehicleLeave", timestamp_ms=1_700_000_020_000,
             actor_account="account.A", weapon="BP_Motorbike_04_C_1",
             seat_index=0, actor_x=3, actor_y=4),
    ])
    assert [e["_T"] for e in raw] == ["LogVehicleRide", "LogVehicleLeave"]
    assert raw[0]["vehicle"]["vehicleId"] == "BP_Motorbike_04_C_1"
    assert raw[0]["seatIndex"] == 0


def test_db_rows_skip_types_the_replay_cannot_use():
    """Attack/ItemPickup & Co. tragen nichts zum Replay bei — und Rows ohne
    Timestamp sind nicht einsortierbar."""
    raw = db_rows_to_raw_events([
        _row(event_type="Attack", timestamp_ms=1_700_000_000_000,
             actor_account="account.A"),
        _row(event_type="ItemPickup", timestamp_ms=1_700_000_000_000),
        _row(event_type="Landing", timestamp_ms=None, actor_account="account.A"),
    ])
    assert raw == []


def test_build_replay_from_db_produces_the_same_shape():
    rows = [
        _row(event_type="Position", timestamp_ms=1_700_000_000_000,
             actor_account="account.A", actor_x=400000, actor_y=400000,
             actor_z=200),
        _row(event_type="Landing", timestamp_ms=1_700_000_001_000,
             actor_account="account.A", actor_x=400000, actor_y=400000,
             actor_z=150),
        _row(event_type="Kill", timestamp_ms=1_700_000_060_000,
             actor_account="account.A", target_account="account.B",
             actor_x=400000, actor_y=400000, victim_x=410000, victim_y=410000,
             weapon="WeapHK416_C", distance=100.0),
    ]
    out = build_replay_from_db(rows, "m1", "Baltic_Main", 8.0,
                              {"account.A": 1, "account.B": 2},
                              {"account.A": "Ich", "account.B": "Gegner"})
    assert out["matchId"] == "m1"
    assert {t["teamId"] for t in out["teams"]} == {1, 2}
    types = [e["type"] for e in out["events"]]
    assert "landing" in types and "kill" in types and "death" in types
    # Timestamps normalisiert auf 0 wie bei build_replay
    assert out["events"][0]["ts"] == 0
    assert out["durationMs"] == 60_000


def test_build_replay_from_db_declares_its_gaps():
    """Aus der DB gibt es keine Gegner-Positionen und keine Zonen — der
    Aufrufer muss das im UI sagen koennen."""
    out = build_replay_from_db([], "m2", "Baltic_Main", 8.0, {}, {})
    assert out["coverage"]["positions"] == "squad-only"
    assert out["coverage"]["zones"] is False
