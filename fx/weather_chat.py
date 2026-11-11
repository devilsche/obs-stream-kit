"""Chat-Anbindung der Weather-Source für Streamer.bot: Wetter gegen Bits oder
Spende, Raid-Begrüßung und fertige Sätze für Chat-Antworten (!weather,
Erinnerungen, Fortschritt des Sub-Projekts).

Bezahlt wird in „Punkten“: 1 Bit = 1, 1 € (bzw. 1 Einheit der Spendenwährung)
= 100. Steht ein bekannter Befehl in der Nachricht (z. B. „cheer500 !tornado“),
gilt genau der, sonst wählt der Betrag zufällig aus der höchsten erreichten
Stufe. Die Sätze sind deutsch, sie gehen in den Chat des Streamers.
"""
import random
import re

# Preis je Stufe in Punkten (Bits; Spenden ×100)
PRICE = {"weather": 100, "small": 200, "big": 500}

# Chat-Befehl → (Befehl an die Source, Stufe, Name im Chat)
OFFERS = {
    "thunderstorm": ({"cmd": "weather", "params": {"to": "storm"}}, "weather", "ein Gewitter"),
    "blizzard": ({"cmd": "weather", "params": {"to": "blizzard"}}, "weather", "einen Schneesturm"),
    "rain": ({"cmd": "weather", "params": {"to": "rain"}}, "weather", "Regen"),
    "snow": ({"cmd": "weather", "params": {"to": "snow"}}, "weather", "Schnee"),
    "fog": ({"cmd": "weather", "params": {"to": "fog"}}, "weather", "Nebel"),
    "heatwave": ({"cmd": "weather", "params": {"to": "heat"}}, "weather", "eine Hitzewelle"),
    "night": ({"cmd": "weather", "params": {"to": "night"}}, "weather", "eine Sternennacht"),
    "rainbow": ({"cmd": "spectacle", "params": {"type": "rainbow"}}, "small", "einen Regenbogen"),
    "aurora": ({"cmd": "spectacle", "params": {"type": "aurora"}}, "small", "Polarlicht"),
    "meteors": ({"cmd": "spectacle", "params": {"type": "meteors"}}, "small", "Sternschnuppen"),
    "hail": ({"cmd": "spectacle", "params": {"type": "hail"}}, "small", "Hagel"),
    "fogwall": ({"cmd": "spectacle", "params": {"type": "fogwall"}}, "small", "eine Nebelwand"),
    "ballbolt": ({"cmd": "spectacle", "params": {"type": "ballbolt"}}, "small", "einen Kugelblitz"),
    "tornado": ({"cmd": "spectacle", "params": {"type": "tornado"}}, "big", "einen Tornado"),
    "megabolt": ({"cmd": "spectacle", "params": {"type": "megabolt"}}, "big", "ein Unwetter"),
    "tsunami": ({"cmd": "spectacle", "params": {"type": "tsunami"}}, "big", "einen Tsunami"),
    "avalanche": ({"cmd": "spectacle", "params": {"type": "avalanche"}}, "big", "eine Lawine"),
}
TIER_ORDER = ("big", "small", "weather")
_CMD_RE = re.compile(r"!([a-z]+)")

# Raid-Begrüßung: ab so vielen Zuschauern ein freundliches, ab RAID_BIG ein großes Spektakel
RAID_MIN, RAID_BIG = 20, 50
RAID_FRIENDLY = ("meteors", "rainbow", "aurora")


def points(kind: str, amount) -> int:
    """Betrag → Punkte; unbekannte Art oder kaputter Betrag = 0."""
    try:
        a = float(str(amount).replace(",", "."))
    except (TypeError, ValueError):
        return 0
    if a <= 0:
        return 0
    if kind == "bits":
        return int(a)
    if kind == "money":
        return int(round(a * 100))
    return 0


def price_text(tier: str) -> str:
    p = PRICE[tier]
    return f"{p} Bits oder {p // 100} €"


def paid(kind: str, amount, msg: str = "", name: str = "", rnd=random) -> dict:
    """→ {"command": dict|None, "offer": str|None, "say": str}."""
    pts = points(kind, amount)
    who = name.strip() or "Jemand"
    m = _CMD_RE.search((msg or "").lower())
    wanted = m.group(1) if m and m.group(1) in OFFERS else None
    if wanted:
        command, tier, label = OFFERS[wanted]
        if pts >= PRICE[tier]:
            return {"command": command, "offer": wanted, "say": f"Danke {who}! Du hast {label} bestellt."}
        return {"command": None, "offer": wanted,
                "say": f"Danke {who}! Für !{wanted} braucht es {price_text(tier)}."}
    for tier in TIER_ORDER:
        if pts >= PRICE[tier]:
            choice = rnd.choice(sorted(k for k, v in OFFERS.items() if v[1] == tier))
            command, _, label = OFFERS[choice]
            return {"command": command, "offer": choice, "say": f"Danke {who}! Dafür gibt es {label}."}
    return {"command": None, "offer": None, "say": ""}


def raid(viewers, name: str = "", rnd=random) -> dict:
    try:
        n = int(float(viewers))
    except (TypeError, ValueError):
        n = 0
    who = name.strip() or "dem Raid"
    if n >= RAID_BIG:
        return {"command": OFFERS["megabolt"][0], "offer": "megabolt",
                "say": f"Was für ein Raid von {who}! Da zieht ein Unwetter auf."}
    if n >= RAID_MIN:
        choice = rnd.choice(RAID_FRIENDLY)
        command, _, label = OFFERS[choice]
        return {"command": command, "offer": choice, "say": f"Willkommen, Raid von {who}! Zur Begrüßung gibt es {label}."}
    return {"command": None, "offer": None, "say": ""}


# ── Sätze für den Chat ──

PROJECT = {"winter": ("Schneemann", "zum fertigen Schneemann"),
           "autumn": ("Vogelscheuche", "zur fertigen Vogelscheuche"),
           "spring": ("Sonnenblume", "zur fertigen Sonnenblume"),
           "summer": ("Sandpalast", "zum fertigen Sandpalast")}
PROJECT_PARTS = 8


def project_say(theme: str, stage: int, name: str = "", completed: bool = False) -> str:
    noun, until = PROJECT.get(theme, PROJECT["autumn"])
    left = max(0, PROJECT_PARTS - stage)
    who = f"Danke {name.strip()}! " if name and name.strip() else ""
    if completed:
        return f"{who}{'Der' if noun in ('Schneemann', 'Sandpalast') else 'Die'} {noun} ist fertig! Danke an alle Subs!"
    if left == 0:
        return f"{who}{'Der' if noun in ('Schneemann', 'Sandpalast') else 'Die'} {noun} ist schon fertig."
    return f"{who}Noch {left} {'Sub' if left == 1 else 'Subs'} bis {until}."


KIND_SAY = {"clear": "klar", "cloudy": "bewölkt", "fog": "neblig", "drizzle": "Nieselregen",
            "rain": "Regen", "storm": "Gewitter", "sleet": "Schneeregen", "snow": "Schnee",
            "blizzard": "Schneesturm", "heat": "Hitze", "night": "Sternennacht",
            "dawn": "Morgendämmerung", "dusk": "Abenddämmerung"}
LEVEL_SAY = {"autumn": ("leaves", "der Laubhaufen liegt {v} % hoch"),
             "spring": ("water", "der Garten ist zu {v} % gegossen"),
             "summer": ("heat", "der Strand ist {v} % heiß")}


def weather_say(state: dict, place: str = "") -> str:
    """place: Ortsname aus der Overlay-URL („Berlin, Land Berlin, DE“ → „Berlin“)."""
    town = (place or "").split(",")[0].strip()
    kind = state.get("kind") or "clear"
    temp = f"{round(state['temp'])} °C" if isinstance(state.get("temp"), (int, float)) else ""
    look = KIND_SAY.get(kind, kind)
    if state.get("source") == "override":
        live = f"Live aus {town}: {temp}. " if town and temp else ""
        text = f"{live}Im Bild gerade: {look} (vom Chat bestellt)"
    elif town:
        text = f"Live aus {town}: " + ", ".join(x for x in (look, temp) if x)
    else:
        text = "Wetter gerade: " + ", ".join(x for x in (look, temp) if x)
    theme = state.get("theme")
    lv = state.get("seasonLevels") or {}
    # Stand nur nennen, wenn etwas da ist (0 % Schnee klingt seltsam)
    if theme in LEVEL_SAY and isinstance(lv.get(LEVEL_SAY[theme][0]), (int, float)) and lv[LEVEL_SAY[theme][0]] >= 1:
        text += ", " + LEVEL_SAY[theme][1].format(v=round(lv[LEVEL_SAY[theme][0]]))
    elif theme == "winter" and isinstance(state.get("snowCover"), (int, float)) and state["snowCover"] >= 1:
        text += f", die Schneedecke liegt {round(state['snowCover'])} % hoch"
    return text + "."


TOP_SAY = {"autumn": "Top-Laubrecher", "spring": "Top-Gärtner", "summer": "Top-Abkühler", "winter": "Top-Schneeschipper"}


def top_say(theme: str, top: list) -> str:
    if not top:
        return ""
    name, n = top[0][0], top[0][1]
    return f"{TOP_SAY.get(theme, 'Spitzenreiter')}: {name} mit {n}×. Wer holt sich Platz 1?"


TIPS = {"autumn": ("!rake", "!jump", "!extinguish"),
        "spring": ("!water", "!weed", "!bee"),
        "summer": ("!splash", "!ice", "!fries"),
        "winter": ("!shovel", "!shake", "!snowball", "!icicle")}


def tip_say(theme: str, rnd=random) -> str:
    cmd = rnd.choice(TIPS.get(theme, TIPS["autumn"]))
    return f"Probiert mal {cmd}! Alle Befehle zeigt !commands."


# Kostenlose Befehle je Thema (nur was gerade wirkt); Frost nur, wenn welcher da ist
SEASON_CMDS = {"autumn": ("!rake", "!jump", "!extinguish"),
               "spring": ("!water", "!weed", "!bee"),
               "summer": ("!splash", "!ice", "!fries"),
               "winter": ("!shovel", "!shake", "!icicle", "!snowball")}
FROST_MIN = 5


def commands_say(theme: str, frost: float = 0) -> str:
    cmds = ["!weather"] + list(SEASON_CMDS.get(theme, ()))
    boards = ["!snowboard" if theme == "winter" else "!board"]
    if frost >= FROST_MIN:
        cmds += ["!scrape", "!warm"]
        boards.append("!frostboard")
    return "Mitmachen kann jeder: " + " ".join(cmds) + " – Bestenliste: " + " ".join(boards)
