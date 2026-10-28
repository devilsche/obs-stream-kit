"""Stufenreihen (Chicken, Kills, Damage, Distanz, Iron Sights) zeigen je
Match nur die hoechste Stufe. In der DB bleiben alle — die Popup-Logik
braucht sie (niedrigere mit suppressPopup)."""
from pubg.aggregations import keep_highest_tier


def _a(aid, mid="m1"):
    return {"id": aid, "matchId": mid, "label": aid}


def test_god_mode_verdraengt_ultra_und_beast_im_selben_match():
    got = keep_highest_tier([_a("god_mode_chicken"), _a("ultra_chicken"),
                             _a("beast_chicken")])
    assert [a["id"] for a in got] == ["god_mode_chicken"]


def test_andere_matches_bleiben_unberuehrt():
    got = keep_highest_tier([_a("ultra_chicken", "m1"),
                             _a("god_mode_chicken", "m2"),
                             _a("ultra_chicken", "m2")])
    assert [(a["id"], a["matchId"]) for a in got] == [
        ("ultra_chicken", "m1"), ("god_mode_chicken", "m2")]


def test_alle_stufenreihen():
    items = [_a("kills_5"), _a("kills_10"), _a("damage_500"),
             _a("damage_2000"), _a("longest_kill_400"),
             _a("longest_kill_600"), _a("iron_sights_100"),
             _a("iron_sights_200")]
    assert sorted(a["id"] for a in keep_highest_tier(items)) == [
        "damage_2000", "iron_sights_200", "kills_10", "longest_kill_600"]


def test_fremde_ids_und_reihenfolge_bleiben():
    items = [_a("flare_gun"), _a("beast_chicken"), _a("skeet_shooter"),
             _a("ultra_chicken"), _a("chicken_streak")]
    assert [a["id"] for a in keep_highest_tier(items)] == [
        "flare_gun", "skeet_shooter", "ultra_chicken", "chicken_streak"]
