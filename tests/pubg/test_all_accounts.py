"""Ein Mensch, zwei Steam-Accounts: der Report zaehlt beide als "ich".

Cnabetius und Die-Ente sind derselbe Spieler. Hat ein Tenant mehrere
Accounts hinterlegt, zeigen die Report-Routen ohne ?account= die Matches
aller Accounts; ?account=<Name> schaltet weiterhin auf einen.
"""
import json

import pytest

from core.db_compat import SqliteCompatConn, _expand_account_sets
from pubg import db_pg
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry
from pubg.identity import SelfAccounts, as_set, pick_me

HAUPT = "account.haupt"
ZWEIT = "account.zweit"


def test_sql_gleich_wird_any_ungleich_wird_all():
    me = SelfAccounts([HAUPT, ZWEIT])
    sql, params = _expand_account_sets(
        "SELECT 1 WHERE t = ? AND a = ? AND b != ? AND c <> ?",
        [1, me, me, "x"])
    assert sql == "SELECT 1 WHERE t = ? AND a = ANY(?) AND b <> ALL(?) AND c <> ?"
    assert params == [1, [HAUPT, ZWEIT], [HAUPT, ZWEIT], "x"]


def test_sql_unbekannte_stelle_meldet_sich_laut():
    with pytest.raises(ValueError):
        _expand_account_sets("INSERT INTO x VALUES (?)",
                             [SelfAccounts([HAUPT, ZWEIT])])


def test_vergleich_und_lookup():
    me = SelfAccounts([HAUPT, ZWEIT])
    assert ZWEIT == me and me == HAUPT
    assert "account.fremd" != me
    assert me.primary == HAUPT
    assert pick_me({ZWEIT: 3}, me) == 3
    assert pick_me({HAUPT: 1, ZWEIT: 3}, me) == 1
    assert pick_me({"x": 1}, HAUPT, 0) == 0
    assert as_set(me) == {HAUPT, ZWEIT}


def _participant(acc, name, team, kills):
    return {"account_id": acc, "name": name, "team_id": team,
            "place": 5, "kills": kills, "headshot_kills": 0, "assists": 0,
            "dbnos": 0, "revives": 0, "damage_dealt": 100.0,
            "longest_kill": 0.0, "time_survived": 600,
            "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 1, "heals": 0,
            "boosts": 0, "team_kills": 0}


@pytest.fixture
def zwei_accounts(pg_compat):
    """Je ein Match pro Account, im zweiten mit Mitspieler."""
    conn, t1, t2 = pg_compat
    raw = conn.raw
    db_pg.add_tracked_player(raw, t1, "Haupt", platform="steam",
                             account_id=HAUPT, is_primary=True)
    db_pg.add_tracked_player(raw, t1, "Zweit", platform="steam",
                             account_id=ZWEIT)
    db_pg.upsert_player(raw, t1, HAUPT, "Haupt", "steam", 1)
    db_pg.upsert_player(raw, t1, ZWEIT, "Zweit", "steam", 0)
    db_pg.insert_match(raw, t1, "m-haupt", "Baltic_Main", "squad-fpp",
                       False, 1500, "2026-10-29T20:00:00Z", None)
    db_pg.insert_participants(raw, t1, "m-haupt",
                              [_participant(HAUPT, "Haupt", 1, 2)])
    db_pg.insert_match(raw, t1, "m-zweit", "Desert_Main", "squad-fpp",
                       False, 1500, "2026-10-29T21:00:00Z", None)
    db_pg.insert_participants(raw, t1, "m-zweit",
                              [_participant(ZWEIT, "Zweit", 3, 4),
                               _participant("account.mate", "Mate", 3, 1)])
    raw.commit()
    return conn, t1, t2


def _registry(conn, tenant_id, my_account_id=HAUPT):
    return EndpointRegistry(
        get_conn=lambda: conn, my_account_id=my_account_id,
        platform="steam", cache=TTLCache(), client=None,
        poller_status=lambda: {}, tenant_id=tenant_id)


def _get(conn, tenant_id, path, my_account_id=HAUPT):
    resp = _registry(conn, tenant_id, my_account_id).dispatch(
        "GET", path, b"", {})
    payload = resp[0]
    body = json.loads(payload) if isinstance(payload, (str, bytes)) else payload
    return resp[1], body


RANGE = "from=2026-10-29T00:00:00Z&to=2026-10-30T00:00:00Z"


def test_session_matches_zeigt_beide_accounts(zwei_accounts):
    conn, t1, _ = zwei_accounts
    status, body = _get(conn, t1, f"/api/pubg/session-matches?{RANGE}")
    assert status == 200
    assert {m["matchId"] for m in body} == {"m-haupt", "m-zweit"}


def test_account_param_zeigt_nur_einen(zwei_accounts):
    conn, t1, _ = zwei_accounts
    _, body = _get(conn, t1,
                   f"/api/pubg/session-matches?{RANGE}&account=Zweit")
    assert [m["matchId"] for m in body] == ["m-zweit"]


def test_session_report_zaehlt_beide_und_mate_bleibt_mate(zwei_accounts):
    conn, t1, _ = zwei_accounts
    status, body = _get(conn, t1, f"/api/pubg/session-report?{RANGE}")
    assert status == 200
    assert body["totalMatches"] == 2
    assert body["totals"]["kills"] == 6
    # Der eigene Zweit-Account taucht nirgends als Mitspieler auf
    mitspieler = {n for ph in body["phases"] for n in ph["allMembers"]}
    assert mitspieler == {"Mate"}


def test_ein_account_bleibt_unveraendert(zwei_accounts):
    """Tenant ohne Zweit-Account: kein SelfAccounts, alter Cache-Key."""
    conn, _, t2 = zwei_accounts
    reg = _registry(conn, t2, "account.solo")
    reg.dispatch("GET", f"/api/pubg/session-matches?{RANGE}", b"", {})
    assert reg.my_account_id == "account.solo"



@pytest.fixture
def mitspieler_mit_zwei_accounts(zwei_accounts):
    """Tenant 2 spielt mit dem Menschen hinter Haupt/Zweit — mal so, mal so."""
    conn, t1, t2 = zwei_accounts
    raw = conn.raw
    db_pg.add_tracked_player(raw, t2, "Solo", platform="steam",
                             account_id="account.solo", is_primary=True)
    db_pg.upsert_player(raw, t2, "account.solo", "Solo", "steam", 1)
    db_pg.upsert_player(raw, t2, HAUPT, "Haupt", "steam", 0)
    db_pg.upsert_player(raw, t2, ZWEIT, "Zweit", "steam", 0)
    for mid, acc, name, kills in (("s-1", HAUPT, "Haupt", 2),
                                  ("s-2", ZWEIT, "Zweit", 4)):
        db_pg.insert_match(raw, t2, mid, "Baltic_Main", "squad-fpp",
                           False, 1500, f"2026-10-29T2{mid[-1]}:00:00Z", None)
        db_pg.insert_participants(raw, t2, mid, [
            _participant("account.solo", "Solo", 1, 1),
            _participant(acc, name, 1, kills)])
    raw.commit()
    return conn, t1, t2


def test_co_player_fasst_beide_accounts_zusammen(mitspieler_mit_zwei_accounts):
    conn, _, t2 = mitspieler_mit_zwei_accounts
    status, body = _get(conn, t2, "/api/pubg/co-player/Haupt",
                        my_account_id="account.solo")
    assert status == 200
    hist = body["sharedHistory"]
    assert hist["matches"] == 2
    assert hist["mateKills"] == 6
    assert hist["myKills"] == 2
    # Lifetime/Name bleiben beim gefragten Account
    assert body["accountId"] == HAUPT


def test_co_player_ohne_zweit_account_unveraendert(mitspieler_mit_zwei_accounts):
    conn, t1, t2 = mitspieler_mit_zwei_accounts
    from pubg.identity import person_accounts
    assert person_accounts(conn, "account.solo") == "account.solo"
    assert isinstance(person_accounts(conn, ZWEIT), SelfAccounts)
    assert person_accounts(conn, ZWEIT).primary == ZWEIT
