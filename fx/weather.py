"""Wetterlogik der Weather-Source (effects/weather.html).

Drei Schichten: echtes Wetter (Open-Meteo, fx/weather_api.py), darüber die
Stimmung aus der Session-K/D, darüber zeitweise Chat-Übersteuerungen
(fx/weather_db.py). Hier liegen nur die reinen Regeln.

Die Profile spiegeln PROFILES in js/weather-kit.js 1:1 — der Server liefert
den fertigen Zustand, das Overlay blendet nur noch über.
"""

# rain/drizzle/snow = Niederschlagsmenge 0..1, clouds/sun/fog/heat 0..1,
# lightning 0..2 (aus, selten, oft), windMin = Mindestwind der Lage,
# night 0..1 (Sterne statt Sonne), dusk 0..1 (Dämmerungsfarben),
# gloom 0..1 = Grundtrübung am Rand bei nassem Wetter (fehlt = 0)
PROFILES = {
    "clear":    {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.08, "sun": 0.55, "fog": 0,    "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0},
    "cloudy":   {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.7,  "sun": 0.05, "fog": 0.05, "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0},
    "fog":      {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.45, "sun": 0,    "fog": 0.85, "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0},
    "drizzle":  {"precip": "rain", "rain": 0,    "drizzle": 0.7, "snow": 0,    "clouds": 0.6,  "sun": 0,    "fog": 0.15, "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0, "gloom": 0.15},
    "rain":     {"precip": "rain", "rain": 0.75,  "drizzle": 0.2, "snow": 0,    "clouds": 0.75, "sun": 0,    "fog": 0.1,  "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0, "gloom": 0.3},
    "storm":    {"precip": "rain", "rain": 1,    "drizzle": 0.3, "snow": 0,    "clouds": 0.95, "sun": 0,    "fog": 0.15, "heat": 0, "lightning": 2, "windMin": 0.6, "night": 0, "dusk": 0, "gloom": 0.6},
    "sleet":    {"precip": "mix",  "rain": 0.35, "drizzle": 0.1, "snow": 0.45, "clouds": 0.75, "sun": 0,    "fog": 0.15, "heat": 0, "lightning": 0, "windMin": 0.2, "night": 0, "dusk": 0, "gloom": 0.25},
    "snow":     {"precip": "snow", "rain": 0,    "drizzle": 0,   "snow": 0.6,  "clouds": 0.6,  "sun": 0,    "fog": 0.1,  "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0},
    "blizzard": {"precip": "snow", "rain": 0,    "drizzle": 0,   "snow": 1,    "clouds": 0.85, "sun": 0,    "fog": 0.4,  "heat": 0, "lightning": 0, "windMin": 0.85, "night": 0, "dusk": 0, "gloom": 0.4},
    "heat":     {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0,    "sun": 1,    "fog": 0,    "heat": 1, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0},
    # nur als feste Lage / Chat-Befehl; live kommen Nacht und Dämmerung aus daylight()
    "day":      {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.08, "sun": 0.55, "fog": 0,    "heat": 0, "lightning": 0, "windMin": 0, "night": 0, "dusk": 0},
    "night":    {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.05, "sun": 0,    "fog": 0,    "heat": 0, "lightning": 0, "windMin": 0, "night": 1, "dusk": 0},
    "dawn":     {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.15, "sun": 0.35, "fog": 0.1,  "heat": 0, "lightning": 0, "windMin": 0, "night": 0.2, "dusk": 1},
    "dusk":     {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.15, "sun": 0.35, "fog": 0,    "heat": 0, "lightning": 0, "windMin": 0, "night": 0.2, "dusk": 1},
}
KINDS = tuple(PROFILES)
SPECTACLES = ("tsunami", "megabolt", "ballbolt", "avalanche",
              "aurora", "rainbow", "hail", "meteors", "tornado", "fogwall")

# Stimmungsgrenzen ab Werk: unter 1,5 schlecht, über 2,5 gut
KD_LOW = 1.5
KD_HIGH = 2.5
MIN_MATCHES = 3


def _clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def profile(kind: str) -> dict:
    k = kind if kind in PROFILES else "clear"
    return {"kind": k, "gloom": 0, "wind": 0, **PROFILES[k]}


def _kind_for_code(code: int, temp_c: float, wind_kmh: float) -> str:
    if code in (0, 1, 2, 3):
        if temp_c >= 30:
            return "heat"
        return "clear" if code <= 2 else "cloudy"
    if code in (45, 48):
        return "fog"
    if 51 <= code <= 55:
        return "drizzle"
    if code in (56, 57, 66, 67):
        return "sleet"
    if 61 <= code <= 65 or 80 <= code <= 82:
        return "rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "blizzard" if code in (75, 86) and wind_kmh >= 40 else "snow"
    if 95 <= code <= 99:
        return "storm"
    return "clear"


def from_api(code: int, temp_c: float, wind_kmh: float, wind_dir: float, cloud=None) -> dict:
    """WMO-Wettercode + Temperatur + Wind → Zustand. Wind aus Westen
    (180–360°) weht im Bild nach rechts (+). Bei klarem bis teilweise
    bewölktem Himmel bestimmt der Wolkenanteil (0–100 %), wie viel Sonne
    durchkommt."""
    s = profile(_kind_for_code(int(code), temp_c, wind_kmh))
    if s["kind"] == "clear" and cloud is not None:
        cc = _clamp(cloud / 100)
        s["clouds"] = round(0.08 + 0.6 * cc, 2)
        s["sun"] = round(0.55 * (1 - 0.7 * cc), 3)
    if code in (65, 82):
        s["rain"] = 0.85
    strength = min(1.0, max(0.0, wind_kmh) / 50)
    sign = 1 if 180 <= (wind_dir % 360) <= 360 else -1
    s["wind"] = round(sign * strength, 2)
    s["temp"] = temp_c
    s["freezing"] = temp_c <= 0
    return s


TWILIGHT = 2700   # Dämmerung ±45 min um Auf-/Untergang


def daylight(now: float, sunrise: float, sunset: float) -> dict:
    """Nacht (0..1) und Dämmerung (0..1) aus Unix-Zeiten des Tages. Die Nacht
    zieht ab 15 min vor Sonnenuntergang innerhalb einer Stunde auf und
    weicht spiegelbildlich vor Sonnenaufgang."""
    dusk = max(0.0, 1 - abs(now - sunrise) / TWILIGHT, 1 - abs(now - sunset) / TWILIGHT)
    night = max(_clamp((now - (sunset - 900)) / 3600), _clamp(((sunrise + 900) - now) / 3600))
    return {"night": round(night, 2), "dusk": round(dusk, 2)}


def apply_daylight(state: dict) -> dict:
    """Nachts keine Sonne."""
    n = state.get("night") or 0
    if n:
        state = dict(state)
        state["sun"] = round(state["sun"] * (1 - n), 3)
    return state


def mood_value(kd, matches, live, low=None, high=None) -> float:
    """−1 (schlecht) … 1 (gut), linear um die Mitte der Grenzen. Neutral
    ohne laufende Session oder mit weniger als drei Runden."""
    low = KD_LOW if low is None else low
    high = KD_HIGH if high is None else high
    if not live or matches < MIN_MATCHES or high <= low:
        return 0
    if kd <= low:
        return -1
    if kd >= high:
        return 1
    mid = (low + high) / 2
    if kd < mid:
        return -(mid - kd) / (mid - low)
    return (kd - mid) / (high - mid)


def mood_precip(kd, low=None):
    """Niederschlag aus schlechter K/D: Niesel ab der unteren Grenze,
    Regen ab drei Vierteln davon. Nie Gewitter."""
    low = KD_LOW if low is None else low
    if kd > low:
        return None
    return "rain" if kd <= low * 0.75 else "drizzle"


def apply_mood(state: dict, mood: float, strength: float, precip) -> dict:
    """Färbt den Zustand: gute Stimmung lockert Wolken und bringt Sonne,
    schlechte trübt ein (gloom = Abdunklung am Rand) und holt bei trockenem
    Wetter Niesel oder Regen."""
    if not strength:
        return state
    s = dict(state)
    e = _clamp(mood * strength, -1, 1)
    wet = s["precip"] != "none"
    if e > 0:
        # Gewitter und Schneesturm bleiben dunkel, sonst Sonnenregen
        heavy = s["kind"] in ("storm", "blizzard")
        # bedeckt bleibt bedeckt: die Sonne blitzt nur durch Lücken
        overcast = s["kind"] in ("cloudy", "fog")
        s["clouds"] = _clamp(s["clouds"] * (1 - (0.35 if overcast else 0.7) * e))
        cap = 0.25 if heavy else 0.4 if overcast else 0.6 if wet else 1
        s["sun"] = max(s["sun"], cap * e)
        s["fog"] = _clamp(s["fog"] * (1 - 0.5 * e))
        s["gloom"] = round(s.get("gloom", 0) * (1 - 0.7 * e), 3)
    elif e < 0:
        a = -e
        s["clouds"] = _clamp(s["clouds"] + 0.6 * a)
        s["fog"] = _clamp(s["fog"] + 0.4 * a)
        s["sun"] = s["sun"] * (1 - a)
        s["heat"] = _clamp(s.get("heat", 0) * (1 - 0.6 * a))
        s["gloom"] = max(s.get("gloom", 0), a)
    if precip and not wet:
        # Regen aus der Stimmung kühlt eine Hitzewelle fast ganz ab
        p = PROFILES[precip]
        s.update(kind=precip, precip="rain", rain=p["rain"], drizzle=p["drizzle"],
                 clouds=max(s["clouds"], p["clouds"]), sun=0, lightning=0,
                 heat=round(s.get("heat", 0) * 0.2, 3))
    return apply_daylight(s)
