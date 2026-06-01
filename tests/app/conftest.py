import os
import pytest
from app import create_app


@pytest.fixture
def app():
    return create_app(testing=True)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def pg_dsn_test():
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST braucht 'test' im Namen (Schutz)")
    return dsn


from core import db as core_db
from webcore import sessions


def _setup_schema(conn):
    import core.init_schema as init
    base = os.path.dirname(init.__file__)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
        with open(os.path.join(base, "schema.sql")) as f:
            cur.execute(f.read())
        with open(os.path.join(base, "schema_v2.sql")) as f:
            cur.execute(f.read())
    conn.commit()


def _seed_user_tenant(conn, *, is_admin: bool, is_approved: bool):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (display_name, is_admin, is_approved, twitch_user_id)
            VALUES ('TestUser', %s, %s, %s) RETURNING id
        """, (is_admin, is_approved, '999999' if is_admin else None))
        uid = cur.fetchone()["id"]
        if is_approved:
            cur.execute("""
                INSERT INTO tenants (owner_user_id, slug, display_name)
                VALUES (%s, 'test', 'TestTenant') RETURNING id
            """, (uid,))
            tid = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO tenant_credentials (tenant_id) VALUES (%s)", (tid,)
            )
            cur.execute("""
                INSERT INTO widget_tokens (token, tenant_id, label)
                VALUES (%s, %s, 'Default') RETURNING token
            """, ("tok_" + ("a" * 32), tid))
            token = cur.fetchone()["token"]
        else:
            tid = None
            token = None
    conn.commit()
    return uid, tid, token


@pytest.fixture
def pg_conn_test_setup(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    _setup_schema(conn)
    uid, tid, token = _seed_user_tenant(conn, is_admin=True, is_approved=True)
    sid = sessions.create(conn, user_id=uid)
    yield conn, tid, token, sid
    conn.close()


@pytest.fixture
def pg_conn_test_setup_non_admin(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    _setup_schema(conn)
    uid, tid, token = _seed_user_tenant(conn, is_admin=False, is_approved=True)
    sid = sessions.create(conn, user_id=uid)
    yield conn, tid, token, sid
    conn.close()


@pytest.fixture
def pg_conn_test_setup_unapproved(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    _setup_schema(conn)
    uid, tid, token = _seed_user_tenant(conn, is_admin=False, is_approved=False)
    sid = sessions.create(conn, user_id=uid)
    yield conn, tid, token, sid
    conn.close()
