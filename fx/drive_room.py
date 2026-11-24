"""Car Drive Mehrspieler: Räume, Phasen, Plausibilitätsprüfung und Wertung (reine Logik, ohne Netz).

Ein Raum je Tenant (Code aus 6 Zeichen), bis MAX_DRIVERS Fahrer plus Zuschauer. Der WebSocket-Dienst
(drive_ws.py) hält die Räume im Speicher und ruft diese Funktionen; Flask (fx/endpoints.py) steuert
open/start/close über die interne HTTP-Schnittstelle des Dienstes.

Phasen: lobby → countdown (start_at = now + COUNTDOWN) → race → done (Ergebnis) → per start wieder countdown.
Jeder Client rechnet sein Auto selbst (js/car-drive-phys.js) und meldet ~20 Hz seinen Zustand; der Server
prüft nur die Plausibilität:
  - Uhr: die Rennzeit rt des Clients darf der Server-Rennzeit höchstens CLOCK_AHEAD voraus sein und läuft nur vorwärts
  - Tempo: gemeldetes Tempo ≤ Höchsttempo des Autos × Nitro × Marge (+ Schlupf)
  - Sprungweite: Abstand zweier Meldungen ≤ Tempo-Grenze × dt + JUMP_MAX (R = zurück auf die Strecke bleibt erlaubt)
  - Fortschritt: gefahrene Meter seit dem Start ≤ Summe der erlaubten Meter (+ PROG_SLACK) – kumulativ, damit
    kleine Übertretungen sich nicht aufaddieren
  - Rundenzeit: jede Runde ≥ Mindestzeit (Sim-Rundenzeit des Autos × LAP_FACTOR, sonst globale Untergrenze)
  - Frühstart: vor dem Start mehr als 1,5 m aus der Startposition
Verstöße markieren die laufende Runde; eine markierte Runde zählt nicht, ein Fahrer mit ungültiger Runde wird nicht
gewertet (keine Punkte/Coins).

Höchsttempo/Mindestrundenzeit je Auto kommen aus data/car-rain/drive-limits.json (schreibt die Car-Drive-Seite des
Streamers beim Öffnen eines Raums, gerechnet mit denselben JS-Werten wie die Fahrphysik); fehlt ein Auto, gelten die
globalen Grenzen unten (Bestwerte aller Bereiche aus js/car-race-stats.js, mit Node gerechnet).

Alle Funktionen bekommen `now` (Unix-Sekunden), damit Tests die Zeit steuern können.
"""
import math
import random
import time

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LEN = 6
MAX_DRIVERS = 8
MAX_CLIENTS = 60
COUNTDOWN = 15.0   # Zeit zum Laden von Strecke, Kulisse und Autos (vorher 8 s – Start ruckelte)
FINISH_WINDOW = 30.0
ROOM_TTL = 1800.0          # Raum ohne Verbindungen verfällt nach 30 min
LAPS_MIN, LAPS_MAX = 1, 5
LAPS_DEFAULT = 2          # lange Strecken: 2 Runden ≈ 2:20

# Streckenlängen (m) für CarRaceSim.TRACKS = [1..5] (Speedway, Twister, Hairpin, Coast, Kart)
TRACK_LEN = [1209.02, 1084.46, 1148.26, 1332.53, 450.10]
TRACK_NAMES = ["Speedway", "Twister", "Hairpin", "Coast", "Kart"]
# schnellstes denkbares Auto (vmax 420, 0–100 1,5 s, 2000 PS, 300 kg, 5 g, 0,5 m lang, 60° Einschlag, Drift 1):
# Endtempo der Fahrphysik (m/s) und Sim-Rundenzeit je Strecke (s) – absolute Untergrenze, auch für veraltete
# drive-limits.json (alte, kurze Strecken)
GLOBAL_VTOP = 27.68
GLOBAL_LAP = [56.37, 57.19, 55.68, 57.63, 28.31]
NITRO_V = 1.25
SPEED_MARGIN = 1.15
SPEED_SLACK = 2.0
JUMP_MAX = 20.0
PROG_SLACK = 8.0
LAP_FACTOR = 0.75
CLOCK_AHEAD = 0.5
STAMP_BACK = 1.0         # Absender-Zeitstempel (Server-Uhr des Clients) höchstens so alt …
STAMP_AHEAD = 0.25       # … bzw. so weit voraus, sonst gilt die Empfangszeit
PING_MAX = 5000          # gemeldeter Ping (ms), darüber verworfen
TAKEOVER_GAP = 3.0       # so lange ohne Zustand im Rennen → die KI fährt das Auto weiter (Ereignis takeover)
RELEASE_TOL = 25.0       # Rückgabe ans Steuer: Lage höchstens so weit (m) von der letzten KI-Meldung entfernt
GRID_FRONT, GRID_ROW, GRID_SIDE = 4.0, 7.5, 2.3
# Testraum: immer offen unter festem Code (Admin-Tenant), Ergebnisse/Coins/Rekorde werden nicht gespeichert,
# Rennen starten von selbst (TEST_WAIT s nach dem letzten Beitritt bzw. TEST_PAUSE s nach dem Ergebnis)
TEST_CODE, TEST_TENANT, TEST_TRACK, TEST_LAPS = "TESTME", 1, 0, 2   # Speedway; umstellen: /internal/test?track=&laps=
TEST_WAIT, TEST_PAUSE = 10.0, 20.0


def grid_pose(i):
    """Startplatz i (0 = Pole): (s, d) – Zweierreihen hinter der Linie, wie in der Sim."""
    return -(GRID_FRONT + (i // 2) * GRID_ROW), (GRID_SIDE if i % 2 == 0 else -GRID_SIDE)


def race_max(laps):
    return laps * 150.0 + 60.0   # lange Strecken: Runde ~60–75 s (KI), Menschen langsamer


def stamp(d, msg, now):
    """Zeitstempel und Ping einer Zustandsmeldung übernehmen (d.sts, d.ping).

    Der Client schickt ts = seine abgeglichene Server-Uhr beim Senden. So landet Netz-Zittern nur in der Ankunft,
    nicht in der Bewegung, die andere interpolieren. Unplausibel (fehlt, zu alt, zu weit voraus) → Empfangszeit.
    Streng steigend, damit Clients nichts als „unverändert“ verwerfen."""
    ts = _num(msg.get("ts"))
    if ts is None or not (now - STAMP_BACK <= ts <= now + STAMP_AHEAD):
        ts = now
    prev = d.sts or 0.0
    d.sts = ts if ts > prev else prev + 0.001
    note_ping(d, msg)


def note_ping(d, msg):
    """Vom Client gemeldeten Ping (pg, ms) übernehmen – aus Zustand oder ping-Nachricht."""
    pg = _num(msg.get("pg")) if d is not None else None
    if pg is not None and 0 <= pg <= PING_MAX:
        d.ping = int(round(pg))


def row(d):
    """Ein Zustand für die Verteilung: [id, ts, x, z, yaw, roll, pitch, steer, speed, prog, spin]."""
    return [d.id, round(d.sts, 3)] + d.state


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


class Limits:
    """Höchsttempo/Mindestrundenzeit je Auto; {cars: {key: {vtop, lap: [5 Zeiten]}}}."""

    def __init__(self, data=None):
        self.cars = {}
        cars = (data or {}).get("cars") if isinstance(data, dict) else None
        if isinstance(cars, dict):
            for k, v in cars.items():
                if not isinstance(v, dict):
                    continue
                vt = _num(v.get("vtop"))
                lap = v.get("lap") if isinstance(v.get("lap"), list) else []
                laps = [_num(x) for x in lap[:len(TRACK_LEN)]]
                if vt and vt > 0:
                    self.cars[str(k)] = {"vtop": min(vt, GLOBAL_VTOP * 1.01),
                                         "lap": [x if x and x > 0 else None for x in laps]}

    def vtop(self, car):
        c = self.cars.get(car)
        return c["vtop"] if c else GLOBAL_VTOP

    def min_lap(self, car, track):
        c = self.cars.get(car)
        t = None
        if c and track < len(c["lap"]):
            t = c["lap"][track]
        # nie unter der globalen Untergrenze (veraltete Werte der alten, kurzen Strecken zählen nicht)
        return max(t or 0.0, GLOBAL_LAP[track]) * LAP_FACTOR


class Driver:
    def __init__(self, ident, car, paint, host):
        self.id = ident["id"]
        self.login = ident.get("login") or ""
        self.display = ident.get("display") or self.id
        self.car = car
        self.paint = paint
        self.host = host
        self.bot = ident.get("role") == "bot"     # Testfahrer (Skript): startet den Testraum nicht allein
        self.connected = True
        self.grid = None
        self.ping = None            # vom Client gemeldeter Ping (ms)
        self.reset_race()

    def reset_race(self):
        self.last = None            # (t, x, z, prog)
        self.state = None           # letzter Zustand für die Verteilung (Liste)
        self.ts = 0.0               # Server-Zeit des letzten Zustands (Empfang)
        self.sts = 0.0              # Zeitstempel des letzten Zustands (Absender, für die Verteilung)
        self.lap = 0
        self.lap_start = 0.0
        self.lap_bad = False
        self.laps = []              # [(Zeit, ok)]
        self.finish_t = None
        self.invalid = False
        self.reasons = []
        self.allow = 0.0            # erlaubte Meter seit dem Start
        self.base_prog = None
        self.taken = None           # Übernahme-Ereignis der KI (None = Mensch fährt)
        self.lap_ai = False         # laufende Runde mit KI-Anteil (kein Rekord, keine Mindestrundenzeit)

    def flag(self, why):
        self.lap_bad = True
        if why not in self.reasons:
            self.reasons.append(why)

    def public(self):
        return {"id": self.id, "name": self.display, "car": self.car, "paint": self.paint,
                "host": self.host, "grid": self.grid, "connected": self.connected}


class Room:
    def __init__(self, code, tenant_id, track, laps, limits, now):
        self.code = code
        self.tenant_id = tenant_id
        self.track = track
        self.laps = laps
        self.limits = limits or Limits()
        self.phase = "lobby"
        self.drivers = {}           # id → Driver (Reihenfolge = Anmeldung)
        self.race_id = None
        self.start_at = None
        self.first_finish = None
        self.carrier_sent = None
        self.results = None
        self.recorded = False
        self.created = now
        self.active = now
        self.clients = 0
        self.test = False           # Testraum (TEST_CODE): nichts speichern, Start von selbst
        self.changed = now          # letzte Änderung der Startaufstellung (Testraum: Start TEST_WAIT s danach)
        self.done_at = None

    @property
    def track_len(self):
        return TRACK_LEN[self.track]

    def info(self, now=None):
        return {"code": self.code, "tenant": self.tenant_id, "track": self.track, "track_name": TRACK_NAMES[self.track],
                "laps": self.laps, "phase": self.phase, "race_id": self.race_id, "start_at": self.start_at,
                "drivers": len(self.drivers), "max": MAX_DRIVERS, "now": now, "test": self.test}

    def roster(self):
        return [d.public() for d in self.drivers.values()]

    # ---- Anmeldung ----
    def join(self, ident, car, paint, now):
        """ident = Ticket-Inhalt {id, login, display, role, garage (Liste oder None = alle), rnd}.
        → (ok, Meldung)."""
        self.active = now
        self.changed = now
        if not isinstance(car, str) or not car or len(car) > 120:
            return False, "pick a car"
        garage = ident.get("garage")
        if garage is not None and car not in garage and car != ident.get("rnd"):
            return False, "that car is not in your garage"
        try:
            paint = max(0, min(int(paint or 0), 64))
        except (TypeError, ValueError):
            paint = 0
        me = self.drivers.get(ident["id"])
        if me:
            if self.phase in ("countdown", "race"):
                me.connected = True
                return True, "back in the race"
            me.car, me.paint, me.connected = car, paint, True
            return True, "car changed"
        if self.phase in ("countdown", "race"):
            return False, "race running – join the next one"
        if len(self.drivers) >= MAX_DRIVERS:
            return False, "grid full"
        self.drivers[ident["id"]] = Driver(ident, car, paint, ident.get("role") == "host")
        return True, "joined"

    def leave(self, uid, now):
        """Fahrer verlässt den Raum (oder Verbindung weg). In Lobby/Ergebnis: raus, im Rennen: bleibt als DNF."""
        self.active = now
        self.changed = now
        d = self.drivers.get(uid)
        if not d:
            return False
        if self.phase in ("countdown", "race"):
            d.connected = False
        else:
            del self.drivers[uid]
        return True

    # ---- Phasen ----
    def start(self, now):
        if self.phase not in ("lobby", "done"):
            return False, "race already running"
        live = [d for d in self.drivers.values() if d.connected]
        if not live:
            return False, "nobody on the grid"
        # Getrennte Fahrer aus dem letzten Rennen fliegen raus
        self.drivers = {d.id: d for d in live}
        for i, d in enumerate(self.drivers.values()):
            d.reset_race()
            d.grid = i
        seed = random.SystemRandom().getrandbits(31)
        self.race_id = "drive-%s-%x-%x" % (self.code, int(now), seed)
        self.start_at = now + COUNTDOWN
        self.first_finish = None
        self.carrier_sent = None
        self.results = None
        self.recorded = False
        self.phase = "countdown"
        self.active = now
        return True, "race starts in %d s" % COUNTDOWN

    def tick(self, now):
        """Phasen weiterschieben. → Liste von Ereignissen ({"t": "phase"|"results", ...})."""
        out = []
        if self.phase == "countdown" and now >= self.start_at:
            self.phase = "race"
            out.append(self.phase_msg(now))
        if self.phase == "race":
            out += self._takeovers(now)
            ds = list(self.drivers.values())
            car = self.carrier()
            if self.taken_list() and car != self.carrier_sent:
                self.carrier_sent = car
                out.append({"t": "carrier", "id": car})
            # offen: wer selbst fährt, und Übernommene, solange jemand sie meldet
            open_ = [d for d in ds if d.finish_t is None and
                     ((d.connected and not d.taken) or (d.taken and car is not None))]
            timeout = now >= self.start_at + race_max(self.laps)
            window = self.first_finish is not None and now >= self.first_finish + FINISH_WINDOW
            if not open_ or timeout or window:
                self.results = self._results()
                self.phase = "done"
                self.active = now
                self.done_at = now
                out.append(self.phase_msg(now))
                out.append(dict(self.results, t="results"))
        return out

    def auto_start(self, now):
        """Testraum: Lobby → Start TEST_WAIT s nach der letzten Änderung, Ergebnis → nächstes Rennen TEST_PAUSE s danach,
        solange ein verbundener Mensch da ist (Bots allein warten). → True, wenn gestartet."""
        if not self.test or not any(d.connected and not d.bot for d in self.drivers.values()):
            return False
        if self.phase == "lobby" and now - self.changed >= TEST_WAIT:
            return self.start(now)[0]
        if self.phase == "done" and self.done_at is not None and now - max(self.done_at, self.changed) >= TEST_PAUSE:
            return self.start(now)[0]
        return False

    def phase_msg(self, now):
        return {"t": "phase", "phase": self.phase, "race_id": self.race_id, "start_at": self.start_at,
                "track": self.track, "laps": self.laps, "now": now,
                "grid": [{"id": d.id, "grid": d.grid} for d in self.drivers.values()]}

    # ---- KI-Übernahme bei Verbindungsabbruch ----
    def carrier(self):
        """Wer die übernommenen Autos meldet (rechnet den Nachfahrer und schickt dessen Lage): verbundener Fahrer
        ohne Übernahme, bevorzugt noch im Rennen, dann der Host, dann der vordere Startplatz. → uid oder None."""
        live = [d for d in self.drivers.values() if d.connected and not d.taken]
        if not live:
            return None
        live.sort(key=lambda d: (d.finish_t is not None, not d.host, d.grid if d.grid is not None else 99))
        return live[0].id

    def taken_list(self):
        return [d.taken for d in self.drivers.values() if d.taken]

    def _takeovers(self, now):
        out = []
        for d in self.drivers.values():
            if d.taken or d.finish_t is not None or d.invalid:
                continue
            if d.connected and now - (d.ts or self.start_at) < TAKEOVER_GAP:
                continue
            if not d.connected and d.ts and now - d.ts < TAKEOVER_GAP:
                continue
            if d.last is not None and d.state is not None:
                x, z, yaw, speed, prog = d.state[0], d.state[1], d.state[2], d.state[6], d.state[7]
                t = d.last[0]
            else:
                s0, side = grid_pose(d.grid or 0)
                x = z = yaw = speed = None
                prog, t = s0, 0.0
            ev = {"t": round(t, 2), "type": "takeover", "id": d.id, "prog": round(prog, 2), "speed": round(speed or 0.0, 2),
                  "lap": int(math.floor(prog / self.track_len)) if prog > 0 else 0}
            if x is not None:
                ev.update(x=x, z=z, yaw=yaw)
            else:
                ev["d"] = side
            d.taken = ev
            d.lap_ai = True
            out.append({"t": "takeover", "ev": ev})
        return out

    def release(self, uid, msg, now):
        """Fahrer übernimmt wieder (Lage seines Nachfahrers zur Rennsekunde rt). → Ereignis oder None."""
        d = self.drivers.get(uid)
        if d is None or not d.taken or d.finish_t is not None or self.phase != "race":
            return None
        f = {k: _num(msg.get(k)) for k in ("x", "z", "yaw", "speed", "prog", "rt")}
        if any(v is None for v in f.values()):
            return None
        elapsed = now - self.start_at
        rt, prog = min(f["rt"], elapsed + CLOCK_AHEAD), f["prog"]
        vcap = self.limits.vtop(d.car) * NITRO_V * SPEED_MARGIN + SPEED_SLACK
        t0, p0 = (d.last[0], d.last[3]) if d.last else (_num(d.taken.get("t")) or 0.0, _num(d.taken.get("prog")) or 0.0)
        if rt < t0 - 0.5 or abs(prog - (p0 + max(0.0, f["speed"]) * max(0.0, rt - t0))) > RELEASE_TOL + vcap * 0.2 \
                or prog >= self.laps * self.track_len or f["speed"] > vcap:
            return None
        x, z = round(f["x"], 2), round(f["z"], 2)
        ev = {"t": round(rt, 2), "type": "release", "id": uid, "x": x, "z": z, "yaw": round(f["yaw"], 3),
              "speed": round(max(0.0, f["speed"]), 2), "prog": round(prog, 2)}
        d.taken = None
        d.connected = True
        d.ts = now
        d.sts = max(now, (d.sts or 0.0) + 0.001)
        d.allow = max(d.allow, prog - (d.base_prog or 0.0))
        d.last = (rt, x, z, prog)
        d.state = [x, z, ev["yaw"], 0.0, 0.0, 0.0, ev["speed"], round(prog, 2), 0.0]
        return {"t": "release", "ev": ev}

    # ---- Zustand eines Fahrers ----
    def state(self, uid, msg, now, ai=False):
        """Zustandsmeldung prüfen und übernehmen. → Ereignisse (Runde, Ziel).
        ai = Meldung des Trägers für ein übernommenes Auto (zählt nicht als Verbindung des Fahrers)."""
        d = self.drivers.get(uid)
        if d is None or self.phase not in ("countdown", "race"):
            return []
        if bool(d.taken) != bool(ai):
            return []           # übernommen: eigene Meldungen ruhen bis zur Rückgabe; KI-Meldungen nur dann
        f = {k: _num(msg.get(k)) for k in ("x", "z", "yaw", "roll", "pitch", "steer", "speed", "prog", "rt", "spin")}
        if any(f[k] is None for k in ("x", "z", "yaw", "prog", "rt")):
            return []
        for k in ("roll", "pitch", "steer", "speed", "spin"):
            if f[k] is None:
                f[k] = 0.0
        if not ai:
            d.connected = True
        self.active = now
        d.ts = now
        stamp(d, msg, now)
        d.state = [round(f["x"], 2), round(f["z"], 2), round(f["yaw"], 3), round(f["roll"], 3),
                   round(f["pitch"], 3), round(f["steer"], 3), round(f["speed"], 2), round(f["prog"], 2),
                   round(f["spin"] % 6283.0, 2)]
        if d.finish_t is not None:
            return []           # nach dem Ziel nur noch Darstellung (Auslaufen)
        elapsed = now - self.start_at
        x, z, prog, t = f["x"], f["z"], f["prog"], f["rt"]
        if d.base_prog is None:
            d.base_prog = grid_pose(d.grid or 0)[0]
        vcap = self.limits.vtop(d.car) * NITRO_V * SPEED_MARGIN + SPEED_SLACK
        if elapsed < 0:
            # Startaufstellung: nicht losfahren (kleine Toleranz für Uhrenabweichung/Takt beim Übergang)
            if prog > d.base_prog + 3 or math.hypot(x - (d.last[1] if d.last else x), z - (d.last[2] if d.last else z)) > 5:
                d.flag("jump start")
            d.last = (0.0, x, z, min(prog, d.base_prog + 3))
            return []
        if t > elapsed + CLOCK_AHEAD:
            d.flag("clock")
            t = elapsed
        prev = d.last
        if prev is None:
            prev = (0.0, x, z, d.base_prog)
        if t < prev[0] - 1e-6:
            return []           # veraltet/vertauscht
        dt = max(t - prev[0], 0.0)
        if f["speed"] > vcap:
            d.flag("speed")
        if math.hypot(x - prev[1], z - prev[2]) > vcap * dt + JUMP_MAX:
            d.flag("jump")
        d.allow += vcap * dt
        if prog - d.base_prog > d.allow + PROG_SLACK:
            d.flag("progress")
        d.last = (t, x, z, prog)
        out = []
        lap = int(math.floor(prog / self.track_len)) if prog > 0 else 0
        while d.lap < lap and d.finish_t is None:
            d.lap += 1
            lt = t - d.lap_start
            ok = not d.lap_bad and (d.lap_ai or lt >= self.limits.min_lap(d.car, self.track))
            if not ok and "lap time" not in d.reasons and not d.lap_bad:
                d.reasons.append("lap time")
            d.laps.append((round(lt, 3), ok))
            if not ok:
                d.invalid = True
            d.lap_start = t
            d.lap_bad = False
            ev = {"t": "lap", "id": d.id, "lap": d.lap, "time": round(lt, 3), "ok": ok}
            if d.lap_ai:
                ev["ai"] = True
            d.lap_ai = bool(d.taken)
            if d.lap >= self.laps:
                d.finish_t = t
                ev["fin"] = round(t, 3)
                if self.first_finish is None:
                    self.first_finish = now
            out.append(ev)
        return out

    def batch(self, now):
        """Zustände aller Fahrer für die Verteilung: [[id, ts, x, z, yaw, roll, pitch, steer, speed, prog, spin], …]."""
        return [row(d) for d in self.drivers.values() if d.state is not None]

    def pings(self):
        """Gemeldeter Ping je verbundenem Fahrer: {id: ms}."""
        return {d.id: d.ping for d in self.drivers.values() if d.connected and d.ping is not None}

    # ---- Wertung ----
    def _results(self):
        ds = list(self.drivers.values())
        valid = sorted((d for d in ds if d.finish_t is not None and not d.invalid), key=lambda d: d.finish_t)
        place = {d.id: i for i, d in enumerate(valid, 1)}
        lst = []
        for d in ds:
            best = min((lt for lt, ok in d.laps if ok), default=None)
            status = "finished" if d.id in place else ("invalid" if d.invalid else "dnf")
            lst.append({"id": d.id, "name": d.display, "car": d.car, "place": place.get(d.id),
                        "time": round(d.finish_t, 3) if d.finish_t is not None else None, "best": best,
                        "status": status, "reasons": list(d.reasons)})
        lst.sort(key=lambda r: (r["place"] is None, r["place"] or 0, r["status"] != "dnf"))
        return {"race_id": self.race_id, "list": lst}

    def rows(self):
        """Zeilen für race_db.record: alle Fahrer ohne ungültige Runde (Zielplatz oder DNF).
        None, wenn das Rennen nicht gespeichert wird (schon gespeichert, < 2 Fahrer, kein Ergebnis)."""
        if self.results is None or self.recorded:
            return None
        rows = []
        for r in self.results["list"]:
            if r["status"] == "invalid":
                continue
            d = self.drivers.get(r["id"])
            rows.append({"user_id": r["id"], "login": d.login if d else "", "display": r["name"],
                         "place": r["place"], "car_key": r["car"] or "", "sub": 0})
        if len(rows) < 2:
            return None
        return rows


class Hub:
    """Alle Räume im Speicher: Code → Room, Tenant → Code."""

    def __init__(self, limits_loader=None, rng=None):
        self.rooms = {}
        self.by_tenant = {}
        self._limits = limits_loader or (lambda: Limits())
        self._rng = rng or random.SystemRandom()

    def _code(self):
        while True:
            c = "".join(self._rng.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
            if c not in self.rooms:
                return c

    def open(self, tenant_id, track, laps, now):
        """Neuer Raum für den Tenant; ein offener Raum desselben Tenants wird geschlossen. → (room, alter Raum|None)."""
        try:
            track = int(track)
        except (TypeError, ValueError):
            track = self._rng.randrange(len(TRACK_LEN))
        if not 0 <= track < len(TRACK_LEN):
            track = self._rng.randrange(len(TRACK_LEN))
        try:
            laps = int(laps)
        except (TypeError, ValueError):
            laps = LAPS_DEFAULT
        laps = max(LAPS_MIN, min(laps, LAPS_MAX))
        old = self.close(tenant_id)
        room = Room(self._code(), tenant_id, track, laps, self._limits(), now)
        self.rooms[room.code] = room
        self.by_tenant[tenant_id] = room.code
        return room, old

    def get(self, code):
        return self.rooms.get((code or "").upper())

    def set_test(self, track, laps, now):
        """Strecke/Runden des Testraums ändern (nur Lobby/Ergebnis). → (ok, Raum)."""
        room = self.ensure_test(now)
        if room.phase not in ("lobby", "done"):
            return False, room
        try:
            t = int(track)
            if 0 <= t < len(TRACK_LEN):
                room.track = t
        except (TypeError, ValueError):
            pass
        try:
            room.laps = max(LAPS_MIN, min(int(laps), LAPS_MAX))
        except (TypeError, ValueError):
            pass
        return True, room

    def ensure_test(self, now):
        """Testraum TEST_CODE anlegen, falls er fehlt (nicht an den Tenant gebunden: der normale Raum bleibt frei)."""
        room = self.rooms.get(TEST_CODE)
        if room is None:
            room = Room(TEST_CODE, TEST_TENANT, TEST_TRACK, TEST_LAPS, self._limits(), now)
            room.test = True
            self.rooms[TEST_CODE] = room
        return room

    def of_tenant(self, tenant_id):
        code = self.by_tenant.get(tenant_id)
        return self.rooms.get(code) if code else None

    def close(self, tenant_id):
        code = self.by_tenant.pop(tenant_id, None)
        return self.rooms.pop(code, None) if code else None

    def sweep(self, now):
        """Räume ohne Verbindungen nach ROOM_TTL entfernen. → entfernte Räume."""
        gone = [r for r in self.rooms.values() if r.clients <= 0 and now - r.active > ROOM_TTL and not r.test]
        for r in gone:
            self.rooms.pop(r.code, None)
            if self.by_tenant.get(r.tenant_id) == r.code:
                self.by_tenant.pop(r.tenant_id, None)
        return gone


def now():
    return time.time()
