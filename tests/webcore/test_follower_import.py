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


def test_sub_import_turns_subscribers_into_gifts(conn, monkeypatch):
    xmas_db.add_gift(conn, 7, "Known", "sub", 1)
    monkeypatch.setattr(auth, "get_subscribers", lambda tok, cid, bid: [
        {"name": "Streamer", "tier": 1, "gift": False, "gifter": ""},      # eigener Kanal zählt nicht
        {"name": "Known", "tier": 1, "gift": False, "gifter": ""},         # hat schon ein Geschenk
        {"name": "Tia", "tier": 1, "gift": False, "gifter": ""},
        {"name": "x1", "tier": 1, "gift": True, "gifter": "Santa"},
        {"name": "x2", "tier": 1, "gift": True, "gifter": "Santa"},
        {"name": "Big", "tier": 3, "gift": False, "gifter": ""}])
    with _app(conn).test_request_context():
        resp = auth._finish_sub_import({"tenant": 7, "twitch_user_id": "99"}, "tok",
                                       {"id": "99", "display_name": "Streamer"}, {"TWITCH_CLIENT_ID": "cid"})
    assert resp.status_code == 302 and "subs_imported=3" in resp.location and "subs_seen=5" in resp.location
    gifts = {g["name"]: (g["type"], g["amount"]) for g in xmas_db.load_state(conn, 7)["gifts"]}
    assert gifts == {"Known": ("sub", 1), "Tia": ("sub", 1), "Santa": ("giftsub", 2), "Big": ("sub", 3)}


def test_sub_import_refuses_foreign_twitch_account(conn, monkeypatch):
    monkeypatch.setattr(auth, "get_subscribers", lambda *a: [{"name": "X", "tier": 1, "gift": False, "gifter": ""}])
    with _app(conn).test_request_context():
        with pytest.raises(Forbidden):
            auth._finish_sub_import({"tenant": 7, "twitch_user_id": "99"}, "tok", {"id": "42"},
                                    {"TWITCH_CLIENT_ID": "cid"})
