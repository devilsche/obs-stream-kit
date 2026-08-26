"""Waffen-Performance über mehrere Matches — Aggregation und Datei-Cache.

Bewusst ohne DB-Tabelle: die Analyse je Match landet als kleine JSON-Datei
im Cache-Verzeichnis, die Aggregation ist reine Rechnung darauf. Telemetrie
ist unveraenderlich, der Cache veraltet also nie.
"""
import json

import pytest

from pubg.weapon_performance import (aggregate, squad_slice,
                                     cache_path, load_cached, store_cached)


def _analysis(players):
    """Minimales analyse()-Ergebnis."""
    return {"players": players, "kills": [], "rosterSize": len(players),
            "playersWithoutEvents": []}


def _p(weapons, team=1, bot=False, acc=None):
    return {"teamId": team, "isBot": bot, "shots": 0, "hits": 0,
            "accountId": acc, "weapons": weapons}


def _w(shots=0, hits=0, hit_attacks=0, damage=0.0, zones=None, kills=0):
    return {"shots": shots, "hits": hits, "hitAttacks": hit_attacks,
            "damage": damage, "zones": zones or {}, "kills": kills}


# ── Aggregation ─────────────────────────────────────────────────────────────

def test_sums_one_weapon_across_matches():
    a = _analysis({"Me": _p({"M416": _w(100, 20, 18, 300.0, {"TorsoShot": 20})})})
    b = _analysis({"Me": _p({"M416": _w(50, 10, 9, 150.0, {"HeadShot": 10})})})
    r = aggregate([a, b], player="Me")
    w = r["rows"][0]
    assert w["weapon"] == "M416"
    assert w["shots"] == 150 and w["hits"] == 30 and w["hitAttacks"] == 27
    assert w["damage"] == pytest.approx(450.0)
    assert w["matches"] == 2
    assert w["zones"] == {"TorsoShot": 20, "HeadShot": 10}


def test_accuracy_is_recomputed_not_averaged():
    """Quoten der Einzelmatches zu mitteln gewichtet ein 5-Schuss-Match wie
    ein 200-Schuss-Match. Über die Summen rechnen."""
    a = _analysis({"Me": _p({"M416": _w(200, 20, 20, 0.0)})})     # 10%
    b = _analysis({"Me": _p({"M416": _w(5, 5, 5, 0.0)})})         # 100%
    w = aggregate([a, b], player="Me")["rows"][0]
    assert w["accuracy"] == pytest.approx(100.0 * 25 / 205, abs=0.05)   # nicht 55%


def test_damage_averages_use_the_right_denominators():
    a = _analysis({"Me": _p({"S686": _w(2, 18, 2, 180.0)})})
    w = aggregate([a], player="Me")["rows"][0]
    assert w["avgDamage"] == pytest.approx(10.0)               # je Einschlag
    assert w["avgDamagePerLandedShot"] == pytest.approx(90.0)  # je treffendem Schuss
    assert w["avgDamagePerShot"] == pytest.approx(90.0)        # je Schuss


def test_rows_are_sorted_by_damage():
    a = _analysis({"Me": _p({"M416": _w(10, 2, 2, 50.0),
                             "Kar98k": _w(4, 3, 3, 200.0)})})
    assert [r["weapon"] for r in aggregate([a], player="Me")["rows"]] == ["Kar98k", "M416"]


def test_other_players_are_ignored_when_player_given():
    a = _analysis({"Me": _p({"M416": _w(10, 5, 5, 100.0)}),
                   "Other": _p({"M416": _w(999, 999, 999, 9999.0)})})
    assert aggregate([a], player="Me")["rows"][0]["shots"] == 10


def test_group_by_player_compares_mates():
    a = _analysis({"Me": _p({"M416": _w(10, 5, 5, 100.0)}),
                   "Mate": _p({"AKM": _w(20, 4, 4, 80.0)})})
    rows = aggregate([a], group_by="player")["rows"]
    by = {r["player"]: r for r in rows}
    assert by["Me"]["shots"] == 10 and by["Mate"]["shots"] == 20
    assert "weapon" not in by["Me"]


def test_empty_input_is_safe():
    r = aggregate([], player="Me")
    assert r["rows"] == [] and r["matches"] == 0


def test_weapons_without_any_use_are_skipped():
    a = _analysis({"Me": _p({"Grenade": _w(0, 0, 0, 0.0)})})
    assert aggregate([a], player="Me")["rows"] == []


# ── Squad-Ausschnitt (das, was gecached wird) ───────────────────────────────

def test_squad_slice_keeps_only_own_team():
    full = _analysis({
        "Me":   _p({"M416": _w(10, 5, 5, 90.0)}, team=7),
        "Mate": _p({"AKM":  _w(8, 3, 3, 60.0)},  team=7),
        "Enemy": _p({"AKM": _w(99, 99, 99, 999.0)}, team=3),
    })
    sl = squad_slice(full, "Me")
    assert set(sl["players"]) == {"Me", "Mate"}


def test_squad_slice_without_known_player_keeps_nothing():
    full = _analysis({"Enemy": _p({"AKM": _w(1, 1, 1, 1.0)}, team=3)})
    assert squad_slice(full, "Unbekannt")["players"] == {}


# ── Datei-Cache ─────────────────────────────────────────────────────────────

def test_cache_roundtrip(tmp_path):
    data = _analysis({"Me": _p({"M416": _w(10, 5, 5, 90.0)})})
    store_cached("match-1", data, cache_dir=str(tmp_path))
    assert load_cached("match-1", cache_dir=str(tmp_path)) == data


def test_cache_miss_returns_none(tmp_path):
    assert load_cached("gibtsnicht", cache_dir=str(tmp_path)) is None


def test_cache_path_rejects_traversal(tmp_path):
    """match_id kommt aus der URL — kein Schreiben ausserhalb des Caches."""
    with pytest.raises(ValueError):
        cache_path("../../etc/passwd", cache_dir=str(tmp_path))


def test_corrupt_cache_file_is_ignored(tmp_path):
    p = tmp_path / "match-2.json"
    p.write_text("{kein json", encoding="utf-8")
    assert load_cached("match-2", cache_dir=str(tmp_path)) is None


# ── Umwandlung Analyse -> DB-Zeilen ─────────────────────────────────────────

from pubg.weapon_performance import to_db_rows


def test_to_db_rows_flattens_players_and_weapons():
    a = _analysis({
        "Alice": _p({"M416": _w(100, 22, 20, 400.0,
                                {"HeadShot": 4, "TorsoShot": 12, "ArmShot": 6})},
                    team=1, acc="account.alice"),
        "Bob":   _p({"AKM": _w(50, 10, 9, 200.0, {"LegShot": 10})},
                    team=2, acc="account.bob"),
    })
    rows = to_db_rows(a)
    by = {(r["player_name"], r["weapon"]): r for r in rows}
    assert set(by) == {("Alice", "M416"), ("Bob", "AKM")}
    m = by[("Alice", "M416")]
    assert (m["shots"], m["hits"], m["hit_attacks"]) == (100, 22, 20)
    assert (m["head"], m["torso"], m["arm"], m["leg"], m["pelvis"]) == (4, 12, 6, 0, 0)
    assert m["team_id"] == 1 and m["is_bot"] is False


def test_to_db_rows_skips_unused_weapons():
    a = _analysis({"Alice": _p({"Grenade": _w(0, 0, 0, 0.0)}, acc="account.alice")})
    assert to_db_rows(a) == []


def test_to_db_rows_keeps_bots_but_marks_them():
    a = _analysis({"BotX": _p({"AKM": _w(5, 1, 1, 20.0)}, team=200, bot=True,
                              acc="ai.7")})
    rows = to_db_rows(a)
    assert rows[0]["is_bot"] is True


def test_to_db_rows_needs_account_ids():
    """Ohne accountId gibt es keinen Primaerschluessel — Zeile faellt weg."""
    a = {"players": {"Ghost": {"teamId": 1, "isBot": False,
                               "weapons": {"AKM": _w(5, 1, 1, 20.0)}}}}
    assert to_db_rows(a, account_ids={}) == []


# ── Waffen-Kategorien ───────────────────────────────────────────────────────

from pubg.weapon_performance import weapon_categories, weapons_in_category


def test_categories_are_derived_from_the_existing_table():
    """Die Kategorie steht schon in WEAPON_NAMES — kein Schema-Change noetig."""
    cats = weapon_categories()
    assert "ar" in cats and "dmr" in cats and "sniper" in cats
    assert cats["ar"]["label"]           # jede Kategorie hat eine Beschriftung
    assert cats["sniper"]["count"] > 0


def test_weapons_in_category_returns_ingame_names():
    """Gefiltert wird gegen die Namen in der DB, also die aus dem Spiel."""
    ars = weapons_in_category("ar")
    assert "M416" in ars and "Beryl" in ars
    assert "Kar98k" not in ars
    snipers = weapons_in_category("sniper")
    assert "Kar98k" in snipers and "AWM" in snipers


def test_unknown_category_is_empty_not_an_error():
    assert weapons_in_category("laser") == []


def test_categories_do_not_overlap_for_the_common_ones():
    """Eine Waffe darf nicht in zwei Kampf-Kategorien stehen, sonst zaehlt
    der Filter doppelt."""
    seen = {}
    for cat in ("ar", "dmr", "sniper", "smg", "lmg", "shotgun", "pistol"):
        for w in weapons_in_category(cat):
            assert w not in seen, f"{w} in {cat} und {seen.get(w)}"
            seen[w] = cat
