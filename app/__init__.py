"""obs-stream-kit Flask-App-Factory."""
import os
from flask import Flask, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix

from webcore.config import Config, TestingConfig
from webcore.middleware import register_middleware
from webcore.auth import bp_auth
from app.views_admin import bp_admin
from app.views_widgets import bp_widgets
from app.views_static import bp_static
from app.views_api import bp_api
from app.views_app import bp_app
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
    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_admin)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    app.register_blueprint(bp_api)
    app.register_blueprint(bp_app)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
