"""Public static assets fuer Widgets (Maps, Sounds, Icons).

Diese Files enthalten keine sensitiven Daten und werden ohne Token-Check
ausgeliefert — sonst muesste jede Map-Tile durch die Tenant-Resolution.
"""
import os
from flask import Blueprint, send_from_directory, current_app


bp_static = Blueprint("widgets_static", __name__)


def _serve_under(subdir: str, filepath: str):
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    base = os.path.join(root, subdir)
    full_path = os.path.normpath(os.path.join(base, filepath))
    if not full_path.startswith(base):
        return ("", 404)
    if not os.path.isfile(full_path):
        return ("", 404)
    return send_from_directory(os.path.dirname(full_path),
                                os.path.basename(full_path))


@bp_static.route("/widgets-static/<path:filepath>")
def widget_static(filepath):
    return _serve_under("widgets", filepath)


@bp_static.route("/tools-static/<path:filepath>")
def tools_static(filepath):
    return _serve_under("tools", filepath)
