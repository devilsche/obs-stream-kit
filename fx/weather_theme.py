"""Deko-Thema der Weather-Source und Ablauf der Xmas-Zeit.

Thema: `auto` wählt kalendarisch (Frühling ab 20.3., Sommer ab 21.6., Herbst
ab 22.9., Winter ab 21.12.); die Xmas-Zeit, die im November beginnen kann, ist
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


# Kalendarischer Beginn (Monat, Tag) je Jahreszeit, in Jahresreihenfolge
SEASON_START = (("spring", 3, 20), ("summer", 6, 21), ("autumn", 9, 22), ("winter", 12, 21))


def calendar_theme(today: date) -> str:
    theme = "winter"
    for name, m, d in SEASON_START:
        if (today.month, today.day) >= (m, d):
            theme = name
    return theme


def next_start(today: date, theme: str) -> date:
    """Nächster kalendarischer Beginn von `theme` nach `today`."""
    m, d = next((m, d) for name, m, d in SEASON_START if name == theme)
    start = date(today.year, m, d)
    return start if start > today else start.replace(year=today.year + 1)


def theme_for(today: date, setting: str, xmas_active: bool, early=None, set_up: bool = False) -> str:
    """Thema: `none` > aufgebauter Baum > fest gewählt > Xmas-Zeit > Frühstart > Kalender."""
    if setting == "none":
        return "none"
    if set_up:
        return "winter"
    if setting in ("winter", "spring", "summer", "autumn"):
        return setting
    if xmas_active:
        return "winter"
    if early:
        try:
            if today < date.fromisoformat(early["until"]):
                return early["theme"]
        except (KeyError, TypeError, ValueError):
            pass
    return calendar_theme(today)


def _load(conn, tenant_id):
    row = conn.execute("SELECT data FROM fx_weather_theme WHERE tenant_id = ?", (tenant_id,)).fetchone()
    if row:
        try:
            return json.loads(row["data"])
        except (TypeError, ValueError):
            pass
    return None


def _save(conn, tenant_id, data):
    """Xmas-Ablauf schreiben; ein Frühstart bleibt erhalten."""
    old = _load(conn, tenant_id) or {}
    if "early" in old:
        data = dict(data, early=old["early"])
    _write(conn, tenant_id, data)


def _write(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO fx_weather_theme (tenant_id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (tenant_id, json.dumps(data), stamp))
    conn.commit()


def status(conn, tenant_id, today: date, opts: dict, theme: str = "winter") -> str:
    """→ "off" | "setup" (fällig) | "on" | "farewell" (fällig)."""
    start, end, season = xmas_window(today, opts.get("xmasfrom"), opts.get("xmasto"))
    data = _load(conn, tenant_id)
    state = data["state"] if data and data.get("season") == season else "off"
    if state == "on":
        if today <= end:
            return "on"
        if theme == "winter":
            return "farewell"
        # Thema schon gewechselt: still abbauen, kein Abschied mehr
        _save(conn, tenant_id, {"season": season, "state": "done"})
        return "off"
    if state == "off" and start <= today <= end and theme == "winter":
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


def early_start(conn, tenant_id, today: date, to: str) -> None:
    """Jahreszeit `to` (oder `next`) sofort starten; `auto` hebt den Frühstart auf."""
    if to == "next":
        cur = calendar_theme(today)
        names = [n for n, _, _ in SEASON_START]
        to = names[(names.index(cur) + 1) % len(names)]
    data = _load(conn, tenant_id) or {}
    if to in ("winter", "spring", "summer", "autumn"):
        data["early"] = {"theme": to, "until": next_start(today, to).isoformat()}
    else:
        data.pop("early", None)
    _write(conn, tenant_id, data)


def load_early(conn, tenant_id):
    data = _load(conn, tenant_id)
    return data.get("early") if data else None
