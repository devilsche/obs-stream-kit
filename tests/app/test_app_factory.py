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
