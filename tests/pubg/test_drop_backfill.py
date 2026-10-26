"""Nachtrag der Airdrop-Events fuer Matches, die vor ihrer Einfuehrung liefen.

`CarePackageLand`, `CarePackagePickup` und `FlareGun` wurden erst ab dem
11.09.2026 gespeichert — aeltere Matches haben zwar Telemetrie, aber
keine dieser Zeilen. Solange das PUBG-CDN die Rohdaten noch vorhaelt
(14 Tage), laesst sich das nachholen.
"""
import json
from unittest.mock import MagicMock

import pytest

from pubg import db_pg


CONN = None
T = None

ME = "account.A"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _match(mid, played_at, url="https://cdn/telemetry.json"):
    db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", "squad-fpp", False,
                       1800, played_at, url)


def _alte_events(mid):
    """Telemetrie, wie sie vor der Erweiterung gespeichert wurde."""
    db_pg.insert_telemetry_events(CONN.raw, mid, [{
        "event_type": "Kill", "timestamp_ms": 1000,
        "actor_account": ME, "target_account": "account.E",
        "weapon": "WeapHK416_C", "payload_json": "{}"}])


def test_auswahl_findet_nur_luecken(_bind=None):
    from pubg.db_pg import matches_missing_drop_events
    _match("bf1", "2026-09-20T10:00:00Z")
    _alte_events("bf1")
    # Nur eine Leuchtpistole ist noch kein Drop-Bestand: Landepunkt und
    # Inhalt fehlen, also bleibt das Match eine Luecke. Nachweis ist
    # allein `CarePackageLand` — `CarePackageSpawn` wurde schon immer
    # gespeichert und waere als Marker wertlos.
    _match("bf2", "2026-09-20T11:00:00Z")
    db_pg.insert_telemetry_events(CONN.raw, "bf2", [{
        "event_type": "FlareGun", "timestamp_ms": 900,
        "actor_account": ME, "payload_json": "{}"}])
    # Dieses hat den Landepunkt — und ist damit versorgt.
    _match("bf2b", "2026-09-20T11:30:00Z")
    db_pg.insert_telemetry_events(CONN.raw, "bf2b", [{
        "event_type": "CarePackageLand", "timestamp_ms": 900,
        "actor_account": None, "payload_json": "{}"}])
    # Ohne Telemetrie ist nichts nachzutragen — das holt der Poller.
    _match("bf3", "2026-09-20T12:00:00Z")
    # Zu alt: das CDN liefert nichts mehr.
    _match("bf4", "2026-08-01T10:00:00Z")
    _alte_events("bf4")
    CONN.raw.commit()
    treffer = matches_missing_drop_events(
        CONN.raw, cutoff_iso="2026-09-14T00:00:00Z")
    ids = [r["match_id"] for r in treffer]
    assert "bf1" in ids and "bf2" in ids      # beide ohne Landepunkt
    assert "bf2b" not in ids                  # hat einen
    assert "bf3" not in ids                   # gar keine Telemetrie
    assert "bf4" not in ids                   # zu alt fuers CDN


def test_nachtrag_loescht_die_vorhandenen_events_nicht():
    from pubg.cli import _drop_events_nachtragen
    _match("bf5", "2026-09-20T10:00:00Z")
    _alte_events("bf5")
    CONN.raw.commit()
    client = MagicMock()
    client.get_telemetry.return_value = [
        {"_T": "LogPlayerUseFlareGun", "_D": "2026-09-20T10:05:00.0Z",
         "character": {"accountId": ME, "name": "PEX_LuCKoR",
                       "location": {"x": 1.0, "y": 2.0, "z": 3.0}}},
        {"_T": "LogCarePackageLand", "_D": "2026-09-20T10:06:00.0Z",
         "itemPackage": {"itemPackageId": "Carapackage_FlareGun_C",
                         "location": {"x": 5.0, "y": 6.0, "z": 0.0},
                         "items": [{"itemId": "Item_Weapon_AWM_C"}]}},
    ]
    n = _drop_events_nachtragen(CONN, "bf5", client,
                                "https://cdn/x.json", {ME})
    assert n == 2
    CONN.raw.commit()
    typen = [r["event_type"] for r in CONN.execute(
        "SELECT event_type FROM telemetry_events WHERE match_id = ?",
        ("bf5",)).fetchall()]
    # Der alte Kill ist noch da, die neuen sind dazugekommen.
    assert sorted(typen) == ["CarePackageLand", "FlareGun", "Kill"]


def test_nur_die_fehlenden_typen_kommen_dazu():
    """Alles andere haengt schon in der DB — ein zweites Mal waere doppelt."""
    from pubg.cli import _drop_events_nachtragen
    _match("bf6", "2026-09-20T10:00:00Z")
    _alte_events("bf6")
    CONN.raw.commit()
    client = MagicMock()
    client.get_telemetry.return_value = [
        {"_T": "LogPlayerKill", "_D": "2026-09-20T10:01:00.0Z",
         "killer": {"accountId": ME}, "victim": {"accountId": "account.E"}},
        {"_T": "LogPlayerUseFlareGun", "_D": "2026-09-20T10:05:00.0Z",
         "character": {"accountId": ME, "name": "PEX_LuCKoR",
                       "location": {"x": 1.0, "y": 2.0, "z": 3.0}}},
    ]
    n = _drop_events_nachtragen(CONN, "bf6", client, "https://cdn/x.json",
                                {ME})
    assert n == 1
    CONN.raw.commit()
    kills = CONN.execute(
        "SELECT count(*) AS n FROM telemetry_events "
        "WHERE match_id = ? AND event_type = 'Kill'", ("bf6",)).fetchone()
    assert kills["n"] == 1


def test_fremde_pickups_kommen_mit():
    """Seit 2026-10-21 auch fremde Griffe: nur so sieht man, dass ein
    Paket schon gepluendert war, als man hinkam."""
    from pubg.cli import _drop_events_nachtragen
    _match("bf7", "2026-09-20T10:00:00Z")
    _alte_events("bf7")
    CONN.raw.commit()
    client = MagicMock()
    client.get_telemetry.return_value = [
        {"_T": "LogItemPickupFromCarepackage", "_D": "2026-09-20T10:07:00.0Z",
         "character": {"accountId": "account.FREMD",
                       "location": {"x": 1.0, "y": 2.0, "z": 0.0}},
         "item": {"itemId": "Item_Weapon_AWM_C"},
         "carePackageUniqueId": 7},
        {"_T": "LogItemPickupFromCarepackage", "_D": "2026-09-20T10:08:00.0Z",
         "character": {"accountId": ME,
                       "location": {"x": 1.0, "y": 2.0, "z": 0.0}},
         "item": {"itemId": "Item_Weapon_Groza_C"},
         "carePackageUniqueId": 7},
    ]
    n = _drop_events_nachtragen(CONN, "bf7", client, "https://cdn/x.json",
                                {ME})
    assert n == 2


def test_felder_nachtrag_fuellt_vorhandene_zeilen():
    """dbno_id, Finish-Ursache, Spitzentempo und Mitfahrer — nur Updates."""
    from pubg.cli import telemetrie_felder_nachtragen
    _match("bf8", "2026-09-20T10:00:00Z")
    db_pg.insert_telemetry_events(CONN.raw, "bf8", [
        {"event_type": "Kill", "timestamp_ms": 1000,
         "actor_account": ME, "target_account": "account.E",
         "weapon": "WeapHK416_C", "damage_reason": "Damage_Gun",
         "payload_json": "{}"},
        {"event_type": "VehicleLeave", "timestamp_ms": 2000,
         "actor_account": ME, "weapon": "Dacia_A_01_v2_C",
         "payload_json": "{}"}])
    CONN.raw.commit()
    roh = [
        {"_T": "LogPlayerKillV2", "_D": "1970-01-01T00:00:01.0Z",
         "killer": {"accountId": ME}, "victim": {"accountId": "account.E"},
         "killerDamageInfo": {"damageTypeCategory": "Damage_Gun",
                              "damageCauserName": "WeapHK416_C"},
         "finishDamageInfo": {"damageTypeCategory": "Damage_DBNO"},
         "dBNOId": 77},
        {"_T": "LogVehicleLeave", "_D": "1970-01-01T00:00:02.0Z",
         "character": {"accountId": ME},
         "vehicle": {"vehicleId": "Dacia_A_01_v2_C"}, "seatIndex": 0,
         "maxSpeed": 133.0, "fellowPassengers": [{"accountId": "account.B"}]},
        # Gibt es in der DB nicht — wird nicht eingefuegt.
        {"_T": "LogPlayerRevive", "_D": "1970-01-01T00:00:03.0Z",
         "reviver": {"accountId": ME}, "victim": {"accountId": "account.B"},
         "dBNOId": 78},
    ]
    assert telemetrie_felder_nachtragen(CONN.raw, "bf8", roh) == 2
    zeilen = {r["event_type"]: r for r in CONN.execute(
        "SELECT event_type, dbno_id, damage_reason, max_speed, "
        "fellow_passengers FROM telemetry_events WHERE match_id = ?",
        ("bf8",)).fetchall()}
    assert len(zeilen) == 2
    assert zeilen["Kill"]["dbno_id"] == 77
    assert zeilen["Kill"]["damage_reason"] == "Damage_DBNO"
    assert zeilen["VehicleLeave"]["max_speed"] == 133.0
    assert zeilen["VehicleLeave"]["fellow_passengers"] == '["account.B"]'
