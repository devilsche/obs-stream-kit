"""Car Drive Mehrspieler – öffentliche Zuschauer-Seite /drive/<code> (Frontend-Dienst).

  GET /drive/<code>             tools/car-drive.html im Zuschauer-Modus (window.__DRIVE__), ohne Widget-Token:
                                Skripte/Katalog/Modelle über /drive/a/… (globale Daten, kein Tenant-Geheimnis)
  GET /drive/login?code=…       „Sign in with Twitch“ für Zuschauer (ohne Scope, nur ID + Name); der Callback
                                läuft über /app/oauth/callback (webcore/auth.py, Marker oauth_drive in der Session)
                                und setzt das signierte Cookie obskit_drive (fx/drive_auth.py) – getrennt vom
                                Streamer-Login
  GET /drive/logout?code=…      Zuschauer-Cookie löschen
  GET /drive/<code>/ticket      Ticket für den WS-Dienst + Garage des Zuschauers (Autos aus fx_race_garage, die
                                mitfahren dürfen) + ein Zufallsauto

Chatrennen steuerbar (Schritt 2b) – fester Link je Tenant, <kanal> = Twitch-Kanal (sonst Slug, fx/drive_auth):
  GET /drive/race/<kanal>         dieselbe Seite im Modus „race“ (window.__DRIVE__.mode = "race")
  GET /drive/race/<kanal>/state   Zustand des Chatrennens (wie …/api/fx/car-race/state) + me {in_race, car, pilot}
  GET /drive/race/<kanal>/ticket  Fahrer-Ticket für /drive-ws/race – nur angemeldet und im aktuellen Chatrennen
  GET /drive/login?race=<kanal>   Anmeldung, zurück auf /drive/race/<kanal>

Kulissen-Modelle der Strecken-Themen (fx/track_props.py): GET /drive/a/api/fx/track-props/catalog.json und
GET /drive/a/api/fx/track-props/<uid>.glb (wie die Auto-Modelle ohne Widget-Token).

Motorklänge: GET /drive/a/assets/sounds/engines/<datei> (bank.json + MP3s, js/car-engine-audio.js).

Rundenrekorde (nur lesen, wie …/api/fx/car-race?cmd=records): GET /drive/race/<kanal>/records?track=&car= und
GET /drive/<code>/records?track=&car= (Tenant des Raums).
"""
import json
import os
import random
import re
import secrets
import time
import urllib.parse

from flask import (Blueprint, Response, abort, current_app, jsonify, make_response, redirect, request,
                   send_from_directory, session)

from fx import car_models, drive_auth, race, race_db, track_props
from webcore.serving import inject_theme, serve_asset

bp_drive = Blueprint("drive", __name__)

_CODE = re.compile(r"^[A-Za-z2-9]{6}$")
_UID = re.compile(r"^[0-9a-f]{32}$")


def _root():
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _catalog():
    try:
        with open(os.path.join(_root(), "data", "car-rain", "catalog.json"), encoding="utf-8") as f:
            cat = json.load(f)
    except (OSError, ValueError):
        cat = []
    return cat if isinstance(cat, list) else []


def _viewer():
    return drive_auth.read_viewer(request.cookies.get(drive_auth.VIEWER_COOKIE))


def _theme(tenant_id):
    from pubg.db_pg import get_setting
    from webcore.middleware import _get_conn
    try:
        conn = _get_conn()
        try:
            return get_setting(conn, tenant_id, "theme", "entry") or "entry"
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
    except Exception:
        return "entry"


_JS_REF = re.compile(r'src="/drive/a/js/([^"?]+)"')


@bp_drive.route("/drive/<code>")
def page(code):
    if not _CODE.match(code):
        abort(404)
    code = code.upper()
    info = drive_auth.call("room", code=code)
    room = info.get("room") if info.get("ok") else None
    viewer = _viewer()
    root = _root()
    with open(os.path.join(root, "tools", "car-drive.html"), encoding="utf-8") as f:
        html = f.read()
    html = re.sub(r'\s*<script src="/s/__WIDGET_TOKEN__/api/fx/ducks/custom\.js"></script>', "", html)
    html = html.replace("/s/__WIDGET_TOKEN__/api/fx/", "/drive/a/api/fx/").replace("/s/__WIDGET_TOKEN__/js/", "/drive/a/js/")

    def bust(m):
        full = os.path.normpath(os.path.join(root, "js", m.group(1)))
        if not full.startswith(os.path.join(root, "js")) or not os.path.exists(full):
            return m.group(0)
        return 'src="/drive/a/js/%s?v=%d"' % (m.group(1), int(os.path.getmtime(full)))
    html = _JS_REF.sub(bust, html)
    cfg = {"mode": "viewer", "code": code, "room": room,
           "user": {"id": viewer["id"], "name": viewer.get("display") or viewer.get("login")} if viewer else None,
           "login": "/drive/login?code=" + code, "logout": "/drive/logout?code=" + code,
           "ticket": "/drive/%s/ticket" % code, "records": "/drive/%s/records" % code}
    inject = "<script>\nwindow.__DRIVE__ = %s;\n</script>" % json.dumps(cfg).replace("</", "<\\/")
    html = html.replace("</head>", inject + "\n</head>", 1)
    if room:
        html = inject_theme(html, _theme(room["tenant"]))
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, must-revalidate"}


def _page_html(root):
    with open(os.path.join(root, "tools", "car-drive.html"), encoding="utf-8") as f:
        html = f.read()
    html = re.sub(r'\s*<script src="/s/__WIDGET_TOKEN__/api/fx/ducks/custom\.js"></script>', "", html)
    html = html.replace("/s/__WIDGET_TOKEN__/api/fx/", "/drive/a/api/fx/").replace("/s/__WIDGET_TOKEN__/js/", "/drive/a/js/")

    def bust(m):
        full = os.path.normpath(os.path.join(root, "js", m.group(1)))
        if not full.startswith(os.path.join(root, "js")) or not os.path.exists(full):
            return m.group(0)
        return 'src="/drive/a/js/%s?v=%d"' % (m.group(1), int(os.path.getmtime(full)))
    return _JS_REF.sub(bust, html)


def _race_tenant(key):
    """Tenant zum Kanal-Schlüssel oder None."""
    if not drive_auth.KEY_RE.match((key or "").lower()):
        return None
    try:
        from fx.endpoints import _with_conn
        return _with_conn(lambda conn: drive_auth.tenant_of_key(conn, key))
    except Exception:
        current_app.logger.exception("car-drive race: tenant lookup failed")
        return None


def _sync(tid, now):
    try:
        from fx.endpoints import drive_sync
        drive_sync(tid, now)
    except Exception:
        current_app.logger.exception("car-drive race: sync failed")


@bp_drive.route("/drive/race/<key>")
def race_page(key):
    key = key.lower()
    tid = _race_tenant(key)
    if tid is None:
        abort(404)
    viewer = _viewer()
    html = _page_html(_root())
    cfg = {"mode": "race", "key": key,
           "user": {"id": viewer["id"], "name": viewer.get("display") or viewer.get("login")} if viewer else None,
           "login": "/drive/login?race=" + key, "logout": "/drive/logout?race=" + key,
           "ticket": "/drive/race/%s/ticket" % key, "state": "/drive/race/%s/state" % key,
           "records": "/drive/race/%s/records" % key}
    inject = "<script>\nwindow.__DRIVE__ = %s;\n</script>" % json.dumps(cfg).replace("</", "<\\/")
    html = inject_theme(html.replace("</head>", inject + "\n</head>", 1), _theme(tid))
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, must-revalidate"}


def _me(st, viewer):
    if not viewer:
        return None
    mine = next((r for r in st.get("racers") or [] if str(r.get("user_id")) == str(viewer["id"])), None)
    pilots = st.get("pilots")
    taken = set()
    for e in st.get("race_events") or []:     # nach Zeit sortiert: KI übernimmt / gibt zurück
        if e.get("type") == "takeover":
            taken.add(e.get("id"))
        elif e.get("type") == "release":
            taken.discard(e.get("id"))
    return {"id": viewer["id"], "name": viewer.get("display") or viewer.get("login"), "in_race": mine is not None,
            "grid": mine.get("grid") if mine else None,
            "pilot": None if pilots is None or mine is None else viewer["id"] in pilots,
            "taken": viewer["id"] in taken}


@bp_drive.route("/drive/race/<key>/state")
def race_state(key):
    tid = _race_tenant(key)
    if tid is None:
        abort(404)
    now = time.time()
    _sync(tid, now)
    st = race.state(tid, now)
    st["me"] = _me(st, _viewer())
    return _no_store(jsonify(st))


def _records(tid):
    from fx.endpoints import lap_records_json
    try:
        v = _viewer() or {}
        out, status = lap_records_json(tid, request.args.get("track") or "", request.args.get("car") or "",
                                       v.get("id"), v.get("display") or v.get("login"))
    except Exception:
        current_app.logger.exception("car-drive: records failed")
        out, status = {"ok": False, "error": "records unavailable"}, 500
    return _no_store(jsonify(out)), status


@bp_drive.route("/drive/race/<key>/records")
def race_records(key):
    tid = _race_tenant(key)
    if tid is None:
        abort(404)
    return _records(tid)


@bp_drive.route("/drive/<code>/records")
def room_records(code):
    if not _CODE.match(code):
        abort(404)
    info = drive_auth.call("room", code=code.upper())
    if not info.get("ok"):
        return _no_store(jsonify({"ok": False, "error": "room not found"})), 404
    return _records(info["room"]["tenant"])


@bp_drive.route("/drive/race/<key>/ticket")
def race_ticket(key):
    tid = _race_tenant(key)
    if tid is None:
        abort(404)
    viewer = _viewer()
    if not viewer:
        return _no_store(jsonify({"ok": False, "signin": True, "error": "sign in with Twitch first"})), 401
    now = time.time()
    _sync(tid, now)
    st = race.state(tid, now)
    me = _me(st, viewer)
    if st["phase"] not in ("lobby", "countdown", "intro", "race") or not me["in_race"]:
        return _no_store(jsonify({"ok": False, "error": "type !race in chat to join"})), 403
    tk = drive_auth.make_ticket({"tid": tid, "id": viewer["id"], "login": viewer.get("login") or "",
                                 "display": viewer.get("display") or viewer.get("login") or viewer["id"],
                                 "role": "driver"})
    return _no_store(jsonify({"ok": True, "ticket": tk, "path": "/drive-ws/race", "race_id": st["race_id"], "me": me}))


@bp_drive.route("/drive/login")
def login():
    code = (request.args.get("code") or "").upper()
    rkey = (request.args.get("race") or "").lower()
    if not _CODE.match(code) and not drive_auth.KEY_RE.match(rkey):
        abort(400)
    cfg = current_app.config
    if not cfg.get("TWITCH_CLIENT_ID"):
        abort(503, description="Twitch sign-in is not configured")
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    session["oauth_drive"] = {"code": code} if _CODE.match(code) else {"race": rkey}
    params = {"client_id": cfg["TWITCH_CLIENT_ID"], "redirect_uri": cfg["TWITCH_REDIRECT_URI"],
              "response_type": "code", "scope": "", "state": state}
    return redirect(cfg["TWITCH_AUTH_URL"] + "?" + urllib.parse.urlencode(params), code=302)


@bp_drive.route("/drive/logout")
def logout():
    code = (request.args.get("code") or "").upper()
    rkey = (request.args.get("race") or "").lower()
    target = "/drive/" + code if _CODE.match(code) else "/drive/race/" + rkey if drive_auth.KEY_RE.match(rkey) else "/"
    resp = make_response(redirect(target, code=302))
    resp.delete_cookie(drive_auth.VIEWER_COOKIE, path="/drive")
    return resp


@bp_drive.route("/drive/<code>/ticket")
def ticket(code):
    if not _CODE.match(code):
        abort(404)
    code = code.upper()
    viewer = _viewer()
    if not viewer:
        return _no_store(jsonify({"ok": False, "signin": True, "error": "sign in with Twitch first"})), 401
    info = drive_auth.call("room", code=code)
    if not info.get("ok"):
        return _no_store(jsonify({"ok": False, "error": info.get("error") or "room not found"})), 404
    room = info["room"]
    tid = room["tenant"]
    pool = [c["key"] for c in race.eligible(_catalog(), car_models.load(_root(), "vehicles")) if c.get("key")]
    garage = []
    try:
        from fx.endpoints import _with_conn
        owned = _with_conn(lambda conn: race_db.garage(conn, tid, viewer["id"]))
        garage = [k for k in owned if k in pool]
    except Exception:
        current_app.logger.exception("car-drive: garage lookup failed")
    rnd = random.choice(pool) if pool else None
    tk = drive_auth.make_ticket({"tid": tid, "code": code, "id": viewer["id"], "login": viewer.get("login") or "",
                                 "display": viewer.get("display") or viewer.get("login") or viewer["id"],
                                 "role": "viewer", "garage": garage, "rnd": rnd})
    return _no_store(jsonify({"ok": True, "ticket": tk, "garage": garage, "rnd": rnd, "room": room,
                              "roster": info.get("roster") or [],
                              "me": {"id": viewer["id"], "name": viewer.get("display")}}))


# ---- Assets ohne Widget-Token (globale Auto-Daten, öffentlicher Code) ----

@bp_drive.route("/drive/a/js/<path:filepath>")
def js_file(filepath):
    return serve_asset(_root(), "js", filepath)


@bp_drive.route("/drive/a/assets/sounds/engines/<path:filepath>")
def engine_sound(filepath):
    """Motorklänge (scripts/build_engine_sounds.py → assets/sounds/engines/, js/car-engine-audio.js)."""
    return serve_asset(_root(), os.path.join("assets", "sounds", "engines"), filepath)


@bp_drive.route("/drive/a/assets/textures/<path:filepath>")
def texture_file(filepath):
    """Foto-Texturen der Strecken (assets/textures/, CC0 – js/car-track-surface.js)."""
    return serve_asset(_root(), os.path.join("assets", "textures"), filepath)


@bp_drive.route("/drive/a/api/fx/cars/catalog.json")
def catalog():
    return _no_store(jsonify(_catalog()))


@bp_drive.route("/drive/a/api/fx/cars/model/<uid>.glb", defaults={"light": False})
@bp_drive.route("/drive/a/api/fx/cars/model/<uid>.race.glb", defaults={"light": True})
def model(uid, light=False):
    if not _UID.match(uid):
        abort(404)
    d = os.path.join(_root(), "data", "car-rain")
    name = uid + ".race.glb" if light and os.path.exists(os.path.join(d, uid + ".race.glb")) else uid + ".glb"
    if not os.path.exists(os.path.join(d, name)):
        abort(404)
    return send_from_directory(os.path.abspath(d), name, mimetype="model/gltf-binary", max_age=7 * 86400)


@bp_drive.route("/drive/a/api/fx/track-props/catalog.json")
def track_props_catalog():
    return _no_store(jsonify(track_props.catalog(_root())))


@bp_drive.route("/drive/a/api/fx/track-props/<uid>.glb")
def track_prop_file(uid):
    name = track_props.model_name(_root(), uid)
    if not name:
        abort(404)
    return send_from_directory(track_props.folder(_root()), name, mimetype="model/gltf-binary", max_age=7 * 86400)


@bp_drive.route("/drive/a/api/fx/cars/custom.js")
def cars_js():
    root = _root()
    js = car_models.script(car_models.load(root, "vehicles"), car_models.load(root, "rims"))
    return _no_store(Response(js, mimetype="application/javascript"))
