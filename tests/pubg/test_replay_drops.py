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


def _flare(ts_iso, x, y, acc="account.A", feld="attacker"):
    """So, wie PUBG es wirklich liefert: der Schuetze steht unter
    `attacker`, nicht unter `character` — ein Schuss ist fuer die
    Telemetrie ein Angriff. Der DB-Weg baut dagegen `character`, also
    muss beides gelesen werden."""
    return {"_T": "LogPlayerUseFlareGun", "_D": ts_iso,
            feld: {"accountId": acc, "name": "PEX_LuCKoR",
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


def test_flare_aus_dem_db_weg_heisst_character():
    """Der DB-Weg baut `character`; beide Formen muessen ankommen."""
    evs, _ = extract_events([
        _flare("2026-09-14T10:05:00.0Z", 400000, 300000, feld="character"),
    ], MAPKM)
    assert len([e for e in evs if e["type"] == "flare"]) == 1


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


def _spawn(ts_iso, x, y, z=30000, items=None, pid="Carapackage_RedBox_C"):
    return {"_T": "LogCarePackageSpawn", "_D": ts_iso,
            "itemPackage": {"itemPackageId": pid,
                            "location": {"x": x, "y": y, "z": z},
                            "items": [{"itemId": i} for i in (items or [])]}}


def test_anflug_und_landung_gehoeren_zusammen():
    """Das Paket faellt senkrecht: Spawn und Landung teilen x/y.

    Nur die Hoehe aendert sich (300 m auf 37 m) ueber rund 50 s. Fuer
    das Replay heisst das: ab dem Spawn faellt es sichtbar, ab der
    Landung liegt es.
    """
    evs, _ = extract_events([
        _spawn("2026-09-14T10:05:00.0Z", 400000, 300000,
               items=["Item_Weapon_Groza_C"]),
        _land("2026-09-14T10:05:50.0Z", 400000, 300000,
              ["Item_Weapon_Groza_C"]),
    ], MAPKM)
    d = _drops(evs)
    assert len(d) == 1, "Spawn und Landung sind EIN Paket, nicht zwei"
    assert d[0]["ts"] == d[0]["landTs"], "ts ist der Landezeitpunkt"
    assert d[0]["spawnTs"] < d[0]["landTs"]
    # 50 Sekunden Fallzeit — daran haengt die Anflug-Darstellung.
    assert d[0]["landTs"] - d[0]["spawnTs"] == 50_000


def test_paket_ohne_spawn_hat_trotzdem_eine_anflugzeit():
    """Aeltere Matches haben nur den Landepunkt — dann wird die uebliche
    Fallzeit angenommen, statt das Paket aus dem Nichts erscheinen zu
    lassen."""
    evs, _ = extract_events([
        _land("2026-09-14T10:05:50.0Z", 400000, 300000, ["Item_Weapon_AWM_C"]),
    ], MAPKM)
    d = _drops(evs)[0]
    assert d["spawnTs"] < d["landTs"]
    assert d["spawnEstimated"] is True


def test_spawn_ohne_landung_zaehlt_als_paket():
    """Sonst fehlt das Paket ganz, obwohl es im Match lag."""
    evs, _ = extract_events([
        _spawn("2026-09-14T10:05:00.0Z", 400000, 300000,
               items=["Item_Weapon_AWM_C"]),
    ], MAPKM)
    d = _drops(evs)
    assert len(d) == 1
    assert d[0]["items"] == ["AWM"]


def test_pakettyp_entscheidet_ob_angefordert():
    """Der Pakettyp sagt es selbst — keine Schaetzung noetig.

    `Carapackage_FlareGun_C` steht in Spawn UND Landung (951 bzw. 382
    Ereignisse in der DB). Meine erste Fassung hat das ueber Ort und
    Zeit erraten, obwohl die Antwort im Event stand.
    """
    evs, _ = extract_events([
        _land("2026-09-14T10:06:00.0Z", 700000, 700000,
              ["Item_Weapon_AWM_C"], pid="Carapackage_FlareGun_C"),
    ], MAPKM)
    d = _drops(evs)[0]
    assert d["called"] is True
    # Ohne Leuchtpistole in Reichweite bleibt offen, WER sie gefeuert hat.
    assert d["calledBy"] is None


def test_regulaeres_paket_bleibt_regulaer_auch_neben_einer_flare():
    """Der Kern des Problems: zwei Pakete landen nebeneinander, eines
    gerufen, eines nicht. Ueber die Position waere beides "gerufen"."""
    evs, _ = extract_events([
        _flare("2026-09-14T10:05:00.0Z", 400000, 300000),
        _land("2026-09-14T10:06:00.0Z", 400500, 300500,
              ["Item_Weapon_AWM_C"], pid="Carapackage_FlareGun_C"),
        _land("2026-09-14T10:06:10.0Z", 401000, 301000,
              ["Item_Weapon_Groza_C"], pid="Carapackage_RedBox_C"),
    ], MAPKM)
    d = _drops(evs)
    nach_typ = {x["packageId"]: x["called"] for x in d}
    assert nach_typ["Carapackage_FlareGun_C"] is True
    assert nach_typ["Carapackage_RedBox_C"] is False
    # Beim gerufenen steht auch der Schuetze dran.
    gerufen = [x for x in d if x["called"]][0]
    assert gerufen["calledBy"] == "account.A"


def test_brdm_ist_kein_paket():
    """Die Leuchtpistole kann auch ein BRDM rufen — das ist ein Fahrzeug
    und gehoert nicht als Versorgungskiste auf die Karte."""
    evs, _ = extract_events([
        _land("2026-09-14T10:06:00.0Z", 400000, 300000, pid="BP_BRDM_C"),
    ], MAPKM)
    assert _drops(evs) == []


def test_alle_zeitstempel_werden_auf_den_matchstart_bezogen():
    """`build_replay` rechnet Zeiten auf 0 = Match-Start um.

    Meine Zusatzfelder blieben dabei absolut (Unix-Millisekunden). Das
    Frontend vergleicht sie gegen den Abspiel-Cursor, der bei 0 beginnt
    — damit lag jedes Paket rund 1,8 Billionen Millisekunden in der
    Zukunft und wurde nie gezeichnet.
    """
    from pubg.replay_builder import build_replay
    roh = [
        {"_T": "LogParachuteLanding", "_D": "2026-09-14T10:00:00.0Z",
         "character": {"accountId": "account.A", "name": "Ich",
                       "location": {"x": 100000, "y": 100000, "z": 100}}},
        _spawn("2026-09-14T10:04:10.0Z", 400000, 300000,
               items=["Item_Weapon_AWM_C"]),
        _land("2026-09-14T10:05:00.0Z", 400000, 300000,
              ["Item_Weapon_AWM_C"]),
        _flare("2026-09-14T10:03:00.0Z", 400000, 300000),
    ]
    r = build_replay(roh, "m1", "Baltic_Main", MAPKM,
                     {"account.A": 1}, {"account.A": "Ich"})
    d = [e for e in r["events"] if e["type"] == "drop"][0]
    f = [e for e in r["events"] if e["type"] == "flare"][0]
    # Alles relativ zum ersten Ereignis, also im Bereich der Spieldauer.
    assert d["ts"] == d["landTs"]
    assert 0 <= d["spawnTs"] < d["landTs"] <= r["durationMs"]
    assert 0 <= f["ts"] <= r["durationMs"]
    # 50 s Fallzeit bleiben 50 s.
    assert d["landTs"] - d["spawnTs"] == 50_000


def test_nur_echte_airdrops_gelten_als_drop():
    """Ein Airdrop kommt am Fallschirm vom Himmel — sonst ist es keiner.

    Gemessen fallen RedBox, SmallPackage, DihorOtok und FlareGun 53-75 s
    lang. Das BRDM aus der Leuchtpistole ist ein Fahrzeug und hat gar
    keinen Spawn, die Bluechip- und NoParachute-Pakete erscheinen am
    Boden. Als Versorgungskiste auf der Karte waren die alle irrefuehrend.
    """
    evs, _ = extract_events([
        _land("2026-09-14T10:05:00.0Z", 400000, 300000, pid="BP_BRDM_C"),
        _land("2026-09-14T10:06:00.0Z", 410000, 310000,
              pid="Carepackage_SmallPackage_NoParachute_Bluechip_C"),
        _land("2026-09-14T10:07:00.0Z", 420000, 320000,
              pid="Carapackage_SmallPackage_NoParachute_C"),
        # Kartenspezifische Massenpakete: auf Taego 49 je Match, auf
        # Vikendi 36. Kein Abwurf, sondern Bodenloot.
        _land("2026-09-14T10:07:30.0Z", 425000, 325000,
              pid="Carapackage_SmallPackage_C"),
        _land("2026-09-14T10:07:40.0Z", 426000, 326000,
              pid="Carapackage_SmallPackage_DihorOtok_C"),
        _land("2026-09-14T10:08:00.0Z", 430000, 330000,
              ["Item_Weapon_AWM_C"], pid="Carapackage_RedBox_C"),
    ], MAPKM)
    d = _drops(evs)
    assert [x["packageId"] for x in d] == ["Carapackage_RedBox_C"]


def test_der_flare_airdrop_bleibt_ein_drop():
    """Nur das BRDM fliegt raus, nicht die gerufene Kiste."""
    evs, _ = extract_events([
        _land("2026-09-14T10:08:00.0Z", 430000, 330000,
              ["Item_Weapon_AWM_C"], pid="Carapackage_FlareGun_C"),
    ], MAPKM)
    d = _drops(evs)
    assert len(d) == 1 and d[0]["called"] is True
