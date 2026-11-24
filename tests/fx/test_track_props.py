"""Kulissen-Modelle der Strecken-Themen: Katalog + Modell-Dateien über Token- und /drive/a/-Pfad."""
import json

from flask import Flask, g

from app.views_drive import bp_drive
from fx import track_props
from fx.endpoints import bp_fx

UID = "0123456789abcdef0123456789abcdef"


def _client(root, tenant_id=1):
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = str(root)
    app.register_blueprint(bp_fx)
    app.register_blueprint(bp_drive)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def _setup(tmp_path):
    d = tmp_path / "data" / "track-props"
    d.mkdir(parents=True)
    cat = {"props": [{"uid": UID, "kind": "lighthouse", "theme": "coast", "bytes": 4}],
           "credits": [{"name": "L", "author": "A", "license": "CC Attribution", "url": "https://x"}]}
    (d / "catalog.json").write_text(json.dumps(cat))
    (d / (UID + ".glb")).write_bytes(b"glTF")
    return cat


def test_catalog_both_paths(tmp_path):
    cat = _setup(tmp_path)
    c = _client(tmp_path)
    for url in ("/s/t/api/fx/track-props/catalog.json", "/drive/a/api/fx/track-props/catalog.json"):
        r = c.get(url)
        assert r.status_code == 200 and r.json == cat and r.headers["Cache-Control"] == "no-store"


def test_model_both_paths(tmp_path):
    _setup(tmp_path)
    c = _client(tmp_path)
    for base in ("/s/t/api/fx/track-props/", "/drive/a/api/fx/track-props/"):
        r = c.get(base + UID + ".glb?v=4")
        assert r.status_code == 200 and r.data == b"glTF" and r.mimetype == "model/gltf-binary"
        assert "max-age" in r.headers["Cache-Control"]
        assert c.get(base + "f" * 32 + ".glb").status_code == 404
        assert c.get(base + "..%2F..%2Fx.glb").status_code == 404


def test_token_needed_and_missing_catalog(tmp_path):
    _setup(tmp_path)
    assert _client(tmp_path, tenant_id=None).get("/s/t/api/fx/track-props/catalog.json").status_code == 404
    assert _client(tmp_path, tenant_id=None).get("/s/t/api/fx/track-props/" + UID + ".glb").status_code == 404
    assert track_props.catalog(str(tmp_path / "nowhere")) == {"props": [], "credits": []}
    (tmp_path / "data" / "track-props" / "catalog.json").write_text("[1, 2]")
    assert track_props.catalog(str(tmp_path)) == {"props": [], "credits": []}


def test_pack_part_file_name(tmp_path):
    _setup(tmp_path)
    (tmp_path / "data" / "track-props" / (UID + "-b1.glb")).write_bytes(b"glTF")
    assert track_props.model_name(str(tmp_path), UID + "-b1") == UID + "-b1.glb"
    assert track_props.model_name(str(tmp_path), UID + "-B1") is None
    assert track_props.model_name(str(tmp_path), UID + "-../x") is None
    assert track_props.model_name(str(tmp_path), UID + "-") is None
    r = _client(tmp_path).get("/drive/a/api/fx/track-props/" + UID + "-b1.glb")
    assert r.status_code == 200 and r.data == b"glTF"


def test_thrown_out_props_hidden_from_game(tmp_path):
    d = tmp_path / "data" / "track-props"
    d.mkdir(parents=True)
    props = [{"uid": UID, "key": "tree-a", "kind": "tree", "theme": "forest"},
             {"uid": UID + "-p2", "key": "tree-b", "kind": "tree", "theme": "forest"}]
    (d / "catalog.json").write_text(json.dumps({"props": props, "credits": []}))
    root = str(tmp_path)
    assert track_props.off_keys(root) == set()
    assert track_props.set_off(root, "tree-a", True) is True
    assert track_props.set_off(root, "nope", True) is False          # nur Katalog-Schlüssel
    assert [p["key"] for p in track_props.catalog(root)["props"]] == ["tree-b"]
    full = track_props.catalog(root, include_off=True)["props"]
    assert [(p["key"], p["off"]) for p in full] == [("tree-a", True), ("tree-b", False)]
    r = _client(tmp_path).get("/drive/a/api/fx/track-props/catalog.json")
    assert [p["key"] for p in r.json["props"]] == ["tree-b"]
    assert track_props.set_off(root, "tree-a", False) is True
    assert len(track_props.catalog(root)["props"]) == 2
    (d / "off.json").write_text("kaputt")
    assert track_props.off_keys(root) == set()


def test_search_picks(tmp_path):
    root = str(tmp_path)
    assert track_props.picks(root) == set()
    assert track_props.set_pick(root, UID, True) is True
    assert track_props.set_pick(root, "nope", True) is False          # nur Sketchfab-uids
    assert track_props.picks(root) == {UID}
    assert track_props.set_pick(root, UID, False) is True and track_props.picks(root) == set()
