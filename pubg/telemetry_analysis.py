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

#: Ab dieser Distanz (m) ist kein Gegner mehr plausibel treffbar. Ein Schuss
#: ohne Gegner darin ist ein "Leerschuss" — relevant, weil sich damit die
#: eigene Accuracy druecken laesst.
TARGET_RANGE_M = 300.0

#: Positions-Events kommen alle ~10 s. Fuer die Naehe-Pruefung wird deshalb
#: in 10-s-Faechern gesucht, mit einem Fach Toleranz nach vorn und hinten.
POS_BUCKET_S = 10


def normalize_weapon(raw):
    """Liefert den Namen AUS DEM SPIEL, egal in welcher Schreibweise die
    Waffe im Event steht.

    Zwei Probleme auf einmal: Attack-Events nennen sie `Item_Weapon_HK416_C`,
    Damage-Events `WeapHK416_C` — ohne Vereinheitlichung laesst sich keine
    Trefferquote pro Waffe bilden. Und die internen IDs sind nicht die Namen
    aus dem Spiel: FNFal heisst SLR, HK416 heisst M416, Berreta686 heisst
    S686. Dafuer gibt es WEAPON_NAMES in aggregations.py, gepflegt aus
    pubg/api-assets.
    """
    if not raw:
        return None
    name = str(raw)
    # Attack-Schreibweise auf die Damage-Schreibweise ziehen, weil die
    # Nachschlagetabelle darauf aufgebaut ist.
    if name.startswith("Item_Weapon_"):
        name = "Weap" + name[len("Item_Weapon_"):]
    from pubg.aggregations import _weapon_label
    label = _weapon_label(name)[0]
    return label or None


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


def _parse_ts(iso):
    """ISO-Zeitstempel -> Sekunden. None bei Murks, damit ein einzelnes
    kaputtes Event nicht die ganze Auswertung kippt."""
    if not iso:
        return None
    try:
        import datetime
        return datetime.datetime.fromisoformat(
            str(iso).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _position_index(events):
    """{zeit-fach: [(name, teamId, x, y)]} aller LEBENDEN Spieler."""
    idx = defaultdict(list)
    for e in events or []:
        if e.get("_T") != "LogPlayerPosition":
            continue
        c = e.get("character") or {}
        loc = c.get("location") or {}
        if not c.get("name") or loc.get("x") is None or loc.get("y") is None:
            continue
        if (c.get("health") or 0) <= 0:
            continue                       # Tote sind keine Ziele
        t = _parse_ts(e.get("_D"))
        if t is None:
            continue
        idx[int(t // POS_BUCKET_S)].append(
            (c["name"], c.get("teamId"), loc["x"], loc["y"]))
    return idx


def _enemy_within(idx, t, x, y, shooter, team, max_m=TARGET_RANGE_M):
    """War zum Schusszeitpunkt ein lebender GEGNER in Reichweite?
    None = keine Positionsdaten in der Naehe, also keine Aussage moeglich."""
    if t is None or not idx:
        return None
    b = int(t // POS_BUCKET_S)
    seen = False
    for bb in (b - 1, b, b + 1):
        for name, tid, px, py in idx.get(bb, ()):
            seen = True
            if name == shooter:
                continue
            if team is not None and tid == team:
                continue          # eigenes Team ist kein Ziel
            if math.dist((x, y), (px, py)) / 100.0 <= max_m:
                return True
    return False if seen else None


def _new_player():
    return {"shots": 0, "shots_with_target": 0, "shots_judged": 0, "hits": 0, "hit_attacks": set(), "hits_no_id": 0,
            "damage": 0.0, "kills": 0, "knocks": 0,
            "wallbangs": 0, "hitsOnBots": 0, "hitsOnHumans": 0,
            "zones": defaultdict(int),
            "weapons": defaultdict(lambda: {"shots": 0, "hits": 0, "damage": 0.0,
                                            "hit_attacks": set(), "hits_no_id": 0,
                                            "zones": defaultdict(int)}),
            "byDistance": defaultdict(lambda: {"hits": 0, "headshots": 0})}


def _weapon_out(v: dict) -> dict:
    """Ausgabe-Form einer Waffe: Rohwerte plus die drei abgeleiteten Groessen,
    die man beim Vergleich tatsaechlich liest."""
    hit_attacks = len(v["hit_attacks"]) + v["hits_no_id"]
    zones = dict(v["zones"])
    top = max(zones.items(), key=lambda t: t[1])[0] if zones else None
    total_z = sum(zones.values())
    return {
        "shots": v["shots"],
        "hits": v["hits"],                 # Einschlaege (Schrot: pro Pellet)
        "hitAttacks": hit_attacks,         # getroffene Schuesse
        "accuracy": (round(min(100.0, 100.0 * hit_attacks / v["shots"]), 1)
                     if v["shots"] else 0),
        "damage": round(v["damage"], 1),
        # Schnitt pro Einschlag: haengt an Zone und Helm, deshalb
        # aussagekraeftiger als die Summe.
        "avgDamage": round(v["damage"] / v["hits"], 1) if v["hits"] else 0,
        "topZone": top,
        "topZonePct": (round(100.0 * zones[top] / total_z, 1)
                       if top and total_z else 0),
        "zones": zones,
    }


def analyse(events) -> dict:
    """Wertet die Event-Liste aus. Siehe Modul-Docstring."""
    players = defaultdict(_new_player)
    kills = []
    pos_idx = _position_index(events)
    # LogPlayerCreate ist das vollstaendige Teilnehmer-Roster. Ohne das fehlen
    # Spieler, die nie schiessen, treffen oder sterben — in einem gemessenen
    # Match 3 von 100.
    roster = set()
    for e in events or []:
        if e.get("_T") == "LogPlayerCreate":
            n = (e.get("character") or {}).get("name")
            if n:
                roster.add(n)
                players[n]           # anlegen, damit sie in der Ausgabe stehen
    # Team-Zuordnung aus allen Events sammeln — LogPlayerAttack fuehrt die
    # teamId nicht immer mit.
    team_of = {}
    bot_of = {}
    for e in events or []:
        for f in ("character", "attacker", "victim", "killer", "finisher"):
            q = e.get(f) or {}
            if not q.get("name"):
                continue
            if q.get("teamId") is not None:
                team_of.setdefault(q["name"], q["teamId"])
            # Zwei Signale, die sich decken (siehe aggregations.py):
            # ai.-accountId und team_id >= 200.
            if _is_bot(q) or (q.get("teamId") or 0) >= 200:
                bot_of[q["name"]] = True

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
            # Leerschuss-Pruefung: Accuracy laesst sich druecken, indem man
            # ohne Gegner in Reichweite schiesst. Die Zonenverteilung ist
            # dagegen immun — sie kennt nur Treffer.
            loc = (e.get("attacker") or {}).get("location") or {}
            if loc.get("x") is not None:
                near = _enemy_within(pos_idx, _parse_ts(e.get("_D")),
                                     loc["x"], loc["y"], name, team_of.get(name))
                if near is not None:
                    p["shots_judged"] += 1
                    if near:
                        p["shots_with_target"] += 1
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
                wp = p["weapons"][w]
                wp["hits"] += 1
                wp["damage"] += e.get("damage") or 0.0
                # Wie oben: Accuracy zaehlt Schuesse, nicht Pellets.
                if aid is None or aid == -1:
                    wp["hits_no_id"] += 1
                else:
                    wp["hit_attacks"].add(aid)
                if zone:
                    wp["zones"][zone] += 1
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
            players[vname]        # Opfer anlegen: wer nur stirbt, fehlt sonst

        elif t == "LogPlayerMakeGroggy":
            name = (e.get("attacker") or {}).get("name")
            if name:
                players[name]["knocks"] += 1

    kills.sort(key=lambda k: k["time"] or "")

    # Wer im Roster steht, aber keinerlei Kampf-Events hat: dafuer liegt
    # schlicht nichts vor — das gehoert ausgewiesen, nicht verschwiegen.
    without = sorted(n for n, p in players.items()
                     if p["shots"] == 0 and p["hits"] == 0
                     and p["kills"] == 0 and p["knocks"] == 0)

    out = {}
    for name, p in players.items():
        hits, shots = p["hits"], p["shots"]
        hit_attacks = len(p["hit_attacks"]) + p["hits_no_id"]
        zones = dict(p["zones"])
        total_zone = sum(zones.values())
        out[name] = {
            "teamId": team_of.get(name),
            "isBot": bool(bot_of.get(name)),
            "shots": shots,
            "shotsWithTarget": p["shots_with_target"],
            "emptyShotPct": (round(100.0 * (p["shots_judged"] - p["shots_with_target"])
                                   / p["shots_judged"], 1)
                             if p["shots_judged"] else None),
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
            "weapons": {w: _weapon_out(v) for w, v in p["weapons"].items()},
            "byDistance": {b: dict(v) for b, v in p["byDistance"].items()},
        }
    return {"players": out, "kills": kills,
            "rosterSize": len(roster),
            "playersWithoutEvents": without}


# ── Auffaelligkeits-Bewertung ───────────────────────────────────────────────

#: Zonen, die beim Sprayen durch Rueckstoss-Streuung zwangslaeufig anfallen.
LIMB_ZONES = ("ArmShot", "LegShot", "PelvisShot")

#: Unterhalb dieser Einschlagzahl ist jede Aussage Rauschen.
MIN_HITS_FOR_JUDGEMENT = 30


def _binom_cdf(k: int, n: int, p: float) -> float:
    """P(X <= k) fuer Binomial(n, p). Kein scipy im Projekt, also selbst."""
    if n <= 0:
        return 1.0
    p = min(max(p, 1e-9), 1 - 1e-9)
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))


def flag_anomalies(analysis: dict, min_hits: int = MIN_HITS_FOR_JUDGEMENT) -> dict:
    """Sucht Spieler, deren TREFFERMUSTER nicht zu menschlichem Zielen passt.

    Das entscheidende Signal ist nicht ein hoher Wert, sondern ein unnatuerliches
    Muster. Ein sehr guter Spieler hat hohe Accuracy UND normale Streuung; ein
    Aim-Assist zieht auf einen festen Koerperpunkt und laesst Arme, Beine und
    Becken praktisch aus. Geprueft wird deshalb gegen die Referenz DIESES
    Matches — kein fester Schwellwert, der je nach Map und Spielweise driftet.

    Zweites Signal: eine Kopftrefferquote, die mit der Entfernung STEIGT. Auf
    Distanz ist ein Kopf ein kleineres Ziel; menschlich faellt die Quote.

    Weil hier viele Spieler gleichzeitig getestet werden, steht die
    Bonferroni-Schwelle im Ergebnis: ohne sie findet man in jedem grossen Feld
    einen scheinbaren Ausreisser.

    Returns {name: {limbPct, expectedLimbPct, pValue, bonferroniThreshold,
    tested, significantCorrected, flags:[...]}} — nur fuer Spieler mit
    mindestens `min_hits` Einschlaegen.
    """
    players = (analysis or {}).get("players") or {}
    candidates = {n: p for n, p in players.items() if p.get("hits", 0) >= min_hits}
    if len(candidates) < 3:
        # Zu wenig Vergleichsbasis — ein Spieler waere sein eigener Massstab.
        return {}

    total_hits = sum(p["hits"] for p in candidates.values())
    total_limb = sum(sum(p["zones"].get(z, 0) for z in LIMB_ZONES)
                     for p in candidates.values())
    ref = (total_limb / total_hits) if total_hits else 0.0
    threshold = 0.01 / len(candidates)

    out = {}
    for name, p in candidates.items():
        hits = p["hits"]
        limb = sum(p["zones"].get(z, 0) for z in LIMB_ZONES)
        pval = _binom_cdf(limb, hits, ref) if ref > 0 else 1.0
        flags = []
        if pval < threshold:
            flags.append("narrow_hit_pattern")
        if p.get("wallbangs", 0) > 0:
            flags.append("wallbangs")

        # Kopftrefferquote nah vs. fern — nur bewerten wenn beide Seiten
        # ueberhaupt Substanz haben.
        near = p["byDistance"].get("0-25", {})
        far_hits = far_hs = 0
        for b in ("50-100", "100-200", "200+"):
            v = p["byDistance"].get(b) or {}
            far_hits += v.get("hits", 0)
            far_hs += v.get("headshots", 0)
        # Nur mit belastbarer Stichprobe UND statistischem Test: mit einem
        # blossen Faktor-Kriterium feuerte das Flag bei 27 von 29 Spielern,
        # weil 8 ferne Treffer jede Quote zufaellig aussehen lassen.
        if near.get("hits", 0) >= 20 and far_hits >= 20:
            near_rate = near.get("headshots", 0) / near["hits"]
            far_rate = far_hs / far_hits
            # P(mindestens so viele ferne Kopftreffer wie beobachtet, wenn die
            # NAHE Rate gaelte). Klein = die Steigerung ist kein Zufall.
            p_more = 1.0 - _binom_cdf(far_hs - 1, far_hits, max(near_rate, 0.01))
            if far_rate > near_rate * 2 and p_more < 0.01:
                flags.append("headshot_rate_rises_with_distance")

        out[name] = {
            "hits": hits,
            "limbHits": limb,
            "limbPct": round(100.0 * limb / hits, 1),
            "expectedLimbPct": round(100.0 * ref, 1),
            "pValue": pval,
            "bonferroniThreshold": threshold,
            "tested": len(candidates),
            "significantCorrected": pval < threshold,
            "flags": flags,
        }
    return out
