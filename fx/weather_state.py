"""Wirksamer Wetterzustand eines Tenants für effects/weather.html.

Schicht 1: echtes Wetter am hinterlegten Ort (sonst Ersatz-Lage),
Schicht 2: Stimmung aus der Session-K/D, Schicht 3: Chat-Übersteuerung.
Die Antwort enthält nie den Ort.
"""
import json
import logging
import time

from fx import weather
from fx.weather_api import current
from fx.weather_db import current_override
from fx.weather_mood import kd_snapshot

log = logging.getLogger(__name__)

TRANSITION_SLOW = 25
TRANSITION_FAST = 4


def _location(conn, tenant_id):
    row = conn.execute("SELECT value FROM settings WHERE tenant_id = ? AND key = ?",
                       (tenant_id, "weather.location")).fetchone()
    if not row:
        return None
    try:
        loc = json.loads(row["value"])
        return float(loc["lat"]), float(loc["lon"])
    except (TypeError, ValueError, KeyError):
        return None


def resolve(conn, tenant_id: int, opts: dict, now=None) -> dict:
    """opts: geparste Settings (mood, kdlow, kdhigh, kdtest, fallback)."""
    now = time.time() if now is None else now
    base, source = None, "fallback"
    try:
        loc = _location(conn, tenant_id)
        if loc:
            base = current(tenant_id, *loc)
    except Exception:
        log.exception("weather: live weather failed for tenant %s", tenant_id)
    if base:
        source = "api"
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
        source, until, transition = "override", ov["until"], TRANSITION_FAST

    state.update(source=source, until=until, transition=transition,
                 mood=round(mood * strength, 2))
    state.setdefault("temp", None)
    state.setdefault("frost", False)
    return state
