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


@bp_overlays.route("/s/<token>/overlays/<path:filepath>")
def overlay_file(token, filepath):
    if g.tenant_id is None:
        abort(404)
    creds = _tenant_creds(g.tenant_id)
    variables = {
        "__SERVE_BASE__": f"/s/{token}/",
        "__STATIC_BASE__": f"/s/{token}/",
        "__TWITCH_CHANNEL__": creds.twitch_channel or "",
        "__TWITCH_CLIENT_ID__": creds.twitch_client_id or "",
    }
    return serve_html_or_asset(_root(), "overlays", filepath, variables)


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
