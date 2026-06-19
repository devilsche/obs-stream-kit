"""Widget-Routes: HTML mit Inject + statisches Asset-Serving unter /s/<token>/."""
import os
from flask import Blueprint, send_from_directory, current_app, g, request, abort
from webcore.serving import inject_window_vars, inject_theme


bp_widgets = Blueprint("widgets", __name__)


def _project_root() -> str:
    root = current_app.config.get("_PROJECT_ROOT")
    if root:
        return root
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@bp_widgets.route("/s/<token>/widgets/<path:filepath>")
def widget_file(token, filepath):
    root = _project_root()
    # TODO(Task 7): inline traversal+open below könnte webcore.serving.
    # serve_html_or_asset nutzen, sobald der Creds-Gate ausgelagert ist.
    full_path = os.path.normpath(os.path.join(root, "widgets", filepath))
    widgets_root = os.path.join(root, "widgets")
    if not full_path.startswith(widgets_root):
        abort(404)
    if not os.path.exists(full_path):
        abort(404)

    if filepath.endswith(".html"):
        # Credentials-Gate: blocke wenn der Tenant keine API-Keys
        # fuer die vom Widget benoetigte Domain hinterlegt hat.
        from webcore.creds_gate import (required_domains, missing_domains,
                                      render_block_page)
        needed = required_domains("widgets/" + filepath)
        if needed and g.tenant_id is not None:
            from webcore.middleware import _get_conn
            from core import credentials as core_creds
            conn = _get_conn()
            try:
                creds = core_creds.get(conn, g.tenant_id)
                from pubg.db_pg import get_setting
                gate_theme = get_setting(conn, g.tenant_id, "theme", "entry") or "entry"
            finally:
                if "_PG_CONN_FACTORY" not in current_app.config:
                    conn.close()
            missing = missing_domains(creds, needed)
            if missing:
                # Browser-Sources haben keinen Cookie-Login, daher
                # kein /app/setup-Link aus dem Widget — Hinweis genuegt.
                return (render_block_page("widgets/" + filepath, missing,
                                            setup_url="#", theme=gate_theme),
                        200, {"Content-Type": "text/html; charset=utf-8"})

        with open(full_path, "r", encoding="utf-8") as f:
            html = f.read()

        # Theme des Tenants ermitteln (server-injiziert → kein FOUC).
        # Default "entry" == aktueller Look, falls nichts gesetzt ist.
        theme = "entry"
        if g.tenant_id is not None:
            from webcore.middleware import _get_conn
            from pubg.db_pg import get_setting
            conn = _get_conn()
            try:
                theme = get_setting(conn, g.tenant_id, "theme", "entry") or "entry"
            finally:
                if "_PG_CONN_FACTORY" not in current_app.config:
                    conn.close()

        variables = {
            "__SERVE_BASE__": f"/s/{token}/",
            "__STATIC_BASE__": "/widgets-static/",
            "__THEME__": theme,
        }
        html = inject_theme(html, theme)
        # no-cache: die HTML wird pro Request mit Token + Theme injiziert und darf
        # nicht veraltet im Browser/OBS haengenbleiben (sonst altes/kein data-theme).
        return (inject_window_vars(html, variables), 200,
                {"Content-Type": "text/html; charset=utf-8",
                 "Cache-Control": "no-cache, must-revalidate"})

    return send_from_directory(os.path.dirname(full_path), os.path.basename(full_path))
