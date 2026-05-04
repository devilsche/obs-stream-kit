import json
import os
from pubg.telemetry import filter_squad_events, detect_first_fight

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def test_filter_squad_events_keeps_only_squad_involvement():
    events = _load("telemetry_sample.json")
    squad = {"account.A", "account.B"}
    out = list(filter_squad_events(events, squad))
    types = [e["event_type"] for e in out]
    assert "Landing" in types
    assert "Kill" in types
    assert "TakeDamage" in types


def test_detect_first_fight_survived_when_player_kills_attacker():
    events = _load("telemetry_sample.json")
    result = detect_first_fight(events, "account.A", landing_window_secs=120)
    assert result["engaged"] is True
    assert result["survived"] is True


def test_detect_first_fight_no_engagement_returns_none():
    events = [
        {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
         "character": {"accountId": "account.A"}},
    ]
    result = detect_first_fight(events, "account.A")
    assert result["engaged"] is False


def test_process_telemetry_backlog_persists_squad_events(tmp_db_path):
    from unittest.mock import MagicMock
    from pubg.db import (connect, init_schema, upsert_player, insert_match,
                         get_telemetry_for_match,
                         get_matches_needing_telemetry)
    from pubg.poller import process_telemetry_backlog
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.abc123", "PEX_LuCKoR", "steam", True)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", "https://example/tel.json")

    client = MagicMock()
    client.get_telemetry.return_value = [
        {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
         "character": {"accountId": "account.abc123"}},
        {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
         "character": {"accountId": "account.UNKNOWN"}},
        {"_T": "LogPlayerKillV2", "_D": "2026-05-04T18:02:00.000Z",
         "killer": {"accountId": "account.abc123"},
         "victim": {"accountId": "account.X"},
         "killerDamageInfo": {"damageCauserName": "WeapBeryl_C", "distance": 50.0}},
    ]

    process_telemetry_backlog(conn, client, "account.abc123", max_per_tick=5)

    rows = get_telemetry_for_match(conn, "m1")
    assert len(rows) == 2
    assert get_matches_needing_telemetry(conn) == []
