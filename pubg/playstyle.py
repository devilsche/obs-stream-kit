"""Spielstil und Kampf-Ausgaenge je Squad-Mate.

Beantwortet die Fragen, die eine Kill-Statistik nicht beantwortet: Wer
eroeffnet die Gefechte, gehen die aus wie erhofft, wer haengt zu weit hinten
oder zu weit vorne, und wer geht zuerst runter.

Datenquelle ist `telemetry_events` — also auch rueckwirkend, ohne Roh-Blob.
Zu beachten, was dort steht (siehe pubg/telemetry.py::filter_squad_events):
Position-Events gibt es NUR fuer das eigene Squad, Schadens-Events nur mit
Squad-Beteiligung. Fuer eine Squad-Auswertung reicht das genau; fuer Aussagen
ueber fremde Teams untereinander nicht.

Aufbau: die Rechenkerne (`build_fights`, `player_metrics`, `analyse_match`,
`aggregate`) arbeiten auf Event-Listen und kennen keine DB. Das DB-Holen sitzt
in `compute_squad_playstyle` ganz unten.
"""
import math
from collections import defaultdict

#: Pause, nach der ein erneuter Schusswechsel als NEUES Gefecht zaehlt.
FIGHT_GAP_MS = 45_000
#: Knocks fallen oft Sekunden nach dem letzten Treffer — so lange zaehlen sie
#: noch zum Gefecht.
FIGHT_TAIL_MS = 60_000
#: Position feuert etwa alle 10 s; so weit duerfen zwei Punkte fuer einen
#: Vergleich auseinanderliegen.
POS_PAIR_MS = 15_000
#: Bis zu diesem Versatz je Intervall gilt jemand als stehend.
STILL_M = 5.0
#: Ab hier ist ein Mate "weit weg" vom Rest.
FAR_M = 100.0
#: Positionen aus diesem Fenster VOR dem Knock beschreiben die Lage beim Knock.
DOWN_LOOKBACK_MS = 25_000
#: Pickups in dieser Zeit nach der Landung sind die erste Loot-Runde.
EARLY_LOOT_MS = 300_000

CM_PER_M = 100.0
DAMAGE_EVENTS = ("TakeDamage",)
DOWN_EVENTS = ("Knock", "Kill")
REVIVE_EVENTS = ("Revive",)
PICKUP_EVENTS = ("ItemPickup", "ItemPickupBox")


def is_bot(account_id) -> bool:
    """PUBG vergibt Bots account_ids mit `ai.`-Praefix."""
    return isinstance(account_id, str) and account_id.startswith("ai.")


def _dist_m(x1, y1, x2, y2):
    if None in (x1, y1, x2, y2):
        return None
    return math.hypot(x1 - x2, y1 - y2) / CM_PER_M


def _median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    n = len(vals)
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2.0


def _mean(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def _g(row, key):
    """Feld-Zugriff fuer dicts und sqlite3.Row gleichermassen."""
    try:
        return row[key]
    except (KeyError, IndexError):
        return None


def _pct(part, whole):
    return (100.0 * part / whole) if whole else None


# ── Gefechte ────────────────────────────────────────────────────────────────

def build_fights(events, squad, team_of, *, include_bots=False,
                 gap_ms=FIGHT_GAP_MS, tail_ms=FIGHT_TAIL_MS):
    """Schadens- und Down-Events → Liste von Gefechten des Squads.

    Ein Gefecht ist "unser Squad gegen EIN gegnerisches Team"; nach `gap_ms`
    ohne Schaden beginnt gegen dasselbe Team ein neues. Bewusst teambezogen
    und nicht spielerbezogen: der Ausgang entscheidet sich zwischen den Teams,
    nicht zwischen zwei Accounts.

    Jedes Gefecht:
      opener      — Mate, der zuerst Schaden gemacht hat (None, wenn der
                    Gegner angefangen hat)
      openedByUs  — ob wir es eroeffnet haben
      engagedBy   — Mate, der als erster von uns Schaden gemacht hat (auch
                    wenn der Gegner eroeffnet hat)
      openDist    — Distanz beim eroeffnenden Treffer, in Metern
      ourDowns / theirDowns — umgelegte Spieler je Seite. Knock und der
                    spaetere Finisher sind EIN Down, auch ueber Gefechts-
                    grenzen hinweg; nach einem Revive zaehlt der naechste
                    Knock wieder (siehe counting_downs)
      result      — won | lost | trade | pointless
    """
    squad_ids = set(squad)

    def foe_team(acc):
        if acc is None or acc in squad_ids:
            return None
        if not include_bots and is_bot(acc):
            return None
        return team_of.get(acc, f"unknown:{acc}")

    # 1) Schadensereignisse zu Gefechten je Gegner-Team clustern
    clusters = defaultdict(list)          # foe_team -> [event-tupel]
    for e in sorted(events, key=lambda r: (_g(r, "timestamp_ms") or 0)):
        if _g(e, "event_type") not in DAMAGE_EVENTS:
            continue
        ts = _g(e, "timestamp_ms")
        if ts is None:
            continue
        actor, target = _g(e, "actor_account"), _g(e, "target_account")
        if actor in squad_ids and target not in squad_ids:
            ft = foe_team(target)
            if ft is None:
                continue
            clusters[ft].append((ts, "us", actor, target, e))
        elif target in squad_ids and actor not in squad_ids:
            ft = foe_team(actor)
            if ft is None:
                continue
            clusters[ft].append((ts, "them", actor, target, e))
        # Schaden zwischen zwei fremden Teams geht uns nichts an.

    fights = []
    for ft, evs in clusters.items():
        evs.sort(key=lambda x: x[0])
        cur = None
        for item in evs:
            ts = item[0]
            if cur is None or ts - cur["lastTs"] > gap_ms:
                cur = {"foeTeam": ft, "startTs": ts, "lastTs": ts,
                       "opener": None, "openedByUs": False, "engagedBy": None,
                       "openDist": None, "openTarget": None,
                       "openTargetDown": False, "openTargetDownBySelf": False,
                       "ourDowns": 0, "theirDowns": 0, "result": "pointless"}
                fights.append(cur)
                _set_opening(cur, item)
            else:
                cur["lastTs"] = ts
                if cur["engagedBy"] is None and item[1] == "us":
                    cur["engagedBy"] = item[2]

    # 2) Downs zuordnen — nur die Ereignisse, die wirklich jemanden umlegen.
    #    Dabei festhalten, WER umgelegt hat: wer einen Kampf anfaengt, ist
    #    nicht zwangslaeufig der, der trifft.
    downed = {id(f): {"ours": 0, "theirs": 0, "by": defaultdict(int),
                      "lost": []} for f in fights}
    for e in counting_downs(events):
        ts = _g(e, "timestamp_ms")
        actor, target = _g(e, "actor_account"), _g(e, "target_account")
        if ts is None or not target:
            continue
        if actor in squad_ids and target not in squad_ids:
            ft, side, victim = foe_team(target), "theirs", target
        elif target in squad_ids and actor not in squad_ids:
            ft, side, victim = foe_team(actor), "ours", target
        else:
            continue
        if ft is None:
            continue
        for f in fights:
            if f["foeTeam"] == ft and f["startTs"] <= ts <= f["lastTs"] + tail_ms:
                downed[id(f)][side] += 1
                if side == "theirs":
                    if actor:
                        downed[id(f)]["by"][actor] += 1
                    if victim and victim == f.get("openTarget"):
                        f["openTargetDown"] = True
                        f["openTargetDownBySelf"] = (actor == f.get("opener"))
                elif side == "ours":
                    downed[id(f)]["lost"].append(victim)
                break

    for f in fights:
        f["ourDowns"] = downed[id(f)]["ours"]
        f["theirDowns"] = downed[id(f)]["theirs"]
        f["downsBy"] = dict(downed[id(f)]["by"])
        f["lostBy"] = downed[id(f)]["lost"]
        f["result"] = _result(f["theirDowns"], f["ourDowns"])
    fights.sort(key=lambda f: f["startTs"])
    return fights


def counting_downs(events):
    """Down-Ereignisse, die wirklich EINEN erledigten Spieler bedeuten.

    Knock und der spaetere Finisher-Kill sind derselbe Vorgang — auch wenn
    Minuten und ein Gefechtswechsel dazwischen liegen. Gezaehlt wird deshalb
    nur, wer gerade steht: ein Knock legt ihn, ein `Revive` stellt ihn wieder
    hin (dann zaehlt der naechste Knock erneut), ein Kill legt ihn endgueltig.

    Ein Kill OHNE vorherigen Knock zaehlt normal — der letzte Spieler eines
    Teams stirbt ohne DBNO, das sind an Prod-Daten gemessen rund 27 % aller
    Kills.

    Returns die Teilmenge der Events, die als Down zaehlt.
    """
    down_now = set()
    counted = []
    for e in sorted(events, key=lambda r: (_g(r, "timestamp_ms") or 0)):
        et = _g(e, "event_type")
        victim = _g(e, "target_account")
        if not victim:
            continue
        if et in REVIVE_EVENTS:
            down_now.discard(victim)
        elif et in DOWN_EVENTS:
            if victim in down_now:
                continue            # liegt schon — derselbe Vorgang
            down_now.add(victim)
            counted.append(e)
    return counted


def _set_opening(fight, item):
    ts, side, actor, target, raw = item
    if side == "us":
        fight["opener"] = actor
        fight["openedByUs"] = True
        fight["engagedBy"] = actor
        # Wen er zuerst getroffen hat — die Frage "ich treffe zuerst, geht der
        # um?" meint genau diesen Spieler, nicht irgendeinen aus dem Team.
        fight["openTarget"] = target
        fight["openDist"] = _dist_m(_g(raw, "actor_x"), _g(raw, "actor_y"),
                                    _g(raw, "victim_x"), _g(raw, "victim_y"))


def _result(their_downs, our_downs):
    if their_downs > our_downs:
        return "won"
    if our_downs > their_downs:
        return "lost"
    return "trade" if their_downs else "pointless"


# ── Spielstil je Spieler ────────────────────────────────────────────────────

def player_metrics(events, squad, team_of, *, still_m=STILL_M, far_m=FAR_M):
    """Bewegungs-, Loot- und Sterbe-Kennzahlen je Squad-Mate fuer EIN Match."""
    squad_ids = set(squad)
    positions = defaultdict(list)      # acc -> [(ts, x, y)]
    pickups = defaultdict(list)
    landing, downs = {}, {}
    last_ts = defaultdict(int)
    first_ts = None

    for e in sorted(events, key=lambda r: (_g(r, "timestamp_ms") or 0)):
        ts, et = _g(e, "timestamp_ms"), _g(e, "event_type")
        if ts is None:
            continue
        first_ts = ts if first_ts is None else first_ts
        actor, target = _g(e, "actor_account"), _g(e, "target_account")
        if et == "Position" and actor in squad_ids:
            positions[actor].append((ts, _g(e, "actor_x"), _g(e, "actor_y")))
            last_ts[actor] = max(last_ts[actor], ts)
        elif et in PICKUP_EVENTS and actor in squad_ids:
            pickups[actor].append(ts)
            last_ts[actor] = max(last_ts[actor], ts)
        elif et == "Landing" and actor in squad_ids:
            landing.setdefault(actor, ts)
        elif et in DOWN_EVENTS and target in squad_ids:
            downs.setdefault(target, ts)

    first_down_acc = min(downs.items(), key=lambda kv: kv[1])[0] if downs else None

    out = {}
    for acc in squad_ids:
        pts = sorted(positions.get(acc) or [])
        t_start = landing.get(acc) or (pts[0][0] if pts else first_ts) or 0
        t_end = downs.get(acc) or last_ts.get(acc) or t_start
        alive_min = max((t_end - t_start) / 60000.0, 0.0)

        picks = [ts for ts in pickups.get(acc, []) if ts >= t_start]
        early = sum(1 for ts in picks if ts - t_start <= EARLY_LOOT_MS)

        still = _stillness(pts, t_start, t_end, still_m)
        team_dists = _team_distances(acc, pts, positions)
        out[acc] = {
            "accountId": acc,
            "name": squad.get(acc),
            "aliveMin": alive_min or None,
            "pickups": len(picks),
            "pickupsEarly": early,
            "pickupsLate": len(picks) - early,
            "pickupsPerMin": (len(picks) / alive_min) if alive_min else None,
            "stillShare": _pct(still["still_ms"], still["total_ms"]),
            "stillLateShare": _pct(still["late_still_ms"], still["late_ms"]),
            "stillMaxMin": still["max_run_ms"] / 60000.0 if still["total_ms"] else None,
            # Rohzaehler, damit die Aggregation ueber Matches Summen bilden
            # kann statt Match-Quoten zu mitteln.
            "stillMs": still["still_ms"],
            "stillTotalMs": still["total_ms"],
            "stillLateMs": still["late_still_ms"],
            "stillLateTotalMs": still["late_ms"],
            "teamDistMedian": _median(team_dists) if team_dists else None,
            "farShare": (_pct(sum(1 for d in team_dists if d > far_m),
                              len(team_dists)) if team_dists else None),
            "farCount": sum(1 for d in team_dists if d > far_m),
            "distCount": len(team_dists),
            "wentDown": acc in downs,
            "firstDown": acc == first_down_acc,
            "distAtDown": _dist_at_down(acc, downs, positions),
        }
    return out


def _stillness(pts, t_start, t_end, still_m):
    """Rohzaehler zum Stillstehen: {still_ms, total_ms, late_still_ms,
    late_ms, max_run_ms}.

    Bewusst Zaehler statt Prozente — ueber mehrere Matches muessen die Anteile
    aus Summen gebildet werden, sonst wiegt ein 20-Sekunden-Match so schwer
    wie ein volles.

    Frueh stehen ist Looten, spaet stehen ist Halten — darum die zweite
    Lebenshaelfte getrennt.
    """
    out = {"still_ms": 0, "total_ms": 0, "late_still_ms": 0, "late_ms": 0,
           "max_run_ms": 0}
    if len(pts) < 2:
        return out
    half = t_start + (t_end - t_start) / 2.0
    run = 0
    for i in range(1, len(pts)):
        dt = pts[i][0] - pts[i - 1][0]
        if dt <= 0 or dt > 60_000:      # Luecke: nichts behaupten
            run = 0
            continue
        d = _dist_m(pts[i - 1][1], pts[i - 1][2], pts[i][1], pts[i][2])
        standing = d is not None and d < still_m
        out["total_ms"] += dt
        late = pts[i][0] >= half
        if late:
            out["late_ms"] += dt
        if standing:
            out["still_ms"] += dt
            run += dt
            out["max_run_ms"] = max(out["max_run_ms"], run)
            if late:
                out["late_still_ms"] += dt
        else:
            run = 0
    return out


def _team_distances(acc, pts, positions):
    """Distanz zum jeweils naechsten Mate, je eigenem Positions-Punkt."""
    dists = []
    for (ts, x, y) in pts:
        best = None
        for other, other_pts in positions.items():
            if other == acc:
                continue
            for (ots, ox, oy) in other_pts:
                if abs(ots - ts) > POS_PAIR_MS:
                    continue
                d = _dist_m(x, y, ox, oy)
                if d is not None and (best is None or d < best):
                    best = d
        if best is not None:
            dists.append(best)
    return dists


def _dist_at_down(acc, downs, positions):
    """Distanz zum naechsten Mate im Moment des eigenen Knocks.

    Nur Positionen VOR dem Knock: mit einem Fenster darum herum misst man den
    Mate, der zur Rettung heranlaeuft, statt der Lage beim Knock.
    """
    if acc not in downs:
        return None
    ts = downs[acc]
    own = [q for q in positions.get(acc, []) if ts - DOWN_LOOKBACK_MS <= q[0] <= ts]
    if not own:
        return None
    ox = max(own, key=lambda q: q[0])
    best = None
    for other, pts in positions.items():
        if other == acc:
            continue
        cand = [q for q in pts if ts - DOWN_LOOKBACK_MS <= q[0] <= ts]
        if not cand:
            continue
        o = max(cand, key=lambda q: q[0])
        d = _dist_m(ox[1], ox[2], o[1], o[2])
        if d is not None and (best is None or d < best):
            best = d
    return best


# ── Ein Match, dann viele ───────────────────────────────────────────────────

def analyse_match(events, squad, team_of, *, include_bots=False):
    """Ein Match → {"fights": [...], "players": {acc: metrics}}."""
    return {
        "fights": build_fights(events, squad, team_of,
                               include_bots=include_bots),
        "players": player_metrics(events, squad, team_of),
        "squad": dict(squad),
    }


def aggregate(match_analyses):
    """Match-Analysen → eine Zeile je Spieler.

    Getrennt gehalten von analyse_match, damit die Aggregation ohne Events
    testbar bleibt und der Aufrufer Matches beliebig filtern kann.
    """
    acc_data = defaultdict(lambda: {
        "name": None, "matches": 0, "downs": 0, "firstDowns": 0,
        "pickTotal": 0, "aliveTotal": 0.0,
        "stillMs": 0, "stillTotalMs": 0, "stillLateMs": 0, "stillLateTotalMs": 0,
        "farCount": 0, "distCount": 0,
        "opened": 0, "openedWon": 0, "openedLost": 0, "openedTrade": 0,
        "openedPointless": 0, "openedWithDown": 0, "openDist": [], "engaged": 0,
        "downsMade": 0, "downsBySelfInOpened": 0,
        "openTargetDown": 0, "openTargetDownBySelf": 0,
        "ourDownsInOpened": 0, "theirDownsInOpened": 0,
        "aliveMin": [], "pickups": [], "pickupsEarly": [], "pickupsLate": [],
        "teamDist": [], "distAtDown": [],
    })

    for a in match_analyses:
        for acc, m in (a.get("players") or {}).items():
            d = acc_data[acc]
            d["name"] = m.get("name") or d["name"]
            d["matches"] += 1
            if m.get("wentDown"):
                d["downs"] += 1
            if m.get("firstDown"):
                d["firstDowns"] += 1
            for key, target in (("aliveMin", "aliveMin"),
                                ("pickups", "pickups"),
                                ("pickupsEarly", "pickupsEarly"),
                                ("pickupsLate", "pickupsLate"),
                                ("teamDistMedian", "teamDist"),
                                ("distAtDown", "distAtDown")):
                v = m.get(key)
                if v is not None:
                    d[target].append(v)
            # Summen fuer alle Raten und Anteile: ein 20-Sekunden-Match mit
            # drei Pickups sind rechnerisch 9/min und wuerde als gemittelte
            # Match-Rate den ganzen Zeitraum verzerren.
            d["pickTotal"] += m.get("pickups") or 0
            d["aliveTotal"] += m.get("aliveMin") or 0.0
            for k in ("stillMs", "stillTotalMs", "stillLateMs",
                      "stillLateTotalMs", "farCount", "distCount"):
                d[k] += m.get(k) or 0

        for f in a.get("fights") or []:
            # Umgelegte Gegner zaehlen dem zu, der sie umgelegt hat — egal
            # wer den Kampf angefangen hat.
            for acc, cnt in (f.get("downsBy") or {}).items():
                acc_data[acc]["downsMade"] += cnt
            opener = f.get("opener")
            if f.get("engagedBy"):
                acc_data[f["engagedBy"]]["engaged"] += 1
            if not opener:
                continue
            d = acc_data[opener]
            d["opened"] += 1
            d["openedWon"] += f["result"] == "won"
            d["openedLost"] += f["result"] == "lost"
            d["openedTrade"] += f["result"] == "trade"
            d["openedPointless"] += f["result"] == "pointless"
            # Getrennt vom Ausgang: hier zaehlt nur, ob der Schuss ueberhaupt
            # jemanden umgelegt hat — auch wenn wir den Kampf danach verloren.
            d["openedWithDown"] += f["theirDowns"] > 0
            d["ourDownsInOpened"] += f["ourDowns"]
            d["theirDownsInOpened"] += f["theirDowns"]
            d["downsBySelfInOpened"] += (f.get("downsBy") or {}).get(opener, 0)
            d["openTargetDown"] += bool(f.get("openTargetDown"))
            d["openTargetDownBySelf"] += bool(f.get("openTargetDownBySelf"))
            if f.get("openDist") is not None:
                d["openDist"].append(f["openDist"])

    rows = []
    for acc, d in acc_data.items():
        opened = d["opened"]
        rows.append({
            "accountId": acc,
            "name": d["name"] or acc[:12],
            "matches": d["matches"],
            "aliveMin": _mean(d["aliveMin"]),
            "pickupsPerMin": (d["pickTotal"] / d["aliveTotal"])
                             if d["aliveTotal"] else None,
            "pickupsEarly": _mean(d["pickupsEarly"]),
            "pickupsLate": _mean(d["pickupsLate"]),
            "stillShare": _pct(d["stillMs"], d["stillTotalMs"]),
            "stillLateShare": _pct(d["stillLateMs"], d["stillLateTotalMs"]),
            # Median der Match-Mediane: robuster als ein Mittelwert, wenn ein
            # einzelnes Match jemanden quer ueber die Karte schickt.
            "teamDist": _median(d["teamDist"]),
            "farShare": _pct(d["farCount"], d["distCount"]),
            "distAtDown": _median(d["distAtDown"]),
            "distAtDownMax": max(d["distAtDown"]) if d["distAtDown"] else None,
            "firstDownPct": _pct(d["firstDowns"], d["matches"]),
            "downs": d["downs"],
            "opened": opened,
            "openedPerMatch": (opened / d["matches"]) if d["matches"] else None,
            "engaged": d["engaged"],
            "openedWon": d["openedWon"],
            "openedLost": d["openedLost"],
            "openedTrade": d["openedTrade"],
            "openedPointless": d["openedPointless"],
            "wonPct": _pct(d["openedWon"], opened),
            "lostPct": _pct(d["openedLost"], opened),
            "pointlessPct": _pct(d["openedPointless"], opened),
            "tradePct": _pct(d["openedTrade"], opened),
            "openedWithDown": d["openedWithDown"],
            "openHitPct": _pct(d["openedWithDown"], opened),
            "downsPerOpen": (d["theirDownsInOpened"] / opened) if opened else None,
            "downsFor": d["theirDownsInOpened"],
            "downsAgainst": d["ourDownsInOpened"],
            "downsBySelf": d["downsBySelfInOpened"],
            "selfDownsPerOpen": (d["downsBySelfInOpened"] / opened)
                                if opened else None,
            "squadLossPerOpen": (d["ourDownsInOpened"] / opened)
                                if opened else None,
            "downsMade": d["downsMade"],
            # "Ich treffe zuerst — geht der um?" Nenner sind die eroeffneten
            # Kaempfe, Zaehler nur der zuerst getroffene Gegner.
            "openTargetDown": d["openTargetDown"],
            "openTargetDownPct": _pct(d["openTargetDown"], opened),
            "openTargetDownBySelfPct": _pct(d["openTargetDownBySelf"], opened),
            # Anteil an den Faellen, in denen das Ziel tatsaechlich fiel —
            # die Lesart, nach der man beim Vergleich der beiden Prozentwerte
            # sucht ("63 und 63, also immer selbst?").
            "openTargetFinishedSelfPct": _pct(d["openTargetDownBySelf"],
                                              d["openTargetDown"]),
            "openDist": _median(d["openDist"]),
        })
    rows.sort(key=lambda r: (-r["matches"], r["name"]))
    return rows


def baseline(match_analyses):
    """Die Kaempfe, die der GEGNER anfaengt — als Vergleichsmassstab.

    Ohne sie fehlt der Bezug: eine Eroeffnungsquote von 44 % sagt nichts, wenn
    man nicht weiss, wie dieselben Runden ausgehen, wenn man ueberfallen wird.
    Gemessen an den Prod-Daten ist der Unterschied gross — selbst angefangene
    Kaempfe stehen deutlich besser da.

    Gleiche Feldnamen wie eine Spieler-Zeile, damit die Ansicht sie in
    dieselbe Tabelle setzen kann. None, wenn es keine solchen Kaempfe gab.
    """
    n = won = lost = trade = pointless = 0
    downs_for = downs_against = 0
    for a in match_analyses:
        for f in a.get("fights") or []:
            if f.get("openedByUs"):
                continue
            n += 1
            won += f["result"] == "won"
            lost += f["result"] == "lost"
            trade += f["result"] == "trade"
            pointless += f["result"] == "pointless"
            downs_for += f["theirDowns"]
            downs_against += f["ourDowns"]
    if not n:
        return None
    return {
        "accountId": None,
        "name": "Enemy opens",
        "opened": n,
        "wonPct": _pct(won, n),
        "lostPct": _pct(lost, n),
        "tradePct": _pct(trade, n),
        "pointlessPct": _pct(pointless, n),
        "downsFor": downs_for,
        "downsAgainst": downs_against,
        "downsPerOpen": downs_for / n,
        "squadLossPerOpen": downs_against / n,
    }


# ── DB-Anbindung ────────────────────────────────────────────────────────────

def compute_squad_playstyle(conn, tenant_id: int, my_account_id,
                            match_ids, *, include_bots=False,
                            min_matches=1):
    """Zeilen je Squad-Mate ueber die genannten Matches.

    Laedt je Match Squad (participants), Lobby-Teams (match_team_mapping) und
    die Events. Matches ohne Positions-Telemetrie tragen nur das bei, was sie
    haben — sie ganz zu verwerfen wuerde die Kampf-Auswertung unnoetig kuerzen.
    """
    match_ids = [m for m in (match_ids or []) if m]
    if not match_ids:
        return {"rows": [], "matches": 0, "matchesWithEvents": 0}

    analyses = []
    with_events = 0
    for mid in match_ids:
        squad = {r["account_id"]: r["name"] for r in conn.execute(
            "SELECT account_id, name FROM participants "
            "WHERE tenant_id = ? AND match_id = ?", (tenant_id, mid)).fetchall()}
        if not squad:
            continue
        team_of = {r["account_id"]: r["team_id"] for r in conn.execute(
            "SELECT account_id, team_id FROM match_team_mapping "
            "WHERE tenant_id = ? AND match_id = ?", (tenant_id, mid)).fetchall()}
        events = conn.execute(
            "SELECT event_type, timestamp_ms, actor_account, target_account, "
            "actor_x, actor_y, victim_x, victim_y FROM telemetry_events "
            "WHERE match_id = ? ORDER BY timestamp_ms", (mid,)).fetchall()
        if not events:
            continue
        with_events += 1
        analyses.append(analyse_match(events, squad, team_of,
                                      include_bots=include_bots))

    rows = [r for r in aggregate(analyses) if r["matches"] >= min_matches]
    return {"rows": rows, "matches": len(match_ids),
            "matchesWithEvents": with_events,
            "baseline": baseline(analyses)}
