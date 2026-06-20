"""Aggregationen (Sub-2): Run-Liste, Career-Card pro run_id + all-time, Live.

Baut über die DAO-Funktionen (assign_run/insert_sample/insert_events) echte
Daten auf und prüft die abgeleiteten Kennzahlen. Sqlite reicht — dieselben
Queries laufen via SqliteCompatConn auch auf Postgres."""
from g1r.db import (connect, init_schema, assign_run, insert_sample,
                    insert_events)
from g1r.aggregations import list_runs, career, live


def _seed_run(conn, tenant_id, save_key, samples, events, *, label=None):
    """Legt einen Run an und füllt ihn mit den gegebenen Samples/Events."""
    rid = assign_run(conn, tenant_id, save_key, samples[0] if samples else {},
                     force_new=True, label=label)
    for snap in samples:
        insert_sample(conn, tenant_id, rid, snap)
    insert_events(conn, tenant_id, rid, events)
    return rid


def test_list_runs_reports_runs_with_level_and_sample_count(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    r1 = _seed_run(conn, 1, "A", [{"level": 3}, {"level": 7}], [], label="Run A")
    r2 = _seed_run(conn, 1, "B", [{"level": 1}], [], label="Run B")
    runs = list_runs(conn, 1)
    assert [r["id"] for r in runs] == [r2, r1]          # neueste zuerst
    a = next(r for r in runs if r["id"] == r1)
    assert a["label"] == "Run A" and a["level"] == 7 and a["samples"] == 2


def test_list_runs_isolates_tenants(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    _seed_run(conn, 1, "A", [{"level": 5}], [])
    _seed_run(conn, 2, "B", [{"level": 9}], [])
    assert len(list_runs(conn, 1)) == 1
    assert len(list_runs(conn, 2)) == 1


def test_career_for_run_aggregates_events_and_latest_stats(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    rid = _seed_run(
        conn, 1, "A",
        [{"level": 5, "distance_m": 120.0, "steps": 160, "strongest_melee": "ItMw_Sword"},
         {"level": 8, "distance_m": 300.0, "steps": 400, "strongest_melee": "ItMw_Axe"}],
        [{"kind": "hit_dealt", "value": 40}, {"kind": "hit_dealt", "value": 90},
         {"kind": "hit_taken", "value": 25},
         {"kind": "kill", "value": 1, "meta": {"type": "Wolf"}},
         {"kind": "kill", "value": 1, "meta": {"type": "Scavenger"}}])
    c = career(conn, 1, run_id=rid)
    assert c["scope"] == "run" and c["run"]["id"] == rid
    assert c["stats"]["level"] == 8                       # jüngstes Sample
    assert c["stats"]["strongest_melee"] == "ItMw_Axe"
    assert c["totals"]["kills"] == 2
    assert c["totals"]["damage_dealt"] == 130
    assert c["totals"]["damage_taken"] == 25
    assert c["records"]["hardest_dealt"] == 90           # größter Einzeltreffer
    assert c["records"]["distance_m"] == 300.0           # weiteste Strecke


def test_career_all_time_sums_across_runs(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    _seed_run(conn, 1, "A", [{"level": 5}],
              [{"kind": "kill", "value": 1}, {"kind": "hit_dealt", "value": 10}])
    _seed_run(conn, 1, "B", [{"level": 9}],
              [{"kind": "kill", "value": 1}, {"kind": "hit_dealt", "value": 50}])
    c = career(conn, 1, run_id=None)
    assert c["scope"] == "all" and c["run"] is None
    assert c["stats"]["level"] == 9                       # jüngstes Sample überhaupt
    assert c["totals"]["kills"] == 2
    assert c["totals"]["damage_dealt"] == 60
    assert c["records"]["hardest_dealt"] == 50


def test_career_empty_run_returns_zeros(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    rid = assign_run(conn, 1, "X", {}, force_new=True)
    c = career(conn, 1, run_id=rid)
    assert c["totals"]["kills"] == 0 and c["records"]["hardest_dealt"] == 0
    assert c["stats"] == {} or c["stats"].get("level") is None


def test_live_returns_active_run_latest_sample_and_recent_events(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    # Zwei Runs; aktiv = der zuletzt angelegte (höchste id), da ended_at NULL bleibt.
    _seed_run(conn, 1, "A", [{"level": 3}], [{"kind": "kill", "value": 1}])
    rid2 = _seed_run(conn, 1, "B", [{"level": 6}],
                     [{"kind": "hit_dealt", "value": 20},
                      {"kind": "kill", "value": 1, "meta": {"type": "Wolf"}}])
    lv = live(conn, 1)
    assert lv["run"]["id"] == rid2
    assert lv["stats"]["level"] == 6
    kinds = [e["kind"] for e in lv["events"]]
    assert "kill" in kinds and "hit_dealt" in kinds
    wolf = next(e for e in lv["events"] if e["kind"] == "kill")
    assert wolf["meta"] == {"type": "Wolf"}              # meta als dict zurück


def test_live_no_data_returns_null_run(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    lv = live(conn, 1)
    assert lv["run"] is None and lv["stats"] == {} and lv["events"] == []
