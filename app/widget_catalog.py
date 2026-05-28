"""Widget-Catalog — extrahiert `buildFilter([...])`-Schemas aus den Widget-HTMLs.

Das Widget-File ist die Single Source of Truth. Wenn jemand einen neuen
Setting-Switch in einem Widget einbaut, taucht er automatisch auf der
/app/urls-Page auf — kein Python-Pflegeaufwand.

Cache: einmal beim Boot gescannt + ggf. on-demand refresh ueber `refresh()`.
"""
import os
import re
from typing import Optional


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
    ("PUBG · Mates",  "Top Mates Slider",    "Top mates as auto-rotating slider.",                                   "pubg/top-mates-slider.html"),
    ("PUBG · Mates",  "Mates Flyout",        "Detail flyout with mate stats.",                                       "pubg/flyout-full.html"),
    ("PUBG · Mates",  "Anti-Mates",          "Players you play worst with.",                                         "pubg/anti-mates.html"),
    ("PUBG · Mates",  "Chicken Together",    "Chicken-dinners shared with mates.",                                   "pubg/chicken-together.html"),
    ("PUBG · Mates",  "Squad Compare",       "Side-by-side squad stat comparison.",                                  "pubg/squad-compare.html"),

    ("PUBG · Maps",   "Map Performance",     "Performance per map: place, kills, damage.",                           "pubg/map-performance.html"),
    ("PUBG · Maps",   "Map Distribution",    "Chicken-dinner pins on the map (all wins).",                           "pubg/chicken-map.html"),
    ("PUBG · Maps",   "Hot Drop",            "Hot-drop visualisation — where you land.",                             "pubg/hot-drop.html"),

    ("PUBG · Match",  "Post-Match Card",     "Card right after a match ends — stats + replay link.",                 "pubg/post-match-card.html"),
    ("PUBG · Match",  "Session Summary",     "Summary of the current session.",                                      "pubg/session-summary.html"),
    ("PUBG · Match",  "Session Goal",        "Progress toward the configured session goal.",                         "pubg/session-goal.html"),
    ("PUBG · Match",  "Session Lobbies",     "Lobby-strength of recent matches.",                                    "pubg/session-lobbies.html"),
    ("PUBG · Match",  "Payday Stats",        "Damage paid out by enemy faction.",                                    "pubg/payday-stats.html"),

    ("PUBG · Achievements", "Milestone Celebrate",   "Animation/sound on milestone achievements.",                  "pubg/milestone-celebrate.html"),
    ("PUBG · Achievements", "Achievement Feed",      "Achievement ticker.",                                          "pubg/achievement-feed.html"),
    ("PUBG · Achievements", "Session Achievements",  "Achievements unlocked in the current session.",                "pubg/session-achievements.html"),

    ("PUBG · News",   "News Ticker",        "Bottom-bar news + stats highlights.",                                  "pubg/news-ticker.html"),
    ("PUBG · News",   "Lookup",             "Live player lookup driven by chat commands.",                          "pubg/lookup.html"),
    ("PUBG · News",   "Chat Stats Popup",   "Stat popup triggered from chat.",                                      "pubg/chat-stats-popup.html"),

    ("Steam",         "Achievement Feed",   "Achievement-unlock ticker.",                                           "steam/achievement-feed.html"),
    ("Steam",         "Achievement Popup",  "Animation on a fresh unlock.",                                         "steam/achievement-popup.html"),
    ("Steam",         "Recent Unlocks",     "Recently unlocked achievements.",                                      "steam/recent-unlocks.html"),
    ("Steam",         "Popup",              "Combined now-playing + achievement popup.",                            "steam/popup.html"),
    ("Steam",         "Now Playing",        "Currently played Steam game.",                                         "steam/now-playing.html"),
    ("Steam",         "Games Ticker",       "Owned-games ticker.",                                                  "steam/games-ticker.html"),
    ("Steam",         "Achievement Browser","Full-screen browser for all achievements (Just Chatting).",            "steam/achievement-browser.html"),
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


def build(project_root: str) -> list:
    """Liest pro Widget die buildFilter-Schemas + liefert die fuer urls.html
    aufbereitete Liste:  (kategorie, label, desc, pfad, switches[])"""
    out = []
    for cat, label, desc, path in WIDGET_META:
        full = os.path.join(project_root, "widgets", path)
        switches = []
        if os.path.isfile(full):
            try:
                with open(full, "r", encoding="utf-8") as fp:
                    switches = _extract_schema_from_html(fp.read())
            except Exception:
                switches = []
        # Normalisiere: select ohne options kann nicht als UI-Switch
        # gerendert werden — wir lassen es weg.
        switches = [s for s in switches if not (s["type"] == "select" and not s.get("options"))]
        out.append((cat, label, desc, path, switches))
    return out


def get(project_root: str, refresh: bool = False) -> list:
    global _cache
    if _cache is None or refresh:
        _cache = build(project_root)
    return _cache
