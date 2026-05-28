"""obs-stream-kit Flask-App-Factory."""
import os
from flask import Flask, jsonify

from app.config import Config, TestingConfig
from app.middleware import register_middleware
from app.auth import bp_auth
from app.views_admin import bp_admin
from app.views_widgets import bp_widgets
from app.views_static import bp_static
from app.views_api import bp_api


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__,
                template_folder="templates",
                static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    register_middleware(app)
    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_admin)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    app.register_blueprint(bp_api)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
