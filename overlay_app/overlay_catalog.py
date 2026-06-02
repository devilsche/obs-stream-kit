"""Single Source of Truth fuer die Produktions-Overlays."""

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
