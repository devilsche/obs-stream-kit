"""Heldentat mit mehreren Feuern: weitere Feuer-Positionen und Lösch-Position kommen sauber durch."""
from fx import commands


def test_friend_fire_others_list():
    conv = commands.EFFECTS["friend"]["args"]["react"]["others"]
    assert conv("100,250.6, x ,5000") == "100,251,4000"
    assert conv("a,b") is None
    assert conv(",".join(str(i) for i in range(20))).count(",") == 7   # höchstens 8 Werte


def test_extinguish_takes_x():
    assert commands.EFFECTS["weather"]["args"]["extinguish"]["x"]("1400") == 1400
