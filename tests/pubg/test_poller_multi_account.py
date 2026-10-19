"""Poller mit mehreren verfolgten Accounts je Tenant."""
import json
import os
from unittest import mock

import pytest

from core.db_compat import SqliteCompatConn
from pubg import db_pg, poller


FIXTURES = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures")


def _match_payload():
    with open(os.path.join(FIXTURES, "match_response.json")) as f:
        return json.load(f)


class _StubClient:
    """Zaehlt Aufrufe, damit sichtbar wird, wie viele Requests noetig sind."""
    platform = "steam"

    def __init__(self, players_payload=None):
        self.player_calls = []
        self.match_calls = []
        self._players_payload = players_payload or {"data": []}
        self.id_calls = []
        self._id_payload = {"data": []}

    def get_player(self, name):
        self.player_calls.append(name)
        if not self._players_payload.get("data"):
            # Wie die echte API: kein Name gefunden -> HTTP 404.
            from pubg.api_client import ApiError
            raise ApiError("HTTP 404: Not Found", status=404)
        return self._players_payload

    def get_players_by_ids(self, ids):
        self.id_calls.append(ids)
        return self._id_payload

    def get_match(self, match_id):
        self.match_calls.append(match_id)
        return _match_payload()

    @staticmethod
    def extract_match_ids(payload):
        from pubg.api_client import PubgClient
        return PubgClient.extract_match_ids(payload)


def _players_payload(entries):
    """entries: [(name, account_id, [match_ids])]"""
    return {"data": [
        {"id": acc, "attributes": {"name": name},
         "relationships": {"matches": {"data": [{"id": m} for m in mids]}}}
        for name, acc, mids in entries
    ]}


def test_all_accounts_resolved_in_one_request(pg):
    """Drei Accounts duerfen nur einen rate-limited /players-Call kosten."""
    conn, t1, _ = pg
    for n in ("Haupt", "Zweit", "Dritt"):
        db_pg.add_tracked_player(conn, t1, n, platform="steam",
                                 is_primary=(n == "Haupt"))
    client = _StubClient(_players_payload([
        ("Haupt", "account.abc123", []),
        ("Zweit", "account.zwei", []),
        ("Dritt", "account.drei", []),
    ]))
    poller.resolve_tracked_accounts(conn, t1, client)
    assert len(client.player_calls) == 1
    assert sorted(client.player_calls[0].split(",")) == ["Dritt", "Haupt", "Zweit"]


def test_resolved_account_ids_are_persisted(pg):
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Haupt", platform="steam")
    client = _StubClient(_players_payload([("Haupt", "account.abc123", [])]))
    poller.resolve_tracked_accounts(conn, t1, client)
    assert db_pg.list_tracked_players(conn, t1)[0]["account_id"] == "account.abc123"


def test_unknown_account_is_reported_not_crashing(pg):
    """Ein Tippfehler im Namen darf die anderen Accounts nicht mitreissen."""
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Echt", platform="steam")
    db_pg.add_tracked_player(conn, t1, "Tippfehler", platform="steam")
    client = _StubClient(_players_payload([("Echt", "account.echt", [])]))
    resolved = poller.resolve_tracked_accounts(conn, t1, client)
    assert [r["name"] for r in resolved] == ["Echt"]


def test_umbenannter_account_wird_ueber_die_id_gefunden(pg):
    """Nach einer Umbenennung kennt die API den alten Namen nicht mehr
    (404). Ohne Rueckfall auf die account_id stand der Poller still."""
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "AltName", platform="steam",
                             account_id="account.alt", is_primary=True)
    db_pg.upsert_player(conn, t1, "account.alt", "AltName", "steam", 1)
    conn.commit()
    client = _StubClient({"data": []})
    client._id_payload = _players_payload([("NeuName", "account.alt", ["m1"])])
    resolved = poller.resolve_tracked_accounts(conn, t1, client)
    assert client.id_calls == [["account.alt"]]
    assert [(r["name"], r["account_id"], r["match_ids"]) for r in resolved] \
        == [("NeuName", "account.alt", ["m1"])]
    assert resolved[0]["is_primary"] is True
    t = db_pg.list_tracked_players(conn, t1)
    assert [(x["name"], x["is_primary"]) for x in t] == [("NeuName", True)]
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM players WHERE account_id = %s",
                    ("account.alt",))
        assert [r["name"] for r in cur.fetchall()] == ["NeuName"]


def test_new_matches_collected_across_accounts(pg):
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Haupt", platform="steam")
    db_pg.add_tracked_player(conn, t1, "Zweit", platform="steam")
    client = _StubClient(_players_payload([
        ("Haupt", "account.abc123", ["m1", "m2"]),
        ("Zweit", "account.zwei", ["m3"]),
    ]))
    stats = poller.run_single_tick_multi(conn, t1, client, max_matches_per_tick=5)
    assert stats["new_matches"] == 3
    assert sorted(client.match_calls) == ["m1", "m2", "m3"]


def test_same_match_from_two_accounts_fetched_once(pg):
    """Spielen zwei eigene Accounts dasselbe Match, darf es nicht doppelt
    geladen werden."""
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Haupt", platform="steam")
    db_pg.add_tracked_player(conn, t1, "Zweit", platform="steam")
    client = _StubClient(_players_payload([
        ("Haupt", "account.abc123", ["m1"]),
        ("Zweit", "account.def456", ["m1"]),
    ]))
    stats = poller.run_single_tick_multi(conn, t1, client, max_matches_per_tick=5)
    assert client.match_calls == ["m1"]
    assert stats["new_matches"] == 1


def test_participants_stored_for_every_own_account_in_match(pg):
    """Beide eigenen Accounts muessen als Teilnehmer auftauchen, sonst
    fehlt einem von beiden das Match in seiner Auswertung."""
    conn, t1, _ = pg
    poller.ingest_match(conn, t1, _StubClient(),
                        ["account.abc123", "account.def456"], "m1")
    with conn.cursor() as cur:
        cur.execute("SELECT account_id FROM participants WHERE tenant_id=%s "
                    "ORDER BY account_id", (t1,))
        accs = [r["account_id"] for r in cur.fetchall()]
    assert "account.abc123" in accs and "account.def456" in accs


def test_ingest_match_still_accepts_single_account_id(pg):
    """Rueckwaertskompatibel — Bestandsaufrufer uebergeben einen String."""
    conn, t1, _ = pg
    poller.ingest_match(conn, t1, _StubClient(), "account.abc123", "m1")
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM matches WHERE tenant_id=%s", (t1,))
        assert cur.fetchone() is not None


class _FullStubClient(_StubClient):
    """Deckt zusaetzlich die Endpoints ab, die poll_tenant anfasst."""

    def get_lifetime(self, *a, **kw):
        return {"data": {"attributes": {"gameModeStats": {}}}}

    def get_season(self, *a, **kw):
        return {"data": {"attributes": {"gameModeStats": {}}}}

    def get_seasons(self):
        return {"data": []}

    def get_telemetry(self, url):
        return []


def _ensure_cred_row(conn, tid):
    """Die pg-Fixture legt nur Tenants an, keine Credential-Zeile."""
    with conn.cursor() as cur:
        cur.execute("INSERT INTO tenant_credentials (tenant_id) VALUES (%s) "
                    "ON CONFLICT DO NOTHING", (tid,))
    conn.commit()


def test_poll_tenant_polls_all_accounts_with_one_player_call(pg):
    conn, t1, _ = pg
    _ensure_cred_row(conn, t1)
    from core import credentials
    credentials.set_pubg(conn, t1, name="Haupt", platform="steam",
                         api_key="key-1")
    db_pg.add_tracked_player(conn, t1, "Haupt", platform="steam",
                             is_primary=True)
    db_pg.add_tracked_player(conn, t1, "Zweit", platform="steam")
    client = _FullStubClient(_players_payload([
        ("Haupt", "account.abc123", ["m1"]),
        ("Zweit", "account.def456", ["m2"]),
    ]))
    res = poller.poll_tenant(SqliteCompatConn(conn), t1, lambda key, plat: client)
    assert res["polling"] in ("ok", "degraded"), res.get("errors")
    assert res["newMatches"] == 2
    assert len(client.player_calls) == 1


def test_poll_tenant_caches_primary_account_id(pg):
    """Der Primaer-Account landet in den Credentials — Bestandscode liest
    ihn von dort."""
    conn, t1, _ = pg
    _ensure_cred_row(conn, t1)
    from core import credentials
    credentials.set_pubg(conn, t1, name="Zweit", platform="steam",
                         api_key="key-1")
    db_pg.add_tracked_player(conn, t1, "Haupt", platform="steam")
    db_pg.add_tracked_player(conn, t1, "Zweit", platform="steam",
                             is_primary=True)
    client = _FullStubClient(_players_payload([
        ("Haupt", "account.abc123", []),
        ("Zweit", "account.def456", []),
    ]))
    poller.poll_tenant(SqliteCompatConn(conn), t1, lambda key, plat: client)
    assert credentials.get(conn, t1).pubg_account_id == "account.def456"
