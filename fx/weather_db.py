"""Chat-Übersteuerungen der Weather-Source, eine Zeile pro Tenant.

`data` ist JSON: {"kind", "since", "until" (None = Erzwingen), "pending"}.
Ein Befehl innerhalb der Mindestdauer der laufenden Übersteuerung wartet als
`pending` — nur der jüngste, ältere wartende werden ersetzt. Das verhindert
Flackern, wenn der Chat schnell hintereinander schaltet.

Gespeichert (nicht nur im Speicher), damit ein erzwungenes Wetter einen
Neustart des Dienstes überlebt. DAO im sqlite-Stil ('?'-Platzhalter).
"""
import datetime
import json

from fx.weather import KINDS

MIN_HOLD = 15
DEFAULT_HOLD = 150

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_state (
    tenant_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# Prod: als postgres-Superuser mit search_path = obs anlegen
PG_SCHEMA = SCHEMA


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _load(conn, tenant_id):
    row = conn.execute("SELECT data FROM fx_weather_state WHERE tenant_id = ?",
                       (tenant_id,)).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["data"])
    except (TypeError, ValueError):
        return None


def _save(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    if data is None:
        conn.execute("DELETE FROM fx_weather_state WHERE tenant_id = ?", (tenant_id,))
    else:
        conn.execute(
            "INSERT INTO fx_weather_state (tenant_id, data, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (tenant_id, json.dumps(data), stamp))
    conn.commit()


def _start(kind, hold, at):
    return {"kind": kind, "since": at, "until": at + hold if hold else None, "pending": None}


def set_override(conn, tenant_id, kind, hold, now: float) -> None:
    """hold in Sekunden, 0 = unbegrenzt bis `auto`. Unbekannte Lage → nichts."""
    if kind not in KINDS:
        return
    hold = max(0, int(hold))
    cur = current_override(conn, tenant_id, now)
    if cur and now < cur["since"] + MIN_HOLD:
        cur["pending"] = {"kind": kind, "hold": hold, "at": now}
        _save(conn, tenant_id, cur)
    else:
        _save(conn, tenant_id, _start(kind, hold, now))


def clear_override(conn, tenant_id) -> None:
    _save(conn, tenant_id, None)


def current_override(conn, tenant_id, now: float):
    """Laufende Übersteuerung oder None. Befördert einen fälligen wartenden
    Befehl (Start = Ende der Mindestdauer) und löscht abgelaufene."""
    data = _load(conn, tenant_id)
    if not data:
        return None
    changed = False
    pend = data.get("pending")
    if pend:
        due = data["since"] + MIN_HOLD
        if now >= due:
            data = _start(pend["kind"], pend["hold"], due)
            changed = True
    if data["until"] is not None and now >= data["until"]:
        _save(conn, tenant_id, None)
        return None
    if changed:
        _save(conn, tenant_id, data)
    return data
