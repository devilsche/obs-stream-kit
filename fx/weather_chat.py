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
    "day": ({"cmd": "weather", "params": {"to": "day"}}, "weather", "hellen Tag"),
    "dawn": ({"cmd": "weather", "params": {"to": "dawn"}}, "weather", "eine Morgendämmerung"),
    "dusk": ({"cmd": "weather", "params": {"to": "dusk"}}, "weather", "eine Abenddämmerung"),
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

VISIBLE = 12    # so viele neueste Follower stehen je Thema im Bild


def whereami_say(name: str, pos) -> str:
    """Antwort auf !whereiam; leer, wenn die Figur im Bild ist (dann hüpft sie)."""
    who = f"@{name} " if name else ""
    if pos is None:
        return f"{who}Dich gibt es hier noch nicht. Mit einem Follow bekommst du deinen Platz in der Deko."
    if pos >= VISIBLE:
        return f"{who}Du stehst gerade nicht im Bild, zu sehen sind die neuesten {VISIBLE} Follower."
    return ""

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


KIND_SAY = {"clear": "klar", "cloudy": "bewölkt", "fog": "Nebel", "drizzle": "Nieselregen",
            "rain": "Regen", "storm": "Gewitter", "sleet": "Schneeregen", "snow": "Schnee",
            "blizzard": "Schneesturm", "heat": "Hitze", "night": "Sternennacht", "day": "klar",
            "dawn": "Morgendämmerung", "dusk": "Abenddämmerung"}
LEVEL_SAY = {"autumn": ("leaves", "der Laubhaufen liegt {v} % hoch"),
             "spring": ("water", "der Garten ist zu {v} % gegossen"),
             "summer": ("heat", "der Strand ist {v} % heiß")}


THEME_SAY = {"winter": "Winter", "autumn": "Herbst", "spring": "Frühling", "summer": "Sommer"}


TOD_SAY = {"day": "Tag", "night": "Nacht", "dawn": "Morgendämmerung", "dusk": "Abenddämmerung"}


def _ordered(order, now) -> str:
    """„bestellt von Tim, noch 2 min“; ohne Namen „vom Chat bestellt“."""
    who = f"bestellt von {order['by']}" if order and order.get("by") else "vom Chat bestellt"
    until = (order or {}).get("until")
    if until and now is not None:
        mins = max(1, round((until - now) / 60))
        return f"{who}, noch {mins} min"
    return who


def weather_say(state: dict, place: str = "", orders: dict = None, now: float = None) -> str:
    """Wetter am Ort und was im Stream zu sehen ist. „Live aus …“ nur bei echtem
    Wetter (source api); bestelltes Wetter und bestellte Tageszeit mit Besteller
    und Restzeit (orders aus dem Server: {"weather"|"tod": {kind, by, until}}).
    place: Ortsname aus der Overlay-URL („Berlin, Land Berlin, DE“ → „Berlin“)."""
    orders = orders or {}
    town = (place or "").split(",")[0].strip()
    kind = state.get("kind") or "clear"
    temp = f"{round(state['temp'])} °C" if isinstance(state.get("temp"), (int, float)) else ""
    look = KIND_SAY.get(kind, kind)
    if state.get("mix") in KIND_SAY:
        look += " und " + KIND_SAY[state["mix"]]
    source = state.get("source")
    live = bool(town) and (source == "api" or (source == "override" and temp))
    weather_ordered = source == "override" and ("weather" in orders or "tod" not in orders)
    if weather_ordered:
        head = f"Live aus {town}: {temp}. " if live else ""
        text = f"{head}Im Bild gerade: {look} ({_ordered(orders.get('weather'), now)})."
    elif live:
        text = f"Live aus {town}: " + ", ".join(x for x in (look, temp) if x) + "."
    elif source == "lock":
        text = f"Wetter im Stream: {look} (fest eingestellt)."
    else:
        text = "Wetter im Stream: " + ", ".join(x for x in (look, temp) if x) + "."
    tod = orders.get("tod")
    if tod and tod.get("kind") in TOD_SAY:
        text += f" Tageszeit: {TOD_SAY[tod['kind']]} ({_ordered(tod, now)})."
    theme = state.get("theme")
    if theme in THEME_SAY:
        season = "Weihnachtszeit" if state.get("xmas") not in (None, "off") else THEME_SAY[theme]
        part = f" Im Stream ist {season}"
        lv = state.get("seasonLevels") or {}
        # Stand nur nennen, wenn etwas da ist (0 % Schnee klingt seltsam)
        if theme in LEVEL_SAY and isinstance(lv.get(LEVEL_SAY[theme][0]), (int, float)) and lv[LEVEL_SAY[theme][0]] >= 1:
            part += ", " + LEVEL_SAY[theme][1].format(v=round(lv[LEVEL_SAY[theme][0]]))
        elif theme == "winter" and isinstance(state.get("snowCover"), (int, float)) and state["snowCover"] >= 1:
            part += f", die Schneedecke liegt {round(state['snowCover'])} % hoch"
        text += part + "."
    return text


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


# Kostenlose Befehle je Thema (nur was gerade wirkt), je zwei Sprüche zum Abwechseln;
# Frost nur, wenn welcher auf der Scheibe ist
SEASON_SAY = {
    "summer": ("Sommer am Strand! Abkühlen mit !splash, Eis in den Sand stecken mit !ice, und wer !fries bestellt, "
               "sollte die Möwen im Auge behalten.",
               "Hochsommer! Gegen die Hitze hilft !splash, gegen den Hunger !ice oder !fries. Die Möwen kennen beide Rezepte."),
    "autumn": ("Herbst! Laub zusammenrechen mit !rake, Anlauf nehmen und reinspringen mit !jump. "
               "Und wenn der Blitz einschlägt: !extinguish.",
               "Blätterwetter! Wer ordentlich ist, nimmt !rake, wer Spaß will, nimmt !jump. "
               "Brennt der Haufen, hilft nur noch !extinguish."),
    "spring": ("Frühling! Die Blumen haben Durst (!water), das Unkraut hat Pläne (!weed, zu dritt geht's schneller), "
               "und die Bienen warten auf ihren Einsatz (!bee).",
               "Gartensaison! Gießen mit !water, Unkraut zupfen mit !weed, Bienen losschicken mit !bee."),
    "winter": ("Winter! Schnee schippen mit !shovel, gemeinsam abschütteln mit !shake, Eiszapfen abbrechen mit !icicle, "
               "und für alles andere gibt es !snowball.",
               "Schneegestöber! Wer friert, schippt mit !shovel, wer Unfug im Kopf hat, wirft mit !snowball. "
               "Zu fünft geht !shake, einzeln geht !icicle."),
}
FROST_MIN = 5
_season_turn = [0]


def commands_say(theme: str, frost: float = 0) -> str:
    lines = SEASON_SAY.get(theme)
    if not lines:
        return "Wetterbericht gibt es mit !weather."
    _season_turn[0] += 1
    text = lines[_season_turn[0] % len(lines)]
    if frost >= FROST_MIN:
        text += " Die Scheibe ist zugefroren: !scrape kratzt, !warm haucht an."
    board = "!snowboard" if theme == "winter" else "!board"
    return f"{text} Wetterbericht: !weather, Bestenliste: {board}" + (" und !frostboard." if frost >= FROST_MIN else ".")
