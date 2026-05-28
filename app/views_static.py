"""Public static assets fuer Widgets (Maps, Sounds, Icons).

Diese Files enthalten keine sensitiven Daten und werden ohne Token-Check
ausgeliefert — sonst muesste jede Map-Tile durch die Tenant-Resolution.
"""
import os
from flask import Blueprint, send_from_directory, current_app


bp_static = Blueprint("widgets_static", __name__)


@bp_static.route("/widgets-static/<path:filepath>")
def widget_static(filepath):
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    widgets_root = os.path.join(root, "widgets")
    full_path = os.path.normpath(os.path.join(widgets_root, filepath))
    if not full_path.startswith(widgets_root):
        return ("", 404)
    if not os.path.isfile(full_path):
        return ("", 404)
    return send_from_directory(os.path.dirname(full_path),
                                os.path.basename(full_path))
