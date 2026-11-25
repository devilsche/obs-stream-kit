"""Aussortieren aller 3D-Modelle (Autos, Kulissen, Notizen) in der Model gallery (tools/car-gallery.html).

Bestand (nur auf dem Server, Lizenzen):
  data/car-cache/<uid>.glb        Original-Download von Sketchfab (hohe Auflösung), Quelle für alles andere
  data/car-rain/<uid>.glb (+.race) aufbereitete Autos, Katalog data/car-rain/catalog.json
  data/track-props/<uid>[-part].glb aufbereitete Kulissen, Katalog data/track-props/catalog.json
Namen kommen aus den Katalogen, den Kandidatenlisten (assets/cars, assets/track-props) und den Sketchfab-Notizen.

Entscheidung: data/model-keep.json {"keep": [uid, …]}. „Delete the rest“ verschiebt alle nicht behaltenen
Modelle nach data/model-trash/<Zeit>/ (wiederherstellbar), nimmt Autos aus Katalog und Car-Picker-Auswahl
und Kulissen aus dem Katalog (dazu in off.json, damit ein Neubau sie nicht zurückholt).
Vorschaubilder: data/model-thumbs/<uid>.webp, von der Seite einmal gerendert und hochgeladen.
"""
import glob
import json
import os
import re
import shutil
import threading
import time

from fx.sketchfab import UID_RE, base_uid  # noqa: E402  (alt 32 Hex, neu 27 Zeichen)
MAX_THUMB = 400 * 1024
GROUPS = ("car", "car-candidate", "prop", "prop-candidate", "note", "other")
_lock = threading.Lock()


def _d(root, *p):
    return os.path.join(os.path.abspath(root), "data", *p)


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def keep_set(root):
    d = _load(_d(root, "model-keep.json"), {})
    k = d.get("keep") if isinstance(d, dict) else None
    return {u for u in k if isinstance(u, str) and UID_RE.match(u)} if isinstance(k, list) else set()


def set_keep(root, uid, keep):
    if not isinstance(uid, str) or not UID_RE.match(uid):
        return False
    with _lock:
        cur = keep_set(root)
        (cur.add if keep else cur.discard)(uid)
        _save(_d(root, "model-keep.json"), {"keep": sorted(cur)})
    return True


def thumb_path(root, uid):
    return _d(root, "model-thumbs", uid + ".webp") if UID_RE.match(uid or "") else None


def save_thumb(root, uid, data):
    p = thumb_path(root, uid)
    if not p or not data or len(data) > MAX_THUMB or not data.startswith(b"RIFF"):
        return False
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "wb") as f:
        f.write(data)
    os.replace(p + ".tmp", p)
    return True


def glb_path(root, uid):
    """Höchste Auflösung zuerst: Original-Download, sonst aufbereitete Fassung."""
    if not UID_RE.match(uid or ""):
        return None
    for p in (_d(root, "car-cache", uid + ".glb"), _d(root, "car-rain", uid + ".glb"),
              _d(root, "track-props", uid + ".glb")):
        if os.path.exists(p):
            return p
    parts = sorted(glob.glob(_d(root, "track-props", uid + "-*.glb")))
    parts = [p for p in parts if not p.endswith("-lod.glb")]
    return parts[0] if parts else None


def _files(root, uid):
    out = [_d(root, "car-cache", uid + ".glb"), _d(root, "car-rain", uid + ".glb"),
           _d(root, "car-rain", uid + ".race.glb"), _d(root, "model-thumbs", uid + ".webp")]
    out += glob.glob(_d(root, "track-props", uid + ".glb")) + glob.glob(_d(root, "track-props", uid + "-*.glb"))
    return [p for p in out if os.path.exists(p)]


def inventory(root):
    """Alle Modelle, je Sketchfab-uid ein Eintrag."""
    proj = os.path.abspath(root)
    items = {}

    def put(uid, group, kw=None):
        kw = kw or {}
        if not isinstance(uid, str):
            return
        uid = base_uid(uid)
        if not uid:
            return
        it = items.setdefault(uid, {"uid": uid, "group": group, "groups": [], "name": "", "author": "",
                                    "license": "", "url": "", "inUse": False, "uses": [], "notes": []})
        if group not in it["groups"]:
            it["groups"].append(group)
        if GROUPS.index(group) < GROUPS.index(it["group"]):
            it["group"] = group
        for k in ("name", "author", "license", "url"):
            if kw.get(k) and not it[k]:
                it[k] = kw[k]

    for c in _load(_d(root, "car-rain", "catalog.json"), []):
        if isinstance(c, dict):
            put(c.get("uid"), "car", c)
            if c.get("uid") in items:
                items[c["uid"]]["inUse"] = True
                items[c["uid"]]["uses"].append("Car rain / race")
    props = (_load(_d(root, "track-props", "catalog.json"), {}) or {}).get("props") or []
    for p in props:
        if isinstance(p, dict) and isinstance(p.get("uid"), str):
            put(p["uid"], "prop", p)
            u = base_uid(p["uid"])
            if u in items:
                items[u]["inUse"] = True
                use = "Track: " + (p.get("kind") or "?") + (" · " + p["theme"] if p.get("theme") else "")
                if use not in items[u]["uses"]:
                    items[u]["uses"].append(use)
    for c in _load(os.path.join(proj, "assets", "cars", "candidates.json"), []):
        if isinstance(c, dict):
            put(c.get("uid"), "car-candidate", c)
    for c in _load(os.path.join(proj, "assets", "track-props", "candidates.json"), []):
        if isinstance(c, dict):
            put(c.get("uid"), "prop-candidate", c)
    for n in _load(_d(root, "sketchfab-notes.json"), []):
        if not isinstance(n, dict):
            continue
        for u, url in zip(n.get("uids") or [], n.get("urls") or []):
            put(u, "note", {"url": url})
            if isinstance(u, str) and u in items:
                items[u]["notes"].append((n.get("note") or "")[:120])
    for p in glob.glob(_d(root, "car-cache", "*.glb")):
        put(base_uid(os.path.basename(p)), "other")

    keep = keep_set(root)
    out = []
    for it in items.values():
        g = glb_path(root, it["uid"])
        it["have"] = bool(g)
        it["bytes"] = sum(os.path.getsize(p) for p in _files(root, it["uid"]) if p.endswith(".glb"))
        it["thumb"] = os.path.exists(thumb_path(root, it["uid"]))
        it["keep"] = it["uid"] in keep
        it["name"] = it["name"] or it["uid"][:8]
        out.append(it)
    out.sort(key=lambda i: (GROUPS.index(i["group"]), i["name"].lower()))
    return out


def purge(root, now=None):
    """Alle nicht behaltenen Modelle mit Dateien in den Papierkorb; Kataloge und Auswahl anpassen."""
    drop = [i["uid"] for i in inventory(root) if not i["keep"] and i["have"]]
    if not drop:
        return {"moved": 0, "bytes": 0, "trash": None}
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(time.time() if now is None else now))
    trash = _d(root, "model-trash", stamp)
    moved = size = 0
    with _lock:
        for uid in drop:
            for p in _files(root, uid):
                rel = os.path.relpath(p, _d(root))
                dst = os.path.join(trash, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                size += os.path.getsize(p)
                shutil.move(p, dst)
                moved += 1
        dropped = set(drop)
        cat_p = _d(root, "car-rain", "catalog.json")
        cat = _load(cat_p, None)
        if isinstance(cat, list):
            _save(cat_p, [c for c in cat if not (isinstance(c, dict) and c.get("uid") in dropped)])
        picks_p = _d(root, "car-picks.json")
        picks = _load(picks_p, None)
        if isinstance(picks, dict) and isinstance(picks.get("picks"), dict):
            for u in dropped & set(picks["picks"]):
                picks["picks"][u] = {"keep": False}
            _save(picks_p, picks)
        tp_p = _d(root, "track-props", "catalog.json")
        tp = _load(tp_p, None)
        if isinstance(tp, dict) and isinstance(tp.get("props"), list):
            gone = [p for p in tp["props"] if isinstance(p, dict) and base_uid(str(p.get("uid", ""))) in dropped]
            tp["props"] = [p for p in tp["props"] if p not in gone]
            _save(tp_p, tp)
            off_p = _d(root, "track-props", "off.json")
            off = _load(off_p, {}).get("off") or []
            _save(off_p, {"off": sorted(set(off) | {p.get("key") for p in gone if p.get("key")})})
    return {"moved": len(drop), "files": moved, "bytes": size, "trash": os.path.relpath(trash, os.path.abspath(root))}
