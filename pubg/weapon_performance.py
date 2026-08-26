"""Waffen-Performance über mehrere Matches (Session / Woche / alles).

Bewusst **ohne DB-Tabelle**: Die Analyse je Match wird als kleine JSON-Datei
gecached, die Aggregation ist reine Rechnung darauf.

Warum das reicht: Telemetrie ist unveraenderlich, ein einmal gerechnetes Match
aendert sich nie — der Cache veraltet also nicht. Gemessen kostet ein Match
0.79 s Download plus 0.14 s Analyse; das Ergebnis fuer einen Squad sind rund
3 KB. Der erste Aufruf einer Session kostet damit Sekunden, jeder weitere ist
sofort da, und "week" nutzt die Match-Dateien von "session" mit.

Gecached wird nur der eigene Squad (`squad_slice`) — Gegner-Waffen ueber
Wochen hinweg bringen wenig und wuerden den Cache um Faktor 25 aufblaehen.
"""

import json
import os
import re

#: match_id kommt aus der URL — nur diese Zeichen sind erlaubt, damit kein
#: Pfad ausserhalb des Cache-Verzeichnisses entstehen kann.
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

#: Zonen, die wir beim Zusammenfassen mitfuehren.
_ZONES = ("HeadShot", "TorsoShot", "ArmShot", "LegShot", "PelvisShot")


def cache_path(match_id: str, cache_dir: str) -> str:
    """Pfad der Cache-Datei. Wirft ValueError bei verdaechtiger match_id."""
    if not match_id or not _SAFE_ID.match(str(match_id)):
        raise ValueError(f"unzulaessige match_id: {match_id!r}")
    return os.path.join(cache_dir, f"{match_id}.json")


def load_cached(match_id: str, cache_dir: str):
    """Gecachte Analyse oder None. Eine kaputte Datei ist ein Cache-Miss,
    kein Fehler — sie wird beim naechsten Lauf ueberschrieben."""
    try:
        p = cache_path(match_id, cache_dir)
    except ValueError:
        return None
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def store_cached(match_id: str, data: dict, cache_dir: str) -> bool:
    """Schreibt die Analyse in den Cache. Fehlschlag ist nicht fatal —
    dann wird beim naechsten Mal eben neu gerechnet."""
    try:
        os.makedirs(cache_dir, exist_ok=True)
        p = cache_path(match_id, cache_dir)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, p)      # atomar, damit nie eine halbe Datei liegt
        return True
    except Exception:
        return False


def squad_slice(analysis: dict, player: str) -> dict:
    """Reduziert eine Match-Analyse auf den Squad des genannten Spielers.

    Das ist die Form, die gecached wird: rund 3 KB statt 127 KB.
    Unbekannter Spieler -> leerer Ausschnitt, damit nie versehentlich das
    ganze Match im Cache landet.
    """
    players = (analysis or {}).get("players") or {}
    me = players.get(player)
    team = me.get("teamId") if me else None
    keep = {n: p for n, p in players.items()
            if me is not None and p.get("teamId") == team}
    return {"players": keep,
            "matchId": (analysis or {}).get("matchId"),
            "playedAt": (analysis or {}).get("playedAt"),
            "map": (analysis or {}).get("map")}


#: Beschriftung und Reihenfolge der Waffen-Kategorien fuer die Oberflaeche.
#: Die Zuordnung Waffe -> Kategorie steht bereits in WEAPON_NAMES, deshalb
#: braucht es dafuer keine eigene Spalte in der DB.
CATEGORY_LABELS = [
    ("ar",        "AR"),
    ("dmr",       "DMR"),
    ("sniper",    "Sniper"),
    ("smg",       "SMG"),
    ("lmg",       "LMG"),
    ("shotgun",   "Shotgun"),
    ("pistol",    "Pistol"),
    ("throwable", "Throwable"),
    ("melee",     "Melee"),
]


def _weapons_by_category() -> dict:
    from pubg.aggregations import WEAPON_NAMES
    out = {}
    for name, cat in WEAPON_NAMES.values():
        out.setdefault(cat, set()).add(name)
    return out


def weapon_categories() -> dict:
    """{key: {label, count}} in Anzeige-Reihenfolge — fuer die Filter-Chips."""
    by = _weapons_by_category()
    return {key: {"label": label, "count": len(by.get(key, ()))}
            for key, label in CATEGORY_LABELS if by.get(key)}


def weapons_in_category(category: str) -> list:
    """Die Namen AUS DEM SPIEL, gegen die in der DB gefiltert wird.
    Unbekannte Kategorie -> leere Liste, kein Fehler."""
    return sorted(_weapons_by_category().get(category, ()))


#: analyse()-Zonennamen -> Spaltennamen der Tabelle.
_ZONE_COL = {"HeadShot": "head", "TorsoShot": "torso", "ArmShot": "arm",
             "LegShot": "leg", "PelvisShot": "pelvis"}


def to_db_rows(analysis: dict, account_ids: dict = None) -> list:
    """Flacht eine Match-Analyse zu Zeilen fuer match_weapon_stats auf:
    eine Zeile je Spieler UND Waffe.

    `account_ids` ueberschreibt die IDs aus der Analyse (fuer Tests und
    Altbestand). Ohne Account-Id gibt es keinen Primaerschluessel — solche
    Zeilen fallen weg, statt eine kaputte Zeile zu schreiben.
    """
    rows = []
    for name, p in ((analysis or {}).get("players") or {}).items():
        acc = (account_ids.get(name) if account_ids is not None
               else p.get("accountId"))
        if not acc:
            continue
        for weapon, w in (p.get("weapons") or {}).items():
            if not (w.get("shots") or w.get("hits") or w.get("kills")):
                continue          # nie benutzt — keine Zeile wert
            zones = w.get("zones") or {}
            row = {"account_id": acc, "player_name": name,
                   "team_id": p.get("teamId"), "is_bot": bool(p.get("isBot")),
                   "weapon": weapon,
                   "shots": w.get("shots") or 0,
                   "hit_attacks": w.get("hitAttacks") or 0,
                   "hits": w.get("hits") or 0,
                   "damage": float(w.get("damage") or 0.0),
                   "kills": w.get("kills") or 0}
            for z, col in _ZONE_COL.items():
                row[col] = zones.get(z, 0)
            rows.append(row)
    return rows


def db_rows_to_display(rows, group_by: str = "weapon") -> list:
    """Rohsummen aus aggregate_weapon_stats -> Anzeige-Werte.

    Die Quoten entstehen bewusst erst hier, aus den Summen — nicht in SQL
    und nicht als Mittel der Einzelmatch-Quoten.
    """
    out = []
    for r in rows or []:
        zones = {z: int(r.get(col) or 0) for z, col in _ZONE_COL.items()}
        zones = {z: n for z, n in zones.items() if n}
        acc = dict(r)
        acc["zones"] = zones
        acc["shots"] = int(r.get("shots") or 0)
        acc["hits"] = int(r.get("hits") or 0)
        acc["hitAttacks"] = int(r.get("hit_attacks") or 0)
        acc["damage"] = float(r.get("damage") or 0.0)
        acc["kills"] = int(r.get("kills") or 0)
        acc["matches"] = int(r.get("matches") or 0)
        out.append(_finish(acc))
    out.sort(key=lambda r: -r["damage"])
    return out


def _blank(key: dict) -> dict:
    d = dict(key)
    d.update({"shots": 0, "hits": 0, "hitAttacks": 0, "damage": 0.0,
              "kills": 0, "matches": 0, "zones": {}})
    return d


def _merge(acc: dict, w: dict) -> None:
    acc["shots"] += w.get("shots") or 0
    acc["hits"] += w.get("hits") or 0
    acc["hitAttacks"] += w.get("hitAttacks") or 0
    acc["damage"] += w.get("damage") or 0.0
    acc["kills"] += w.get("kills") or 0
    for z, n in (w.get("zones") or {}).items():
        acc["zones"][z] = acc["zones"].get(z, 0) + n


def _finish(acc: dict) -> dict:
    shots, hits, landed = acc["shots"], acc["hits"], acc["hitAttacks"]
    zones = acc["zones"]
    total_z = sum(zones.values())
    top = max(zones.items(), key=lambda t: t[1])[0] if zones else None
    acc["accuracy"] = round(min(100.0, 100.0 * landed / shots), 1) if shots else 0.0
    # Drei Nenner, drei Fragen — siehe telemetry_analysis._weapon_out.
    acc["avgDamage"] = round(acc["damage"] / hits, 1) if hits else 0.0
    acc["avgDamagePerLandedShot"] = round(acc["damage"] / landed, 1) if landed else 0.0
    acc["avgDamagePerShot"] = round(acc["damage"] / shots, 1) if shots else 0.0
    acc["headshotRate"] = round(100.0 * zones.get("HeadShot", 0) / hits, 1) if hits else 0.0
    # Siehe telemetry_analysis: Splitterwaffen erkennt man daran, dass mehr
    # Einschlaege als getroffene Schuesse anfallen.
    acc["splits"] = hits > landed > 0
    acc["avgDamageEffective"] = (acc["avgDamagePerLandedShot"] if acc["splits"]
                                 else acc["avgDamage"])
    acc["topZone"] = top
    acc["topZonePct"] = round(100.0 * zones[top] / total_z, 1) if top and total_z else 0.0
    acc["damage"] = round(acc["damage"], 1)
    return acc


def aggregate(analyses, player: str = None, group_by: str = "weapon") -> dict:
    """Fasst mehrere Match-Analysen zusammen.

    group_by="weapon" (default): eine Zeile je Waffe — "womit treffe ich am
    besten". Braucht `player`.
    group_by="player": eine Zeile je Spieler — Squad-Vergleich.

    Quoten werden aus den SUMMEN gerechnet, nicht als Mittel der
    Einzelmatch-Quoten: sonst zaehlt ein 5-Schuss-Match so viel wie eines
    mit 200 Schuessen.
    """
    buckets = {}
    seen_matches = 0
    for a in analyses or []:
        players = (a or {}).get("players") or {}
        if not players:
            continue
        seen_matches += 1
        for name, p in players.items():
            if group_by == "weapon" and player and name != player:
                continue
            if group_by == "player" and player and name != player and player in players:
                pass    # Vergleichsmodus zeigt alle Squad-Mitglieder
            for w, wd in (p.get("weapons") or {}).items():
                if not (wd.get("shots") or wd.get("hits")):
                    continue     # nie benutzt — keine Zeile wert
                key = (name,) if group_by == "player" else (w,)
                if key not in buckets:
                    buckets[key] = _blank({"player": name} if group_by == "player"
                                          else {"weapon": w})
                    buckets[key]["_matchids"] = set()
                _merge(buckets[key], wd)
                buckets[key]["_matchids"].add(id(a))

    rows = []
    for acc in buckets.values():
        acc["matches"] = len(acc.pop("_matchids"))
        rows.append(_finish(acc))
    rows.sort(key=lambda r: -r["damage"])
    return {"rows": rows, "matches": seen_matches, "groupBy": group_by}
