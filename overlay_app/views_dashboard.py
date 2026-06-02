"""Overlay-Dashboard (Service 2, stream-overlay.com) — TOKEN-basiert, KEIN Login.

Der Tenant ruft sein eigenes Dashboard ueber /s/<token>/ auf — derselbe Token
wie fuer die Overlays selbst. Die Middleware validiert den Token (404 bei
unbekannt) und setzt g.tenant_id. Bewusst KEIN OAuth/Cookie: ein Login-Cookie
waere auf dieser eigenen TLD ohnehin nicht von stats-overlay.info aus gueltig
(cross-TLD) — der Token im Pfad ist die saubere, schon etablierte Auth.
"""
from flask import Blueprint, render_template, request

from overlay_app.overlay_catalog import OVERLAYS


bp_dashboard = Blueprint("overlay_dashboard", __name__)


@bp_dashboard.route("/")
def landing():
    return render_template("overlay_landing.html")


@bp_dashboard.route("/s/<token>/")
def dashboard(token):
    # Token ist durch die Middleware bereits validiert (sonst 404).
    base_url = request.url_root.rstrip("/")
    return render_template("overlay_dashboard.html",
                           overlays=OVERLAYS, token=token, base_url=base_url)
