"""Service 2 (stream-overlay.com) hat kein eigenes Login — das SSO-Cookie ist
auf die Stats-Domain (andere TLD) gescoped und kommt hier nicht an. Der Root-
Pfad leitet daher direkt auf die Overlay-URL-Uebersicht der Stats-Domain um."""


def test_dashboard_redirects_to_main_urls(app):
    r = app.test_client().get("/")
    assert r.status_code == 302
    assert r.headers["Location"] == "https://stats-overlay.info/app/urls"
