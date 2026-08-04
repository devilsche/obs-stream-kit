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


def test_process_telemetry_backlog_persists_squad_events(pg_compat):
    """Telemetrie-Backlog gegen Postgres — pubg/db.py (SQLite) ist deprecated."""
    import datetime
    from unittest.mock import MagicMock
    from pubg import db_pg
    from pubg.poller import process_telemetry_backlog

    # Der Backlog holt nur Matches innerhalb des Retention-Fensters —
    # ein fixes Datum faellt irgendwann heraus.
    played_at = (datetime.datetime.now(datetime.timezone.utc)
                 .strftime("%Y-%m-%dT%H:%M:%SZ"))
    conn, tenant_id, _ = pg_compat
    raw = conn.raw
    db_pg.upsert_player(raw, tenant_id, "account.abc123", "PEX_LuCKoR",
                        "steam", 1)
    db_pg.insert_match(raw, tenant_id, "m1", "Erangel_Main", "squad-fpp",
                       False, 1800, played_at,
                       "https://example/tel.json")

    client = MagicMock()
    client.get_telemetry.return_value = [
        {"_T": "LogParachuteLanding", "_D": played_at,
         "character": {"accountId": "account.abc123"}},
        {"_T": "LogParachuteLanding", "_D": played_at,
         "character": {"accountId": "account.UNKNOWN"}},
        {"_T": "LogPlayerKillV2", "_D": played_at,
         "killer": {"accountId": "account.abc123"},
         "victim": {"accountId": "account.X"},
         "killerDamageInfo": {"damageCauserName": "WeapBeryl_C",
                              "distance": 50.0}},
    ]

    process_telemetry_backlog(conn, tenant_id, client, "account.abc123",
                              max_per_tick=5)

    rows = db_pg.get_telemetry_for_match(raw, "m1")
    # Schema 3: Landing-Events werden fuer ALLE Lobby-Members behalten
    # (fuer 'Teams im Radius'-Detection), Kill/Knock auch global. Hier:
    # 2 Landing-Events (squad + UNKNOWN) + 1 Kill = 3.
    assert len(rows) == 3
    assert db_pg.get_matches_needing_telemetry(raw, tenant_id) == []
