"""Dashboard: Alerts sind EINE Quelle (live.html) mit Reitern je Alert statt Einzelkarten."""
import json
import re

from app import create_app


def test_only_live_alert_card_and_alert_types_for_tabs(pg_conn_test_setup_non_admin):
    conn, tid, token, sid = pg_conn_test_setup_non_admin
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    body = c.get("/app/urls").get_data(as_text=True)
    paths = re.findall(r'data-path="(alerts/[^"]+)"', body)
    assert paths == ["alerts/live.html"]
    m = re.search(r'<script type="application/json" id="alertTypesData">(.*?)</script>', body, re.S)
    keys = [a["key"] for a in json.loads(m.group(1)) if not a.get("host")]
    assert keys == ["follow", "sub", "resub", "giftsub", "bits", "raid", "donation", "welcome"]
    assert "wireAlertTabs" in body
