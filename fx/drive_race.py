"""Car Drive – Chatrennen steuerbar: Rennraum je Tenant, Plausibilitätsprüfung, KI-Übernahme (reine Logik, ohne Netz).

Neben den Car-Drive-Räumen mit Code (fx/drive_room.py, /drive/<code>) – beide laufen im selben WS-Dienst.

Es gibt nur ein Rennen: das Chatrennen (fx/race.py). Flask gleicht es über die interne Schnittstelle des
WS-Dienstes (drive_ws.py, `sync`) mit dem Raum des Tenants ab: race_id, Phase, Startzeit, Strecke, Runden, Fahrer
(Startreihenfolge, Auto) und – ab dem Schließen der Startaufstellung – die eingefrorenen Piloten. Der Raum meldet
zurück, welche Fahrer gerade verbunden sind (daraus friert Flask die Piloten ein), welche Piloten die KI übernommen
hat und die Zielzeiten/Gültigkeit der Piloten.

Jeder Pilot rechnet sein Auto selbst (js/car-drive-phys.js) und meldet ~20 Hz seinen Zustand; der Server prüft nur
die Plausibilität:
  - Uhr: die Rennzeit rt des Clients darf der Server-Rennzeit höchstens CLOCK_AHEAD voraus sein und läuft nur vorwärts
  - Tempo: gemeldetes Tempo ≤ Höchsttempo des Autos × Nitro × Marge (+ Schlupf)
  - Sprungweite: Abstand zweier Meldungen ≤ Tempo-Grenze × dt + JUMP_MAX (R = zurück auf die Strecke bleibt erlaubt)
  - Fortschritt: gefahrene Meter seit dem Start ≤ Summe der erlaubten Meter (+ PROG_SLACK) – kumulativ
  - Rundenzeit: jede Runde ≥ Mindestzeit (Sim-Rundenzeit des Autos × LAP_FACTOR, sonst globale Untergrenze)
  - Startplatz: der erste gemeldete Fortschritt darf nicht vor der vordersten möglichen Lage des Startplatzes liegen,
    vor dem Start nicht mehr als 3 m vorrollen (Frühstart)
Verstöße markieren die laufende Runde; ein Pilot mit ungültiger Runde wird nicht gewertet (keine Punkte/Coins).

KI-Übernahme: ein Pilot ohne Zustand seit TAKEOVER_GAP s im laufenden Rennen (oder nie verbunden) bekommt ein
Ereignis {t, type: takeover, id, x, z, yaw, speed: 0, prog, lap} (t = Rennsekunden; ohne Zustand {…, grid: 1});
ab dann fahren alle Instanzen das Auto mit CarRaceSim.follower.
Freiwillig (Esc-Menü „Let AI drive“, Taste P): ai() → dasselbe Ereignis aus dem letzten Zustand mit echtem Tempo
(by: user). Zurück („Take the wheel“, auch nach einem Verbindungsabbruch): release() mit der Lage des Nachfahrers
zur Rennsekunde rt (der Client rechnet denselben follower) → Ereignis {t, type: release, id, x, z, yaw, speed, prog,
lap}; geprüft gegen die Übernahme (Fortschritt ≤ Tempo-Grenze × Zeit, nicht im Ziel). Danach gelten wieder die
Zustände; die Prüfung setzt an der Übergabe neu auf, Runden mit KI-Anteil zählen nicht als Rekordrunde (ai im
Runden-Ereignis), die Mindestrundenzeit gilt für sie nicht. Alle Übernahmen/Rückgaben in Reihenfolge: Room.log
(report → ai_events → fx/race.add_ai_events → race_events, aus denen die Overlays deterministisch rechnen).

Höchsttempo/Mindestrundenzeit je Auto: wie in fx/drive_room.py (Limits, data/car-rain/drive-limits.json).

Alle Funktionen bekommen `now` (Unix-Sekunden), damit Tests die Zeit steuern können.
"""
import math
import time

# Grenzwerte und Strecken wie bei den Car-Drive-Räumen mit Code (fx/drive_room.py)
from fx.drive_room import (CLOCK_AHEAD, JUMP_MAX, LAP_FACTOR, NITRO_V, PROG_SLACK, SPEED_MARGIN, SPEED_SLACK,
                           TRACK_LEN, TRACK_NAMES, Limits, _num)

MAX_CLIENTS = 60           # Verbindungen je Tenant (Piloten + Overlays)
ROOM_TTL = 1800.0          # Raum ohne Verbindungen verfällt nach 30 min
RACE_MAX = 200.0           # wie fx/race.RACE_MAX
TAKEOVER_GAP = 2.0         # so lange ohne Zustand → KI übernimmt
STREAM_LEAD = 120.0        # Zustände schon in der Startaufstellung verteilen (Countdown/Vorstellung)
STREAM_TAIL = 15.0         # und nach Rennende noch so lange (Auslaufen)
HIT_LEAD = 0.25            # Treffer gelten so viele Rennsekunden nach dem Aufprall (Zeit zum Verteilen an alle Instanzen)
HIT_GAP = 0.5              # je Pilot und KI-Auto höchstens ein Treffer in dieser Zeit
HIT_MAX_PER_S = 4          # je Pilot höchstens so viele Treffer pro Sekunde
HIT_DV = (-12.0, 6.0)      # Tempoänderung längs (m/s)
HIT_DL = 9.0               # Seitenschub (m/s)



def grid_front(i):
    """Vorderste mögliche Lage (s) des Startplatzes i (0 = Pole): die Sim stellt Zweierreihen nach Autolänge
    auf (erste Reihe −(1 + Länge/2), je Reihe ≥ Länge + 2,5 m) – mit dem kürzesten Auto (~3 m) gerechnet."""
    return -(1.5 + 5.0 * (i // 2))


class Driver:
    """Ein Fahrer des Chatrennens (Startplatz grid, 0-basiert in der ganzen Startaufstellung)."""

    def __init__(self, uid, car, grid):
        self.id = uid
        self.car = car
        self.grid = grid
        self.last = None            # (rt, x, z, prog) der letzten geprüften Meldung
        self.state = None           # letzter Zustand für die Verteilung (Liste)
        self.ts = None              # Server-Zeit des letzten Zustands
        self.lap = 0
        self.lap_start = 0.0
        self.lap_bad = False
        self.laps = []              # [(Zeit, ok)]
        self.finish_t = None
        self.invalid = False
        self.reasons = []
        self.allow = 0.0            # erlaubte Meter seit dem Start
        self.base_prog = None       # Startplatz (erster gemeldeter Fortschritt, höchstens grid_front)
        self.first_prog = None
        self.taken = None           # Übernahme-Ereignis der KI (aktuell; None = Mensch fährt)
        self.lap_ai = False         # laufende Runde mit KI-Anteil (kein Rekord, keine Mindestrundenzeit)

    def flag(self, why):
        self.lap_bad = True
        if why not in self.reasons:
            self.reasons.append(why)


class Room:
    """Rennraum eines Tenants – folgt dem aktuellen Chatrennen."""

    def __init__(self, tenant_id, now, limits=None):
        self.tenant_id = tenant_id
        self.limits = limits or Limits()
        self.race_id = None
        self.phase = "idle"
        self.starts_at = None
        self.track = 0
        self.laps = 2
        self.fw = 15.0
        self.drivers = {}           # id → Driver (Startreihenfolge)
        self.pilots = None          # eingefroren ab intro (Liste) – vorher None
        self.active = now
        self.clients = 0
        self.log = []               # Übernahmen/Rückgaben/Treffer des Rennens in Reihenfolge
        self.hits = {}              # (Pilot, Ziel) → Server-Zeit des letzten Treffers; Pilot → [Server-Zeiten]

    @property
    def track_len(self):
        return TRACK_LEN[self.track]

    # ---- Abgleich mit Flask ----
    def sync(self, info, now, limits_loader=None):
        """info = fx/race.drive_info (oder None = kein Rennen). → True, wenn sich für die Clients etwas geändert hat."""
        self.active = now
        if not info:
            changed = self.phase != "idle"
            self.phase = "idle"
            return changed
        before = (self.race_id, self.phase, self.starts_at, None if self.pilots is None else tuple(self.pilots),
                  tuple(sorted(d.id for d in self.drivers.values() if d.taken)))
        if info.get("race_id") != self.race_id:
            self.race_id = info.get("race_id")
            self.drivers = {}
            self.pilots = None
            self.log = []
            self.hits = {}
            if limits_loader:
                self.limits = limits_loader()
        self.phase = str(info.get("phase") or "idle")
        self.starts_at = _num(info.get("starts_at"))
        try:
            self.track = int(info.get("track") or 0) % len(TRACK_LEN)
        except (TypeError, ValueError):
            self.track = 0
        self.laps = max(1, min(int(_num(info.get("laps")) or 2), 5))
        self.fw = _num(info.get("fw")) or 15.0
        keep = {}
        for row in info.get("racers") or []:
            if not isinstance(row, (list, tuple)) or len(row) < 2:
                continue
            uid, car = str(row[0]), str(row[1] or "")
            grid = int(row[2]) if len(row) > 2 and _num(row[2]) is not None else len(keep)
            d = self.drivers.get(uid) or Driver(uid, car, grid)
            if self.phase in ("lobby", "countdown"):
                d.car, d.grid = car, grid     # Auto-Tausch/Reroll/Abmeldung vor dem Start
            keep[uid] = d
        self.drivers = keep
        if self.pilots is None and isinstance(info.get("pilots"), list):
            self.pilots = [str(p) for p in info["pilots"] if str(p) in self.drivers]
        for uid in info.get("taken") or []:
            d = self.drivers.get(str(uid))
            if d and not d.taken and self.pilots and d.id in self.pilots:
                d.taken = {"t": round(max(0.0, now - (self.starts_at or now)), 2), "type": "takeover", "id": d.id,
                           "grid": 1, "by": "server"}
        after = (self.race_id, self.phase, self.starts_at, None if self.pilots is None else tuple(self.pilots),
                 tuple(sorted(d.id for d in self.drivers.values() if d.taken)))
        return before != after

    def info(self, now=None):
        """Für die Clients (welcome/race): Rennen, Piloten, Übernahmen, Zielzeiten."""
        return {"race_id": self.race_id, "phase": self.phase, "starts_at": self.starts_at, "track": self.track,
                "track_name": TRACK_NAMES[self.track], "laps": self.laps, "fw": self.fw, "pilots": self.pilots,
                "taken": [d.taken for d in self.drivers.values() if d.taken and d.taken.get("by") != "server"],
                "fin": {d.id: round(d.finish_t, 3) for d in self.drivers.values()
                        if d.finish_t is not None and not d.invalid},
                "now": now}

    def report(self, connected):
        """Antwort an Flask: verbundene Fahrer, Übernahmen, Ergebnis + letzter Zustand je Pilot."""
        res, snap = {}, {}
        for d in self.drivers.values():
            if self.pilots is None or d.id not in self.pilots:
                continue
            res[d.id] = {"fin": round(d.finish_t, 3) if d.finish_t is not None else None, "invalid": d.invalid,
                         "reasons": list(d.reasons), "taken": bool(d.taken)}
            if d.state is not None:
                x, z, yaw, _r, _p, _s, speed, prog = d.state[:8]
                snap[d.id] = {"x": x, "z": z, "yaw": yaw, "speed": speed, "prog": prog, "lap": d.lap}
        return {"ok": True, "race_id": self.race_id,
                "connected": sorted(u for u in connected if u in self.drivers),
                "takeovers": [d.taken for d in self.drivers.values() if d.taken and d.taken.get("by") != "server"],
                "ai_events": list(self.log), "pilots": res, "snap": snap}

    def may_drive(self, uid, now):
        """Darf dieser Fahrer jetzt Zustände schicken? Vor dem Einfrieren alle Fahrer (Startaufstellung),
        danach nur nicht übernommene Piloten."""
        d = self.drivers.get(uid)
        if d is None or d.taken or self.starts_at is None or self.phase in ("idle", "podium", "cooldown"):
            return False
        if self.pilots is None:
            return now < self.starts_at
        return uid in self.pilots and now < self.starts_at + RACE_MAX + STREAM_TAIL

    # ---- Zustand eines Piloten ----
    def state(self, uid, msg, now):
        """Zustandsmeldung prüfen und übernehmen. → Ereignisse (Runde, Ziel)."""
        if not self.may_drive(uid, now):
            return []
        d = self.drivers[uid]
        f = {k: _num(msg.get(k)) for k in ("x", "z", "yaw", "roll", "pitch", "steer", "speed", "prog", "rt", "spin")}
        if any(f[k] is None for k in ("x", "z", "yaw", "prog", "rt")):
            return []
        for k in ("roll", "pitch", "steer", "speed", "spin"):
            if f[k] is None:
                f[k] = 0.0
        self.active = now
        d.ts = now
        d.state = [round(f["x"], 2), round(f["z"], 2), round(f["yaw"], 3), round(f["roll"], 3),
                   round(f["pitch"], 3), round(f["steer"], 3), round(f["speed"], 2), round(f["prog"], 2),
                   round(f["spin"] % 6283.0, 2)]
        if d.finish_t is not None:
            return []           # nach dem Ziel nur noch Darstellung (Auslaufen)
        elapsed = now - self.starts_at
        x, z, prog, t = f["x"], f["z"], f["prog"], f["rt"]
        if d.first_prog is None:
            d.first_prog = prog
            front = grid_front(d.grid)
            if prog > front + 0.5:
                d.flag("grid")
            d.base_prog = min(prog, front)
        vcap = self.limits.vtop(d.car) * NITRO_V * SPEED_MARGIN + SPEED_SLACK
        if elapsed < 0:
            # Startaufstellung: nicht losfahren (kleine Toleranz für Uhrenabweichung/Takt beim Übergang)
            if prog > d.first_prog + 3 or (d.last and math.hypot(x - d.last[1], z - d.last[2]) > 5):
                d.flag("jump start")
            d.last = (0.0, x, z, min(prog, d.first_prog + 3))
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
                d.lap_ai = False
            if d.lap >= self.laps:
                d.finish_t = t
                if not d.invalid:
                    ev["fin"] = round(t, 3)
            out.append(ev)
        return out

    # ---- Takt ----
    def tick(self, now):
        """KI-Übernahmen im laufenden Rennen. → neue Übernahme-Ereignisse."""
        if not self.pilots or self.starts_at is None or not self.starts_at <= now < self.starts_at + RACE_MAX:
            return []
        out = []
        for uid in self.pilots:
            d = self.drivers.get(uid)
            if d is None or d.taken or d.finish_t is not None:
                continue
            ref = max(d.ts or 0.0, self.starts_at)
            if now - ref < TAKEOVER_GAP:
                continue
            ev = {"t": round(now - self.starts_at, 2), "type": "takeover", "id": uid}
            if d.state is None:
                ev["grid"] = 1
            else:
                x, z, yaw, _r, _p, _s, _speed, prog = d.state[:8]
                ev.update({"x": x, "z": z, "yaw": yaw, "speed": 0.0, "prog": prog, "lap": d.lap})
            d.taken = ev
            d.lap_ai = True
            self.log.append(ev)
            out.append(ev)
        return out

    def _running(self, now):
        return self.starts_at is not None and self.starts_at <= now < self.starts_at + RACE_MAX

    def ai(self, uid, now):
        """Pilot gibt das Steuer an die KI ab. → Übernahme-Ereignis (aus dem letzten Zustand, echtes Tempo) oder None."""
        d = self.drivers.get(uid)
        if (d is None or d.taken or d.finish_t is not None or not self.pilots or uid not in self.pilots
                or not self._running(now)):
            return None
        elapsed = now - self.starts_at
        ev = {"t": round(elapsed, 2), "type": "takeover", "id": uid, "by": "user"}
        if d.state is None or d.last is None:
            ev["grid"] = 1
        else:
            x, z, yaw, _r, _p, _s, speed, prog = d.state[:8]
            ev.update({"t": round(min(max(d.last[0], 0.0), elapsed), 2), "x": x, "z": z, "yaw": yaw,
                       "speed": max(0.0, speed), "prog": prog, "lap": d.lap})
        d.taken = ev
        d.lap_ai = True
        self.log.append(ev)
        return ev

    def release(self, uid, msg, now):
        """Pilot übernimmt wieder (Lage des Nachfahrers zur Rennsekunde rt). → Rückgabe-Ereignis oder None."""
        d = self.drivers.get(uid)
        if d is None or not d.taken or d.finish_t is not None or not self._running(now):
            return None
        f = {k: _num(msg.get(k)) for k in ("x", "z", "yaw", "speed", "prog", "rt")}
        if any(v is None for v in f.values()):
            return None
        elapsed = now - self.starts_at
        tk, rt, prog = d.taken, min(f["rt"], elapsed + CLOCK_AHEAD), f["prog"]
        t0 = max(0.0, _num(tk.get("t")) or 0.0)
        p0 = _num(tk.get("prog"))
        if p0 is None:
            p0 = grid_front(d.grid)
        vcap = self.limits.vtop(d.car) * NITRO_V * SPEED_MARGIN + SPEED_SLACK
        if rt < t0 or prog > p0 + vcap * (rt - t0) + PROG_SLACK or prog >= self.laps * self.track_len or f["speed"] > vcap:
            return None
        x, z, speed = round(f["x"], 2), round(f["z"], 2), round(max(0.0, f["speed"]), 2)
        lap = int(math.floor(prog / self.track_len)) if prog > 0 else 0
        ev = {"t": round(rt, 2), "type": "release", "id": uid, "x": x, "z": z, "yaw": round(f["yaw"], 3),
              "speed": speed, "prog": round(prog, 2), "lap": lap}
        d.taken = None
        d.ts = now
        if d.first_prog is None:
            d.first_prog = d.base_prog = min(prog, grid_front(d.grid))
        d.allow = max(d.allow, prog - d.base_prog)
        while d.lap < lap:
            d.lap += 1
            d.laps.append((None, True))     # Runde der KI: keine Zeit, kein Rekord
            d.lap_start = rt
        d.lap_ai = True
        d.last = (rt, x, z, prog)
        d.state = [x, z, ev["yaw"], 0.0, 0.0, 0.0, speed, round(prog, 2), 0.0]
        self.log.append(ev)
        return ev

    def hit(self, uid, msg, now):
        """Pilot hat ein KI-Auto getroffen (Car Drive rechnet den Stoß). → Ereignis {t, type: hit, id (KI-Auto), by,
        dv, dl, spin} oder None. t = Rennsekunde des Aufpralls + HIT_LEAD (alle Instanzen wenden es im selben
        Sim-Schritt an); Ziel muss ein Fahrer ohne Car Drive sein (die KI der Sim), Werte begrenzt, Rate begrenzt."""
        d = self.drivers.get(uid)
        target = str(msg.get("id") or "")
        if (d is None or d.taken or d.finish_t is not None or not self.pilots or uid not in self.pilots
                or not self._running(now) or target == uid or target not in self.drivers or target in self.pilots):
            return None
        f = {k: _num(msg.get(k)) for k in ("rt", "dv", "dl")}
        if any(v is None for v in f.values()):
            return None
        elapsed = now - self.starts_at
        rt = min(max(f["rt"], elapsed - 1.0), elapsed + CLOCK_AHEAD)    # höchstens 1 s alte Treffer
        recent = [x for x in self.hits.get(uid, []) if now - x < 1.0]
        if len(recent) >= HIT_MAX_PER_S or now - self.hits.get((uid, target), -1e9) < HIT_GAP:
            return None
        recent.append(now)
        self.hits[uid] = recent
        self.hits[(uid, target)] = now
        ev = {"t": round(rt + HIT_LEAD, 2), "type": "hit", "id": target, "by": uid,
              "dv": round(max(HIT_DV[0], min(HIT_DV[1], f["dv"])), 2),
              "dl": round(max(-HIT_DL, min(HIT_DL, f["dl"])), 2), "spin": 1 if msg.get("spin") else 0}
        self.log.append(ev)
        return ev

    def streaming(self, now):
        return self.starts_at is not None and self.starts_at - STREAM_LEAD < now < self.starts_at + RACE_MAX + STREAM_TAIL

    def batch(self, now):
        """Zustände der (noch nicht übernommenen) Fahrer: [[id, ts, x, z, yaw, roll, pitch, steer, speed, prog, spin], …]."""
        return [[d.id, round(d.ts, 3)] + d.state for d in self.drivers.values()
                if d.state is not None and not d.taken and now - d.ts < 30]


class Hub:
    """Alle Räume im Speicher: Tenant → Room."""

    def __init__(self, limits_loader=None):
        self.rooms = {}
        self._limits = limits_loader or (lambda: Limits())

    def get(self, tenant_id, now, create=True):
        room = self.rooms.get(tenant_id)
        if room is None and create:
            room = self.rooms[tenant_id] = Room(tenant_id, now, self._limits())
        return room

    def sync(self, tenant_id, info, now):
        room = self.get(tenant_id, now)
        return room, room.sync(info, now, self._limits)

    def sweep(self, now):
        """Räume ohne Verbindungen nach ROOM_TTL entfernen. → entfernte Räume."""
        gone = [r for r in self.rooms.values() if r.clients <= 0 and now - r.active > ROOM_TTL]
        for r in gone:
            self.rooms.pop(r.tenant_id, None)
        return gone


def now():
    return time.time()
