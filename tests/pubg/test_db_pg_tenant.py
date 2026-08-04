from pubg import db_pg


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
