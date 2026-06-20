import importlib.util, os
spec = importlib.util.spec_from_file_location("srv", os.path.join(os.path.dirname(__file__), "server.py"))
srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)

def test_strongest_melee_picks_highest_damage():
    srv.WEAPON_DAMAGE = {"ItMw_1H_Sword_01": 8, "ItMw_2H_Sword_Uriziel_02": 120}
    items = [{"name": "ItMw_1H_Sword_01"}, {"name": "ItMw_2H_Sword_Uriziel_02"}, {"name": "ItFo_Apple"}]
    assert srv.strongest_melee(items) == ("ItMw_2H_Sword_Uriziel_02", 120)

def test_strongest_melee_none_when_no_melee():
    srv.WEAPON_DAMAGE = {"ItMw_1H_Sword_01": 8}
    assert srv.strongest_melee([{"name": "ItFo_Apple"}]) == (None, None)

def test_melee_and_ranged_split_dont_mix_categories():
    # Söldnerklinge (Melee 73) und leichte Armbrust (Ranged 60) duerfen nicht
    # gegeneinander gewinnen — jede Kategorie hat ihren eigenen Bestwert.
    srv.WEAPON_DAMAGE = {"ItMw_2H_Sword_Light_03": 73, "ItRw_Crossbow_01": 60}
    items = [{"name": "ItMw_2H_Sword_Light_03"}, {"name": "ItRw_Crossbow_01"}]
    assert srv.strongest_melee(items) == ("ItMw_2H_Sword_Light_03", 73)
    assert srv.strongest_ranged(items) == ("ItRw_Crossbow_01", 60)

def test_map_guild_substring_and_none():
    assert srv.map_guild("Guild.Guards") == "guards"
    assert srv.map_guild("EPlayerGuild::MagesWater") == "water_mage"
    assert srv.map_guild("SpellCategory.MagesFire") == "fire_mage"
    assert srv.map_guild("Guild.None") is None
    assert srv.map_guild("") is None
    assert srv.map_guild(None) is None

def test_strongest_usable_spell_respects_circle():
    srv.SPELL_CIRCLE = {"ItAr_Rune_FireBolt": 1, "ItAr_Rune_Fireball": 2, "ItAr_Rune_BreathOfDeath": 6}
    items = [{"name": "ItAr_Rune_FireBolt"}, {"name": "ItAr_Rune_Fireball"}, {"name": "ItAr_Rune_BreathOfDeath"}]
    assert srv.strongest_usable_spell(items, 2) == "ItAr_Rune_Fireball"

def test_strongest_usable_spell_none_when_circle_too_low():
    srv.SPELL_CIRCLE = {"ItAr_Rune_Fireball": 2}
    assert srv.strongest_usable_spell([{"name": "ItAr_Rune_Fireball"}], 0) is None


def test_strongest_usable_spell_rune_matches_scroll_entry():
    # spell_circle.json listet meist nur Scroll-Varianten; eine Rune im Inventar
    # muss den Scroll-Kreis-Eintrag desselben Zaubers treffen.
    srv.SPELL_CIRCLE = {"ItAr_Scroll_Fireball": 2}
    items = [{"name": "ItAr_Rune_Fireball"}]
    assert srv.strongest_usable_spell(items, 3) == "ItAr_Rune_Fireball"


def test_equipped_weapon_folded_into_strongest(tmp_path):
    # Die ausgeruestete Waffe (READ_CARRY → state.weapon) steckt NICHT im Beutel,
    # muss aber beim "staerksten" gewinnen — sonst zeigt die Card nur die Ersatz-Sense.
    import json, time
    srv.WEAPON_DAMAGE = {"ItMw_1H_Sword_Scythe_01": 15, "ItMw_2H_Sword_Light_03": 73}
    p = tmp_path / "state.json"
    p.write_text(json.dumps({
        "ok": True,
        "items": [{"name": "ItMw_1H_Sword_Scythe_01", "count": 1}],   # nur die Sense im Beutel
        "weapon": "ItMw_2H_Sword_Light_03",                            # 73er in der Hand
    }), encoding="utf-8")
    old = srv.STATE_FILE
    srv.STATE_FILE = str(p)
    try:
        d = srv.build_payload("de")
    finally:
        srv.STATE_FILE = old
    assert d["ok"] is True
    assert d["strongestMelee"] == "ItMw_2H_Sword_Light_03"
    assert d["strongestMeleeDmg"] == 73


def test_no_equipped_weapon_uses_bag_only(tmp_path):
    # Ohne READ_CARRY (weapon null) bleibt es beim Beutel-Bestwert.
    import json
    srv.WEAPON_DAMAGE = {"ItMw_1H_Sword_Scythe_01": 15}
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"ok": True, "items": [{"name": "ItMw_1H_Sword_Scythe_01"}]}), encoding="utf-8")
    old = srv.STATE_FILE
    srv.STATE_FILE = str(p)
    try:
        d = srv.build_payload("de")
    finally:
        srv.STATE_FILE = old
    assert d["strongestMelee"] == "ItMw_1H_Sword_Scythe_01" and d["strongestMeleeDmg"] == 15
