"""Car Drive Mehrspieler: Raum-Lebenszyklus, Plausibilitätsprüfung, Wertung (fx/drive_room.py), Tickets."""
import math

import pytest

from fx import drive_auth, drive_room as dr

T0 = 1_000_000.0


def ident(uid, role="viewer", garage=None, rnd=None):
    return {"id": uid, "login": uid, "display": uid.upper(), "role": role, "garage": garage, "rnd": rnd}


def room_with(n, track=0, laps=2, limits=None):
    hub = dr.Hub(limits_loader=lambda: limits or dr.Limits())
    room, _ = hub.open(7, track, laps, T0)
    for i in range(n):
        ok, _ = room.join(ident("u%d" % i, garage=None), "car-a", 0, T0)
        assert ok
    return hub, room


def drive(room, uid, rt, prog, now, x=None, z=0.0, speed=20.0):
    msg = {"x": prog if x is None else x, "z": z, "yaw": 0, "prog": prog, "rt": rt, "speed": speed}
    return room.state(uid, msg, now)


def race_clean(room, uid, laps, lap_time=70.0, start=None, steps=60):
    """Fährt plausibel `laps` Runden: gleichmäßig, Tempo = Strecke / Rundenzeit."""
    L = room.track_len
    s0 = dr.grid_pose(room.drivers[uid].grid)[0]
    total = laps * L - s0 + 0.5
    T = laps * lap_time
    evs = []
    for k in range(1, steps * laps + 1):
        rt = T * k / (steps * laps)
        prog = s0 + total * k / (steps * laps)
        evs += drive(room, uid, rt, prog, room.start_at + rt, speed=total / T)
    return evs


# ---- Lebenszyklus ----

def test_open_gives_code_and_replaces_old_room():
    hub = dr.Hub()
    r1, old = hub.open(1, 2, 3, T0)
    assert old is None and len(r1.code) == 6 and set(r1.code) <= set(dr.CODE_ALPHABET)
    assert hub.get(r1.code.lower()) is r1 and hub.of_tenant(1) is r1
    r2, old = hub.open(1, "x", 99, T0)
    assert old is r1 and hub.get(r1.code) is None and hub.of_tenant(1) is r2
    assert 0 <= r2.track < 5 and r2.laps == dr.LAPS_MAX


def test_close_and_sweep():
    hub = dr.Hub()
    r, _ = hub.open(1, 0, 3, T0)
    assert hub.close(1) is r and hub.get(r.code) is None and hub.close(1) is None
    r, _ = hub.open(2, 0, 3, T0)
    assert hub.sweep(T0 + 10) == []
    assert hub.sweep(T0 + dr.ROOM_TTL + 1) == [r] and hub.of_tenant(2) is None


def test_join_limits_and_garage():
    hub, room = room_with(0)
    assert room.join(ident("v", garage=["a"], rnd="r"), "b", 0, T0) == (False, "that car is not in your garage")
    assert room.join(ident("v", garage=["a"], rnd="r"), "r", 0, T0)[0]
    assert room.join(ident("v", garage=["a"], rnd="r"), "a", 2, T0) == (True, "car changed")
    assert room.drivers["v"].car == "a" and room.drivers["v"].paint == 2
    for i in range(dr.MAX_DRIVERS - 1):
        assert room.join(ident("x%d" % i), "c", 0, T0)[0]
    assert room.join(ident("late"), "c", 0, T0) == (False, "grid full")


def test_start_countdown_race_and_no_join_while_running():
    hub, room = room_with(2)
    assert room.tick(T0) == []
    ok, _ = room.start(T0)
    assert ok and room.phase == "countdown" and room.start_at == T0 + dr.COUNTDOWN
    assert [d.grid for d in room.drivers.values()] == [0, 1]
    assert room.start(T0)[0] is False
    assert room.join(ident("late"), "c", 0, T0)[0] is False
    evs = room.tick(T0 + dr.COUNTDOWN)
    assert room.phase == "race" and evs[0]["phase"] == "race"


def test_start_needs_a_driver_and_lobby_leave_removes():
    hub, room = room_with(1)
    room.leave("u0", T0)
    assert "u0" not in room.drivers
    assert room.start(T0) == (False, "nobody on the grid")


# ---- Wertung ----

def test_clean_race_two_finishers_and_rows():
    hub, room = room_with(2, laps=2)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    e0 = race_clean(room, "u0", 2, lap_time=68.0)
    e1 = race_clean(room, "u1", 2, lap_time=70.0)
    assert [e["lap"] for e in e0] == [1, 2] and all(e["ok"] for e in e0) and "fin" in e0[-1]
    assert all(e["ok"] for e in e1)
    evs = room.tick(room.start_at + 160)
    res = next(e for e in evs if e["t"] == "results")
    assert room.phase == "done"
    assert [(r["id"], r["place"], r["status"]) for r in res["list"]] == [("u0", 1, "finished"), ("u1", 2, "finished")]
    rows = room.rows()
    assert [(r["user_id"], r["place"]) for r in rows] == [("u0", 1), ("u1", 2)]
    room.recorded = True
    assert room.rows() is None          # Sperre: nur einmal


def test_finish_window_ends_race_with_dnf():
    hub, room = room_with(2, laps=1)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    race_clean(room, "u0", 1)
    drive(room, "u1", 1.0, -5.0, room.start_at + 1)
    first = room.first_finish
    assert not any(e["t"] == "results" for e in room.tick(first + 1))
    evs = room.tick(first + dr.FINISH_WINDOW)
    res = next(e for e in evs if e["t"] == "results")
    assert [(r["id"], r["status"]) for r in res["list"]] == [("u0", "finished"), ("u1", "dnf")]
    assert [(r["user_id"], r["place"]) for r in room.rows()] == [("u0", 1), ("u1", None)]


def test_single_driver_race_is_not_recorded():
    hub, room = room_with(1, laps=1)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    race_clean(room, "u0", 1)
    room.tick(room.start_at + 90)
    assert room.phase == "done" and room.rows() is None


def test_restart_from_done_resets_progress():
    hub, room = room_with(2, laps=1)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    race_clean(room, "u0", 1)
    race_clean(room, "u1", 1)
    room.tick(room.start_at + 90)
    rid = room.race_id
    ok, _ = room.start(T0 + 200)
    assert ok and room.race_id != rid and all(d.finish_t is None and d.lap == 0 for d in room.drivers.values())


def test_disconnected_driver_in_race_stays_as_dnf_and_race_ends_when_rest_finished():
    hub, room = room_with(2, laps=1)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    room.leave("u1", room.start_at + 1)
    assert "u1" in room.drivers and room.drivers["u1"].connected is False
    race_clean(room, "u0", 1)
    room.tick(room.first_finish + 1)
    # die KI fährt u1 weiter, solange u0 verbunden ist (Ziel offen bis zur Zielfrist)
    assert room.drivers["u1"].taken
    evs = room.tick(room.first_finish + dr.FINISH_WINDOW)
    res = next(e for e in evs if e["t"] == "results")
    assert [(r["id"], r["status"]) for r in res["list"]] == [("u0", "finished"), ("u1", "dnf")]


# ---- Plausibilität ----

def _finish_after(room, uid, cheat):
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    cheat(room)
    room.tick(room.start_at + 400)
    return {r["id"]: r for r in room.results["list"]}


def test_too_fast_lap_is_invalid():
    hub, room = room_with(2, laps=1)
    res = _finish_after(room, "u0", lambda r: (race_clean(r, "u0", 1, lap_time=5.0), race_clean(r, "u1", 1)))
    assert res["u0"]["status"] == "invalid" and res["u0"]["place"] is None
    assert res["u1"]["place"] == 1
    assert room.rows() is None          # nur ein gültiger Fahrer übrig → wird nicht gespeichert


def test_teleport_is_flagged():
    hub, room = room_with(2, laps=1)

    def cheat(r):
        drive(r, "u0", 1.0, 10.0, r.start_at + 1)
        drive(r, "u0", 1.05, 200.0, r.start_at + 1.05)        # 190 m in 50 ms
        race_clean(r, "u1", 1)
    res = _finish_after(room, "u0", cheat)
    assert "jump" in room.drivers["u0"].reasons or "progress" in room.drivers["u0"].reasons


def test_speed_and_clock_flags():
    hub, room = room_with(1, laps=1)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    drive(room, "u0", 1.0, 5.0, room.start_at + 1, speed=500)
    assert "speed" in room.drivers["u0"].reasons
    drive(room, "u0", 30.0, 6.0, room.start_at + 2)          # Rennzeit läuft der Server-Uhr davon
    assert "clock" in room.drivers["u0"].reasons


def test_jump_start_is_flagged():
    hub, room = room_with(1, laps=1)
    room.start(T0)
    drive(room, "u0", 0.0, -4.0, T0 + 1)                      # Startplatz liegt bei −4 m
    assert room.drivers["u0"].reasons == []
    drive(room, "u0", 0.0, 2.0, T0 + 2)
    assert "jump start" in room.drivers["u0"].reasons


def test_reset_back_on_track_is_allowed():
    hub, room = room_with(1, laps=1)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    drive(room, "u0", 1.0, 10.0, room.start_at + 1, x=10.0, z=12.0)
    drive(room, "u0", 1.05, 10.0, room.start_at + 1.05, x=10.0, z=0.0)   # R: 12 m seitlich zurück
    assert room.drivers["u0"].reasons == []


def test_limits_per_car():
    lim = dr.Limits({"cars": {"slow": {"vtop": 10, "lap": [70, 70, 70, 70, 40]}, "old": {"vtop": 20, "lap": [20]}, "bad": "x"}})
    assert lim.vtop("slow") == 10 and lim.vtop("other") == dr.GLOBAL_VTOP
    assert lim.min_lap("slow", 0) == 70 * dr.LAP_FACTOR
    # veraltete Werte (alte, kurze Strecken) fallen nie unter die globale Untergrenze
    assert lim.min_lap("old", 0) == dr.GLOBAL_LAP[0] * dr.LAP_FACTOR
    assert lim.min_lap("other", 2) == dr.GLOBAL_LAP[2] * dr.LAP_FACTOR
    hub, room = room_with(1, laps=1, limits=lim)
    room.drivers["u0"].car = "slow"
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    drive(room, "u0", 1.0, 5.0, room.start_at + 1, speed=20)
    assert "speed" in room.drivers["u0"].reasons


def test_garbage_state_is_ignored():
    hub, room = room_with(1)
    room.start(T0)
    assert room.state("u0", {"x": "nan", "z": 0, "yaw": 0, "prog": 0, "rt": 0}, T0) == []
    assert room.state("nobody", {"x": 0, "z": 0, "yaw": 0, "prog": 0, "rt": 0}, T0) == []
    assert room.drivers["u0"].state is None


# ---- Tickets ----

def test_ticket_and_viewer_cookie_roundtrip():
    tk = drive_auth.make_ticket({"tid": 1, "code": "ABCDEF", "id": "42"}, secret="s1")
    assert drive_auth.read_ticket(tk, secret="s1")["id"] == "42"
    assert drive_auth.read_ticket(tk, secret="s2") is None
    assert drive_auth.read_ticket("junk", secret="s1") is None
    ck = drive_auth.make_viewer({"id": 9, "login": "abc", "display_name": "Abc"}, secret="s1")
    assert drive_auth.read_viewer(ck, secret="s1") == {"id": "9", "login": "abc", "display": "Abc"}
    assert drive_auth.read_viewer(ck, secret="s2") is None
    assert drive_auth.internal_key("s1") != drive_auth.internal_key("s2")


def test_save_limits_filters(tmp_path):
    n = drive_auth.save_limits(str(tmp_path), {"cars": {"a": {"vtop": 20, "lap": [20, 21]}, "b": {"vtop": "x"},
                                                        "c": {"vtop": 500}}})
    assert n == 1
    assert drive_auth.load_limits(str(tmp_path)) == {"cars": {"a": {"vtop": 20.0, "lap": [20.0, 21.0]}}}


# ---- Zeitstempel und Ping (fx/drive_room.stamp) ----
def test_state_uses_sender_stamp_and_ping():
    _, room = room_with(1)
    room.start(T0)
    now = room.start_at + 1.0
    msg = {"x": -4, "z": 0, "yaw": 0, "prog": -4, "rt": 1.0, "speed": 0, "ts": now - 0.08, "pg": 47.4}
    room.state("u0", msg, now)
    d = room.drivers["u0"]
    assert d.sts == pytest.approx(now - 0.08) and d.ts == now
    assert room.batch(now)[0][1] == round(now - 0.08, 3)
    assert room.pings() == {"u0": 47}


def test_state_stamp_implausible_falls_back_and_stays_increasing():
    _, room = room_with(1)
    room.start(T0)
    d, now = room.drivers["u0"], room.start_at + 1.0
    base = {"x": -4, "z": 0, "yaw": 0, "prog": -4, "rt": 1.0, "speed": 0}
    room.state("u0", dict(base, ts=now - 5, pg=-3), now)          # zu alt → Empfangszeit, Ping verworfen
    assert d.sts == now and d.ping is None
    room.state("u0", dict(base, rt=1.05, ts=now - 0.5), now + 0.01)  # älter als der letzte → knapp danach
    assert d.sts == pytest.approx(now + 0.001)
    room.state("u0", dict(base, rt=1.1, ts=now + 9), now + 0.05)   # zu weit voraus → Empfangszeit
    assert d.sts == now + 0.05


# ---- KI-Übernahme bei Verbindungsabbruch ----
def _racing(n=2, laps=1):
    hub, room = room_with(n, laps=laps)
    room.start(T0)
    room.tick(T0 + dr.COUNTDOWN)
    return room


def test_takeover_after_gap_with_last_state_and_carrier():
    room = _racing()
    sa = room.start_at
    drive(room, "u0", 2.0, 30.0, sa + 2.0, speed=20.0)
    drive(room, "u1", 2.0, 25.0, sa + 2.0, speed=18.0)
    assert not [e for e in room.tick(sa + 2.0 + dr.TAKEOVER_GAP - 0.1) if e["t"] == "takeover"]
    drive(room, "u0", 4.9, 80.0, sa + 4.9, speed=20.0)
    evs = room.tick(sa + 2.0 + dr.TAKEOVER_GAP + 0.1)
    tk = [e["ev"] for e in evs if e["t"] == "takeover"]
    assert len(tk) == 1 and tk[0]["id"] == "u1" and tk[0]["t"] == 2.0 and tk[0]["prog"] == 25.0 and tk[0]["speed"] == 18.0
    assert "x" in tk[0] and room.taken_list() == tk
    assert {"t": "carrier", "id": "u0"} in evs
    assert room.tick(sa + 6) == [] or not any(e["t"] == "takeover" for e in room.tick(sa + 6))


def test_taken_car_moves_only_by_carrier_ai_states_and_laps_count_without_record():
    room = _racing(laps=1)
    sa, L = room.start_at, room.track_len
    room.leave("u1", sa + 1)
    drive(room, "u0", 4.0, 40.0, sa + 4.0)
    room.tick(sa + 1 + dr.TAKEOVER_GAP + 0.1)
    d = room.drivers["u1"]
    assert d.taken and d.taken.get("d") is not None and not room.drivers["u0"].taken          # nie gefahren: Übernahme vom Startplatz
    assert drive(room, "u1", 5.0, 50.0, sa + 5) == [] and d.last is None   # eigene Meldung ruht
    s0 = dr.grid_pose(1)[0]
    room.limits.min_lap = lambda car, track: 999.0          # ohne KI wäre jede Runde zu schnell
    evs = []
    for k in range(1, 81):
        rt = 4.0 + 55.0 * k / 80
        prog = s0 + (L - s0 + 0.5) * k / 80
        evs += room.state("u1", {"x": prog, "z": 0, "yaw": 0, "prog": prog, "rt": rt, "speed": 20.0}, sa + rt, ai=True)
    lap = [e for e in evs if e["t"] == "lap"]
    assert lap and lap[0]["ok"] and lap[0]["ai"] and lap[0].get("fin") is not None   # gültig nur dank KI-Runde
    assert d.connected is False


def test_release_back_to_driver():
    room = _racing(laps=2)
    sa = room.start_at
    drive(room, "u1", 1.0, 10.0, sa + 1, speed=15.0)
    drive(room, "u0", 4.0, 40.0, sa + 4.0)
    room.tick(sa + 1 + dr.TAKEOVER_GAP + 0.1)
    d = room.drivers["u1"]
    room.state("u1", {"x": 60, "z": 0, "yaw": 0, "prog": 60.0, "rt": 5.0, "speed": 15.0}, sa + 5, ai=True)
    assert room.release("u1", {"x": 0, "z": 0, "yaw": 0, "speed": 15, "prog": 400.0, "rt": 5.1}, sa + 5.1) is None
    ev = room.release("u1", {"x": 61, "z": 0, "yaw": 0, "speed": 15, "prog": 61.5, "rt": 5.1}, sa + 5.1)
    assert ev and ev["t"] == "release" and ev["ev"]["prog"] == 61.5 and d.taken is None and d.connected
    assert d.lap_ai                                             # laufende Runde bleibt ohne Rekord
    assert drive(room, "u1", 5.2, 63.0, sa + 5.2, speed=15.0) == [] and d.last[3] == 63.0


def test_race_ends_when_nobody_connected_to_carry():
    room = _racing()
    sa = room.start_at
    room.leave("u0", sa + 1)
    room.leave("u1", sa + 1)
    evs = room.tick(sa + 1 + dr.TAKEOVER_GAP + 0.1)
    assert any(e["t"] == "results" for e in evs)


def test_test_room_always_there_auto_starts_and_never_expires():
    hub = dr.Hub()
    room = hub.ensure_test(1000.0)
    assert room.code == dr.TEST_CODE and room.test and room.info()["test"] and hub.ensure_test(1001.0) is room
    assert hub.of_tenant(dr.TEST_TENANT) is None              # normaler Raum des Tenants bleibt frei
    normal, old = hub.open(dr.TEST_TENANT, 0, 2, 1000.0)
    assert old is None and hub.get(dr.TEST_CODE) is room
    assert not room.auto_start(1100.0)                         # niemand da
    ok, _ = room.join({"id": "u1", "login": "u1", "display": "U", "role": "viewer", "garage": None}, "car-a", 0, 1100.0)
    assert ok
    assert not room.auto_start(1100.0 + dr.TEST_WAIT - 1)
    assert room.auto_start(1100.0 + dr.TEST_WAIT) and room.phase == "countdown"
    room.phase, room.done_at = "done", 1200.0
    assert not room.auto_start(1200.0 + dr.TEST_PAUSE - 1)
    assert room.auto_start(1200.0 + dr.TEST_PAUSE) and room.phase == "countdown"
    room.clients = 0
    assert room not in hub.sweep(1e9)
