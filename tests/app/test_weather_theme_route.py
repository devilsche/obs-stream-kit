"""Weather-Karte: das Dashboard fragt den Server nach dem sichtbaren Deko-Thema."""
import datetime

from app import create_app
from core.db_compat import SqliteCompatConn
from fx import weather_theme


def _client(conn, sid):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_theme_follows_early_start_and_tree(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    with conn.cursor() as cur:
        cur.execute(weather_theme.PG_SCHEMA)
    db = SqliteCompatConn(conn)
    c = _client(conn, sid)
    today = datetime.date.today()
    cal = weather_theme.calendar_theme(today)
    assert c.get("/app/api/weather/theme?theme=auto&xmasfrom=12-30&xmasto=12-31").json == {"theme": cal}
    assert c.get("/app/api/weather/theme?theme=spring").json == {"theme": "spring"}
    weather_theme.early_start(db, tid, today, "next")
    nxt = weather_theme.load_early(db, tid)["theme"]
    assert c.get("/app/api/weather/theme?theme=auto&xmasfrom=12-30&xmasto=12-31").json == {"theme": nxt}
    # aufgebauter Baum schlägt auch ein fest gewähltes Thema
    weather_theme.mark(db, tid, today, {}, "setup")
    assert c.get("/app/api/weather/theme?theme=spring").json == {"theme": "winter"}


def test_theme_needs_login(client):
    assert client.get("/app/api/weather/theme").status_code in (302, 401)


def test_follower_import_starts_on_dashboard_service(pg_conn_test_setup):
    # nginx schickt /app/* an den Dashboard-Dienst; der Callback läuft im API-Dienst
    conn, _, _, sid = pg_conn_test_setup
    r = _client(conn, sid).get("/app/twitch/import-followers")
    assert r.status_code == 302 and "moderator%3Aread%3Afollowers" in r.headers["Location"]
