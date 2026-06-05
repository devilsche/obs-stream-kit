"""Single Source of Truth for OBS sources (Overlays, Alerts, Decor, Stinger)."""
import glob
import os

OVERLAYS = [
    {"key": "starting-soon",  "label": "Starting Soon",  "file": "starting-soon.html",
     "size": "1920×1080", "desc": "Animated 'Starting Soon' scene.",
     "params": ["title", "countdown"]},
    {"key": "brb-pause",      "label": "BRB / Pause",     "file": "brb-pause.html",
     "size": "1920×1080", "desc": "Break scene with integrated Twitch clip player.",
     "params": ["count", "countdown", "clips"]},
    {"key": "stream-ending",  "label": "Stream Ending",   "file": "stream-ending.html",
     "size": "1920×1080", "desc": "Animated stream-ending scene.",
     "params": ["title"]},
    {"key": "just-chatting",  "label": "Just Chatting",   "file": "just-chatting.html",
     "size": "1920×1080", "desc": "Fullscreen camera scene with subtle decoration.",
     "params": []},
    {"key": "gameplay",       "label": "Gameplay / Camera", "file": "gameplay.html",
     "size": "400×225", "desc": "Camera area for the gameplay overlay (16:9).",
     "params": []},
]

_TIER = {"key": "tier", "label": "Tier", "type": "select", "default": "1000",
         "options": [["1000", "Tier 1"], ["2000", "Tier 2"], ["3000", "Tier 3"]]}

ALERTS = [
    {"key": "follow", "label": "New Follower", "file": "follow.html", "size": "1920×1080",
     "desc": "One-shot animation on new follower.", "params": [],
     "switches": [
         {"key": "username", "label": "Username", "type": "text", "default": "", "placeholder": "e.g. CoolStreamer"},
         {"key": "message",  "label": "Message",  "type": "text", "default": "", "placeholder": "Glad to be here!"},
     ]},
    {"key": "sub", "label": "New Sub", "file": "sub.html", "size": "1920×1080",
     "desc": "One-shot animation on new subscription.", "params": [],
     "switches": [
         {"key": "username", "label": "Username", "type": "text", "default": "", "placeholder": "e.g. CoolStreamer"},
         _TIER,
         {"key": "message",  "label": "Message",  "type": "text", "default": "", "placeholder": "Thanks!"},
     ]},
    {"key": "resub", "label": "Resub", "file": "resub.html", "size": "1920×1080",
     "desc": "One-shot animation on resub.", "params": [],
     "switches": [
         {"key": "username", "label": "Username", "type": "text",   "default": "", "placeholder": "e.g. CoolStreamer"},
         {"key": "months",   "label": "Months",   "type": "number", "default": "3", "min": 1},
         _TIER,
         {"key": "message",  "label": "Message",  "type": "text",   "default": "", "placeholder": "3 months already!"},
     ]},
    {"key": "giftsub", "label": "Gift Sub", "file": "giftsub.html", "size": "1920×1080",
     "desc": "One-shot animation on gift sub(s).", "params": [],
     "switches": [
         {"key": "username", "label": "Gifter", "type": "text",   "default": "", "placeholder": "e.g. CoolStreamer"},
         {"key": "amount",   "label": "Count",  "type": "number", "default": "1", "min": 1},
         {"key": "total",    "label": "Total",  "type": "number", "default": "5", "min": 1},
         _TIER,
     ]},
    {"key": "bits", "label": "Bits / Cheer", "file": "bits.html", "size": "1920×1080",
     "desc": "One-shot animation on bits / cheer.", "params": [],
     "switches": [
         {"key": "username", "label": "Username", "type": "text",   "default": "", "placeholder": "e.g. CoolStreamer"},
         {"key": "amount",   "label": "Bits",     "type": "number", "default": "100", "min": 1},
         {"key": "message",  "label": "Message",  "type": "text",   "default": "", "placeholder": "cheer100"},
     ]},
    {"key": "raid", "label": "Raid", "file": "raid.html", "size": "1920×1080",
     "desc": "One-shot animation on incoming raid.", "params": [],
     "switches": [
         {"key": "username", "label": "Raider",  "type": "text",   "default": "", "placeholder": "e.g. BigStreamer"},
         {"key": "viewers",  "label": "Viewers", "type": "number", "default": "50", "min": 1},
     ]},
    {"key": "donation", "label": "Donation", "file": "donation.html", "size": "1920×1080",
     "desc": "One-shot animation on donation.", "params": [],
     "switches": [
         {"key": "username", "label": "Username", "type": "text", "default": "", "placeholder": "e.g. CoolStreamer"},
         {"key": "name",     "label": "Name",     "type": "text", "default": "", "placeholder": "e.g. Max Mustermann"},
         {"key": "amount",   "label": "Amount",   "type": "text", "default": "5.00", "placeholder": "5.00"},
         {"key": "message",  "label": "Message",  "type": "text", "default": "", "placeholder": "Thanks for the stream!"},
     ]},
]

DECOR = [
    {"key": "logo",           "label": "Logo",            "file": "logo.html",           "size": "1920×1080",
     "desc": "Logo overlay.",                          "params": [], "switches": []},
    {"key": "webcam-frame",   "label": "Webcam Frame",    "file": "webcam-frame.html",   "size": "",
     "desc": "Decorative frame around the camera. Canvas = camera size + 100px padding on each side.", "params": [], "switches": [
         {"key": "colors", "label": "Colors", "type": "select", "default": "default",
          "options": [["default", "Default (purple/gold)"], ["theme", "Theme colors"]]},
         {"key": "width",  "label": "Width",  "type": "number", "default": "400", "min": 100},
         {"key": "height", "label": "Height", "type": "number", "default": "225", "min": 50},
     ]},
    {"key": "tipgoal-banner", "label": "Tip-Goal Banner", "file": "tipgoal-banner.html", "size": "600×180",
     "desc": "Tip goal as a slim progress banner.",    "params": [], "switches": [
         {"key": "colors",   "label": "Colors",   "type": "select", "default": "default",
          "options": [["default", "Default (purple/gold)"], ["theme", "Theme colors"]]},
         {"key": "title",    "label": "Title",    "type": "text",   "default": "Tip Goal", "placeholder": "Tip Goal"},
         {"key": "current",  "label": "Current",  "type": "text",   "default": "0",        "placeholder": "0"},
         {"key": "goal",     "label": "Goal",     "type": "text",   "default": "100",      "placeholder": "100"},
         {"key": "currency", "label": "Currency", "type": "text",   "default": "€",        "placeholder": "€"},
         {"key": "dock",     "label": "Background", "type": "select", "default": "0",
          "options": [["0", "Transparent (OBS)"], ["1", "With background (Dock)"]]},
     ]},
]


STINGER_META = {
    "heart.html": {"switches": [
        {"key": "name", "label": "Name", "type": "text",
         "default": "", "placeholder": "e.g. Darling",
         "tooltip": "Shown as the recipient name in the heart stinger"},
    ]},
    "over-9000.html": {"switches": [
        {"key": "level", "label": "Power Level", "type": "text",
         "default": "9001", "placeholder": "e.g. 9001",
         "tooltip": "Number shown on screen"},
    ]},
}

_PET_FONTS = [
    ["", "Auto (DM Sans)"], ["Pacifico", "Pacifico"], ["Dancing Script", "Dancing Script"],
    ["Great Vibes", "Great Vibes"], ["Satisfy", "Satisfy"], ["Sacramento", "Sacramento"],
    ["Lobster", "Lobster"], ["Lobster Two", "Lobster Two"], ["Caveat", "Caveat"],
    ["Kaushan Script", "Kaushan Script"], ["Courgette", "Courgette"],
    ["Yellowtail", "Yellowtail"], ["Allura", "Allura"], ["Cookie", "Cookie"],
    ["Merienda", "Merienda"],
]

EFFECT_META = {
    "lens-flare.html": {"switches": [
        {"key": "n", "label": "Variant", "type": "select", "default": "1",
         "options": [["1","1"],["2","2"],["3","3"],["4","4"],["5","5"],["6","6"],["7","7"]],
         "tooltip": "Seven different lens flare videos"},
    ]},
}

TRANSITIONS = [
    {
        "key": "pet",
        "label": "Pet",
        "file": "pet.html",
        "size": "1920×1080",
        "desc": "Personalised pet stinger — name, font, image and floating emojis.",
        "params": [],
        "chrome_preview": False,
        "switches": [
            {"key": "name",   "label": "Name",      "type": "text",   "default": "Luke", "placeholder": "e.g. Luke"},
            {"key": "colors", "label": "Colors",    "type": "select", "default": "default",
             "options": [["default", "Default (warm forest)"], ["theme", "Theme colors"]]},
            {"key": "font",   "label": "Font",      "type": "select", "default": "", "options": _PET_FONTS},
            {"key": "kicker", "label": "Nickname",  "type": "text",   "default": "✦ Heartbreaker ✦", "placeholder": "e.g. ✦ Heartbreaker ✦"},
            {"key": "img",    "label": "Image URL", "type": "text",   "default": "",
             "placeholder": "https://... or file:///C:/...",
             "tooltip": "URL to the pet image. Local: file:///C:/path/to/image.jpg"},
            {"key": "emojis", "label": "Emojis",   "type": "text",   "default": "♥,🐾",
             "placeholder": "♥,🐾,🐶", "tooltip": "Comma-separated emojis that float around the image"},
        ],
    },
    {
        "key": "stinger",
        "label": "Stinger",
        "file": "stinger.html",
        "size": "1920×1080",
        "desc": "Configurable stinger transition player.",
        "params": [],
        "chrome_preview": True,
        "switches": [
            {
                "key": "name", "label": "Name", "type": "text",
                "default": "", "placeholder": "e.g. LUCKOR_HD",
                "tooltip": "Twitch channel name (overrides server default)",
            },
            {
                "key": "font", "label": "Font", "type": "select", "default": "",
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
    """All *.html in <root>/<subdir> as source dicts (label auto-derived from filename)."""
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
