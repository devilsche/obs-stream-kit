"""Dauerhafte Sammlung für die Jahreszeiten-Deko (effects/winter.html,
spring.html, summer.html), pro Tenant und Effekt in einer Tabelle:

- Items: was Follower hinterlassen (Mini-Schneemann, Blume, Sandburg) — ein
  Name zählt nur einmal.
- Events: das Protokoll des Spiels (Schneefall/Regen/Hitzewelle an/aus,
  Schippen, Gießen, Abkühlen …). Wie beim Schnee (fx/xmas_db.py) rechnet das
  Overlay Stände und Ranglisten beim Laden mit den Regeln aus seiner URL nach.

Das erste gespeicherte Ereignis eines Effekts legt zusätzlich ein 'begin' ab:
der Frühling braucht einen Startpunkt, ab dem die Erde austrocknet.

DAO im sqlite-Stil ('?'-Platzhalter) — Tests laufen auf sqlite, Prod über
core.db_compat.SqliteCompatConn auf Postgres. Geleert wird nur per
cmd=clear, nie automatisch.
"""
import datetime

MAX_EVENTS = 5000

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_season_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    effect TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    event TEXT,
    secs INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_season_item_tek ON fx_season_item(tenant_id, effect, kind, id);
"""

# Prod: als postgres-Superuser mit search_path = obs anlegen
PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_season_item (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    effect TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    event TEXT,
    secs INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_season_item_tek ON fx_season_item(tenant_id, effect, kind, id);
"""

# item: Befehl für Follower-Items + wie viele sichtbar sind
# events: Befehl → gespeichertes Ereignis; toggle: Umschalter → (an, aus)
# force: Gruppenaktion mit force=1 (Dashboard-Knopf) → Ereignis, das ohne
#        weitere Mitmacher sofort gelingt
# clear: kind-Wert → (Zeilenart, Ereignisse oder None = alle)
SPECS = {
    "winter": {
        "item": ("mini", 30),
        "events": {"snowfall": "start", "snowstop": "stop", "shovel": "shovel", "shake": "shake",
                   "scrape": "scrape", "icicle": "icicle", "melt": "melt",
                   "build": "build", "snowmanreset": "smreset"},
        "toggle": ("snowtoggle", "snowfall", "snowstop"),
        "force": {"shake": "shakeall"},
        "clear": {"minis": ("item", None),
                  "snow": ("event", ("start", "stop", "shovel", "shake", "shakeall", "scrape", "icicle", "melt")),
                  "snowman": ("event", ("build", "smreset"))},
    },
    "spring": {
        "item": ("flower", 40),
        "events": {"rainfall": "start", "rainstop": "stop", "water": "water", "weed": "weed"},
        "toggle": ("raintoggle", "rainfall", "rainstop"),
        "force": {"weed": "pullall"},
        "clear": {"flowers": ("item", None),
                  "garden": ("event", None)},
    },
    "summer": {
        "item": ("castle", 24),
        "events": {"heatwave": "start", "heatstop": "stop", "splash": "splash", "cool": "cool"},
        "toggle": ("heattoggle", "heatwave", "heatstop"),
        "clear": {"castles": ("item", None),
                  "heat": ("event", None)},
    },
}


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def _ts(iso):
    return datetime.datetime.fromisoformat(iso).timestamp()


def add_item(conn, tenant_id: int, effect: str, name: str) -> bool:
    """False, wenn dieser Name schon ein Item hat (Refollow). Ohne Namen
    kommt immer eins dazu."""
    if name:
        row = conn.execute(
            "SELECT 1 FROM fx_season_item WHERE tenant_id = ? AND effect = ? AND kind = 'item' "
            "AND lower(name) = lower(?) LIMIT 1", (tenant_id, effect, name)).fetchone()
        if row:
            return False
    conn.execute(
        "INSERT INTO fx_season_item (tenant_id, effect, kind, name, created_at) VALUES (?, ?, 'item', ?, ?)",
        (tenant_id, effect, name, _now()))
    conn.commit()
    return True


def _has_events(conn, tenant_id, effect):
    return conn.execute(
        "SELECT 1 FROM fx_season_item WHERE tenant_id = ? AND effect = ? AND kind = 'event' LIMIT 1",
        (tenant_id, effect)).fetchone() is not None


def add_event(conn, tenant_id: int, effect: str, event: str, name: str = "", secs=None):
    """secs nur bei 'start': das Wetter endet danach von selbst."""
    if not _has_events(conn, tenant_id, effect):
        conn.execute(
            "INSERT INTO fx_season_item (tenant_id, effect, kind, name, event, created_at) "
            "VALUES (?, ?, 'event', '', 'begin', ?)", (tenant_id, effect, _now()))
    conn.execute(
        "INSERT INTO fx_season_item (tenant_id, effect, kind, name, event, secs, created_at) "
        "VALUES (?, ?, 'event', ?, ?, ?, ?)",
        (tenant_id, effect, name, event, secs, _now()))
    conn.commit()


def is_on(conn, tenant_id: int, effect: str) -> bool:
    """Letztes start/stop entscheidet; ein start mit secs gilt nur innerhalb
    seiner Dauer."""
    row = conn.execute(
        "SELECT event, secs, created_at FROM fx_season_item WHERE tenant_id = ? AND effect = ? "
        "AND kind = 'event' AND event IN ('start', 'stop') ORDER BY id DESC LIMIT 1",
        (tenant_id, effect)).fetchone()
    if not row or row["event"] != "start":
        return False
    if row["secs"]:
        age = datetime.datetime.now(datetime.timezone.utc).timestamp() - _ts(row["created_at"])
        return age < row["secs"]
    return True


def clear(conn, tenant_id: int, effect: str, kind=None):
    """kind aus SPECS[effect]['clear'] oder None (alles dieses Effekts)."""
    spec = SPECS[effect]["clear"].get(kind)
    if spec is None:
        conn.execute("DELETE FROM fx_season_item WHERE tenant_id = ? AND effect = ?", (tenant_id, effect))
    elif spec[1] is None:
        conn.execute("DELETE FROM fx_season_item WHERE tenant_id = ? AND effect = ? AND kind = ?",
                     (tenant_id, effect, spec[0]))
    else:
        marks = ", ".join("?" for _ in spec[1])
        conn.execute(f"DELETE FROM fx_season_item WHERE tenant_id = ? AND effect = ? AND kind = 'event' "
                     f"AND event IN ({marks})", (tenant_id, effect, *spec[1]))
    conn.commit()


def load_state(conn, tenant_id: int, effect: str) -> dict:
    """Neueste sichtbare Items (älteste zuerst), Gesamtzahl und das Protokoll."""
    limit = SPECS[effect]["item"][1]
    items = conn.execute(
        "SELECT name FROM fx_season_item WHERE tenant_id = ? AND effect = ? AND kind = 'item' "
        "ORDER BY id DESC LIMIT ?", (tenant_id, effect, limit)).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM fx_season_item WHERE tenant_id = ? AND effect = ? AND kind = 'item'",
        (tenant_id, effect)).fetchone()
    events = conn.execute(
        "SELECT name, event, secs, created_at FROM fx_season_item WHERE tenant_id = ? AND effect = ? "
        "AND kind = 'event' ORDER BY id DESC LIMIT ?", (tenant_id, effect, MAX_EVENTS)).fetchall()
    return {
        "events": [{"t": _ts(r["created_at"]), "k": r["event"], "n": r["name"], "s": r["secs"]}
                   for r in reversed(events)],
        "items": [{"name": r["name"]} for r in reversed(items)],
        "item_total": int(total["n"]),
    }


def persist(effect: str, conn, tenant_id: int, command: dict) -> bool:
    """Schreibt einen geparsten Befehl. False = nicht ans Overlay weitergeben
    (doppeltes Item)."""
    spec = SPECS[effect]
    p = command["params"]
    if command["cmd"] == spec["item"][0]:
        return add_item(conn, tenant_id, effect, p.get("name", ""))
    if command["cmd"] == "clear":
        clear(conn, tenant_id, effect, p.get("kind"))
        return True
    toggle, on_cmd, off_cmd = spec["toggle"]
    if command["cmd"] == toggle:
        # Umschalter: der Server kennt den Stand, das Overlay bekommt den
        # aufgelösten Befehl
        command["cmd"] = off_cmd if is_on(conn, tenant_id, effect) else on_cmd
    event = spec["events"].get(command["cmd"])
    if p.get("force"):
        event = spec.get("force", {}).get(command["cmd"], event)
    if event:
        add_event(conn, tenant_id, effect, event, p.get("name", ""), p.get("secs"))
    return True
