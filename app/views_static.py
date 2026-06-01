"""Public static assets fuer Widgets (Maps, Sounds, Icons)."""
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
