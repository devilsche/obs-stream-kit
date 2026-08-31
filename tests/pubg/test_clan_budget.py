"""Das Clan-Enrichment darf das API-Budget nicht verheizen.

Der PUBG-Key erlaubt 10 Requests/Minute — geteilt mit dem Match-Polling.
Zwei Löcher gab es hier: Bot-Accounts (die API antwortet auf `ai.`-IDs mit
400) und dauerhaft scheiternde Accounts, die nach dem Fehlschlag unverändert
in der Warteschlange blieben und deshalb in jedem Tick erneut abgefragt
wurden.
"""
from unittest import mock

import pytest

from pubg import clan_enrichment as ce
from pubg.api_client import ApiError


class FakeConn:
    """Minimale conn-Attrappe: merkt sich die INSERTs statt einer echten DB."""

    def __init__(self, rows=None):
        self.rows = rows or {}
        self.writes = []

    def execute(self, sql, params=()):
        self.writes.append((sql, params))
        acc = params[0] if params else None
        row = self.rows.get(acc)
        return mock.Mock(fetchone=lambda: row, fetchall=lambda: [])

    def commit(self):
        pass


def _api_error(status):
    e = ApiError(f"HTTP {status}")
    e.status = status
    return e


def test_bot_accounts_are_never_asked_for():
    """`ai.`-IDs kennt die PUBG-API nicht — jeder Call darauf ist verschenkt."""
    client = mock.Mock()
    conn = FakeConn()
    assert ce.ensure_player_clan(conn, client, "ai.298") is None
    client.get_player_by_id.assert_not_called()


def test_bots_do_not_enter_the_queue():
    conn = FakeConn()
    n = ce.enqueue_unknown(conn, ["account.real", "ai.42", None])
    assert n == 1
    assert all("ai.42" not in str(p) for _, p in conn.writes)


def test_permanent_failure_is_remembered_so_it_is_not_retried():
    """Ohne Vermerk bleibt der Account in der Warteschlange und wird in
    jedem Tick erneut abgefragt — gemessen 34 solcher 400er pro Stunde."""
    client = mock.Mock()
    client.get_player_by_id.side_effect = _api_error(400)
    conn = FakeConn()
    ce.ensure_player_clan(conn, client, "account.weg")
    written = [p for sql, p in conn.writes if "INSERT INTO player_clans" in sql]
    assert written, "Fehlschlag muss vermerkt werden"
    # Zeitstempel ist der letzte Parameter — er darf nicht der
    # Warteschlangen-Marker sein, sonst wird der Account sofort neu gezogen.
    assert written[0][-1] != ce.QUEUE_SENTINEL


def test_temporary_failure_stays_in_the_queue():
    """429 und 5xx sind vorübergehend — die darf man nicht wegsperren."""
    for status in (429, 500, 503):
        client = mock.Mock()
        client.get_player_by_id.side_effect = _api_error(status)
        conn = FakeConn()
        ce.ensure_player_clan(conn, client, "account.spaeter")
        written = [p for sql, p in conn.writes
                   if "INSERT INTO player_clans" in sql]
        assert not written, f"{status} darf nicht als endgültig gelten"


def test_network_errors_stay_in_the_queue():
    client = mock.Mock()
    client.get_player_by_id.side_effect = OSError("Netz weg")
    conn = FakeConn()
    ce.ensure_player_clan(conn, client, "account.spaeter")
    assert not [p for sql, p in conn.writes
                if "INSERT INTO player_clans" in sql]


def test_queue_worker_skips_bots_in_sql():
    """Auch wenn Alt-Bestände in der Warteschlange liegen."""
    conn = mock.Mock()
    conn.execute.return_value.fetchall.return_value = []
    ce.process_queue(conn, mock.Mock(), max_count=3)
    sql = conn.execute.call_args.args[0]
    assert "ai." in sql and "NOT LIKE" in sql
