"""Service 2 (stream-overlay.com): eigenes, TOKEN-basiertes Overlay-Dashboard.
Kein Login/Cookie — der Token im Pfad (/s/<token>/) authentifiziert, wie bei
den Overlays selbst. Die Fake-DB im conftest loest jeden Token auf tenant_id 7."""


def test_landing_renders(app):
    r = app.test_client().get("/")
    assert r.status_code == 200
    assert b"Overlay-Service" in r.data


def test_dashboard_lists_overlays_for_token(app):
    r = app.test_client().get("/s/tok123/")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert "Starting Soon" in body
    # URLs zeigen mit genau diesem Token auf die eigene Domain
    assert "/s/tok123/overlays/starting-soon.html" in body


def test_dashboard_no_redirect_to_stats(app):
    # Das Dashboard rendert selbst (200), leitet NICHT auf stats-overlay.info um.
    r = app.test_client().get("/s/tok123/")
    assert r.status_code == 200
    assert "stats-overlay.info/app/urls" not in r.headers.get("Location", "")
