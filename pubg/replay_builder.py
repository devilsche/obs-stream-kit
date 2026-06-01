"""Parst rohe PUBG-Telemetrie zu strukturierten Replay-Daten fuer ALLE
Teams eines Matches. Keine DB-/HTTP-Abhaengigkeit — nimmt Raw-Blob +
Team-Mapping + Map-Meta als Argumente, damit isoliert testbar."""


def normalize_coords(x_cm, y_cm, mapKm):
    """World-cm → [0,1] relativ zur Kartengroesse. Geclamped."""
    if x_cm is None or y_cm is None:
        return None, None
    span = mapKm * 100000.0
    nx = max(0.0, min(1.0, x_cm / span))
    ny = max(0.0, min(1.0, y_cm / span))
    return nx, ny


# 24-Farben-Palette, gut unterscheidbar (HSV-verteilt, gesaettigt).
_TEAM_PALETTE = [
    "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
    "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff",
    "#9a6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1",
    "#000075", "#808080", "#ff6699", "#00cc99", "#cc6600", "#6699ff",
]


def team_colors(team_ids):
    """team_id → hex-Farbe. Sortiert nach team_id fuer stabile Zuordnung,
    Palette wraps bei >24 Teams."""
    out = {}
    for i, tid in enumerate(sorted(set(team_ids))):
        out[tid] = _TEAM_PALETTE[i % len(_TEAM_PALETTE)]
    return out


import datetime as _dt


def _ts_ms(iso):
    if not iso:
        return None
    t = _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return int(t.timestamp() * 1000)


def _loc(obj):
    loc = (obj or {}).get("location") or {}
    return loc.get("x"), loc.get("y")


def extract_events(raw_events, mapKm, position_interval_ms=1000):
    """Raw PUBG-Events → flache, sortierte Replay-Event-Liste fuer ALLE
    Spieler. Position-Events werden pro Spieler auf position_interval_ms
    ausgeduennt (sonst flutet 64×alle-100ms die Response).

    Event-Dicts:
      landing  : {type, ts, actorId, x, y}
      position : {type, ts, actorId, x, y}
      hit      : {type, ts, actorId, targetId, ax, ay, tx, ty, weapon, distance}
      knock    : {type, ts, actorId, targetId, ax, ay, tx, ty, weapon, distance}
      kill     : {type, ts, actorId, targetId, ax, ay, tx, ty, weapon, distance}
      death    : {type, ts, actorId}  (abgeleitet aus kill.victim)
      zone     : {type, ts, safeX, safeY, safeR, nextX, nextY, nextR}
                 (Bluezone = safetyZone, naechste weisse Zone = poisonGasWarning;
                  Coords 0-1 roh-normalisiert, Radien als Anteil der Map-Spanne)

    Rueckgabe: (events, flight_path)
      flight_path: [[nx, ny, ts_ms], ...] — Flugzeug-Waypoints (z>=150000 cm),
                   ein Spieler als Repraesentant, ts normalisiert noch NICHT.
    """
    out = []
    last_pos_ts = {}  # actorId → letzter behaltener Position-ts
    # Flugroute: ALLE Spieler zusammengeführt, 1-s-Buckets → lückenlose Route
    _flight_by_ts = {}  # ts_bucket (ms, 1s-Raster) → [nx, ny]
    for e in raw_events:
        et = e.get("_T", "")
        ts = _ts_ms(e.get("_D"))
        if ts is None:
            continue
        if et == "LogParachuteLanding":
            ch = e.get("character") or {}
            x, y = _loc(ch)
            nx, ny = normalize_coords(x, y, mapKm)
            if nx is None:
                continue
            out.append({"type": "landing", "ts": ts,
                        "actorId": ch.get("accountId"), "x": nx, "y": ny})
        elif et == "LogPlayerPosition":
            ch = e.get("character") or {}
            acc = ch.get("accountId")
            loc = (ch.get("location") or {})
            z = loc.get("z")
            # Flugroute: z >= 150000 cm (Flugzeug-Cruise-Hoehe).
            # Bei der INITIALEN Plane (Spieler hat noch nie eine Boden-
            # Position gehabt) → pool ins flight_by_ts (gemeinsame Linie).
            # Bei spaeterer Hoehe (Comeback-Heli, Vehicle in der Luft) →
            # als per-Actor Position emittieren, sonst sieht man den
            # Comeback-Spieler im Heli nicht.
            high_alt = (z is not None and z >= 150000)
            already_grounded = acc in last_pos_ts  # erste Ground-Pos gesehen
            if high_alt and not already_grounded:
                x, y = _loc(ch)
                nx, ny = normalize_coords(x, y, mapKm)
                if nx is not None:
                    bucket = (ts // 1000) * 1000
                    if bucket not in _flight_by_ts:
                        _flight_by_ts[bucket] = [nx, ny]
                continue
            prev = last_pos_ts.get(acc)
            if prev is not None and ts - prev < position_interval_ms:
                continue
            x, y = _loc(ch)
            nx, ny = normalize_coords(x, y, mapKm)
            if nx is None:
                continue
            last_pos_ts[acc] = ts
            out.append({"type": "position", "ts": ts,
                        "actorId": acc, "x": nx, "y": ny})
        elif et in ("LogPlayerTakeDamage", "LogPlayerMakeGroggy",
                    "LogPlayerKillV2"):
            if et == "LogPlayerKillV2":
                actor = e.get("killer") or {}
                info = e.get("killerDamageInfo") or {}
                weapon = info.get("damageCauserName") or e.get("damageCauserName")
                distance = info.get("distance") or e.get("distance")
                typ = "kill"
            elif et == "LogPlayerMakeGroggy":
                actor = e.get("attacker") or {}
                weapon = e.get("damageCauserName")
                distance = e.get("distance")
                typ = "knock"
            else:
                actor = e.get("attacker") or {}
                weapon = e.get("damageCauserName")
                distance = e.get("distance")
                typ = "hit"
            victim = e.get("victim") or {}
            ax, ay = normalize_coords(*_loc(actor), mapKm)
            tx, ty = normalize_coords(*_loc(victim), mapKm)
            out.append({
                "type": typ, "ts": ts,
                "actorId": actor.get("accountId"),
                "targetId": victim.get("accountId"),
                "ax": ax, "ay": ay, "tx": tx, "ty": ty,
                "weapon": weapon, "distance": distance,
            })
            if typ == "kill":
                out.append({"type": "death", "ts": ts,
                            "actorId": victim.get("accountId")})
        elif et in ("LogVehicleRide", "LogVehicleLeave"):
            # Comeback-Heli (DummyTransportAircraft) eintragen damit das
            # Frontend einen Marker bzw. Comeback-Linie zeichnen kann.
            # actor_x/y kommt aus character.location (siehe pubg/telemetry.py).
            ch = e.get("character") or {}
            acc = ch.get("accountId")
            x, y = _loc(ch)
            nx, ny = normalize_coords(x, y, mapKm)
            if acc:
                vehicle = (e.get("vehicle") or {}).get("vehicleId") or ""
                out.append({
                    "type": "vehicle_enter" if et == "LogVehicleRide" else "vehicle_leave",
                    "ts": ts, "actorId": acc, "x": nx, "y": ny,
                    "vehicleId": vehicle,
                    "seatIndex": e.get("seatIndex"),
                })
        elif et == "LogGameStatePeriodic":
            gs = e.get("gameState") or {}
            span = mapKm * 100000.0
            safe = gs.get("safetyZonePosition") or {}
            nxt = gs.get("poisonGasWarningPosition") or {}
            sr = gs.get("safetyZoneRadius")
            nr = gs.get("poisonGasWarningRadius")
            sx, sy = normalize_coords(safe.get("x"), safe.get("y"), mapKm)
            zx, zy = normalize_coords(nxt.get("x"), nxt.get("y"), mapKm)
            out.append({
                "type": "zone", "ts": ts,
                "safeX": sx, "safeY": sy,
                "safeR": (sr / span) if sr else None,
                "nextX": zx, "nextY": zy,
                "nextR": (nr / span) if nr else None,
            })
    out.sort(key=lambda e: e["ts"])
    flight_pts = [[nx, ny, ts] for ts, (nx, ny) in sorted(_flight_by_ts.items())]
    return out, flight_pts


def _unify_shared_vehicle_paths(events, team_mapping):
    """Shared-Vehicle-Pfad-Unifikation fuer Replay.

    Wenn >=2 Mitglieder DESSELBEN Teams im selben Fahrzeug mit
    ueberlappenden Enter/Leave-Intervallen sind, ersetzen wir die
    Position-Events der Mitfahrer waehrend dieses Intervalls durch
    die des Fahrers (seat_index=0). Resultat: ihre Spuren liegen
    exakt deckungsgleich auf der Karte statt unzaehliger ueber-
    lappender Punkte.

    Modifies `events` in place. team_mapping = {acc: tid}.
    """
    # 1) Per-Account VehicleEnter/Leave-Intervalle pro vid sammeln
    enters = {}  # acc → [(ts, vid, seat), ...]
    leaves = {}  # acc → [(ts, vid), ...]
    for e in events:
        if e["type"] == "vehicle_enter":
            enters.setdefault(e["actorId"], []).append(
                (e["ts"], e.get("vehicleId") or "", e.get("seatIndex")))
        elif e["type"] == "vehicle_leave":
            leaves.setdefault(e["actorId"], []).append(
                (e["ts"], e.get("vehicleId") or ""))
    # Intervalle pro acc bauen (paired enter/leave je vid)
    intervals = {}  # acc → [(start, end, vid, seat), ...]
    for acc, ents in enters.items():
        for (ets, vid, seat) in ents:
            # finde naechsten Leave fuer DIESES vid nach ets
            lv_end = None
            for (lts, lvid) in leaves.get(acc, []):
                if lvid == vid and lts > ets:
                    lv_end = lts
                    break
            if lv_end is None:
                lv_end = float("inf")
            intervals.setdefault(acc, []).append((ets, lv_end, vid, seat))
    # 2) Shared-Episodes finden (>=2 team-mates, selber vid, overlap)
    episodes = []
    seen = set()
    accs_sorted = sorted(intervals.keys())
    for a in accs_sorted:
        tid_a = team_mapping.get(a)
        if tid_a is None:
            continue
        for (s, e, vid, seat_a) in intervals[a]:
            riders = {a}
            riders_seats = {a: seat_a}
            ep_s, ep_e = s, e
            for b in accs_sorted:
                if b == a or team_mapping.get(b) != tid_a:
                    continue
                for (s2, e2, vid2, seat_b) in intervals[b]:
                    if vid2 != vid:
                        continue
                    if s2 < ep_e and e2 > ep_s:
                        riders.add(b)
                        riders_seats[b] = seat_b
                        ep_s = min(ep_s, s2)
                        ep_e = max(ep_e, e2)
            if len(riders) < 2:
                continue
            key = (vid, frozenset(riders), ep_s, ep_e)
            if key in seen:
                continue
            seen.add(key)
            # Fahrer = seat_index=0; sonst erster Einsteiger als Fallback
            driver = None
            for r in riders:
                if riders_seats.get(r) == 0:
                    driver = r
                    break
            if driver is None:
                driver = min(riders,
                              key=lambda r: next(
                                  (s for (s, _, v, _x) in intervals[r] if v == vid),
                                  float("inf")))
            episodes.append((ep_s, ep_e, driver, riders - {driver}))
    if not episodes:
        return events
    # 3) Fuer jede Episode: Position-Events des Drivers in dem Intervall
    # raussuchen und fuer Passenger als Kopien einfuegen, die Original-
    # Position-Events der Passenger in dem Intervall entfernen.
    new_events = []
    # Schneller Lookup: drop_set[acc] = set of ts of positions zu entfernen
    drop_set = {}
    add_events = []
    for (ep_s, ep_e, driver, passengers) in episodes:
        driver_pos = [(e["ts"], e["x"], e["y"]) for e in events
                       if e["type"] == "position"
                       and e["actorId"] == driver
                       and ep_s <= e["ts"] <= ep_e]
        for p in passengers:
            # Markiere Passenger-Positions im Intervall zum Loeschen
            for e in events:
                if e["type"] != "position" or e["actorId"] != p:
                    continue
                if ep_s <= e["ts"] <= ep_e:
                    drop_set.setdefault(p, set()).add(e["ts"])
            # Driver-Positions als Passenger-Positions duplizieren
            for (ts, x, y) in driver_pos:
                add_events.append({"type": "position", "ts": ts,
                                    "actorId": p, "x": x, "y": y})
    for e in events:
        if e["type"] == "position":
            if e["ts"] in drop_set.get(e["actorId"], ()):
                continue
        new_events.append(e)
    new_events.extend(add_events)
    new_events.sort(key=lambda e: e["ts"])
    return new_events


def build_replay(raw_events, match_id, map_name, mapKm,
                 team_mapping, names, position_interval_ms=1000):
    """Top-Level: Raw-Blob → vollstaendiges Replay-Dict.

    team_mapping: {account_id: team_id}
    names:        {account_id: display_name}
    """
    events, flight_pts = extract_events(raw_events, mapKm, position_interval_ms)
    # Shared-Vehicle-Pfade unifizieren (Team-Mitglieder im selben Auto
    # bekommen alle die Driver-Trajektorie statt eigener Position-Events).
    events = _unify_shared_vehicle_paths(events, team_mapping)
    # Teams aus team_mapping aufbauen
    by_team = {}
    for acc, tid in team_mapping.items():
        by_team.setdefault(tid, []).append(acc)
    colors = team_colors(list(by_team.keys()))
    teams = []
    for tid in sorted(by_team.keys()):
        players = [{"accountId": acc, "name": names.get(acc, acc[:8])}
                   for acc in by_team[tid]]
        teams.append({"teamId": tid, "color": colors[tid],
                      "players": players})
    # Dauer: erstes bis letztes Event, normalisiert auf 0
    t0_abs = events[0]["ts"] if events else 0
    if events:
        for e in events:
            e["ts"] = e["ts"] - t0_abs
        duration = events[-1]["ts"]
    else:
        duration = 0
    # Flugroute: t0 abziehen; Buckets sind bereits 1s → direkt übernehmen
    flight_path = [[nx, ny, abs_ts - t0_abs] for nx, ny, abs_ts in flight_pts]
    return {
        "matchId": match_id,
        "mapName": map_name,
        "mapKm": mapKm,
        "durationMs": duration,
        "teams": teams,
        "events": events,
        "flightPath": flight_path,
    }
