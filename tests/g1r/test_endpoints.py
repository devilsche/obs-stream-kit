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


def test_run_new_forces_run(tmp_db_path):
    reg = _reg(tmp_db_path)
    reg.dispatch("POST", "/api/g1r/ingest",
                 json.dumps({"client_seq": 1, "save_key": "S", "snapshot": {"level": 9}, "events": []}).encode(), {})
    out, code, _ = reg.dispatch("POST", "/api/g1r/run/new", json.dumps({"label": "NG+"}).encode(), {})
    assert code == 200 and json.loads(out)["ok"]
    rc = connect(tmp_db_path)
    assert rc.execute("SELECT COUNT(*) c FROM g1r_run").fetchone()["c"] == 2
