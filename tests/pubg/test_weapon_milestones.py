"""Meilenstein-Erkennung: Schwellen, Rekorde, Konfiguration."""
import pytest

from pubg.weapon_milestones import (OCCASIONS, career_from_payload,
                                    default_config, detect,
                                    mastery_weapon_name, merge_config,
                                    milestone_key, parse_mastery)


def _state(weapons=None, career=None):
    return {"weapons": weapons or {}, "career": career or {}}


# ── Ids und Namen ───────────────────────────────────────────────────────────

def test_mastery_id_wird_zum_db_klarnamen():
    # Genau der Name, unter dem match_weapon_stats die Waffe fuehrt.
    assert mastery_weapon_name("Item_Weapon_HK416_C") == "M416"
    assert mastery_weapon_name("Item_Weapon_Mk12_C") == "Mk12"


def test_unbekannte_id_liefert_none():
    assert mastery_weapon_name("Item_Weapon_Nichtexistent_C") is None


# ── Mastery lesen ───────────────────────────────────────────────────────────

def _payload(**blocks):
    return {"data": {"attributes": {"weaponSummaries": {
        "Item_Weapon_HK416_C": {"LevelCurrent": 99, "TierCurrent": 6,
                                "XPTotal": 952500, **blocks}}}}}


def test_ingame_zahl_ist_official_plus_competitive():
    # Am echten Konto belegt: 3156 + 23 = 3179, wie das Spiel es zeigt.
    p = _payload(
        StatsTotal={"Kills": 1451, "DamagePlayer": 235336},
        OfficialStatsTotal={"Kills": 3156, "DamagePlayer": 432503},
        CompetitiveStatsTotal={"Kills": 23, "DamagePlayer": 3449})
    m = parse_mastery(p)["M416"]
    assert m["kills"] == 3179
    assert m["damage"] == pytest.approx(435952)


def test_stats_total_bleibt_draussen():
    # Die alte Zaehlung ist keine Teilmenge und darf nicht mitsummieren.
    p = _payload(StatsTotal={"Kills": 1451},
                 OfficialStatsTotal={"Kills": 100},
                 CompetitiveStatsTotal={"Kills": 5})
    assert parse_mastery(p)["M416"]["kills"] == 105


def test_level_wird_um_eins_erhoeht():
    # LevelCurrent zaehlt ab null; ingame steht bei 99 die 100.
    assert parse_mastery(_payload())["M416"]["level"] == 100


def test_longest_nimmt_das_maximum_nicht_die_summe():
    p = _payload(OfficialStatsTotal={"LongestKill": 263},
                 CompetitiveStatsTotal={"LongestKill": 72})
    assert parse_mastery(p)["M416"]["longest"] == 263


def test_alias_feldname_longest_defeat_zaehlt_auch():
    p = _payload(OfficialStatsTotal={"LongestDefeat": 440})
    assert parse_mastery(p)["M416"]["longest"] == 440


def test_skin_varianten_landen_auf_einer_waffe():
    p = {"data": {"attributes": {"weaponSummaries": {
        "Item_Weapon_HK416_C": {"OfficialStatsTotal": {"Kills": 10}},
        "Item_Weapon_DuncansHK416_C": {"OfficialStatsTotal": {"Kills": 4}},
    }}}}
    assert parse_mastery(p)["M416"]["kills"] == 14


def _lifetime(**modes):
    return {"data": {"attributes": {"gameModeStats": modes}}}


def test_career_summiert_ueber_alle_modi():
    # Disjunkte Modi, also ist Aufaddieren richtig — und zwar ueber
    # alle, nicht nur squad.
    p = _lifetime(
        **{"squad-fpp": {"kills": 15419, "damageDealt": 2490943,
                         "roundsPlayed": 10748, "walkDistance": 14558611},
           "duo-fpp": {"kills": 10059, "damageDealt": 1523566,
                       "roundsPlayed": 6729, "walkDistance": 9000000},
           "solo-fpp": {"kills": 122, "roundsPlayed": 104}})
    t = career_from_payload(p)
    assert t["kills"] == 25600
    assert t["rounds"] == 17581
    assert t["walk"] == 23558611


def test_career_rekorde_werden_maximiert_nicht_summiert():
    p = _lifetime(**{"squad-fpp": {"longestKill": 751, "roundMostKills": 26},
                     "duo-fpp": {"longestKill": 753, "roundMostKills": 19}})
    t = career_from_payload(p)
    assert t["longest_kill"] == 753
    assert t["most_kills"] == 26


def test_karriere_felder_die_der_lifetime_parser_verwirft():
    # Strecke, Heilung und Rekorde gehen durch _parse_modestats verloren;
    # deshalb liest die Erkennung den Payload direkt.
    p = _lifetime(**{"squad-fpp": {"walkDistance": 100, "rideDistance": 200,
                                   "heals": 5, "boosts": 6,
                                   "weaponsAcquired": 7,
                                   "vehicleDestroys": 8, "roadKills": 9}})
    t = career_from_payload(p)
    assert (t["walk"], t["ride"], t["heals"]) == (100, 200, 5)
    assert (t["weapons_acquired"], t["vehicle_destroys"],
            t["road_kills"]) == (7, 8, 9)


# ── Erkennung: Schwellen ────────────────────────────────────────────────────

def test_erster_lauf_feiert_nichts():
    # Ohne Ausgangsstand waere die halbe Karriere auf einmal faellig.
    cur = _state({"M416": {"damage": 432503, "kills": 3179}})
    assert detect({}, cur) == []


def test_schwelle_ueberschritten_gibt_meilenstein():
    prev = _state({"M416": {"damage": 424000}})
    cur = _state({"M416": {"damage": 425100}})
    hits = [m for m in detect(prev, cur) if m["occasion"] == "weapon_damage"]
    assert len(hits) == 1
    assert hits[0]["value"] == 425000
    assert hits[0]["subject"] == "M416"
    assert hits[0]["prev_value"] == 424000


def test_schwelle_nicht_erreicht_gibt_nichts():
    prev = _state({"M416": {"damage": 425100}})
    cur = _state({"M416": {"damage": 429000}})
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_damage"] == []


def test_zwei_marken_auf_einmal_feiern_nur_die_hoehere():
    prev = _state({"M416": {"damage": 424000}})
    cur = _state({"M416": {"damage": 476000}})
    hits = [m for m in detect(prev, cur) if m["occasion"] == "weapon_damage"]
    assert [h["value"] for h in hits] == [475000]


def test_huge_every_hebt_die_grosse_marke_hervor():
    prev = _state(career={"damage": 3990000})
    cur = _state(career={"damage": 4010000})
    hit = [m for m in detect(prev, cur) if m["occasion"] == "career_damage"][0]
    assert hit["value"] == 4000000
    assert hit["tier"] == "huge"


def test_gewoehnliche_marke_bleibt_klein():
    prev = _state(career={"damage": 4090000})
    cur = _state(career={"damage": 4110000})
    hit = [m for m in detect(prev, cur) if m["occasion"] == "career_damage"][0]
    assert hit["value"] == 4100000
    assert hit["tier"] == "small"


# ── Erkennung: Rekorde und Einmal-Anlaesse ──────────────────────────────────

def test_neuer_rekord_wird_gefeiert():
    prev = _state({"M416": {"best_damage": 976}})
    cur = _state({"M416": {"best_damage": 1010}})
    hit = [m for m in detect(prev, cur)
           if m["occasion"] == "weapon_best_damage"][0]
    assert hit["value"] == 1010
    assert hit["tier"] == "big"


def test_rekord_unter_der_untergrenze_bleibt_still():
    # Sonst feiert jede neue Waffe ihren ersten Treffer als Rekord.
    prev = _state({"AKM": {"best_damage": 100}})
    cur = _state({"AKM": {"best_damage": 150}})
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_best_damage"] == []


def test_rekord_einer_erstmals_benutzten_waffe_bleibt_still():
    # prev == 0 heisst: die Waffe kam gerade dazu, das ist kein Rekord.
    prev = _state({"M416": {"best_damage": 0}})
    cur = _state({"M416": {"best_damage": 700}})
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_best_damage"] == []


def test_ausgelevelte_waffe_ist_ein_grosser_anlass():
    prev = _state({"Mk12": {"level": 99}})
    cur = _state({"Mk12": {"level": 100}})
    hit = [m for m in detect(prev, cur)
           if m["occasion"] == "weapon_mastered"][0]
    assert hit["tier"] == "huge"
    assert hit["value"] == 100


def test_bereits_ausgelevelt_feiert_nicht_erneut():
    prev = _state({"Mk12": {"level": 100}})
    cur = _state({"Mk12": {"level": 100}})
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_mastered"] == []


# ── Sortierung, Schluessel, Konfiguration ───────────────────────────────────

def test_lautester_meilenstein_steht_vorn():
    prev = _state({"M416": {"damage": 424000, "level": 99}})
    cur = _state({"M416": {"damage": 425100, "level": 100}})
    assert detect(prev, cur)[0]["occasion"] == "weapon_mastered"


def test_schluessel_enthaelt_den_wert():
    # Dieselbe Waffe reisst dieselbe Metrik wieder, nur an anderer Marke.
    a = milestone_key("weapon_damage", "M416", 425000)
    b = milestone_key("weapon_damage", "M416", 450000)
    assert a != b and a == "weapon_damage:M416:425000"


def test_abgeschalteter_anlass_liefert_nichts():
    cfg = default_config()
    cfg["weapon_damage"]["enabled"] = False
    prev = _state({"M416": {"damage": 424000}})
    cur = _state({"M416": {"damage": 425100}})
    assert [m for m in detect(prev, cur, cfg)
            if m["occasion"] == "weapon_damage"] == []


def test_eigene_schrittweite_wirkt():
    cfg = merge_config({"weapon_damage": {"step": 1000}})
    assert cfg["weapon_damage"]["step"] == 1000
    prev = _state({"M416": {"damage": 423900}})
    cur = _state({"M416": {"damage": 424100}})
    # Bei 25.000er Schritten (Default) waere hier nichts gerissen.
    assert [m for m in detect(prev, cur) if m["occasion"] == "weapon_damage"] == []
    hit = [m for m in detect(prev, cur, cfg)
           if m["occasion"] == "weapon_damage"][0]
    assert hit["value"] == 424000


def test_merge_config_ergaenzt_neue_anlaesse():
    # Nach einem Update darf das Tool nichts nachtragen muessen.
    cfg = merge_config({"weapon_damage": {"enabled": False}})
    assert set(cfg) == set(OCCASIONS)
    assert cfg["weapon_damage"]["enabled"] is False


def test_merge_config_verwirft_unsinn():
    cfg = merge_config({"weapon_damage": {"step": -5, "widget": "haus"},
                        "gibtsnicht": {"enabled": True}})
    assert cfg["weapon_damage"]["step"] == OCCASIONS["weapon_damage"]["step"]
    assert cfg["weapon_damage"]["widget"] == "bar"
    assert "gibtsnicht" not in cfg
