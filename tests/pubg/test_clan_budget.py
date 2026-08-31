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


# ── Warteschlange auf relevante Spieler beschränken ─────────────────────────

def _seen(conn, tenant_id, account_id, matches):
    """Spieler in N Lobbys auftauchen lassen."""
    from pubg import db_pg
    for i in range(matches):
        mid = f"cq-{account_id}-{i}"
        db_pg.insert_match(conn.raw, tenant_id, mid, "Baltic_Main", "squad",
                           False, 1800, f"2026-05-{10 + i:02d}T18:00:00Z", None)
        db_pg.insert_team_mapping(conn.raw, tenant_id, mid,
                                  [{"account_id": account_id, "team_id": 3}])


def _as_squad(conn, tenant_id, account_id):
    from pubg import db_pg
    db_pg.insert_match(conn.raw, tenant_id, f"sq-{account_id}", "Baltic_Main",
                       "squad", False, 1800, "2026-05-01T18:00:00Z", None)
    db_pg.upsert_player(conn.raw, tenant_id, account_id, "Mate", "steam", 0)
    db_pg.insert_participants(conn.raw, tenant_id, f"sq-{account_id}", [{
        "account_id": account_id, "name": "Mate", "team_id": 1, "place": 1,
        "kills": 0, "headshot_kills": 0, "assists": 0, "dbnos": 0, "revives": 0,
        "damage_dealt": 0.0, "longest_kill": 0.0, "time_survived": 0,
        "walk_distance": 0.0, "ride_distance": 0.0, "swim_distance": 0.0,
        "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0}])


def test_enqueue_keeps_only_squad_and_regulars(pg_compat):
    """Von 93 Lobby-Spielern je Match sehen wir die meisten nie wieder —
    die Warteschlange stand auf über 50.000 Accounts."""
    conn, tenant_id, _ = pg_compat
    _as_squad(conn, tenant_id, "account.mate")
    _seen(conn, tenant_id, "account.regular", 5)
    _seen(conn, tenant_id, "account.einmal", 1)
    _seen(conn, tenant_id, "ai.99", 5)          # Bot, oft gesehen
    n = ce.enqueue_unknown(conn, ["account.mate", "account.regular",
                                   "account.einmal", "ai.99", None],
                           min_seen=5)
    queued = {r["account_id"] for r in conn.execute(
        "SELECT account_id FROM player_clans WHERE updated_at = ?",
        (ce.QUEUE_SENTINEL,)).fetchall()}
    assert "account.mate" in queued
    assert "account.regular" in queued
    assert "account.einmal" not in queued
    assert "ai.99" not in queued        # Bots kennt die API nicht
    assert n == 2


def test_prune_removes_the_one_off_lobby_players(pg_compat):
    conn, tenant_id, _ = pg_compat
    _as_squad(conn, tenant_id, "account.mate2")
    _seen(conn, tenant_id, "account.regular2", 5)
    _seen(conn, tenant_id, "account.einmal2", 1)
    for acc in ("account.mate2", "account.regular2", "account.einmal2"):
        conn.execute(
            "INSERT INTO player_clans (account_id, clan_id, updated_at) "
            "VALUES (?, NULL, ?) ON CONFLICT (account_id) DO NOTHING",
            (acc, ce.QUEUE_SENTINEL))
    conn.commit()
    removed = ce.prune_queue(conn, min_seen=5)
    left = {r["account_id"] for r in conn.execute(
        "SELECT account_id FROM player_clans WHERE updated_at = ?",
        (ce.QUEUE_SENTINEL,)).fetchall()}
    assert "account.einmal2" not in left
    assert {"account.mate2", "account.regular2"} <= left
    assert removed >= 1


def test_prune_leaves_resolved_entries_alone(pg_compat):
    """Nur die offene Warteschlange wird aufgeräumt — schon aufgelöste
    Clan-Zuordnungen sind bezahlte Arbeit und bleiben."""
    conn, tenant_id, _ = pg_compat
    conn.execute(
        "INSERT INTO player_clans (account_id, clan_id, updated_at) "
        "VALUES (?, ?, ?) ON CONFLICT (account_id) DO NOTHING",
        ("account.fertig", "clan.1", "2026-05-01T00:00:00Z"))
    conn.commit()
    ce.prune_queue(conn, min_seen=5)
    row = conn.execute(
        "SELECT clan_id FROM player_clans WHERE account_id = ?",
        ("account.fertig",)).fetchone()
    assert row is not None and row["clan_id"] == "clan.1"
