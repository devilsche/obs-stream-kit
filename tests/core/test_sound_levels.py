import json
from unittest import mock

from core import sound_levels


def test_load_save_and_groups():
    data = {}
    with mock.patch("pubg.db_pg.get_setting", side_effect=lambda c, t, k, d=None: data.get((t, k), d)), \
         mock.patch("pubg.db_pg.set_setting", side_effect=lambda c, t, k, v: data.__setitem__((t, k), v)):
        assert sound_levels.load(None, 1) == {"memes": 0.5, "alerts": 0.5}
        assert sound_levels.save(None, 1, {"memes": "0.3", "alerts": "9"}) == {"memes": 0.3, "alerts": 1.0}
        assert sound_levels.save(None, 1, {"memes": None, "alerts": "x"}) == {"memes": 0.3, "alerts": 1.0}
        assert json.loads(data[(1, "sound_levels")]) == {"memes": 0.3, "alerts": 1.0}
        assert sound_levels.load(None, 2)["memes"] == 0.5   # anderer Tenant unberührt
    assert sound_levels.group_for("stingers") == "memes" and sound_levels.group_for("alerts") == "alerts"
    assert sound_levels.group_for("overlays") is None
