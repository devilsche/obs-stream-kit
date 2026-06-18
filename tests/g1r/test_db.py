from g1r.db import connect, init_schema, assign_run, latest_sample_level, seq_seen, mark_seq, insert_sample, insert_events


def test_init_schema_creates_tables(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"g1r_run", "g1r_sample", "g1r_event", "g1r_ingest_seq"} <= names


def _fresh(tmp_db_path):
    conn = connect(tmp_db_path); init_schema(conn); return conn


def test_assign_run_creates_first_run(tmp_db_path):
    conn = _fresh(tmp_db_path)
    rid = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    assert isinstance(rid, int)
    row = conn.execute("SELECT detection, save_key FROM g1r_run WHERE id=?", (rid,)).fetchone()
    assert row["detection"] == "save" and row["save_key"] == "SAVE-A"


def test_same_save_key_keeps_run(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    r2 = assign_run(conn, 1, "SAVE-A", {"level": 5, "xp": 900})
    assert r1 == r2


def test_changed_save_key_starts_new_run(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, "SAVE-A", {"level": 9, "xp": 5000})
    r2 = assign_run(conn, 1, "SAVE-B", {"level": 1, "xp": 0})
    assert r2 != r1
    ended = conn.execute("SELECT ended_at FROM g1r_run WHERE id=?", (r1,)).fetchone()
    assert ended["ended_at"] is not None


def test_force_new_is_manual(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    r2 = assign_run(conn, 1, "SAVE-A", {"level": 2, "xp": 50}, force_new=True, label="Hardcore")
    assert r2 != r1
    row = conn.execute("SELECT detection, label FROM g1r_run WHERE id=?", (r2,)).fetchone()
    assert row["detection"] == "manual" and row["label"] == "Hardcore"


def test_heuristic_new_run_on_stat_reset(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, None, {"level": 8, "xp": 4000})
    conn.execute("INSERT INTO g1r_sample(run_id,tenant_id,ts,level,xp) VALUES(?,?,?,?,?)",
                 (r1, 1, "2026-06-18T00:00:00Z", 8, 4000)); conn.commit()
    r2 = assign_run(conn, 1, None, {"level": 1, "xp": 0})
    assert r2 != r1


def test_cross_tenant_isolation(tmp_db_path):
    conn = _fresh(tmp_db_path)
    a = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    b = assign_run(conn, 2, "SAVE-A", {"level": 1, "xp": 0})
    assert a != b


def test_seq_dedup(tmp_db_path):
    conn = _fresh(tmp_db_path)
    assert seq_seen(conn, 1, 5) is False
    mark_seq(conn, 1, 5)
    assert seq_seen(conn, 1, 5) is True
    assert seq_seen(conn, 2, 5) is False


def test_insert_sample_and_events(tmp_db_path):
    conn = _fresh(tmp_db_path)
    rid = assign_run(conn, 1, "S", {"level": 1, "xp": 0})
    insert_sample(conn, 1, rid, {"level": 3, "hp": 120, "guild_key": "guards"})
    insert_events(conn, 1, rid, [
        {"kind": "hit_dealt", "value": 73, "meta": None},
        {"kind": "kill", "value": 1, "meta": {"type": "Wolf"}},
    ])
    s = conn.execute("SELECT level, hp, guild_key FROM g1r_sample WHERE run_id=?", (rid,)).fetchone()
    assert s["level"] == 3 and s["hp"] == 120 and s["guild_key"] == "guards"
    evs = conn.execute("SELECT kind, value, meta FROM g1r_event WHERE run_id=? ORDER BY id", (rid,)).fetchall()
    assert [e["kind"] for e in evs] == ["hit_dealt", "kill"]
    assert '"type": "Wolf"' in evs[1]["meta"]
