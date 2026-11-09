"""Ort fürs Live-Wetter in den Einstellungen."""
import json

from app import views_app
from fx import weather_api
from pubg.db_pg import get_setting

FOUND = {"lat": 50.1, "lon": 8.7, "label": "Frankfurt am Main, Hessen, Deutschland"}


def test_found_place_is_saved(pg, monkeypatch):
    conn, t1, t2 = pg
    monkeypatch.setattr(weather_api, "geocode", lambda q: FOUND if q == "Frankfurt" else None)
    assert views_app.save_weather_location(conn, t1, "Frankfurt", False) is None
    assert json.loads(get_setting(conn, t1, "weather.location")) == FOUND
    assert get_setting(conn, t2, "weather.location") is None


def test_unknown_place_saves_nothing(pg, monkeypatch):
    conn, t1, _ = pg
    monkeypatch.setattr(weather_api, "geocode", lambda q: None)
    assert views_app.save_weather_location(conn, t1, "xyzzy", False) == "not_found"
    assert get_setting(conn, t1, "weather.location") is None


def test_clear_removes(pg, monkeypatch):
    conn, t1, _ = pg
    monkeypatch.setattr(weather_api, "geocode", lambda q: FOUND)
    views_app.save_weather_location(conn, t1, "Frankfurt", False)
    assert views_app.save_weather_location(conn, t1, "", True) is None
    assert get_setting(conn, t1, "weather.location") is None


def test_label_for_display(pg, monkeypatch):
    conn, t1, _ = pg
    monkeypatch.setattr(weather_api, "geocode", lambda q: FOUND)
    views_app.save_weather_location(conn, t1, "Frankfurt", False)
    assert views_app.weather_location_label(conn, t1) == FOUND["label"]
