"""Duck-Editor: gespeicherte Outfits (data/duck-outfits.json) und das Script für die Effekte."""
import json

from flask import Flask, g

from fx import duck_outfits as do
from fx.endpoints import bp_fx


def test_save_load_roundtrip(tmp_path):
    assert do.load(str(tmp_path)) == {}
    assert do.save(str(tmp_path), "my-duck", {"label": "Mine", "suit": 123, "acc": [["crown", {"xf": {"s": [2, 2, 2]}}]]}) is None
    assert do.load(str(tmp_path)) == {"my-duck": {"label": "Mine", "suit": 123, "acc": [["crown", {"xf": {"s": [2, 2, 2]}}]]}}


def test_save_overwrites_and_delete_restores(tmp_path):
    root = str(tmp_path)
    do.save(root, "pirate", {"suit": 1})
    do.save(root, "pirate", {"suit": 2})
    assert do.load(root)["pirate"] == {"suit": 2}
    assert do.delete(root, "pirate") is True
    assert do.delete(root, "pirate") is False
    assert do.load(root) == {}


def test_rejects_bad_keys_and_defs(tmp_path):
    root = str(tmp_path)
    for key in ("", "Bad", "1abc", "a b", "../x", "a" * 33, None):
        assert do.save(root, key, {}) is not None
    assert do.save(root, "ok", []) is not None
    assert do.save(root, "ok", {"label": "x" * 41}) is not None
    assert do.save(root, "ok", {"pad": "x" * (do.MAX_DEF_BYTES + 1)}) is not None
    deep = {}
    cur = deep
    for _ in range(12):
        cur["a"] = {}
        cur = cur["a"]
    assert do.save(root, "ok", deep) is not None
    assert do.load(root) == {}


def test_broken_file_counts_as_empty(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "duck-outfits.json").write_text("{nope", encoding="utf-8")
    assert do.load(str(tmp_path)) == {}


def test_script_escapes_closing_tags():
    js = do.script({"x": {"label": "</script><b>"}})
    assert "</script>" not in js
    assert js.startswith("window.RubberDuck && RubberDuck.applyCustom && RubberDuck.applyCustom(")
    line = js.splitlines()[0]
    inner = line[line.index("(") + 1: line.rindex(")")]
    assert json.loads(inner.replace("<\\/", "</")) == {"x": {"label": "</script><b>"}}


def test_script_carries_global_parts():
    js = do.script({}, {"cap": {"s": [1, 1, 2]}})
    line = [ln for ln in js.splitlines() if "applyParts" in ln][0]
    assert line.startswith("window.RubberDuck && RubberDuck.applyParts && RubberDuck.applyParts(")
    assert json.loads(line[line.index("(") + 1: line.rindex(")")]) == {"cap": {"s": [1, 1, 2]}}
    assert "applyParts" not in do.script({})


def test_parts_save_load_delete(tmp_path):
    root = str(tmp_path)
    assert do.load_parts(root) == {}
    xf = {"sub": {"2": {"s": [1, 1, 1.5], "b": [0, -0.1]}}}
    assert do.save_part(root, "cap", xf) is None
    assert do.save_part(root, "acc:crown", {"c": 255}) is None
    assert do.load_parts(root) == {"cap": xf, "acc:crown": {"c": 255}}
    assert do.load(root) == {}          # Outfits und Teile getrennt
    assert do.delete_part(root, "cap") is True
    assert do.delete_part(root, "cap") is False
    assert do.load_parts(root) == {"acc:crown": {"c": 255}}


def test_parts_reject_bad_keys(tmp_path):
    root = str(tmp_path)
    for key in ("", "Cap", "hat", "acc:", "acc:../x", "acc:" + "a" * 41, None, "acc:9x"):
        assert do.save_part(root, key, {}) is not None
    assert do.save_part(root, "cap", []) is not None
    assert do.save_part(root, "cap", {"pad": "x" * (do.MAX_DEF_BYTES + 1)}) is not None
    assert do.load_parts(root) == {}


def test_deep_sub_xf_in_acc_fits(tmp_path):
    d = {"acc": [["crown", {"xf": {"sub": {"3": {"p": [0, 1, 0]}}}}]]}
    assert do.save(str(tmp_path), "deep", d) is None


def _client(root, tenant_id=1):
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = root
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def test_custom_js_endpoint(tmp_path):
    do.save(str(tmp_path), "my-duck", {"label": "Mine"})
    do.save_part(str(tmp_path), "cap", {"hide": True})
    r = _client(str(tmp_path)).get("/s/t/api/fx/ducks/custom.js")
    assert r.status_code == 200
    assert r.mimetype == "application/javascript"
    assert r.headers["Cache-Control"] == "no-store"
    assert '"my-duck"' in r.get_data(as_text=True)
    assert 'applyParts({"cap":{"hide":true}})' in r.get_data(as_text=True)


def test_custom_js_needs_a_token(tmp_path):
    assert _client(str(tmp_path), tenant_id=None).get("/s/t/api/fx/ducks/custom.js").status_code == 404
