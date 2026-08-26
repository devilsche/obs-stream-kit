"""Analyse einer PUBG-Match-Telemetrie.

Bewusst ohne DB- und Netz-Zugriff: `analyse(events)` bekommt die rohe
Event-Liste und liefert das fertige Ergebnis. Das Besorgen der Events macht
`load_telemetry()` in pubg/telemetry_source.py (HiDrive → API).

Kennzahlen pro Spieler: Schuesse, Treffer, Accuracy, komplette
Trefferzonen-Verteilung (nicht nur Headshots — ein Aim-Assist zeigt sich
eher daran, dass EINE Zone dominiert, als an einem hohen Einzelwert),
Wallbangs, Schaden, Treffer auf Bots vs. Menschen, Waffen und
Distanz-Verteilung. Dazu eine chronologische Kill-Timeline.
"""

import math
from collections import defaultdict

#: Distanz-Eimer in Metern. Offen nach oben beim letzten.
DISTANCE_BUCKETS = ((0, 25), (25, 50), (50, 100), (100, 200), (200, None))

#: Nur echter Waffenschaden zaehlt als Zielleistung — Blauzone, Sturz,
#: Fahrzeug und Molotov sagen nichts ueber Aim aus.
GUN_CATEGORY = "Damage_Gun"


def normalize_weapon(raw):
    """Vereinheitlicht die zwei Schreibweisen derselben Waffe.

    Attack-Events nennen sie `Item_Weapon_ACE32_C`, Damage-Events
    `WeapACE32_C`. Ohne das laesst sich keine Trefferquote pro Waffe bilden.
    Unbekannte Muster (Fahrzeuge, Umwelt) werden nur vom `_C`-Suffix befreit.
    """
    if not raw:
        return None
    name = str(raw)
    if name.endswith("_C"):
        name = name[:-2]
    if name.startswith("Item_Weapon_"):
        name = name[len("Item_Weapon_"):]
    elif name.startswith("Weap"):
        name = name[len("Weap"):]
    return name or None


def _bucket_label(lo, hi):
    return f"{lo}-{hi}" if hi is not None else f"{lo}+"


def _bucket_for(meters):
    for lo, hi in DISTANCE_BUCKETS:
        if meters >= lo and (hi is None or meters < hi):
            return _bucket_label(lo, hi)
    return None


def _is_bot(participant):
    """PUBG fuehrt Bots mit account_id-Praefix `ai.` (siehe auch die
    team_id>=200-Heuristik in aggregations.py — beide decken sich)."""
    return str((participant or {}).get("accountId") or "").startswith("ai.")


def _loc(participant):
    l = (participant or {}).get("location") or {}
    x, y = l.get("x"), l.get("y")
    return (x, y) if x is not None and y is not None else (None, None)


def _new_player():
    return {"shots": 0, "hits": 0, "hit_attacks": set(), "hits_no_id": 0,
            "damage": 0.0, "kills": 0, "knocks": 0,
            "wallbangs": 0, "hitsOnBots": 0, "hitsOnHumans": 0,
            "zones": defaultdict(int),
            "weapons": defaultdict(lambda: {"shots": 0, "hits": 0}),
            "byDistance": defaultdict(lambda: {"hits": 0, "headshots": 0})}


def analyse(events) -> dict:
    """Wertet die Event-Liste aus. Siehe Modul-Docstring."""
    players = defaultdict(_new_player)
    kills = []

    for e in events or []:
        t = e.get("_T")

        if t == "LogPlayerAttack":
            if e.get("attackType") != "Weapon":
                continue                      # Fahrzeug-Rammen ist kein Schuss
            name = (e.get("attacker") or {}).get("name")
            if not name:
                continue
            p = players[name]
            p["shots"] += 1
            w = normalize_weapon((e.get("weapon") or {}).get("itemId"))
            if w:
                p["weapons"][w]["shots"] += 1

        elif t == "LogPlayerTakeDamage":
            attacker = e.get("attacker") or {}
            victim = e.get("victim") or {}
            name = attacker.get("name")
            # Selbstschaden wuerde die Trefferquote schoenen bzw. verfaelschen.
            if not name or name == victim.get("name"):
                continue
            if e.get("damageTypeCategory") != GUN_CATEGORY:
                continue
            p = players[name]
            p["hits"] += 1
            # Accuracy braucht SCHUESSE, nicht Einschlaege: eine Schrotladung
            # erzeugt ein TakeDamage-Event pro Pellet (real bis zu 9), alle mit
            # derselben attackId. Roh gezaehlt kaeme man ueber 100%.
            aid = e.get("attackId")
            if aid is None or aid == -1:
                p["hits_no_id"] += 1      # altes Schema: lieber zaehlen als verlieren
            else:
                p["hit_attacks"].add(aid)
            p["damage"] += e.get("damage") or 0.0
            if e.get("isThroughPenetrableWall"):
                p["wallbangs"] += 1
            if _is_bot(victim):
                p["hitsOnBots"] += 1
            else:
                p["hitsOnHumans"] += 1
            zone = e.get("damageReason")
            if zone:
                p["zones"][zone] += 1
            w = normalize_weapon(e.get("damageCauserName"))
            if w:
                p["weapons"][w]["hits"] += 1
            ax, ay = _loc(attacker)
            vx, vy = _loc(victim)
            if None not in (ax, ay, vx, vy):
                b = _bucket_for(math.dist((ax, ay), (vx, vy)) / 100.0)
                if b:
                    p["byDistance"][b]["hits"] += 1
                    if zone == "HeadShot":
                        p["byDistance"][b]["headshots"] += 1

        elif t in ("LogPlayerKillV2", "LogPlayerKill"):
            if e.get("isSuicide"):
                continue
            killer = e.get("killer") or e.get("finisher") or {}
            victim = e.get("victim") or {}
            kname, vname = killer.get("name"), victim.get("name")
            if not kname or not vname or kname == vname:
                continue     # Suizid/Zonentod hat keinen echten Killer
            info = e.get("killerDamageInfo") or e.get("finishDamageInfo") or {}
            kx, ky = _loc(killer)
            dist_cm = info.get("distance")
            kills.append({
                "time": e.get("_D"),
                "killer": kname,
                "victim": vname,
                "victimIsBot": _is_bot(victim),
                "weapon": normalize_weapon(info.get("damageCauserName")),
                "zone": info.get("damageReason"),
                "distanceM": round(dist_cm / 100.0, 1) if dist_cm is not None else None,
                "throughWall": bool(info.get("isThroughPenetrableWall")),
                "x": kx, "y": ky,
            })
            players[kname]["kills"] += 1

        elif t == "LogPlayerMakeGroggy":
            name = (e.get("attacker") or {}).get("name")
            if name:
                players[name]["knocks"] += 1

    kills.sort(key=lambda k: k["time"] or "")

    out = {}
    for name, p in players.items():
        hits, shots = p["hits"], p["shots"]
        hit_attacks = len(p["hit_attacks"]) + p["hits_no_id"]
        zones = dict(p["zones"])
        total_zone = sum(zones.values())
        out[name] = {
            "shots": shots,
            "hits": hits,                 # Einschlaege — Basis der Zonenverteilung
            "hitAttacks": hit_attacks,    # getroffene Schuesse — Basis der Accuracy
            "accuracy": (round(min(100.0, 100.0 * hit_attacks / shots), 1)
                         if shots else 0.0),
            "damage": round(p["damage"], 1),
            "kills": p["kills"],
            "knocks": p["knocks"],
            "wallbangs": p["wallbangs"],
            "hitsOnBots": p["hitsOnBots"],
            "hitsOnHumans": p["hitsOnHumans"],
            "zones": zones,
            "zonePct": {z: round(100.0 * n / total_zone, 1)
                        for z, n in zones.items()} if total_zone else {},
            "headshotRate": (round(100.0 * zones.get("HeadShot", 0) / hits, 1)
                             if hits else 0.0),
            "weapons": {w: dict(v) for w, v in p["weapons"].items()},
            "byDistance": {b: dict(v) for b, v in p["byDistance"].items()},
        }
    return {"players": out, "kills": kills}
