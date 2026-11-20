"""Kulissen-Modelle (Sketchfab) für die Strecken-Themen aufbereiten (lokal ausführen, braucht Node/npx für gltfpack,
Pillow und numpy). Ablauf wie scripts/build_car_rain.py:

  1. Original aus dem Server-Cache holen (data/car-cache/<uid>.glb – vorher auf dem Server mit
     fx.sketchfab.fetch(".", uid) laden; der Server hat das Sketchfab-Token)
  2. Skin-Netze fest umrechnen (bake_skins), mit gltfpack auf höchstens `tris` Dreiecke vereinfachen
     (gleiche Materialien werden zusammengefasst → wenige Zeichenaufrufe)
  3. Texturen auf höchstens `tex` Pixel verkleinern (Standard 512); Normalen-/Okklusions-/Rauheit-Texturen fallen weg
  4. normieren: ein neuer Wurzelknoten mit Drehung (Längsseite entlang x, `yaw` in 90°-Schritten dazu), Maßstab
     (Meter: `height` = Höhe oder `len` = längste Seite), Fuß auf y = 0, Mitte auf x = z = 0
  5. nach data/track-props/<uid>.glb auf den Server, dazu data/track-props/catalog.json (props + credits)
Die Modell-Dateien kommen nicht ins Repo (Lizenzen). Auswahl und Maße: assets/track-props/candidates.json
(Einträge mit "skip" werden nicht gebaut; der Grund steht dabei). Optional "slots": [...] – das Modell gilt für
mehrere Platz-Typen (z. B. Tribüne und Oberrang), ohne doppelte Datei; ebenso "themes": [...] für mehrere Themen und
"paint" (seats/warehouse/pits: einfarbige Teile bekommen im Browser Atlas-Kacheln, js/car-track-themes.js Art.paint);
alles wird auch bei ungebauten Einträgen nachgezogen. Pakete mit mehreren Modellen (z. B. Baum-Packs): je Teil ein
Eintrag mit derselben uid, eigenem "part" (Datei <uid>-<part>.glb) und keepNode/dropNode für den Teil.

Aufruf:  python3 scripts/build_track_props.py [--only <uid> …] [--inspect <uid> …]
  --inspect: nur Original vermessen (Dreiecke, Maße, Knoten-/Materialnamen, Texturgrößen), nichts hochladen;
             mit --nodes zusätzlich je Netz-Knoten Dreiecke, Material und Maße
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import build_car_rain as bcr  # noqa: E402
from fx import glb_scan  # noqa: E402

REMOTE = bcr.REMOTE
HOST = "root@31.70.95.217"
WORK = os.path.join(tempfile.gettempdir(), "track-props-build")
CANDS = os.path.join(os.path.dirname(HERE), "assets", "track-props", "candidates.json")
DEF_TRIS = 25000
DEF_TEX = 512


def world_points(g, binc):
    """Alle Punkte (numpy n×3) in Weltkoordinaten der Standardszene."""
    import numpy as np
    nodes, out = g.get("nodes", []), []

    def walk(i, M):
        nd = nodes[i]
        W = M @ np.array(glb_scan._local(nd), dtype=np.float64).reshape(4, 4)
        if "mesh" in nd:
            for p in g["meshes"][nd["mesh"]]["primitives"]:
                at = p.get("attributes", {})
                if "POSITION" not in at:
                    continue
                pos = bcr._acc(g, binc, at["POSITION"])
                hp = np.concatenate([pos, np.ones((len(pos), 1))], axis=1)
                out.append((hp @ W.T)[:, :3])
        for c in nd.get("children", []):
            walk(c, W)
    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, np.eye(4))
    return np.concatenate(out) if out else np.zeros((0, 3))


def tri_count(g):
    n = 0
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            if p.get("mode", 4) != 4:
                continue
            if "indices" in p:
                n += g["accessors"][p["indices"]]["count"] // 3
            elif "POSITION" in p.get("attributes", {}):
                n += g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    return n


def draw_calls(g):
    """Zeichenaufrufe je Platz in der Strecke, wie js/car-track-scene.js zusammenfasst: je Material eins, alle
    einfarbigen (ohne Textur, undurchsichtig, nicht leuchtend, ohne Ecken-Farbe) zusammen eins je Seitigkeit."""
    mats, plain = set(), set()
    M = g.get("materials", [])
    for nd in g.get("nodes", []):
        if "mesh" not in nd:
            continue
        for p in g["meshes"][nd["mesh"]]["primitives"]:
            i = p.get("material", -1)
            m = M[i] if 0 <= i < len(M) else {}
            pbr = m.get("pbrMetallicRoughness") or {}
            ext = m.get("extensions") or {}
            flat = (not pbr.get("baseColorTexture") and not m.get("emissiveTexture") and m.get("alphaMode", "OPAQUE") == "OPAQUE"
                    and sum(m.get("emissiveFactor") or [0, 0, 0]) <= 0.01 and "KHR_materials_pbrSpecularGlossiness" not in ext
                    and "KHR_materials_unlit" not in ext and "COLOR_0" not in p.get("attributes", {}))
            if flat:
                plain.add(bool(m.get("doubleSided")))
            else:
                mats.add(i)
    return len(mats) + len(plain)


def inspect(path):
    from PIL import Image
    g, binc = bcr.glb_read(path)
    P = world_points(g, binc)
    lo, hi = P.min(axis=0), P.max(axis=0)
    texs = []
    for im in g.get("images", []):
        if "bufferView" in im:
            bv = g["bufferViews"][im["bufferView"]]
            o = bv.get("byteOffset", 0)
            try:
                texs.append(Image.open(io.BytesIO(bytes(binc[o:o + bv["byteLength"]]))).size[0])
            except Exception:
                texs.append("?")
    print("  tris %d, draws %d, skins %d, anims %d" % (tri_count(g), draw_calls(g), len(g.get("skins", [])), len(g.get("animations", []))))
    print("  size x %.2f  y %.2f  z %.2f   (min %s)" % (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], [round(v, 2) for v in lo]))
    # robuste Maße (1..99 %) – zeigt Ausreißer/Bodenplatten
    import numpy as np
    q0, q1 = np.percentile(P, 1, axis=0), np.percentile(P, 99, axis=0)
    print("  p1-p99 x %.2f  y %.2f  z %.2f" % tuple(q1 - q0))
    print("  textures", texs)
    print("  materials", [m.get("name") for m in g.get("materials", [])][:30])
    print("  nodes", [n.get("name") for n in g.get("nodes", []) if "mesh" in n][:40])
    return g, P


def node_report(path):
    """Je Netz-Knoten: Dreiecke, Material(ien), Weltmaße – um Bodenplatten, Hintergründe, Pack-Teile zu finden."""
    import numpy as np
    g, binc = bcr.glb_read(path)
    nodes, mats = g.get("nodes", []), g.get("materials", [])

    def walk(i, M):
        nd = nodes[i]
        W = M @ np.array(glb_scan._local(nd), dtype=np.float64).reshape(4, 4)
        if "mesh" in nd:
            pts, tr, mn = [], 0, set()
            for p in g["meshes"][nd["mesh"]]["primitives"]:
                at = p.get("attributes", {})
                if "POSITION" not in at:
                    continue
                pos = bcr._acc(g, binc, at["POSITION"])
                pts.append((np.concatenate([pos, np.ones((len(pos), 1))], axis=1) @ W.T)[:, :3])
                tr += (g["accessors"][p["indices"]]["count"] if "indices" in p else len(pos)) // 3
                mn.add(mats[p["material"]].get("name", "") if "material" in p else "-")
            if pts:
                P = np.concatenate(pts)
                lo, hi = P.min(axis=0), P.max(axis=0)
                print("   #%-3d %-34s %6d tris  %-28s ext %s  min %s" % (i, (nd.get("name") or "")[:34], tr, ",".join(sorted(mn))[:28],
                      [round(float(v), 2) for v in hi - lo], [round(float(v), 2) for v in lo]))
        for ch in nd.get("children", []):
            walk(ch, W)
    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        walk(r, np.eye(4))


def strip_parts(path, c):
    """Teile entfernen: dropNode/keepNode (Regex auf Knotennamen samt Vorfahren, mit „#<Knotennummer>“), dropMat
    (Regex auf Materialnamen). Dazu fallen Normalen-, Okklusions- und Metall/Rauheit-Texturen weg (außer keepMaps):
    Kulisse steht weit weg, das spart den Großteil der Bytes; gltfpack lässt die dann unbenutzten Bilder weg."""
    g, binc = bcr.glb_read(path)
    if not c.get("keepMaps"):
        for m in g.get("materials", []):
            m.pop("normalTexture", None)
            m.pop("occlusionTexture", None)
            (m.get("pbrMetallicRoughness") or {}).pop("metallicRoughnessTexture", None)
            ((m.get("extensions") or {}).get("KHR_materials_pbrSpecularGlossiness") or {}).pop("specularGlossinessTexture", None)
    nodes, mats = g.get("nodes", []), g.get("materials", [])
    dn = re.compile(c["dropNode"], re.I) if c.get("dropNode") else None
    kn = re.compile(c["keepNode"], re.I) if c.get("keepNode") else None
    dm = re.compile(c["dropMat"], re.I) if c.get("dropMat") else None
    removed = [0]

    def walk(i, label):
        nd = nodes[i]
        lab = label + "/" + (nd.get("name") or "") + "#%d" % i
        if "mesh" in nd:
            if (dn and dn.search(lab)) or (kn and not kn.search(lab)):
                del nd["mesh"]
                removed[0] += 1
            elif dm:
                mesh = json.loads(json.dumps(g["meshes"][nd["mesh"]]))
                prims = [p for p in mesh["primitives"] if not ("material" in p and dm.search(mats[p["material"]].get("name", "")))]
                if len(prims) != len(mesh["primitives"]):
                    removed[0] += len(mesh["primitives"]) - len(prims)
                    if prims:
                        mesh["primitives"] = prims
                        g["meshes"].append(mesh)
                        nd["mesh"] = len(g["meshes"]) - 1
                    else:
                        del nd["mesh"]
        for ch in nd.get("children", []):
            walk(ch, lab)
    if dn or kn or dm:
        for r in g["scenes"][g.get("scene", 0)]["nodes"]:
            walk(r, "")
        print("  %d Teile entfernt" % removed[0])
    bcr.glb_write(path, g, binc)


def normalize(path, c):
    """Wurzelknoten mit Drehung/Maßstab/Versatz; gibt (Maße [x, y, z] in m, Drehung) zurück."""
    import numpy as np
    g, binc = bcr.glb_read(path)
    P = world_points(g, binc)
    lo, hi = P.min(axis=0), P.max(axis=0)
    ext = hi - lo
    yaw = int(c.get("yaw", 0)) % 360
    if c.get("autoYaw", True) and ext[2] > ext[0] * 1.05:   # Längsseite entlang x
        yaw = (yaw + 90) % 360
    a = np.radians(yaw)
    R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Q = P @ R.T
    lo, hi = Q.min(axis=0), Q.max(axis=0)
    if c.get("faceLow"):
        # Tribüne: die niedrige Seite (vorderste Reihe) nach −z, zur Strecke; die hohe Rückseite nach +z
        mid = (lo[2] + hi[2]) / 2
        front, back = Q[Q[:, 2] < mid][:, 1], Q[Q[:, 2] >= mid][:, 1]
        if len(front) and len(back) and front.mean() > back.mean():
            yaw = (yaw + 180) % 360
            a = np.radians(yaw)
            R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
            Q = P @ R.T
            lo, hi = Q.min(axis=0), Q.max(axis=0)
    ext = hi - lo
    if c.get("height"):
        s = c["height"] / ext[1]
    else:
        s = c.get("len", 10) / max(ext[0], ext[2])
    ctr = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    M = np.eye(4)
    M[:3, :3] = R * s
    M[:3, 3] = -ctr * s
    sc = g["scenes"][g.get("scene", 0)]
    g.setdefault("nodes", []).append({"name": "TrackPropRoot", "matrix": [float(v) for v in M.T.reshape(-1)], "children": list(sc["nodes"])})
    sc["nodes"] = [len(g["nodes"]) - 1]
    g.pop("animations", None)   # Kulisse steht still
    if c.get("cutout", c.get("kind") in ("tree", "palm")):
        # Blätter: halbtransparent (BLEND) → Ausstanzen (MASK, alphaTest) – BLEND wird bei Hunderten Instanzen nicht
        # sortiert (Blätter verschwinden/flackern), MASK schreibt Tiefe und braucht keine Sortierung
        for m in g.get("materials", []):
            if m.get("alphaMode") == "BLEND":
                m["alphaMode"] = "MASK"
                m.setdefault("alphaCutoff", 0.5)
    bcr.glb_write(path, g, binc)
    return [round(float(v * s), 2) for v in ext], yaw


def fetch_src(uid):
    src = os.path.join(WORK, uid + ".src.glb")
    if not os.path.exists(src):
        subprocess.run(bcr.SCP + ["%s:%s/data/car-cache/%s.glb" % (HOST, REMOTE, uid), src], check=True)
    return src


def file_id(c):
    """Datei-/Katalog-id: Sketchfab-uid, bei Paket-Teilen (\"part\") mit Anhang: <uid>-<part>."""
    return c["uid"] + ("-" + c["part"] if c.get("part") else "")


def build_one(c):
    uid, fid = c["uid"], file_id(c)
    src = fetch_src(uid)
    baked = os.path.join(WORK, fid + ".baked.glb")
    if bcr.bake_skins(src, baked):
        src = baked
    cut = os.path.join(WORK, fid + ".cut.glb")
    with open(src, "rb") as f_in, open(cut, "wb") as f_out:
        f_out.write(f_in.read())
    strip_parts(cut, c)
    src = cut
    # Budget auf das beziehen, was nach dem Entfernen noch gezeichnet wird (nur Netze, die ein Knoten nutzt)
    g, _ = bcr.glb_read(src)
    tris0 = tri_count({"meshes": [g["meshes"][nd["mesh"]] for nd in g.get("nodes", []) if "mesh" in nd],
                       "accessors": g.get("accessors", [])})
    dst = os.path.join(WORK, fid + ".glb")
    budget = c.get("tris", DEF_TRIS)
    cmd = ["npx", "-y", "gltfpack", "-i", src, "-o", dst, "-noq"]
    if tris0 > budget:
        cmd += ["-si", "%.4f" % (budget / tris0)]
        if c.get("aggressive"):
            cmd += ["-sa"]
    subprocess.run(cmd, check=True, capture_output=True)
    bcr.shrink_textures(dst, c.get("tex", DEF_TEX))
    size, yaw = normalize(dst, c)
    g, _ = bcr.glb_read(dst)
    e = {"uid": fid, "key": c["key"], "kind": c["kind"], "slot": c.get("slot") or c["kind"], "sink": c.get("sink", 0),
         "theme": c["theme"], "name": c["name"],
         "author": c["author"], "license": c["license"], "url": c["url"], "size": size, "yaw": yaw,
         "tris": tri_count(g), "draws": draw_calls(g), "bytes": os.path.getsize(dst)}
    for f in ("slots", "themes", "paint"):
        if c.get(f):
            e[f] = c[f]
    return dst, e


def main(only=None):
    os.makedirs(WORK, exist_ok=True)
    cands = json.load(open(CANDS, encoding="utf-8"))
    try:
        old = {p["uid"]: p for p in (bcr.remote_json("data/track-props/catalog.json") or {}).get("props", [])}
    except Exception:
        old = {}
    subprocess.run(bcr.SSH + ["mkdir", "-p", REMOTE + "/data/track-props"], check=True)
    props = []
    for c in cands:
        uid = file_id(c)
        want = only and (uid in only or c["uid"] in only)   # --only <uid> baut alle Teile eines Pakets
        if c.get("skip"):
            print("skip %-40s %s" % (c["name"][:40], c["skip"]))
            continue
        if uid in old and not want:
            e = dict(old[uid])   # ungebaut übernehmen; Platz-Typen/Themen/Bemalung (slots, themes, paint) aus candidates.json nachziehen
            for f in ("slots", "themes", "paint"):
                e.pop(f, None)
                if c.get(f):
                    e[f] = c[f]
            props.append(e)
            continue
        if only and not want:
            continue
        try:
            dst, e = build_one(c)
        except Exception as ex:   # einzelnes Modell kaputt → weiter mit den anderen
            print("FAIL %-40s %s" % (c["name"][:40], ex))
            continue
        subprocess.run(bcr.SCP + [dst, "%s:%s/data/track-props/%s.glb" % (HOST, REMOTE, uid)], check=True)
        props.append(e)
        print("%-40s %-10s %6d tris %3d draws %5.2f MB  %s m" % (c["name"][:40], c["kind"], e["tris"], e["draws"], e["bytes"] / 1e6, e["size"]), flush=True)
    order = {file_id(c): i for i, c in enumerate(cands)}
    props.sort(key=lambda p: order.get(p["uid"], 999))
    credits, seen = [], set()   # Paket-Teile: eine Quellenangabe je Sketchfab-Modell
    for p in props:
        if p["url"] in seen:
            continue
        seen.add(p["url"])
        credits.append({"name": p["name"], "author": p["author"], "license": p["license"], "url": p["url"], "kind": p["kind"], "theme": p["theme"]})
    path = os.path.join(WORK, "catalog.json")
    json.dump({"props": props, "credits": credits}, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    subprocess.run(bcr.SCP + [path, "%s:%s/data/track-props/catalog.json" % (HOST, REMOTE)], check=True)
    subprocess.run(bcr.SSH + ["chown", "-R", "obskit:obskit", REMOTE + "/data/track-props"], check=True)
    print("catalog:", len(props), "props")


def _arg_list(args, flag):
    rest = args[args.index(flag) + 1:]
    return set(rest[:next((i for i, a in enumerate(rest) if a.startswith("--")), len(rest))])


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--inspect" in args:
        os.makedirs(WORK, exist_ok=True)
        names = {c["uid"]: c["name"] for c in json.load(open(CANDS, encoding="utf-8"))} if os.path.exists(CANDS) else {}
        for uid in _arg_list(args, "--inspect"):
            print(uid, names.get(uid, ""))
            try:
                inspect(fetch_src(uid))
                if "--nodes" in args:
                    node_report(fetch_src(uid))
            except Exception as ex:
                print("  ERROR", ex)
    else:
        main(_arg_list(args, "--only") if "--only" in args else None)
