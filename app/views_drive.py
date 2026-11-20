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
"""
import json
import os
import random
import re
import secrets
import urllib.parse

from flask import (Blueprint, Response, abort, current_app, jsonify, make_response, redirect, request,
                   send_from_directory, session)

from fx import car_models, drive_auth, race, race_db
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
           "ticket": "/drive/%s/ticket" % code}
    inject = "<script>\nwindow.__DRIVE__ = %s;\n</script>" % json.dumps(cfg).replace("</", "<\\/")
    html = html.replace("</head>", inject + "\n</head>", 1)
    if room:
        html = inject_theme(html, _theme(room["tenant"]))
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, must-revalidate"}


@bp_drive.route("/drive/login")
def login():
    code = (request.args.get("code") or "").upper()
    if not _CODE.match(code):
        abort(400)
    cfg = current_app.config
    if not cfg.get("TWITCH_CLIENT_ID"):
        abort(503, description="Twitch sign-in is not configured")
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    session["oauth_drive"] = {"code": code}
    params = {"client_id": cfg["TWITCH_CLIENT_ID"], "redirect_uri": cfg["TWITCH_REDIRECT_URI"],
              "response_type": "code", "scope": "", "state": state}
    return redirect(cfg["TWITCH_AUTH_URL"] + "?" + urllib.parse.urlencode(params), code=302)


@bp_drive.route("/drive/logout")
def logout():
    code = (request.args.get("code") or "").upper()
    resp = make_response(redirect("/drive/" + code if _CODE.match(code) else "/", code=302))
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


@bp_drive.route("/drive/a/api/fx/cars/custom.js")
def cars_js():
    root = _root()
    js = car_models.script(car_models.load(root, "vehicles"), car_models.load(root, "rims"))
    return _no_store(Response(js, mimetype="application/javascript"))
