"""Overlay- und Asset-Serving unter /s/<token>/ fuer den Overlay-Service."""
import os
from flask import Blueprint, g, abort, current_app

from webcore.serving import serve_html_or_asset, serve_asset
from webcore.middleware import _get_conn


bp_overlays = Blueprint("overlays", __name__)


def _root() -> str:
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))


def _tenant_creds(tenant_id: int):
    from core import credentials as core_creds
    conn = _get_conn()
    try:
        return core_creds.get(conn, tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


# Enten-Sources: nur mit Freischaltung „ducks“ (core/features.py), sonst leer und durchsichtig
BLANK_HTML = ('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not enabled</title>'
              '<style>html,body{margin:0;background:transparent}</style></head><body></body></html>')


def _serve_tenant_source(token, subdir, filepath):
    """HTML/Asset aus <subdir> token-scoped ausliefern (mit Window-Var-Inject +
    server-injiziertem Tenant-Theme, damit z.B. Alerts im hinterlegten Theme
    statt im Entry-Look erscheinen)."""
    if g.tenant_id is None:
        abort(404)
    creds = _tenant_creds(g.tenant_id)
    theme = "entry"
    stinger_font = ""
    feats = []
    alert_sound = None
    conn = _get_conn()
    try:
        from pubg.db_pg import get_setting
        from core import features
        theme = get_setting(conn, g.tenant_id, "theme", "entry") or "entry"
        stinger_font = get_setting(conn, g.tenant_id, "stinger_font", "") or ""
        # vom Admin freigeschaltete Extras (z. B. Fress-Ente beim Sushi-Regen); Admin-Tenant hat alle
        feats = features.effective(conn, g.tenant_id)
        if subdir == "alerts":   # eigene Alert-Töne aus dem Dashboard (js/alert-sound.js)
            from overlay_app import alert_sounds
            key = filepath[:-5] if filepath.endswith(".html") else ""
            if key in alert_sounds.ALERT_KEYS:
                alert_sound = alert_sounds.for_overlay(alert_sounds.load(conn, g.tenant_id), key)
                alert_sound["base"] = f"/s/{token}/alert-sounds/{key}/"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    need = features.source_feature(filepath) if subdir == "effects" else None
    if need and need not in feats:
        return BLANK_HTML, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, must-revalidate"}
    variables = {
        "__SERVE_BASE__": f"/s/{token}/",
        "__STATIC_BASE__": f"/s/{token}/",
        "__TWITCH_CHANNEL__": creds.twitch_channel or "",
        "__TWITCH_CLIENT_ID__": creds.twitch_client_id or "",
        "__THEME__": theme,
        "__STINGER_FONT__": stinger_font,
        "__FEATURES__": feats,
    }
    if alert_sound is not None:
        variables["__ALERT_SOUND__"] = alert_sound
    return serve_html_or_asset(_root(), subdir, filepath, variables, theme=theme)


_THEME_CACHE = {}   # tenant_id → (Zeitpunkt, Theme); jede OBS-Quelle fragt alle ~10 s nach
_THEME_TTL = 8.0


@bp_overlays.route("/s/<token>/theme.json")
def theme_json(token):
    """Aktuelles Tenant-Theme für den Live-Wechsel ohne Neuladen (THEME_LIVE_JS in webcore/serving.py)."""
    import time
    from webcore.serving import ALLOWED_THEMES
    if g.tenant_id is None:
        abort(404)
    now = time.time()
    hit = _THEME_CACHE.get(g.tenant_id)
    if hit and now - hit[0] < _THEME_TTL:
        theme = hit[1]
    else:
        conn = _get_conn()
        try:
            from pubg.db_pg import get_setting
            theme = get_setting(conn, g.tenant_id, "theme", "entry") or "entry"
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
        if theme not in ALLOWED_THEMES:
            theme = "entry"
        _THEME_CACHE[g.tenant_id] = (now, theme)
    return {"theme": theme}, 200, {"Cache-Control": "no-store"}


@bp_overlays.route("/s/<token>/overlays/<path:filepath>")
def overlay_file(token, filepath):
    return _serve_tenant_source(token, "overlays", filepath)


@bp_overlays.route("/s/<token>/alerts/<path:filepath>")
def alert_file(token, filepath):
    return _serve_tenant_source(token, "alerts", filepath)


@bp_overlays.route("/s/<token>/stingers/<path:filepath>")
def stinger_file(token, filepath):
    return _serve_tenant_source(token, "stingers", filepath)


@bp_overlays.route("/s/<token>/transitions/<path:filepath>")
def transition_file(token, filepath):
    return _serve_tenant_source(token, "transitions", filepath)


@bp_overlays.route("/s/<token>/effects/<path:filepath>")
def effect_file(token, filepath):
    return _serve_tenant_source(token, "effects", filepath)


# /widgets-static/ public ohne Token — damit Achievement-Icons und andere
# Widget-Assets von stream-overlay.com aus erreichbar sind (stats-overlay.info
# redirectet hierher, aber der Overlay-Service hat diese Route sonst nicht).
@bp_overlays.route("/widgets-static/<path:filepath>")
def widgets_static_public(filepath):
    return serve_asset(_root(), "widgets", filepath)


@bp_overlays.route("/s/<token>/alert-sounds/<alert>/<file_id>.mp3")
def alert_sound_file(token, alert, file_id):
    """Eigene Alert-Töne des Tenants (Upload im Dashboard), nur über dessen Token."""
    from flask import send_file
    from overlay_app import alert_sounds
    if g.tenant_id is None:
        abort(404)
    p = alert_sounds.path_of(_root(), g.tenant_id, alert, file_id)
    if not p:
        abort(404)
    return send_file(p, mimetype="audio/mpeg", max_age=86400)


# Relative ../assets/ und ../js/ aus den Overlay-HTMLs token-scoped bedienen.
@bp_overlays.route("/s/<token>/assets/<path:filepath>")
def overlay_assets(token, filepath):
    if g.tenant_id is None:
        abort(404)
    return serve_asset(_root(), "assets", filepath)


@bp_overlays.route("/s/<token>/js/<path:filepath>")
def overlay_js(token, filepath):
    if g.tenant_id is None:
        abort(404)
    return serve_asset(_root(), "js", filepath)


# Relative ../widgets/ aus Overlay-HTMLs token-scoped bedienen
# (z.B. _theme.css, _pubg.css, _blocks.css die per ../ referenziert werden).
@bp_overlays.route("/s/<token>/widgets/<path:filepath>")
def overlay_widgets_static(token, filepath):
    if g.tenant_id is None:
        abort(404)
    return serve_asset(_root(), "widgets", filepath)
