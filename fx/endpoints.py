"""/s/<token>/api/fx/<effekt> — Befehle fuer Effect-Overlays.

GET (oder POST mit JSON) mit ?cmd=... legt einen Befehl ab — GET, damit
Streamer.bot die einfache "Fetch URL"-Sub-Action nutzen kann.
.../poll?since=<seq> liefert die Befehle danach.

Effekte mit dauerhafter Sammlung (xmas: Kugeln, Geschenke; autumn: Kürbisse,
Laub) schreiben den Befehl zusätzlich in die DB; der erste Poll ohne `since`
liefert sie als `state` mit.
"""
import logging
import sqlite3
import time

from flask import Blueprint, current_app, g, jsonify, abort, request

from core.db_compat import SqliteCompatConn
from fx import autumn_db, commands, xmas_db
from webcore.middleware import _get_conn

log = logging.getLogger(__name__)

bp_fx = Blueprint("fx", __name__)

# effect → (persist(conn, tenant, cmd) -> bool, load_state(conn, tenant) -> dict)
_PERSISTENT = {
    "xmas": (xmas_db.persist, xmas_db.load_state),
    "autumn": (autumn_db.persist, autumn_db.load_state),
}


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
