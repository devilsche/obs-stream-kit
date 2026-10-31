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
             _a("ultra_chicken"), _a("chicken_streak")]   # streak: keine Stufe
    assert [a["id"] for a in keep_highest_tier(items)] == [
        "flare_gun", "skeet_shooter", "ultra_chicken", "chicken_streak"]


def test_dinner_served_ist_die_grundstufe():
    got = keep_highest_tier([_a("chicken"), _a("beast_chicken")])
    assert [a["id"] for a in got] == ["beast_chicken"]


def test_dinner_served_allein_bleibt():
    got = keep_highest_tier([_a("chicken", "m1"), _a("god_mode_chicken", "m2")])
    assert [a["id"] for a in got] == ["chicken", "god_mode_chicken"]


def test_achievements_list_markiert_nur_niedrigere_stufen(pg_compat):
    """Heavy Hitter im letzten Match ist dessen hoechste Schadensstufe —
    auch wenn er in der Session schon gepoppt hat (suppress_popup)."""
    import json
    from pubg.cache import TTLCache
    from pubg.endpoints import EndpointRegistry
    conn, t1, _ = pg_compat
    rows = [("damage_1000", "m1", 0), ("damage_500", "m1", 1),
            ("damage_500", "m2", 1)]
    for aid, mid, sup in rows:
        conn.execute(
            "INSERT INTO pubg_achievements_seen (tenant_id, achievement_id, "
            "match_id, label, played_at, detected_at, suppress_popup) "
            "VALUES (?, ?, ?, ?, ?, 0, ?)",
            (t1, aid, mid, aid, "2026-10-31T0%s:00:00Z" % mid[-1], sup))
    conn.commit()
    reg = EndpointRegistry(get_conn=lambda: conn, my_account_id="acc",
                           platform="steam", cache=TTLCache(), client=None,
                           poller_status=lambda: {}, tenant_id=t1)
    payload = reg.dispatch("GET", "/api/pubg/achievements-list", b"", {})[0]
    body = json.loads(payload) if isinstance(payload, (str, bytes)) else payload
    got = {(a["achievementId"], a["matchId"]): a["lowerTier"]
           for a in body["achievements"]}
    assert got == {("damage_1000", "m1"): False, ("damage_500", "m1"): True,
                   ("damage_500", "m2"): False}
