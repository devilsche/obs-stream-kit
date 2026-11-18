"""Dashboard-Quellen: Item-Rain-Schalter für Enten-Extras nur mit Freischaltung (Admin-Tenant hat alle)."""
from app import create_app


def _client(conn, sid):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_admin_sees_duck_switches(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    body = _client(conn, sid).get("/app/urls").get_data(as_text=True)
    assert "What rains" in body and "Eating duck (sushi)" in body and "Vacuum duck" in body


def test_others_see_only_basic_switches(pg_conn_test_setup_non_admin):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    body = _client(conn, sid).get("/app/urls").get_data(as_text=True)
    assert "What rains" in body
    assert "Eating duck (sushi)" not in body and "Vacuum duck" not in body and "Duck outfit" not in body
