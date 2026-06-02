from overlay_app import create_app


def test_factory_builds_app():
    app = create_app(testing=True)
    assert app is not None


def test_healthz_ok():
    app = create_app(testing=True)
    r = app.test_client().get("/healthz")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"
