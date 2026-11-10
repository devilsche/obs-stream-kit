"""Deko-Thema der Weather-Source und Ablauf der Xmas-Zeit.

Thema: `auto` wählt kalendarisch (Frühling ab 20.3., Sommer ab 21.6., Herbst
ab 22.9., Winter ab 21.12.; auf der Südhalbkugel versetzt, in den Tropen immer
Sommer, siehe climate_zone); die Xmas-Zeit, die im November beginnen kann, ist
immer Winter. Per Knopf (`cmd=season&to=…`) startet eine Jahreszeit früher und
hält, bis der Kalender sie erreicht. Ein aufgebauter Baum macht auch ein fest
gewähltes Thema zum Winter.

Xmas-Zeit: von `xmasfrom` (`advent` = 1. Advent oder `MM-DD`) bis `xmasto`
(`MM-DD`). Die Saison ist das Jahr des Beginns; Januar und Februar gehören
zur Vorjahres-Saison. Aufbau und Abschied sind ab dem Datum fällig und
werden gespielt, sobald die Source live ist (das Overlay meldet sie dann mit
`xmasdone` als erledigt); die Knöpfe `setup`/`farewell` springen sofort und
machen den fälligen Schritt der Saison hinfällig. DAO im sqlite-Stil.
"""
import datetime
import json
from datetime import date, timedelta

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_theme (
    tenant_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""
PG_SCHEMA = SCHEMA


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def advent1(year: int) -> date:
    """1. Advent: der Sonntag am oder nach dem 27. November."""
    d = date(year, 11, 27)
    return d + timedelta(days=(6 - d.weekday()) % 7)


def _mmdd(text, year):
    m, d = (int(x) for x in str(text).split("-"))
    return date(year, m, d)


def xmas_window(today: date, xfrom: str, xto: str):
    """→ (Beginn, Ende, Saison) der Xmas-Zeit, zu der `today` gehört."""
    season = today.year - 1 if today.month <= 2 else today.year
    try:
        start = advent1(season) if xfrom in (None, "", "advent") else _mmdd(xfrom, season)
    except (ValueError, TypeError):
        start = advent1(season)
    try:
        end = _mmdd(xto or "12-26", season)
    except (ValueError, TypeError):
        end = date(season, 12, 26)
    if end < start:
        end = end.replace(year=season + 1)
    return start, end, season


# Kalendarischer Beginn (Monat, Tag) je Jahreszeit, in Jahresreihenfolge;
# auf der Südhalbkugel um ein halbes Jahr versetzt
SEASON_START = (("spring", 3, 20), ("summer", 6, 21), ("autumn", 9, 22), ("winter", 12, 21))
SOUTH_START = (("autumn", 3, 20), ("winter", 6, 21), ("spring", 9, 22), ("summer", 12, 21))
TROPICS = 25.0


def climate_zone(lat, monthly=None) -> str:
    """Jahreszeiten am Ort → "north" | "south" | "summer" (immer Sommer) |
    "winter" (immer Winter). Klima (12 Monatsmittel) geht vor der Breite:
    kältester Monat ≥ 18 °C (tropisch) → Sommer, wärmster < 10 °C → Winter;
    ohne Klimadaten zählt alles unter 25° Breite als Tropen."""
    if lat is None:
        return "north"
    if monthly and len(monthly) == 12:
        if min(monthly) >= 18:
            return "summer"
        if max(monthly) < 10:
            return "winter"
    if abs(lat) < TROPICS:
        return "summer"
    return "south" if lat < 0 else "north"


def xmas_theme(zone: str = "north") -> str:
    """Wo die Weihnachts-Deko steht: im Norden im Winter, sonst am Strand."""
    return "winter" if zone in ("north", "winter") else "summer"


def _starts(zone):
    return SOUTH_START if zone == "south" else SEASON_START


def calendar_theme(today: date, zone: str = "north") -> str:
    if zone in ("summer", "winter"):
        return zone
    starts = _starts(zone)
    theme = starts[-1][0]
    for name, m, d in starts:
        if (today.month, today.day) >= (m, d):
            theme = name
    return theme


def next_start(today: date, theme: str, zone: str = "north") -> date:
    """Nächster kalendarischer Beginn von `theme` nach `today`."""
    m, d = next((m, d) for name, m, d in _starts(zone) if name == theme)
    start = date(today.year, m, d)
    return start if start > today else start.replace(year=today.year + 1)


def theme_for(today: date, setting: str, xmas_active: bool, early=None, set_up: bool = False,
              zone: str = "north") -> str:
    """Thema: `none` > aufgebauter Baum > fest gewählt > Xmas-Zeit > Frühstart > Kalender.
    Weihnachten steht im Norden im Winter, im Süden und in den Tropen am Strand."""
    if setting == "none":
        return "none"
    if set_up:
        return xmas_theme(zone)
    if setting in ("winter", "spring", "summer", "autumn"):
        return setting
    if xmas_active:
        return xmas_theme(zone)
    if early:
        try:
            if today < date.fromisoformat(early["until"]):
                return early["theme"]
        except (KeyError, TypeError, ValueError):
            pass
    return calendar_theme(today, zone)


def _load(conn, tenant_id):
    row = conn.execute("SELECT data FROM fx_weather_theme WHERE tenant_id = ?", (tenant_id,)).fetchone()
    if row:
        try:
            return json.loads(row["data"])
        except (TypeError, ValueError):
            pass
    return None


def _save(conn, tenant_id, data):
    """Xmas-Ablauf schreiben; Frühstart und Zone bleiben erhalten."""
    old = _load(conn, tenant_id) or {}
    for key in ("early", "zone", "tod"):
        if key in old:
            data = dict(data, **{key: old[key]})
    _write(conn, tenant_id, data)


def _write(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO fx_weather_theme (tenant_id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (tenant_id, json.dumps(data), stamp))
    conn.commit()


def status(conn, tenant_id, today: date, opts: dict, theme: str = "winter", zone: str = "north") -> str:
    """→ "off" | "setup" (fällig) | "on" | "farewell" (fällig); gespielt wird
    im Weihnachts-Thema der Zone (Winter bzw. Strand)."""
    xt = xmas_theme(zone)
    start, end, season = xmas_window(today, opts.get("xmasfrom"), opts.get("xmasto"))
    data = _load(conn, tenant_id)
    state = data["state"] if data and data.get("season") == season else "off"
    if state == "on":
        if today <= end:
            return "on"
        if theme == xt:
            return "farewell"
        # Thema schon gewechselt: still abbauen, kein Abschied mehr
        _save(conn, tenant_id, {"season": season, "state": "done"})
        return "off"
    if state == "off" and start <= today <= end and theme == xt:
        return "setup"
    return "off"


def is_set_up(conn, tenant_id, today: date, opts: dict) -> bool:
    """Steht der Baum gerade (Aufbau dieser Saison erledigt, Abschied noch nicht)?"""
    _, _, season = xmas_window(today, opts.get("xmasfrom"), opts.get("xmasto"))
    data = _load(conn, tenant_id)
    return bool(data and data.get("season") == season and data.get("state") == "on")


def mark(conn, tenant_id, today: date, opts: dict, step: str) -> None:
    """Aufbau (`setup`) bzw. Abschied (`farewell`) für die Saison erledigt."""
    _, _, season = xmas_window(today, opts.get("xmasfrom"), opts.get("xmasto"))
    _save(conn, tenant_id, {"season": season, "state": "on" if step == "setup" else "done"})


def early_start(conn, tenant_id, today: date, to: str, zone: str = "north") -> None:
    """Jahreszeit `to` (oder `next`) sofort starten; `auto` hebt den Frühstart auf."""
    if to == "next":
        cur = calendar_theme(today, zone)
        names = [n for n, _, _ in _starts(zone)]
        to = names[(names.index(cur) + 1) % len(names)]
    data = _load(conn, tenant_id) or {}
    if to in ("winter", "spring", "summer", "autumn"):
        data["early"] = {"theme": to, "until": next_start(today, to, zone).isoformat()}
    else:
        data.pop("early", None)
    _write(conn, tenant_id, data)


TIMES_OF_DAY = ("night", "dawn", "dusk")


def set_tod(conn, tenant_id, kind: str, hold, now: float) -> None:
    """Tageszeit übersteuern (night/dawn/dusk), unabhängig vom Wetter;
    hold in Sekunden, 0 = bis `auto`."""
    data = _load(conn, tenant_id) or {}
    data["tod"] = {"kind": kind, "until": now + hold if hold else None}
    _write(conn, tenant_id, data)


def clear_tod(conn, tenant_id) -> None:
    data = _load(conn, tenant_id)
    if data and data.pop("tod", None) is not None:
        _write(conn, tenant_id, data)


def current_tod(conn, tenant_id, now: float):
    """Laufende Tageszeit-Übersteuerung (night/dawn/dusk) oder None."""
    tod = (_load(conn, tenant_id) or {}).get("tod")
    if not tod:
        return None
    if tod.get("until") is not None and now >= tod["until"]:
        clear_tod(conn, tenant_id)
        return None
    return tod["kind"]


def remember_zone(conn, tenant_id, zone: str) -> None:
    """Zone des Orts merken: Befehle und Dashboard kennen den Ort nicht."""
    data = _load(conn, tenant_id) or {}
    if data.get("zone") != zone:
        data["zone"] = zone
        _write(conn, tenant_id, data)


def load_zone(conn, tenant_id) -> str:
    data = _load(conn, tenant_id)
    return (data or {}).get("zone") or "north"


def load_early(conn, tenant_id):
    data = _load(conn, tenant_id)
    return data.get("early") if data else None
