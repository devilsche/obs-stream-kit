"""Wirksamer Wetterzustand eines Tenants für effects/weather.html.

Schicht 1: echtes Wetter am Ort aus der Overlay-URL (place, sonst Ersatz-Lage),
Schicht 2: Stimmung aus der Session-K/D, Schicht 3: Chat-Übersteuerung.
Die Antwort enthält nie den Ort.
"""
import logging
import time

from fx import weather
from fx.weather_api import current, geocode
from fx.weather_db import current_override
from fx.weather_mood import kd_snapshot

log = logging.getLogger(__name__)

TRANSITION_SLOW = 25
TRANSITION_FAST = 4


def resolve(conn, tenant_id: int, opts: dict, now=None) -> dict:
    """opts: geparste Settings (place, mood, kdlow, kdhigh, kdtest, fallback)."""
    now = time.time() if now is None else now
    base, source = None, "fallback"
    try:
        loc = geocode(opts["place"]) if opts.get("place") else None
        if loc:
            base = current(tenant_id, loc["lat"], loc["lon"])
    except Exception:
        log.exception("weather: live weather failed for tenant %s", tenant_id)
    if base:
        source = "api"
        base = dict(base)
        rise, set_ = base.pop("_sunrise", None), base.pop("_sunset", None)
        if rise and set_:
            base.update(weather.daylight(now, rise, set_))
    else:
        base = weather.profile(opts.get("fallback") or "clear")

    kdtest = opts.get("kdtest")
    if isinstance(kdtest, float):
        snap = {"kd": kdtest, "matches": weather.MIN_MATCHES, "live": True}
    else:  # kein Test oder "off" → echte K/D
        try:
            snap = kd_snapshot(conn, tenant_id)
        except Exception:
            log.exception("weather: kd snapshot failed for tenant %s", tenant_id)
            snap = {"kd": 0.0, "matches": 0, "live": False}
    low, high = opts.get("kdlow"), opts.get("kdhigh")
    mood = weather.mood_value(snap["kd"], snap["matches"], snap["live"], low, high)
    strength = opts.get("mood", 1.0)
    precip = weather.mood_precip(snap["kd"], low) if mood < 0 else None
    state = weather.apply_mood(base, mood, strength, precip)

    until, transition = None, TRANSITION_SLOW
    ov = current_override(conn, tenant_id, now)
    if ov:
        # Übersteuerung ersetzt Lage und Stimmung, der echte Wind bleibt
        state = {**weather.profile(ov["kind"]), "wind": base.get("wind", 0)}
        if ov["kind"] not in ("night", "dusk"):
            state.update(night=base.get("night", 0), dusk=base.get("dusk", 0))
        source, until, transition = "override", ov["until"], TRANSITION_FAST

    state = weather.apply_daylight(state)
    state.update(source=source, until=until, transition=transition,
                 mood=round(mood * strength, 2))
    state.setdefault("temp", None)
    state.setdefault("frost", False)
    return state
