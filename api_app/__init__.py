"""obs-stream-kit API-Service (intern) — App-Factory.

Eigener Prozess, bindet im Betrieb nur 127.0.0.1 (von aussen nur via
nginx-Pfad-Routing erreichbar). Haelt die Daten-/Auth-Schicht:
- bp_auth     — Twitch-OAuth + Sessions (/app/login, /app/oauth/callback, /app/logout)
- bp_api      — PUBG/Steam-Daten (/api/*, /s/<token>/api/*)
- bp_twitch   — Twitch-Clips (/s/<token>/api/twitch/clips)

Das Frontend (app/) rendert das Dashboard und liefert Widgets/Tools/Overlays
aus; Browser-Daten-Calls landen via nginx hier. Auth/Session-DB ist geteilt
(core/webcore), die Session-Validierung im Frontend liest dieselbe DB.
"""
import os
from flask import Flask, jsonify, request, abort
from werkzeug.middleware.proxy_fix import ProxyFix

from webcore.config import Config, TestingConfig
from webcore.middleware import register_middleware
from webcore.metrics import register_metrics
from webcore.auth import bp_auth
from webcore.views_twitch import bp_twitch
from app.views_api import bp_api


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__)
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    # Hinter nginx: X-Forwarded-* respektieren (genau ein vertrauenswuerdiger Hop).
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)

    register_middleware(app)
    register_metrics(app)
    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_api)
    app.register_blueprint(bp_twitch)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    # Poller-Zustand aller Tenants fuer das Admin-Dashboard im Frontend-
    # Prozess (dort laufen keine Poller). Nur lokal: nginx leitet /internal
    # nicht hierher, und hinter nginx waere remote_addr die Client-IP.
    @app.route("/internal/status")
    def internal_status():
        if request.remote_addr not in ("127.0.0.1", "::1"):
            abort(404)
        from app.views_api import _pubg_status_all
        from app.poller_startup import _steam_poller
        steam = (_steam_poller.status_all()
                 if _steam_poller is not None and hasattr(_steam_poller, "status_all")
                 else {})
        return jsonify({"pubg": _pubg_status_all(),
                        "steam": {str(k): v for k, v in steam.items()}})

    return app
