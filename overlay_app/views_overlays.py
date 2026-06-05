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


def _serve_tenant_source(token, subdir, filepath):
    """HTML/Asset aus <subdir> token-scoped ausliefern (mit Window-Var-Inject +
    server-injiziertem Tenant-Theme, damit z.B. Alerts im hinterlegten Theme
    statt im Entry-Look erscheinen)."""
    if g.tenant_id is None:
        abort(404)
    creds = _tenant_creds(g.tenant_id)
    theme = "entry"
    stinger_font = ""
    conn = _get_conn()
    try:
        from pubg.db_pg import get_setting
        theme = get_setting(conn, g.tenant_id, "theme", "entry") or "entry"
        stinger_font = get_setting(conn, g.tenant_id, "stinger_font", "") or ""
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    variables = {
        "__SERVE_BASE__": f"/s/{token}/",
        "__STATIC_BASE__": f"/s/{token}/",
        "__TWITCH_CHANNEL__": creds.twitch_channel or "",
        "__TWITCH_CLIENT_ID__": creds.twitch_client_id or "",
        "__THEME__": theme,
        "__STINGER_FONT__": stinger_font,
    }
    return serve_html_or_asset(_root(), subdir, filepath, variables, theme=theme)


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
