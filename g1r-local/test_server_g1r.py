import importlib.util, os
spec = importlib.util.spec_from_file_location("srv", os.path.join(os.path.dirname(__file__), "server.py"))
srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)

def test_strongest_weapon_picks_highest_damage():
    srv.WEAPON_DAMAGE = {"ItMw_1H_Sword_01": 8, "ItMw_2H_Sword_Uriziel_02": 120}
    items = [{"name": "ItMw_1H_Sword_01"}, {"name": "ItMw_2H_Sword_Uriziel_02"}, {"name": "ItFo_Apple"}]
    assert srv.strongest_weapon(items) == "ItMw_2H_Sword_Uriziel_02"

def test_strongest_weapon_none_when_no_weapon():
    srv.WEAPON_DAMAGE = {"ItMw_1H_Sword_01": 8}
    assert srv.strongest_weapon([{"name": "ItFo_Apple"}]) is None

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
