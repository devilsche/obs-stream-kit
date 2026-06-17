"""Public static assets fuer Widgets (Maps, Sounds, Icons).

Diese Files enthalten keine sensitiven Daten und werden ohne Token-Check
ausgeliefert — sonst muesste jede Map-Tile durch die Tenant-Resolution.
"""
import os
from flask import Blueprint, current_app
from webcore.serving import serve_asset


bp_static = Blueprint("widgets_static", __name__)


def _root() -> str:
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))


@bp_static.route("/widgets-static/<path:filepath>")
def widget_static(filepath):
    return serve_asset(_root(), "widgets", filepath)


@bp_static.route("/tools-static/<path:filepath>")
def tools_static(filepath):
    return serve_asset(_root(), "tools", filepath)


@bp_static.route("/design-proposals/<path:filepath>")
def design_proposals(filepath):
    # Statische Design-Mockups (docs/design-proposals/) zum Durchklicken im Browser.
    return serve_asset(_root(), os.path.join("docs", "design-proposals"), filepath)
