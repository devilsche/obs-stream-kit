"""Sketchfab-Notizen (Admin): Modell-Links + Notiz, was man damit machen kann (Auto, Kulisse, Ente …).

Ablage data/sketchfab-notes.json (gitignored, global): Liste von
  {id, urls: [..], uids: [32-hex je Sketchfab-Link], note, at (ISO), done}
Neueste zuerst. Claude liest die Datei, um zu wissen, welche Modelle wofür gedacht sind.
"""
import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone

FILE = os.path.join("data", "sketchfab-notes.json")
MAX_URLS = 20
MAX_NOTE = 4000
_URL = re.compile(r"https?://[^\s<>\"']+")
_UID = re.compile(r"([0-9a-f]{32})(?:[/?#]|$)")
_lock = threading.Lock()


def parse_urls(text):
    """Alle http(s)-Links aus dem Text (Zeilen, Leerzeichen, Kommas), ohne Doppelte, höchstens MAX_URLS."""
    out = []
    for m in _URL.finditer(text or ""):
        u = m.group(0).rstrip(".,;)")
        if u not in out:
            out.append(u)
    return out[:MAX_URLS]


def uid_of(url):
    """Sketchfab-Modell-UID (32 hex am Ende des Pfads), sonst None."""
    if "sketchfab.com" not in url:
        return None
    m = _UID.search(url.split("?")[0].split("#")[0] + "/")
    return m.group(1) if m else None


def _path(root):
    return os.path.join(root, FILE)


def load(root):
    try:
        with open(_path(root), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save(root, items):
    p = _path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def add(root, urls_text, note):
    """Neuer Eintrag → (entry, None) oder (None, Fehlertext)."""
    urls = parse_urls(urls_text)
    if not urls:
        return None, "Add at least one URL."
    entry = {"id": secrets.token_hex(6), "urls": urls, "uids": [uid_of(u) for u in urls],
             "note": (note or "").strip()[:MAX_NOTE], "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "done": False}
    with _lock:
        items = load(root)
        items.insert(0, entry)
        _save(root, items)
    return entry, None


def update(root, entry_id, urls_text=None, note=None, done=None):
    """Eintrag ändern (nur übergebene Felder) → True, wenn gefunden. Leere URL-Liste lässt die alten stehen."""
    with _lock:
        items = load(root)
        for e in items:
            if e.get("id") != entry_id:
                continue
            if urls_text is not None:
                urls = parse_urls(urls_text)
                if urls:
                    e["urls"], e["uids"] = urls, [uid_of(u) for u in urls]
            if note is not None:
                e["note"] = note.strip()[:MAX_NOTE]
            if done is not None:
                e["done"] = bool(done)
            _save(root, items)
            return True
    return False


def delete(root, entry_id):
    with _lock:
        items = load(root)
        rest = [e for e in items if e.get("id") != entry_id]
        if len(rest) == len(items):
            return False
        _save(root, rest)
    return True
