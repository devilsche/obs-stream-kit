"""Model gallery: Bestand aus Katalogen, Haken „Keep“, Löschen in den Papierkorb samt Katalog-Pflege."""
import json
import os

from fx import model_sort as ms

CAR, PROP, NOTE, CAND = "a" * 32, "b" * 32, "c" * 32, "d" * 32


def _w(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w" if isinstance(data, str) else "wb") as f:
        f.write(data if isinstance(data, (str, bytes)) else json.dumps(data))


def _setup(root):
    d = os.path.join(root, "data")
    for u in (CAR, PROP, NOTE, CAND):
        _w(os.path.join(d, "car-cache", u + ".glb"), b"glTF" + b"x" * 100)
    _w(os.path.join(d, "car-rain", CAR + ".glb"), b"glTF")
    _w(os.path.join(d, "car-rain", "catalog.json"), json.dumps([{"uid": CAR, "key": "bmw", "name": "BMW", "author": "A"}]))
    _w(os.path.join(d, "car-picks.json"), json.dumps({"version": 1, "picks": {CAR: {"keep": True}}}))
    _w(os.path.join(d, "track-props", PROP + "-tree.glb"), b"glTF")
    _w(os.path.join(d, "track-props", "catalog.json"), json.dumps({"props": [{"uid": PROP + "-tree", "key": "tree-x", "kind": "tree", "theme": "forest", "name": "Tree"}], "credits": []}))
    _w(os.path.join(d, "sketchfab-notes.json"), json.dumps([{"id": "1", "urls": ["https://x/" + NOTE], "uids": [NOTE], "note": "Geile Karre"}]))
    _w(os.path.join(root, "assets", "cars", "candidates.json"), json.dumps([{"uid": CAND, "name": "Candidate"}]))


def test_inventory_groups_and_uses(tmp_path):
    root = str(tmp_path); _setup(root)
    by = {i["uid"]: i for i in ms.inventory(root)}
    assert by[CAR]["group"] == "car" and by[CAR]["inUse"] and by[CAR]["name"] == "BMW"
    assert by[PROP]["group"] == "prop" and by[PROP]["uses"] == ["Track: tree · forest"]
    assert by[NOTE]["group"] == "note" and by[NOTE]["notes"] == ["Geile Karre"]
    assert by[CAND]["group"] == "car-candidate" and not by[CAND]["inUse"]
    assert ms.glb_path(root, CAR).endswith(os.path.join("car-cache", CAR + ".glb"))   # Original zuerst


def test_purge_moves_unkept_and_cleans_catalogs(tmp_path):
    root = str(tmp_path); _setup(root)
    assert ms.set_keep(root, NOTE, True) and not ms.set_keep(root, "../x", True)
    out = ms.purge(root, now=0)
    assert out["moved"] == 3 and out["trash"] == os.path.join("data", "model-trash", "19700101-000000")
    d = os.path.join(root, "data")
    assert os.path.exists(os.path.join(d, "car-cache", NOTE + ".glb"))
    assert not os.path.exists(os.path.join(d, "car-cache", CAR + ".glb"))
    assert os.path.exists(os.path.join(root, out["trash"], "car-rain", CAR + ".glb"))
    assert json.load(open(os.path.join(d, "car-rain", "catalog.json"))) == []
    assert json.load(open(os.path.join(d, "car-picks.json")))["picks"][CAR] == {"keep": False}
    assert json.load(open(os.path.join(d, "track-props", "catalog.json")))["props"] == []
    assert json.load(open(os.path.join(d, "track-props", "off.json")))["off"] == ["tree-x"]


def test_thumb_only_webp_and_small(tmp_path):
    root = str(tmp_path)
    assert not ms.save_thumb(root, CAR, b"<svg>")
    assert ms.save_thumb(root, CAR, b"RIFF....WEBP")
    assert not ms.save_thumb(root, "../../x", b"RIFF")
