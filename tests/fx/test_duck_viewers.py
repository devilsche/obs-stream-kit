"""!outfit: Outfit-Namen erkennen, Wahl je Zuschauer und Tenant speichern, Begrüßungs-Ente."""
import os

import pytest
from flask import Flask, g

from fx import commands, duck_outfits, duck_viewers as dv
from fx import endpoints
from fx.endpoints import bp_fx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def items():
    return dv.catalog(ROOT)


def test_catalog_reads_outfits_from_js(items):
    keys = [it["key"] for it in items]
    assert "thw" in keys and "batman" in keys          # js/rubber-duck.js
    assert "knight" in keys and "luckyluke" in keys    # js/rubber-duck-outfits.js
    assert "court-judge" not in keys                    # nur im Gericht angemeldet
    assert len(keys) == len(set(keys)) and len(keys) > 60


@pytest.mark.parametrize("q,key", [
    ("knight", "knight"), ("Knight", "knight"), ("Ritter", "knight"), ("@ritter", "knight"),
    ("Lucky Luke", "luckyluke"), ("lucky-luke", "luckyluke"), ("Henker", "executioner"),
    ("Richter", "judge"), ("König", "king"), ("koenig", "king"), ("Kürbis", "pumpkin"),
    ("frank", "frankenstein"), ("Spider-Man", "spiderman"), ("THW", "thw"),
])
def test_resolve_hits(items, q, key):
    hit, _ = dv.resolve(q, items)
    assert hit and hit["key"] == key


def test_resolve_ambiguous_and_unknown(items):
    hit, sugg = dv.resolve("ki", items)
    assert hit is None
    hit, sugg = dv.resolve("knigt", items)
    assert hit is None and "knight" in [s["key"] for s in sugg]
    assert dv.resolve("", items) == (None, [])
    assert dv.resolve("qqqqqqqq", items) == (None, [])


def test_custom_outfits_count(tmp_path):
    root = str(tmp_path)
    for f in ("rubber-duck.js", "rubber-duck-outfits.js"):
        os.makedirs(os.path.join(root, "js"), exist_ok=True)
        with open(os.path.join(ROOT, "js", f), encoding="utf-8") as src, open(os.path.join(root, "js", f), "w", encoding="utf-8") as dst:
            dst.write(src.read())
    duck_outfits.save(root, "disco-duck", {"label": "Disco Duck"})
    hit, _ = dv.resolve("disco duck", dv.catalog(root))
    assert hit["key"] == "disco-duck"


def test_store_per_tenant(tmp_path):
    root = str(tmp_path)
    assert dv.set_outfit(root, 1, "LuCKoR_HD", "knight")
    assert dv.outfit_of(root, 1, "@luckor_hd") == "knight"
    assert dv.outfit_of(root, 2, "luckor_hd") is None
    assert dv.mapping(root, 1) == {"luckor_hd": "knight"}
    assert dv.set_outfit(root, 1, "luckor_hd", None)
    assert dv.mapping(root, 1) == {}
    assert not dv.set_outfit(root, 1, "../evil", "knight")


def test_command_texts(tmp_path, monkeypatch):
    root = str(tmp_path)
    monkeypatch.setattr(dv, "catalog", lambda r: _cat())
    out = dv.command(root, 1, "Bob", "")
    assert "kein Outfit" in out["say"] and out["outfit"] is None
    out = dv.command(root, 1, "Bob", "Ritter")
    assert out["outfit"] == "knight" and "Bob watschelt jetzt als Knight" in out["say"]
    assert "Knight" in dv.command(root, 1, "bob", "")["say"]
    out = dv.command(root, 1, "Bob", "knigt")
    assert out["outfit"] is None and "Knight" in out["say"] and "!outfits" in out["say"]
    assert dv.outfit_of(root, 1, "bob") == "knight"
    dv.command(root, 1, "Bob", "random")
    assert dv.outfit_of(root, 1, "bob") is None


_CAT = dv.catalog(ROOT)


def _cat():
    return _CAT


def _client(root, tenant_id=1):
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = root
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def test_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(dv, "catalog", lambda r: _CAT)
    commands.reset_store()
    endpoints._GREETED.clear()
    c = _client(str(tmp_path))
    assert c.get("/s/t/api/fx/ducks/greet?user=Bob").get_json()["greet"] is False
    r = c.get("/s/t/api/fx/ducks/outfit?user=Bob&q=Lucky%20Luke").get_json()
    assert r["outfit"] == "luckyluke"
    js = c.get("/s/t/api/fx/ducks/custom.js").get_data(as_text=True)
    assert 'RubberDuck.setViewers({"bob":"luckyluke"})' in js
    assert c.get("/s/t/api/fx/ducks/greet?user=Bob").get_json()["greet"] is False   # kam schon mit der Wahl
    endpoints._GREETED.clear()                                                       # neuer Stream
    assert c.get("/s/t/api/fx/ducks/greet?user=Bob").get_json()["greet"] is True
    assert c.get("/s/t/api/fx/ducks/greet?user=bob").get_json()["greet"] is False   # schon begrüßt
    poll = c.get("/s/t/api/fx/duckgreet/poll?since=0").get_json()
    assert [x["params"] for x in poll["commands"]] == [{"name": "Bob", "outfit": "luckyluke"}] * 2
    assert c.get("/s/t/api/fx/ducks/outfit").status_code == 400
    assert _client(str(tmp_path), tenant_id=None).get("/s/t/api/fx/ducks/outfit?user=x").status_code == 404


def test_outfit_change_always_greets(tmp_path, monkeypatch):
    monkeypatch.setattr(dv, "catalog", lambda r: _CAT)
    commands.reset_store()
    endpoints._GREETED.clear()
    c = _client(str(tmp_path))
    c.get("/s/t/api/fx/ducks/outfit?user=Bob&q=knight")
    assert c.get("/s/t/api/fx/ducks/greet?user=Bob").get_json()["greet"] is False   # kam schon mit der Wahl
    endpoints._GREETED[(1, "bob")] -= 60                                               # 1 min später: neues Outfit
    c.get("/s/t/api/fx/ducks/outfit?user=Bob&q=pirate")
    c.get("/s/t/api/fx/ducks/outfit?user=Bob&q=king")                                 # gleich danach: kein Spam
    c.get("/s/t/api/fx/ducks/outfit?user=Bob&q=")                                     # nur anzeigen: keine Ente
    poll = c.get("/s/t/api/fx/duckgreet/poll?since=0").get_json()
    assert [x["params"]["outfit"] for x in poll["commands"]] == ["knight", "pirate"]


def test_parade_ping_reaches_greeting(tmp_path):
    commands.reset_store()
    c = _client(str(tmp_path))
    assert c.get("/s/t/api/fx/ducks/parade?sec=60").get_json()["ok"] is True
    assert c.get("/s/t/api/fx/ducks/parade?sec=0").status_code == 400
    assert c.get("/s/t/api/fx/ducks/parade?sec=999").status_code == 400
    poll = c.get("/s/t/api/fx/duckgreet/poll?since=0").get_json()
    assert [(x["cmd"], x["params"]) for x in poll["commands"]] == [("parade", {"sec": 60})]
