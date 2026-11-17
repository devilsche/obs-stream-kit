"""Enten nur mit Freischaltung „ducks“: Endpunkte gesperrt, custom.js leer."""
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


def test_duck_endpoints_locked_without_feature(tmp_path, monkeypatch):
    monkeypatch.setattr(endpoints, "_ducks_ok", lambda: False)
    c = _client(str(tmp_path))
    for url in ("/s/t/api/fx/ducks/outfit?user=bob&q=knight", "/s/t/api/fx/ducks/greet?user=bob",
                "/s/t/api/fx/ducks/parade", "/s/t/api/fx/duckgreet/poll?since=0"):
        assert c.get(url).status_code == 403, url
    r = c.get("/s/t/api/fx/ducks/custom.js")
    assert r.status_code == 200 and "setViewers" not in r.get_data(as_text=True)


def test_other_effects_unaffected(tmp_path, monkeypatch):
    monkeypatch.setattr(endpoints, "_ducks_ok", lambda: False)
    assert _client(str(tmp_path)).get("/s/t/api/fx/rain/poll?since=0").status_code == 200
