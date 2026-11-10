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
            return {"command": command, "offer": wanted, "say": f"Danke dir, {who}! Gleich gibt es {label}."}
        return {"command": None, "offer": wanted,
                "say": f"Danke dir, {who}! (!{wanted} gibt es ab {price_text(tier)}.)"}
    for tier in TIER_ORDER:
        if pts >= PRICE[tier]:
            choice = rnd.choice(sorted(k for k, v in OFFERS.items() if v[1] == tier))
            command, _, label = OFFERS[choice]
            return {"command": command, "offer": choice, "say": f"Danke dir, {who}! Zum Dank gibt es {label}."}
    return {"command": None, "offer": None, "say": ""}


def raid(viewers, name: str = "", rnd=random) -> dict:
    try:
        n = int(float(viewers))
    except (TypeError, ValueError):
        n = 0
    who = name.strip() or "dem Raid"
    if n >= RAID_BIG:
        return {"command": OFFERS["megabolt"][0], "offer": "megabolt",
                "say": f"Willkommen, Raid von {who}! So viele auf einmal, da zieht glatt ein Unwetter auf."}
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
    """Fortschritt freundlich melden, ohne zum Abonnieren zu drängen."""
    noun, _ = PROJECT.get(theme, PROJECT["autumn"])
    art = "Der" if noun in ("Schneemann", "Sandpalast") else "Die"
    who = f"Danke dir, {name.strip()}! " if name and name.strip() else ""
    if completed:
        return f"{who}{art} {noun} ist fertig, danke an alle, die mitgebaut haben!"
    if stage >= PROJECT_PARTS:
        return f"{who}{art} {noun} steht schon komplett."
    if stage <= 0:
        return f"{art} {noun} wartet noch auf das erste Teil."
    return f"{who}{art} {noun} wächst: {stage} von {PROJECT_PARTS} Teilen."


KIND_SAY = {"clear": "klar", "cloudy": "bewölkt", "fog": "neblig", "drizzle": "Nieselregen",
            "rain": "Regen", "storm": "Gewitter", "sleet": "Schneeregen", "snow": "Schnee",
            "blizzard": "Schneesturm", "heat": "Hitze", "night": "Sternennacht",
            "dawn": "Morgendämmerung", "dusk": "Abenddämmerung"}
LEVEL_SAY = {"autumn": ("leaves", "der Laubhaufen liegt {v} % hoch"),
             "spring": ("water", "der Garten ist zu {v} % gegossen"),
             "summer": ("heat", "der Strand ist {v} % heiß")}


def weather_say(state: dict) -> str:
    kind = state.get("kind") or "clear"
    parts = [KIND_SAY.get(kind, kind)]
    if isinstance(state.get("temp"), (int, float)):
        parts.append(f"{round(state['temp'])} °C")
    text = "Wetter gerade: " + ", ".join(parts)
    if state.get("source") == "override":
        text += " (vom Chat bestellt)"
    theme = state.get("theme")
    lv = state.get("seasonLevels") or {}
    if theme in LEVEL_SAY and isinstance(lv.get(LEVEL_SAY[theme][0]), (int, float)):
        text += ", " + LEVEL_SAY[theme][1].format(v=round(lv[LEVEL_SAY[theme][0]]))
    elif theme == "winter" and isinstance(state.get("snowCover"), (int, float)):
        text += f", die Schneedecke liegt {round(state['snowCover'])} % hoch"
    return text + "."


TOP_SAY = {"autumn": "Top-Laubrecher", "spring": "Top-Gärtner", "summer": "Top-Abkühler", "winter": "Top-Schneeschipper"}


def top_say(theme: str, top: list) -> str:
    if not top:
        return ""
    name, n = top[0][0], top[0][1]
    return f"{TOP_SAY.get(theme, 'Spitzenreiter')} bisher: {name} ({n}×)."


TIPS = {"autumn": ("!rake", "!jump", "!extinguish"),
        "spring": ("!water", "!weed", "!bee"),
        "summer": ("!splash", "!ice", "!fries"),
        "winter": ("!shovel", "!shake", "!snowball", "!icicle")}


def tip_say(theme: str, rnd=random) -> str:
    cmd = rnd.choice(TIPS.get(theme, TIPS["autumn"]))
    return f"Kleiner Tipp: Mit {cmd} könnt ihr bei der Deko mitmachen. Alle Befehle zeigt !commands."
