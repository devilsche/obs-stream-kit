"""GLB-Dateien (Auto-Modelle) ohne Zusatzpakete vermessen: Innenraum ja/nein, Dreiecke, Maße.

Innenraum: Materialien/Knoten heißen wie Innenraumteile (leather, seat, dashboard …) oder mindestens
4 % der Punkte liegen im Kabinenkern (mittleres Längsdrittel, innere 55 % der Breite, 25–75 % der Höhe)
— dieselbe Regel wie js/glb-fix.js im Browser.
"""
import json
import re
import struct

TIRE = re.compile(r"tire|tyre|reifen|rubber|whitewall", re.I)
# ganze Räder an Teile- oder Materialnamen (wheel_lf, 3DWheel Front L, Tyre_RR, FL_ghwheel …), nicht das Lenkrad
WHEEL = re.compile(r"wheel|tyre|tire|\brim|rim_|_rim|whl", re.I)
NOT_WHEEL = re.compile(r"steer|stitch|spare|lenk|interior|\bint_", re.I)
NOT_TIRE = re.compile(r"trim|seal|strip|window|door|mat\b|pedal", re.I)
INTERIOR = re.compile(r"interior|leather|seat|dash|steer|carpet|cockpit|stitch|gauge|headliner|\bint_|_int\b|pedal|gear|console", re.I)
CT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
MAX_POINTS = 60000


def _load(path):
    with open(path, "rb") as f:
        b = f.read()
    if b[:4] != b"glTF":
        raise ValueError("not a GLB file")
    n = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + n])
    off = 20 + n
    binc = b""
    if off + 8 <= len(b):
        bl = struct.unpack_from("<I", b, off)[0]
        binc = b[off + 8:off + 8 + bl]
    return g, binc


def _mat_mul(a, c):
    return [sum(a[r * 4 + k] * c[k * 4 + col] for k in range(4)) for r in range(4) for col in range(4)]


def _local(nd):
    if "matrix" in nd:
        m = nd["matrix"]   # spaltenweise
        return [m[col * 4 + r] for r in range(4) for col in range(4)]
    x, y, z, w = nd.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = nd.get("scale", [1, 1, 1])
    tx, ty, tz = nd.get("translation", [0, 0, 0])
    R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
         2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
         2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
    return [R[0] * sx, R[1] * sy, R[2] * sz, tx, R[3] * sx, R[4] * sy, R[5] * sz, ty,
            R[6] * sx, R[7] * sy, R[8] * sz, tz, 0, 0, 0, 1]


def _positions(g, binc, idx, step):
    a = g["accessors"][idx]
    if "bufferView" not in a:
        return []
    bv = g["bufferViews"][a["bufferView"]]
    nc, ct = NC[a["type"]], CT[a["componentType"]]
    size = struct.calcsize("<" + ct)
    stride = bv.get("byteStride") or nc * size
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    fmt = "<" + ct * 3
    return [struct.unpack_from(fmt, binc, base + i * stride) for i in range(0, a["count"], step)]


def scan(path):
    g, binc = _load(path)
    mats = g.get("materials", [])
    names = [m.get("name", "") for m in mats] + [n.get("name", "") for n in g.get("nodes", [])]
    named = any(INTERIOR.search(x or "") for x in names)
    total_v = 0
    tris = 0
    prims = []

    def walk(i, M, wheelish):
        nd = g["nodes"][i]
        W = _mat_mul(M, _local(nd))
        nm = nd.get("name", "") or ""
        wh = wheelish or bool(WHEEL.search(nm) and not NOT_WHEEL.search(nm))
        if "mesh" in nd:
            for p in g["meshes"][nd["mesh"]]["primitives"]:
                pos = p.get("attributes", {}).get("POSITION")
                if pos is None:
                    continue
                prims.append((W, pos, p, wh))
        for c in nd.get("children", []):
            walk(c, W, wh)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    tire_mats = {i for i, m in enumerate(mats) if TIRE.search(m.get("name", "")) and not NOT_TIRE.search(m.get("name", ""))}
    wheel_mats = {i for i, m in enumerate(mats) if WHEEL.search(m.get("name", "")) and not NOT_WHEEL.search(m.get("name", ""))}
    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, ident, False)
    for _, pos, p, _w in prims:
        cnt = g["accessors"][pos]["count"]
        total_v += cnt
        tris += (g["accessors"][p["indices"]]["count"] if "indices" in p else cnt) // 3
    step = max(1, total_v // MAX_POINTS)
    pts, tire, wheel = [], [], []
    for W, pos, p, wh in prims:
        is_tire = p.get("material") in tire_mats
        is_wheel = wh or p.get("material") in wheel_mats
        for x, y, z in _positions(g, binc, pos, step):
            q = (W[0] * x + W[1] * y + W[2] * z + W[3], W[4] * x + W[5] * y + W[6] * z + W[7],
                 W[8] * x + W[9] * y + W[10] * z + W[11])
            pts.append(q)
            if is_tire:
                tire.append(q)
            elif is_wheel:
                wheel.append(q)
    if not pts:
        return {"interior": named, "tris": tris, "share": 0.0}
    mn = [min(p[k] for p in pts) for k in range(3)]
    mx = [max(p[k] for p in pts) for k in range(3)]
    size = [mx[k] - mn[k] or 1e-9 for k in range(3)]
    la = 0 if size[0] >= size[2] else 2
    lat = 2 - la
    mid = (mn[lat] + mx[lat]) / 2
    hit = 0
    for p in pts:
        l = (p[la] - mn[la]) / size[la]
        w = abs(p[lat] - mid) / (size[lat] / 2)
        h = (p[1] - mn[1]) / size[1]
        if 0.3 < l < 0.7 and w < 0.55 and 0.25 < h < 0.75:
            hit += 1
    share = hit / len(pts)
    res = {"interior": bool(named or share >= 0.04), "tris": tris, "share": round(share, 4),
           "size": [round(size[0], 3), round(size[1], 3), round(size[2], 3)]}
    # Winkel am Reifen messen (Bremssättel/Speichen verfälschen ihn); nur ohne Reifen-Material die ganzen Räder
    w = _wheels(tire, mn, size, la, lat)
    if w["wheels"] < 4:
        w = _wheels(tire + wheel, mn, size, la, lat)
    res.update(w)
    return res


def _wheels(tire, mn, size, la, lat):
    """Räder wie js/glb-fix.js: Reifenpunkte (untere Hälfte) in vier Gruppen, Lenkwinkel aus der Hauptachse."""
    import math
    tire = [p for p in tire if p[1] - mn[1] < size[1] * 0.5]
    if len(tire) < 40:
        return {"wheels": 0, "steer": []}
    cl = mn[la] + size[la] / 2
    cw = mn[lat] + size[lat] / 2
    quads = {}
    for p in tire:
        quads.setdefault(("a" if p[la] > cl else "b") + ("r" if p[lat] > cw else "l"), []).append(p)
    steer = []
    for k in sorted(quads):
        q = quads[k]
        if len(q) < 10:
            continue
        ml = sum(p[la] for p in q) / len(q)
        mw = sum(p[lat] for p in q) / len(q)
        sll = sum((p[la] - ml) ** 2 for p in q)
        sww = sum((p[lat] - mw) ** 2 for p in q)
        slw = sum((p[la] - ml) * (p[lat] - mw) for p in q)
        plane = 0.5 * math.atan2(2 * slw, sll - sww)        # Radebene gegen die Längsachse
        a = math.degrees(plane)
        steer.append(round(a, 1))
    n = len(steer)
    return {"wheels": n, "steer": steer, "steered": any(abs(a) > 4 for a in steer), "half": n in (1, 2, 3)}
