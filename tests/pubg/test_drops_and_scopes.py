"""Visiere, Leuchtpistole und Airdrops.

Die Visier-Zuordnung ist der fehleranfaellige Teil: die internen Namen
taeuschen. `CQBSS` ist das **8x**, nicht das 4x — das heisst `ACOG_01`.
Ein Filter auf `Scope4x`/`Scope8x` findet beide nicht und beschriftet
das 8x als 4x; genau das war im ersten Entwurf passiert.
"""
import json

import pytest

from pubg import db_pg
from pubg.aggregations import (PUBG_RARE_ACHIEVEMENTS,
                               compute_session_achievements)
from pubg.shot_quality import (RELIABLE_SCOPE_KILLS, SCOPE_ORDER,
                               scope_breakdown, scope_of)

ME = "account.A"


def _att(*teile):
    return json.dumps([f"Item_Attach_Weapon_{x}" for x in teile])


# ── Visier-Zuordnung ────────────────────────────────────────────────────────

@pytest.mark.parametrize("roh,erwartet", [
    ("Upper_PM2_01_C", "15x"),
    ("Upper_CQBSS_C", "8x"),
    ("Upper_Scope6x_C", "6x"),
    ("Upper_ACOG_01_C", "4x"),
    ("Upper_DualOptic_4x1x_C", "4x/1x"),
    ("Upper_Scope3x_C", "3x"),
    ("Upper_Aimpoint_C", "2x"),
    ("Upper_Holosight_C", "Holo"),
    ("Upper_DotSight_01_C", "Red Dot"),
])
def test_jedes_visier_wird_erkannt(roh, erwartet):
    assert scope_of(_att(roh)) == erwartet


def test_cqbss_ist_das_achtfache_nicht_das_vierfache():
    # Der Fehler aus dem ersten Entwurf, als Test festgehalten.
    assert scope_of(_att("Upper_CQBSS_C")) == "8x"
    assert scope_of(_att("Upper_ACOG_01_C")) == "4x"


def test_nur_griff_heisst_ohne_visier():
    # Kimme und Korn — nicht dasselbe wie fehlende Daten.
    assert scope_of(_att("Lower_Foregrip_C")) == "none"


def test_fehlende_daten_sind_kein_visier():
    assert scope_of(None) is None
    assert scope_of("") is None


def test_dualoptik_gewinnt_gegen_die_teilkennung():
    # Die 4x/1x traegt beide Kennungen; die Reihenfolge in SCOPES
    # entscheidet, sonst waere sie mal 4x und mal 4x/1x.
    assert scope_of(_att("Upper_DualOptic_4x1x_C", "Lower_Foregrip_C")) == "4x/1x"


def test_anzeigereihenfolge_steigt_mit_der_vergroesserung():
    assert SCOPE_ORDER.index("Red Dot") < SCOPE_ORDER.index("4x")
    assert SCOPE_ORDER.index("4x") < SCOPE_ORDER.index("8x")
    assert SCOPE_ORDER.index("8x") < SCOPE_ORDER.index("15x")
    assert SCOPE_ORDER[0] == "none"


# ── Auswertung gegen die Datenbank ──────────────────────────────────────────

@pytest.fixture
def sess(pg_compat):
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    conn.raw.commit()
    return conn, t1


def _match(conn, tenant_id, mid="m1", played="2026-09-11T12:00:00Z"):
    db_pg.insert_match(conn.raw, tenant_id, mid, "Baltic_Main", "squad-fpp",
                       False, 1800, played, None)
    # Ohne Teilnehmerzeile taucht das Match in keiner Session auf, und
    # die Achievement-Erkennung laeuft ueber genau diese Liste.
    db_pg.insert_participants(conn.raw, tenant_id, mid, [{
        "account_id": ME, "name": "PEX_LuCKoR", "team_id": 1, "place": 5,
        "kills": 1, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 200.0, "longest_kill": 30.0,
        "time_survived": 900, "walk_distance": 800.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 3, "heals": 1,
        "boosts": 0, "team_kills": 0}])
    db_pg.insert_team_mapping(conn.raw, tenant_id, mid,
                              [{"account_id": ME, "team_id": 1}])
    conn.raw.commit()


def _kill(ts, att, dist, mid="m1"):
    return {"event_type": "Kill", "timestamp_ms": ts, "actor_account": ME,
            "target_account": "enemy", "weapon": "WeapHK416_C",
            "attachments": att, "distance": dist}


def test_kills_werden_je_visier_gezaehlt(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        _kill(1000, _att("Upper_DotSight_01_C"), 2500),
        _kill(2000, _att("Upper_DotSight_01_C"), 1500),
        _kill(3000, _att("Upper_CQBSS_C"), 30000),
    ])
    d = scope_breakdown(conn, t1, ME, "1970-01-01")
    nach = {r["scope"]: r for r in d["byScope"]}
    assert nach["Red Dot"]["kills"] == 2
    assert nach["8x"]["kills"] == 1
    assert d["kills"] == 3


def test_distanz_kommt_in_metern(sess):
    # Die Telemetrie rechnet in Zentimetern; 30.000 sind 300 m.
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        _kill(1000, _att("Upper_CQBSS_C"), 30000)])
    r = scope_breakdown(conn, t1, ME, "1970-01-01")["byScope"][0]
    assert r["avgDistance"] == 300.0
    assert r["maxDistance"] == 300


def test_weitschuss_anteil(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        _kill(1000, _att("Upper_CQBSS_C"), 30000),   # 300 m, weit
        _kill(2000, _att("Upper_CQBSS_C"), 5000),    # 50 m, nah
    ])
    r = scope_breakdown(conn, t1, ME, "1970-01-01")["byScope"][0]
    assert r["longShare"] == 50.0


def test_wenige_kills_gelten_als_unsicher(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        _kill(1000, _att("Upper_PM2_01_C"), 20000)])
    r = scope_breakdown(conn, t1, ME, "1970-01-01")["byScope"][0]
    assert r["reliable"] is False
    assert RELIABLE_SCOPE_KILLS > 1


def test_kills_ohne_aufsatzdaten_stehen_getrennt(sess):
    # Sie duerfen nicht als "ohne Visier" gelten — das waere eine
    # Aussage, wo keine Daten sind.
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        _kill(1000, None, 2000),
        _kill(2000, _att("Lower_Foregrip_C"), 2000),
    ])
    d = scope_breakdown(conn, t1, ME, "1970-01-01")
    assert d["unknown"] == 1
    assert [r["scope"] for r in d["byScope"]] == ["no sight"]


def test_fremde_kills_zaehlen_nicht(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [{
        "event_type": "Kill", "timestamp_ms": 1000,
        "actor_account": "account.X", "target_account": ME,
        "weapon": "WeapHK416_C", "attachments": _att("Upper_CQBSS_C"),
        "distance": 30000}])
    assert scope_breakdown(conn, t1, ME, "1970-01-01")["kills"] == 0


# ── Leuchtpistole ───────────────────────────────────────────────────────────

def _ids(conn, tenant_id):
    return [a["id"] for a in compute_session_achievements(conn, tenant_id, ME)]


def _labels(conn, tenant_id, aid):
    return [a["label"] for a in compute_session_achievements(conn, tenant_id, ME)
            if a["id"] == aid]


def test_leuchtpistole_wird_erkannt(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [{
        "event_type": "FlareGun", "timestamp_ms": 600000,
        "actor_account": ME, "weapon": "Item_Weapon_FlareGun_C"}])
    assert "flare_gun" in _ids(conn, t1)


def test_leuchtpistole_nennt_die_waffe_aus_dem_paket(sess):
    # Der Reiz liegt darin, was herunterkam.
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        {"event_type": "FlareGun", "timestamp_ms": 600000,
         "actor_account": ME, "weapon": "Item_Weapon_FlareGun_C"},
        {"event_type": "CarePackageLand", "timestamp_ms": 630000,
         "weapon": "Carapackage_RedBox_C",
         "attachments": json.dumps(["Item_Ammo_556mm_C",
                                    "Item_Weapon_AWM_C"])},
    ])
    assert _labels(conn, t1, "flare_gun") == ["Flare Fired · AWM"]


def test_paket_ohne_besondere_waffe_bleibt_schlicht(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        {"event_type": "FlareGun", "timestamp_ms": 600000,
         "actor_account": ME, "weapon": "Item_Weapon_FlareGun_C"},
        {"event_type": "CarePackageLand", "timestamp_ms": 630000,
         "weapon": "Carapackage_RedBox_C",
         "attachments": json.dumps(["Item_Armor_Lv3_C"])},
    ])
    assert _labels(conn, t1, "flare_gun") == ["Flare Fired"]


def test_spaeter_gefallenes_paket_zaehlt_nicht_dazu(sess):
    # Ohne Zeitfenster waere jedes Paket des Matches ein Kandidat.
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        {"event_type": "FlareGun", "timestamp_ms": 600000,
         "actor_account": ME, "weapon": "Item_Weapon_FlareGun_C"},
        {"event_type": "CarePackageLand", "timestamp_ms": 1200000,
         "weapon": "Carapackage_RedBox_C",
         "attachments": json.dumps(["Item_Weapon_AWM_C"])},
    ])
    assert _labels(conn, t1, "flare_gun") == ["Flare Fired"]


def test_fremde_leuchtpistole_loest_nichts_aus(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [{
        "event_type": "FlareGun", "timestamp_ms": 600000,
        "actor_account": "account.X", "weapon": "Item_Weapon_FlareGun_C"}])
    assert "flare_gun" not in _ids(conn, t1)


# ── Airdrops ────────────────────────────────────────────────────────────────

def test_entnahme_aus_dem_paket_zaehlt(sess):
    # "Ich war dran" — nicht "ein Paket ist gefallen".
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [{
        "event_type": "CarePackagePickup", "timestamp_ms": 700000,
        "actor_account": ME, "weapon": "Item_Weapon_Groza_C",
        "attachments": "Carapackage_RedBox_C"}])
    assert _labels(conn, t1, "airdrop_looted") == ["Airdrop · Groza"]


def test_nur_munition_geholt_bleibt_schlicht(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [{
        "event_type": "CarePackagePickup", "timestamp_ms": 700000,
        "actor_account": ME, "weapon": "Item_Ammo_762mm_C",
        "attachments": "Carapackage_RedBox_C"}])
    assert _labels(conn, t1, "airdrop_looted") == ["Airdrop Looted"]


def test_zwei_pakete_werden_gezaehlt(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        {"event_type": "CarePackagePickup", "timestamp_ms": 700000,
         "actor_account": ME, "weapon": "Item_Ammo_762mm_C",
         "attachments": "Carapackage_RedBox_C"},
        {"event_type": "CarePackagePickup", "timestamp_ms": 900000,
         "actor_account": ME, "weapon": "Item_Ammo_556mm_C",
         "attachments": "Carepackage_SmallPackage_NoParachute_Bluechip_C"},
    ])
    assert _labels(conn, t1, "airdrop_looted") == ["Airdrop Looted · 2x"]


def test_gefallenes_paket_ohne_entnahme_loest_nichts_aus(sess):
    conn, t1 = sess
    _match(conn, t1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [{
        "event_type": "CarePackageLand", "timestamp_ms": 600000,
        "weapon": "Carapackage_RedBox_C",
        "attachments": json.dumps(["Item_Weapon_AWM_C"])}])
    assert "airdrop_looted" not in _ids(conn, t1)


def test_die_leuchtpistole_gilt_als_selten():
    assert "flare_gun" in PUBG_RARE_ACHIEVEMENTS
    # Ein Airdrop ist Alltag und braucht kein Glanz-Popup.
    assert "airdrop_looted" not in PUBG_RARE_ACHIEVEMENTS


def test_beide_sind_vollstaendig_registriert():
    from pubg.endpoints import EndpointRegistry as R
    for aid in ("flare_gun", "airdrop_looted"):
        assert aid in R.PUBG_POPUP_PRIORITY, aid
        assert aid in R.PUBG_CANONICAL_LABELS, aid
        assert aid in R.PUBG_ICON_URLS, aid
        for lang in ("english", "german"):
            assert aid in R.PUBG_ACH_DESCRIPTIONS[lang], f"{aid}/{lang}"


# ── Airdrop-Zuordnung über die Position ─────────────────────────────────────

def _land(ts, x, y, items, typ="Carapackage_RedBox_C"):
    return {"_T": "LogCarePackageLand", "_D": ts,
            "itemPackage": {"itemPackageId": typ,
                            "location": {"x": x, "y": y},
                            "items": [{"itemId": i} for i in items]}}


def _take(ts, name, x, y, item, typ="Carapackage_RedBox_C"):
    return {"_T": "LogItemPickupFromCarepackage", "_D": ts,
            "character": {"accountId": name, "name": name,
                          "location": {"x": x, "y": y}},
            "item": {"itemId": item}, "carePackageName": typ}


def test_zwei_pakete_desselben_typs_werden_getrennt():
    # Der eigentliche Fehler: über den Pakettyp allein zählte jede
    # Entnahme an jedes Paket des Typs. Ein echtes Match hatte 44
    # Landungen bei einer Handvoll Typen.
    from pubg.telemetry_analysis import airdrops
    evs = [_land("t0", 0.0, 0.0, ["Item_Weapon_AWM_C"]),
           _land("t1", 500000.0, 500000.0, ["Item_Weapon_Groza_C"]),
           _take("t2", "A", 100.0, 100.0, "Item_Weapon_AWM_C"),
           _take("t3", "B", 499900.0, 500100.0, "Item_Weapon_Groza_C")]
    d = airdrops(evs)
    assert [[t["name"] for t in x["takenBy"]] for x in d] == [["A"], ["B"]]


def test_entnahme_weit_weg_wird_keinem_paket_zugerechnet():
    # Wer ein Paket ausräumt, steht daran — gemessen ein bis zwei Meter.
    from pubg.telemetry_analysis import airdrops
    evs = [_land("t0", 0.0, 0.0, ["Item_Weapon_AWM_C"]),
           _take("t1", "C", 900000.0, 900000.0, "Item_Weapon_AWM_C")]
    d = airdrops(evs)
    assert d[0]["takenBy"] == [] and d[0]["touched"] is False


def test_ausruestung_zaehlt_auch_als_highlight():
    # Vorher stand bei einem Paket mit Level-3-Weste und 8x-Visier
    # "nichts Besonderes" — gemessen der häufigste Inhalt überhaupt.
    from pubg.telemetry_analysis import airdrops
    d = airdrops([_land("t0", 0.0, 0.0, [
        "Item_Ammo_556mm_C", "Item_Head_G_01_Lv3_C",
        "Item_Attach_Weapon_Upper_CQBSS_C"])])
    assert set(d[0]["highlights"]) == {"Helmet Lv3", "8x"}


def test_munition_ist_kein_highlight():
    from pubg.telemetry_analysis import airdrops
    d = airdrops([_land("t0", 0.0, 0.0,
                        ["Item_Ammo_556mm_C", "Item_Heal_FirstAid_C"])])
    assert d[0]["highlights"] == []
    assert d[0]["itemCount"] == 2


def test_ohne_landung_dient_der_spawn_als_notnagel():
    # Alte Aufzeichnungen haben nur Spawn-Ereignisse.
    from pubg.telemetry_analysis import airdrops
    d = airdrops([{"_T": "LogCarePackageSpawn", "_D": "t0",
                   "itemPackage": {"itemPackageId": "Carapackage_RedBox_C",
                                   "location": {"x": 1.0, "y": 2.0},
                                   "items": [{"itemId": "Item_Weapon_AWM_C"}]}}])
    assert len(d) == 1 and d[0]["highlights"] == ["AWM"]


def test_landung_gewinnt_gegen_spawn():
    # Beides für dasselbe Paket: der Spawn nennt den Abwurfpunkt in der
    # Luft, erst die Landung den Punkt am Boden.
    from pubg.telemetry_analysis import airdrops
    evs = [{"_T": "LogCarePackageSpawn", "_D": "t0",
            "itemPackage": {"itemPackageId": "Carapackage_RedBox_C",
                            "location": {"x": 9.0, "y": 9.0}, "items": []}},
           _land("t1", 1.0, 2.0, ["Item_Weapon_AWM_C"])]
    d = airdrops(evs)
    assert len(d) == 1 and (d[0]["x"], d[0]["y"]) == (1.0, 2.0)


# ── Englische Oberfläche ────────────────────────────────────────────────────

def test_wurfgeraete_werden_englisch_ausgeliefert():
    # WEAPON_NAMES ist deutsch gepflegt und ist der Schlüssel in
    # match_weapon_stats — geändert wird nichts daran, übersetzt wird
    # erst beim Ausliefern. Ohne diese Schicht stand im
    # Shot-Quality-Tool "Rauchbombe" und "Blendgranate".
    from pubg.aggregations import weapon_display
    assert weapon_display("Rauchbombe") == "Smoke Grenade"
    assert weapon_display("Blendgranate") == "Flash Grenade"
    assert weapon_display("Blauzonen-Granate") == "Blue Zone Grenade"
    assert weapon_display("Taser") == "Stun Gun"
    assert weapon_display("Pfanne (Wurf)") == "Pan (thrown)"


def test_schusswaffen_bleiben_unveraendert():
    from pubg.aggregations import weapon_display
    for n in ("M416", "Beryl", "Mk12", "AWM"):
        assert weapon_display(n) == n


def test_rohe_id_direkt_zum_englischen_namen():
    from pubg.aggregations import weapon_name_en
    assert weapon_name_en("Item_Weapon_SmokeBomb_C") == "Smoke Grenade"
    assert weapon_name_en("Bluezonebomb_EffectActor_C") == "Blue Zone Grenade"
    assert weapon_name_en("WeapHK416_C") == "M416"


def test_der_datenschluessel_bleibt_deutsch():
    # _weapon_label darf NICHT übersetzen: sein Rückgabewert ist auch
    # der Schlüssel in match_weapon_stats.weapon. Eine Übersetzung dort
    # hieße migrieren.
    from pubg.aggregations import _weapon_label
    assert _weapon_label("Item_Weapon_SmokeBomb_C")[0] == "Rauchbombe"
    assert _weapon_label("ProjGrenade_C")[0] == "Granate"


def test_kein_deutsches_label_in_der_visier_ausgabe():
    from pubg.shot_quality import scope_breakdown  # noqa: F401
    from pubg.shot_quality import SCOPE_ORDER
    # "none" wird beim Ausliefern zu "no sight", nicht "ohne Visier".
    assert "ohne Visier" not in SCOPE_ORDER


def test_ausruestung_im_airdrop_ist_englisch():
    from pubg.telemetry_analysis import DROP_GEAR_LABELS
    werte = set(DROP_GEAR_LABELS.values())
    for d in ("Helm Lv3", "Weste Lv3", "Rucksack Lv3", "Adrenalin"):
        assert d not in werte, d
    assert "Helmet Lv3" in werte and "Vest Lv3" in werte
