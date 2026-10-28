"""Admin-Fremdsicht auch auf Token-URLs: /s/<token>/...?asTenant=N zeigt
Tenant N — aber NUR mit Admin-Login. OBS (kein Cookie) und Nicht-Admins
bleiben beim Tenant des Tokens."""
from flask import g, jsonify

from app import create_app
from core import credentials


def _second_tenant(conn, slug="fremd"):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (display_name, is_admin, is_approved)
            VALUES ('Fremd', FALSE, TRUE) RETURNING id
        """)
        uid = cur.fetchone()["id"]
        cur.execute("""
            INSERT INTO tenants (owner_user_id, slug, display_name)
            VALUES (%s, %s, 'FremdTenant') RETURNING id
        """, (uid, slug))
        tid = cur.fetchone()["id"]
        cur.execute("INSERT INTO tenant_credentials (tenant_id) VALUES (%s)",
                    (tid,))
    conn.commit()
    return tid


def _app(conn, root_dir=None):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    if root_dir is not None:
        app.config["_PROJECT_ROOT"] = str(root_dir)

    @app.route("/s/<token>/probe")
    def probe(token):
        imp = getattr(g, "tenant_impersonating", None)
        return jsonify({"tenant": g.tenant_id,
                        "impersonating": imp["id"] if imp else None})
    return app


def _probe(client, token, query=""):
    return client.get(f"/s/{token}/probe{query}").get_json()


def test_admin_login_switches_tenant(pg_conn_test_setup):
    conn, tid, token, sid = pg_conn_test_setup
    other = _second_tenant(conn)
    client = _app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert _probe(client, token, f"?asTenant={other}") == {
        "tenant": other, "impersonating": other}


def test_slug_works_too(pg_conn_test_setup):
    conn, tid, token, sid = pg_conn_test_setup
    other = _second_tenant(conn, slug="originalhat3")
    client = _app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert _probe(client, token, "?asTenant=originalhat3")["tenant"] == other


def test_without_login_token_wins(pg_conn_test_setup):
    """OBS-Browser-Source: kein Cookie -> asTenant wird ignoriert."""
    conn, tid, token, _ = pg_conn_test_setup
    other = _second_tenant(conn)
    client = _app(conn).test_client()
    assert _probe(client, token, f"?asTenant={other}") == {
        "tenant": tid, "impersonating": None}


def test_non_admin_login_token_wins(pg_conn_test_setup_non_admin):
    conn, tid, token, sid = pg_conn_test_setup_non_admin
    other = _second_tenant(conn)
    client = _app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert _probe(client, token, f"?asTenant={other}") == {
        "tenant": tid, "impersonating": None}


def test_unknown_tenant_keeps_token_tenant(pg_conn_test_setup):
    conn, tid, token, sid = pg_conn_test_setup
    client = _app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert _probe(client, token, "?asTenant=999999")["tenant"] == tid


def test_admin_without_as_tenant_unchanged(pg_conn_test_setup):
    conn, tid, token, sid = pg_conn_test_setup
    client = _app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert _probe(client, token) == {"tenant": tid, "impersonating": None}


def test_widget_html_shows_banner_in_foreign_view(pg_conn_test_setup, tmp_path):
    conn, tid, token, sid = pg_conn_test_setup
    other = _second_tenant(conn)
    credentials.set_pubg(conn, other, name="Fremd_Player", api_key="k")
    (tmp_path / "widgets" / "pubg").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "deathmatch-stats.html").write_text(
        "<html><head></head><body>DM</body></html>")
    client = _app(conn, tmp_path).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")

    body = client.get(f"/s/{token}/widgets/pubg/deathmatch-stats.html"
                      f"?asTenant={other}").get_data(as_text=True)
    assert "obs-impersonation" in body
    assert f"#{other}" in body
    assert "Back to my own view" in body
    assert "obs-impersonation--badge" in body   # schwebt, schiebt nichts weg

    # Eigene Sicht: kein Banner
    credentials.set_pubg(conn, tid, name="Ich", api_key="k")
    own = client.get(f"/s/{token}/widgets/pubg/deathmatch-stats.html"
                     ).get_data(as_text=True)
    assert "obs-impersonation" not in own
