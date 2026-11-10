"""Follower-Import über den Twitch-Login in die gemeinsame Follower-Liste."""
import sqlite3

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from fx import autumn_db, season_db, weather_followers, xmas_db
from webcore import auth


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    for m in (xmas_db, season_db, autumn_db, weather_followers):
        m.init_schema(c)
    yield c
    c.close()


def _app(conn):
    app = Flask(__name__)
    app.config.update(_PG_CONN_FACTORY=lambda: conn, TWITCH_CLIENT_ID="cid")
    return app


def test_import_adds_oldest_first_and_skips_known(conn, monkeypatch):
    weather_followers.add(conn, 7, "Alt")
    monkeypatch.setattr(auth, "get_recent_followers", lambda tok, cid, bid, n: ["Neu", "Mitte", "Alt"])
    with _app(conn).test_request_context():
        resp = auth._finish_follower_import({"tenant": 7, "twitch_user_id": "99"}, "tok", {"id": "99"},
                                            {"TWITCH_CLIENT_ID": "cid"})
    assert resp.status_code == 302 and "followers_imported=2" in resp.location
    assert weather_followers.load(conn, 7)["names"] == ["Alt", "Mitte", "Neu"]


def test_import_refuses_foreign_twitch_account(conn, monkeypatch):
    monkeypatch.setattr(auth, "get_recent_followers", lambda *a: ["X"])
    with _app(conn).test_request_context():
        with pytest.raises(Forbidden):
            auth._finish_follower_import({"tenant": 7, "twitch_user_id": "99"}, "tok", {"id": "42"},
                                         {"TWITCH_CLIENT_ID": "cid"})
    assert weather_followers.load(conn, 7)["names"] == []
