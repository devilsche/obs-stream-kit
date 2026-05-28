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
    ("PUBG · Stats", "Session Report",       "Full per-match report after session end — kills, damage, placement.",  "pubg/session-report.html"),
    ("PUBG · Stats", "Live Bar",             "Live stat bar for the gameplay overlay — kills, damage, place.",       "pubg/live-bar.html"),
    ("PUBG · Stats", "Streak Counter",       "Live win-streak / top10-streak counter.",                              "pubg/streak-counter.html"),
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


_BUILD_FILTER_RE = re.compile(r"buildFilter\(\s*\[(.*?)\]\s*\)\s*;", re.DOTALL)
_ITEM_RE = re.compile(
    r"\{\s*"
    r"key:\s*\"(?P<key>[^\"]+)\"\s*,\s*"
    r"label:\s*\"(?P<label>[^\"]+)\"\s*,\s*"
    r"type:\s*\"(?P<type>[^\"]+)\"\s*,\s*"
    r"default:\s*(?P<default>(?:\"[^\"]*\"|[^,\}\n]+))"
    r"(?P<rest>(?:[^{}]|\{[^{}]*\})*)\}",
    re.DOTALL,
)
_OPTIONS_RE = re.compile(r"options:\s*\[(?P<body>.+?)\]\s*(?:,|\})", re.DOTALL)
_OPTION_PAIR_RE = re.compile(r"\[\s*\"([^\"]+)\"\s*,\s*\"([^\"]+)\"\s*\]")
_NUM_FIELD_RE = re.compile(r"\b(min|max|step):\s*(\d+(?:\.\d+)?)")


def _extract_schema_from_html(content: str) -> list:
    m = _BUILD_FILTER_RE.search(content)
    if not m:
        return []
    block = m.group(1)
    items = []
    for itm in _ITEM_RE.finditer(block):
        entry = {
            "key": itm.group("key"),
            "label": itm.group("label"),
            "type": itm.group("type"),
            "default": itm.group("default").strip().strip("\""),
        }
        rest = itm.group("rest") or ""
        opt_m = _OPTIONS_RE.search(rest)
        if opt_m:
            opts = []
            for p in _OPTION_PAIR_RE.finditer(opt_m.group("body")):
                opts.append([p.group(1), p.group(2)])
            entry["options"] = opts
        for nm in _NUM_FIELD_RE.finditer(rest):
            entry[nm.group(1)] = float(nm.group(2)) if "." in nm.group(2) else int(nm.group(2))
        items.append(entry)
    return items


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
