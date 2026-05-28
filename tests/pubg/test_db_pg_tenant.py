import os
import pytest
from core import db as core_db
from pubg import db_pg


@pytest.fixture
def pg():
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST muss 'test' im DB-Namen enthalten")
    conn = core_db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    # Schema neu laden
    import core.init_schema as init
    schema_path = os.path.join(os.path.dirname(init.__file__), "schema.sql")
    with open(schema_path) as f:
        schema_sql = f.read()
    with conn.cursor() as cur:
        cur.execute(schema_sql)
        cur.execute(db_pg.PG_SCHEMA)
        cur.execute(
            "INSERT INTO users (display_name, is_admin) VALUES ('A',TRUE) RETURNING id"
        )
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'t1','T1') RETURNING id", (uid,))
        t1 = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'t2','T2') RETURNING id", (uid,))
        t2 = cur.fetchone()["id"]
    conn.commit()
    yield conn, t1, t2
    conn.close()


def test_matches_have_tenant_id_in_pk(pg):
    conn, t1, t2 = pg
    with conn.cursor() as cur:
        # selbes match_id in beiden Tenants moeglich
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode, played_at)
            VALUES (%s, 'm1', 'Erangel', 'squad', '2026-05-28T00:00:00Z')
        """, (t1,))
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode, played_at)
            VALUES (%s, 'm1', 'Erangel', 'squad', '2026-05-28T00:00:00Z')
        """, (t2,))
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM matches WHERE match_id='m1'")
        assert cur.fetchone()["n"] == 2


def test_matches_scope_query(pg):
    conn, t1, t2 = pg
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode, played_at)
            VALUES (%s, 'mA', 'Erangel', 'squad', '2026-05-28T00:00:00Z'),
                   (%s, 'mB', 'Erangel', 'squad', '2026-05-28T00:00:00Z')
        """, (t1, t2))
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT match_id FROM matches WHERE tenant_id = %s", (t1,))
        rows = [r["match_id"] for r in cur.fetchall()]
        assert rows == ["mA"]
