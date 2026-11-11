"""OBS-Dock der Weather-Source: Statuszeile und Knöpfe aus dem Katalog, nur mit Login."""
import re

from app import create_app


def _client(conn, sid):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_dock_shows_controls_and_status(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    with conn.cursor() as cur:
        cur.execute("INSERT INTO widget_tokens (tenant_id, token, label) VALUES (%s, %s, %s)", (tid, "tok_dock", "Dock"))
    conn.commit()
    html = _client(conn, sid).get("/app/dock/weather?place=Berlin").get_data(as_text=True)
    assert re.search(r"var api = '/s/[^/']+/api/fx/weather'", html)
    assert 'data-q="cmd=weather&amp;to=day"' in html and "Time of day for 2.5 min" in html
    assert 'role="status"' in html and '"Berlin"' in html


def test_dock_needs_login(client):
    assert client.get("/app/dock/weather").status_code in (302, 401)
