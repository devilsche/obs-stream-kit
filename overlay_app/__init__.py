"""obs-stream-kit Overlay-Service (Service 2) App-Factory."""
import os
from flask import Flask, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix

from webcore.config import Config, TestingConfig
from webcore.middleware import register_middleware
from webcore.metrics import register_metrics
from webcore.views_twitch import bp_twitch
from overlay_app.views_overlays import bp_overlays


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    # Login/Pending zeigen auf die Haupt-Domain (Overlay-Service hat kein OAuth).
    app.config["LOGIN_URL"] = (
        os.environ.get("OBS_KIT_MAIN_LOGIN_URL")
        or "https://stats-overlay.info/app/login")
    app.config["PENDING_URL"] = (
        os.environ.get("OBS_KIT_MAIN_PENDING_URL")
        or "https://stats-overlay.info/app/pending")

    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)

    register_middleware(app)
    register_metrics(app)
    app.register_blueprint(bp_overlays)
    app.register_blueprint(bp_twitch)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
