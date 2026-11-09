"""Open-Meteo-Anbindung der Weather-Source (ohne API-Key).

Aktuelles Wetter je Tenant mit Cache: frisch 10 min; schlägt ein Abruf fehl,
gilt der letzte gute Wert bis zu 60 min weiter. Koordinaten landen nie im
Log und nie in einer Overlay-Antwort.
"""
import json
import logging
import threading
import time
import urllib.parse
import urllib.request

from fx.weather import from_api

log = logging.getLogger(__name__)

FRESH = 600
STALE = 3600
_FORECAST = "https://api.open-meteo.com/v1/forecast"
_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"

_lock = threading.Lock()
_cache = {}   # tenant_id → {"at", "loc", "value"}


def reset_cache():
    with _lock:
        _cache.clear()


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def geocode(query: str):
    """Ortsname → {"lat", "lon", "label"} oder None."""
    query = (query or "").strip()
    if not query:
        return None
    url = _GEOCODE + "?" + urllib.parse.urlencode(
        {"name": query, "count": 1, "language": "de", "format": "json"})
    try:
        data = _fetch_json(url)
    except Exception:
        log.warning("weather: geocoding failed")
        return None
    results = data.get("results") or []
    if not results:
        return None
    r = results[0]
    label = ", ".join(p for p in (r.get("name"), r.get("admin1"), r.get("country")) if p)
    return {"lat": r["latitude"], "lon": r["longitude"], "label": label}


def current(tenant_id: int, lat: float, lon: float, now=None):
    """Aktueller Zustand (fx.weather.from_api) oder None."""
    now = time.time() if now is None else now
    loc = (round(lat, 3), round(lon, 3))
    with _lock:
        hit = _cache.get(tenant_id)
    if hit and hit["loc"] == loc and now - hit["at"] < FRESH:
        return hit["value"]
    url = _FORECAST + "?" + urllib.parse.urlencode({
        "latitude": lat, "longitude": lon,
        "current": "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m"})
    try:
        c = _fetch_json(url)["current"]
        value = from_api(int(c["weather_code"]), float(c["temperature_2m"]),
                         float(c["wind_speed_10m"]), float(c["wind_direction_10m"]))
    except Exception as e:
        log.warning("weather: fetch failed for tenant %s (%s)", tenant_id, type(e).__name__)
        if hit and hit["loc"] == loc and now - hit["at"] < STALE:
            return hit["value"]
        return None
    with _lock:
        _cache[tenant_id] = {"at": now, "loc": loc, "value": value}
    return value
