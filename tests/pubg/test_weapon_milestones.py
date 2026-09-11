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


def test_level_zaehlt_ab_null():
    # Die API zaehlt das Level innerhalb des Tiers ab null: ihre 99 ist
    # ingame die 100. Der volle Stand heisst "Master, Level 100".
    assert parse_mastery(_payload())["M416"]["level"] == 100


def test_rangnamen_nur_wo_belegt():
    from pubg.weapon_milestones import tier_label
    assert tier_label(0) == "Basic"
    assert tier_label(6) == "Master"
    # Die Stufen dazwischen sind namentlich nicht bekannt.
    assert tier_label(3) == "Tier 3"


def test_tier_und_level_ergeben_den_vergleichbaren_stand():
    # Das Level allein taugt nicht: es beginnt in jedem Tier neu. Am
    # Konto belegt — Tier 5 Level 13 hat 1.344 Kills, Tier 1 Level 97
    # nur 143.
    from pubg.weapon_milestones import MAX_LEVEL_IN_TIER, progress
    assert progress(5, 14) > progress(1, 98)
    assert progress(6, MAX_LEVEL_IN_TIER) == max(
        progress(t, MAX_LEVEL_IN_TIER) for t in range(7))


def test_skin_variante_mit_weiterem_stand_gewinnt():
    # Nicht das hoehere Level, sondern der weitere Stand als Ganzes.
    p = {"data": {"attributes": {"weaponSummaries": {
        "Item_Weapon_HK416_C": {"LevelCurrent": 97, "TierCurrent": 1},
        "Item_Weapon_DuncansHK416_C": {"LevelCurrent": 13,
                                       "TierCurrent": 5}}}}}
    m = parse_mastery(p)["M416"]
    # Level ab null gezaehlt: API 13 ist ingame 14.
    assert (m["tier"], m["level"]) == (5, 14)


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


def test_ausgelevelt_haengt_am_tier_nicht_am_level():
    # Tier 6 ist die Endstation; ein bestimmtes Level bedeutet nichts,
    # weil es in jedem Tier neu beginnt.
    prev = _state({"Mk12": {"tier": 5, "level": 98}})
    cur = _state({"Mk12": {"tier": 6, "level": 1}})
    hit = [m for m in detect(prev, cur)
           if m["occasion"] == "weapon_mastered"][0]
    assert hit["tier"] == "huge"
    assert hit["value"] == 6


def test_hohes_level_im_falschen_tier_ist_nicht_ausgelevelt():
    # Der alte Fehler: Level 99 in Tier 0 galt als gemeistert.
    prev = _state({"VSS": {"tier": 0, "level": 90}})
    cur = _state({"VSS": {"tier": 0, "level": 100}})
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_mastered"] == []


def test_bereits_ausgelevelt_feiert_nicht_erneut():
    prev = _state({"Mk12": {"tier": 6, "level": 100}})
    cur = _state({"Mk12": {"tier": 6, "level": 100}})
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_mastered"] == []


# ── Sortierung, Schluessel, Konfiguration ───────────────────────────────────

def test_lautester_meilenstein_steht_vorn():
    prev = _state({"M416": {"damage": 424000, "tier": 5}})
    cur = _state({"M416": {"damage": 425100, "tier": 6}})
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


# ── Wurfgeraete, die im Mapping fehlten ─────────────────────────────────────

def test_alle_wurfgeraete_gelten_als_wurfgeraet():
    # Rauch, Blendgranate, Taser und Blauzonen-Granate tragen
    # `Item_Weapon_`-Praefix statt `Proj` und fehlten deshalb im
    # Mapping: Klasse "other", is_thrown false, in keiner Wurf-Wertung
    # sichtbar — obwohl die Rauchbombe mit 1.560 Wuerfen das
    # meistgeworfene Geraet ueberhaupt ist.
    from pubg.burst_analysis import class_of_weapon_name
    from pubg.weapon_milestones import THROWABLES
    for name in THROWABLES:
        assert class_of_weapon_name(name) == "throwable", name


def test_blauzonen_granate_ist_kein_umgebungstod():
    # Der Effekt-Aktor war als "Red Zone" beschriftet; eigene
    # Granaten-Kills landeten damit in der Umgebungs-Spalte statt bei
    # der Waffe.
    from pubg.aggregations import _weapon_ci_lookup
    hit = _weapon_ci_lookup("Bluezonebomb_EffectActor_C")
    assert hit == ("Blauzonen-Granate", "throwable")


def test_wurf_und_wirkung_der_blauzonen_granate_fallen_zusammen():
    # Unter ihrem eigenen Namen stehen nur Attack-Events (175 Wuerfe),
    # Schaden und Toetung laufen ueber den Effekt-Aktor — dieselbe
    # Trennung wie beim Molotov.
    from pubg.aggregations import _weapon_ci_lookup
    assert (_weapon_ci_lookup("Item_Weapon_BluezoneGrenade_C")
            == _weapon_ci_lookup("Bluezonebomb_EffectActor_C"))


def test_echte_red_zone_bleibt_umgebung():
    # Die Zonen-Bombardierung ist keine Waffe und darf nicht
    # mitrutschen, nur weil der Name aehnlich klingt.
    from pubg.aggregations import _weapon_ci_lookup
    assert _weapon_ci_lookup("RedZoneBombingField_Def_C") is None


def test_anzeigenamen_sind_englisch():
    # WEAPON_NAMES ist deutsch gepflegt und Datenschluessel; die
    # Oberflaeche ist englisch.
    from pubg.weapon_milestones import display_name
    assert display_name("Rauchbombe") == "Smoke Grenade"
    assert display_name("Blauzonen-Granate") == "Blue Zone Grenade"
    # Eine Schusswaffe bleibt, wie sie heisst.
    assert display_name("M416") == "M416"


def test_level_hundert_gibt_es_nur_im_master_tier():
    # In Tier 0 bis 5 endet das Level bei 99 und man steigt auf; nur in
    # Tier 6 zaehlt es weiter, weil es kein Tier 7 gibt. Belegt durch
    # die Messung: rohe 99 kommt ausschliesslich in Tier 6 vor.
    from pubg.weapon_milestones import LEVEL_PER_TIER, MAX_LEVEL_IN_TIER

    def lvl(raw, tier):
        p = {"data": {"attributes": {"weaponSummaries": {
            "Item_Weapon_VSS_C": {"LevelCurrent": raw,
                                  "TierCurrent": tier}}}}}
        return parse_mastery(p)["VSS"]["level"]

    # Hoechstwert unterhalb von Master: roh 98 → ingame 99.
    assert lvl(98, 0) == LEVEL_PER_TIER
    # Und im Master-Tier eine Stufe darueber.
    assert lvl(99, 6) == MAX_LEVEL_IN_TIER


def test_ausgelevelt_ist_nicht_einstellbar():
    # Eine gespeicherte Konfiguration aus einer aelteren Fassung hatte
    # hier "at": 100 stehen und liess den Anlass auf einen Tier-Wert
    # zeigen, den es nicht gibt. Tier 6 ist eine Tatsache des Spiels.
    from pubg.weapon_milestones import MAX_TIER
    cfg = merge_config({"weapon_mastered": {"at": 100}})
    assert cfg["weapon_mastered"].get("at") is None
    assert OCCASIONS["weapon_mastered"]["at"] == MAX_TIER
