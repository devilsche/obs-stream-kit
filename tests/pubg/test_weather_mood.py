"""K/D-Stimmung der Weather-Source: laufende Session, nur BR, alle Accounts."""
from datetime import datetime, timedelta, timezone

from fx.weather_mood import kd_snapshot
from pubg import db_pg

NOW = datetime(2026, 11, 9, 22, 0, tzinfo=timezone.utc)


def _p(acc, kills, place):
    return {"account_id": acc, "name": acc, "team_id": 1, "place": place, "kills": kills,
            "headshot_kills": 0, "assists": 0, "dbnos": 0, "revives": 0, "damage_dealt": 0.0,
            "longest_kill": 0.0, "time_survived": 1500, "walk_distance": 0.0,
            "ride_distance": 0.0, "swim_distance": 0.0, "weapons_acquired": 0,
            "heals": 0, "boosts": 0, "team_kills": 0}


def _match(raw, t, mid, at, acc, kills, place=5, mode="squad-fpp"):
    db_pg.insert_match(raw, t, mid, "Erangel_Main", mode, False, 1800,
                       at.strftime("%Y-%m-%dT%H:%M:%SZ"), None)
    db_pg.insert_participants(raw, t, mid, [_p(acc, kills, place)])


def _setup(pg_compat):
    conn, t1, t2 = pg_compat
    raw = conn.raw
    db_pg.add_tracked_player(raw, t1, "Main", "steam", "acc.A", is_primary=True)
    db_pg.add_tracked_player(raw, t1, "Smurf", "steam", "acc.B")
    # alte Session vor zwei Tagen (zählt nicht)
    _match(raw, t1, "old", NOW - timedelta(days=2), "acc.A", 20)
    # heutige Session: 4 + 2 + 0 Kills über zwei Accounts, kein Sieg
    _match(raw, t1, "s1", NOW - timedelta(hours=3), "acc.A", 4)
    _match(raw, t1, "s2", NOW - timedelta(hours=2), "acc.B", 2)
    _match(raw, t1, "s3", NOW - timedelta(hours=1), "acc.A", 0)
    # Zombie-Runde (Arcade) zählt nicht
    _match(raw, t1, "z1", NOW - timedelta(minutes=30), "acc.A", 30, mode="zulu_hell-fpp")
    raw.commit()
    return conn, t1, t2


def test_session_kd_br_only_all_accounts(pg_compat):
    conn, t1, _ = _setup(pg_compat)
    snap = kd_snapshot(conn, t1, now=NOW)
    assert snap == {"kd": 2.0, "matches": 3, "live": True}


def test_win_does_not_count_as_death(pg_compat):
    conn, t1, _ = _setup(pg_compat)
    _match(conn.raw, t1, "s4", NOW - timedelta(minutes=10), "acc.B", 3, place=1)
    conn.raw.commit()
    assert kd_snapshot(conn, t1, now=NOW)["kd"] == 3.0


def test_not_live_after_four_hours(pg_compat):
    conn, t1, _ = _setup(pg_compat)
    assert kd_snapshot(conn, t1, now=NOW + timedelta(hours=5))["live"] is False


def test_other_tenant_does_not_leak(pg_compat):
    conn, _, t2 = _setup(pg_compat)
    assert kd_snapshot(conn, t2, now=NOW) == {"kd": 0.0, "matches": 0, "live": False}
