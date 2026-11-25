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


def test_others_see_no_extras(pg_conn_test_setup_non_admin):
    """Ohne Freischaltung: keine Reiter Weather/Race/Ducks, keine ihrer Karten, Werkzeuge oder Dock."""
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid)
    body = c.get("/app/urls").get_data(as_text=True)
    for needle in ("?d=weather", "?d=race", "?d=ducks", "What rains", 'data-path="effects/weather.html"',
                   'data-path="effects/car-race.html"', 'data-path="effects/duck-parade.html"', "dn-extra"):
        assert needle not in body, needle
    assert c.get("/app/dock/weather").status_code == 403


def test_car_model_options_from_catalog(tmp_path):
    """Auswahl „Car model“ (für den kommenden Burnout-Effekt): Mix, je Marke, je Auto."""
    from app.views_app import _car_model_switch
    d = tmp_path / "data" / "car-rain"
    d.mkdir(parents=True)
    (d / "catalog.json").write_text('[{"uid": "a", "key": "p911", "brand": "Porsche", "name": "911 Turbo"}]')
    sw = _car_model_switch(str(tmp_path), {"key": "model", "options": []})
    assert ["mix", "Random mix"] in sw["options"] and ["brand:Porsche", "All Porsche"] in sw["options"]
    assert ["p911", "Porsche – 911 Turbo"] in sw["options"]


def test_race_and_ducks_domains(pg_conn_test_setup):
    """Effects landen per EFFECT_META["domain"] im Race- bzw. Ducks-Tab, Tool-Links und Nav-Einträge stehen da."""
    conn, tid, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    body = c.get("/app/urls?d=race").get_data(as_text=True)
    assert 'href="/app/urls?d=race" aria-current="page"' in body and "?d=ducks" in body and "?d=weather" in body
    for needle in ('data-path="effects/car-race.html"', 'data-path="effects/car-burnout.html"', 'href="/app/tools/car-drive"',
                   'href="/app/tools/car-editor"', "cmd=records"):
        assert needle in body, needle
    import re
    def tab_of(path):
        return re.search(r'data-path="%s"[^>]*?data-tab="(\w+)"|data-tab="(\w+)"[^>]*?data-path="%s"' % (path, path), body)
    for path, dom in (("effects/car-race.html", "race"), ("effects/duck-parade.html", "ducks"), ("effects/item-rain.html", "race"),
                      ("effects/weather.html", "weather"), ("effects/xmas.html", "weather"), ("effects/lens-flare.html", "stream")):
        m = re.search(r'<[^>]*data-path="%s"[^>]*>' % re.escape(path), body)
        assert m and 'data-tab="%s"' % dom in m.group(0), path
    assert 'href="/app/tools/duck-editor"' in body
