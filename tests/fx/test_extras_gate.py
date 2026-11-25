"""Weather und Race nur mit Freischaltung: alle Endpunkte 403, Chat-Befehle bleiben stumm."""
from flask import Flask, g

from fx import endpoints
from fx.endpoints import bp_fx


def _client(root, tenant_id=2):
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = root
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


LOCKED = ("/s/t/api/fx/weather?cmd=set&kind=rain", "/s/t/api/fx/weather/state", "/s/t/api/fx/xmas/poll?since=0",
          "/s/t/api/fx/winter?cmd=reset", "/s/t/api/fx/car-race?cmd=records", "/s/t/api/fx/car-drive",
          "/s/t/api/fx/cars/catalog.json", "/s/t/api/fx/track-ads.json")


def test_locked_without_feature(tmp_path, monkeypatch):
    monkeypatch.setattr(endpoints, "_feats", lambda: ["ducks"])
    c = _client(str(tmp_path))
    for url in LOCKED:
        assert c.get(url).status_code == 403, url


def test_open_with_feature(tmp_path, monkeypatch):
    monkeypatch.setattr(endpoints, "_feats", lambda: ["weather", "race"])
    c = _client(str(tmp_path))
    for url in LOCKED:
        assert c.get(url).status_code != 403, url
