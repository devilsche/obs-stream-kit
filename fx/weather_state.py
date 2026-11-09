"""Wirksamer Wetterzustand eines Tenants für effects/weather.html.

Schicht 1: echtes Wetter am Ort aus der Overlay-URL (place, sonst Ersatz-Lage),
Schicht 2: Stimmung aus der Session-K/D, Schicht 3: Chat-Übersteuerung.
Die Antwort enthält nie den Ort.
"""
import logging
import time

import datetime

from fx import astro, weather, weather_frost, weather_snow, weather_theme
from fx.weather_api import current, geocode
from fx.weather_db import current_override
from fx.weather_mood import kd_snapshot

log = logging.getLogger(__name__)

TRANSITION_SLOW = 25
AURORA_KD = 3.0


def _sky(now, lat, lon) -> dict:
    """Sonne und Mond als grobe Bildposition (verrät den Ort nicht)."""
    s_az, s_alt = astro.sun_position(now, lat, lon)
    m_az, m_alt = astro.moon_position(now, lat, lon)
    lit, phase = astro.moon_illumination(now)
    sx, sy = astro.sky_xy(s_az, s_alt, lat)
    mx, my = astro.sky_xy(m_az, m_alt, lat)
    return {"sunUp": 1 if s_alt > 0 else 0, "sunX": sx, "sunY": sy,
            "moonUp": 1 if m_alt > 0 else 0, "moonX": mx, "moonY": my,
            "moonLit": round(lit, 2), "moonWax": 1 if phase < 0.5 else 0}
TRANSITION_FAST = 4


def resolve(conn, tenant_id: int, opts: dict, now=None) -> dict:
    """opts: geparste Settings (place, lock, mood, kdlow, kdhigh, kdtest, fallback)."""
    now = time.time() if now is None else now
    base, source, loc = None, "fallback", None
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

    # Feste Lage ersetzt nur das echte Wetter; Tageszeit vom Ort bleibt,
    # Stimmung und Chat wirken weiter darüber
    lock = opts.get("lock")
    if lock and lock != "off":
        fixed = weather.profile(lock)
        if lock not in ("night", "dawn", "dusk"):
            fixed.update(night=base.get("night", 0), dusk=base.get("dusk", 0))
        base, source = fixed, "lock"

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
        if ov["kind"] not in ("night", "dawn", "dusk"):
            state.update(night=base.get("night", 0), dusk=base.get("dusk", 0))
        source, until, transition = "override", ov["until"], TRANSITION_FAST

    state = weather.apply_daylight(state)
    if loc:
        state.update(_sky(now, loc["lat"], loc["lon"]))
    # Feste Nacht/Dämmerung zum Testen: feste Szene statt echtem Himmel
    # (sonst wäre bei Neumond oder tagsüber kein Mond zu sehen)
    if lock == "night":
        state.update(sunUp=0, sunX=0.1, sunY=1, moonUp=1, moonX=0.78, moonY=0.2, moonLit=0.9, moonWax=1)
    elif lock == "dawn":
        state.update(sunUp=1, sunX=0.12, sunY=0.92, moonUp=0, moonX=0.8, moonY=1, moonLit=0.5, moonWax=1)
    elif lock == "dusk":
        state.update(sunUp=1, sunX=0.88, sunY=0.92, moonUp=0, moonX=0.2, moonY=1, moonLit=0.5, moonWax=1)
    # Polarlicht als Belohnung: sehr gute K/D bei Nacht (aurorakd 0 = aus)
    thr = opts.get("aurorakd", AURORA_KD)
    aurora = 0.0
    if thr and strength and snap["live"] and snap["matches"] >= weather.MIN_MATCHES:
        aurora = state.get("night", 0) * min(1.0, max(0.0, (snap["kd"] - thr + 0.2) / 0.4))
        # hinter Wolken und bei Niederschlag sieht man kein Polarlicht; zählt das
        # echte Wetter, die gute K/D reißt keine geschlossene Decke auf
        # (Schleier bis 0,1 zählt nicht, 0,7 = bedeckt)
        wet = min(1.0, state.get("rain", 0) + state.get("drizzle", 0) + state.get("snow", 0))
        aurora *= min(1.0, max(0.0, 1 - (base.get("clouds", 0) - 0.1) / 0.6)) * (1 - wet)
    state["aurora"] = round(aurora, 2)
    state.update(source=source, until=until, transition=transition,
                 mood=round(mood * strength, 2))
    state.setdefault("temp", None)
    state.setdefault("freezing", False)
    # Frost-Ebene: wächst bei echter Temperatur ≤ 0 °C oder im Schneesturm
    frost = {"level": 0, "top": []}
    try:
        frost = weather_frost.advance(conn, tenant_id, now, base.get("temp") if source == "api" else None,
                                      state.get("kind") == "blizzard", opts.get("frostrate", 1.0),
                                      heat=state.get("heat", 0) > 0.5)
    except Exception:
        log.exception("weather: frost failed for tenant %s", tenant_id)
    state.update(frost=frost["level"], frostTop=frost["top"], frostOn=opts.get("frost", True))
    # Deko-Thema und Xmas-Ablauf; Schneedecke wächst mit dem wirksamen Schneefall
    today = datetime.date.fromtimestamp(now)
    try:
        start, end, _ = weather_theme.xmas_window(today, opts.get("xmasfrom"), opts.get("xmasto"))
        theme = weather_theme.theme_for(today, opts.get("theme", "auto"), start <= today <= end)
        xmas = weather_theme.status(conn, tenant_id, today, opts, theme) if theme == "winter" else "off"
        snow = weather_snow.advance(conn, tenant_id, now, state.get("snow", 0) if state.get("precip") != "rain" else 0,
                                    state.get("heat", 0) > 0.5, base.get("temp") if source == "api" else None,
                                    opts.get("snowrate", 1.0))
    except Exception:
        log.exception("weather: theme failed for tenant %s", tenant_id)
        theme, xmas, snow = "none", "off", {"level": 0, "top": []}
    state.update(theme=theme, xmas=xmas, snowCover=snow["level"], snowTop=snow["top"])
    return state
