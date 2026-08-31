from app import create_app
from webcore.middleware import register_middleware
from app.views_widgets import bp_widgets
from app.views_static import bp_static


def _make_app(conn, root_dir):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(root_dir)
    return app


def test_widget_html_injects_serve_base(pg_conn_test_setup, tmp_path):
    conn, tid, token, _ = pg_conn_test_setup
    # Ohne PUBG-Credentials liefert das creds_gate die Setup-Seite statt des Widgets
    from core import credentials as core_creds
    core_creds.set_pubg(conn, tid, name="Tester", platform="steam",
                        api_key="key-123")
    (tmp_path / "widgets" / "pubg").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "last-match.html").write_text(
        "<html><head></head><body>HI</body></html>"
    )
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get(f"/s/{token}/widgets/pubg/last-match.html")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "window.__SERVE_BASE__" in body
    assert token in body


def test_widget_static_no_token_needed(pg_conn_test_setup, tmp_path):
    conn, *_ = pg_conn_test_setup
    (tmp_path / "widgets" / "pubg" / "assets").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "assets" / "icon.png").write_bytes(b"\x89PNG")
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get("/widgets-static/pubg/assets/icon.png")
    assert resp.status_code == 200
    assert resp.data.startswith(b"\x89PNG")


def test_unknown_token_404(pg_conn_test_setup, tmp_path):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get("/s/tok_nope/widgets/pubg/last-match.html")
    assert resp.status_code == 404


# ── Impersonation-Banner in datei-servierten Tools ──────────────────────────

def _second_tenant(conn, slug="fremd"):
    """Zweiter Tenant mit PUBG-Credentials (sonst greift das Creds-Gate)."""
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


def _creds_for(conn, tenant_id):
    """PUBG-Name + Key setzen, damit das Tool nicht am Creds-Gate haengt."""
    from core import credentials
    credentials.set_pubg(conn, tenant_id, name="Fremd_Player",
                         api_key="key-fremd")


def test_tool_in_foreign_view_shows_the_banner(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    other = _second_tenant(conn)
    _creds_for(conn, other)
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    client = app.test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    resp = client.get(f"/app/tools/weapon-performance?asTenant={other}")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "obs-impersonation" in body
    # Angezeigt wird der Twitch-Anzeigename des Tenant-Owners (wie in base.html)
    assert "Fremd" in body
    assert f"#{other}" in body


def test_tool_in_own_view_has_no_banner(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    _creds_for(conn, tenant_id)
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    client = app.test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    resp = client.get("/app/tools/weapon-performance")
    assert resp.status_code == 200
    assert "obs-impersonation" not in resp.get_data(as_text=True)
