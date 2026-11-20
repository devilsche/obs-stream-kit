"""Car Race: Lobby, Rennuhr und Ergebnis-Annahme je Tenant (nur im Speicher).

Zuschauer melden sich per !race (Streamer.bot → Endpoint) an. Ab dem 3. Fahrer
läuft ein Countdown; danach (oder sofort beim 10.) schließt die Startaufstellung, das
Overlay stellt die Fahrer vor (Phase intro, 2 s + 1,6 s je Fahrer), dann startet das Rennen. Das Overlay holt den
Zustand per Poll, fährt das Rennen und meldet die Platzierung zurück. Gespeichert
wird erst das Ergebnis (fx/race_db.py); die Lobby selbst überlebt keinen Neustart.

Chatrennen steuerbar (Car Drive, Schritt 2b): Fahrer können ihr Auto auf stream-overlay.com/drive/<Kanal> selbst
steuern. Beim Schließen der Startaufstellung (Beginn von intro) friert der Endpoint per set_pilots ein, wer dann mit
dem WS-Dienst (drive_ws.py) verbunden ist – `pilots` im Zustand. Die Sim rechnet diese Autos als Geister (keine
Wechselwirkung), die Overlays zeigen sie aus dem Live-Takt. Fällt die Verbindung weg, übernimmt die KI: Ereignis
`takeover` in race_events (add_takeovers), ab dann fährt js/car-race-sim.js follower() das Auto. Ohne Piloten ist alles
wie vorher. Zielzeiten der Piloten kommen vom WS-Dienst (accept_result, pilot_res).

Alle Funktionen bekommen `now` (Unix-Sekunden) übergeben, damit Tests die Zeit
steuern können. Phasen rücken lazy über `now` weiter (_advance).
"""
import random
import threading

from fx import race_shop

MIN = 3
MAX = 10
COUNTDOWN = 60
RACE_MAX = 90
PODIUM = 16
LOBBY_TTL = 300
COOLDOWN = 120
RESULT_WINDOW = 120
LAPS = 3
NITRO_COST = 50
BUMP_COST = 100
EVENT_LEAD = 1.5   # Ereignisse gelten 1,5 s nach Eingang, damit alle Overlays sie vor Eintritt haben
FINISH_WINDOW = 15
INTRO_BASE = 5.0   # Vorstellung der Fahrer vor dem Start: 5 s + 2,2 s je Fahrer (Overlay: reinschwenken,
INTRO_PER = 2.2    # Totale halten, langsam von hinten nach vorn, Ampel) – 10 Fahrer ≈ 27 s


def intro_seconds(n):
    return INTRO_BASE + INTRO_PER * n

_LOCK = threading.Lock()
_T = {}  # tenant_id -> Zustand
_PAINT = {}  # (tenant_id, user_id) -> Sub-Lackierung für die nächsten Rennen (nur im Speicher)


def reset():
    """Zustand komplett verwerfen (Tests)."""
    with _LOCK:
        _T.clear()
        _PAINT.clear()


def _new_race(now):
    seed = random.SystemRandom().getrandbits(31)
    rng = random.Random(seed)
    return {"phase": "lobby", "race_id": "%x-%x" % (int(now), seed), "seed": seed,
            "track": rng.getrandbits(31), "rng": rng, "racers": [], "first_at": now,
            "starts_at": None, "ends_at": now + LOBBY_TTL, "podium_until": None,
            "cool_until": None, "counted": False, "result": None, "events": [], "boosted": set(),
            "pilots": None, "taken": {}}


def _get(tenant_id):
    return _T.setdefault(tenant_id, {"phase": "idle", "racers": [], "last_counted": None})


def _intro(t, at):
    """Startaufstellung schließen: Vorstellung läuft ab `at`, danach startet das Rennen."""
    t["phase"] = "intro"
    t["intro_at"] = at
    t["starts_at"] = at + intro_seconds(len(t["racers"]))
    t["ends_at"] = t["starts_at"]


def _go(t, now, starts_at=None):
    if t.get("pilots") is None:
        t["pilots"] = []   # niemand rechtzeitig eingefroren (WS-Dienst nicht erreicht): alle fahren als KI
    t["phase"] = "race"
    t["starts_at"] = now if starts_at is None else starts_at
    t["ends_at"] = t["starts_at"] + RACE_MAX


def _cooldown(t, race_end):
    t["phase"] = "cooldown"
    t["cool_until"] = race_end + COOLDOWN
    t["ends_at"] = t["cool_until"]


def _idle(t):
    keep = t.get("last_counted")
    t.clear()
    t.update({"phase": "idle", "racers": [], "last_counted": keep})


def _advance(t, now):
    """Phasen über die Zeit weiterschieben; mehrere Schritte in einem Aufruf möglich."""
    while True:
        ph = t["phase"]
        if ph == "lobby" and now >= t["ends_at"]:
            _idle(t)
        elif ph == "countdown" and now >= t["ends_at"]:
            _intro(t, t["ends_at"])
        elif ph == "intro" and now >= t["ends_at"]:
            _go(t, now, starts_at=t["starts_at"])
        elif ph == "race" and now >= t["ends_at"]:
            # kein Ergebnis gekommen: Rennen zählt nicht
            _cooldown(t, t["ends_at"])
        elif ph == "podium" and now >= t["podium_until"]:
            _cooldown(t, t["race_end"])
        elif ph == "cooldown" and now >= t["cool_until"]:
            _idle(t)
        else:
            return


def eligible(cars, vehicles):
    """Katalog-Einträge, die mitfahren dürfen: mix != False, race.on != False, ohne rework."""
    out = []
    for c in cars or []:
        key = c.get("key")
        v = (vehicles or {}).get(key) or {}
        if not key or v.get("mix") is False or (v.get("race") or {}).get("on") is False \
                or v.get("rework"):
            continue
        out.append(c)
    return out


def _paint_for(key, vehicles, rng):
    """Farbset-Index nach Gewicht w."""
    paints = ((vehicles or {}).get(key) or {}).get("paints") or []
    if paints:
        weights = [max(float(p.get("w", 1) or 0), 0) for p in paints]
        if sum(weights) > 0:
            return rng.choices(range(len(paints)), weights=weights)[0]
    return 0


def pick_car(cars, vehicles, rng, taken, klass=None, exclude=None):
    """Auto für einen Fahrer: Katalog-Einträge mit mix != False, race.on != False und ohne rework,
    bevorzugt solche, die noch niemand in der Lobby fährt; Farbset nach Gewicht w.
    klass/exclude (Reroll): nur diese Klasse, ohne dieses Auto.
    Ohne passendes Auto car_key None (das Overlay zeichnet einen Platzhalter)."""
    cands = eligible(cars, vehicles)
    if klass:
        cands = [c for c in cands if race_shop.class_of(c["key"], c) == klass]
    if exclude:
        cands = [c for c in cands if c["key"] != exclude]
    if not cands:
        return {"car_key": None, "uid": None, "paint": 0}
    free = [c for c in cands if c["key"] not in taken] or cands
    car = free[rng.randrange(len(free))]
    return {"car_key": car["key"], "uid": car.get("uid"), "paint": _paint_for(car["key"], vehicles, rng)}


def chosen_car(cars, vehicles, rng, key):
    """Bestimmtes Auto (Garage/Kanalpunkte), nur wenn es mitfahren darf; sonst None."""
    for c in eligible(cars, vehicles):
        if c["key"] == key:
            return {"car_key": key, "uid": c.get("uid"), "paint": _paint_for(key, vehicles, rng)}
    return None


def _car_name(cars, key):
    for c in cars or []:
        if c.get("key") == key:
            return c.get("name") or key
    return "?"



def next_test_id(tenant_id, now):
    """Nächste freie Testnummer in der aktuellen Lobby: (user_id, display)."""
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        used = {r["user_id"] for r in t["racers"]}
        n = 1
        while "test%d" % n in used:
            n += 1
        return "test%d" % n, "Tester%d" % n


def join(tenant_id, user_id, login, display, color, now, cars, test=False, sub=0, car_key=None, swap=False):
    """Anmeldung. `cars` = (Katalog-Liste, Fahrzeug-Dict). sub = Sub-Tier (0/1000/2000/3000),
    gilt nur für dieses Rennen. car_key = bestimmtes Auto (Garage/Kanalpunkte, vom Endpoint
    geprüft); swap = schon angemeldet in Lobby/Countdown → Auto tauschen statt „already in“.
    → {ok, say, state}."""
    catalog, vehicles = cars if cars else ([], {})
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        ph = t["phase"]
        if ph == "intro":
            return _refuse(t, now, "grid closed, race starting")
        if ph == "race":
            return _refuse(t, now, "race running")
        if ph in ("podium", "cooldown"):
            left = max(int(round(_cool_end(t) - now)), 0)
            return _refuse(t, now, "cooldown, next race in %d s" % left)
        if ph == "idle":
            keep = t.get("last_counted")
            t.clear()
            t.update(_new_race(now))
            t["last_counted"] = keep
        mine = next((r for r in t["racers"] if r["user_id"] == user_id), None)
        if mine and not (swap and car_key):
            return _refuse(t, now, "already in")
        if car_key:
            car = chosen_car(catalog, vehicles, t["rng"], car_key)
            if car is None:
                return _refuse(t, now, "car not available")
        else:
            car = pick_car(catalog, vehicles, t["rng"], {r["car_key"] for r in t["racers"]})
        if mine:
            mine.update(car)
            say = "@%s switched to the %s" % (mine["display"], race_shop.car_name(catalog, car["car_key"]))
            return {"ok": True, "say": say, "state": _view(t, now)}
        if len(t["racers"]) >= MAX:
            return _refuse(t, now, "grid full")
        sub = 0 if test else (sub if sub in (1000, 2000, 3000) else 0)
        t["racers"].append({"grid": len(t["racers"]) + 1, "user_id": user_id, "login": login,
                            "display": display, "color": color, "test": bool(test), "sub": sub,
                            "sub_paint": _PAINT.get((tenant_id, user_id)) if sub else None,
                            "rerolled": False, **car})
        n = len(t["racers"])
        if n >= MAX:
            _intro(t, now)
        elif n >= MIN and t["phase"] == "lobby":
            t["phase"] = "countdown"
            t["starts_at"] = now + COUNTDOWN
            t["ends_at"] = now + COUNTDOWN
        say = "@%s is in! Car: %s – grid %d/%d" % (display, race_shop.car_name(catalog, car["car_key"]), n, MAX)
        return {"ok": True, "say": say, "state": _view(t, now)}


def reroll(tenant_id, user_id, now, cars):
    """Nur Subs, einmal pro Rennen, nur Lobby/Countdown: anderes Zufallsauto derselben Klasse.
    → {ok, say}, say ohne @-Präfix."""
    catalog, vehicles = cars if cars else ([], {})
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        r = next((x for x in t["racers"] if x["user_id"] == user_id), None) \
            if t["phase"] in ("lobby", "countdown") else None
        if r is None:
            return {"ok": False, "say": "you're not in the lobby – type !race to join"}
        if not r.get("sub"):
            return {"ok": False, "say": "!reroll is a sub perk"}
        if r.get("rerolled"):
            return {"ok": False, "say": "you already rerolled this race"}
        cur = r.get("car_key")
        entry = next((c for c in catalog if c.get("key") == cur), None)
        klass = race_shop.class_of(cur, entry) if cur else None
        car = pick_car(catalog, vehicles, t["rng"], {x["car_key"] for x in t["racers"]}, klass=klass, exclude=cur)
        if car["car_key"] is None:
            return {"ok": False, "say": "no other car in this class"}
        r.update(car)
        r["rerolled"] = True
        return {"ok": True, "say": "rerolled – now driving the %s" % race_shop.car_name(catalog, car["car_key"])}


def set_paint(tenant_id, user_id, paint, now):
    """Sub-Lackierung merken (None = zurücksetzen) und auf die aktuelle Lobby-Anmeldung
    anwenden, falls der Fahrer dort als Sub steht. → True, wenn sie im aktuellen Rennen gilt."""
    with _LOCK:
        if paint:
            _PAINT[(tenant_id, user_id)] = paint
        else:
            _PAINT.pop((tenant_id, user_id), None)
        t = _get(tenant_id)
        _advance(t, now)
        if t["phase"] not in ("lobby", "countdown"):
            return False
        r = next((x for x in t["racers"] if x["user_id"] == user_id), None)
        if r is None or not r.get("sub"):
            return False
        r["sub_paint"] = paint
        return True


def lookup(tenant_id, user_id, now):
    """Nur lesend: (Fahrer-Dict oder None, Anzahl Fahrer, Phase, Sekunden bis zum nächsten Rennen)."""
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        ph = t["phase"]
        left = max(int(round(_cool_end(t) - now)), 0) if ph in ("podium", "cooldown") else 0
        r = None
        if ph in ("lobby", "countdown", "intro", "race", "podium"):
            r = next((dict(x) for x in t["racers"] if x["user_id"] == user_id), None)
        return r, len(t["racers"]), ph, left


def _cool_end(t):
    return t["cool_until"] if t["phase"] == "cooldown" else t["race_end"] + COOLDOWN


def _refuse(t, now, say):
    return {"ok": False, "say": say, "state": _view(t, now)}


def _view(t, now):
    out = {"phase": t["phase"], "now": now, "racers": []}
    if t["phase"] == "idle":
        out.update({"race_id": None, "seed": None, "track": None, "starts_at": None, "intro_at": None, "ends_at": None})
        return out
    out.update({"race_id": t["race_id"], "seed": t["seed"], "track": t["track"], "laps": LAPS,
                "finish_window": FINISH_WINDOW, "starts_at": t["starts_at"], "intro_at": t.get("intro_at"),
                "ends_at": t["podium_until"] if t["phase"] == "podium" else t["ends_at"]})
    out["racers"] = [{**{k: r[k] for k in ("grid", "user_id", "display", "color", "car_key", "uid", "paint")},
                      "sub": r.get("sub", 0), "sub_paint": r.get("sub_paint")}
                     for r in t["racers"]]
    # erwarteter Rennstart (Fahrerseite): im Countdown erst nach der Vorstellung, sonst starts_at
    out["go_at"] = (t["starts_at"] + intro_seconds(len(t["racers"]))
                    if t["phase"] in ("lobby", "countdown") and t["starts_at"] is not None else t["starts_at"])
    out["race_events"] = sorted((dict(e) for e in t.get("events", [])), key=lambda e: e["t"])
    if t.get("pilots") is not None:
        out["pilots"] = list(t["pilots"])
    if t["result"] and t["phase"] in ("podium", "cooldown"):
        out["result"] = t["result"]
    return out


def drive_info(tenant_id, now):
    """Für den Abgleich mit dem WS-Dienst: aktuelles Rennen oder None (idle)."""
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        if t["phase"] == "idle":
            return None
        return {"race_id": t["race_id"], "phase": t["phase"], "starts_at": t["starts_at"], "track": t["track"],
                "laps": LAPS, "fw": FINISH_WINDOW,
                "racers": [[r["user_id"], r["car_key"] or "", r["grid"] - 1] for r in t["racers"] if not r.get("test")],
                "pilots": None if t.get("pilots") is None else list(t["pilots"]),
                "taken": sorted(t.get("taken", {}))}


def set_pilots(tenant_id, race_id, ids, now):
    """Startaufstellung geschlossen: wer jetzt verbunden ist, steuert selbst (einmalig je Rennen, nur ab intro).
    → eingefrorene Liste (Startreihenfolge) oder None, wenn nicht (mehr) möglich."""
    want = {str(i) for i in ids or []}
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        if t.get("race_id") != race_id or t["phase"] not in ("intro", "race") or t.get("pilots") is not None:
            return None
        t["pilots"] = [r["user_id"] for r in t["racers"] if r["user_id"] in want and not r.get("test")]
        return list(t["pilots"])


_TAKE_KEYS = ("x", "z", "yaw", "speed", "prog")


def add_takeovers(tenant_id, race_id, events):
    """KI übernimmt Piloten (vom WS-Dienst): als race_events {t, type: takeover, id, x, z, yaw, speed, prog, lap}
    (oder grid: 1 = vom Startplatz). Je Pilot einmal. → Anzahl neuer Übernahmen."""
    n = 0
    with _LOCK:
        t = _get(tenant_id)
        if t.get("race_id") != race_id or not t.get("pilots"):
            return 0
        for e in events or []:
            uid = str(e.get("id"))
            if uid not in t["pilots"] or uid in t["taken"]:
                continue
            try:
                ev = {"t": round(float(e["t"]), 2), "type": "takeover", "id": uid}
                if e.get("grid"):
                    ev["grid"] = 1
                else:
                    for k in _TAKE_KEYS:
                        ev[k] = round(float(e[k]), 3)
                    ev["lap"] = int(e.get("lap") or 0)
            except (KeyError, TypeError, ValueError):
                continue
            t["taken"][uid] = ev
            t["events"].append(ev)
            n += 1
    return n


def state(tenant_id, now):
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        return _view(t, now)


def admin(tenant_id, action, now, user_id=None):
    """cancel | start | remove | void. void liefert die race_id des letzten gezählten
    Rennens; das Ungültig-Machen in der DB macht der Endpoint (race_db.void)."""
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        if action == "cancel":
            _idle(t)
        elif action == "start":
            if t["phase"] not in ("lobby", "countdown") or len(t["racers"]) < MIN:
                return {"ok": False, "say": "need %d racers" % MIN, "state": _view(t, now)}
            _intro(t, now)
        elif action == "remove":
            if t["phase"] not in ("lobby", "countdown"):
                return {"ok": False, "say": "nothing to remove from", "state": _view(t, now)}
            left = [r for r in t["racers"] if r["user_id"] != user_id]
            if len(left) == len(t["racers"]):
                return {"ok": False, "say": "not in the race", "state": _view(t, now)}
            for i, r in enumerate(left, 1):
                r["grid"] = i
            t["racers"] = left
            if not left:
                _idle(t)
            elif len(left) < MIN and t["phase"] == "countdown":
                t["phase"] = "lobby"
                t["starts_at"] = None
                t["ends_at"] = t["first_at"] + LOBBY_TTL
        elif action == "void":
            rid = t.get("last_counted")
            if not rid:
                return {"ok": False, "say": "no race to void", "state": _view(t, now)}
            t["last_counted"] = None
            return {"ok": True, "race_id": rid, "state": _view(t, now)}
        else:
            raise ValueError("unbekannte Aktion: %s" % action)
        return {"ok": True, "state": _view(t, now)}


def _merge_pilots(t, racers, places, times, pilot_res):
    """Platzierung mit Piloten: Zielzeiten der KI/Nachfahrer vom Overlay (times), der Piloten vom WS-Dienst.
    Sieger + FINISH_WINDOW wie in der Sim, später = DNF; ungültige Piloten (Prüfung) = DNF ohne Wertung.
    → (places, invalid ids)."""
    pil, taken, res = set(t["pilots"]), t.get("taken", {}), pilot_res or {}
    tm, invalid = [], set()
    for i, r in enumerate(racers):
        uid = r["user_id"]
        if uid in pil:
            pr = res.get(uid) or {}
            if pr.get("invalid"):
                invalid.add(uid)
                tm.append(None)
                continue
            v = times[i] if uid in taken else pr.get("fin")
        else:
            v = times[i] if places[i] is not None else None
        tm.append(float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v <= RACE_MAX else None)
    done = [v for v in tm if v is not None]
    if done:
        cut = min(done) + FINISH_WINDOW + 1e-6
        tm = [v if v is not None and v <= cut else None for v in tm]
    order = sorted((i for i, v in enumerate(tm) if v is not None), key=lambda i: (tm[i], i))
    out = [None] * len(racers)
    for k, i in enumerate(order, 1):
        out[i] = k
    return out, invalid


def accept_result(tenant_id, race_id, places, now, times=None, pilot_res=None):
    """Ergebnis des aktuellen Rennens annehmen (einmalig, innerhalb RESULT_WINDOW nach
    dem Start). places in Startaufstellung: Platz 1..n oder None (DNF).
    Mit Piloten (pilots) zählen die Zielzeiten: times = Rennsekunden je Startplatz vom Overlay (KI + Nachfahrer),
    pilot_res = {user_id: {fin, invalid}} vom WS-Dienst; die Plätze werden daraus neu gerechnet.
    → rows für race_db.record, None wenn nicht annehmbar; ValueError bei ungültigen places."""
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        if t["phase"] not in ("race", "podium", "cooldown") or t.get("race_id") != race_id or t["counted"] \
                or t.get("saving") == race_id or t["starts_at"] is None or now > t["starts_at"] + RESULT_WINDOW:
            return None
        racers = t["racers"]
        if not isinstance(places, list) or len(places) != len(racers):
            raise ValueError("places does not match the number of racers")
        if any(p is not None and (isinstance(p, bool) or not isinstance(p, int)) for p in places):
            raise ValueError("places must be numbers or null")
        fin = sorted(p for p in places if p is not None)
        if fin != list(range(1, len(fin) + 1)):
            raise ValueError("places must be 1..k without gaps")
        invalid = set()
        if t.get("pilots"):
            if times is None:
                times = [None] * len(racers)
            if not isinstance(times, list) or len(times) != len(racers):
                raise ValueError("times does not match the number of racers")
            places, invalid = _merge_pilots(t, racers, places, times, pilot_res)
        # Nur echte Fahrer werden gewertet: Testfahrer bekommen keine Zeilen/Punkte, die echten
        # Zielplätze werden ohne sie neu vergeben (Zielreihenfolge bleibt), DNF bleibt DNF
        real = [(r, p) for r, p in zip(racers, places) if not r.get("test") and r["user_id"] not in invalid]
        order = {r["user_id"]: i for i, (r, p) in enumerate(sorted(
            ((r, p) for r, p in real if p is not None), key=lambda x: x[1]), 1)}
        rows = [{"user_id": r["user_id"], "login": r["login"], "display": r["display"],
                 "place": order.get(r["user_id"]) if p is not None else None,
                 "car_key": r["car_key"] or "", "sub": r.get("sub", 0)} for r, p in real]
        t["race_end"] = now
        t["result"] = sorted(({"user_id": r["user_id"], "display": r["display"], "place": p,
                               **({"invalid": True} if r["user_id"] in invalid else {})}
                              for r, p in zip(racers, places)),
                             key=lambda x: (x["place"] is None, x["place"] or 0))
        t["phase"] = "podium"
        t["podium_until"] = now + PODIUM
        t["ends_at"] = t["podium_until"]
        if len(rows) < 2:
            # weniger als 2 echte Fahrer: Rennen wird nicht gespeichert
            t["counted"] = True
            return None
        t["saving"] = race_id  # bis confirm/release: weitere Meldungen gelten als „schon dabei“
        return rows


def boost(tenant_id, user_id, kind, query, now, pay):
    """Nitro/Bump im laufenden Rennen. `pay(cost)` zieht die Coins atomar ab (True/False) und wird
    erst nach allen Prüfungen unter der Sperre aufgerufen. → {ok, say} (say ohne @-Präfix)."""
    cost = NITRO_COST if kind == "nitro" else BUMP_COST
    with _LOCK:
        t = _get(tenant_id)
        _advance(t, now)
        me = next((r for r in t["racers"] if r["user_id"] == user_id), None) if t["phase"] == "race" else None
        if me is None or me.get("test") or t["starts_at"] is None or now < t["starts_at"]:
            return {"ok": False, "say": "!%s only works for racers while the race is running" % kind}
        if user_id in (t.get("pilots") or ()):
            # selbst gesteuert: Nitro landet im eigenen Browser; Anrempeln gibt es nur für KI-Autos
            if kind == "bump":
                return {"ok": False, "say": "!bump is only for AI-driven cars – you're steering yourself"}
            if user_id in t.get("taken", {}):
                return {"ok": False, "say": "the AI is driving your car now – !nitro is off"}
        if (kind, user_id) in t["boosted"]:
            return {"ok": False, "say": "you already used %s this race" % kind}
        # Bump hat kein Ziel: die Sim rempelt das nächste Auto direkt voraus (oder daneben) an,
        # sobald der Fahrer nah genug dran ist (bis 8 s, sonst verpufft es); q wird ignoriert
        ev = {"t": round(now - t["starts_at"] + EVENT_LEAD, 2), "type": kind, "id": user_id}
        if not pay(cost):
            return {"ok": False, "say": "%s costs %d coins" % (kind, cost), "poor": True}
        t["boosted"].add((kind, user_id))
        t["events"].append(ev)
        if kind == "nitro":
            return {"ok": True, "say": "fires the nitro!", "event": ev}
        return {"ok": True, "say": "is hunting the car ahead…", "event": ev}


def release(tenant_id, race_id):
    """Bei Schreibfehler aufrufen: hebt die Speichersperre auf, ein neuer Versuch ist möglich."""
    with _LOCK:
        t = _get(tenant_id)
        if t.get("saving") == race_id:
            t["saving"] = None


def confirm(tenant_id, race_id):
    """Nach erfolgreichem Speichern aufrufen: erst jetzt gilt das Rennen als gezählt
    (und ist per void ansprechbar); bei Schreibfehler bleibt ein neuer Versuch möglich."""
    with _LOCK:
        t = _get(tenant_id)
        if t.get("race_id") == race_id:
            t["saving"] = None
            t["counted"] = True
            t["last_counted"] = race_id
