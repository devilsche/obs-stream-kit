"""Open-Meteo-Anbindung der Weather-Source (ohne API-Key).

Aktuelles Wetter je Tenant mit Cache: frisch 10 min; schlägt ein Abruf fehl,
gilt der letzte gute Wert bis zu 60 min weiter. Koordinaten landen nie im
Log und nie in einer Overlay-Antwort.
"""
import json
import logging
import re
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
        _climate.clear()


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


_COORD_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


def geocode(query: str, now=None):
    """Ortsname → {"lat", "lon", "label"} oder None. Treffer 24 h im Cache,
    Fehlanzeigen 10 min. Erlaubt: "Ort", "Ort, Region/Land/Ländercode"
    (filtert die Treffer) oder Koordinaten "Breite, Länge"."""
    found = matches(query, now)
    return found[0]["loc"] if found else None


def matches(query: str, now=None) -> list:
    """Alle passenden Orte (höchstens 8) als {"loc", "value"}; value ist
    ein eindeutiger Suchtext ("Ort, Region, CC") für die Auswahl."""
    query = (query or "").strip()
    if not query:
        return []
    m = _COORD_RE.match(query)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return []
        label = "%g, %g" % (lat, lon)
        return [{"loc": {"lat": lat, "lon": lon, "label": label}, "value": label}]
    now = time.time() if now is None else now
    key = query.lower()
    with _lock:
        hit = _geo.get(key)
    if hit and now - hit["at"] < (GEO_FOUND if hit["value"] else GEO_MISSING):
        return hit["value"]
    parts = [p.strip() for p in query.split(",") if p.strip()]
    value = _search(parts[0], [q.lower() for q in parts[1:]])
    with _lock:
        _geo[key] = {"at": now, "value": value}
    return value


def _fits(r, qualifiers):
    names = [str(r.get(k) or "").lower() for k in ("admin1", "admin2", "country")]
    code = str(r.get("country_code") or "").lower()
    return all(q == code or any(q in n for n in names if n) for q in qualifiers)


def _search(name, qualifiers):
    url = _GEOCODE + "?" + urllib.parse.urlencode(
        {"name": name, "count": 10, "language": "de", "format": "json"})
    try:
        data = _fetch_json(url)
    except Exception:
        log.warning("weather: geocoding failed")
        return []
    out = []
    for r in data.get("results") or []:
        if not _fits(r, qualifiers):
            continue
        land = r.get("country") or r.get("country_code")
        # Teile nicht doppelt nennen ("Kanada, Kanada")
        seen, bits = set(), []
        for p in (r.get("name"), r.get("admin1"), land):
            if p and p not in seen:
                seen.add(p)
                bits.append(p)
        label = ", ".join(bits)
        value = ", ".join(p for p in (r.get("name"), r.get("admin1"), r.get("country_code")) if p)
        out.append({"loc": {"lat": r["latitude"], "lon": r["longitude"], "label": label}, "value": value})
    return out[:8]


def current(tenant_id: int, lat: float, lon: float, now=None):
    """Aktueller Zustand (fx.weather.from_api) oder None."""
    now = time.time() if now is None else now
    loc = (round(lat, 3), round(lon, 3))
    with _lock:
        hit = _cache.get(tenant_id)
    if hit and hit["loc"] == loc and now - hit["at"] < FRESH:
        return hit["value"]
    url = _FORECAST + "?" + urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "timeformat": "unixtime",
        "forecast_days": 1, "daily": "sunrise,sunset",
        "current": "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover"})
    try:
        data = _fetch_json(url)
        c = data["current"]
        cloud = c.get("cloud_cover")
        value = from_api(int(c["weather_code"]), float(c["temperature_2m"]),
                         float(c["wind_speed_10m"]), float(c["wind_direction_10m"]),
                         cloud=float(cloud) if cloud is not None else None)
        # Sonnenzeiten nur intern: verraten ungefähr den Ort, gehen nie ans Overlay
        daily = data.get("daily") or {}
        if daily.get("sunrise") and daily.get("sunset"):
            value["_sunrise"] = float(daily["sunrise"][0])
            value["_sunset"] = float(daily["sunset"][0])
    except Exception as e:
        log.warning("weather: fetch failed for tenant %s (%s)", tenant_id, type(e).__name__)
        if hit and hit["loc"] == loc and now - hit["at"] < STALE:
            return hit["value"]
        return None
    with _lock:
        _cache[tenant_id] = {"at": now, "loc": loc, "value": value}
    return value


_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
CLIMATE_FRESH = 30 * 86400
CLIMATE_RETRY = 3600
_climate = {}   # (lat, lon) auf 1 Stelle → {"at", "value"}


def climate(lat: float, lon: float, now=None):
    """Monatsmittel der Temperatur (12 Werte, Januar zuerst) aus dem
    Vorjahr, für die Jahreszeiten am Ort; None, wenn nicht abrufbar.
    30 Tage im Cache, ein Fehlschlag wird erst nach einer Stunde neu versucht."""
    import datetime
    now = time.time() if now is None else now
    key = (round(lat, 1), round(lon, 1))
    with _lock:
        hit = _climate.get(key)
    if hit and now - hit["at"] < (CLIMATE_FRESH if hit["value"] else CLIMATE_RETRY):
        return hit["value"]
    year = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).year - 1
    url = _ARCHIVE + "?" + urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "daily": "temperature_2m_mean",
        "start_date": "%d-01-01" % year, "end_date": "%d-12-31" % year})
    value = None
    try:
        daily = _fetch_json(url)["daily"]
        sums, counts = [0.0] * 12, [0] * 12
        for day, t in zip(daily["time"], daily["temperature_2m_mean"]):
            if t is None:
                continue
            m = int(day[5:7]) - 1
            sums[m] += float(t)
            counts[m] += 1
        if all(counts):
            value = [round(sums[i] / counts[i], 1) for i in range(12)]
    except Exception as e:
        log.warning("weather: climate fetch failed (%s)", type(e).__name__)
    with _lock:
        _climate[key] = {"at": now, "value": value}
    return value


_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def lookup(place: str) -> dict:
    """Für die Dashboard-Karte: gefundener Ort, Wetter dort jetzt und
    Sonnenzeiten (Ortszeit). Nie für das Overlay."""
    found = matches(place)
    if not found:
        return {"found": False}
    loc = found[0]["loc"]
    url = _FORECAST + "?" + urllib.parse.urlencode({
        "latitude": loc["lat"], "longitude": loc["lon"], "timezone": "auto", "forecast_days": 1,
        "current": "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,is_day",
        "daily": "sunrise,sunset"})
    out = {"found": True, "label": loc["label"],
           "alternatives": [{"label": f["loc"]["label"], "value": f["value"]} for f in found]
           if len(found) > 1 else []}
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
        # Ortszeit aus dem UTC-Versatz des Orts (Open-Meteo timezone=auto)
        offset = data.get("utc_offset_seconds")
        if offset is not None:
            out["localTime"] = time.strftime("%H:%M", time.gmtime(time.time() + float(offset)))
            out["tz"] = data.get("timezone_abbreviation")
    except Exception as e:
        log.warning("weather: lookup failed (%s)", type(e).__name__)
    return out
