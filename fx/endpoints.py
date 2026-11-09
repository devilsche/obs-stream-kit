"""/s/<token>/api/fx/<effekt> — Befehle fuer Effect-Overlays.

GET (oder POST mit JSON) mit ?cmd=... legt einen Befehl ab — GET, damit
Streamer.bot die einfache "Fetch URL"-Sub-Action nutzen kann.
.../poll?since=<seq> liefert die Befehle danach.

Effekte mit dauerhafter Sammlung (xmas: Kugeln, Geschenke; autumn: Kürbisse,
Laub; winter/spring/summer: fx/season_db.py) schreiben den Befehl zusätzlich
in die DB; der erste Poll ohne `since` liefert sie als `state` mit.
"""
import functools
import logging
import sqlite3
import time

from flask import Blueprint, current_app, g, jsonify, abort, request

from core.db_compat import SqliteCompatConn
import datetime

from fx import (autumn_db, commands, season_db, weather_db, weather_frost, weather_snow,
                weather_state, weather_theme, xmas_db)
from webcore.middleware import _get_conn

log = logging.getLogger(__name__)

bp_fx = Blueprint("fx", __name__)

# effect → (persist(conn, tenant, cmd) -> bool, load_state(conn, tenant) -> dict)
_PERSISTENT = {
    "xmas": (xmas_db.persist, xmas_db.load_state),
    "autumn": (autumn_db.persist, autumn_db.load_state),
}


def _weather_persist(conn, tenant_id, cmd):
    """Übersteuerung speichern; der Befehl geht trotzdem in die Warteschlange,
    damit das Overlay den Zustand sofort neu holt."""
    if cmd["cmd"] == "weather":
        weather_db.set_override(conn, tenant_id, cmd["params"]["to"],
                                cmd["params"]["hold"], time.time())
    elif cmd["cmd"] == "auto":
        weather_db.clear_override(conn, tenant_id)
    elif cmd["cmd"] in ("scrape", "warm"):
        # Ergebnis mitschicken, damit das Overlay passend animiert
        cmd["params"].update(weather_frost.use(conn, tenant_id, cmd["cmd"],
                                               cmd["params"].get("name", ""), time.time()))
    elif cmd["cmd"] == "frostclear":
        weather_frost.clear(conn, tenant_id, time.time())
    elif cmd["cmd"] == "frostreset":
        weather_frost.reset_leaders(conn, tenant_id)
    else:
        return _winter_persist(conn, tenant_id, cmd)
    return True


def _winter_persist(conn, tenant_id, cmd):
    """Winter-Thema: Kugeln/Geschenke (xmas_db), Mini-Schneemänner und
    Schneemann (season_db, effect winter), Schneedecke und Xmas-Ablauf."""
    c, p, now = cmd["cmd"], cmd["params"], time.time()
    today = datetime.date.today()
    if c == "follow":
        # ein Follow-Befehl für alles: Kugel am Baum in der Xmas-Zeit, sonst Mini-Schneemann
        on = weather_theme.status(conn, tenant_id, today, {}, "winter") in ("on", "farewell")
        c = cmd["cmd"] = "ornament" if on else "mini"
    if c == "ornament":
        return xmas_db.add_ornament(conn, tenant_id, p.get("name", ""))
    if c == "gift":
        xmas_db.add_gift(conn, tenant_id, p.get("name", ""), p["type"], p["amount"])
    elif c == "mini":
        return season_db.add_item(conn, tenant_id, "winter", p.get("name", ""))
    elif c == "build":
        season_db.add_event(conn, tenant_id, "winter", "build", p.get("name", ""))
    elif c == "snowmanreset":
        season_db.add_event(conn, tenant_id, "winter", "smreset")
    elif c == "shovel":
        p.update(weather_snow.shovel(conn, tenant_id, p.get("name", ""), now))
    elif c == "icicle":
        p.update(weather_snow.icicle(conn, tenant_id, p.get("name", ""), now))
    elif c == "shake":
        p.update(weather_snow.shake(conn, tenant_id, p.get("name", ""), now,
                                    need=5, win=20, force=bool(p.get("force"))))
    elif c in ("setup", "farewell"):
        weather_theme.mark(conn, tenant_id, today, {}, c)
    elif c == "xmasdone":
        if p.get("step"):
            weather_theme.mark(conn, tenant_id, today, {}, p["step"])
        return False
    elif c == "clear":
        kind = p.get("kind")
        if kind in ("ornaments", "gifts"):
            xmas_db.clear(conn, tenant_id, kind)
        elif kind == "minis":
            season_db.clear(conn, tenant_id, "winter", "minis")
        elif kind == "snowman":
            season_db.clear(conn, tenant_id, "winter", "snowman")
        elif kind == "snow":
            weather_snow.clear(conn, tenant_id, now)
    return True


def _weather_state(conn, tenant_id):
    """Deko-Stand fürs Winter-Thema beim ersten Poll: Kugeln, Geschenke,
    Mini-Schneemänner, Schneemann-Stufe (Subs seit dem letzten Reset, max 8)."""
    x = xmas_db.load_state(conn, tenant_id)
    w = season_db.load_state(conn, tenant_id, "winter")
    stage = 0
    for e in w["events"]:
        if e["k"] == "build":
            stage = min(8, stage + 1)
        elif e["k"] == "smreset":
            stage = 0
    return {"ornaments": x["ornaments"], "ornament_total": x["ornament_total"],
            "gifts": x["gifts"], "gift_total": x["gift_total"],
            "minis": w["items"], "mini_total": w["item_total"], "snowman": stage}


_PERSISTENT["weather"] = (_weather_persist, _weather_state)
for _season in season_db.SPECS:
    _PERSISTENT[_season] = (functools.partial(season_db.persist, _season),
                            lambda conn, tenant_id, _e=_season: season_db.load_state(conn, tenant_id, _e))


def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _with_conn(fn):
    raw = _get_conn()
    conn = raw if isinstance(raw, (sqlite3.Connection, SqliteCompatConn)) else SqliteCompatConn(raw)
    try:
        return fn(conn)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_fx.route("/s/<token>/api/fx/<effect>", methods=["GET", "POST"])
def push(token, effect):
    if g.tenant_id is None or effect not in commands.EFFECTS:
        abort(404)
    args = request.args.to_dict()
    if request.method == "POST":
        args.update(request.get_json(silent=True) or {})
    try:
        cmd = commands.parse(effect, args)
    except ValueError as e:
        return _no_store(jsonify({"ok": False, "error": str(e)})), 400
    if effect in _PERSISTENT:
        persist = _PERSISTENT[effect][0]
        try:
            forward = _with_conn(lambda conn: persist(conn, g.tenant_id, cmd))
        except Exception:
            # Ohne DB läuft der Effekt trotzdem live weiter, nur nicht dauerhaft
            log.exception("fx %s: persist failed", effect)
            forward = True
        if not forward:
            return _no_store(jsonify({"ok": True, "duplicate": True}))
    seq = commands.push(g.tenant_id, effect, cmd)
    return _no_store(jsonify({"ok": True, "seq": seq}))


@bp_fx.route("/s/<token>/api/fx/<effect>/poll")
def poll(token, effect):
    if g.tenant_id is None or effect not in commands.EFFECTS:
        abort(404)
    since = request.args.get("since", type=int)
    out = commands.poll(g.tenant_id, effect, since)
    out["now"] = time.time()          # Uhrabgleich für zeitabhängige Effekte (Schneefall)
    out["state"] = {}
    if since is None and effect in _PERSISTENT:
        load = _PERSISTENT[effect][1]
        try:
            out["state"] = _with_conn(lambda conn: load(conn, g.tenant_id))
        except Exception:
            log.exception("fx %s: load_state failed", effect)
    return _no_store(jsonify(out))


@bp_fx.route("/s/<token>/api/fx/weather/state")
def weather_state_route(token):
    """Wirksamer Wetterzustand; Settings wie in der Overlay-URL."""
    if g.tenant_id is None:
        abort(404)
    settings = commands.EFFECTS["weather"]["settings"]
    opts = {}
    for key in ("place", "lock", "mood", "kdlow", "kdhigh", "kdtest", "fallback", "aurorakd",
                "frost", "frostrate", "theme", "xmasfrom", "xmasto", "snowrate"):
        raw = (request.args.get(key) or "").strip()
        if raw:
            val = settings[key](raw)
            if val is not None:
                opts[key] = val
    state = _with_conn(lambda conn: weather_state.resolve(conn, g.tenant_id, opts))
    return _no_store(jsonify({"state": state, "now": time.time()}))
