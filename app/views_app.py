"""Streamer-Routes."""
import os

from flask import (
    Blueprint, render_template, g, jsonify, request, redirect, current_app,
    abort, send_from_directory,
)

from app.middleware import require_session, _get_conn
from core import credentials as core_creds


TOOLS = [
    {"key": "session-report",
     "label": "Session Report",
     "desc": "Detailed report of a session: matches, kills, achievements, map play.",
     "path": "widgets/pubg/session-report.html",
     "admin_only": False},
    {"key": "match-replay",
     "label": "Match Replay",
     "desc": "Time-lapse replay of a single match — landings, fights, kills, circle.",
     "path": "tools/match-replay.html",
     "admin_only": False},
    {"key": "landing-spots",
     "label": "Landing Spots",
     "desc": "Heatmap of where you and your mates land across all matches.",
     "path": "tools/landing-spots.html",
     "admin_only": False},
    {"key": "achievement-browser",
     "label": "Achievement Browser",
     "desc": "Full-screen browser through all Steam + PUBG achievements. Click a tile to re-trigger the popup.",
     "path": "tools/achievement-browser.html",
     "admin_only": False},
]


bp_app = Blueprint("app_streamer", __name__)


@bp_app.route("/")
def landing():
    if g.user:
        return redirect("/app/")
    return render_template("landing.html")


@bp_app.route("/app/")
@require_session
def dashboard():
    conn = _get_conn()
    try:
        creds = core_creds.get(conn, g.tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    cred_status = {
        "pubg_ready": bool(creds.pubg_name and creds.pubg_api_key),
        "steam_ready": bool(creds.steam_id and creds.steam_api_key),
        "any_missing": not (creds.pubg_name and creds.pubg_api_key
                            and creds.steam_id and creds.steam_api_key),
    }
    return render_template("dashboard.html", user=g.user, cred_status=cred_status)


@bp_app.route("/app/pending")
def pending():
    if g.user is None:
        return redirect("/app/login")
    if g.user["is_approved"]:
        return redirect("/app/")
    return render_template("login_pending.html", user=g.user)


@bp_app.route("/app/pending-check")
def pending_check():
    if g.user is None:
        return jsonify({"approved": False})
    return jsonify({"approved": bool(g.user["is_approved"])})


@bp_app.route("/app/settings", methods=["GET", "POST"])
@require_session
def settings():
    conn = _get_conn()
    from pubg.db_pg import get_setting, set_setting
    try:
        if request.method == "POST":
            pubg_name = request.form.get("pubg_name") or None
            pubg_platform = request.form.get("pubg_platform") or None
            pubg_api_key = request.form.get("pubg_api_key") or None
            steam_id = request.form.get("steam_id") or None
            steam_api_key = request.form.get("steam_api_key") or None
            if pubg_name or pubg_platform or pubg_api_key:
                core_creds.set_pubg(
                    conn, g.tenant_id,
                    name=pubg_name, platform=pubg_platform, api_key=pubg_api_key
                )
            if steam_id or steam_api_key:
                core_creds.set_steam(
                    conn, g.tenant_id,
                    steam_id=steam_id, api_key=steam_api_key
                )
            # Defaults (Widget-Range + Sprache) — speichern wenn explizit gesetzt
            default_range = request.form.get("default_range")
            if default_range in ("session", "week", "all"):
                set_setting(conn, g.tenant_id, "ui.default_range", default_range)
            lang = request.form.get("lang")
            if lang in ("de", "en"):
                set_setting(conn, g.tenant_id, "ui.lang", lang)
            return redirect("/app/settings?saved=1")
        creds = core_creds.get(conn, g.tenant_id)
        prefs = {
            "default_range": get_setting(conn, g.tenant_id, "ui.default_range",
                                          default="session"),
            "lang": get_setting(conn, g.tenant_id, "ui.lang", default="de"),
        }
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return render_template("settings.html",
                           user=g.user, creds=creds, prefs=prefs,
                           saved=request.args.get("saved"))


@bp_app.route("/app/urls")
@require_session
def urls():
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT token, label FROM widget_tokens
                WHERE tenant_id = %s AND revoked_at IS NULL
                ORDER BY created_at
                LIMIT 1
            """, (g.tenant_id,))
            row = cur.fetchone()
            token = row["token"] if row else None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()

    # Widget switches come directly from each widget's `buildFilter([...])`
    # call in its HTML — single source of truth (see app/widget_catalog.py).
    from app import widget_catalog
    project_root = current_app.config.get("_PROJECT_ROOT", ".")
    widgets_list = widget_catalog.get(project_root)
    base_url = request.url_root.rstrip("/")
    return render_template("urls.html",
                           user=g.user, token=token,
                           widgets=widgets_list, base_url=base_url)


def _visible_tools():
    """Tools the current user is allowed to see."""
    return [t for t in TOOLS
            if not t["admin_only"] or g.user.get("is_admin")]


@bp_app.route("/app/tools")
@require_session
def tools_index():
    return render_template("tools.html", user=g.user, tools=_visible_tools())


@bp_app.route("/app/tools/<key>")
@require_session
def tools_open(key):
    tool = next((t for t in TOOLS if t["key"] == key), None)
    if tool is None:
        abort(404)
    if tool["admin_only"] and not g.user.get("is_admin"):
        abort(403)
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    full_path = os.path.normpath(os.path.join(root, tool["path"]))
    if not full_path.startswith(root) or not os.path.exists(full_path):
        abort(404)
    # Credentials-Gate: blocke das Tool wenn der Tenant keine API-Keys
    # fuer die noetige Domain hinterlegt hat.
    from app.creds_gate import (required_domains, missing_domains,
                                  render_block_page)
    needed = required_domains(tool["path"])
    if needed:
        conn = _get_conn()
        try:
            creds = core_creds.get(conn, g.tenant_id)
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
        missing = missing_domains(creds, needed)
        if missing:
            return (render_block_page(tool["path"], missing, "/app/"),
                    200, {"Content-Type": "text/html; charset=utf-8"})
    with open(full_path, "r", encoding="utf-8") as f:
        html = f.read()
    # Bei Tools die als widgets/<domain>/*.html liegen (Alt-Bestand:
    # session-report, poi-editor) zeigen die relativen Asset-Pfade
    # (_pubg.css, _pubg.js, _pubg_pois.js) auf das gleiche Verzeichnis.
    # Unter /app/tools/<key> ist das geschluckt, deshalb rewriten auf
    # absolute /widgets-static/<domain>/...
    if tool["path"].startswith("widgets/"):
        domain = tool["path"].split("/")[1]
        for asset in ("_pubg.css", "_pubg.js", "_pubg_pois.js"):
            html = html.replace(
                f'href="{asset}"',
                f'href="/widgets-static/{domain}/{asset}"')
            html = html.replace(
                f'src="{asset}"',
                f'src="/widgets-static/{domain}/{asset}"')
    # Tools laufen cookie-authenticated, kein Token — alle /api/-Calls
    # gehen direkt an die Cookie-Routes mit g.tenant_id aus der Session.
    inject = (
        '<script>\n'
        'window.__SERVE_BASE__ = "/";\n'
        'window.__STATIC_BASE__ = "/widgets-static/";\n'
        '</script>'
    )
    if "</head>" in html:
        html = html.replace("</head>", inject + "\n</head>", 1)
    else:
        html = inject + "\n" + html
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}
