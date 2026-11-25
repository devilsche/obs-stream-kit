"""Zustand des eigenen PUBG-Keys: Einordnung, Merken mit „since“, Sperre nur für neue Reports."""
from datetime import datetime, timezone

from pubg import key_health as kh


def test_classify():
    assert kh.classify(["Bob: ApiError HTTP 401: Unauthorized"]) == "invalid"
    assert kh.classify(["milestones: Rate-Limit erreicht — bitte warten"]) == "limit"
    assert kh.classify(["HTTP 401: x", "Rate-Limit erreicht"]) == "invalid"
    assert kh.classify([]) == "ok" and kh.classify(["telemetry: HTTP 403"]) == "ok"


class _Conn:
    def __init__(self):
        self.store = {}


def test_record_keeps_since_while_state_unchanged(monkeypatch):
    conn = _Conn()
    import pubg.db_pg as db
    monkeypatch.setattr(db, "get_setting", lambda c, t, k, d=None: c.store.get((t, k), d))
    monkeypatch.setattr(db, "set_setting", lambda c, t, k, v: c.store.__setitem__((t, k), v))
    t1 = datetime(2026, 11, 25, 10, tzinfo=timezone.utc)
    t2 = datetime(2026, 11, 25, 11, tzinfo=timezone.utc)
    assert kh.get(conn, 3) == {"state": "ok", "since": None}
    a = kh.record(conn, 3, "invalid", now=t1)
    assert kh.record(conn, 3, "invalid", now=t2)["since"] == a["since"] == "2026-11-25T10:00:00Z"
    assert kh.record(conn, 3, "ok", now=t2)["since"] == "2026-11-25T11:00:00Z"


def test_only_new_reports_blocked():
    bad = {"state": "invalid", "since": "2026-11-25T10:00:00Z"}
    assert kh.blocks_report(bad, None)                              # aktuelle Session
    assert kh.blocks_report(bad, "2026-11-25T12:00:00Z")            # endet nach dem Ausfall
    assert not kh.blocks_report(bad, "2026-11-20T23:00:00Z")        # alte Session bleibt lesbar
    assert not kh.blocks_report({"state": "limit", "since": "x"}, None)
    assert not kh.blocks_report({"state": "ok"}, None)
