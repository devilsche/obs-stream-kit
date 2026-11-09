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

GEO_FOUND = 86400
GEO_MISSING = 600

_lock = threading.Lock()
_cache = {}   # tenant_id → {"at", "loc", "value"}
_geo = {}     # Suchtext → {"at", "value"} — jede Overlay-Abfrage bringt den Ort mit


def reset_cache():
    with _lock:
        _cache.clear()
        _geo.clear()


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def geocode(query: str, now=None):
    """Ortsname → {"lat", "lon", "label"} oder None. Treffer 24 h im Cache,
    Fehlanzeigen 10 min."""
    query = (query or "").strip()
    if not query:
        return None
    now = time.time() if now is None else now
    key = query.lower()
    with _lock:
        hit = _geo.get(key)
    if hit and now - hit["at"] < (GEO_FOUND if hit["value"] else GEO_MISSING):
        return hit["value"]
    value = _geocode(query)
    with _lock:
        _geo[key] = {"at": now, "value": value}
    return value


def _geocode(query):
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


_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def lookup(place: str) -> dict:
    """Für die Dashboard-Karte: gefundener Ort, Wetter dort jetzt und
    Sonnenzeiten (Ortszeit). Nie für das Overlay."""
    loc = geocode(place)
    if not loc:
        return {"found": False}
    url = _FORECAST + "?" + urllib.parse.urlencode({
        "latitude": loc["lat"], "longitude": loc["lon"], "timezone": "auto", "forecast_days": 1,
        "current": "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,is_day",
        "daily": "sunrise,sunset"})
    out = {"found": True, "label": loc["label"]}
    try:
        data = _fetch_json(url)
        c, d = data["current"], data.get("daily") or {}
        state = from_api(int(c["weather_code"]), float(c["temperature_2m"]),
                         float(c["wind_speed_10m"]), float(c["wind_direction_10m"]))
        out.update(kind=state["kind"], temp=c["temperature_2m"], windKmh=c["wind_speed_10m"],
                   windFrom=_COMPASS[int((c["wind_direction_10m"] % 360) / 45 + 0.5) % 8],
                   cloud=c.get("cloud_cover"), isDay=bool(c.get("is_day")),
                   sunrise=(d.get("sunrise") or [""])[0][11:16] or None,
                   sunset=(d.get("sunset") or [""])[0][11:16] or None)
    except Exception as e:
        log.warning("weather: lookup failed (%s)", type(e).__name__)
    return out
