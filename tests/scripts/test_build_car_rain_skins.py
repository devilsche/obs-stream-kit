"""bake_skins: Skin-Netze werden vor gltfpack fest umgerechnet (BMW M3 Competition: 225 Skin-Netze,
gltfpack vergrößerte die Karosserie sonst ~250-fach)."""
import json
import struct

import numpy as np
import pytest

from scripts import build_car_rain as b


def _glb(path, nodes, positions, joints, weights, ibm):
    binc = bytearray()
    views, accs = [], []

    def add(arr, ctype, atype, fmt):
        data = np.asarray(arr, dtype=fmt).tobytes()
        binc.extend(b"\0" * (-len(binc) % 4))
        views.append({"buffer": 0, "byteOffset": len(binc), "byteLength": len(data)})
        binc.extend(data)
        accs.append({"bufferView": len(views) - 1, "componentType": ctype, "count": len(arr), "type": atype})
        return len(accs) - 1
    p = add(positions, 5126, "VEC3", "<f4")
    accs[p]["min"] = list(np.min(positions, 0).astype(float))
    accs[p]["max"] = list(np.max(positions, 0).astype(float))
    j = add(joints, 5123, "VEC4", "<u2")
    w = add(weights, 5126, "VEC4", "<f4")
    i = add([m.T.reshape(16) for m in ibm], 5126, "MAT4", "<f4")
    g = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes,
         "meshes": [{"primitives": [{"attributes": {"POSITION": p, "JOINTS_0": j, "WEIGHTS_0": w}}]}],
         "skins": [{"joints": [2, 3], "inverseBindMatrices": i}],
         "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(binc)}]}
    b.glb_write(path, g, binc)


def test_bake_skins_rechnet_knochenlage_ein(tmp_path):
    # Wurzel skaliert 0,5; Netz-Knoten verschoben (+1 x); Knochen 1 bei z=2, Knochen 2 bei z=4
    nodes = [{"children": [1, 2], "scale": [0.5, 0.5, 0.5]},
             {"mesh": 0, "skin": 0, "translation": [1, 0, 0]},
             {"children": [3], "translation": [0, 0, 2]},
             {"translation": [0, 0, 2]}]
    ibm = [np.eye(4), np.eye(4)]
    pos = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    _glb(str(tmp_path / "s.glb"), nodes, pos, [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0]],
         [[1, 0, 0, 0], [1, 0, 0, 0], [0.5, 0.5, 0, 0]], ibm)
    assert b.bake_skins(str(tmp_path / "s.glb"), str(tmp_path / "o.glb"))
    g, binc = b.glb_read(str(tmp_path / "o.glb"))
    nd = g["nodes"][1]
    assert "skin" not in nd
    at = g["meshes"][nd["mesh"]]["primitives"][0]["attributes"]
    assert "JOINTS_0" not in at and "WEIGHTS_0" not in at
    got = b._acc(g, binc, at["POSITION"])
    # Welt (glTF-Norm): Σ w · Knochenwelt · Punkt; Knochen 1 = 0,5·p + z1, Knochen 2 = 0,5·p + z2
    world = np.array([[0, 0, 1.0], [0.5, 0, 2.0], [0, 0.5, 1.5]])
    # zurück in die Knotenlage des Netzes: (Welt / 0,5) − (1, 0, 0)
    assert got == pytest.approx(world / 0.5 - np.array([1, 0, 0]), abs=1e-6)


def test_bake_skins_ohne_skin_nichts(tmp_path):
    g = {"asset": {"version": "2.0"}, "nodes": [{}], "scenes": [{"nodes": [0]}], "buffers": [{"byteLength": 0}], "bufferViews": [], "accessors": []}
    b.glb_write(str(tmp_path / "n.glb"), g, b"")
    assert not b.bake_skins(str(tmp_path / "n.glb"), str(tmp_path / "o.glb"))
