"""Hoechstgeschwindigkeit — insgesamt, je Fahrzeug und je Karte."""
import pytest

from pubg import db_pg
from pubg.aggregations import compute_top_speed


CONN = None
T = None
ICH = "account.A"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _match(mid, karte="Baltic_Main", played_at="2026-09-14T18:00:00Z"):
    db_pg.insert_match(CONN.raw, T, mid, karte, "squad-fpp", False, 1800,
                       played_at, None)
    db_pg.insert_participants(CONN.raw, T, mid, [{
        "account_id": ICH, "name": "PEX_LuCKoR", "team_id": 1, "place": 1,
        "kills": 0, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
        "time_survived": 600, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0,
        "boosts": 0, "team_kills": 0}])
    db_pg.insert_team_mapping(CONN.raw, T, mid,
                              [{"account_id": ICH, "team_id": 1}])


def _fahrt(mid, ts, kmh, vid, acc=ICH, sitz=0):
    """Ein Positions-Event mit Fahrzeug-Zustand. velocity kommt in cm/s."""
    return {"event_type": "Position", "timestamp_ms": ts,
            "actor_account": acc, "target_account": None,
            "actor_x": 1.0, "actor_y": 2.0, "actor_z": 3.0,
            "actor_health": 100.0, "victim_x": None, "victim_y": None,
            "weapon": None, "distance": None, "damage": None,
            "damage_reason": None, "seat_index": sitz, "attachments": None,
            "velocity": kmh / 0.036, "vehicle_id": vid,
            "payload_json": None}


def test_hoechstgeschwindigkeit_je_fahrzeug_und_karte():
    _match("ts1", "Baltic_Main")
    _match("ts2", "Neon_Main")
    db_pg.insert_telemetry_events(CONN.raw, "ts1", [
        _fahrt("ts1", 1000, 120.0, "Dacia_A_01_v2_C"),
        _fahrt("ts1", 2000, 143.0, "Dacia_A_01_v2_C"),
        _fahrt("ts1", 3000, 95.0, "Uaz_B_01_C"),
    ])
    db_pg.insert_telemetry_events(CONN.raw, "ts2", [
        _fahrt("ts2", 1000, 156.0, "BP_Mirado_A_01_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["overall"]["kmh"]) == 156
    assert d["overall"]["vehicleId"] == "BP_Mirado_A_01_C"
    assert d["overall"]["mapName"] == "Neon_Main"

    je_fz = {v["vehicleId"]: round(v["kmh"]) for v in d["perVehicle"]}
    assert je_fz["Dacia_A_01_v2_C"] == 143
    assert je_fz["Uaz_B_01_C"] == 95
    # Absteigend, das Schnellste zuerst.
    assert [round(v["kmh"]) for v in d["perVehicle"]] == [156, 143, 95]

    je_karte = {m["mapName"]: round(m["kmh"]) for m in d["perMap"]}
    assert je_karte == {"Baltic_Main": 143, "Neon_Main": 156}


def test_das_flugzeug_zaehlt_nicht_mit():
    """Sonst gewinnt der Transporter mit 1000+ km/h jeden Rekord."""
    _match("ts3")
    db_pg.insert_telemetry_events(CONN.raw, "ts3", [
        _fahrt("ts3", 1000, 1060.0, "DummyTransportAircraft_C"),
        _fahrt("ts3", 2000, 88.0, "Dacia_A_01_v2_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["overall"]["kmh"]) == 88


def test_fremde_fahrten_zaehlen_nicht_zu_meinem_rekord():
    """Mein Rekord ist meiner — fremde stehen daneben zum Vergleich."""
    _match("ts4")
    db_pg.insert_telemetry_events(CONN.raw, "ts4", [
        _fahrt("ts4", 1000, 150.0, "BP_Mirado_A_01_C", acc="account.FREMD"),
        _fahrt("ts4", 2000, 90.0, "Dacia_A_01_v2_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["overall"]["kmh"]) == 90
    assert round(d["lobby"]["kmh"]) == 150


def test_als_beifahrer_ist_es_nicht_meine_leistung():
    """Der Beifahrer hat dieselbe Geschwindigkeit, aber nicht das Lenkrad."""
    _match("ts6")
    db_pg.insert_telemetry_events(CONN.raw, "ts6", [
        _fahrt("ts6", 1000, 155.0, "BP_Mirado_A_01_C", sitz=2),
        _fahrt("ts6", 2000, 99.0, "Dacia_A_01_v2_C", sitz=0),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["overall"]["kmh"]) == 99


def test_ohne_fahrten_bleibt_es_leer():
    _match("ts5")
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert d["overall"] is None
    assert d["perVehicle"] == [] and d["perMap"] == []
    assert d["lobby"] is None


def test_jedes_gesehene_fahrzeug_hat_einen_namen():
    """Fuer 55 der 109 Ids stand vorher die rohe Id in der Anzeige."""
    from pubg.aggregations import _fahrzeug_label
    # Querschnitt aus den echten Daten, absteigend nach Haeufigkeit.
    ids = [
        "DummyTransportAircraft_C", "RedeployAircraft_Tiger_C",
        "BP_Bicycle_C", "BP_Motorglider_C", "BP_Cayenne_EP_C",
        "BP_DBX_LGD_C", "BP_Porter_C", "BP_Carrera_LGD_C", "MortarPawn_C",
        "TransportAircraft_Chimera_C", "BP_RoadGlideST_LGD_C",
        "BP_Panamera_ULT_C", "BP_Classic_02_C", "BP_ATV_C",
        "BP_Special_Sedan_02_C", "BP_Vantage_EP_C", "BP_Chiron_LGD_C",
        "BP_Dirtbike_C", "BP_Classic_01_C", "BP_Special_Sedan_01_C",
        "BP_Urus_EP_C", "BP_Rubber_boat_C", "BP_M_Rony_A_03_C",
        "BP_Food_Truck_C", "BP_Countach_ULT_C", "BP_Special_FbrBike_C",
        "BP_TukTukTuk_A_01_C", "BP_McLarenGT_St_white_C", "AquaRail_A_01_C",
        "PG117_A_01_C", "BP_PanigaleV4S_EP02_C", "BP_Special_ElSolitario_C",
    ]
    for vid in ids:
        name = _fahrzeug_label(vid)
        assert name and name != "?", vid
        # Kein Rest der Id: weder BP_-Praefix noch _C-Suffix noch
        # Unterstriche duerfen durchschlagen.
        assert "_" not in name and not name.startswith("BP"), (vid, name)


def test_sedan_nennt_sein_basisfahrzeug():
    """Denselben Sedan gibt es auf zwei Basisfahrzeugen — und die fahren
    sich deutlich unterschiedlich."""
    from pubg.aggregations import _fahrzeug_label
    assert _fahrzeug_label("BP_Special_Sedan_01_C") == "Sedan (Dacia)"
    assert _fahrzeug_label("BP_Special_Sedan_02_C") == "Sedan (Mirado)"
    # Ohne belegten Basistyp bleibt es beim reinen Namen.
    assert _fahrzeug_label("BP_Carrera_LGD_C") == "Porsche 911"


def test_neuer_tempo_rekord_wird_gefeiert():
    """Ein Rekord meldet sich nur, wenn er den alten wirklich schlaegt.
    Der Gesamt-Rekord ist seit dem Rekord je Fahrzeug standardmaessig aus;
    eingeschaltet arbeitet er wie bisher."""
    from pubg.weapon_milestones import detect, default_config
    cfg = default_config()
    cfg["career_top_speed"] = {**cfg.get("career_top_speed", {}), "enabled": True}
    vorher = {"career": {"top_speed": 143.0}, "weapons": {}}
    nachher = {"career": {"top_speed": 157.2}, "weapons": {},
               "extra": {"top_speed": {"vehicleName": "Sedan · Mirado",
                                        "mapName": "Neon_Main"}}}
    ids = [m["occasion"] for m in detect(vorher, nachher, cfg)]
    assert "career_top_speed" in ids


def test_langsamer_als_der_rekord_meldet_nichts():
    from pubg.weapon_milestones import detect, default_config
    cfg = default_config()
    vorher = {"career": {"top_speed": 157.2}, "weapons": {}}
    nachher = {"career": {"top_speed": 150.0}, "weapons": {}}
    ids = [m["occasion"] for m in detect(vorher, nachher, cfg)]
    assert "career_top_speed" not in ids


def test_gemuetliches_tempo_ist_kein_rekord():
    """Ohne Untergrenze waere die erste Fahrt ueberhaupt ein Rekord."""
    from pubg.weapon_milestones import OCCASIONS
    assert OCCASIONS["career_top_speed"]["min"] >= 100


def test_das_rettungsfahrzeug_zaehlt_nicht():
    """Der Emergency Pickup traegt einen durch die Luft, gefahren wird er
    nicht — mit 260 km/h waere er sonst ewig der Rekordhalter."""
    _match("ts7")
    db_pg.insert_telemetry_events(CONN.raw, "ts7", [
        _fahrt("ts7", 1000, 259.0, "BP_EmergencyPickupVehicle_C"),
        _fahrt("ts7", 2000, 131.0, "Dacia_A_01_v2_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["overall"]["kmh"]) == 131


def test_spawnvarianten_desselben_autos_sind_eine_zeile():
    """Drei Dacias untereinander sind keine drei Fahrzeuge."""
    _match("ts8")
    db_pg.insert_telemetry_events(CONN.raw, "ts8", [
        _fahrt("ts8", 1000, 120.0, "Dacia_A_01_v2_C"),
        _fahrt("ts8", 2000, 141.0, "Dacia_A_03_v2_Esports_C"),
        _fahrt("ts8", 3000, 133.0, "Dacia_A_02_v2_C"),
        _fahrt("ts8", 4000, 99.0, "Uaz_B_01_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    namen = [v["vehicleName"] for v in d["perVehicle"]]
    assert namen == ["Dacia", "UAZ"]
    assert round(d["perVehicle"][0]["kmh"]) == 141


def test_die_schiessanlage_zaehlt_nicht():
    """Range_Main laeuft als "solo" und faellt damit nicht unter den
    BR-Filter — als Karte im Rekord ist sie trotzdem sinnlos."""
    _match("ts9", "Range_Main")
    db_pg.insert_telemetry_events(CONN.raw, "ts9", [
        _fahrt("ts9", 1000, 140.0, "Dacia_A_01_v2_C"),
    ])
    _match("ts10", "Baltic_Main")
    db_pg.insert_telemetry_events(CONN.raw, "ts10", [
        _fahrt("ts10", 1000, 118.0, "Dacia_A_01_v2_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["overall"]["kmh"]) == 118
    assert [m["mapName"] for m in d["perMap"]] == ["Baltic_Main"]


def test_event_modi_zaehlen_nicht():
    """Deathmatch und Heist sind kein Battle Royale."""
    db_pg.insert_match(CONN.raw, T, "ts11", "Baltic_Main", "tdm", False,
                       600, "2026-09-14T18:00:00Z", None)
    db_pg.insert_participants(CONN.raw, T, "ts11", [{
        "account_id": ICH, "name": "PEX_LuCKoR", "team_id": 1, "place": 1,
        "kills": 0, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
        "time_survived": 600, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0,
        "boosts": 0, "team_kills": 0}])
    db_pg.insert_telemetry_events(CONN.raw, "ts11", [
        _fahrt("ts11", 1000, 160.0, "BP_Mirado_A_01_C"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert d["overall"] is None


def test_lobby_wertung_nennt_den_fahrer():
    """Die Lobby-Bestenliste zaehlt ALLE mit, mich eingeschlossen — dann
    steht bei einem eigenen Rekord der eigene Name da."""
    _match("ts12")
    db_pg.insert_telemetry_events(CONN.raw, "ts12", [
        _fahrt("ts12", 1000, 162.1, "BP_Mirado_A_01_C"),
        _fahrt("ts12", 2000, 161.9, "BP_Mirado_A_02_C", acc="account.X"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert round(d["lobby"]["kmh"], 1) == 162.1
    assert d["lobby"]["driverName"] == "PEX_LuCKoR"
    assert d["lobby"]["isMe"] is True


def test_lobby_bestenliste_je_fahrzeug_und_karte():
    _match("ts13", "Baltic_Main")
    db_pg.insert_telemetry_events(CONN.raw, "ts13", [
        _fahrt("ts13", 1000, 130.0, "Dacia_A_01_v2_C"),
        _fahrt("ts13", 2000, 151.0, "Dacia_A_02_v2_C", acc="account.X"),
    ])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    # Meine Liste kennt nur meine 130 …
    assert [round(v["kmh"]) for v in d["perVehicle"]] == [130]
    # … die Lobby-Liste den Bestwert des Fahrzeugs ueberhaupt.
    assert round(d["lobbyPerVehicle"][0]["kmh"]) == 151
    assert d["lobbyPerVehicle"][0]["isMe"] is False
    assert round(d["lobbyPerMap"][0]["kmh"]) == 151


def test_zeitraum_grenzt_den_report_ein():
    """Im Report zaehlt der gewaehlte Zeitraum — alltime gehoert zum
    Meilenstein, nicht in eine Session-Auswertung."""
    _match("ts14", "Baltic_Main", played_at="2026-06-01T18:00:00Z")
    _match("ts15", "Baltic_Main", played_at="2026-09-14T18:00:00Z")
    db_pg.insert_telemetry_events(CONN.raw, "ts14", [
        _fahrt("ts14", 1000, 160.0, "BP_Mirado_A_01_C")])
    db_pg.insert_telemetry_events(CONN.raw, "ts15", [
        _fahrt("ts15", 1000, 121.0, "Dacia_A_01_v2_C")])
    CONN.raw.commit()
    alles = compute_top_speed(CONN, T, ICH)
    assert round(alles["overall"]["kmh"]) == 160
    eng = compute_top_speed(CONN, T, ICH, from_iso="2026-09-01T00:00:00Z")
    assert round(eng["overall"]["kmh"]) == 121


def test_spitzentempo_vom_aussteigen_schlaegt_die_abtastung():
    """maxSpeed sieht die ganze Fahrt, die Abtastung nur alle 10 s."""
    _match("ts9")
    raus = _fahrt("ts9", 2000, 80.0, "Dacia_A_01_v2_C")
    raus["event_type"] = "VehicleLeave"
    raus["max_speed"] = 151.5
    db_pg.insert_telemetry_events(CONN.raw, "ts9", [
        _fahrt("ts9", 1000, 120.0, "Dacia_A_01_v2_C"), raus])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert d["overall"]["kmh"] == 151.5


def test_bestwert_nennt_die_mitfahrer():
    _match("ts10")
    db_pg.upsert_player(CONN.raw, T, "account.B", "Mate1", "steam", False)
    rein = _fahrt("ts10", 1000, 20.0, "Dacia_A_01_v2_C")
    rein.update(event_type="VehicleEnter", fellow_passengers="[]")
    zu = _fahrt("ts10", 1500, 20.0, "Dacia_A_01_v2_C", acc="account.B", sitz=1)
    zu.update(event_type="VehicleEnter", fellow_passengers='["account.A"]')
    raus = _fahrt("ts10", 9000, 30.0, "Dacia_A_01_v2_C")
    raus.update(event_type="VehicleLeave", fellow_passengers="[]",
                max_speed=140.0)
    db_pg.insert_telemetry_events(CONN.raw, "ts10", [
        rein, zu, _fahrt("ts10", 5000, 120.0, "Dacia_A_01_v2_C"), raus])
    CONN.raw.commit()
    d = compute_top_speed(CONN, T, ICH)
    assert d["overall"]["kmh"] == 140.0
    assert d["overall"]["passengerNames"] == ["Mate1"]


def test_ohne_mitfahrer_daten_bleibt_es_offen():
    _match("ts11")
    db_pg.insert_telemetry_events(CONN.raw, "ts11", [
        _fahrt("ts11", 1000, 120.0, "Dacia_A_01_v2_C")])
    CONN.raw.commit()
    assert compute_top_speed(CONN, T, ICH)["overall"]["passengerNames"] is None



# ── Rekord je Fahrzeug ────────────────────────────────────────────────────

def _detect(vorher, nachher):
    from pubg.weapon_milestones import detect, default_config
    return detect(vorher, nachher, default_config())


def test_gesamt_rekord_ist_standardmaessig_aus():
    """Der Rekord je Fahrzeug ersetzt ihn — sonst feierte ein neuer
    Bestwert zweimal."""
    from pubg.weapon_milestones import default_config
    assert default_config()["career_top_speed"]["enabled"] is False


def test_rekord_je_fahrzeug_feiert_nur_das_fahrzeug():
    vorher = {"career": {}, "weapons": {},
              "vehicles": {"Mirado": {"top_speed": 163.4},
                           "Dacia": {"top_speed": 154.0}}}
    nachher = {"career": {}, "weapons": {},
               "vehicles": {"Mirado": {"top_speed": 163.4},
                            "Dacia": {"top_speed": 156.1}},
               "extra": {"vehicles": {"Dacia": {"mapName": "Baltic_Main",
                                                "lobbyKmh": 171.2,
                                                "lobbyDriver": "Someone"}}}}
    got = [m for m in _detect(vorher, nachher)
           if m["occasion"] == "vehicle_top_speed"]
    assert [m["subject"] for m in got] == ["Dacia"]
    assert got[0]["value"] == 156.1 and got[0]["prev_value"] == 154.0
    assert got[0]["extra"]["mapName"] == "Baltic_Main"
    assert got[0]["display"] == "Dacia"


def test_fremder_lobby_rekord_feiert_nichts():
    """Nur der eigene Wert zaehlt; die Lobby steht bloss als Info dabei."""
    vorher = {"career": {}, "weapons": {},
              "vehicles": {"Motorbike": {"top_speed": 159.3}}}
    nachher = {"career": {}, "weapons": {},
               "vehicles": {"Motorbike": {"top_speed": 159.3}},
               "extra": {"vehicles": {"Motorbike": {"lobbyKmh": 184.8}}}}
    assert not [m for m in _detect(vorher, nachher)
                if m["occasion"] == "vehicle_top_speed"]


def test_neues_fahrzeug_ist_bestandsaufnahme_kein_rekord():
    vorher = {"career": {}, "weapons": {},
              "vehicles": {"Mirado": {"top_speed": 163.4}}}
    nachher = {"career": {}, "weapons": {},
               "vehicles": {"Mirado": {"top_speed": 163.4},
                            "Buggy": {"top_speed": 121.0}}}
    assert not [m for m in _detect(vorher, nachher)
                if m["occasion"] == "vehicle_top_speed"]


def test_erster_stand_mit_fahrzeugen_feiert_nichts():
    """Nach dem Deploy hat der alte Stand noch keine Fahrzeuge — das ist
    kein Rekord fuer jedes Fahrzeug auf einmal."""
    vorher = {"career": {"top_speed": 163.4}, "weapons": {"M416": {"kills": 1}}}
    nachher = {"career": {"top_speed": 163.4}, "weapons": {"M416": {"kills": 1}},
               "vehicles": {"Mirado": {"top_speed": 163.4}}}
    assert not [m for m in _detect(vorher, nachher)
                if m["occasion"] == "vehicle_top_speed"]


def test_unter_der_untergrenze_kein_rekord():
    vorher = {"career": {}, "weapons": {},
              "vehicles": {"Bicycle": {"top_speed": 30.0}}}
    nachher = {"career": {}, "weapons": {},
               "vehicles": {"Bicycle": {"top_speed": 41.0}}}
    assert not [m for m in _detect(vorher, nachher)
                if m["occasion"] == "vehicle_top_speed"]


def test_stand_traegt_fahrzeuge_mit_lobby_info():
    """collect: je Fahrzeug der eigene Bestwert, dazu Karte und
    Lobby-Bestwert desselben Fahrzeugs als Begleitinfo."""
    from pubg.poller import _vehicle_records
    tempo = {
        "perVehicle": [{"vehicleName": "Mirado", "kmh": 163.4,
                        "mapName": "Baltic_Main", "isMe": True}],
        "lobbyPerVehicle": [{"vehicleName": "Mirado", "kmh": 171.0,
                             "driverName": "X", "isMe": False}],
    }
    vehicles, extra = _vehicle_records(tempo)
    assert vehicles == {"Mirado": {"top_speed": 163.4}}
    assert extra["Mirado"] == {"mapName": "Baltic_Main", "lobbyKmh": 171.0,
                               "lobbyDriver": "X"}
