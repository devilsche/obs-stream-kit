"""Vehicle Action — wer wurde aus dem Auto geschossen, wer ueberfahren."""
import pytest

from pubg import db_pg
from pubg.aggregations import compute_vehicle_stats


CONN = None
T = None

ICH = "account.A"
MATE = "account.B"
GEGNER = "account.E"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _ev(et, ts, actor=None, target=None, weapon=None, reason=None, seat=None):
    return {"event_type": et, "timestamp_ms": ts, "actor_account": actor,
            "target_account": target, "actor_x": 900.0, "actor_y": 900.0,
            "actor_z": 100.0, "actor_health": 100.0, "victim_x": 1000.0,
            "victim_y": 1000.0, "weapon": weapon, "distance": 100.0,
            "damage": None, "damage_reason": reason, "seat_index": seat,
            "payload_json": None}


def _match(mid, events, played_at="2026-05-15T18:00:00Z"):
    db_pg.upsert_player(CONN.raw, T, ICH, "PEX_LuCKoR", "steam", 1)
    db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", "squad-fpp", False,
                       1800, played_at, None)
    teil = []
    for acc, name, team in ((ICH, "PEX_LuCKoR", 1), (MATE, "Mate1", 1),
                            (GEGNER, "Gegner", 7)):
        teil.append({
            "account_id": acc, "name": name, "team_id": team, "place": 5,
            "kills": 0, "headshot_kills": 0, "assists": 0, "dbnos": 0,
            "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
            "time_survived": 600, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0,
            "boosts": 0, "team_kills": 0})
    db_pg.insert_participants(CONN.raw, T, mid, teil)
    db_pg.insert_team_mapping(CONN.raw, T, mid, [
        {"account_id": ICH, "team_id": 1}, {"account_id": MATE, "team_id": 1}])
    db_pg.insert_telemetry_events(CONN.raw, mid, events)
    CONN.raw.commit()
    return mid


def _mich(res):
    # compute_vehicle_stats liefert die Liste; der Endpoint verpackt sie
    # erst als {"members": [...]}.
    return next(m for m in res if m["accountId"] == ICH)


def test_ueberfahren_werden_taucht_in_vehicle_action_auf():
    """Ueberfahren zaehlt bisher gar nicht — ich sass ja nicht im Auto.

    Die Zaehlung fragte nur "war ICH in einem Fahrzeug?". Beim
    Ueberfahren-Werden sitzt aber der Gegner drin, also fiel der Fall
    komplett durch.
    """
    _match("v1", [
        _ev("VehicleEnter", 100000, actor=GEGNER, weapon="Uaz_B_01_C", seat=0),
        _ev("Kill", 150000, actor=GEGNER, target=ICH,
            weapon="Uaz_B_01_C", reason="Damage_VehicleHit"),
    ])
    res = compute_vehicle_stats(CONN, T, ICH, range_key="all")
    ich = _mich(res)
    assert ich["evictionsTaken"] == 1
    treffer = ich["eventsTaken"][0]
    assert treffer["kind"] == "run_over"
    assert treffer["vehicle"] == "Uaz_B_01_C"


def test_selbst_ueberfahren_ist_kein_driveby():
    """Jemanden umfahren ist nicht dasselbe wie ihn beim Fahren erschiessen."""
    _match("v2", [
        _ev("VehicleEnter", 100000, actor=ICH, weapon="Dacia_A_01_v2_C", seat=0),
        _ev("Kill", 150000, actor=ICH, target=GEGNER,
            weapon="Dacia_A_01_v2_C", reason="Damage_VehicleHit"),
    ])
    res = compute_vehicle_stats(CONN, T, ICH, range_key="all")
    ich = _mich(res)
    assert ich["evictionsDealt"] == 1
    assert ich["eventsDealt"][0]["kind"] == "run_over_dealt"


def test_driveby_bleibt_driveby():
    """Gegenprobe: aus dem fahrenden Auto erschossen bleibt unveraendert."""
    _match("v3", [
        _ev("VehicleEnter", 100000, actor=ICH, weapon="Dacia_A_01_v2_C", seat=0),
        _ev("Kill", 150000, actor=ICH, target=GEGNER,
            weapon="WeapHK416_C", reason="Damage_Gun"),
    ])
    res = compute_vehicle_stats(CONN, T, ICH, range_key="all")
    assert _mich(res)["eventsDealt"][0]["kind"] == "driveby_kill"
