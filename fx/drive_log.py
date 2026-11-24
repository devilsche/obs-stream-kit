"""Kontakt-Logs für Car Drive (Analyse des Kollisionsverhaltens).

Je Rennen eine Datei data/drive-logs/<race_id>.jsonl, eine JSON-Zeile je Eintrag:
  {"srv": Server-Zeit, "uid": Absender oder "server", "d": [Ereignisse des Clients …]}   (Client, gebündelt ~1/s)
  {"srv": …, "uid": "server", "ev": {"k": "relay-bump" | "takeover" | "release", …}}      (Server)
Client-Ereignisse (js/car-drive.js clog): hit (Kontakt: eigene Lage/Tempo, Gegner wie gesehen, Stoß, Punkt, Überlappung),
bumpOut/bumpIn (Rempler gesendet/empfangen samt Entscheidung), dv (Tempo-Sprung > 3 m/s in einem Bild), gap (Bildlücke),
net (Ping/Puffer alle 2 s). Höchstens KEEP Dateien (älteste fliegen raus), je Datei höchstens MAX_BYTES.
"""
import json
import os
import re
import threading
import time

KEEP = 80
MAX_BYTES = 30 * 1024 * 1024
MAX_EVENTS = 400            # je Client-Bündel
MAX_EVENT_BYTES = 2000      # je Ereignis (JSON)
_NAME = re.compile(r"[^A-Za-z0-9_.-]")
_lock = threading.Lock()


def folder(root):
    return os.path.join(root, "data", "drive-logs")


def path_for(root, race_id):
    name = _NAME.sub("_", str(race_id or "unknown"))[:120] or "unknown"
    return os.path.join(folder(root), name + ".jsonl")


def clean_events(d):
    """Client-Bündel prüfen: Liste von Objekten, je höchstens MAX_EVENT_BYTES, höchstens MAX_EVENTS. → Liste."""
    if not isinstance(d, list):
        return []
    out = []
    for e in d[:MAX_EVENTS]:
        if not isinstance(e, dict):
            continue
        try:
            if len(json.dumps(e, separators=(",", ":"))) > MAX_EVENT_BYTES:
                continue
        except (TypeError, ValueError):
            continue
        out.append(e)
    return out


def write(root, race_id, obj, now=None):
    """Eine Zeile anhängen. Fehler (Platte voll, Rechte) werden geschluckt – Logs dürfen das Rennen nie stören."""
    if not race_id:
        return False
    obj = dict(obj)
    obj.setdefault("srv", round(now if now is not None else time.time(), 3))
    line = json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n"
    p = path_for(root, race_id)
    try:
        with _lock:
            os.makedirs(folder(root), exist_ok=True)
            new = not os.path.exists(p)
            if not new and os.path.getsize(p) > MAX_BYTES:
                return False
            with open(p, "a", encoding="utf-8") as f:
                f.write(line)
            if new:
                _prune(root)
        return True
    except OSError:
        return False


def _prune(root):
    try:
        files = sorted((os.path.join(folder(root), n) for n in os.listdir(folder(root)) if n.endswith(".jsonl")),
                       key=os.path.getmtime)
    except OSError:
        return
    for p in files[:-KEEP]:
        try:
            os.remove(p)
        except OSError:
            pass
