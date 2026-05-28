"""obs-stream-kit Flask-App-Factory."""
from flask import Flask, jsonify

from app.config import Config, TestingConfig


def create_app(testing: bool = False) -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
