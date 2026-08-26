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


def test_normalize_weapon_uses_ingame_names():
    """Die internen IDs sind nicht die Namen aus dem Spiel: FNFal heisst
    SLR, HK416 heisst M416. Dafuer gibt es WEAPON_NAMES in aggregations."""
    assert normalize_weapon("WeapFNFal_C") == "SLR"
    assert normalize_weapon("Item_Weapon_FNFal_C") == "SLR"
    assert normalize_weapon("WeapHK416_C") == "M416"
    assert normalize_weapon("Item_Weapon_HK416_C") == "M416"
    assert normalize_weapon("WeapBerreta686_C") == "S686"
    assert normalize_weapon("WeapWinchester_C") == "S1897"
    assert normalize_weapon("WeapSawnoff_C") == "Sawed-off"


def test_normalize_weapon_survives_junk():
    assert normalize_weapon(None) is None
    assert normalize_weapon("") is None
    # Fahrzeuge tauchen als damageCauserName auf — bekommen ihr Label
    assert normalize_weapon("Dacia_A_03_v2_C")


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


# ── Auffaelligkeits-Bewertung ───────────────────────────────────────────────

from pubg.telemetry_analysis import flag_anomalies


def _spray(name, n_hits, limb_share, hs=0):
    """n_hits Einschlaege mit gegebenem Gliedmassen-Anteil."""
    ev = [_attack(name, aid=i) for i in range(n_hits)]
    limbs = int(n_hits * limb_share)
    for i in range(n_hits):
        if i < limbs:
            z = "ArmShot" if i % 2 else "LegShot"
        elif i < limbs + hs:
            z = "HeadShot"
        else:
            z = "TorsoShot"
        ev.append(_damage(name, "Opfer", reason=z, aid=i))
    return ev


def test_flags_hit_pattern_that_is_too_narrow():
    """Kernsignal: beim Sprayen streut der Rueckstoss ueber den ganzen Koerper.
    Fast nur Torso/Kopf passt nicht zu einer Automatikwaffe."""
    ev = []
    for i in range(6):                        # Referenzfeld: ~33% Gliedmassen
        ev += _spray(f"Normal{i}", 60, 0.33)
    ev += _spray("Verdaechtig", 60, 0.02)     # praktisch keine Gliedmassen
    res = flag_anomalies(analyse(ev), min_hits=30)
    assert "Verdaechtig" in res
    assert res["Verdaechtig"]["limbPct"] < 5
    assert res["Verdaechtig"]["pValue"] < 0.001
    assert "narrow_hit_pattern" in res["Verdaechtig"]["flags"]


def test_normal_players_are_not_flagged():
    ev = []
    for i in range(6):
        ev += _spray(f"Normal{i}", 60, 0.33)
    res = flag_anomalies(analyse(ev), min_hits=30)
    for name, r in res.items():
        assert "narrow_hit_pattern" not in r["flags"], name


def test_small_samples_are_skipped():
    """Unter min_hits ist jede Aussage Rauschen — lieber gar nicht bewerten."""
    ev = []
    for i in range(6):
        ev += _spray(f"Normal{i}", 60, 0.33)
    ev += _spray("Wenig", 5, 0.0)
    res = flag_anomalies(analyse(ev), min_hits=30)
    assert "Wenig" not in res


def test_multiple_testing_correction_is_reported():
    """Wer viele Spieler durchtestet, findet zwangslaeufig Ausreisser. Die
    Bonferroni-Schwelle muss im Ergebnis stehen, sonst ist p wertlos."""
    ev = []
    for i in range(6):
        ev += _spray(f"Normal{i}", 60, 0.33)
    ev += _spray("Verdaechtig", 60, 0.02)
    res = flag_anomalies(analyse(ev), min_hits=30)
    r = res["Verdaechtig"]
    assert r["tested"] == len(res)
    assert r["bonferroniThreshold"] == pytest.approx(0.01 / r["tested"])
    assert r["significantCorrected"] is (r["pValue"] < r["bonferroniThreshold"])


def test_wallbangs_are_flagged_separately():
    ev = _spray("Waller", 40, 0.30)
    ev += [_damage("Waller", "Opfer", wall=True, aid=900+i) for i in range(4)]
    for i in range(6):
        ev += _spray(f"Normal{i}", 60, 0.33)
    res = flag_anomalies(analyse(ev), min_hits=30)
    assert "wallbangs" in res["Waller"]["flags"]


def test_no_reference_data_yields_no_flags():
    """Ein einzelner Spieler ist sein eigenes Referenzfeld — das ergibt
    keine Aussage und darf nicht in einen Vorwurf laufen."""
    res = flag_anomalies(analyse(_spray("Allein", 60, 0.02)), min_hits=30)
    assert res.get("Allein", {}).get("flags", []) == [] or res == {}


def _dist_hits(name, near_hits, near_hs, far_hits, far_hs):
    """Treffer nah (10 m) und fern (80 m) mit vorgegebenen Kopftreffern."""
    ev = []
    aid = 5000
    for i in range(near_hits):
        aid += 1
        ev.append(_attack(name, aid=aid))
        ev.append(_damage(name, "O", reason="HeadShot" if i < near_hs else "TorsoShot",
                          vy=1100.0, aid=aid))
    for i in range(far_hits):
        aid += 1
        ev.append(_attack(name, aid=aid))
        ev.append(_damage(name, "O", reason="HeadShot" if i < far_hs else "TorsoShot",
                          vy=8100.0, aid=aid))
    return ev


def test_distance_headshot_flag_needs_a_real_sample():
    """Bei 8 fernen Treffern ist jede Quote Rauschen — mit dem alten
    Faktor-1.5-Kriterium feuerte das Flag bei 27 von 29 Markierungen."""
    ev = _dist_hits("Zufall", near_hits=20, near_hs=2, far_hits=8, far_hs=2)
    for i in range(5):
        ev += _spray(f"Normal{i}", 60, 0.33)
    res = flag_anomalies(analyse(ev), min_hits=25)
    assert "headshot_rate_rises_with_distance" not in res.get("Zufall", {}).get("flags", [])


def test_distance_headshot_flag_fires_on_a_clear_case():
    """Deutlich: nah kaum Kopftreffer, fern fast nur — und genug Daten."""
    ev = _dist_hits("Klar", near_hits=40, near_hs=2, far_hits=30, far_hs=18)
    for i in range(5):
        ev += _spray(f"Normal{i}", 60, 0.33)
    res = flag_anomalies(analyse(ev), min_hits=25)
    assert "headshot_rate_rises_with_distance" in res["Klar"]["flags"]


# ── Leerschuss-Erkennung ────────────────────────────────────────────────────

def _pos(name, team, x, y, t="2026-07-26T23:12:00Z", health=100):
    return {"_T": "LogPlayerPosition", "_D": t,
            "character": {"name": name, "teamId": team, "health": health,
                          "accountId": "account." + name,
                          "location": {"x": x, "y": y}}}


def _attack_at(name, x, y, t="2026-07-26T23:12:00Z", aid=1):
    e = _attack(name, t=t, aid=aid)
    e["attacker"]["location"] = {"x": x, "y": y}
    e["attacker"]["teamId"] = 1
    return e


def test_shot_with_enemy_in_range_is_not_empty():
    ev = [_pos("A", 1, 0.0, 0.0), _pos("Gegner", 2, 5000.0, 0.0),   # 50 m
          _attack_at("A", 0.0, 0.0)]
    p = analyse(ev)["players"]["A"]
    assert p["shotsWithTarget"] == 1
    assert p["emptyShotPct"] == pytest.approx(0.0)


def test_shot_without_any_enemy_nearby_counts_as_empty():
    """Wer ohne Gegner in Reichweite schiesst, druckt seine Accuracy —
    das ist selbst ein Signal."""
    ev = [_pos("A", 1, 0.0, 0.0), _pos("Weit", 2, 500000.0, 0.0),   # 5 km
          _attack_at("A", 0.0, 0.0)]
    p = analyse(ev)["players"]["A"]
    assert p["shotsWithTarget"] == 0
    assert p["emptyShotPct"] == pytest.approx(100.0)


def test_teammates_do_not_count_as_targets():
    ev = [_pos("A", 1, 0.0, 0.0), _pos("Mate", 1, 5000.0, 0.0),
          _attack_at("A", 0.0, 0.0)]
    assert analyse(ev)["players"]["A"]["emptyShotPct"] == pytest.approx(100.0)


def test_dead_players_do_not_count_as_targets():
    ev = [_pos("A", 1, 0.0, 0.0), _pos("Leiche", 2, 5000.0, 0.0, health=0),
          _attack_at("A", 0.0, 0.0)]
    assert analyse(ev)["players"]["A"]["emptyShotPct"] == pytest.approx(100.0)


def test_without_position_data_no_empty_shot_claim():
    """Ohne Positions-Events darf niemand als Leerschuetze dastehen."""
    ev = [_attack("A", aid=1), _damage("A", "B", aid=1)]
    p = analyse(ev)["players"]["A"]
    assert p["emptyShotPct"] is None


def test_team_id_is_reported_per_player():
    """Ohne Team laesst sich in der Tabelle nicht erkennen, wer Gegner war."""
    ev = [_kill("A", "Opfer1")]          # killer teamId 19, victim teamId 4
    r = analyse(ev)["players"]
    assert r["A"]["teamId"] == 19
    assert r["Opfer1"]["teamId"] == 4


def test_team_id_is_none_when_unknown():
    ev = [_attack("A", aid=1)]
    assert analyse(ev)["players"]["A"]["teamId"] is None


def test_victim_only_players_still_appear():
    """Wer nur stirbt und nie schiesst, gehoert trotzdem in die Auswertung."""
    r = analyse([_kill("A", "Opfer1")])["players"]
    assert "Opfer1" in r
    assert r["Opfer1"]["shots"] == 0
