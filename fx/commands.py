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

from fx import weather

MAX_KEEP = 20
MAX_NAME = 20
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


def _choice(*options):
    def conv(v):
        v = v.lower()
        return v if v in options else None
    return conv


def _int_range(lo, hi):
    def conv(v):
        try:
            f = float(v)
        except ValueError:
            return None
        if f != f:  # NaN
            return None
        return int(max(lo, min(hi, round(f))))
    return conv


def _float_range(lo, hi):
    def conv(v):
        try:
            f = float(v)
        except ValueError:
            return None
        if f != f:  # NaN
            return None
        return round(max(lo, min(hi, f)), 2)
    return conv


_NAME_DROP_RE = re.compile(r"[^\w .\-]")


def _name(v):
    """Chat-Name für eine Follower-Kugel: nur Buchstaben/Ziffern/_ .-,
    Leerraum zusammengezogen, höchstens MAX_NAME Zeichen."""
    v = _NAME_DROP_RE.sub("", v)
    v = " ".join(v.split())[:MAX_NAME].strip()
    return v or None


_PLACE_DROP_RE = re.compile(r"[^\w .,'\-]")


def _place(v):
    """Ortsname fürs Live-Wetter: Buchstaben, Ziffern, Leerzeichen, .,'-"""
    v = " ".join(_PLACE_DROP_RE.sub("", v).split())[:60].strip()
    return v or None


def _weather_wind(v):
    """auto = Wind der Lage, random = wechselt von selbst, sonst -1..1"""
    return "auto" if v.lower() == "auto" else _wind(v)


_SB_ACTION_DROP_RE = re.compile(r"[^\w .:()/\-]")
# nur Adressen im eigenen Rechner oder Heimnetz: das Overlay läuft in OBS
_SB_WS_RE = re.compile(r"^wss?://(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})"
                       r"(:\d{1,5})?/?$")


def _sb_action(v):
    """Name der Streamer.bot-Action für Weather-Ereignisse (leer = aus)."""
    v = " ".join(_SB_ACTION_DROP_RE.sub("", v).split())[:80].strip()
    return v or None


def _sb_ws(v):
    """Websocket-Adresse von Streamer.bot, nur lokal (Standard ws://127.0.0.1:8080/)."""
    v = v.strip()
    return v if _SB_WS_RE.match(v) else None


_TEST_BG_RE = re.compile(r"^https?://[A-Za-z0-9._~:/?#\[\]@!$&*+,;=%-]{1,480}$")


def _test_bg(v):
    """Bild-URL als Testhintergrund (nur Browser-Vorschau). Ohne Klammern,
    Anführungszeichen und Leerraum, damit sie sicher in url() steht."""
    v = v.strip()
    return v if _TEST_BG_RE.match(v) and "'" not in v else None


_MMDD_RE = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$")


def _mmdd(v):
    """Datum ohne Jahr (MM-DD)."""
    v = v.strip()
    return v if _MMDD_RE.match(v) else None


def _xmas_from(v):
    """Beginn der Xmas-Zeit: advent (1. Advent) oder MM-DD."""
    return "advent" if v.strip().lower() == "advent" else _mmdd(v)


def _kd_test(v):
    """Test-K/D aus dem Dashboard: Zahl oder off."""
    if v.lower() == "off":
        return "off"
    return _float_range(0, 20)(v)


EFFECTS = {
    "weather": {
        "commands": ("weather", "auto", "strike", "gust", "spectacle", "set", "reset",
                     "scrape", "warm", "frostclear", "frostreset", "leaders",
                     # Winter-Thema
                     "ornament", "gift", "mini", "build", "snowmanreset", "shovel", "shake",
                     "icicle", "snowball", "celebrate", "setup", "farewell", "xmasdone",
                     "snowboard", "clear", "follow",
                     # Herbst, Frühling, Sommer
                     "pumpkin", "rake", "jump", "sweep", "flower", "water", "weed", "bee",
                     "castle", "splash", "ice", "fries", "cool", "seasonboard",
                     # Jahreszeit früher starten bzw. zurück zum Kalender
                     "season",
                     # Blitzfeuer im Laub (meldet das Overlay) und Löschen
                     "ignite", "extinguish"),
        "settings": {
            "place": _place,
            "mood": _float_range(0, 1),
            "kdlow": _float_range(0, 20),
            "kdhigh": _float_range(0, 20),
            "kdtest": _kd_test,
            "fallback": _choice(*weather.KINDS),
            "lock": _choice("off", *weather.KINDS),
            "wind": _weather_wind,
            "veil": _flag,
            "aurorakd": _float_range(0, 20),
            "frost": _flag,
            "frostrate": _float_range(0.25, 4),
            "sound": _flag,
            "volume": _level,
            "thunder": _level,
            "ambient": _level,
            "siren": _flag,
            "sbaction": _sb_action,
            "sbws": _sb_ws,
            # Deko-Thema (Teil 3: Winter mit Xmas-Zeit)
            "theme": _choice("auto", "winter", "spring", "summer", "autumn", "none"),
            "leafrate": _float_range(0.25, 4),
            "xmasfrom": _xmas_from,
            "xmasto": _mmdd,
            "snowrate": _float_range(0.25, 4),
            "shakeneed": _int_range(1, 20),
            "shakewin": _int_range(5, 120),
            "lights": _flag,
            "tree": _flag,
            "baubles": _flag,
            "gifts": _flag,
            "snowman": _flag,
            "minis": _flag,
            "icicles": _flag,
            "cover": _flag,
            "garland": _flag,
            "branch": _flag,
            "pile": _flag,
            "leaves": _flag,
            "pumpkins": _flag,
            "meadow": _flag,
            "bugs": _flag,
            "beach": _flag,
            "umbrella": _flag,
            "testbg": _test_bg,
        },
        "args": {
            "weather": {"to": _choice(*weather.KINDS), "hold": _int_range(0, 3600), "name": _name},
            "strike": {"dist": _choice("near", "far")},
            "spectacle": {"type": _choice(*weather.SPECTACLES)},
            "scrape": {"name": _name},
            "warm": {"name": _name},
            "ornament": {"name": _name},
            "gift": {"name": _name,
                     "type": _choice("sub", "resub", "giftsub", "bits", "raid"),
                     "amount": _int_range(1, 100000)},
            "mini": {"name": _name},
            "follow": {"name": _name},
            "build": {"name": _name},
            "shovel": {"name": _name},
            "shake": {"name": _name, "force": _flag},
            "icicle": {"name": _name},
            "snowball": {"name": _name},
            "celebrate": {"name": _name},
            "xmasdone": {"step": _choice("setup", "farewell")},
            "season": {"to": _choice("next", "auto", "winter", "spring", "summer", "autumn")},
            "ignite": {"wet": _flag},
            "extinguish": {"name": _name},
            "clear": {"kind": _choice("followers", "ornaments", "gifts", "minis", "snow", "snowman",
                                      "pumpkins", "leaves", "flowers", "garden", "castles", "heat")},
            "pumpkin": {"name": _name},
            "rake": {"name": _name},
            "jump": {"name": _name},
            "flower": {"name": _name},
            "water": {"name": _name},
            "weed": {"name": _name, "force": _flag},
            "bee": {"name": _name},
            "castle": {"name": _name},
            "splash": {"name": _name},
            "ice": {"name": _name},
            "fries": {"name": _name},
        },
        "defaults": {
            "weather": {"hold": 150},
            "gift": {"type": "sub", "amount": 1},
        },
        # ohne gültigen Wert wird der Befehl abgelehnt
        "required": {
            "weather": ("to",),
        },
    },
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
        # Extra-Argumente einzelner Befehle; ungültige werden ignoriert
        "args": {
            # near/far, damit ein von Streamer.bot gespielter Donner (WAV) zum
            # Blitz passt; ohne Angabe wählt das Overlay die Entfernung zufällig
            "strike": {"dist": _choice("near", "far")},
        },
    },
    "xmas": {
        "commands": ("set", "celebrate", "ornament", "gift", "clear", "reset",
                     "snowfall", "snowstop", "snowtoggle", "shovel", "shake", "melt", "leaders"),
        "settings": {
            "lights": _choice("top", "frame", "off"),
            "pattern": _choice("steady", "twinkle", "chase", "wave"),
            "colors": _choice("classic", "warm", "theme", "icy"),
            "lightsy": _int_range(0, 400),
            "sag": _int_range(0, 160),
            "baubles": _choice("both", "left", "right", "off"),
            "blen": _float_range(0.3, 2.0),
            "bsize": _float_range(0.5, 1.6),
            "tree": _flag,
            "treepos": _choice("left", "right"),
            "treex": _int_range(0, 1500),
            "tsize": _float_range(0.5, 1.5),
            "treesnow": _flag,
            "snow": _flag,
            "ground": _flag,
            # Schnee-Regeln: % pro Minute Schneefall, % pro Schippe, Rüttler in Sekunden
            "snowrate": _int_range(1, 300),
            "shovel": _int_range(1, 50),
            "shakeneed": _int_range(1, 20),
            "shakewin": _int_range(5, 120),
        },
        "args": {
            "ornament": {"name": _name},
            "gift": {"name": _name,
                     "type": _choice("sub", "resub", "giftsub", "bits", "raid"),
                     "amount": _int_range(1, 100000)},
            "clear": {"kind": _choice("ornaments", "gifts", "snow")},
            "shovel": {"name": _name},
            "shake": {"name": _name, "force": _flag},
            # optional: Schneefall stoppt nach secs Sekunden von selbst
            "snowfall": {"secs": _int_range(5, 86400)},
        },
        # Werte, die ein Befehl immer mitbringt, auch wenn Streamer.bot sie weglässt
        "defaults": {
            "gift": {"type": "sub", "amount": 1},
        },
    },
    "autumn": {
        "commands": ("set", "celebrate", "pumpkin", "clear", "reset",
                     "leaffall", "leafstop", "leaftoggle", "rake", "jump", "gust", "sweep", "leaders"),
        "settings": {
            "garland": _flag,
            "fairy": _flag,
            "garlandy": _int_range(0, 400),
            "branch": _choice("left", "right", "off"),
            "falling": _flag,
            "density": _choice("light", "medium", "heavy"),
            "pile": _flag,
            "spread": _choice("corners", "full"),
            "pumpkins": _flag,
            "faces": _flag,
            "colors": _choice("classic", "golden", "maple", "theme"),
            # Laub-Regeln: % pro Minute Laubfall, % pro Rechenzug
            "leafrate": _int_range(1, 300),
            "rake": _int_range(1, 50),
        },
        "args": {
            "pumpkin": {"name": _name},
            "celebrate": {"name": _name},
            "clear": {"kind": _choice("pumpkins", "leaves")},
            "rake": {"name": _name},
            "jump": {"name": _name},
            # optional: Laubfall stoppt nach secs Sekunden von selbst
            "leaffall": {"secs": _int_range(5, 86400)},
        },
    },
    "winter": {
        "commands": ("set", "celebrate", "mini", "build", "snowmanreset", "clear", "reset",
                     "snowfall", "snowstop", "snowtoggle", "shovel", "shake", "scrape", "icicle",
                     "snowball", "melt", "leaders"),
        "settings": {
            "icicles": _flag,
            "frost": _flag,
            "falling": _flag,
            "density": _choice("light", "medium", "heavy"),
            "cover": _flag,
            "snowman": _flag,
            "smpos": _choice("left", "right"),
            "smx": _int_range(0, 1500),
            "minis": _flag,
            # Regeln: % pro Minute Schneefall, % pro Schippe/Kratzer, Rüttler
            "snowrate": _int_range(1, 300),
            "shovel": _int_range(1, 50),
            "scrape": _int_range(1, 50),
            "shakeneed": _int_range(1, 20),
            "shakewin": _int_range(5, 120),
        },
        "args": {
            "mini": {"name": _name},
            "build": {"name": _name},
            "celebrate": {"name": _name},
            "shovel": {"name": _name},
            "shake": {"name": _name, "force": _flag},
            "scrape": {"name": _name},
            "icicle": {"name": _name},
            "snowball": {"name": _name},
            "snowfall": {"secs": _int_range(5, 86400)},
            "clear": {"kind": _choice("minis", "snow", "snowman")},
        },
    },
    "spring": {
        "commands": ("set", "celebrate", "flower", "clear", "reset",
                     "rainfall", "rainstop", "raintoggle", "water", "weed", "bee", "leaders"),
        "settings": {
            "meadow": _flag,
            "petals": _flag,
            "bugs": _flag,
            "branch": _choice("left", "right", "off"),
            "colors": _choice("bright", "pastel", "cherry", "theme"),
            # Regeln: Austrocknen/Unkraut in % pro Minute (0 = aus), Gießen in %,
            # Regen in % pro Minute, gemeinsames Zupfen
            "dryrate": _float_range(0, 100),
            "weedrate": _float_range(0, 100),
            "waterpct": _int_range(1, 50),
            "rainrate": _int_range(1, 300),
            "pullneed": _int_range(1, 20),
            "pullwin": _int_range(5, 120),
        },
        "args": {
            "flower": {"name": _name},
            "celebrate": {"name": _name},
            "water": {"name": _name},
            "weed": {"name": _name, "force": _flag},
            "bee": {"name": _name},
            "rainfall": {"secs": _int_range(5, 86400)},
            "clear": {"kind": _choice("flowers", "garden")},
        },
    },
    "summer": {
        "commands": ("set", "celebrate", "castle", "clear", "reset",
                     "heatwave", "heatstop", "heattoggle", "splash", "cool", "ice", "leaders"),
        "settings": {
            "sun": _flag,
            "sunpos": _choice("left", "right"),
            "beach": _flag,
            "umbrella": _flag,
            "shimmer": _flag,
            "evening": _flag,
            # Regeln: % pro Minute Hitzewelle, % pro Abkühlen
            "heatrate": _int_range(1, 300),
            "splash": _int_range(1, 50),
        },
        "args": {
            "castle": {"name": _name},
            "celebrate": {"name": _name},
            "splash": {"name": _name},
            "ice": {"name": _name},
            "heatwave": {"secs": _int_range(5, 86400)},
            "clear": {"kind": _choice("castles", "heat")},
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
    else:
        for key, conv in spec.get("args", {}).get(cmd, {}).items():
            raw = args.get(key)
            if raw is None or str(raw).strip() == "":
                continue
            val = conv(str(raw).strip())
            if val is not None:
                params[key] = val
        for key, val in spec.get("defaults", {}).get(cmd, {}).items():
            params.setdefault(key, val)
        for key in spec.get("required", {}).get(cmd, ()):
            if key not in params:
                raise ValueError(f"{cmd} needs a valid '{key}'")
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
            cmds = [{"seq": c["seq"], "ts": c["ts"], "cmd": c["cmd"], "params": c["params"]}
                    for c in slot["items"] if c["seq"] > since]
    return {"epoch": EPOCH, "seq": seq, "commands": cmds}
