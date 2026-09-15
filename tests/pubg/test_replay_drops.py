"""Airdrops im Match-Replay.

Ein Paket, das kurz nach einer Leuchtpistole in deren Naehe landet,
wurde angefordert — das steht so nicht in den Daten, laesst sich aber
aus Ort und Zeit schliessen.
"""
import json

from pubg.replay_builder import extract_events, db_rows_to_raw_events


MAPKM = 8.0


def _land(ts_iso, x, y, items=None, pid="Carapackage_RedBox_C"):
    return {"_T": "LogCarePackageLand", "_D": ts_iso,
            "itemPackage": {"itemPackageId": pid,
                            "location": {"x": x, "y": y, "z": 0},
                            "items": [{"itemId": i} for i in (items or [])]}}


def _flare(ts_iso, x, y, acc="account.A"):
    return {"_T": "LogPlayerUseFlareGun", "_D": ts_iso,
            "character": {"accountId": acc, "name": "PEX_LuCKoR",
                          "location": {"x": x, "y": y, "z": 100}}}


def _drops(evs):
    return [e for e in evs if e["type"] == "drop"]


def test_paket_landet_mit_inhalt():
    evs, _ = extract_events([
        _land("2026-09-14T10:05:00.0Z", 400000, 300000,
              ["Item_Weapon_Groza_C", "Item_Ammo_762mm_C",
               "Item_Head_G_01_Lv3_C"]),
    ], MAPKM)
    d = _drops(evs)
    assert len(d) == 1
    assert 0 <= d[0]["x"] <= 1 and 0 <= d[0]["y"] <= 1
    # Der Inhalt in Klartext, Wiederholungen zusammengezogen.
    assert d[0]["items"] == ["Groza", "7.62mm Ammo", "Level 3 Helmet"]
    assert d[0]["called"] is False


def test_paket_kurz_nach_der_flare_gilt_als_angefordert():
    evs, _ = extract_events([
        _flare("2026-09-14T10:05:00.0Z", 400000, 300000),
        _land("2026-09-14T10:06:00.0Z", 402000, 301000,
              ["Item_Weapon_AWM_C"], pid="Carapackage_FlareGun_C"),
    ], MAPKM)
    d = _drops(evs)
    assert len(d) == 1
    assert d[0]["called"] is True
    assert d[0]["calledBy"] == "account.A"


def test_weit_entferntes_paket_gehoert_nicht_zur_flare():
    """Sonst wird jedes Paket der naechstbesten Leuchtpistole zugeschlagen."""
    evs, _ = extract_events([
        _flare("2026-09-14T10:05:00.0Z", 100000, 100000),
        _land("2026-09-14T10:06:00.0Z", 700000, 700000,
              ["Item_Weapon_AWM_C"]),
    ], MAPKM)
    assert _drops(evs)[0]["called"] is False


def test_viel_spaeteres_paket_gehoert_nicht_zur_flare():
    evs, _ = extract_events([
        _flare("2026-09-14T10:05:00.0Z", 400000, 300000),
        _land("2026-09-14T10:12:00.0Z", 401000, 301000,
              ["Item_Weapon_AWM_C"]),
    ], MAPKM)
    assert _drops(evs)[0]["called"] is False


def test_flare_ist_ein_eigenes_ereignis():
    """Damit die Karte zeigt, wo gezuendet wurde — auch ohne Paket."""
    evs, _ = extract_events([
        _flare("2026-09-14T10:05:00.0Z", 400000, 300000),
    ], MAPKM)
    f = [e for e in evs if e["type"] == "flare"]
    assert len(f) == 1
    assert f[0]["actorId"] == "account.A"


def test_drops_kommen_auch_aus_der_datenbank():
    """Der DB-Weg ist der Normalfall — das Archiv hat nicht jedes Match."""
    rows = [
        {"event_type": "CarePackageLand", "timestamp_ms": 1_700_000_005_000,
         "actor_account": None, "target_account": None,
         "actor_x": 400000.0, "actor_y": 300000.0, "actor_z": 0.0,
         "actor_health": None, "victim_x": None, "victim_y": None,
         "weapon": "Carapackage_RedBox_C", "distance": None, "damage": None,
         "attachments": json.dumps(["Item_Weapon_Groza_C"]),
         "seat_index": None},
    ]
    evs, _ = extract_events(db_rows_to_raw_events(rows), MAPKM)
    d = _drops(evs)
    assert len(d) == 1
    assert d[0]["items"] == ["Groza"]
