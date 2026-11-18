"""Auto-Editor: Fahrzeuge und Felgen speichern, laden, als Script ausliefern."""
from flask import Flask, g

from fx import car_models as cm
from fx.endpoints import bp_fx


def test_save_load_delete(tmp_path):
    root = str(tmp_path)
    assert cm.save(root, "vehicles", "e30", {"label": "E30 Tuned", "parts": [{"t": "wing"}]}) is None
    assert cm.save(root, "rims", "bbs-rs", {"style": "mesh", "n": 10}) is None
    assert cm.load(root, "vehicles") == {"e30": {"label": "E30 Tuned", "parts": [{"t": "wing"}]}}
    assert cm.load(root, "rims") == {"bbs-rs": {"style": "mesh", "n": 10}}
    assert cm.delete(root, "rims", "bbs-rs") is True
    assert cm.delete(root, "rims", "bbs-rs") is False
    assert cm.load(root, "rims") == {}


def test_validation(tmp_path):
    root = str(tmp_path)
    assert cm.save(root, "vehicles", "Bad Key", {}) is not None
    assert cm.save(root, "vehicles", "ok", []) is not None
    assert cm.save(root, "vehicles", "ok", {"label": "x" * 41}) is not None
    assert cm.save(root, "boats", "ok", {}) is not None
    assert cm.save(root, "vehicles", "big", {"a": "x" * (cm.MAX_DEF_BYTES + 1)}) is not None
    deep = {}
    cur = deep
    for _ in range(cm.MAX_DEPTH + 2):
        cur["a"] = {}
        cur = cur["a"]
    assert cm.save(root, "vehicles", "deep", deep) is not None
    assert cm.load(root, "vehicles") == {}


def test_broken_file_is_empty(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "car-vehicles.json").write_text("{nope")
    assert cm.load(str(tmp_path), "vehicles") == {}


def test_script_escapes():
    js = cm.script({"x": {"label": "</script>"}}, {})
    assert "</script>" not in js
    assert js.startswith("window.ToyCars && ToyCars.applyCustom")


def _client(root, tenant_id=1):
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = root
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def test_custom_js_endpoint(tmp_path):
    cm.save(str(tmp_path), "vehicles", "my-car", {"label": "Mine"})
    cm.save(str(tmp_path), "rims", "mesh", {"style": "mesh"})
    r = _client(str(tmp_path)).get("/s/t/api/fx/cars/custom.js")
    assert r.status_code == 200
    assert r.mimetype == "application/javascript"
    assert r.headers["Cache-Control"] == "no-store"
    body = r.get_data(as_text=True)
    assert '"my-car"' in body and '"rims":{"mesh"' in body


def test_custom_js_needs_a_token(tmp_path):
    assert _client(str(tmp_path), tenant_id=None).get("/s/t/api/fx/cars/custom.js").status_code == 404


def test_catalog_and_model_files(tmp_path):
    d = tmp_path / "data" / "car-rain"
    d.mkdir(parents=True)
    uid = "0123456789abcdef0123456789abcdef"
    (d / "catalog.json").write_text('[{"uid": "%s", "key": "e30"}]' % uid)
    (d / (uid + ".glb")).write_bytes(b"glTF")
    c = _client(str(tmp_path))
    assert c.get("/s/t/api/fx/cars/catalog.json").json == [{"uid": uid, "key": "e30"}]
    r = c.get("/s/t/api/fx/cars/model/" + uid + ".glb")
    assert r.status_code == 200 and r.data == b"glTF" and r.mimetype == "model/gltf-binary"
    assert c.get("/s/t/api/fx/cars/model/../../x.glb").status_code == 404
    assert c.get("/s/t/api/fx/cars/model/ffffffffffffffffffffffffffffffff.glb").status_code == 404


def test_catalog_missing_is_empty(tmp_path):
    assert _client(str(tmp_path)).get("/s/t/api/fx/cars/catalog.json").json == []


def test_many_picked_parts_fit(tmp_path):
    # viele gewählte Teile mit langen Namen (Lack, Räder, Farbbereiche) müssen speicherbar sein
    keys = ["polySurface%d_w:3DWheel Front LSG1_0/%d" % (i, j) for i in range(4) for j in range(115)]
    d = {"paintParts": keys[:400], "wheelParts": keys[:400], "steerParts": keys[:200],
         "zones": [{"id": "rim", "name": "Rims", "c": 1, "f": "satin", "parts": keys[:400]}]}
    assert cm.save(str(tmp_path), "vehicles", "abt", d) is None
