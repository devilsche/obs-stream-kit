"""Single Source of Truth fuer die OBS-Sources (Overlays, Alerts, Decor, Stinger)."""
import glob
import os

OVERLAYS = [
    {"key": "starting-soon",  "label": "Starting Soon",  "file": "starting-soon.html",
     "size": "1920×1080", "params": ["title", "countdown"]},
    {"key": "brb-pause",      "label": "BRB / Pause",     "file": "brb-pause.html",
     "size": "1920×1080", "params": ["count", "countdown", "clips"]},
    {"key": "stream-ending",  "label": "Stream Ending",   "file": "stream-ending.html",
     "size": "1920×1080", "params": ["title"]},
    {"key": "just-chatting",  "label": "Just Chatting",   "file": "just-chatting.html",
     "size": "1920×1080", "params": []},
    {"key": "gameplay",       "label": "Gameplay / Kamera", "file": "gameplay.html",
     "size": "400×225", "params": []},
]

# Alert-Animationen (Streamer.bot-getriggert, transparent, Vollbild).
ALERTS = [
    {"key": "follow",   "label": "New Follower", "file": "follow.html",   "size": "1920×1080", "params": []},
    {"key": "sub",      "label": "New Sub",      "file": "sub.html",      "size": "1920×1080", "params": []},
    {"key": "resub",    "label": "Resub",        "file": "resub.html",    "size": "1920×1080", "params": []},
    {"key": "giftsub",  "label": "Gift Sub",     "file": "giftsub.html",  "size": "1920×1080", "params": []},
    {"key": "bits",     "label": "Bits / Cheer", "file": "bits.html",     "size": "1920×1080", "params": []},
    {"key": "raid",     "label": "Raid",         "file": "raid.html",     "size": "1920×1080", "params": []},
    {"key": "donation", "label": "Donation",     "file": "donation.html", "size": "1920×1080", "params": []},
]

# Look & Decor — Deko-Elemente, liegen unter widgets/ (served via /widgets/).
DECOR = [
    {"key": "logo",           "label": "Logo",           "file": "logo.html",           "size": "1920×1080", "params": []},
    {"key": "webcam-frame",   "label": "Webcam Frame",   "file": "webcam-frame.html",   "size": "1920×1080", "params": []},
    {"key": "tipgoal-banner", "label": "Tip-Goal Banner", "file": "tipgoal-banner.html", "size": "1920×1080", "params": []},
]


def list_dir_sources(root: str, subdir: str, size: str = "1920×1080"):
    """Alle *.html in <root>/<subdir> als Source-Dicts (Label automatisch aus
    dem Dateinamen). Fuer dynamische Bereiche wie Stinger-Transitions, bei denen
    eine manuelle Pflege jeder einzelnen Datei unnoetiger Aufwand waere."""
    out = []
    for path in sorted(glob.glob(os.path.join(root, subdir, "*.html"))):
        fn = os.path.basename(path)
        key = fn[:-5]
        out.append({"key": key, "label": key.replace("-", " ").title(),
                    "file": fn, "size": size, "params": []})
    return out
