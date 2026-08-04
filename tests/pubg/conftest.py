"""Gemeinsame Fixtures fuer die PUBG-Tests.

Der produktive Code laeuft seit der PG-Migration ausschliesslich ueber
`pubg/db_pg.py` (tenant-aware, %s-Platzhalter). `pubg/db.py` ist als
deprecated markiert — Tests dagegen pruefen nichts, was noch laeuft.
"""
import os

import pytest

from core import db as core_db
from core.db_compat import SqliteCompatConn
from pubg import db_pg


def _fresh_schema(conn):
    import core.init_schema as init
    base = os.path.dirname(init.__file__)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    with conn.cursor() as cur:
        with open(os.path.join(base, "schema.sql")) as f:
            cur.execute(f.read())
        cur.execute(db_pg.PG_SCHEMA)
        # schema_v2 haengt an den PUBG-Tabellen (Views wie qualified_co_players)
        with open(os.path.join(base, "schema_v2.sql")) as f:
            cur.execute(f.read())
    conn.commit()


@pytest.fixture
def pg():
    """Frische Test-DB mit zwei Tenants. Liefert (conn, tenant1, tenant2)."""
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST muss 'test' im DB-Namen enthalten")
    conn = core_db.connect(dsn)
    _fresh_schema(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (display_name, is_admin) VALUES ('A',TRUE) "
            "RETURNING id"
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
        cur.execute("INSERT INTO tenant_credentials (tenant_id) VALUES (%s)",
                    (t1,))
        cur.execute("INSERT INTO tenant_credentials (tenant_id) VALUES (%s)",
                    (t2,))
    conn.commit()
    yield conn, t1, t2
    conn.close()


@pytest.fixture
def pg_compat(pg):
    """Wie `pg`, aber im SqliteCompat-Wrapper.

    aggregations.py und endpoints.py sprechen den sqlite-Stil
    (`conn.execute(sql, params).fetchall()` mit ?-Platzhaltern); der
    Wrapper uebersetzt das auf psycopg2 — genauso wie im Produktivbetrieb.
    """
    conn, t1, t2 = pg
    yield SqliteCompatConn(conn), t1, t2
