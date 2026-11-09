"""Wetterlogik der Weather-Source (effects/weather.html).

Drei Schichten: echtes Wetter (Open-Meteo, fx/weather_api.py), darüber die
Stimmung aus der Session-K/D, darüber zeitweise Chat-Übersteuerungen
(fx/weather_db.py). Hier liegen nur die reinen Regeln.

Die Profile spiegeln PROFILES in js/weather-kit.js 1:1 — der Server liefert
den fertigen Zustand, das Overlay blendet nur noch über.
"""

# rain/drizzle/snow = Niederschlagsmenge 0..1, clouds/sun/fog/heat 0..1,
# lightning 0..2 (aus, selten, oft), windMin = Mindestwind der Lage
PROFILES = {
    "clear":    {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.08, "sun": 0.55, "fog": 0,    "heat": 0, "lightning": 0, "windMin": 0},
    "cloudy":   {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.7,  "sun": 0.05, "fog": 0.05, "heat": 0, "lightning": 0, "windMin": 0},
    "fog":      {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0.45, "sun": 0,    "fog": 0.85, "heat": 0, "lightning": 0, "windMin": 0},
    "drizzle":  {"precip": "rain", "rain": 0,    "drizzle": 0.7, "snow": 0,    "clouds": 0.6,  "sun": 0,    "fog": 0.15, "heat": 0, "lightning": 0, "windMin": 0},
    "rain":     {"precip": "rain", "rain": 0.6,  "drizzle": 0.2, "snow": 0,    "clouds": 0.75, "sun": 0,    "fog": 0.1,  "heat": 0, "lightning": 0, "windMin": 0},
    "storm":    {"precip": "rain", "rain": 1,    "drizzle": 0.3, "snow": 0,    "clouds": 0.95, "sun": 0,    "fog": 0.15, "heat": 0, "lightning": 2, "windMin": 0.6},
    "sleet":    {"precip": "mix",  "rain": 0.35, "drizzle": 0.1, "snow": 0.45, "clouds": 0.75, "sun": 0,    "fog": 0.15, "heat": 0, "lightning": 0, "windMin": 0.2},
    "snow":     {"precip": "snow", "rain": 0,    "drizzle": 0,   "snow": 0.6,  "clouds": 0.6,  "sun": 0,    "fog": 0.1,  "heat": 0, "lightning": 0, "windMin": 0},
    "blizzard": {"precip": "snow", "rain": 0,    "drizzle": 0,   "snow": 1,    "clouds": 0.85, "sun": 0,    "fog": 0.4,  "heat": 0, "lightning": 0, "windMin": 0.85},
    "heat":     {"precip": "none", "rain": 0,    "drizzle": 0,   "snow": 0,    "clouds": 0,    "sun": 1,    "fog": 0,    "heat": 1, "lightning": 0, "windMin": 0},
}
KINDS = tuple(PROFILES)
SPECTACLES = ("tsunami", "megabolt", "ballbolt", "avalanche")

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
        return "clear" if code <= 1 else "cloudy"
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


def from_api(code: int, temp_c: float, wind_kmh: float, wind_dir: float) -> dict:
    """WMO-Wettercode + Temperatur + Wind → Zustand. Wind aus Westen
    (180–360°) weht im Bild nach rechts (+)."""
    s = profile(_kind_for_code(int(code), temp_c, wind_kmh))
    if code in (65, 82):
        s["rain"] = 0.85
    strength = min(1.0, max(0.0, wind_kmh) / 50)
    sign = 1 if 180 <= (wind_dir % 360) <= 360 else -1
    s["wind"] = round(sign * strength, 2)
    s["temp"] = temp_c
    s["frost"] = temp_c <= 0
    return s


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
        s["clouds"] = _clamp(s["clouds"] * (1 - 0.7 * e))
        s["sun"] = max(s["sun"], 0.6 * e if wet else e)
    elif e < 0:
        a = -e
        s["clouds"] = _clamp(s["clouds"] + 0.6 * a)
        s["fog"] = _clamp(s["fog"] + 0.4 * a)
        s["sun"] = s["sun"] * (1 - a)
        s["gloom"] = a
    if precip and not wet:
        p = PROFILES[precip]
        s.update(kind=precip, precip="rain", rain=p["rain"], drizzle=p["drizzle"],
                 clouds=max(s["clouds"], p["clouds"]), sun=0, lightning=0)
    return s
