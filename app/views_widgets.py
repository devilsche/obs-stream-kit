"""Widget-Routes: HTML mit Inject + statisches Asset-Serving unter /s/<token>/."""
import os
from flask import Blueprint, send_from_directory, current_app, g, request, abort


bp_widgets = Blueprint("widgets", __name__)


def _project_root() -> str:
    root = current_app.config.get("_PROJECT_ROOT")
    if root:
        return root
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _inject(html: str, token: str) -> str:
    """Setzt window.__SERVE_BASE__ + window.__STATIC_BASE__ ein."""
    script = (
        f'<script>\n'
        f'window.__SERVE_BASE__ = "/s/{token}/";\n'
        f'window.__STATIC_BASE__ = "/widgets-static/";\n'
        f'</script>'
    )
    if "</head>" in html:
        return html.replace("</head>", script + "\n</head>", 1)
    return script + "\n" + html


@bp_widgets.route("/s/<token>/widgets/<path:filepath>")
def widget_file(token, filepath):
    root = _project_root()
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
            finally:
                if "_PG_CONN_FACTORY" not in current_app.config:
                    conn.close()
            missing = missing_domains(creds, needed)
            if missing:
                # Browser-Sources haben keinen Cookie-Login, daher
                # kein /app/setup-Link aus dem Widget — Hinweis genuegt.
                return (render_block_page("widgets/" + filepath, missing,
                                            setup_url="#"),
                        200, {"Content-Type": "text/html; charset=utf-8"})

        with open(full_path, "r", encoding="utf-8") as f:
            html = f.read()
        return _inject(html, token), 200, {"Content-Type": "text/html; charset=utf-8"}

    return send_from_directory(os.path.dirname(full_path), os.path.basename(full_path))
