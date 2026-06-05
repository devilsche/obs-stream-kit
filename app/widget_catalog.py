"""Widget-Catalog — extrahiert `buildFilter([...])`-Schemas aus den Widget-HTMLs.

Das Widget-File ist die Single Source of Truth. Wenn jemand einen neuen
Setting-Switch in einem Widget einbaut, taucht er automatisch auf der
/app/urls-Page auf — kein Python-Pflegeaufwand.

Cache: einmal beim Boot gescannt + ggf. on-demand refresh ueber `refresh()`.
"""
import os
import re
from typing import Optional


# Manuelle Switch-Definitionen fuer Widgets ohne buildFilter (z.B. reine JS-Widgets).
# Fallback: wird genutzt wenn buildFilter nichts liefert.
_TIER_SW = {"key": "tier", "label": "Tier", "type": "select", "default": "1",
             "options": [["1", "Tier 1"], ["2", "Tier 2"], ["3", "Tier 3"]]}

WIDGET_SWITCHES = {
    "latest-follower.html": [
        {"key": "name", "label": "Username", "type": "text",
         "default": "", "placeholder": "z.B. CoolStreamer",
         "tooltip": "Wird von Streamer.bot gesetzt — hier zum Testen"},
    ],
    "latest-sub.html": [
        {"key": "name", "label": "Username", "type": "text",
         "default": "", "placeholder": "z.B. CoolStreamer",
         "tooltip": "Wird von Streamer.bot gesetzt — hier zum Testen"},
        _TIER_SW,
    ],
    "latest-tip.html": [
        {"key": "name",   "label": "Username", "type": "text",
         "default": "", "placeholder": "z.B. CoolStreamer"},
        {"key": "amount", "label": "Betrag",   "type": "text",
         "default": "", "placeholder": "z.B. 5,00 €"},
    ],
    "subgoal.html": [
        {"key": "title",   "label": "Titel",   "type": "text",   "default": "Sub Goal", "placeholder": "Sub Goal"},
        {"key": "current", "label": "Aktuell", "type": "number", "default": "23", "min": 0},
        {"key": "goal",    "label": "Ziel",    "type": "number", "default": "50", "min": 1},
    ],
    "tipgoal.html": [
        {"key": "title",    "label": "Titel",   "type": "text", "default": "Tip Goal", "placeholder": "Tip Goal"},
        {"key": "current",  "label": "Aktuell", "type": "text", "default": "0",        "placeholder": "0"},
        {"key": "goal",     "label": "Ziel",    "type": "text", "default": "100",      "placeholder": "100"},
        {"key": "currency", "label": "Währung", "type": "text", "default": "€",        "placeholder": "€"},
    ],
    "pubg/coplayer.html": [
        {"key": "player", "label": "Spieler", "type": "text", "default": "",
         "placeholder": "z.B. PEX_LuCKoR", "tooltip": "PUBG-Name des Mitspielers — leer = alle"},
    ],
    "pubg/milestone-celebrate.html": [
        {"key": "n",     "label": "Chicken-Nr.", "type": "number", "default": "", "min": 1,
         "tooltip": "Override: Chicken-Nummer erzwingen (sonst auto aus DB)"},
        {"key": "wait",  "label": "Wartezeit (s)", "type": "number", "default": "15", "min": 0},
        {"key": "force", "label": "Force-Show", "type": "select", "default": "0",
         "options": [["0", "Normal"], ["1", "Sofort zeigen"]]},
        {"key": "mute",  "label": "Ton", "type": "select", "default": "0",
         "options": [["0", "Mit Ton"], ["1", "Stumm"]]},
    ],
    "pubg/lookup.html": [
        {"key": "player", "label": "Spieler", "type": "text", "default": "",
         "placeholder": "z.B. PEX_LuCKoR", "tooltip": "Füllt das Suchfeld vor"},
        {"key": "embed",  "label": "Modus", "type": "select", "default": "0",
         "options": [["0", "Normal"], ["1", "Embed (kein Header)"]]},
    ],
    "pubg/chat-stats-popup.html": [
        {"key": "player",     "label": "Spieler",    "type": "text",   "default": "",
         "placeholder": "z.B. PEX_LuCKoR", "tooltip": "Wird normalerweise vom Chat-Command gesetzt"},
        {"key": "durationMs", "label": "Dauer (ms)", "type": "number", "default": "8000", "min": 1000},
    ],
    "tipgoal-banner.html": [
        {"key": "title",    "label": "Titel",        "type": "text",   "default": "Tip Goal", "placeholder": "Tip Goal"},
        {"key": "current",  "label": "Aktuell",      "type": "text",   "default": "0",        "placeholder": "0"},
        {"key": "goal",     "label": "Ziel",         "type": "text",   "default": "100",      "placeholder": "100"},
        {"key": "currency", "label": "Währung",      "type": "text",   "default": "€",        "placeholder": "€"},
        {"key": "dock",     "label": "Hintergrund",  "type": "select", "default": "0",
         "options": [["0", "Transparent (OBS)"], ["1", "Mit Hintergrund (Dock)"]]},
    ],
}

# (kategorie, label, beschreibung, path)
WIDGET_META = [
    ("PUBG · Stats", "Career Card",          "Career stats: K/D, wins, top 10 — current season.",                    "pubg/career-card.html"),


    ("PUBG · Stats", "Live Bar",             "Live stat bar for the gameplay overlay — kills, damage, place. Only visible during an active session (auto-hides between matches).", "pubg/live-bar.html"),
    ("PUBG · Stats", "Streak Counter",       "Live win-streak / top10-streak counter. Tied to the active session.",  "pubg/streak-counter.html"),
    ("PUBG · Stats", "First Fight Rate",     "How often you win the first fight.",                                   "pubg/first-fight.html"),
    ("PUBG · Stats", "Weapon Stats",         "Damage and kill distribution by weapon.",                              "pubg/weapon-stats.html"),
    ("PUBG · Stats", "Season History",       "Career-history across seasons.",                                       "pubg/season-history.html"),
    ("PUBG · Stats", "Trend Indicator",      "Trend arrow (improving/dropping).",                                    "pubg/trend-indicator.html"),

    ("PUBG · Mates",  "Mates Carousel",      "Squad-mates carousel for the gameplay overlay.",                       "pubg/mates.html"),
    ("PUBG · Mates",  "Coplayer",            "Who plays with you (incl. partial sessions).",                         "pubg/coplayer.html"),
    ("PUBG · Mates",  "Top Mates",           "Best synergy mates by team K/D.",                                      "pubg/top-mates.html"),
    ("PUBG · Mates",  "Top Vehicle Hunters", "Leaderboard: wer schiesst die meisten Gegner aus dem Fahrzeug (oder wird selbst geholt).", "pubg/top-hunters.html"),
    ("PUBG · Mates",  "Top Mates Slider",    "Top mates as auto-rotating slider.",                                   "pubg/top-mates-slider.html"),
    ("PUBG · Mates",  "Mates Flyout",        "Detail flyout with mate stats.",                                       "pubg/flyout-full.html"),
    ("PUBG · Mates",  "Anti-Mates",          "Players you play worst with.",                                         "pubg/anti-mates.html"),
    ("PUBG · Mates",  "Chicken Together",    "Chicken-dinners shared with mates.",                                   "pubg/chicken-together.html"),
    ("PUBG · Mates",  "Squad Compare",       "Side-by-side squad stat comparison.",                                  "pubg/squad-compare.html"),

    ("PUBG · Maps",   "Map Performance",     "Performance per map: place, kills, damage.",                           "pubg/map-performance.html"),
    ("PUBG · Maps",   "Chicken Map",         "Chicken-dinner pins on the map (all wins).",                           "pubg/chicken-map.html"),
    ("PUBG · Maps",   "Map Play Distribution","How often you play each map (bar chart).",                            "pubg/map-distribution.html"),
    ("PUBG · Maps",   "Hot Drop",            "Hot-drop visualisation — where you land.",                             "pubg/hot-drop.html"),

    ("PUBG · Match",  "Post-Match Card",     "Card right after a match ends — stats + replay link.",                 "pubg/post-match-card.html"),
    ("PUBG · Match",  "Session Summary",     "Summary of the current session.",                                      "pubg/session-summary.html"),
    ("PUBG · Match",  "Session Goal",        "Progress toward the configured session goal.",                         "pubg/session-goal.html"),
    ("PUBG · Match",  "Session Lobbies",     "Lobby-strength of recent matches.",                                    "pubg/session-lobbies.html"),
    ("PUBG · Match",  "Payday Stats",        "Damage paid out by enemy faction.",                                    "pubg/payday-stats.html"),

    ("PUBG · Achievements", "Milestone Celebrate",   "Big celebration overlay — fires only after a fresh chicken-dinner crossing a 100-mark.", "pubg/milestone-celebrate.html"),
    ("PUBG · Achievements", "Session Achievements",  "Achievements unlocked in the current session.",                "pubg/session-achievements.html"),

    ("PUBG · News",   "News Ticker",        "Bottom-bar news + stats highlights.",                                  "pubg/news-ticker.html"),
    ("PUBG · News",   "Lookup",             "Live player lookup driven by chat commands.",                          "pubg/lookup.html"),
    ("PUBG · News",   "Chat Stats Popup",   "Stat popup triggered from chat.",                                      "pubg/chat-stats-popup.html"),

    ("Steam",         "Achievement Feed",   "Achievement-unlock ticker (rotating list).",                           "steam/achievement-feed.html"),
    ("Steam",         "Achievement Popup",  "Animation on a fresh unlock.",                                         "steam/achievement-popup.html"),
    ("Steam",         "Combined Popup",     "Combined now-playing + achievement popup.",                            "steam/popup.html"),
    ("Steam",         "Now Playing",        "Aktuell gespieltes Steam-Spiel.", "steam/now-playing.html"),
    ("Steam",         "Games Ticker",       "Owned-games ticker.",                                                  "steam/games-ticker.html"),
    # Achievement Browser ist ein Tool, kein OBS-Widget -> tools/achievement-browser.html, sichtbar unter /app/tools/

    # Persistente Stream-Info-Sidepanels (Dauer-Anzeige, kein Einmal-Alert).
    ("Follower & Goals", "Latest Follower", "Sidepanel: zeigt den letzten Follower (dauerhaft sichtbar).",          "latest-follower.html"),
    ("Follower & Goals", "Latest Sub",      "Sidepanel: zeigt den letzten Sub (dauerhaft sichtbar).",               "latest-sub.html"),
    ("Follower & Goals", "Latest Tip",      "Sidepanel: zeigt den letzten Tip/Donation (dauerhaft sichtbar).",      "latest-tip.html"),
    ("Follower & Goals", "Sub Goal",        "Fortschrittsbalken Richtung Sub-Ziel.",                                "subgoal.html"),
    ("Follower & Goals", "Tip Goal",        "Fortschrittsbalken Richtung Tip-Ziel.",                                "tipgoal.html"),
]


_BUILD_FILTER_RE = re.compile(r"buildFilter\(\s*\[", re.DOTALL)
_KEY_RE = re.compile(r"key:\s*\"(?P<v>[^\"]+)\"")
_LABEL_RE = re.compile(r"label:\s*\"(?P<v>[^\"]+)\"")
_TYPE_RE = re.compile(r"type:\s*\"(?P<v>[^\"]+)\"")
_DEFAULT_RE = re.compile(r"default:\s*(?P<v>\"[^\"]*\"|[^,\n}]+)")
_PLACEHOLDER_RE = re.compile(r"placeholder:\s*\"(?P<v>[^\"]*)\"")
_NUM_FIELD_RE = re.compile(r"\b(min|max|step):\s*(\d+(?:\.\d+)?)")
_OPTION_PAIR_RE = re.compile(r"\[\s*\"([^\"]+)\"\s*,\s*\"([^\"]+)\"\s*\]")
_TOOLTIP_RE = re.compile(
    r"tooltip:\s*((?:\"(?:[^\"\\]|\\.)*\"\s*\+\s*)*\"(?:[^\"\\]|\\.)*\")",
    re.DOTALL,
)
_STRING_PIECE_RE = re.compile(r"\"((?:[^\"\\]|\\.)*)\"")


def _split_top_level(body: str, sep: str = ",") -> list:
    """Split string at `sep` only on top level — ignores commas inside
    nested {}, []. Used to break `buildFilter`-array into per-item chunks
    and item-body into key-value chunks."""
    out, depth, start = [], 0, 0
    for i, ch in enumerate(body):
        if ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif ch == sep and depth == 0:
            out.append(body[start:i])
            start = i + 1
    tail = body[start:]
    if tail.strip():
        out.append(tail)
    return out


def _find_array_body(text: str, start: int) -> tuple:
    """Find balanced [..] starting at `text[start]==`'['. Returns (body, end_index)."""
    assert text[start] == "["
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    raise ValueError("unbalanced [")


def _extract_options(rest: str) -> Optional[list]:
    idx = rest.find("options:")
    if idx < 0:
        return None
    # Find first `[` after "options:"
    bracket = rest.find("[", idx)
    if bracket < 0:
        return None
    try:
        body, _ = _find_array_body(rest, bracket)
    except ValueError:
        return None
    return [(p.group(1), p.group(2)) for p in _OPTION_PAIR_RE.finditer(body)]


from typing import Tuple


def _extract_schema_from_html(content: str) -> list:
    m = _BUILD_FILTER_RE.search(content)
    if not m:
        return []
    # Find balanced [..] for the outer array
    start = m.end() - 1  # points at the `[`
    try:
        block, _ = _find_array_body(content, start)
    except ValueError:
        return []
    # Split into per-{...}-item chunks
    items = []
    depth, item_start = 0, None
    for i, ch in enumerate(block):
        if ch == "{":
            if depth == 0:
                item_start = i + 1
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and item_start is not None:
                items.append(block[item_start:i])
                item_start = None

    out = []
    for body in items:
        key_m = _KEY_RE.search(body)
        type_m = _TYPE_RE.search(body)
        label_m = _LABEL_RE.search(body)
        if not (key_m and type_m and label_m):
            continue
        entry = {
            "key": key_m.group("v"),
            "label": label_m.group("v"),
            "type": type_m.group("v"),
        }
        def_m = _DEFAULT_RE.search(body)
        if def_m:
            entry["default"] = def_m.group("v").strip().strip("\"")
        else:
            entry["default"] = ""
        ph_m = _PLACEHOLDER_RE.search(body)
        if ph_m:
            entry["placeholder"] = ph_m.group("v")
        opts = _extract_options(body)
        if opts is not None:
            entry["options"] = opts
        for nm in _NUM_FIELD_RE.finditer(body):
            entry[nm.group(1)] = float(nm.group(2)) if "." in nm.group(2) else int(nm.group(2))
        tt_m = _TOOLTIP_RE.search(body)
        if tt_m:
            pieces = [p.group(1) for p in _STRING_PIECE_RE.finditer(tt_m.group(1))]
            entry["tooltip"] = "".join(pieces).strip()
        out.append(entry)
    return out


_cache: Optional[list] = None


# Range-Optionen sind ueber alle Widgets in dieser kanonischen Reihenfolge:
# session vor week vor all (von "klein" zu "gross" Zeitraum).
_CANONICAL_RANGE = [("session", "Session"), ("week", "Week"), ("all", "All")]


def _smart_presets(switch: dict) -> list:
    """Liefert sinnvolle Preset-Werte fuer einen range/number-Switch.

    Logik:
    - Percent-Style (key/label nennt 'pct', 'rate', 'rare', 'dim', 'volume',
      'win'): 10/25/50/75/100 — clamp auf min..max.
    - Time-in-ms (key endet auf 'Ms' oder label enthaelt '(ms)'):
      500/1000/3000/8000/30000/60000.
    - Sec (label enthaelt '(s)'): 3/5/10/30.
    - Sonst Skala nach max:
      max<=10  → 1/2/5/10
      max<=50  → 1/5/10/20/50
      max<=100 → 10/25/50/75/100
      max<=1000 → 10/100/500/1000
      sonst   → 1000/10000/60000/600000
    Default-Wert wird, falls nicht in Liste, automatisch eingefuegt.
    """
    lo = int(switch.get("min", 0))
    hi = int(switch.get("max", 100))
    key = (switch.get("key") or "").lower()
    label = (switch.get("label") or "").lower()
    blob = key + " " + label

    candidates = None
    if any(s in blob for s in ("pct", "rate", "rare", "dim", "volume", "win", "headshot")):
        candidates = [10, 25, 50, 75, 100]
    elif key.endswith("ms") or "(ms)" in blob:
        candidates = [500, 1000, 3000, 8000, 30000, 60000, 600000]
    elif key.endswith("sec") or "(s)" in blob or " seconds" in blob:
        candidates = [3, 5, 10, 30, 60]
    elif hi <= 10:
        candidates = [1, 2, 5, 10]
    elif hi <= 50:
        candidates = [1, 5, 10, 20, 50]
    elif hi <= 100:
        candidates = [10, 25, 50, 75, 100]
    elif hi <= 1000:
        candidates = [10, 100, 500, 1000]
    else:
        candidates = [1000, 10000, 60000, 600000]

    presets = [c for c in candidates if lo <= c <= hi]
    # Default-Wert immer mit anbieten
    try:
        d = int(switch.get("default", ""))
        if lo <= d <= hi and d not in presets:
            presets.append(d)
            presets.sort()
    except (TypeError, ValueError):
        pass
    return presets


def _normalize_switches(switches: list, content: str) -> list:
    """Vereinheitlicht switches:
    - select ohne options: rausfiltern (nicht renderbar)
    - 'range'-Switches: kanonische Reihenfolge session->week->all
    - Wenn widget renderHeader() verwendet: synthetic 'header'-Switch dranhaengen."""
    out = []
    for s in switches:
        if s["type"] == "select" and not s.get("options"):
            continue
        # range-Switch normalisieren: gleiche Werte → kanonische Order + Labels
        if s["key"] == "range" and s["type"] == "select":
            values_in_widget = {v for v, _ in s.get("options", [])}
            if values_in_widget and values_in_widget.issubset({v for v, _ in _CANONICAL_RANGE}):
                s = dict(s)
                s["options"] = [(v, lbl) for v, lbl in _CANONICAL_RANGE
                                 if v in values_in_widget]
        # Smart presets fuer numerische Switches anhaengen
        if s["type"] in ("range", "number"):
            s = dict(s)
            s["presets"] = _smart_presets(s)
        out.append(s)
    # Synthetic header-Switch wenn das Widget renderHeader nutzt ODER
    # einen header-Param direkt liest. Default-Wert wird aus dem
    # PubgUI.qs("header", "?")-Default extrahiert (sonst "0").
    has_header = any(s["key"] == "header" for s in out)
    uses_header = "renderHeader(" in content
    m_def = re.search(r'qs\(\s*"header"\s*,\s*"(\d)"', content)
    if m_def:
        uses_header = True
    if not has_header and uses_header:
        default = m_def.group(1) if m_def else "0"
        out.append({
            "key": "header",
            "label": "Header",
            "type": "select",
            "default": default,
            "options": [("0", "Hide"), ("1", "Show")],
            "tooltip": "Title bar above the widget (showing widget name + range).",
        })
    # Synthetic ignoreStale-Switch wenn das Widget hideIfStale verwendet —
    # erlaubt dem Streamer in OBS die letzte Session weiterzuzeigen wenn
    # gerade keine aktive Session laeuft (sonst wird das Widget versteckt).
    has_stale = any(s["key"] == "ignoreStale" for s in out)
    if not has_stale and ("hideIfStale" in content or "ignoreStale" in content):
        out.append({
            "key": "ignoreStale",
            "label": "Show stale data",
            "type": "select",
            "default": "0",
            "options": [("0", "Hide when idle"), ("1", "Keep last session")],
            "tooltip": "If no session is currently running, what should the "
                       "widget do? Default (Hide) makes it disappear between "
                       "play sessions. 'Keep last session' keeps showing the "
                       "last session's stats so the slot stays filled.",
        })
    return out


# Hinweistexte die im URL-Detail als Info-Box erscheinen (kein reiner desc-Text).
WIDGET_HINTS = {
    "steam/now-playing.html": "Nur sichtbar wenn gerade ein Steam-Spiel läuft — blendet sich automatisch aus wenn nichts gespielt wird.",
}

# Reine Overlay-Widgets — kein dock (immer OBS Browser Source, kein Custom Dock).
_NO_DOCK = {
    "pubg/live-bar.html", "pubg/streak-counter.html", "pubg/mates.html",
    "pubg/milestone-celebrate.html", "pubg/news-ticker.html",
    "pubg/post-match-card.html", "pubg/trend-indicator.html",
    "pubg/top-mates-slider.html", "pubg/flyout-full.html",
    "pubg/chat-stats-popup.html",
    "steam/achievement-popup.html", "steam/popup.html",
}

_DOCK_SW = {
    "key": "dock", "label": "Hintergrund", "type": "select", "default": "0",
    "options": [["0", "Transparent (OBS)"], ["1", "Mit Hintergrund (Dock)"]],
    "tooltip": "Transparent für OBS Browser Source; Mit Hintergrund für Custom Docks im Browser.",
}


def build(project_root: str) -> list:
    """Liest pro Widget die buildFilter-Schemas + liefert die fuer urls.html
    aufbereitete Liste:  (kategorie, label, desc, pfad, switches[])"""
    out = []
    for cat, label, desc, path in WIDGET_META:
        full = os.path.join(project_root, "widgets", path)
        switches = []
        content = ""
        if os.path.isfile(full):
            try:
                with open(full, "r", encoding="utf-8") as fp:
                    content = fp.read()
                switches = _extract_schema_from_html(content)
                if not switches:
                    switches = list(WIDGET_SWITCHES.get(path, []))
            except Exception:
                switches = list(WIDGET_SWITCHES.get(path, []))
        switches = _normalize_switches(switches, content)
        # Dock-Switch automatisch anhaengen: alle Widgets die _pubg.js laden,
        # ausser reine Overlays. Kein Duplikat wenn bereits manuell gesetzt.
        if ("_pubg.js" in content and path not in _NO_DOCK
                and not any(s["key"] == "dock" for s in switches)):
            switches.append(_DOCK_SW)
        hint = WIDGET_HINTS.get(path, "")
        out.append((cat, label, desc, path, switches, hint))
    return out


def get(project_root: str, refresh: bool = False) -> list:
    global _cache
    if _cache is None or refresh:
        _cache = build(project_root)
    return _cache
