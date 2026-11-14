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
    inner = js[js.index("(") + 1: js.rindex(")")]
    assert json.loads(inner.replace("<\\/", "</")) == {"x": {"label": "</script><b>"}}


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
    r = _client(str(tmp_path)).get("/s/t/api/fx/ducks/custom.js")
    assert r.status_code == 200
    assert r.mimetype == "application/javascript"
    assert r.headers["Cache-Control"] == "no-store"
    assert '"my-duck"' in r.get_data(as_text=True)


def test_custom_js_needs_a_token(tmp_path):
    assert _client(str(tmp_path), tenant_id=None).get("/s/t/api/fx/ducks/custom.js").status_code == 404
