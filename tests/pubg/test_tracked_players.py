"""Mehrere verfolgte PUBG-Accounts pro Tenant."""
import pytest

from pubg import db_pg


def test_add_and_list_tracked(pg):
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "PEX_LuCKoR", platform="steam",
                             is_primary=True)
    db_pg.add_tracked_player(conn, t1, "Alt_Account", platform="steam")
    rows = db_pg.list_tracked_players(conn, t1)
    assert [r["name"] for r in rows] == ["PEX_LuCKoR", "Alt_Account"]
    assert [r["is_primary"] for r in rows] == [True, False]


def test_tracked_players_are_tenant_isolated(pg):
    conn, t1, t2 = pg
    db_pg.add_tracked_player(conn, t1, "Meiner", platform="steam")
    db_pg.add_tracked_player(conn, t2, "Fremder", platform="steam")
    assert [r["name"] for r in db_pg.list_tracked_players(conn, t1)] == ["Meiner"]
    assert [r["name"] for r in db_pg.list_tracked_players(conn, t2)] == ["Fremder"]


def test_add_same_name_twice_is_idempotent(pg):
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Doppelt", platform="steam")
    db_pg.add_tracked_player(conn, t1, "Doppelt", platform="steam")
    assert len(db_pg.list_tracked_players(conn, t1)) == 1


def test_set_primary_is_exclusive(pg):
    """Nur ein Account darf primaer sein — Umsetzen raeumt den alten ab."""
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Erster", platform="steam",
                             is_primary=True)
    db_pg.add_tracked_player(conn, t1, "Zweiter", platform="steam")
    db_pg.set_primary_tracked_player(conn, t1, "Zweiter")
    prim = [r["name"] for r in db_pg.list_tracked_players(conn, t1)
            if r["is_primary"]]
    assert prim == ["Zweiter"]


def test_remove_tracked_player(pg):
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Weg", platform="steam")
    db_pg.add_tracked_player(conn, t1, "Bleibt", platform="steam")
    db_pg.remove_tracked_player(conn, t1, "Weg")
    assert [r["name"] for r in db_pg.list_tracked_players(conn, t1)] == ["Bleibt"]


def test_set_account_id_fills_in_resolved_id(pg):
    """Der Poller traegt die aufgeloeste account_id nach."""
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "NochOhneId", platform="steam")
    assert db_pg.list_tracked_players(conn, t1)[0]["account_id"] is None
    db_pg.set_tracked_account_id(conn, t1, "NochOhneId", "account.abc123")
    assert db_pg.list_tracked_players(conn, t1)[0]["account_id"] == "account.abc123"


def test_backfill_creates_primary_from_credentials(pg):
    """Bestandstenants ohne Liste bekommen ihren bisherigen Namen als primaer."""
    conn, t1, _ = pg
    db_pg.backfill_tracked_players(conn, t1, "AltName", "steam", "account.old")
    rows = db_pg.list_tracked_players(conn, t1)
    assert len(rows) == 1
    assert rows[0]["name"] == "AltName"
    assert rows[0]["is_primary"] is True
    assert rows[0]["account_id"] == "account.old"


def test_backfill_does_not_touch_existing_list(pg):
    conn, t1, _ = pg
    db_pg.add_tracked_player(conn, t1, "Gewaehlt", platform="steam",
                             is_primary=True)
    db_pg.backfill_tracked_players(conn, t1, "AltName", "steam", "account.old")
    assert [r["name"] for r in db_pg.list_tracked_players(conn, t1)] == ["Gewaehlt"]
