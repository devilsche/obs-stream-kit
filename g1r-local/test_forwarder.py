import importlib.util as u, os
spec = u.spec_from_file_location("srv", os.path.join(os.path.dirname(__file__), "server.py"))
srv = u.module_from_spec(spec); spec.loader.exec_module(srv)


def test_forwarder_buffers_and_retries():
    fw = srv.Forwarder("http://x/api/g1r/ingest", "tok")
    fw.enqueue({"level": 1}, [{"kind": "kill", "value": 1}])
    fw.enqueue({"level": 2}, [])
    calls = []
    def fail(url, headers, body): calls.append(body); return 500
    fw.flush_once(fail)            # 500 -> bleibt im Puffer
    assert len(fw.buffer) == 2
    sent = []
    def ok(url, headers, body): sent.append(body); return 200
    fw.flush_once(ok); fw.flush_once(ok)
    assert len(fw.buffer) == 0     # beide raus
    import json
    seqs = [json.loads(b)["client_seq"] for b in sent]
    assert seqs == sorted(seqs) and len(set(seqs)) == 2
