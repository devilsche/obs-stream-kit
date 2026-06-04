"""obs-stream-kit Flask-App-Factory."""
import os
from flask import Flask, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix

from webcore.config import Config, TestingConfig
from webcore.middleware import register_middleware
from app.views_admin import bp_admin
from app.views_widgets import bp_widgets
from app.views_static import bp_static
from app.views_app import bp_app
from overlay_app.views_overlays import bp_overlays
from webcore.metrics import register_metrics


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__,
                template_folder="templates",
                static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    # Hinter nginx: X-Forwarded-Proto/Host/For respektieren, damit
    # request.url_root korrekt https://stats-overlay.info/ liefert.
    # Streng x_*=1, weil genau ein vertrauenswuerdiger Proxy-Hop existiert.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)

    register_middleware(app)
    register_metrics(app)
    app.register_blueprint(bp_admin)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    app.register_blueprint(bp_app)
    # Overlay-Auslieferung (frueher Service 2) ins Frontend integriert:
    # /s/<token>/overlays|assets|js/...  (reines Datei-Serving, kein Template)
    app.register_blueprint(bp_overlays)

    @app.context_processor
    def inject_theme_var():
        """Stellt {{ theme }} allen Templates bereit (base.html setzt es aufs
        <html>). Liest das Tenant-Theme aus der settings-Tabelle; faellt bei
        fehlendem Login/DB-Problem sauber auf 'entry' (= aktueller Look) zurueck."""
        from flask import g
        theme = "entry"
        tid = getattr(g, "tenant_id", None)
        if tid is not None:
            try:
                from webcore.middleware import _get_conn
                from pubg.db_pg import get_setting
                conn = _get_conn()
                try:
                    theme = get_setting(conn, tid, "theme", "entry") or "entry"
                finally:
                    if "_PG_CONN_FACTORY" not in app.config:
                        conn.close()
            except Exception:
                theme = "entry"
        return {"theme": theme}

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
