"""Match-Detail gegen Postgres (der produktive Pfad).

Frueher gegen pubg/db.py (SQLite) — seit der PG-Migration deprecated.
Die Schreib-Helfer binden die tenant_id, damit die Testkoerper
unveraendert bleiben konnten.
"""
import json

import pytest

from pubg import db_pg
from pubg.aggregations import compute_match_detail


CONN = None
T = None


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def upsert_player(conn, account_id, name, platform, is_self=False):
    db_pg.upsert_player(conn.raw, T, account_id, name, platform,
                        1 if is_self else 0)


def insert_match(conn, match_id, map_name, mode, is_ranked, duration,
                 played_at, telemetry_url):
    db_pg.insert_match(conn.raw, T, match_id, map_name, mode, is_ranked,
                       duration, played_at, telemetry_url)


def insert_participants(conn, match_id, rows):
    db_pg.insert_participants(conn.raw, T, match_id, rows)


def insert_team_mapping(conn, match_id, rows):
    db_pg.insert_team_mapping(conn.raw, T, match_id, rows)


def insert_telemetry_events(conn, match_id, events):
    db_pg.insert_telemetry_events(conn.raw, match_id, events)


def _setup(_unused=None):
    upsert_player(CONN, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_player(CONN, "account.B", "Mate1", "steam", False)
    return CONN


def _basic_match(conn, mid="m1", played_at="2026-05-15T18:00:00Z"):
    insert_match(conn, mid, "Baltic_Main", "squad-fpp", False, 1800, played_at, None)
    parts = []
    for acc, name in (("account.A", "PEX_LuCKoR"), ("account.B", "Mate1")):
        parts.append({
            "account_id": acc, "name": name, "team_id": 1,
            "place": 5, "kills": 2, "headshot_kills": 0, "assists": 0,
            "dbnos": 0, "revives": 0, "damage_dealt": 200.0,
            "longest_kill": 10.0, "time_survived": 600,
            "walk_distance": 0, "ride_distance": 0, "swim_distance": 0,
            "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0,
        })
    insert_participants(conn, mid, parts)
    insert_team_mapping(conn, mid, [
        {"account_id": "account.A", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
        {"account_id": "account.B", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
    ])
    return mid


def test_lives_single_life_wraps_landing_and_death():
    """Standard-Match (1 Leben): lives[0] enthaelt Landing+Death+Kills."""
    conn = _setup()
    mid = _basic_match(conn)
    events = [
        # Plane-Cruise erreicht (z>=150000) bei ts=5000
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Landing bei ts=60000
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Position danach
        {"event_type": "Position", "timestamp_ms": 120000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 210000.0, "actor_y": 215000.0, "actor_z": 80.0,
         "actor_health": 90.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Kill durch Member
        {"event_type": "Kill", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": "account.ENEMY1",
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 251000.0, "victim_y": 260500.0,
         "weapon": "WeapHK416_C", "distance": 1500.0, "damage": 100.0,
         "payload_json": None},
        # Death des Members
        {"event_type": "Kill", "timestamp_ms": 700000,
         "actor_account": "account.ENEMY2", "target_account": "account.A",
         "actor_x": 290000.0, "actor_y": 295000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 290500.0, "victim_y": 295200.0,
         "weapon": "WeapBerylM762_C", "distance": 800.0, "damage": 95.0,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, T, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert "lives" in me, "members[].lives field fehlt"
    assert len(me["lives"]) == 1
    life = me["lives"][0]
    assert life["lifeIndex"] == 1
    # Landing
    assert life["landing"]["x"] == 200000.0
    assert life["landing"]["y"] == 200000.0
    assert life["landing"]["tsMs"] == 60000
    # Death
    assert life["death"] is not None
    assert life["death"]["x"] == 290500.0  # victim coords
    assert life["death"]["y"] == 295200.0
    assert life["death"]["weaponId"] == "WeapBerylM762_C"
    assert life["death"]["weaponName"] == "Beryl"  # via _weapon_label
    assert life["death"]["distanceM"] == 8.0  # 800cm / 100
    # Kills in diesem Leben
    assert len(life["kills"]) == 1
    assert life["kills"][0]["actorX"] == 250000.0
    assert life["kills"][0]["victimX"] == 251000.0
    # Pfade
    assert len(life["planeRoute"]) >= 1
    # planeRoute geht von cruise+3s (=8000ms) bis Landing (60000ms)
    for pt in life["planeRoute"]:
        assert pt[2] >= 8000 and pt[2] <= 60000
    # groundPath von Landing (60000) bis Death (700000)
    assert len(life["groundPath"]) >= 1
    for pt in life["groundPath"]:
        assert pt[2] >= 60000 and pt[2] <= 700000


def test_lives_survival_has_no_death():
    """Member ueberlebt: lives[0].death == None."""
    conn = _setup()
    mid = _basic_match(conn)
    events = [
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 600000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 80.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, T, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert len(me["lives"]) == 1
    assert me["lives"][0]["death"] is None


def test_lives_comeback_creates_two_lives():
    """Comeback-Modus: nach Death im selben Match wieder Plane+Landing.
    lives[0] = erstes Leben (mit Death), lives[1] = zweites Leben."""
    conn = _setup()
    mid = _basic_match(conn)
    events = [
        # Leben 1: Plane → Landing → Death
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Kill", "timestamp_ms": 400000,
         "actor_account": "account.ENEMY1", "target_account": "account.A",
         "actor_x": 220000.0, "actor_y": 220000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 220500.0, "victim_y": 220500.0,
         "weapon": "WeapHK416_C", "distance": 500.0, "damage": 100.0,
         "payload_json": None},
        # Comeback: Leben 2 — neue Plane-Cruise + Landing
        {"event_type": "Position", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 300000.0, "actor_y": 300000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 550000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 400000.0, "actor_y": 400000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 700000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 410000.0, "actor_y": 410000.0, "actor_z": 100.0,
         "actor_health": 70.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, T, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert len(me["lives"]) == 2, f"Erwarte 2 Lives, bekommen {len(me['lives'])}"
    l1, l2 = me["lives"]
    assert l1["lifeIndex"] == 1 and l2["lifeIndex"] == 2
    # Leben 1: Death bei 400000
    assert l1["death"] is not None
    assert l1["death"]["tsMs"] == 400000
    # Leben 2: Landing bei 550000, kein Death (survived)
    assert l2["landing"]["tsMs"] == 550000
    assert l2["death"] is None


def test_path_timestamps_inside_lives():
    """Pfade in lives[].planeRoute und lives[].groundPath sind
    [x, y, ts_ms] 3-Tupel und chronologisch sortiert."""
    conn = _setup()
    mid = _basic_match(conn)
    events = [
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 30000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 150000.0, "actor_y": 150000.0, "actor_z": 100000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 120000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 210000.0, "actor_y": 210000.0, "actor_z": 80.0,
         "actor_health": 90.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, T, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    life = me["lives"][0]
    for pt in life["planeRoute"]:
        assert len(pt) == 3
        assert isinstance(pt[2], int)
    for pt in life["groundPath"]:
        assert len(pt) == 3
        assert isinstance(pt[2], int)
    pr_ts = [pt[2] for pt in life["planeRoute"]]
    gp_ts = [pt[2] for pt in life["groundPath"]]
    assert pr_ts == sorted(pr_ts)
    assert gp_ts == sorted(gp_ts)


def _ev(et, ts, actor=None, target=None, weapon=None, damage=None,
        reason=None, vx=1000.0, vy=1000.0):
    """Telemetrie-Zeile mit allen Pflichtfeldern."""
    return {"event_type": et, "timestamp_ms": ts, "actor_account": actor,
            "target_account": target, "actor_x": 900.0, "actor_y": 900.0,
            "actor_z": 100.0, "actor_health": 100.0, "victim_x": vx,
            "victim_y": vy, "weapon": weapon, "distance": 500.0,
            "damage": damage, "damage_reason": reason, "payload_json": None}


def _typ_of(conn, mid, ziel):
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    treffer = [e for e in (d.get("events") or [])
               if e.get("targetName") == ziel]
    assert treffer, f"kein Event fuer {ziel} in der Timeline"
    return treffer[-1]


def test_ueberfahren_ist_kein_absprung():
    """`Damage_VehicleHit` heisst ueberfahren — nicht "rausgesprungen".

    Der Fahrer steht als Akteur im Event; als Umgebungstod gewertet ging
    er verloren und die Zeile behauptete "died after jumping".
    """
    conn = _setup()
    mid = _basic_match(conn, "mv1")
    insert_telemetry_events(conn, mid, [
        _ev("Landing", 60000, actor="account.A"),
        _ev("TakeDamage", 700000, actor="account.E", target="account.A",
            weapon="Uaz_B_01_esports_C", damage=15.3),
        _ev("Kill", 700002, actor="account.E", target="account.A",
            weapon="Uaz_B_01_esports_C", reason="Damage_VehicleHit"),
    ])
    ev = _typ_of(conn, mid, "PEX_LuCKoR")
    assert ev["type"] == "kill_run_over"
    # Der Fahrer muss erhalten bleiben — das ist ein Spieler-Kill.
    assert ev["actorAccount"] == "account.E"
    assert ev["vehicleLabel"] == "UAZ"


def test_geknockt_und_squad_faellt_ist_kein_ausbluten():
    """Stirbt der letzte stehende Mate, stirbt der Geknockte sofort mit.

    Das ist kein Ausbluten — es sah nur so aus, weil in beiden Faellen
    kein weiterer Schaden mehr kommt.
    """
    conn = _setup()
    mid = _basic_match(conn, "mw1")
    insert_telemetry_events(conn, mid, [
        _ev("Landing", 60000, actor="account.A"),
        _ev("Knock", 700000, actor="account.E", target="account.A",
            weapon="WeapHK416_C", damage=30.0),
        # Der letzte lebende Mate faellt — und damit sofort auch ich.
        _ev("Kill", 705000, actor="account.E", target="account.B",
            weapon="WeapHK416_C", reason="Damage_Gun"),
        _ev("Kill", 705100, actor="account.E", target="account.A"),
    ])
    ev = _typ_of(conn, mid, "PEX_LuCKoR")
    assert ev["type"] == "kill_squad_wiped"


def test_ausbluten_bleibt_ausbluten_solange_wer_lebt():
    """Die Gegenprobe: lebt noch ein Mate, ist es echtes Ausbluten."""
    conn = _setup()
    mid = _basic_match(conn, "mw2")
    insert_telemetry_events(conn, mid, [
        _ev("Landing", 60000, actor="account.A"),
        _ev("Knock", 700000, actor="account.E", target="account.A",
            weapon="WeapHK416_C", damage=30.0),
        # Mate1 stirbt erst viel spaeter — ich blute vorher aus.
        _ev("Kill", 705100, actor="account.E", target="account.A"),
        _ev("Kill", 900000, actor="account.E", target="account.B",
            weapon="WeapHK416_C", reason="Damage_Gun"),
    ])
    ev = _typ_of(conn, mid, "PEX_LuCKoR")
    assert ev["type"] == "kill_bleedout"


def _fahrt_match(conn, mid="mf1"):
    """Zwei Mates in EINEM Auto: account.A faehrt, account.B sitzt daneben.

    Die Kurve ist absichtlich keine Gerade — nur so faellt auf, ob der
    Beifahrer die echte Strecke bekommt oder quer ueber die Karte
    abgekuerzt wird.
    """
    _basic_match(conn, mid)
    evs = []
    # Ohne Flughoehe (z >= 150000) erkennt der Code kein Leben und
    # verwirft das ganze Segment.
    for acc in ("account.A", "account.B"):
        e = _ev("Position", 5000, actor=acc)
        e["actor_z"] = 160000.0
        evs.append(e)
    evs += [_ev("Landing", 60000, actor="account.A"),
            _ev("Landing", 60000, actor="account.B")]
    # Beide steigen ein: Sitz 0 = Fahrer.
    for acc, seat in (("account.A", 0), ("account.B", 1)):
        e = _ev("VehicleEnter", 100000, actor=acc, weapon="Uaz_B_01_C")
        e["seat_index"] = seat
        evs.append(e)
    # Fahrtstrecke als Bogen. Der Fahrer loggt bei geraden, der
    # Beifahrer bei ungeraden Sekunden — zusammen ergibt das die dichte
    # Spur, die beide teilen.
    kurve = [(1000.0, 1000.0), (2000.0, 1200.0), (3000.0, 1800.0),
             (3500.0, 2800.0), (3400.0, 3900.0), (2900.0, 4800.0)]
    for i, (x, y) in enumerate(kurve):
        acc = "account.A" if i % 2 == 0 else "account.B"
        e = _ev("Position", 110000 + i * 10000, actor=acc)
        e["actor_x"], e["actor_y"] = x, y
        evs.append(e)
    for acc in ("account.A", "account.B"):
        e = _ev("VehicleLeave", 180000, actor=acc, weapon="Uaz_B_01_C")
        e["actor_x"], e["actor_y"] = 2900.0, 4800.0
        evs.append(e)
    insert_telemetry_events(conn, mid, evs)
    return mid


def _pfad(conn, mid, name):
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    mem = next(m for m in d["members"] if m["name"] == name)
    return mem["lives"][0]["groundPath"]


def test_beifahrer_bekommt_die_echte_fahrstrecke():
    """Der Beifahrer war im selben Auto — also auf derselben Strecke.

    Vorher liess der Code Mitfahrern bewusst eine Luecke, damit auf der
    Karte nur die Fahrerlinie erscheint. Auf der Karte wurde daraus aber
    keine Luecke, sondern eine schnurgerade Linie quer durch die
    Landschaft: die Verbindung der beiden Punkte VOR und NACH der Fahrt.
    """
    conn = _setup()
    mid = _fahrt_match(conn)
    fahrt = [p for p in _pfad(conn, mid, "Mate1") if 100000 <= p[2] <= 180000]
    # Alle sechs Kurvenpunkte, nicht nur die eigenen drei.
    assert len(fahrt) >= 6, f"Beifahrer hat nur {len(fahrt)} Punkte"
    knick = (3500.0, 2800.0)
    assert any(abs(p[0] - knick[0]) < 1 and abs(p[1] - knick[1]) < 1
               for p in fahrt), "der Scheitel der Kurve fehlt"


def test_fahrer_und_beifahrer_fahren_dieselbe_strecke():
    """Gleiches Auto, gleiche Strecke — die Spuren muessen sich decken."""
    conn = _setup()
    mid = _fahrt_match(conn)
    def _strecke(name):
        return sorted((round(p[0], 1), round(p[1], 1))
                      for p in _pfad(conn, mid, name)
                      if 100000 <= p[2] <= 180000)
    fahrer = _strecke("PEX_LuCKoR")
    assert len(fahrer) >= 6, "schon der Fahrer hat die Strecke nicht"
    assert _strecke("Mate1") == fahrer


def _drop_match(conn, mid="md1", mit_flare=True):
    """Ein Match mit Airdrop: gelandetes Paket + Pickup daraus."""
    _basic_match(conn, mid)
    evs = []
    for acc in ("account.A", "account.B"):
        e = _ev("Position", 5000, actor=acc)
        e["actor_z"] = 160000.0
        evs.append(e)
        evs.append(_ev("Landing", 60000, actor=acc))
    typ = "Carapackage_FlareGun_C" if mit_flare else "Carapackage_RedBox_C"
    if mit_flare:
        evs.append(_ev("FlareGun", 100000, actor="account.A",
                       weapon="Item_Weapon_FlareGun_C"))
    # Das Paket landet — hier steht der VOLLE Inhalt drin.
    land = _ev("CarePackageLand", 120000, weapon=typ)
    land["actor_x"], land["actor_y"] = 5000.0, 5000.0
    land["attachments"] = json.dumps([
        "Item_Weapon_Groza_C", "Item_Armor_C_01_Lv3_C",
        "Item_Head_G_01_Lv3_C", "Item_Ammo_762mm_C"])
    evs.append(land)
    # Ich nehme nur den Helm mit — die Groza bleibt liegen.
    pick = _ev("CarePackagePickup", 130000, actor="account.A",
               weapon="Item_Head_G_01_Lv3_C")
    pick["actor_x"], pick["actor_y"] = 5000.0, 5000.0
    pick["attachments"] = typ
    evs.append(pick)
    insert_telemetry_events(conn, mid, evs)
    return mid


def test_timelog_zeigt_den_ganzen_drop_inhalt():
    """Was drin lag zaehlt, nicht nur was ich mitgenommen habe.

    Der Inhalt steht im Land-Event; das Pickup-Event traegt nur das
    einzelne Item und den Pakettyp.
    """
    conn = _setup()
    mid = _drop_match(conn)
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    ev = next(e for e in d["events"] if e["type"] == "airdrop_looted")
    assert ev["actorName"] == "PEX_LuCKoR"
    assert ev["dropCalled"] is True          # per Flare angefordert
    # Die Groza lag drin, obwohl ich sie nicht genommen habe.
    assert "Groza" in " ".join(ev["dropContents"])
    assert ev["takenItem"] == "Level 3 Helmet"


def test_gleiche_items_werden_zusammengefasst():
    """Dreimal dieselbe Munition ist "3x", nicht dreimal derselbe Eintrag."""
    conn = _setup()
    mid = _basic_match(conn, "md3")
    evs = []
    for acc in ("account.A", "account.B"):
        e = _ev("Position", 5000, actor=acc)
        e["actor_z"] = 160000.0
        evs.append(e)
        evs.append(_ev("Landing", 60000, actor=acc))
    land = _ev("CarePackageLand", 120000, weapon="Carapackage_RedBox_C")
    land["actor_x"], land["actor_y"] = 5000.0, 5000.0
    land["attachments"] = json.dumps([
        "Item_Weapon_Groza_C", "Item_Ammo_762mm_C", "Item_Ammo_762mm_C",
        "Item_Ammo_762mm_C", "Item_Head_G_01_Lv3_C"])
    evs.append(land)
    for i in range(2):
        pick = _ev("CarePackagePickup", 130000 + i, actor="account.A",
                   weapon="Item_Ammo_762mm_C")
        pick["actor_x"], pick["actor_y"] = 5000.0, 5000.0
        pick["attachments"] = "Carapackage_RedBox_C"
        evs.append(pick)
    insert_telemetry_events(conn, mid, evs)
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    ev = next(e for e in d["events"] if e["type"] == "airdrop_looted")
    assert ev["dropContents"] == ["Groza", "3x 7.62mm Ammo",
                                  "Level 3 Helmet"]
    assert ev["takenItems"] == ["2x 7.62mm Ammo"]


def test_regulaerer_drop_ist_nicht_angefordert():
    conn = _setup()
    mid = _drop_match(conn, "md2", mit_flare=False)
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    ev = next(e for e in d["events"] if e["type"] == "airdrop_looted")
    assert ev["dropCalled"] is False


def test_flare_taucht_als_eigene_zeile_auf():
    conn = _setup()
    mid = _drop_match(conn)
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    ev = next(e for e in d["events"] if e["type"] == "flare_fired")
    assert ev["actorName"] == "PEX_LuCKoR"


def test_wirkungsloser_treffer_verdeckt_den_squad_wipe_nicht():
    """Ein Treffer mit damage=0 hat niemanden getoetet.

    PUBG zaehlt Treffer auf einen bereits liegenden Spieler mit 0
    Schaden. Solange die als "da kam noch was" galten, sah jeder
    Squad-Wipe wie ein normaler Kill aus — dabei starb der Geknockte,
    weil sein letzter Mate fiel, nicht durch diesen Streifschuss.
    """
    conn = _setup()
    mid = _basic_match(conn, "mw3")
    insert_telemetry_events(conn, mid, [
        _ev("Landing", 60000, actor="account.A"),
        _ev("Knock", 700000, actor="account.E", target="account.A",
            weapon="WeapP90_C", damage=30.0),
        # Nachschuss auf den Liegenden — ohne jede Wirkung, und dicht
        # genug am Tod, dass die Finisher-Suche ihn ueberhaupt sieht.
        _ev("TakeDamage", 704800, actor="account.E", target="account.A",
            weapon="WeapP90_C", damage=0.0),
        _ev("Kill", 705000, actor="account.E", target="account.B",
            weapon="WeapP90_C", reason="Damage_Gun"),
        _ev("Kill", 705100, actor="account.E", target="account.A",
            weapon="WeapP90_C", reason="Damage_Gun"),
    ])
    ev = _typ_of(conn, mid, "PEX_LuCKoR")
    assert ev["type"] == "kill_squad_wiped"


def test_echter_nachschuss_bleibt_ein_kill():
    """Die Gegenprobe: wer wirklich trifft, hat auch erledigt."""
    conn = _setup()
    mid = _basic_match(conn, "mw4")
    insert_telemetry_events(conn, mid, [
        _ev("Landing", 60000, actor="account.A"),
        _ev("Knock", 700000, actor="account.E", target="account.A",
            weapon="WeapP90_C", damage=30.0),
        _ev("TakeDamage", 705050, actor="account.E", target="account.A",
            weapon="WeapP90_C", damage=25.0),
        _ev("Kill", 705000, actor="account.E", target="account.B",
            weapon="WeapP90_C", reason="Damage_Gun"),
        _ev("Kill", 705100, actor="account.E", target="account.A",
            weapon="WeapP90_C", reason="Damage_Gun"),
    ])
    ev = _typ_of(conn, mid, "PEX_LuCKoR")
    assert ev["type"] == "kill"


def _zwei_autos_match(conn, mid="mz1"):
    """Vier Mates, ZWEI gleiche Dacias, entgegengesetzte Richtungen.

    A+B fahren nach Osten, C+D nach Westen. Beide Autos haben dieselbe
    Fahrzeug-Id — die Telemetrie kennt keine Instanz-Nummer, das Feld
    `vehicleUniqueId` ist durchgehend leer.
    """
    insert_match(conn, mid, "Baltic_Main", "squad-fpp", False, 1800,
                 "2026-09-18T18:00:00Z", None)
    parts, mapping = [], []
    for acc, name in (("account.A", "PEX_LuCKoR"), ("account.B", "Mate1"),
                      ("account.C", "Mate2"), ("account.D", "Mate3")):
        parts.append({
            "account_id": acc, "name": name, "team_id": 1, "place": 3,
            "kills": 0, "headshot_kills": 0, "assists": 0, "dbnos": 0,
            "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
            "time_survived": 900, "walk_distance": 0.0,
            "ride_distance": 0.0, "swim_distance": 0.0,
            "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0})
        mapping.append({"account_id": acc, "team_id": 1})
    insert_participants(conn, mid, parts)
    insert_team_mapping(conn, mid, mapping)

    evs = []
    for acc in ("account.A", "account.B", "account.C", "account.D"):
        e = _ev("Position", 5000, actor=acc)
        e["actor_z"] = 160000.0
        evs.append(e)
        evs.append(_ev("Landing", 60000, actor=acc))
    # Beide Autos: gleiche Klasse, gleicher Zeitraum.
    for acc, seat in (("account.A", 0), ("account.B", 1),
                      ("account.C", 0), ("account.D", 1)):
        e = _ev("VehicleEnter", 100000, actor=acc, weapon="Dacia_A_01_v2_C")
        e["seat_index"] = seat
        e["actor_x"] = 10000.0 if acc in ("account.A", "account.B") else 90000.0
        e["actor_y"] = 50000.0
        evs.append(e)
    # Auto 1 faehrt nach Osten, Auto 2 nach Westen — weit auseinander.
    for i in range(6):
        ts = 110000 + i * 10000
        for acc, start, richtung in (("account.A", 10000.0, +1),
                                     ("account.B", 10000.0, +1),
                                     ("account.C", 90000.0, -1),
                                     ("account.D", 90000.0, -1)):
            e = _ev("Position", ts + (0 if acc in ("account.A", "account.C")
                                      else 1000), actor=acc)
            e["actor_x"] = start + richtung * (i + 1) * 5000.0
            e["actor_y"] = 50000.0
            evs.append(e)
    for acc in ("account.A", "account.B", "account.C", "account.D"):
        e = _ev("VehicleLeave", 180000, actor=acc, weapon="Dacia_A_01_v2_C")
        e["actor_x"] = (40000.0 if acc in ("account.A", "account.B")
                        else 60000.0)
        e["actor_y"] = 50000.0
        evs.append(e)
    insert_telemetry_events(conn, mid, evs)
    return mid


def test_zwei_gleiche_autos_vermischen_die_pfade_nicht():
    """Der gemeldete Fehler: Wer im zweiten Dacia sitzt, bekam den Pfad
    des ersten — die Karte zeigte Striche quer durchs Bild.

    Zusammengefuehrt wird ueber die Fahrzeug-Id, und die ist bei zwei
    gleichen Autos identisch. Erst die Position trennt sie.
    """
    conn = _setup()
    upsert_player(conn, "account.C", "Mate2", "steam", False)
    upsert_player(conn, "account.D", "Mate3", "steam", False)
    mid = _zwei_autos_match(conn)
    d = compute_match_detail(conn, T, "account.A", mid) or {}
    pfade = {m["name"]: [p for p in (m["lives"][0]["groundPath"] or [])
                         if 100000 <= p[2] <= 180000]
             for m in d["members"] if m["lives"]}
    # Auto 1 faehrt nach Osten: alle x-Werte steigen ueber 10000.
    for name in ("PEX_LuCKoR", "Mate1"):
        xs = [p[0] for p in pfade[name]]
        assert xs, name
        assert max(xs) > 20000, (name, max(xs))
        assert min(xs) >= 9000, (name, min(xs))
    # Auto 2 faehrt nach Westen: die x-Werte fallen unter 90000, und
    # niemand aus Auto 2 darf im Osten auftauchen.
    for name in ("Mate2", "Mate3"):
        xs = [p[0] for p in pfade[name]]
        assert xs, name
        assert min(xs) < 80000, (name, min(xs))
        assert min(xs) > 50000, (name, min(xs))
