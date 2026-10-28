"""Luft-Kills und Kimme-und-Korn-Kills als Achievements.

Skeet Shooter — Opfer am Fallschirm getroffen. Die Telemetrie kennt
keinen "in der Luft"-Zustand, aber das Spiel beendet den Fallschirmflug
beim Treffer und schreibt dafuer ein LogParachuteLanding, 0-20 ms vor dem
Knock. Massgeblich ist nur die ERSTE Landung nach dem Verlassen von
Flugzeug/Redeploy/Emergency Pickup: dieselbe Landung feuert spaeter auch
bei Knocks am Boden (bis zu sechs je Spieler und Match).

Welcome Committee — Treffer bis 3 s nach dieser ersten Landung.
Glider Down — Opfer sass im Motorgleiter.
Iron Sights — Kill ab 100 m (Stufe 2 ab 200 m) ohne Visier-Aufsatz.
"""
import json

import pytest

from pubg import db_pg
from pubg.aggregations import (PUBG_RARE_ACHIEVEMENTS,
                               compute_session_achievements)

ME = "account.A"
V = "account.V"           # Opfer
AIRCRAFT = "DummyTransportAircraft_C"


@pytest.fixture
def sess(pg_compat):
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    conn.raw.commit()
    return conn, t1


def _match(conn, tenant_id, mid="m1", played="2026-10-26T21:11:20Z"):
    db_pg.insert_match(conn.raw, tenant_id, mid, "Baltic_Main", "squad-fpp",
                       False, 1800, played, None)
    db_pg.insert_participants(conn.raw, tenant_id, mid, [{
        "account_id": ME, "name": "PEX_LuCKoR", "team_id": 1, "place": 5,
        "kills": 1, "headshot_kills": 0, "assists": 0, "dbnos": 1,
        "revives": 0, "damage_dealt": 200.0, "longest_kill": 204.0,
        "time_survived": 900, "walk_distance": 1000.0,
        "ride_distance": 0.0, "swim_distance": 0.0,
        "weapons_acquired": 4, "heals": 1, "boosts": 1, "team_kills": 0}])
    db_pg.insert_team_mapping(conn.raw, tenant_id, mid,
                              [{"account_id": ME, "team_id": 1}])
    conn.raw.commit()


def _events(conn, evs, mid="m1"):
    db_pg.insert_telemetry_events(conn.raw, mid, evs)


def _leave(ts, acc=V, vehicle=AIRCRAFT):
    return {"event_type": "VehicleLeave", "timestamp_ms": ts,
            "actor_account": acc, "weapon": vehicle, "vehicle_id": vehicle}


def _enter(ts, acc=V, vehicle=AIRCRAFT):
    return {"event_type": "VehicleEnter", "timestamp_ms": ts,
            "actor_account": acc, "weapon": vehicle, "vehicle_id": vehicle}


def _land(ts, acc=V, x=100000.0, y=100000.0, z=4000.0):
    return {"event_type": "Landing", "timestamp_ms": ts, "actor_account": acc,
            "actor_x": x, "actor_y": y, "actor_z": z}


def _hit(kind, ts, dist_cm=20353.0, weapon="WeapKar98k_C", target=V,
         attachments=None, reason="Damage_Gun"):
    return {"event_type": kind, "timestamp_ms": ts, "actor_account": ME,
            "target_account": target, "distance": dist_cm, "weapon": weapon,
            "damage_reason": reason,
            "attachments": json.dumps(attachments) if attachments else None}


def _ach(conn, tenant_id):
    return {a["id"]: a for a in compute_session_achievements(conn, tenant_id, ME)}


SCOPE = ["Item_Attach_Weapon_Upper_Scope6x_C"]


# ── Skeet Shooter ─────────────────────────────────────────────────────────

def test_skeet_shooter_knock_am_fallschirm(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_leave(100000), _land(200000, z=6100.0),
                   _hit("Knock", 200001, attachments=None)])
    got = _ach(conn, t1)
    assert "skeet_shooter" in got
    assert "Kar98k" in got["skeet_shooter"]["label"]
    assert "204 m" in got["skeet_shooter"]["label"]
    assert "welcome_committee" not in got


def test_skeet_zeigt_hoehe_ueber_grund(sess):
    # Drei andere Spieler landen in der Naehe auf 40 m — das Opfer
    # "landete" auf 61 m, war also 21 m in der Luft.
    conn, t1 = sess
    _match(conn, t1)
    others = [_land(190000 + i, acc=f"account.O{i}", x=100500.0 + i * 100,
                    z=4000.0) for i in range(3)]
    _events(conn, others + [_leave(100000), _land(200000, z=6100.0),
                            _hit("Knock", 200005)])
    assert "21 m up" in _ach(conn, t1)["skeet_shooter"]["label"]


def test_spaetere_landung_beim_knock_am_boden_zaehlt_nicht(sess):
    # Die echte Landung war bei 150000; das zweite LogParachuteLanding
    # kommt vom Knock am Boden und darf kein Skeet ausloesen.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_leave(100000), _land(150000), _land(400000),
                   _hit("Knock", 400001)])
    got = _ach(conn, t1)
    assert "skeet_shooter" not in got
    assert "welcome_committee" not in got


def test_redeploy_flugzeug_zaehlt_wie_absprung(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_leave(100000), _land(150000),
                   _leave(900000, vehicle="RedeployAircraft_Tiger_C"),
                   _land(950000), _hit("Knock", 950010)])
    assert "skeet_shooter" in _ach(conn, t1)


def test_knock_und_kill_desselben_opfers_nur_einmal(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_leave(100000), _land(200000), _hit("Knock", 200001),
                   _hit("Kill", 211000, attachments=SCOPE)])
    label = _ach(conn, t1)["skeet_shooter"]["label"]
    assert "×" not in label


def test_im_emergency_pickup_ist_sky_snipe_nicht_skeet(sess):
    conn, t1 = sess
    _match(conn, t1)
    ep = "BP_EmergencyPickupVehicle_C"
    _events(conn, [_leave(100000), _land(150000),
                   _enter(500000, vehicle=ep), _hit("Knock", 510000),
                   _leave(510050, vehicle=ep)])
    got = _ach(conn, t1)
    assert "em_pickup_kill" in got
    assert "skeet_shooter" not in got


# ── Welcome Committee ─────────────────────────────────────────────────────

def test_welcome_committee_bis_drei_sekunden(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_leave(100000), _land(200000), _hit("Knock", 201500)])
    got = _ach(conn, t1)
    assert "welcome_committee" in got
    assert "skeet_shooter" not in got


def test_nach_drei_sekunden_nichts(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_leave(100000), _land(200000), _hit("Knock", 203100)])
    got = _ach(conn, t1)
    assert "welcome_committee" not in got and "skeet_shooter" not in got


# ── Glider Down ───────────────────────────────────────────────────────────

def test_glider_down(sess):
    conn, t1 = sess
    _match(conn, t1)
    g = "BP_Motorglider_Green_C"
    _events(conn, [_leave(100000), _land(150000),
                   _enter(300000, vehicle=g), _hit("Kill", 350000,
                                                   dist_cm=15000.0,
                                                   weapon="WeapHK416_C",
                                                   attachments=SCOPE),
                   _leave(350040, vehicle=g)])
    got = _ach(conn, t1)
    assert "glider_down" in got
    assert "M416" in got["glider_down"]["label"] or "HK416" in got["glider_down"]["label"]
    assert "skeet_shooter" not in got


# ── Iron Sights ───────────────────────────────────────────────────────────

def test_iron_sights_ab_100m(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Kill", 600000, dist_cm=14300.0, attachments=[
        "Item_Attach_Weapon_Stock_SniperRifle_CheekPad_C"])])
    got = _ach(conn, t1)
    assert "iron_sights_100" in got
    assert "143 m" in got["iron_sights_100"]["label"]


def test_iron_sights_ab_200m_nur_hoechste_stufe(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Kill", 600000, dist_cm=21000.0, attachments=None)])
    got = _ach(conn, t1)
    assert "iron_sights_200" in got and "iron_sights_100" not in got


@pytest.mark.parametrize("hit", [
    _hit("Kill", 600000, dist_cm=21000.0, attachments=SCOPE),          # Visier
    _hit("Kill", 600000, dist_cm=21000.0, weapon="WeapVSS_C"),         # eingebaut
    _hit("Knock", 600000, dist_cm=21000.0),                            # ohne Aufsatz-Daten
    _hit("Kill", 600000, dist_cm=9900.0),                              # zu nah
    _hit("Kill", 600000, dist_cm=21000.0, reason="Damage_Explosion_Grenade"),
])
def test_iron_sights_negativfaelle(sess, hit):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [hit])
    got = _ach(conn, t1)
    assert "iron_sights_100" not in got and "iron_sights_200" not in got


# ── Registrierung ─────────────────────────────────────────────────────────

NEW_IDS = ["skeet_shooter", "glider_down", "welcome_committee",
           "iron_sights_100", "iron_sights_200"]


def test_alle_neuen_ids_sind_rare():
    for aid in NEW_IDS:
        assert aid in PUBG_RARE_ACHIEVEMENTS


def test_alle_neuen_ids_haben_metadaten():
    from pubg.endpoints import EndpointRegistry
    src = open(__import__("pubg.endpoints", fromlist=["x"]).__file__).read()
    for aid in NEW_IDS:
        # Titel, Beschreibung EN + DE, Prioritaet, Icon-Eintrag
        assert src.count(f'"{aid}"') >= 5, aid
    assert EndpointRegistry  # Modul importierbar
