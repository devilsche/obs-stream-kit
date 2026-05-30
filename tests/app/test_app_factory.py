import pytest
from app import create_app


def test_create_app_returns_flask():
    app = create_app(testing=True)
    assert app.name == "app"


def test_app_has_healthz_route():
    app = create_app(testing=True)
    client = app.test_client()
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json == {"status": "ok"}


def test_proxyfix_respects_x_forwarded_proto():
    """Mit X-Forwarded-Proto: https muss request.url_root https:// zurückgeben."""
    app = create_app(testing=True)

    @app.route("/__scheme_probe__")
    def _probe():
        from flask import request
        return {"scheme": request.scheme, "url_root": request.url_root}

    client = app.test_client()
    resp = client.get("/__scheme_probe__",
                      headers={"X-Forwarded-Proto": "https",
                               "X-Forwarded-Host": "stats-overlay.info"})
    assert resp.status_code == 200
    assert resp.json["scheme"] == "https"
    assert resp.json["url_root"].startswith("https://stats-overlay.info")


def test_proxyfix_defaults_to_http_without_header():
    """Ohne X-Forwarded-Proto bleibt es http:// (lokales Dev / direkter Zugriff)."""
    app = create_app(testing=True)

    @app.route("/__scheme_probe2__")
    def _probe():
        from flask import request
        return {"scheme": request.scheme}

    resp = app.test_client().get("/__scheme_probe2__")
    assert resp.json["scheme"] == "http"
