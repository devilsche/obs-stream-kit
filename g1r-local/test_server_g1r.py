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
