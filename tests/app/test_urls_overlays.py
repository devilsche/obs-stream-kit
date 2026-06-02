"""Overlay-Sektion auf /app/urls: URLs muessen die eigene Overlay-Domain
(OBS_KIT_OVERLAY_BASE_URL, z.B. stream-overlay.com) nutzen, NICHT die
Stats-Domain — die Overlays laufen auf Service 2 unter eigener TLD."""
from flask import render_template, g

from app import create_app
from overlay_app.overlay_catalog import OVERLAYS

TOKEN = "tok_" + "a" * 32


def _render_urls(overlay_base):
    app = create_app(testing=True)
    with app.test_request_context("/app/urls"):
        g.tenant_impersonating = None
        return render_template(
            "urls.html",
            user={"is_admin": False, "display_name": "T"},
            token=TOKEN,
            widgets=[],
            base_url="https://stats-overlay.info",
            overlays=OVERLAYS,
            overlay_base=overlay_base,
        )


def test_urls_template_renders_overlay_sources():
    html = _render_urls("https://stream-overlay.com")
    # Jede Overlay-Szene erscheint mit der Overlay-Domain als OBS-URL
    for o in OVERLAYS:
        expected = f"https://stream-overlay.com/s/{TOKEN}/overlays/{o['file']}"
        assert expected in html, f"fehlt: {expected}"


def test_overlay_urls_do_not_use_stats_base():
    html = _render_urls("https://stream-overlay.com")
    # Overlays duerfen NICHT ueber die Stats-Domain ausgeliefert werden
    assert f"https://stats-overlay.info/s/{TOKEN}/overlays/" not in html
