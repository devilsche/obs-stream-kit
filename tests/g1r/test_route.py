"""Verdrahtung von _build_g1r_registry (app/views_api.py) → G1rEndpointRegistry.

Der volle Flask-Routentest (/s/<token>/api/g1r/ingest) braucht die pg-Test-DB
(Tenant/Token-Setup) und läuft nur dort, wo pg verfügbar ist — analog den
pubg-Routentests. Hier verifizieren wir die Registry-Verdrahtung direkt über
eine sqlite-Conn (kein Flask-Request-Kontext nötig)."""
import json
from g1r.db import connect, init_schema


def test_build_g1r_registry_dispatches_ingest(tmp_db_path, monkeypatch):
    init_schema(connect(tmp_db_path))
    import app.views_api as v
    monkeypatch.setattr(v, "_get_conn", lambda: connect(tmp_db_path))
    reg = v._build_g1r_registry(1)
    body = json.dumps({"client_seq": 1, "save_key": "S",
                       "snapshot": {"level": 2}, "events": []}).encode()
    out, code, _ = reg.dispatch("POST", "/api/g1r/ingest", body, {})
    assert code == 200 and json.loads(out)["ok"]
    rc = connect(tmp_db_path)
    assert rc.execute("SELECT COUNT(*) c FROM g1r_run").fetchone()["c"] == 1
