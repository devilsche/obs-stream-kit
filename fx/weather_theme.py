"""Deko-Thema der Weather-Source und Ablauf der Xmas-Zeit.

Thema: `auto` wählt Winter von Dezember bis Februar und während der
Xmas-Zeit (die im November beginnen kann), sonst `none` – Teil 4 ergänzt
Frühling, Sommer und Herbst.

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


def theme_for(today: date, setting: str, xmas_active: bool) -> str:
    if setting in ("winter", "none"):
        return setting
    return "winter" if today.month in (12, 1, 2) or xmas_active else "none"


def _load(conn, tenant_id):
    row = conn.execute("SELECT data FROM fx_weather_theme WHERE tenant_id = ?", (tenant_id,)).fetchone()
    if row:
        try:
            return json.loads(row["data"])
        except (TypeError, ValueError):
            pass
    return None


def _save(conn, tenant_id, data):
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


def mark(conn, tenant_id, today: date, opts: dict, step: str) -> None:
    """Aufbau (`setup`) bzw. Abschied (`farewell`) für die Saison erledigt."""
    _, _, season = xmas_window(today, opts.get("xmasfrom"), opts.get("xmasto"))
    _save(conn, tenant_id, {"season": season, "state": "on" if step == "setup" else "done"})
