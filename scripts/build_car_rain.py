"""Auto-Modelle für den Regen aufbereiten (lokal ausführen, braucht Node/npx für gltfpack und Pillow).

Für jedes im Car-Picker behaltene Auto (Server: data/car-picks.json, data/car-scan.json):
  1. Original aus dem Server-Cache holen (data/car-cache/<uid>.glb)
  2. mit gltfpack auf höchstens MAX_TRIS Dreiecke vereinfachen (Materialien und Teile bleiben erhalten)
  3. Texturen auf höchstens MAX_TEX Pixel verkleinern
  4. Fahrtrichtung bestimmen (eingeschlagene Räder = vorn, sonst Lampen-Namen, sonst kürzerer Überhang)
  5. nach data/car-rain/<uid>.glb auf den Server, dazu data/car-rain/catalog.json
Die Dateien kommen nicht ins Repo (öffentlich; manche Lizenzen erlauben keine Weitergabe der Datei).

  6. dazu <uid>.race.glb: Kopie mit Texturen ≤ RACE_TEX (Car Race lädt bis zu 10 Autos im Countdown); Katalogfeld raceBytes

Aufruf:  python3 scripts/build_car_rain.py [--only <uid> …] [--tris <max>] [--race-only]
  --race-only: nur die Renn-Versionen aller Katalog-Autos aus den fertigen Server-GLBs nachbauen (kein gltfpack, keine Neuvermessung)
  --tris: eigene Obergrenze für diesen Lauf (z. B. 400000 für ein fein modelliertes Auto, dessen Felgen sonst eckig werden)
"""
import io
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fx import glb_scan  # noqa: E402

SSH = ["ssh", "-i", os.path.expanduser("~/.ssh/obskit"), "root@31.70.95.217"]
SCP = ["scp", "-q", "-i", os.path.expanduser("~/.ssh/obskit")]
REMOTE = "/opt/obs-stream-kit"


class _All(set):
    """--all: jedes Modell neu bauen"""
    def __contains__(self, x):
        return True


ALL = _All()
MAX_TRIS = 2000000   # praktisch nie vereinfachen: volle Originalform (Nutzerwunsch); Teile werden beim Laden zusammengefasst
MAX_TEX = 2048
RACE_TEX = 256     # Renn-Version (<uid>.race.glb): Geometrie identisch, nur Texturen kleiner
WORK = os.path.join(tempfile.gettempdir(), "car-rain-build")
# typische Längen (m) für Nicht-Pkw, sonst 4,5 m
LEN = [(r"trolza|bus\b|megapolis", 12.5), (r"ural|truck|lkw", 7.4), (r"ct680|caterpillar|semi", 7.0), (r"g63|g-class|g class", 4.9), (r"krabby patty", 1.0)]


def remote_json(path):
    out = subprocess.run(SSH + ["cat", REMOTE + "/" + path], capture_output=True, check=True).stdout
    return json.loads(out)


def glb_read(path):
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack_from("<I", b, off)[0]
    return g, bytearray(b[off + 8:off + 8 + bl])


def glb_write(path, g, binc):
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binc = bytes(binc) + b"\0" * (-len(binc) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binc), 0x004E4942) + binc
    open(path, "wb").write(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)


def shrink_textures(path, max_px=MAX_TEX):
    """Bilder im GLB auf max_px verkleinern; Pufferabschnitte neu packen."""
    from PIL import Image
    g, binc = glb_read(path)
    imgs = {im["bufferView"]: i for i, im in enumerate(g.get("images", [])) if "bufferView" in im}
    if not imgs:
        return
    views = g["bufferViews"]
    chunks = []
    for vi, bv in enumerate(views):
        o = bv.get("byteOffset", 0)
        data = bytes(binc[o:o + bv["byteLength"]])
        if vi in imgs:
            im = g["images"][imgs[vi]]
            try:
                pic = Image.open(io.BytesIO(data))
                if max(pic.size) > max_px:
                    pic.thumbnail((max_px, max_px))
                    buf = io.BytesIO()
                    if pic.mode in ("RGBA", "LA", "P") and "A" in pic.getbands():
                        pic.save(buf, "PNG", optimize=True)
                        im["mimeType"] = "image/png"
                    else:
                        pic.convert("RGB").save(buf, "JPEG", quality=85)
                        im["mimeType"] = "image/jpeg"
                    data = buf.getvalue()
            except Exception:
                pass
        chunks.append(data)
    out = bytearray()
    for bv, data in zip(views, chunks):
        out += b"\0" * (-len(out) % 4)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
    g["buffers"][0]["byteLength"] = len(out)
    glb_write(path, g, out)


def front_sign(path, scan):
    """+1/-1: Front liegt auf der positiven/negativen Seite der Längsachse (Längsachse = größere von x/z)."""
    g, binc = glb_read(path)
    # 1. eingeschlagene Räder sind vorn
    r = glb_scan.scan(path)
    st = r.get("steer") or []
    # glb_scan sortiert die Gruppen a* (positive Seite) vor b* (negative Seite)
    if len(st) == 4:
        pos, neg = max(abs(st[0]), abs(st[1])), max(abs(st[2]), abs(st[3]))
        if abs(pos - neg) > 4:
            return (1 if pos > neg else -1), "steered wheels"
    # 2. Lenkrad liegt vor den Sitzen (gilt auch bei Mittel-/Heckmotor)
    pts = _named_points(g, binc, r"steer|lenkrad|steering", r"seat|sitz|bench")
    if pts:
        return pts, "steering wheel"
    # 3. Außenspiegel sitzen an der A-Säule, also vor der Dachmitte
    pts = _mirror_vs_roof(g, binc)
    if pts:
        return pts, "mirrors"
    # 4. Lampen nach Namen: Scheinwerfer vorn, Rückleuchten hinten
    pts = _named_points(g, binc, r"head|front|_fl\b|_fr\b|grill|kidney|niere", r"tail|rear|brake|reverse|_rl\b|_rr\b|exhaust|auspuff")
    if pts:
        return pts, "light names"
    # sonst: im Browser über den kürzeren Überhang (Frontmotor)
    return 0, "unknown"


def _named_points(g, binc, front_re, rear_re):
    fr, rr = re.compile(front_re, re.I), re.compile(rear_re, re.I)
    mats = g.get("materials", [])
    size = None
    acc_f, acc_r = [], []
    import fx.glb_scan as gs

    def walk(i, M, label):
        nd = g["nodes"][i]
        W = gs._mat_mul(M, gs._local(nd))
        lab = label + " " + (nd.get("name") or "")
        if "mesh" in nd:
            for p in g["meshes"][nd["mesh"]]["primitives"]:
                pos = p.get("attributes", {}).get("POSITION")
                if pos is None:
                    continue
                name = lab + " " + (mats[p["material"]].get("name", "") if "material" in p else "")
                tgt = acc_f if fr.search(name) and not rr.search(name) else acc_r if rr.search(name) and not fr.search(name) else None
                if tgt is None:
                    continue
                for x, y, z in gs._positions(g, binc, pos, max(1, g["accessors"][pos]["count"] // 300)):
                    tgt.append((W[0] * x + W[1] * y + W[2] * z + W[3], W[8] * x + W[9] * y + W[10] * z + W[11]))
        for c in nd.get("children", []):
            walk(c, W, lab)
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, ident, "")
    if len(acc_f) < 5 or len(acc_r) < 5:
        return 0
    allp = acc_f + acc_r
    sx = max(p[0] for p in allp) - min(p[0] for p in allp)
    sz = max(p[1] for p in allp) - min(p[1] for p in allp)
    k = 0 if sx >= sz else 1
    mf = sum(p[k] for p in acc_f) / len(acc_f)
    mr = sum(p[k] for p in acc_r) / len(acc_r)
    if abs(mf - mr) < 0.05 * max(sx, sz):
        return 0
    return 1 if mf > mr else -1


def _all_points(g, binc, name_re=None):
    """[(x, y, z, name)] in Weltkoordinaten; name = Knoten- und Materialname."""
    import fx.glb_scan as gs
    mats, out = g.get("materials", []), []
    rx = re.compile(name_re, re.I) if name_re else None

    def walk(i, M, label):
        nd = g["nodes"][i]
        W = gs._mat_mul(M, gs._local(nd))
        lab = label + " " + (nd.get("name") or "")
        if "mesh" in nd:
            for p in g["meshes"][nd["mesh"]]["primitives"]:
                pos = p.get("attributes", {}).get("POSITION")
                if pos is None:
                    continue
                name = lab + " " + (mats[p["material"]].get("name", "") if "material" in p else "")
                if rx and not rx.search(name):
                    continue
                for x, y, z in gs._positions(g, binc, pos, max(1, g["accessors"][pos]["count"] // 400)):
                    out.append((W[0] * x + W[1] * y + W[2] * z + W[3], W[4] * x + W[5] * y + W[6] * z + W[7], W[8] * x + W[9] * y + W[10] * z + W[11]))
        for c in nd.get("children", []):
            walk(c, W, lab)
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, ident, "")
    return out


def _mirror_vs_roof(g, binc):
    """Außenspiegel (außen, nicht Innenspiegel) gegen die Mitte des Dachs."""
    allp = _all_points(g, binc)
    mir = [p for p in _all_points(g, binc, r"mirror|spiegel") ]
    if len(allp) < 50 or len(mir) < 5:
        return 0
    xs, zs, ys = [p[0] for p in allp], [p[2] for p in allp], [p[1] for p in allp]
    sx, sz, h0, h1 = max(xs) - min(xs), max(zs) - min(zs), min(ys), max(ys)
    k = 0 if sx >= sz else 2
    lat = 2 - k
    mid_lat = (max(p[lat] for p in allp) + min(p[lat] for p in allp)) / 2
    half = (max(p[lat] for p in allp) - min(p[lat] for p in allp)) / 2
    outer = [p for p in mir if abs(p[lat] - mid_lat) > half * 0.6]   # Innenspiegel liegt in der Mitte
    roof = [p for p in allp if p[1] > h0 + (h1 - h0) * 0.9]
    if len(outer) < 5 or len(roof) < 5:
        return 0
    mm = sum(p[k] for p in outer) / len(outer)
    mr = sum(p[k] for p in roof) / len(roof)
    if abs(mm - mr) < 0.04 * max(sx, sz):
        return 0
    return 1 if mm > mr else -1


def slug(name, used):
    s = re.sub(r"\|.*$", "", name).strip().lower()
    s = re.sub(r"www\.\w+\.com", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:28].strip("-") or "car"
    base, i = s, 2
    while s in used:
        s = "%s-%d" % (base[:25], i)
        i += 1
    used.add(s)
    return s


def make_race(full, race):
    """Renn-Version: Kopie des fertigen GLB mit kleinen Texturen; gibt die Dateigröße zurück."""
    shutil.copyfile(full, race)
    shrink_textures(race, RACE_TEX)
    return os.path.getsize(race)


def race_only():
    """Für jedes Auto im Server-Katalog <uid>.race.glb bauen und raceBytes eintragen."""
    os.makedirs(WORK, exist_ok=True)
    catalog = remote_json("data/car-rain/catalog.json")
    full_sum = race_sum = 0
    for e in catalog:
        uid = e["uid"]
        full, race = os.path.join(WORK, uid + ".glb"), os.path.join(WORK, uid + ".race.glb")
        subprocess.run(SCP + ["root@31.70.95.217:%s/data/car-rain/%s.glb" % (REMOTE, uid), full], check=True)
        e["raceBytes"] = make_race(full, race)
        subprocess.run(SCP + [race, "root@31.70.95.217:%s/data/car-rain/%s.race.glb" % (REMOTE, uid)], check=True)
        full_sum += e.get("bytes") or os.path.getsize(full)
        race_sum += e["raceBytes"]
        print("%-40s %6.1f MB -> %5.1f MB" % (e["name"][:40], os.path.getsize(full) / 1e6, e["raceBytes"] / 1e6), flush=True)
    path = os.path.join(WORK, "catalog.json")
    json.dump(catalog, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    subprocess.run(SCP + [path, "root@31.70.95.217:%s/data/car-rain/catalog.json" % REMOTE], check=True)
    subprocess.run(SSH + ["chown", "-R", "obskit:obskit", REMOTE + "/data/car-rain"], check=True)
    print("raceBytes gesamt: %.1f MB (bytes gesamt: %.1f MB), %d Autos" % (race_sum / 1e6, full_sum / 1e6, len(catalog)))


def main(only=None, max_tris=MAX_TRIS):
    os.makedirs(WORK, exist_ok=True)
    cands = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "cars", "candidates.json"), encoding="utf-8"))
    picks = remote_json("data/car-picks.json").get("picks", {})
    scan = remote_json("data/car-scan.json").get("scan", {})
    try:
        old = {c["uid"]: c for c in remote_json("data/car-rain/catalog.json")}
    except Exception:
        old = {}
    kept = [c for c in cands if (picks.get(c["uid"]) or {}).get("keep") or (c.get("have") and c["uid"] not in picks)]
    used, catalog = set(c.get("key") for c in old.values()), []
    subprocess.run(SSH + ["mkdir", "-p", REMOTE + "/data/car-rain"], check=True)
    for c in kept:
        uid = c["uid"]
        sc = scan.get(uid) or {}
        if "wheels" not in sc or sc.get("error"):
            print("skip (not scanned yet):", c["name"])
            if uid in old:
                catalog.append(old[uid])
            continue
        if uid in old and not (only is not None and uid in only):
            catalog.append(old[uid])
            continue
        src, dst = os.path.join(WORK, uid + ".src.glb"), os.path.join(WORK, uid + ".glb")
        subprocess.run(SCP + ["root@31.70.95.217:%s/data/car-cache/%s.glb" % (REMOTE, uid), src], check=True)
        tris = sc.get("tris") or glb_scan.scan(src)["tris"]
        ratio = min(1.0, max_tris / max(1, tris))
        cmd = ["npx", "-y", "gltfpack", "-i", src, "-o", dst, "-km", "-kn", "-noq"]
        if ratio < 1:
            cmd += ["-si", "%.4f" % ratio]
        subprocess.run(cmd, check=True, capture_output=True)
        shrink_textures(dst)
        front, why = front_sign(dst, sc)
        if uid in old and old[uid].get("front"):
            # neu gebaut: Fahrtrichtung behalten (das „Turn around“ im Car editor bezieht sich darauf)
            front, why = old[uid]["front"], old[uid].get("frontWhy", why)
        length = next((l for rx, l in LEN if re.search(rx, c["name"], re.I)), 4.5)
        info = glb_scan.scan(dst)
        entry = {"uid": uid, "key": old.get(uid, {}).get("key") or slug(c["name"], used), "name": c["name"], "brand": c["brand"],
                 "author": c["author"], "license": c["license"], "url": c["url"], "interior": bool(sc.get("interior")),
                 "wheels": sc.get("wheels"), "front": front, "frontWhy": why, "len": length, "tris": info["tris"],
                 "bytes": os.path.getsize(dst)}
        subprocess.run(SCP + [dst, "root@31.70.95.217:%s/data/car-rain/%s.glb" % (REMOTE, uid)], check=True)
        race = os.path.join(WORK, uid + ".race.glb")
        entry["raceBytes"] = make_race(dst, race)
        subprocess.run(SCP + [race, "root@31.70.95.217:%s/data/car-rain/%s.race.glb" % (REMOTE, uid)], check=True)
        catalog.append(entry)
        print("%-40s %7d tris %6.1f MB front=%+d (%s)" % (c["name"][:40], info["tris"], entry["bytes"] / 1e6, front, why), flush=True)
    path = os.path.join(WORK, "catalog.json")
    json.dump(catalog, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    subprocess.run(SCP + [path, "root@31.70.95.217:%s/data/car-rain/catalog.json" % REMOTE], check=True)
    subprocess.run(SSH + ["chown", "-R", "obskit:obskit", REMOTE + "/data/car-rain"], check=True)
    print("catalog:", len(catalog), "cars")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--race-only" in args:
        race_only()
    elif "--all" in args:
        main(ALL)
    else:
        mt = int(args[args.index("--tris") + 1]) if "--tris" in args else MAX_TRIS
        only = None
        if "--only" in args:
            rest = args[args.index("--only") + 1:]
            only = set(rest[:next((i for i, a in enumerate(rest) if a.startswith("--")), len(rest))])
        main(only, mt)
