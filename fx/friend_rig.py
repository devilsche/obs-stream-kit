"""Eigenes Modell für den Friend-Hund (effects/friend.html), gebaut im Rig-Editor (tools/friend-rig.html).

Global, eine Datei data/friend-rig.json. Inhalt (alles optional außer version):
  skin:   Mesh am Hunde-Skelett – pos (Float32 xyz), idx (Uint32), col (Uint8 rgb, sRGB), j/w (Uint8 × 4 je Punkt:
          Knochen-Nummer in bones und Gewicht 0–255), bones (Knochennamen), inv (Float32 4×4 je Knochen) – Arrays als Base64
  joints: {Knochen: [dx, dy, dz]} lokaler Versatz der Gelenke
  poses:  {all|stand|sit|down|lie|beg|paw: {Knochen: [x, y, z, w]}} lokale Drehung je Haltung (all = immer, z. B. Rute)
  moves:  {Haltung: {Knochen: [dx, dy, dz]}} lokaler Versatz je Haltung (Becken, Rücken, Körpermitte verschieben)
  ears:   Kippohr 0–1, tailUp: Rutenwinkel (rad), tailCurl: Rute einrollen (rad je Glied ÷ 0,3)
Gibt es eine Datei, nimmt der Hund dieses Modell statt des eingebauten.
"""
import base64
import binascii
import json
import math
import os
import re
import tempfile
import threading

BONE_RE = re.compile(r"^[\w.:-]{1,80}$")
POSES = ("all", "stand", "sit", "down", "lie", "beg", "paw")
MAX_VERTS = 60000
MAX_TRIS = 120000
MAX_BONES = 255
MAX_OFFSET = 1000.0   # lokale Einheiten des Skeletts (Modell ist intern ~100-fach skaliert)

_lock = threading.Lock()


def path(root: str) -> str:
    return os.path.join(root, "data", "friend-rig.json")


def load(root: str):
    """Gespeichertes Rig oder None."""
    try:
        with open(path(root), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("version") == 1 else None


def _b64(v, item: int, mult: int = 1):
    """Base64 → Bytes, Länge Vielfaches von item*mult; sonst None."""
    if not isinstance(v, str) or len(v) > 16_000_000:
        return None
    try:
        raw = base64.b64decode(v, validate=True)
    except (binascii.Error, ValueError):
        return None
    return raw if raw and len(raw) % (item * mult) == 0 else None


def _finite_floats(raw: bytes) -> bool:
    import array
    a = array.array("f")
    a.frombytes(raw)
    return all(math.isfinite(x) for x in a)


def _num(v, lim):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) <= lim


def clean(rig):
    """Geprüftes Rig oder Fehlertext."""
    if not isinstance(rig, dict):
        return "Object expected"
    out = {"version": 1}
    sk = rig.get("skin")
    if sk is not None:
        if not isinstance(sk, dict):
            return "skin: object expected"
        bones = sk.get("bones")
        if not isinstance(bones, list) or not 1 <= len(bones) <= MAX_BONES or not all(isinstance(b, str) and BONE_RE.match(b) for b in bones):
            return "skin.bones: 1 to %d bone names expected" % MAX_BONES
        pos = _b64(sk.get("pos"), 4, 3)
        if pos is None or not _finite_floats(pos):
            return "skin.pos: Float32 xyz expected"
        n = len(pos) // 12
        if n > MAX_VERTS:
            return "skin: at most %d points" % MAX_VERTS
        idx = _b64(sk.get("idx"), 4, 3)
        if idx is None or len(idx) // 12 > MAX_TRIS:
            return "skin.idx: Uint32 triangles expected"
        import array
        ia = array.array("I")
        ia.frombytes(idx)
        if max(ia) >= n:
            return "skin.idx: index out of range"
        col = _b64(sk.get("col"), 1)
        if col is None or len(col) != n * 3:
            return "skin.col: 3 bytes per point expected"
        j = _b64(sk.get("j"), 1)
        w = _b64(sk.get("w"), 1)
        if j is None or w is None or len(j) != n * 4 or len(w) != n * 4:
            return "skin.j / skin.w: 4 bytes per point expected"
        if max(j) >= len(bones):
            return "skin.j: bone index out of range"
        inv = _b64(sk.get("inv"), 4, 16)
        if inv is None or len(inv) != len(bones) * 64 or not _finite_floats(inv):
            return "skin.inv: one 4x4 Float32 matrix per bone expected"
        out["skin"] = {k: sk[k] for k in ("pos", "idx", "col", "j", "w", "inv")}
        out["skin"]["bones"] = list(bones)
    joints = rig.get("joints") or {}
    if not isinstance(joints, dict) or len(joints) > MAX_BONES:
        return "joints: object expected"
    oj = {}
    for k, v in joints.items():
        if not BONE_RE.match(str(k)) or not isinstance(v, list) or len(v) != 3 or not all(_num(x, MAX_OFFSET) for x in v):
            return "joints.%s: [dx, dy, dz] expected" % str(k)[:40]
        oj[k] = [round(x, 6) for x in v]
    if oj:
        out["joints"] = oj
    poses = rig.get("poses") or {}
    if not isinstance(poses, dict):
        return "poses: object expected"
    op = {}
    for pk, set_ in poses.items():
        if pk not in POSES:
            return "poses: unknown pose %s" % str(pk)[:20]
        if not isinstance(set_, dict) or len(set_) > MAX_BONES:
            return "poses.%s: object expected" % pk
        s = {}
        for k, q in set_.items():
            if not BONE_RE.match(str(k)) or not isinstance(q, list) or len(q) != 4 or not all(_num(x, 1.0001) for x in q):
                return "poses.%s.%s: quaternion [x, y, z, w] expected" % (pk, str(k)[:40])
            s[k] = [round(x, 6) for x in q]
        if s:
            op[pk] = s
    if op:
        out["poses"] = op
    moves = rig.get("moves") or {}
    if not isinstance(moves, dict):
        return "moves: object expected"
    om = {}
    for pk, set_ in moves.items():
        if pk not in POSES:
            return "moves: unknown pose %s" % str(pk)[:20]
        if not isinstance(set_, dict) or len(set_) > MAX_BONES:
            return "moves.%s: object expected" % pk
        s = {}
        for k, v in set_.items():
            if not BONE_RE.match(str(k)) or not isinstance(v, list) or len(v) != 3 or not all(_num(x, MAX_OFFSET) for x in v):
                return "moves.%s.%s: [dx, dy, dz] expected" % (pk, str(k)[:40])
            s[k] = [round(x, 6) for x in v]
        if s:
            om[pk] = s
    if om:
        out["moves"] = om
    if rig.get("ears") is not None:
        if not _num(rig["ears"], 1) or rig["ears"] < 0:
            return "ears: 0 to 1 expected"
        out["ears"] = round(rig["ears"], 4)
    if rig.get("tailCurl") is not None:
        if not _num(rig["tailCurl"], 1.6):
            return "tailCurl: -1.6 to 1.6 expected"
        out["tailCurl"] = round(rig["tailCurl"], 4)
    if rig.get("tailUp") is not None:
        if not _num(rig["tailUp"], 1.6):
            return "tailUp: -1.6 to 1.6 expected"
        out["tailUp"] = round(rig["tailUp"], 4)
    return out


def save(root: str, rig):
    """Speichert das Rig; Fehlertext oder None."""
    res = clean(rig)
    if isinstance(res, str):
        return res
    p = path(root)
    with _lock:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".friend-rig-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(res, f, separators=(",", ":"))
            os.replace(tmp, p)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
    return None


def delete(root: str) -> bool:
    with _lock:
        try:
            os.unlink(path(root))
            return True
        except FileNotFoundError:
            return False
