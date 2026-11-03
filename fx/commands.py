"""Validierung + In-Memory-Ablage der Effect-Befehle.

Bewusst ohne DB: Befehle sind fluechtig (Blitz jetzt, Wind auf Zufall) und
nur fuer Overlays interessant, die gerade laufen. Der API-Service ist ein
einzelner Prozess, Schreiben und Pollen landen per nginx beide dort.

Nach einem Neustart beginnt `seq` wieder bei 0 — `EPOCH` wechselt dabei,
daran erkennt das Overlay den Neustart und setzt seinen Zaehler zurueck.
"""
import re
import threading
import time
from collections import deque

MAX_KEEP = 20
EPOCH = format(int(time.time() * 1000), "x")

_HEX_RE = re.compile(r"^[0-9a-f]{3}([0-9a-f]{3})?$")


def _intensity(v):
    v = v.lower()
    return v if v in ("light", "medium", "heavy", "storm") else None


def _wind(v):
    if v.lower() == "random":
        return "random"
    try:
        f = float(v)
    except ValueError:
        return None
    if f != f:  # NaN
        return None
    return max(-1.0, min(1.0, f))


def _lightning(v):
    return {"0": 0, "off": 0, "1": 1, "rare": 1, "2": 2, "frequent": 2}.get(v.lower())


def _color(v):
    hex_ = v.lstrip("#").strip().lower()
    if not _HEX_RE.match(hex_):
        return None
    if len(hex_) == 3:
        hex_ = "".join(c * 2 for c in hex_)
    return hex_


def _level(v):
    try:
        f = float(v)
    except ValueError:
        return None
    if f != f:  # NaN
        return None
    return max(0.0, min(1.0, f))


def _flag(v):
    return {"1": True, "on": True, "0": False, "off": False}.get(v.lower())


EFFECTS = {
    "rain": {
        "commands": ("strike", "gust", "set", "stop", "start", "reset"),
        "settings": {
            "intensity": _intensity,
            "wind": _wind,
            "lightning": _lightning,
            "color": _color,
            "splash": _flag,
            "sound": _flag,
            "volume": _level,
            "thunder": _level,
        },
    },
}


def parse(effect: str, args) -> dict:
    """Request-Argumente → {"cmd", "params"}. KeyError = unbekannter Effekt,
    ValueError = ungueltiger Befehl. Ungueltige Einzelwerte bei `set` werden
    ignoriert, mindestens einer muss aber gueltig sein."""
    spec = EFFECTS[effect]
    cmd = str(args.get("cmd") or "").strip().lower()
    if cmd not in spec["commands"]:
        raise ValueError(f"unknown command '{cmd}'")
    params = {}
    if cmd == "set":
        for key, conv in spec["settings"].items():
            raw = args.get(key)
            if raw is None or str(raw).strip() == "":
                continue
            val = conv(str(raw).strip())
            if val is not None:
                params[key] = val
        if not params:
            raise ValueError("set needs at least one valid setting")
    elif cmd == "strike":
        # near/far, damit ein von Streamer.bot gespielter Donner (WAV) zum
        # Blitz passt; ohne Angabe wählt das Overlay die Entfernung zufällig
        dist = str(args.get("dist") or "").strip().lower()
        if dist in ("near", "far"):
            params["dist"] = dist
    return {"cmd": cmd, "params": params}


_lock = threading.Lock()
_store = {}   # (tenant_id, effect) → {"seq": int, "items": deque}


def reset_store():
    with _lock:
        _store.clear()


def push(tenant_id: int, effect: str, command: dict) -> int:
    with _lock:
        slot = _store.setdefault((tenant_id, effect),
                                 {"seq": 0, "items": deque(maxlen=MAX_KEEP)})
        slot["seq"] += 1
        slot["items"].append({"seq": slot["seq"], "ts": time.time(), **command})
        return slot["seq"]


def poll(tenant_id: int, effect: str, since) -> dict:
    """since=None → nur aktuellen Stand melden (Overlay startet frisch und
    soll alte Befehle nicht nachspielen)."""
    with _lock:
        slot = _store.get((tenant_id, effect))
        seq = slot["seq"] if slot else 0
        if since is None or not slot:
            cmds = []
        else:
            cmds = [{"seq": c["seq"], "cmd": c["cmd"], "params": c["params"]}
                    for c in slot["items"] if c["seq"] > since]
    return {"epoch": EPOCH, "seq": seq, "commands": cmds}
