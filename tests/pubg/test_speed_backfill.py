"""Nachtrag von velocity/vehicle_id in bereits importierte Events.

Anders als beim Airdrop-Nachtrag fehlen hier keine Zeilen, sondern
Spalten: die Positions-Events sind da, nur ohne den Fahrzeug-Zustand,
der in der Roh-Telemetrie danebenstand.
"""
from unittest.mock import MagicMock

import pytest

from pubg import db_pg


CONN = None
T = None
ICH = "account.A"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _pos_row(ts, acc=ICH):
    return {"event_type": "Position", "timestamp_ms": ts,
            "actor_account": acc, "target_account": None,
            "actor_x": 1.0, "actor_y": 2.0, "actor_z": 3.0,
            "actor_health": 100.0, "victim_x": None, "victim_y": None,
            "weapon": None, "distance": None, "damage": None,
            "damage_reason": None, "seat_index": None, "attachments": None,
            "payload_json": None}


def _roh(ts_iso, vid, vel, seat=0, acc=ICH):
    return {"_T": "LogPlayerPosition", "_D": ts_iso,
            "character": {"accountId": acc,
                          "location": {"x": 1.0, "y": 2.0, "z": 3.0},
                          "health": 100.0},
            "vehicle": {"vehicleId": vid, "velocity": vel,
                        "seatIndex": seat, "vehicleType": "WheeledVehicle"}}


def test_tempo_wird_in_vorhandene_zeilen_nachgetragen():
    from pubg.cli import _tempo_nachtragen
    from pubg.telemetry import _ts_ms
    db_pg.insert_match(CONN.raw, T, "sb1", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-10T18:00:00Z", "https://cdn/x.json")
    ts = _ts_ms("2026-09-10T18:05:00.0Z")
    db_pg.insert_telemetry_events(CONN.raw, "sb1", [_pos_row(ts)])
    CONN.raw.commit()

    client = MagicMock()
    client.get_telemetry.return_value = [
        _roh("2026-09-10T18:05:00.0Z", "BP_Mirado_A_01_C", 4300.0),
    ]
    n = _tempo_nachtragen(CONN, "sb1", client, "https://cdn/x.json")
    assert n == 1
    CONN.raw.commit()
    r = CONN.execute(
        "SELECT velocity, vehicle_id, seat_index FROM telemetry_events "
        "WHERE match_id = ? AND timestamp_ms = ?", ("sb1", ts)).fetchone()
    assert r["velocity"] == 4300.0
    assert r["vehicle_id"] == "BP_Mirado_A_01_C"
    assert r["seat_index"] == 0


def test_zeilen_ohne_gegenstueck_bleiben_unberuehrt():
    """Die Roh-Telemetrie hat mehr Events als wir importieren — was wir
    nicht haben, darf auch nichts anlegen."""
    from pubg.cli import _tempo_nachtragen
    db_pg.insert_match(CONN.raw, T, "sb2", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-10T18:00:00Z", "https://cdn/x.json")
    CONN.raw.commit()
    client = MagicMock()
    client.get_telemetry.return_value = [
        _roh("2026-09-10T18:05:00.0Z", "BP_Mirado_A_01_C", 4300.0),
    ]
    assert _tempo_nachtragen(CONN, "sb2", client, "https://cdn/x.json") == 0
    n = CONN.execute("SELECT count(*) AS n FROM telemetry_events "
                     "WHERE match_id = ?", ("sb2",)).fetchone()["n"]
    assert n == 0


def test_auswahl_ueberspringt_was_schon_tempo_hat():
    from pubg.db_pg import matches_missing_velocity
    from pubg.telemetry import _ts_ms
    for mid in ("sb3", "sb4"):
        db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", "squad-fpp",
                           False, 1800, "2026-09-10T18:00:00Z",
                           "https://cdn/x.json")
    ts = _ts_ms("2026-09-10T18:05:00.0Z")
    db_pg.insert_telemetry_events(CONN.raw, "sb3", [_pos_row(ts)])
    fertig = _pos_row(ts)
    fertig["velocity"] = 1000.0
    fertig["vehicle_id"] = "Dacia_A_01_v2_C"
    db_pg.insert_telemetry_events(CONN.raw, "sb4", [fertig])
    CONN.raw.commit()
    offen = [r["match_id"] for r in matches_missing_velocity(CONN.raw)]
    assert offen == ["sb3"]
