"""Single Source of Truth fuer die OBS-Sources (Overlays, Alerts, Decor, Stinger)."""
import glob
import os

OVERLAYS = [
    {"key": "starting-soon",  "label": "Starting Soon",  "file": "starting-soon.html",
     "size": "1920×1080", "desc": "Animierte „Gleich geht's los“-Szene.",
     "params": ["title", "countdown"]},
    {"key": "brb-pause",      "label": "BRB / Pause",     "file": "brb-pause.html",
     "size": "1920×1080", "desc": "Pausen-Szene mit integriertem Twitch-Clip-Player.",
     "params": ["count", "countdown", "clips"]},
    {"key": "stream-ending",  "label": "Stream Ending",   "file": "stream-ending.html",
     "size": "1920×1080", "desc": "Animierte Abschluss-Szene zum Stream-Ende.",
     "params": ["title"]},
    {"key": "just-chatting",  "label": "Just Chatting",   "file": "just-chatting.html",
     "size": "1920×1080", "desc": "Vollbild-Kamera-Szene mit dezenter Deko.",
     "params": []},
    {"key": "gameplay",       "label": "Gameplay / Kamera", "file": "gameplay.html",
     "size": "400×225", "desc": "Kamera-Bereich fürs Gameplay-Overlay (16:9).",
     "params": []},
]

# Alert-Animationen — transparent, Vollbild. Die Parameter werden beim Triggern
# (z.B. durch Streamer.bot) an die URL gehaengt, z.B. ?username=Foo&message=Bar.
_TIER = {"key": "tier", "label": "Tier", "type": "select", "default": "1000",
         "options": [["1000", "Tier 1"], ["2000", "Tier 2"], ["3000", "Tier 3"]]}

ALERTS = [
    {"key": "follow", "label": "New Follower", "file": "follow.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei neuem Follower.", "params": [],
     "switches": [
         {"key": "username", "label": "Username",  "type": "text", "default": "", "placeholder": "z.B. CoolStreamer"},
         {"key": "message",  "label": "Nachricht", "type": "text", "default": "", "placeholder": "Freue mich dabei!"},
     ]},
    {"key": "sub", "label": "New Sub", "file": "sub.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei neuem Sub.", "params": [],
     "switches": [
         {"key": "username", "label": "Username",  "type": "text", "default": "", "placeholder": "z.B. CoolStreamer"},
         _TIER,
         {"key": "message",  "label": "Nachricht", "type": "text", "default": "", "placeholder": "Danke!"},
     ]},
    {"key": "resub", "label": "Resub", "file": "resub.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei einem Resub.", "params": [],
     "switches": [
         {"key": "username", "label": "Username", "type": "text",   "default": "", "placeholder": "z.B. CoolStreamer"},
         {"key": "months",   "label": "Monate",   "type": "number", "default": "3", "min": 1},
         _TIER,
         {"key": "message",  "label": "Nachricht", "type": "text",  "default": "", "placeholder": "Schon 3 Monate!"},
     ]},
    {"key": "giftsub", "label": "Gift Sub", "file": "giftsub.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei Gift-Sub(s).", "params": [],
     "switches": [
         {"key": "username", "label": "Schenker",  "type": "text",   "default": "", "placeholder": "z.B. CoolStreamer"},
         {"key": "amount",   "label": "Anzahl",    "type": "number", "default": "1", "min": 1},
         {"key": "total",    "label": "Gesamt",    "type": "number", "default": "5", "min": 1},
         _TIER,
     ]},
    {"key": "bits", "label": "Bits / Cheer", "file": "bits.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei Bits / Cheer.", "params": [],
     "switches": [
         {"key": "username", "label": "Username",  "type": "text",   "default": "", "placeholder": "z.B. CoolStreamer"},
         {"key": "amount",   "label": "Bits",      "type": "number", "default": "100", "min": 1},
         {"key": "message",  "label": "Nachricht", "type": "text",   "default": "", "placeholder": "cheer100"},
     ]},
    {"key": "raid", "label": "Raid", "file": "raid.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei eingehendem Raid.", "params": [],
     "switches": [
         {"key": "username", "label": "Raider",   "type": "text",   "default": "", "placeholder": "z.B. BigStreamer"},
         {"key": "viewers",  "label": "Zuschauer", "type": "number", "default": "50", "min": 1},
     ]},
    {"key": "donation", "label": "Donation", "file": "donation.html", "size": "1920×1080",
     "desc": "Einmal-Animation bei einer Donation.", "params": [],
     "switches": [
         {"key": "username", "label": "Username",  "type": "text", "default": "", "placeholder": "z.B. CoolStreamer"},
         {"key": "name",     "label": "Name",      "type": "text", "default": "", "placeholder": "z.B. Max Mustermann"},
         {"key": "amount",   "label": "Betrag",    "type": "text", "default": "5.00", "placeholder": "5.00"},
         {"key": "message",  "label": "Nachricht", "type": "text", "default": "", "placeholder": "Danke für den Stream!"},
     ]},
]

# Look & Decor — Deko-Elemente, liegen unter widgets/ (served via /widgets/).
DECOR = [
    {"key": "logo",           "label": "Logo",            "file": "logo.html",           "size": "1920×1080",
     "desc": "Logo-Einblendung.",                      "params": []},
    {"key": "webcam-frame",   "label": "Webcam Frame",    "file": "webcam-frame.html",   "size": "1920×1080",
     "desc": "Dekorativer Rahmen um die Kamera.",      "params": []},
    {"key": "tipgoal-banner", "label": "Tip-Goal Banner", "file": "tipgoal-banner.html", "size": "1920×1080",
     "desc": "Tip-Ziel als schmaler Banner.",          "params": []},
]


STINGER_META = {
    "pet.html": {"switches": [
        {"key": "name",   "label": "Name",     "type": "text", "default": "Luke",
         "placeholder": "z.B. Luke"},
        {"key": "kicker", "label": "Kosename", "type": "text", "default": "✦ Herzensbrecher ✦",
         "placeholder": "z.B. ✦ Herzensbrecher ✦"},
        {"key": "img",    "label": "Bild-URL", "type": "text", "default": "",
         "placeholder": "https://... oder file:///C:/...",
         "tooltip": "URL zum Tier-Bild. Lokal: file:///C:/Pfad/zum/Bild.jpg"},
        {"key": "emojis", "label": "Emojis",   "type": "text", "default": "♥,🐾",
         "placeholder": "♥,🐾,🐶",
         "tooltip": "Komma-getrennte Emojis die um das Bild fliegen"},
    ]},
    "heart.html": {"switches": [
        {"key": "name", "label": "Name", "type": "text",
         "default": "Liebling", "placeholder": "z.B. LuCKoR_HD",
         "tooltip": "Wird als Empfänger-Name im Herz-Stinger angezeigt"},
    ]},
    "lens-flare.html": {"switches": [
        {"key": "n", "label": "Variante", "type": "select", "default": "1",
         "options": [["1","1"],["2","2"],["3","3"],["4","4"],["5","5"],["6","6"],["7","7"]],
         "tooltip": "Sieben verschiedene Lens-Flare-Videos"},
    ]},
    "over-9000.html": {"switches": [
        {"key": "level", "label": "Power Level", "type": "text",
         "default": "9001", "placeholder": "z.B. 9001",
         "tooltip": "Zahl die auf dem Bildschirm erscheint"},
    ]},
}

TRANSITIONS = [
    {
        "key": "stinger",
        "label": "Stinger",
        "file": "stinger.html",
        "size": "1920×1080",
        "desc": "Konfigurierbarer Stinger-Transition-Player.",
        "params": [],
        "chrome_preview": True,
        "switches": [
            {
                "key": "name", "label": "Name", "type": "text",
                "default": "", "placeholder": "z.B. LUCKOR_HD",
                "tooltip": "Twitch-Channel (Override des Server-Defaults)",
            },
            {
                "key": "font", "label": "Schrift", "type": "select", "default": "",
                "options": [
                    ["", "Auto"],
                    ["Orbitron", "Orbitron"],
                    ["Russo One", "Russo One"],
                    ["Black Ops One", "Black Ops One"],
                    ["Audiowide", "Audiowide"],
                    ["Teko", "Teko"],
                    ["Saira Stencil One", "Saira Stencil"],
                    ["Wallpoet", "Wallpoet"],
                    ["Bungee", "Bungee"],
                    ["Chakra Petch", "Chakra Petch"],
                    ["Oxanium", "Oxanium"],
                    ["Rajdhani", "Rajdhani"],
                    ["Syncopate", "Syncopate"],
                ],
            },
        ],
    },
]


def list_dir_sources(root: str, subdir: str, size: str = "1920×1080",
                     desc: str = "", params: list = None, switches_map: dict = None):
    """Alle *.html in <root>/<subdir> als Source-Dicts (Label automatisch aus
    dem Dateinamen). Fuer dynamische Bereiche wie Stinger-Transitions, bei denen
    eine manuelle Pflege jeder einzelnen Datei unnoetiger Aufwand waere."""
    out = []
    for path in sorted(glob.glob(os.path.join(root, subdir, "*.html"))):
        fn = os.path.basename(path)
        key = fn[:-5]
        meta = (switches_map or {}).get(fn, {})
        out.append({"key": key, "label": key.replace("-", " ").title(),
                    "file": fn, "size": size, "desc": desc,
                    "params": list(params) if params else [],
                    "switches": meta.get("switches", [])})
    return out
