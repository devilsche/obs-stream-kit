"""Alte rain.html-/snow.html-URLs landen auf der Weather-Source."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "effects"


def test_rain_redirect_maps_intensity_and_keeps_channel():
    s = (ROOT / "rain.html").read_text()
    assert "weather.html" in s and "location.replace" in s
    for frag in ("light: 'drizzle'", "medium: 'rain'", "heavy: 'rain'", "storm: 'storm'",
                 "'chan', 'rain'"):
        assert frag in s


def test_snow_redirect_locks_snow():
    s = (ROOT / "snow.html").read_text()
    assert "weather.html" in s and "location.replace" in s and "'lock', 'snow'" in s
