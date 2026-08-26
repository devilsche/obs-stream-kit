"""Telemetrie-Analyse — reine Funktionen auf der Event-Liste.

Kein DB- und kein Netz-Zugriff: analyse() bekommt die Events als Liste und
gibt das fertige Ergebnis zurueck. Deshalb laufen diese Tests ohne die
Postgres-Fixture.
"""
import pytest

from pubg.telemetry_analysis import analyse, normalize_weapon


def _attack(name, weapon="Item_Weapon_ACE32_C", t="2026-07-26T23:11:58Z", aid=None):
    return {"_T": "LogPlayerAttack", "attackType": "Weapon", "_D": t,
            "attackId": aid,
            "attacker": {"name": name, "accountId": "account." + name},
            "weapon": {"itemId": weapon}}


def _damage(attacker, victim, reason="TorsoShot", weapon="WeapACE32_C",
            damage=30.0, wall=False, cat="Damage_Gun",
            ax=100.0, ay=100.0, vx=100.0, vy=1100.0, victim_acc=None, aid=None):
    return {"_T": "LogPlayerTakeDamage", "damageTypeCategory": cat,
            "attackId": aid,
            "damageReason": reason, "damage": damage,
            "damageCauserName": weapon, "isThroughPenetrableWall": wall,
            "attacker": {"name": attacker, "accountId": "account." + attacker,
                         "location": {"x": ax, "y": ay}},
            "victim": {"name": victim,
                       "accountId": victim_acc or ("account." + victim),
                       "location": {"x": vx, "y": vy}}}


def _kill(killer, victim, weapon="WeapACE32_C", distance=2500.0,
          reason="HeadShot", t="2026-07-26T23:12:41Z", kx=350.0, ky=400.0):
    return {"_T": "LogPlayerKillV2", "_D": t,
            "killer": {"name": killer, "accountId": "account." + killer,
                       "teamId": 19, "location": {"x": kx, "y": ky}},
            "victim": {"name": victim, "accountId": "account." + victim,
                       "teamId": 4, "location": {"x": kx, "y": ky}},
            "killerDamageInfo": {"damageCauserName": weapon,
                                 "distance": distance, "damageReason": reason}}


# ── Waffen-Normalisierung ───────────────────────────────────────────────────

def test_normalize_weapon_unifies_both_spellings():
    """Attack-Events nennen die Waffe anders als Damage-Events. Ohne
    Normalisierung laesst sich keine Trefferquote pro Waffe bilden."""
    assert normalize_weapon("Item_Weapon_ACE32_C") == "ACE32"
    assert normalize_weapon("WeapACE32_C") == "ACE32"
    assert normalize_weapon("Item_Weapon_ACE32_C") == normalize_weapon("WeapACE32_C")


def test_normalize_weapon_survives_junk():
    assert normalize_weapon(None) is None
    assert normalize_weapon("") is None
    # Fahrzeuge/Umwelt tauchen als damageCauserName auf — unveraendert lassen
    assert normalize_weapon("Dacia_A_03_v2_C") == "Dacia_A_03_v2"


# ── Kernkennzahlen ──────────────────────────────────────────────────────────

def test_accuracy_counts_shots_and_hits():
    ev = [_attack("A") for _ in range(10)]
    ev += [_damage("A", "B") for _ in range(4)]
    p = analyse(ev)["players"]["A"]
    assert p["shots"] == 10
    assert p["hits"] == 4
    assert p["accuracy"] == pytest.approx(40.0)


def test_selfharm_and_teammates_do_not_count_as_hits():
    """Selbstschaden verfaelscht die Trefferquote."""
    ev = [_attack("A"), _damage("A", "A")]
    p = analyse(ev)["players"]["A"]
    assert p["hits"] == 0


def test_only_gun_damage_counts():
    """Zonen-, Sturz- und Fahrzeugschaden ist keine Zielleistung."""
    ev = [_attack("A"), _damage("A", "B", cat="Damage_BlueZone")]
    p = analyse(ev)["players"]["A"]
    assert p["hits"] == 0


def test_hit_zones_are_reported_in_full():
    """Nicht nur Headshots — die ganze Zonenverteilung traegt die Aussage."""
    ev = [_attack("A") for _ in range(10)]
    ev += [_damage("A", "B", reason="HeadShot"),
           _damage("A", "B", reason="TorsoShot"),
           _damage("A", "B", reason="TorsoShot"),
           _damage("A", "B", reason="ArmShot"),
           _damage("A", "B", reason="LegShot")]
    p = analyse(ev)["players"]["A"]
    assert p["zones"] == {"HeadShot": 1, "TorsoShot": 2, "ArmShot": 1, "LegShot": 1}
    assert p["headshotRate"] == pytest.approx(20.0)
    assert p["zonePct"]["TorsoShot"] == pytest.approx(40.0)


def test_wallbangs_are_counted():
    ev = [_attack("A"), _damage("A", "B", wall=True), _damage("A", "B")]
    assert analyse(ev)["players"]["A"]["wallbangs"] == 1


def test_bot_and_human_hits_are_separated():
    """Treffer auf Bots sagen wenig ueber Zielleistung — getrennt ausweisen."""
    ev = [_attack("A"), _attack("A"),
          _damage("A", "Bot1", victim_acc="ai.123"),
          _damage("A", "Human1")]
    p = analyse(ev)["players"]["A"]
    assert p["hitsOnBots"] == 1
    assert p["hitsOnHumans"] == 1


def test_weapon_breakdown_joins_shots_and_hits():
    ev = [_attack("A", "Item_Weapon_ACE32_C") for _ in range(8)]
    ev += [_attack("A", "Item_Weapon_M24_C") for _ in range(2)]
    ev += [_damage("A", "B", weapon="WeapACE32_C") for _ in range(3)]
    ev += [_damage("A", "B", weapon="WeapM24_C")]
    w = analyse(ev)["players"]["A"]["weapons"]
    assert w["ACE32"] == {"shots": 8, "hits": 3}
    assert w["M24"] == {"shots": 2, "hits": 1}


def test_distance_buckets_use_hit_geometry():
    """ax/ay zu vx/vy sind cm — 1000 cm = 10 m gehoert in den 0-25m-Eimer."""
    ev = [_attack("A"), _attack("A")]
    ev += [_damage("A", "B", vy=1100.0),      # 10 m
           _damage("A", "B", vy=8100.0)]      # 80 m
    d = analyse(ev)["players"]["A"]["byDistance"]
    assert d["0-25"]["hits"] == 1
    assert d["50-100"]["hits"] == 1


# ── Kill-Timeline ───────────────────────────────────────────────────────────

def test_kill_timeline_has_when_where_what():
    ev = [_kill("A", "Opfer1", weapon="WeapACE32_C", distance=2500.0)]
    tl = analyse(ev)["kills"]
    assert len(tl) == 1
    k = tl[0]
    assert k["killer"] == "A" and k["victim"] == "Opfer1"
    assert k["weapon"] == "ACE32"
    assert k["distanceM"] == pytest.approx(25.0)   # cm -> m
    assert k["x"] == 350.0 and k["y"] == 400.0
    assert k["zone"] == "HeadShot"


def test_kill_timeline_is_chronological():
    ev = [_kill("A", "Spaet", t="2026-07-26T23:20:00Z"),
          _kill("A", "Frueh", t="2026-07-26T23:12:00Z")]
    assert [k["victim"] for k in analyse(ev)["kills"]] == ["Frueh", "Spaet"]


def test_kills_per_player_match_timeline():
    ev = [_kill("A", "X"), _kill("A", "Y"), _kill("B", "Z")]
    r = analyse(ev)
    assert r["players"]["A"]["kills"] == 2
    assert r["players"]["B"]["kills"] == 1


def test_suicide_is_not_a_kill():
    ev = [_kill("A", "A")]
    ev[0]["isSuicide"] = True
    assert analyse(ev)["kills"] == []


def test_empty_events_are_safe():
    r = analyse([])
    assert r["players"] == {} and r["kills"] == []


# ── Schrotflinten / Salven ──────────────────────────────────────────────────

def test_shotgun_pellets_count_as_one_hit_for_accuracy():
    """Ein Schrotschuss erzeugt ein TakeDamage-Event PRO PELLET. Zaehlt man
    die roh, kommt eine Trefferquote ueber 100% heraus (real gesehen: 116%).
    Die attackId verbindet die Pellets mit ihrem Schuss."""
    ev = [_attack("A", "Item_Weapon_Berreta686_C", aid=7)]
    ev += [_damage("A", "B", weapon="WeapBerreta686_C", aid=7) for _ in range(9)]
    p = analyse(ev)["players"]["A"]
    assert p["shots"] == 1
    assert p["accuracy"] == pytest.approx(100.0)   # nicht 900%
    assert p["accuracy"] <= 100.0
    # Fuer die Zonenverteilung zaehlen weiterhin alle Einschlaege
    assert p["hits"] == 9


def test_accuracy_never_exceeds_100_percent():
    ev = [_attack("A", aid=1), _attack("A", aid=2)]
    ev += [_damage("A", "B", aid=1) for _ in range(5)]
    ev += [_damage("A", "B", aid=2) for _ in range(5)]
    assert analyse(ev)["players"]["A"]["accuracy"] == pytest.approx(100.0)


def test_separate_attacks_count_separately():
    """Zwei echte Schuesse mit je einem Treffer bleiben zwei Treffer."""
    ev = [_attack("A", aid=1), _attack("A", aid=2), _attack("A", aid=3)]
    ev += [_damage("A", "B", aid=1), _damage("A", "B", aid=2)]
    p = analyse(ev)["players"]["A"]
    assert p["shots"] == 3
    assert p["hitAttacks"] == 2
    assert p["accuracy"] == pytest.approx(66.7)


def test_missing_attack_id_still_counts_as_hit():
    """Aeltere Telemetrie-Schemata koennen die attackId weglassen — dann
    lieber jeden Treffer zaehlen als ihn zu verlieren."""
    ev = [_attack("A", aid=None), _damage("A", "B", aid=None)]
    p = analyse(ev)["players"]["A"]
    assert p["hits"] == 1
    assert p["hitAttacks"] == 1
