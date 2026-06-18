from g1r.db import connect, init_schema


def test_init_schema_creates_tables(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"g1r_run", "g1r_sample", "g1r_event", "g1r_ingest_seq"} <= names
