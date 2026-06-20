import json
from g1r.db import connect, init_schema
from g1r.endpoints import G1rEndpointRegistry


def _reg(tmp_db_path):
    init_schema(connect(tmp_db_path))                  # Schema einmal in die Datei
    return G1rEndpointRegistry(get_conn=lambda: connect(tmp_db_path), tenant_id=1)


def test_ingest_creates_run_sample_event(tmp_db_path):
    reg = _reg(tmp_db_path)
    body = json.dumps({"client_seq": 1, "save_key": "S",
                       "snapshot": {"level": 3, "hp": 100},
                       "events": [{"kind": "hit_dealt", "value": 50}]}).encode()
    out, code, _ = reg.dispatch("POST", "/api/g1r/ingest", body, {})
    assert code == 200
    res = json.loads(out)
    assert res["ok"] and res["run_id"]
    rc = connect(tmp_db_path)
    assert rc.execute("SELECT COUNT(*) c FROM g1r_event").fetchone()["c"] == 1


def test_ingest_dedup(tmp_db_path):
    reg = _reg(tmp_db_path)
    body = json.dumps({"client_seq": 7, "save_key": "S", "snapshot": {"level": 1},
                       "events": [{"kind": "kill", "value": 1}]}).encode()
    reg.dispatch("POST", "/api/g1r/ingest", body, {})
    out, code, _ = reg.dispatch("POST", "/api/g1r/ingest", body, {})
    assert json.loads(out).get("dedup") is True
    rc = connect(tmp_db_path)
    assert rc.execute("SELECT COUNT(*) c FROM g1r_event").fetchone()["c"] == 1


def _ingest(reg, **kw):
    return reg.dispatch("POST", "/api/g1r/ingest", json.dumps(kw).encode(), {})


def test_get_runs_lists_runs(tmp_db_path):
    reg = _reg(tmp_db_path)
    _ingest(reg, client_seq=1, save_key="A", snapshot={"level": 4}, events=[])
    out, code, _ = reg.dispatch("GET", "/api/g1r/runs", None, {})
    assert code == 200
    res = json.loads(out)
    assert res["ok"] and len(res["runs"]) == 1 and res["runs"][0]["level"] == 4


def test_get_career_run_scope_and_all(tmp_db_path):
    reg = _reg(tmp_db_path)
    _ingest(reg, client_seq=1, save_key="A", snapshot={"level": 6},
            events=[{"kind": "kill", "value": 1}, {"kind": "hit_dealt", "value": 30}])
    rid = json.loads(_ingest(reg, client_seq=2, save_key="A",
                             snapshot={"level": 7}, events=[])[0])["run_id"]
    out, code, _ = reg.dispatch("GET", f"/api/g1r/career?run={rid}", None, {})
    assert code == 200
    res = json.loads(out)
    assert res["scope"] == "run" and res["totals"]["kills"] == 1
    assert res["records"]["hardest_dealt"] == 30
    out2, _, _ = reg.dispatch("GET", "/api/g1r/career", None, {})
    assert json.loads(out2)["scope"] == "all"


def test_get_career_bad_run_param(tmp_db_path):
    reg = _reg(tmp_db_path)
    _, code, _ = reg.dispatch("GET", "/api/g1r/career?run=abc", None, {})
    assert code == 400


def test_get_live_active_run(tmp_db_path):
    reg = _reg(tmp_db_path)
    _ingest(reg, client_seq=1, save_key="A", snapshot={"level": 5},
            events=[{"kind": "kill", "value": 1, "meta": {"type": "Wolf"}}])
    out, code, _ = reg.dispatch("GET", "/api/g1r/live", None, {})
    assert code == 200
    res = json.loads(out)
    assert res["run"] and res["stats"]["level"] == 5
    assert any(e["kind"] == "kill" and e["meta"] == {"type": "Wolf"} for e in res["events"])


def test_run_new_forces_run(tmp_db_path):
    reg = _reg(tmp_db_path)
    reg.dispatch("POST", "/api/g1r/ingest",
                 json.dumps({"client_seq": 1, "save_key": "S", "snapshot": {"level": 9}, "events": []}).encode(), {})
    out, code, _ = reg.dispatch("POST", "/api/g1r/run/new", json.dumps({"label": "NG+"}).encode(), {})
    assert code == 200 and json.loads(out)["ok"]
    rc = connect(tmp_db_path)
    assert rc.execute("SELECT COUNT(*) c FROM g1r_run").fetchone()["c"] == 2
