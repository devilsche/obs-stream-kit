"""Overlay-Mini-Dashboard: tokenisierte URLs der Produktions-Overlays."""
from flask import Blueprint, render_template, g, request, current_app

from webcore.middleware import require_session, _get_conn
from overlay_app.overlay_catalog import OVERLAYS


bp_dashboard = Blueprint("overlay_dashboard", __name__)


def _tenant_token(tenant_id: int):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT token FROM widget_tokens
                WHERE tenant_id = %s AND revoked_at IS NULL
                ORDER BY created_at LIMIT 1
            """, (tenant_id,))
            row = cur.fetchone()
        return row["token"] if row else None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_dashboard.route("/")
@require_session
def dashboard():
    token = _tenant_token(g.tenant_id) if g.tenant_id else None
    base_url = request.url_root.rstrip("/")
    return render_template("overlay_dashboard.html",
                           overlays=OVERLAYS, token=token,
                           base_url=base_url, user=g.user)
