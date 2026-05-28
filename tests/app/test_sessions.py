import os
import datetime as dt
import pytest
from core import db as core_db
from app import sessions


@pytest.fixture
def pg_conn(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    import core.init_schema as init
    base = os.path.dirname(init.__file__)
    with open(os.path.join(base, "schema.sql")) as f:
        with conn.cursor() as cur:
            cur.execute(f.read())
    with open(os.path.join(base, "schema_v2.sql")) as f:
        with conn.cursor() as cur:
            cur.execute(f.read())
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (display_name, is_admin, is_approved) "
            "VALUES ('A', TRUE, TRUE) RETURNING id"
        )
        uid = cur.fetchone()["id"]
    conn.commit()
    yield conn, uid
    conn.close()


def test_create_session_returns_uuid(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid, user_agent="curl", ip="127.0.0.1")
    assert sid is not None
    assert len(sid) == 36  # UUID format


def test_lookup_returns_user(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid)
    row = sessions.lookup(conn, sid)
    assert row is not None
    assert row["user_id"] == uid


def test_lookup_missing_returns_none(pg_conn):
    conn, _ = pg_conn
    row = sessions.lookup(conn, "00000000-0000-0000-0000-000000000000")
    assert row is None


def test_lookup_expired_returns_none(pg_conn):
    conn, uid = pg_conn
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO user_sessions (user_id, expires_at)
            VALUES (%s, now() - interval '1 day') RETURNING id
        """, (uid,))
        sid = cur.fetchone()["id"]
    conn.commit()
    row = sessions.lookup(conn, str(sid))
    assert row is None


def test_touch_updates_last_seen(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid)
    sessions.touch(conn, sid)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_seen_at FROM user_sessions WHERE id = %s::uuid", (sid,)
        )
        ts1 = cur.fetchone()["last_seen_at"]
    import time
    time.sleep(0.05)
    sessions.touch(conn, sid)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_seen_at FROM user_sessions WHERE id = %s::uuid", (sid,)
        )
        ts2 = cur.fetchone()["last_seen_at"]
    assert ts2 > ts1


def test_revoke_removes_session(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid)
    sessions.revoke(conn, sid)
    assert sessions.lookup(conn, sid) is None
