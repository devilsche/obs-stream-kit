"""Auto-Modelle vermessen: Innenraum an Namen oder Punkten im Kabinenkern."""
import json
import struct

from fx import glb_scan


def _glb(path, points, mat_name="body"):
    data = b"".join(struct.pack("<3f", *p) for p in points)
    g = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
         "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}], "materials": [{"name": mat_name}],
         "buffers": [{"byteLength": len(data)}], "bufferViews": [{"buffer": 0, "byteLength": len(data)}],
         "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(points), "type": "VEC3"}]}
    js = json.dumps(g).encode()
    js += b" " * (-len(js) % 4)
    data += b"\0" * (-len(data) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(data), 0x004E4942) + data
    path.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)


def _shell():
    # Hülle eines 4 × 1,4 × 1,8 m großen Kastens (nur Ecken und Kanten-Mitten)
    pts = []
    for x in (0, 2, 4):
        for y in (0, 1.4):
            for z in (-0.9, 0.9):
                pts.append((x, y, z))
    return pts * 20


def test_hollow_shell_has_no_interior(tmp_path):
    p = tmp_path / "a.glb"
    _glb(p, _shell())
    r = glb_scan.scan(str(p))
    assert r["interior"] is False and r["share"] == 0


def test_points_in_cabin_count_as_interior(tmp_path):
    p = tmp_path / "b.glb"
    _glb(p, _shell() + [(2, 0.7, 0.1)] * 20)
    assert glb_scan.scan(str(p))["interior"] is True


def test_interior_by_material_name(tmp_path):
    p = tmp_path / "c.glb"
    _glb(p, _shell(), mat_name="Leather_seats")
    assert glb_scan.scan(str(p))["interior"] is True
