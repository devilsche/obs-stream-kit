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


def test_snapshot_from_payload_maps_fields():
    p = {"stats": {"level": 12, "hp": 250, "hpMax": 280, "magicCircle": 3, "resFire": 20},
         "session": {"distanceM": 2380.5, "steps": 3400},
         "guildKey": "guards", "strongestMelee": "ItMw_X", "strongestMeleeDmg": 73}
    snap = srv.snapshot_from_payload(p)
    assert snap["level"] == 12 and snap["hp"] == 250 and snap["hp_max"] == 280
    assert snap["magic_circle"] == 3 and snap["res_fire"] == 20
    assert snap["distance_m"] == 2380.5 and snap["steps"] == 3400
    assert snap["guild_key"] == "guards"
    assert snap["strongest_melee"] == "ItMw_X" and snap["strongest_melee_dmg"] == 73
    assert snap["mana"] is None and snap["strongest_spell"] is None  # fehlende Felder -> None
