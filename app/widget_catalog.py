"""Widget-Catalog — extrahiert `buildFilter([...])`-Schemas aus den Widget-HTMLs.

Das Widget-File ist die Single Source of Truth. Wenn jemand einen neuen
Setting-Switch in einem Widget einbaut, taucht er automatisch auf der
/app/urls-Page auf — kein Python-Pflegeaufwand.

Cache: einmal beim Boot gescannt + ggf. on-demand refresh ueber `refresh()`.
"""
import os
import re
from typing import Optional


# Preview-Größen für den URL-Picker (width, height in px).
# Widgets ohne Eintrag: Auto-Detect via scrollWidth/scrollHeight.
WIDGET_PREVIEW_SIZES = {
    # PUBG Stats
    "pubg/career-card.html":        (400, 520),
    "pubg/live-bar.html":           (520,  44),
    "pubg/streak-counter.html":     (320,  80),
    "pubg/first-fight.html":        (400, 320),
    "pubg/weapon-stats.html":       (380, 420),
    "pubg/season-history.html":     (480, 480),
    "pubg/trend-indicator.html":    (240,  80),
    # PUBG Mates
    "pubg/mates.html":              (400,  90),
    "pubg/coplayer.html":           (720, 480),
    "pubg/top-mates.html":          (320, 360),
    "pubg/top-hunters.html":        (320, 360),
    "pubg/top-mates-slider.html":   (320, 200),
    "pubg/flyout-full.html":        (480, 480),
    "pubg/anti-mates.html":         (320, 360),
    "pubg/chicken-together.html":   (520, 400),
    "pubg/squad-compare.html":      (480, 360),
    # PUBG Maps
    "pubg/map-performance.html":    (1200, 620),
    "pubg/chicken-map.html":        (380, 400),
    "pubg/map-distribution.html":   (280, 320),
    "pubg/hot-drop.html":           (460, 400),
    # PUBG Match
    "pubg/post-match-card.html":    (400, 320),
    "pubg/session-summary.html":    (400, 280),
    "pubg/session-goal.html":       (400,  80),
    "pubg/session-lobbies.html":    (400, 280),
    "pubg/payday-stats.html":       (400, 280),
    "pubg/deathmatch-stats.html":   (440, 300),
    # PUBG Achievements
    "pubg/milestone-celebrate.html":(1920,1080),
    "pubg/session-achievements.html":(400, 360),
    # PUBG News
    "pubg/news-ticker.html":        (920,  44),
    "pubg/lookup.html":             (720, 560),
    "pubg/chat-stats-popup.html":   (480, 200),
    # Steam
    "steam/achievement-feed.html":  (400, 200),
    "steam/achievement-popup.html": (500, 110),
    "steam/popup.html":             (500, 110),
    "steam/now-playing.html":       (520, 200),
    "steam/games-ticker.html":      (480,  90),
    # Gothic 1 Remake (lokaler Proxy, ?port=)
    "g1r/livebar.html":             (1040, 46),
    "g1r/news-ticker.html":         (760,  40),
    "g1r/career-card.html":         (360, 480),
    # Follower & Goals
    "latest-follower.html":         (500, 110),
    "latest-sub.html":              (500, 110),
    "latest-tip.html":              (500, 110),
    "subgoal.html":                 (500, 130),
    "tipgoal.html":                 (500, 130),
}

# Manuelle Switch-Definitionen fuer Widgets ohne buildFilter (z.B. reine JS-Widgets).
# Fallback: wird genutzt wenn buildFilter nichts liefert.
_TIER_SW = {"key": "tier", "label": "Tier", "type": "select", "default": "1",
             "options": [["1", "Tier 1"], ["2", "Tier 2"], ["3", "Tier 3"]]}

WIDGET_SWITCHES = {
    "latest-follower.html": [
        {"key": "name", "label": "Username", "type": "text",
         "default": "", "placeholder": "e.g. CoolStreamer",
         "tooltip": "The widget shows whoever is passed as ?name=. In production this is set by Streamer.bot before the source is shown."},
    ],
    "latest-sub.html": [
        {"key": "name", "label": "Username", "type": "text",
         "default": "", "placeholder": "e.g. CoolStreamer",
         "tooltip": "The widget shows whoever is passed as ?name=. In production this is set by Streamer.bot before the source is shown."},
        _TIER_SW,
    ],
    "latest-tip.html": [
        {"key": "name",   "label": "Username", "type": "text",
         "default": "", "placeholder": "e.g. CoolStreamer"},
        {"key": "amount", "label": "Amount",   "type": "text",
         "default": "", "placeholder": "e.g. 5.00 €"},
    ],
    "subgoal.html": [
        {"key": "title",   "label": "Title",   "type": "text",   "default": "Sub Goal", "placeholder": "Sub Goal"},
        {"key": "current", "label": "Current", "type": "number", "default": "23", "min": 0},
        {"key": "goal",    "label": "Goal",    "type": "number", "default": "50", "min": 1},
    ],
    "tipgoal.html": [
        {"key": "title",    "label": "Title",    "type": "text", "default": "Tip Goal", "placeholder": "Tip Goal"},
        {"key": "current",  "label": "Current",  "type": "text", "default": "0",        "placeholder": "0"},
        {"key": "goal",     "label": "Goal",     "type": "text", "default": "100",      "placeholder": "100"},
        {"key": "currency", "label": "Currency", "type": "text", "default": "€",        "placeholder": "€"},
    ],
    "pubg/coplayer.html": [
        {"key": "player", "label": "Player", "type": "text", "default": "",
         "placeholder": "e.g. PEX_LuCKoR", "tooltip": "PUBG name of the co-player — empty = all"},
    ],
    "pubg/milestone-celebrate.html": [
        {"key": "n",     "label": "Chicken #",  "type": "number", "default": "", "min": 1,
         "tooltip": "Override: force a specific chicken number (otherwise auto from DB)"},
        {"key": "wait",  "label": "Wait (s)",   "type": "number", "default": "15", "min": 0},
        {"key": "force", "label": "Force Show", "type": "select", "default": "0",
         "options": [["0", "Normal"], ["1", "Force show"]]},
        {"key": "mute",  "label": "Sound",      "type": "select", "default": "0",
         "options": [["0", "Sound on"], ["1", "Muted"]]},
    ],
    "pubg/lookup.html": [
        {"key": "player", "label": "Player", "type": "text", "default": "",
         "placeholder": "e.g. PEX_LuCKoR", "tooltip": "Pre-fills the search field"},
        {"key": "embed",  "label": "Mode",   "type": "select", "default": "0",
         "options": [["0", "Normal"], ["1", "Embed (no header)"]]},
    ],
    "pubg/chat-stats-popup.html": [
        {"key": "player",     "label": "Player",       "type": "text",   "default": "",
         "placeholder": "e.g. PEX_LuCKoR", "tooltip": "Normally set by a chat command"},
        {"key": "durationMs", "label": "Duration (ms)", "type": "number", "default": "8000", "min": 1000},
    ],
}

# (kategorie, label, beschreibung, path)
WIDGET_META = [
    ("PUBG · Stats", "Career Card",          "Career stats: K/D, wins, top 10 — current season.",                    "pubg/career-card.html"),


    ("PUBG · Stats", "Live Bar",             "Live stat bar for the gameplay overlay — kills, damage, place.", "pubg/live-bar.html"),
    ("PUBG · Stats", "Streak Counter",       "Live win-streak / top10-streak counter. Tied to the active session.",  "pubg/streak-counter.html"),
    ("PUBG · Stats", "First Fight Rate",     "How often you win the first fight.",                                   "pubg/first-fight.html"),
    ("PUBG · Stats", "Weapon Stats",         "Damage and kill distribution by weapon.",                              "pubg/weapon-stats.html"),
    ("PUBG · Stats", "Season History",       "Career-history across seasons.",                                       "pubg/season-history.html"),
    ("PUBG · Stats", "Trend Indicator",      "Trend arrow (improving/dropping).",                                    "pubg/trend-indicator.html"),

    ("PUBG · Mates",  "Mates Carousel",      "Squad-mates carousel for the gameplay overlay.",                       "pubg/mates.html"),
    ("PUBG · Mates",  "Coplayer",            "Who plays with you (incl. partial sessions).",                         "pubg/coplayer.html"),
    ("PUBG · Mates",  "Top Mates",           "Best synergy mates by team K/D.",                                      "pubg/top-mates.html"),
    ("PUBG · Mates",  "Top Vehicle Hunters", "Leaderboard: most enemies shot out of vehicles (or knocked yourself).", "pubg/top-hunters.html"),
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
    ("PUBG · Match",  "Deathmatch Stats",    "Team-Deathmatch (TDM) leaderboard — kills, deaths, K/D, damage.",       "pubg/deathmatch-stats.html"),

    ("PUBG · Achievements", "Milestone Celebrate",   "Big celebration overlay — fires only after a fresh chicken-dinner crossing a 100-mark.", "pubg/milestone-celebrate.html"),
    ("PUBG · Achievements", "Session Achievements",  "Achievements unlocked in the current session.",                "pubg/session-achievements.html"),

    ("PUBG · News",   "News Ticker",        "Bottom-bar news + stats highlights.",                                  "pubg/news-ticker.html"),
    ("PUBG · News",   "Lookup",             "Live player lookup driven by chat commands.",                          "pubg/lookup.html"),
    ("PUBG · News",   "Chat Stats Popup",   "Stat popup triggered from chat.",                                      "pubg/chat-stats-popup.html"),

    ("Steam",         "Achievement Feed",   "Achievement-unlock ticker (rotating list).",                           "steam/achievement-feed.html"),
    ("Steam",         "Achievement Popup",  "Animation on a fresh unlock.",                                         "steam/achievement-popup.html"),
    ("Steam",         "Combined Popup",     "Combined now-playing + achievement popup.",                            "steam/popup.html"),
    ("Steam",         "Now Playing",        "Currently played Steam game.", "steam/now-playing.html"),
    ("Steam",         "Games Ticker",       "Owned-games ticker.",                                                  "steam/games-ticker.html"),
    # Achievement Browser ist ein Tool, kein OBS-Widget -> tools/achievement-browser.html, sichtbar unter /app/tools/

    # Gothic 1 Remake (lokaler Proxy, Browser-Source mit ?port=9210)
    ("Gothic 1",      "Livebar",            "Live bar: level, steps, damage out/taken, mana, regen, clock.",        "g1r/livebar.html"),
    ("Gothic 1",      "News Ticker",        "Rotating ticker: stats, session totals, distance, strongest weapon/spell.", "g1r/news-ticker.html"),
    ("Gothic 1",      "Career Card",        "Detail card: stats, resistances, lifetime totals, records, gear.",     "g1r/career-card.html"),

    # Persistente Stream-Info-Sidepanels (Dauer-Anzeige, kein Einmal-Alert).
    ("Follower & Goals", "Latest Follower", "Sidepanel: shows the latest follower (always visible).",              "latest-follower.html"),
    ("Follower & Goals", "Latest Sub",      "Sidepanel: shows the latest subscriber (always visible).",             "latest-sub.html"),
    ("Follower & Goals", "Latest Tip",      "Sidepanel: shows the latest tip/donation (always visible).",           "latest-tip.html"),
    ("Follower & Goals", "Sub Goal",        "Progress bar toward the sub goal.",                                    "subgoal.html"),
    ("Follower & Goals", "Tip Goal",        "Progress bar toward the tip goal.",                                    "tipgoal.html"),
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
    # Parameter-driven (Streamer.bot sets URL params before triggering)
    "latest-follower.html": "Displays whoever is passed as ?name=. Set this URL as a browser source and let Streamer.bot update the URL with the actual follower name on each event.",
    "latest-sub.html":      "Displays whoever is passed as ?name= and ?tier=. Set this URL as a browser source and let Streamer.bot update the URL with the subscriber name and tier on each event.",
    "latest-tip.html":      "Displays whoever is passed as ?name= and ?amount=. Set this URL as a browser source and let Streamer.bot update the URL with the donor name and amount on each event.",
    # Auto-hide
    "steam/now-playing.html":         "Only visible when a Steam game is running — hides automatically when nothing is being played.",
    "pubg/live-bar.html":             "Only visible during an active session — hides automatically between matches.",
    "pubg/post-match-card.html":      "Hides automatically when data becomes stale. OBS source toggle controls visibility after a match.",
    "pubg/news-ticker.html":          "Hides when no session is active (unless ?focus=lifetime). Rotates between session and lifetime snippets every 60 seconds.",
    "pubg/session-goal.html":         "Hides automatically 60 seconds after the goal is reached — use ?keepAfterDone=1 to keep it visible.",
    "pubg/first-fight.html":          "Hides when no active session is running. Shows the first-fight rate for the current or last session.",
    "pubg/hot-drop.html":             "Hides when no active session is running. Shows landing positions only for the current session's matches.",
    "pubg/session-summary.html":      "Hides when no active session is running — completely empty between sessions.",
    "pubg/session-lobbies.html":      "Hides when no active session is running. Shows lobby strength of recent matches.",
    "pubg/session-achievements.html": "Stays visible between sessions (shows last unlocked achievements). Refreshes every 30 seconds.",
    "pubg/weapon-stats.html":         "Hides when no active session is running. Shows weapon stats for the current session only.",
    # Event-triggered / one-shot animations
    "pubg/milestone-celebrate.html":  "One-shot animation — fires automatically when a new chicken dinner crosses a 100-mark. Uses localStorage to prevent double-triggers.",
    "pubg/chat-stats-popup.html":     "Triggered by a chat command or Streamer.bot with ?player= — disappears after a configurable duration (default 12 s).",
    "steam/achievement-popup.html":   "One-shot animation per achievement — polls every 5 s, plays unlocks sequentially (8 s each). Rare achievements trigger stronger effects.",
    "steam/popup.html":               "Combines Now-Playing and Achievement popup with a priority queue — an incoming achievement interrupts the running Now-Playing.",
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
    "key": "dock", "label": "Background", "type": "select", "default": "0",
    "options": [["0", "Transparent (OBS)"], ["1", "With background (Dock)"]],
    "tooltip": "Transparent for OBS Browser Source; with background for custom docks in the browser.",
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
        preview_size = WIDGET_PREVIEW_SIZES.get(path)
        out.append((cat, label, desc, path, switches, hint, preview_size))
    return out


def get(project_root: str, refresh: bool = False) -> list:
    global _cache
    if _cache is None or refresh:
        _cache = build(project_root)
    return _cache
