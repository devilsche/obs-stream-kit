"""Open-Meteo-Anbindung: Abbildung, Cache je Tenant, Fehlerfall."""
import pytest

from fx import weather_api
from fx.weather_api import current, geocode


@pytest.fixture(autouse=True)
def _reset():
    weather_api.reset_cache()
    yield
    weather_api.reset_cache()


def _ok(code=0, temp=10):
    return lambda url: {"current": {"weather_code": code, "temperature_2m": temp,
                                    "wind_speed_10m": 0, "wind_direction_10m": 0}}


def test_current_maps_and_caches(monkeypatch):
    calls = []

    def fake(url):
        calls.append(url)
        return {"current": {"weather_code": 63, "temperature_2m": 7.5,
                            "wind_speed_10m": 20, "wind_direction_10m": 250}}
    monkeypatch.setattr(weather_api, "_fetch_json", fake)
    assert current(1, 52.5, 13.4, now=0)["kind"] == "rain"
    current(1, 52.5, 13.4, now=500)                      # < 10 min → Cache
    assert len(calls) == 1
    current(1, 52.5, 13.4, now=700)                      # > 10 min → neu
    assert len(calls) == 2


def test_failure_keeps_last_good_for_an_hour(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", _ok())
    current(1, 1, 1, now=0)

    def boom(url):
        raise OSError("down")
    monkeypatch.setattr(weather_api, "_fetch_json", boom)
    assert current(1, 1, 1, now=700)["kind"] == "clear"
    assert current(1, 1, 1, now=3700) is None


def test_garbage_answer_is_a_failure(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {"current": {}})
    assert current(1, 1, 1, now=0) is None


def test_cache_is_per_tenant(monkeypatch):
    calls = []

    def fake(url):
        calls.append(url)
        return _ok()(url)
    monkeypatch.setattr(weather_api, "_fetch_json", fake)
    current(1, 1, 1, now=0)
    current(2, 1, 1, now=10)
    assert len(calls) == 2


def test_moved_location_refetches(monkeypatch):
    calls = []

    def fake(url):
        calls.append(url)
        return _ok()(url)
    monkeypatch.setattr(weather_api, "_fetch_json", fake)
    current(1, 1, 1, now=0)
    current(1, 50, 8, now=10)
    assert len(calls) == 2


def test_geocode_label(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {"results": [
        {"latitude": 50.1, "longitude": 8.7, "name": "Frankfurt am Main",
         "admin1": "Hessen", "country": "Deutschland"}]})
    assert geocode("Frankfurt") == {"lat": 50.1, "lon": 8.7,
                                    "label": "Frankfurt am Main, Hessen, Deutschland"}


def test_geocode_nothing_found(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {})
    assert geocode("xyzzy") is None
    assert geocode("   ") is None


def test_geocode_is_cached(monkeypatch):
    calls = []

    def fake(url):
        calls.append(url)
        return {"results": [{"latitude": 1, "longitude": 2, "name": "A"}]}
    monkeypatch.setattr(weather_api, "_fetch_json", fake)
    geocode("Hamburg", now=0)
    geocode("hamburg", now=3600)
    assert len(calls) == 1
    geocode("Hamburg", now=90000)
    assert len(calls) == 2


def test_lookup_reports_place_weather_and_sun(monkeypatch):
    def fake(url):
        if "geocoding" in url:
            return {"results": [{"latitude": 52.5, "longitude": 13.4, "name": "Berlin",
                                 "admin1": "Land Berlin", "country": "Deutschland"}]}
        return {"current": {"weather_code": 3, "temperature_2m": 3.5, "wind_speed_10m": 6.7,
                            "wind_direction_10m": 106, "cloud_cover": 70, "is_day": 1},
                "daily": {"sunrise": ["2026-11-09T07:21"], "sunset": ["2026-11-09T16:14"]}}
    monkeypatch.setattr(weather_api, "_fetch_json", fake)
    assert weather_api.lookup("Berlin") == {
        "found": True, "label": "Berlin, Land Berlin, Deutschland", "kind": "cloudy",
        "temp": 3.5, "windKmh": 6.7, "windFrom": "E", "cloud": 70, "isDay": True,
        "sunrise": "07:21", "sunset": "16:14"}


def test_lookup_unknown_place(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {})
    assert weather_api.lookup("Xyzzy") == {"found": False}
