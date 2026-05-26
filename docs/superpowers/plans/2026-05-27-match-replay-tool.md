# Match Replay Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser-Tool `tools/match-replay.html` das einen PUBG-Match als animierten Replay aller Teams auf der Karte zeigt — Pins, Bullet-Streaks, Kill/Knock-Marker, Play/Pause/Scrubber, Team-Fokus über Sidebar.

**Architecture:** Neuer Endpoint `/api/pubg/match-replay?match=ID` lädt den Raw-Telemetrie-Blob von HiDrive (Fallback: SQLite `payload_json`), parst ihn in einem isolierten Modul `pubg/replay_builder.py` zu einer strukturierten Event-Liste für ALLE Spieler/Teams und cached das Ergebnis im Server-Memory. Das Frontend ist ein Canvas-Renderer, der die Koordinaten-Kalibrierung und Pin-Interpolation aus `widgets/pubg/session-report.html` adaptiert.

**Tech Stack:** Python 3.12 (stdlib + paramiko via vorhandenem `pubg/hidrive_telemetry.py`), pytest. Frontend: vanilla JS, Canvas 2D, kein Build-Tool.

---

## Datenlage (verifiziert)

- Raw-Telemetrie liegt auf HiDrive als `<match_id>.json.gz` (list[dict] von PUBG-Events mit `_T`, `_D`). Download via `pubg.hidrive_telemetry.download_raw(match_id, secrets_path)`.
- Relevante Event-Typen im Raw-Blob: `LogParachuteLanding`, `LogPlayerPosition`, `LogPlayerTakeDamage`, `LogPlayerMakeGroggy`, `LogPlayerKillV2`. Jedes hat `character`/`killer`/`victim`/`attacker` mit `accountId`, `name`, `location{x,y,z}` (cm, 1km=100000).
- Team-Zuordnung: `match_team_mapping(match_id, account_id, team_id)`. DAO: `pubg.db.get_team_mapping_for_match(conn, match_id) → {account_id: team_id}`.
- Map-Größe + Kalibrierung: `data/pubg-pois.json` → `{<map>: {mapKm, pinCalibration{offsetX,offsetY,scaleX,scaleY,flipX,flipY,rotate}, regions}}`. Geladen via `EndpointRegistry._load_pois()`.
- Koordinaten→Pixel: `mdApplyPinCal(xCm,yCm,mapKm,cal)` in `widgets/pubg/session-report.html:1006`. Map-Bilder unter `widgets/pubg/maps/<MapName>.webp` (Achtung: `.webp`, nicht `.png`).
- `_ok(payload)` / `_err(code,msg)` Helper in `pubg/endpoints.py`. Dispatch-Tabelle in `EndpointRegistry.dispatch` (`pubg/endpoints.py:76`).
- Test-Muster: `tests/pubg/test_endpoints.py` mit `_setup(tmp_db_path)` + `_registry(conn)`. Fixture `tmp_db_path` aus `tests/conftest.py`.

---

## File Structure

- **Create `pubg/replay_builder.py`** — reine Parsing-Logik: Raw-Blob → Replay-Dict. Keine DB-, keine HTTP-Abhängigkeit (nimmt Blob + team_mapping + map_meta als Argumente). Isoliert testbar.
- **Modify `pubg/endpoints.py`** — zwei neue Methoden `_match_replay(qs)` + `_matches_list(qs)`, zwei Dispatch-Zeilen, ein In-Memory-Cache-Dict als Instanz-Attribut.
- **Create `tools/match-replay.html`** — das Tool. Sidebar + Canvas + Controls. Adaptiert Canvas-Engine aus `session-report.html`.
- **Create `tests/pubg/test_replay_builder.py`** — Unit-Tests für `replay_builder`.
- **Modify `tests/pubg/test_endpoints.py`** — Endpoint-Tests für die zwei neuen Routes.

---

## Task 1: Koordinaten-Normalisierung in replay_builder

**Files:**
- Create: `pubg/replay_builder.py`
- Test: `tests/pubg/test_replay_builder.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/pubg/test_replay_builder.py
from pubg.replay_builder import normalize_coords


def test_normalize_coords_center_is_half():
    # Map-Mitte (4km von 8km) → 0.5/0.5
    x, y = normalize_coords(400000, 400000, mapKm=8)
    assert abs(x - 0.5) < 1e-6
    assert abs(y - 0.5) < 1e-6


def test_normalize_coords_origin_is_zero():
    x, y = normalize_coords(0, 0, mapKm=8)
    assert x == 0.0 and y == 0.0


def test_normalize_coords_clamps_out_of_range():
    # Über die Kartengrenze hinaus → geclamped auf [0,1]
    x, y = normalize_coords(9_000_000, -5000, mapKm=8)
    assert x == 1.0
    assert y == 0.0


def test_normalize_coords_sanhok_4km():
    x, y = normalize_coords(200000, 200000, mapKm=4)
    assert abs(x - 0.5) < 1e-6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pubg.replay_builder'`

- [ ] **Step 3: Write minimal implementation**

```python
# pubg/replay_builder.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/replay_builder.py tests/pubg/test_replay_builder.py
git commit -m "feat(pubg): replay_builder Koordinaten-Normalisierung"
```

---

## Task 2: Team-Farben-Palette

**Files:**
- Modify: `pubg/replay_builder.py`
- Test: `tests/pubg/test_replay_builder.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_replay_builder.py
from pubg.replay_builder import team_colors


def test_team_colors_assigns_distinct_per_team():
    colors = team_colors([1, 2, 3])
    assert set(colors.keys()) == {1, 2, 3}
    assert len(set(colors.values())) == 3  # alle verschieden
    for hexc in colors.values():
        assert hexc.startswith("#") and len(hexc) == 7


def test_team_colors_wraps_when_more_teams_than_palette():
    ids = list(range(1, 40))  # mehr als Palette
    colors = team_colors(ids)
    assert len(colors) == 39  # jedes Team kriegt eine Farbe (mit Wrap)
    for hexc in colors.values():
        assert hexc.startswith("#")


def test_team_colors_stable_order():
    # Gleiche Input-Menge → gleiche Zuordnung (sortiert nach team_id)
    a = team_colors([3, 1, 2])
    b = team_colors([1, 2, 3])
    assert a == b
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py::test_team_colors_assigns_distinct_per_team -v`
Expected: FAIL with `ImportError: cannot import name 'team_colors'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to pubg/replay_builder.py

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/replay_builder.py tests/pubg/test_replay_builder.py
git commit -m "feat(pubg): Team-Farben-Palette fuer Replay"
```

---

## Task 3: Event-Extraktion aus Raw-Blob

**Files:**
- Modify: `pubg/replay_builder.py`
- Test: `tests/pubg/test_replay_builder.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_replay_builder.py
from pubg.replay_builder import extract_events


def _raw_fixture():
    """Minimaler Raw-Blob: 1 Landing, 1 Position, 1 Hit, 1 Knock, 1 Kill."""
    return [
        {"_T": "LogParachuteLanding", "_D": "2026-05-01T10:00:10Z",
         "character": {"accountId": "acc.A", "name": "LuCKoR",
                       "location": {"x": 400000, "y": 400000, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:15Z",
         "character": {"accountId": "acc.A", "name": "LuCKoR",
                       "location": {"x": 410000, "y": 405000, "z": 100}}},
        {"_T": "LogPlayerTakeDamage", "_D": "2026-05-01T10:01:30Z",
         "attacker": {"accountId": "acc.A", "name": "LuCKoR",
                      "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "damageCauserName": "WeapAK47_C"},
        {"_T": "LogPlayerMakeGroggy", "_D": "2026-05-01T10:01:31Z",
         "attacker": {"accountId": "acc.A", "name": "LuCKoR",
                      "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "damageCauserName": "WeapAK47_C", "distance": 5000},
        {"_T": "LogPlayerKillV2", "_D": "2026-05-01T10:01:35Z",
         "killer": {"accountId": "acc.A", "name": "LuCKoR",
                    "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "killerDamageInfo": {"damageCauserName": "WeapAK47_C", "distance": 5000}},
    ]


def test_extract_events_types_and_count():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    types = [e["type"] for e in events]
    assert "landing" in types
    assert "position" in types
    assert "hit" in types
    assert "knock" in types
    assert "kill" in types


def test_extract_events_sorted_by_ts():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    ts = [e["ts"] for e in events]
    assert ts == sorted(ts)


def test_extract_events_normalizes_coords():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    landing = next(e for e in events if e["type"] == "landing")
    assert abs(landing["x"] - 0.5) < 1e-6  # 400000/800000
    assert abs(landing["y"] - 0.5) < 1e-6


def test_extract_events_hit_has_both_endpoints():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    hit = next(e for e in events if e["type"] == "hit")
    assert "ax" in hit and "ay" in hit and "tx" in hit and "ty" in hit
    assert hit["actorId"] == "acc.A"
    assert hit["targetId"] == "acc.B"


def test_extract_events_kill_has_weapon_distance():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    kill = next(e for e in events if e["type"] == "kill")
    assert kill["weapon"] == "WeapAK47_C"
    assert kill["distance"] == 5000


def test_extract_events_position_interval_thins():
    # Zwei Position-Events 200ms auseinander, interval=1000 → nur erstes bleibt
    raw = [
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:00.000Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 1, "y": 1, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:00.200Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 2, "y": 2, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:01.500Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 3, "y": 3, "z": 100}}},
    ]
    events = extract_events(raw, mapKm=8, position_interval_ms=1000)
    pos = [e for e in events if e["type"] == "position"]
    assert len(pos) == 2  # 0.0s und 1.5s; 0.2s wird verworfen
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -k extract_events -v`
Expected: FAIL with `ImportError: cannot import name 'extract_events'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to pubg/replay_builder.py
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
    """
    out = []
    last_pos_ts = {}  # actorId → letzter behaltener Position-ts
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
    out.sort(key=lambda e: e["ts"])
    return out
```

Note: `normalize_coords(*_loc(actor), mapKm)` — `_loc` gibt `(x,y)`, das wird entpackt; `mapKm` ist drittes Argument. Falls `actor` leer → `(None,None)` → `normalize_coords` gibt `(None,None)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -k extract_events -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/replay_builder.py tests/pubg/test_replay_builder.py
git commit -m "feat(pubg): Event-Extraktion aus Raw-Telemetrie fuer Replay"
```

---

## Task 4: build_replay — Top-Level-Zusammenbau

**Files:**
- Modify: `pubg/replay_builder.py`
- Test: `tests/pubg/test_replay_builder.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_replay_builder.py
from pubg.replay_builder import build_replay


def test_build_replay_structure():
    raw = _raw_fixture()
    team_mapping = {"acc.A": 1, "acc.B": 2}
    names = {"acc.A": "LuCKoR", "acc.B": "Enemy"}
    result = build_replay(
        raw, match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping=team_mapping, names=names)
    assert result["matchId"] == "m1"
    assert result["mapName"] == "Baltic_Main"
    assert result["durationMs"] > 0
    # Teams: zwei Teams, jeweils mit Farbe + Spielern
    teams = {t["teamId"]: t for t in result["teams"]}
    assert set(teams.keys()) == {1, 2}
    assert teams[1]["color"].startswith("#")
    assert teams[1]["players"][0]["name"] == "LuCKoR"
    assert len(result["events"]) > 0


def test_build_replay_duration_from_last_event():
    raw = _raw_fixture()
    result = build_replay(
        raw, match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping={"acc.A": 1, "acc.B": 2},
        names={"acc.A": "LuCKoR", "acc.B": "Enemy"})
    # Erstes Event 10:00:10, letztes 10:01:35 → 85000ms
    assert result["durationMs"] == 85000


def test_build_replay_empty_raw_returns_empty_events():
    result = build_replay(
        [], match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping={}, names={})
    assert result["events"] == []
    assert result["durationMs"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -k build_replay -v`
Expected: FAIL with `ImportError: cannot import name 'build_replay'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to pubg/replay_builder.py

def build_replay(raw_events, match_id, map_name, mapKm,
                 team_mapping, names, position_interval_ms=1000):
    """Top-Level: Raw-Blob → vollstaendiges Replay-Dict.

    team_mapping: {account_id: team_id}
    names:        {account_id: display_name}
    """
    events = extract_events(raw_events, mapKm, position_interval_ms)
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
    if events:
        t0 = events[0]["ts"]
        for e in events:
            e["ts"] = e["ts"] - t0
        duration = events[-1]["ts"]
    else:
        duration = 0
    return {
        "matchId": match_id,
        "mapName": map_name,
        "mapKm": mapKm,
        "durationMs": duration,
        "teams": teams,
        "events": events,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_replay_builder.py -v`
Expected: PASS (alle)

- [ ] **Step 5: Commit**

```bash
git add pubg/replay_builder.py tests/pubg/test_replay_builder.py
git commit -m "feat(pubg): build_replay Top-Level-Zusammenbau"
```

---

## Task 5: Endpoint /api/pubg/matches-list

**Files:**
- Modify: `pubg/endpoints.py` (dispatch + neue Methode)
- Test: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_endpoints.py
from pubg.db import upsert_match  # falls vorhanden; sonst direktes INSERT


def test_matches_list_returns_recent(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute(
        "INSERT INTO matches (match_id, played_at, map_name, game_mode) "
        "VALUES (?,?,?,?)",
        ("m1", "2026-05-26T10:00:00Z", "Baltic_Main", "squad"))
    conn.execute(
        "INSERT INTO participants (match_id, account_id, name, team_id, place, kills) "
        "VALUES (?,?,?,?,?,?)",
        ("m1", "account.A", "PEX_LuCKoR", 3, 2, 5))
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/matches-list?limit=10", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert isinstance(payload, list)
    assert payload[0]["matchId"] == "m1"
    assert payload[0]["mapName"] == "Baltic_Main"
    assert payload[0]["place"] == 2
    assert payload[0]["kills"] == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py::test_matches_list_returns_recent -v`
Expected: FAIL — Route unbekannt → `_err(404)` → KeyError/assert fail (`payload` ist Fehler-Dict, kein list)

- [ ] **Step 3: Write minimal implementation**

In `pubg/endpoints.py`, in `dispatch()` direkt nach der `match-detail`-Zeile (`pubg/endpoints.py:108`) einfügen:

```python
        if route == ("GET", "/api/pubg/matches-list"):
            return self._matches_list(qs)
        if route == ("GET", "/api/pubg/match-replay"):
            return self._match_replay(qs)
```

Dann neue Methode hinzufügen (direkt nach `_match_detail`, ca. `pubg/endpoints.py:557`):

```python
    def _matches_list(self, qs):
        conn = self.get_conn()
        try:
            limit = int(qs.get("limit", "50"))
        except ValueError:
            limit = 50
        limit = max(1, min(200, limit))
        rows = conn.execute("""
            SELECT m.match_id, m.played_at, m.map_name,
                   pa.place, pa.kills
            FROM matches m
            LEFT JOIN participants pa
              ON pa.match_id = m.match_id AND pa.account_id = ?
            ORDER BY m.played_at DESC
            LIMIT ?
        """, (self.my_account_id, limit)).fetchall()
        return _ok([{
            "matchId":  r["match_id"],
            "playedAt": r["played_at"],
            "mapName":  r["map_name"],
            "place":    r["place"],
            "kills":    r["kills"],
        } for r in rows])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py::test_matches_list_returns_recent -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): /api/pubg/matches-list Endpoint"
```

---

## Task 6: Endpoint /api/pubg/match-replay mit Session-Cache

**Files:**
- Modify: `pubg/endpoints.py` (Methode `_match_replay`, Cache-Init in `__init__`)
- Test: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_endpoints.py
from unittest.mock import patch


def test_match_replay_requires_match_id(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/match-replay", b"", {})
    assert code == 400


def test_match_replay_builds_and_caches(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute(
        "INSERT INTO matches (match_id, played_at, map_name, game_mode) "
        "VALUES (?,?,?,?)",
        ("m1", "2026-05-26T10:00:00Z", "Baltic_Main", "squad"))
    conn.execute(
        "INSERT INTO match_team_mapping (match_id, account_id, team_id) "
        "VALUES (?,?,?)", ("m1", "account.A", 1))
    conn.execute(
        "INSERT INTO match_team_mapping (match_id, account_id, team_id) "
        "VALUES (?,?,?)", ("m1", "account.B", 2))
    conn.commit()

    raw = [
        {"_T": "LogParachuteLanding", "_D": "2026-05-26T10:00:10Z",
         "character": {"accountId": "account.A", "name": "PEX_LuCKoR",
                       "location": {"x": 400000, "y": 400000, "z": 100}}},
        {"_T": "LogPlayerKillV2", "_D": "2026-05-26T10:01:00Z",
         "killer": {"accountId": "account.A", "name": "PEX_LuCKoR",
                    "location": {"x": 400000, "y": 400000, "z": 100}},
         "victim": {"accountId": "account.B", "name": "Foe",
                    "location": {"x": 410000, "y": 410000, "z": 100}},
         "killerDamageInfo": {"damageCauserName": "WeapAK47_C", "distance": 90}},
    ]
    reg = _registry(conn)
    with patch("pubg.hidrive_telemetry.download_raw", return_value=raw) as dl:
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m1", b"", {})
        assert code == 200
        payload = json.loads(body)
        assert payload["matchId"] == "m1"
        assert len(payload["teams"]) == 2
        assert any(e["type"] == "kill" for e in payload["events"])
        # Zweiter Aufruf → Cache, kein zweiter Download
        reg.dispatch("GET", "/api/pubg/match-replay?match=m1", b"", {})
        assert dl.call_count == 1


def test_match_replay_404_when_no_telemetry(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute(
        "INSERT INTO matches (match_id, played_at, map_name, game_mode) "
        "VALUES (?,?,?,?)", ("m2", "2026-05-26T10:00:00Z", "Baltic_Main", "squad"))
    conn.commit()
    reg = _registry(conn)
    with patch("pubg.hidrive_telemetry.download_raw", return_value=None):
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m2", b"", {})
        assert code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py -k match_replay -v`
Expected: FAIL (Route unbekannt / Methode fehlt)

- [ ] **Step 3: Write minimal implementation**

In `EndpointRegistry.__init__` (`pubg/endpoints.py:67`) am Ende hinzufügen:

```python
        self._replay_cache = {}  # match_id → fertiges Replay-Dict (Session-Memory)
```

Neue Methode (nach `_matches_list`):

```python
    def _match_replay(self, qs):
        import os
        from pubg import hidrive_telemetry
        from pubg.replay_builder import build_replay
        from pubg.telemetry import extract_player_names
        from pubg.db import get_team_mapping_for_match

        match_id = (qs.get("match") or "").strip()
        if not match_id:
            return _err(400, "match required")
        if match_id in self._replay_cache:
            return _ok(self._replay_cache[match_id])

        conn = self.get_conn()
        m_row = conn.execute(
            "SELECT map_name FROM matches WHERE match_id = ?",
            (match_id,)).fetchone()
        if not m_row:
            return _err(404, "match not found")
        map_name = m_row["map_name"]

        # Map-Groesse aus POIs (Fallback 8km)
        pois = self._load_pois()
        alias = "Baltic_Main" if map_name == "Erangel_Main" else map_name
        blob = pois.get(alias) or pois.get(map_name) or {}
        mapKm = float(blob.get("mapKm") or 8)

        # Raw-Telemetrie von HiDrive
        here = os.path.dirname(os.path.abspath(__file__))
        secrets = os.path.join(os.path.dirname(here), ".secrets")
        raw = hidrive_telemetry.download_raw(match_id, secrets)
        if not raw:
            return _err(404, "no telemetry available for this match")

        # Team-Mapping + Namen
        team_mapping = get_team_mapping_for_match(conn, match_id)
        names = {}
        rows = conn.execute(
            "SELECT account_id, name FROM players").fetchall()
        for r in rows:
            names[r["account_id"]] = r["name"]
        # Fehlende Namen aus dem Raw-Blob nachziehen
        for acc, nm in extract_player_names(raw).items():
            names.setdefault(acc, nm)

        result = build_replay(
            raw, match_id, map_name, mapKm, team_mapping, names)
        self._replay_cache[match_id] = result
        return _ok(result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py -k match_replay -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): /api/pubg/match-replay Endpoint mit Session-Cache"
```

---

## Task 7: Tool-Grundgerüst tools/match-replay.html (Layout + Match-Auswahl)

**Files:**
- Create: `tools/match-replay.html`

- [ ] **Step 1: HTML-Skelett mit semantischem Layout schreiben**

Erstelle `tools/match-replay.html`. WCAG-konform (semantische Tags, Labels, Fokus-Indikatoren, Tastatur). Lade `/widgets/pubg/_pubg.js` und `/widgets/pubg/_pubg_pois.js` für `PubgUI.fetchJson`, `PubgUI.qs`, `PubgUI.POI`.

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>PUBG Match Replay</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/widgets/pubg/_pubg.css">
  <style>
    html, body { margin: 0; height: 100%; background: #0d061a; color: #eee;
                 font-family: "DM Sans", sans-serif; }
    .app { display: grid; grid-template-columns: 300px 1fr;
           grid-template-rows: 1fr auto; height: 100vh; }
    .sidebar { grid-row: 1 / 3; overflow-y: auto; padding: 12px;
               border-right: 1px solid rgba(255,255,255,0.1); }
    .stage { position: relative; overflow: hidden; }
    canvas#map { display: block; width: 100%; height: 100%; }
    .controls { grid-column: 2; display: flex; align-items: center;
                gap: 12px; padding: 10px 16px;
                border-top: 1px solid rgba(255,255,255,0.1); }
    .match-picker { margin-bottom: 14px; }
    .match-picker label { display: block; font-size: 0.8em;
                          color: #aaa; margin-bottom: 4px; }
    select, button { font-family: inherit; background: #1a0f2e;
                     color: #eee; border: 1px solid #5e2a79;
                     border-radius: 6px; padding: 6px 10px; min-height: 24px; }
    button:focus-visible, select:focus-visible, [tabindex]:focus-visible {
      outline: 3px solid #f2b705; outline-offset: 2px; }
    .team { margin-bottom: 6px; border-radius: 6px; overflow: hidden; }
    .team-head { display: flex; align-items: center; gap: 8px;
                 padding: 6px 8px; cursor: pointer; min-height: 24px; }
    .team-swatch { width: 14px; height: 14px; border-radius: 3px; flex: none; }
    .team.focused { outline: 2px solid #f2b705; }
    .team-players { padding: 0 8px 6px 30px; font-size: 0.85em; color: #ccc; }
    .toggles { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }
    .toggles label { display: flex; align-items: center; gap: 8px; }
    .timeline { flex: 1; }
    .clock { font-variant-numeric: tabular-nums; min-width: 110px; }
    .tooltip { position: absolute; pointer-events: none; background: #000d;
               border: 1px solid #5e2a79; border-radius: 6px; padding: 6px 9px;
               font-size: 0.82em; max-width: 240px; display: none; z-index: 10; }
  </style>
</head>
<body>
  <main class="app">
    <aside class="sidebar" aria-label="Teams und Steuerung">
      <div class="match-picker">
        <label for="matchSelect">Match auswählen</label>
        <select id="matchSelect" aria-label="Match auswählen"></select>
      </div>
      <div id="teamList" aria-label="Teamliste"></div>
      <fieldset class="toggles">
        <legend>Anzeige</legend>
        <label><input type="checkbox" id="tglKills" checked> Kills</label>
        <label><input type="checkbox" id="tglKnocks" checked> Knocks</label>
        <label><input type="checkbox" id="tglStreaks" checked> Bullet Streaks</label>
        <label><input type="checkbox" id="tglNames" checked> Namen</label>
      </fieldset>
    </aside>
    <section class="stage" aria-label="Karte">
      <canvas id="map"></canvas>
      <div class="tooltip" id="tooltip" role="status"></div>
    </section>
    <div class="controls">
      <button id="playPause" aria-label="Abspielen/Pause">▶</button>
      <input class="timeline" id="scrubber" type="range" min="0" max="1000"
             value="0" aria-label="Zeitleiste">
      <span class="clock" id="clock">0:00 / 0:00</span>
      <label class="sr-only" for="speedSelect">Geschwindigkeit</label>
      <select id="speedSelect" aria-label="Geschwindigkeit">
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
        <option value="8">8×</option>
      </select>
    </div>
  </main>
  <script src="/widgets/pubg/_pubg.js"></script>
  <script src="/widgets/pubg/_pubg_pois.js"></script>
  <script src="/tools/match-replay.js"></script>
</body>
</html>
```

- [ ] **Step 2: Match-Liste laden + Dropdown füllen (inline script-Datei tools/match-replay.js)**

Erstelle `tools/match-replay.js` mit dem Bootstrap:

```javascript
// tools/match-replay.js
const RS = {
  replay: null,         // geladenes Replay-Dict
  focusedTeam: null,    // team_id oder null
  playing: false,
  cursorMs: 0,
  speed: 1,
  lastFrameWall: 0,
  toggles: { kills: true, knocks: true, streaks: true, names: true },
  view: { zoom: 1, panX: 0, panY: 0 },  // zoom: Faktor, pan: Pixel-Offset
};

async function loadMatchList() {
  const sel = document.getElementById("matchSelect");
  const list = await PubgUI.fetchJson("/api/pubg/matches-list?limit=50");
  sel.innerHTML = list.map(m => {
    const d = new Date(m.playedAt);
    const dt = d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit",
                hour: "2-digit", minute: "2-digit" });
    const mapShort = (m.mapName || "?").replace("_Main", "");
    return `<option value="${m.matchId}">${dt} · ${mapShort} · #${m.place ?? "?"} · ${m.kills ?? "?"}K</option>`;
  }).join("");
  // URL-Parameter ?match=ID überschreibt die Vorauswahl
  const urlMatch = PubgUI.qs("match");
  if (urlMatch) sel.value = urlMatch;
  sel.addEventListener("change", () => loadReplay(sel.value));
  if (sel.value) loadReplay(sel.value);
}

async function loadReplay(matchId) {
  RS.replay = await PubgUI.fetchJson(
    "/api/pubg/match-replay?match=" + encodeURIComponent(matchId), 60000);
  RS.cursorMs = 0;
  RS.playing = false;
  RS.focusedTeam = null;
  await PubgUI.POI.ready;
  buildTeamList();
  // resize + initial render kommen in Task 8/9
  if (window._rsInitCanvas) window._rsInitCanvas();
}

function buildTeamList() {
  const host = document.getElementById("teamList");
  if (!RS.replay) { host.innerHTML = ""; return; }
  host.innerHTML = RS.replay.teams.map(t => `
    <div class="team" data-team="${t.teamId}">
      <div class="team-head" role="button" tabindex="0"
           aria-label="Team ${t.teamId} fokussieren">
        <span class="team-swatch" style="background:${t.color}"></span>
        <strong>Team ${t.teamId}</strong>
      </div>
      <div class="team-players">
        ${t.players.map(p => p.name).join("<br>")}
      </div>
    </div>`).join("");
  host.querySelectorAll(".team-head").forEach(el => {
    const tid = Number(el.closest(".team").dataset.team);
    const focus = () => setFocus(tid);
    el.addEventListener("click", focus);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focus(); }
    });
  });
}

function setFocus(teamId) {
  RS.focusedTeam = (RS.focusedTeam === teamId) ? null : teamId;
  document.querySelectorAll(".team").forEach(el =>
    el.classList.toggle("focused",
      Number(el.dataset.team) === RS.focusedTeam));
}

loadMatchList();
```

- [ ] **Step 3: Manueller Smoke-Test**

Server starten (`python serve.py`), Browser öffnen: `http://localhost:9000/tools/match-replay.html`
Erwartet: Dropdown ist mit Matches gefüllt; Auswahl eines Matches füllt die Teamliste links mit farbigen Swatches + Spielernamen; Klick auf ein Team setzt den gelben Fokus-Rahmen.

- [ ] **Step 4: Commit**

```bash
git add tools/match-replay.html tools/match-replay.js
git commit -m "feat(tools): match-replay Grundgeruest mit Match-Auswahl + Teamliste"
```

---

## Task 8: Canvas-Basemap + Koordinaten-Projektion

**Files:**
- Modify: `tools/match-replay.js`

- [ ] **Step 1: Kalibrierungs- und Projektions-Helper adaptieren**

Adaptiere `mdApplyPinCal` aus `widgets/pubg/session-report.html:1006`. Da `build_replay` bereits normalisierte 0–1-Koordinaten liefert, ist die Projektion einfacher: 0–1 → Bild-Pixel unter Berücksichtigung von Zoom/Pan. **Wichtig:** Die Server-Normalisierung (`x/span`) wendet KEINE pinCalibration an. Die Kalibrierung (flip/rotate/scale/offset) muss daher im Frontend auf die normalisierten Werte angewandt werden, BEVOR sie auf das Bild gemappt werden. Hole `cal` + `mapKm` aus `PubgUI.POI` Daten.

Füge zu `tools/match-replay.js` hinzu:

```javascript
// Kalibrierung auf normalisierte 0-1-Coords anwenden (Port von mdApplyPinCal,
// aber im 0-1-Raum statt cm). cal-Offsets sind in cm → /span normalisieren.
function applyCal(nx, ny, mapKm, cal) {
  if (!cal) return [nx, ny];
  let x = nx, y = ny;
  if (cal.flipX) x = 1 - x;
  if (cal.flipY) y = 1 - y;
  const rot = (((cal.rotate || 0) % 360) + 360) % 360;
  if (rot !== 0) {
    const dx = x - 0.5, dy = y - 0.5;
    if (rot === 90)  { x = 0.5 - dy; y = 0.5 + dx; }
    if (rot === 180) { x = 0.5 - dx; y = 0.5 - dy; }
    if (rot === 270) { x = 0.5 + dy; y = 0.5 - dx; }
  }
  const span = mapKm * 100000;
  x = (x - 0.5) * (cal.scaleX || 1) + 0.5 + (cal.offsetX || 0) / span;
  y = (y - 0.5) * (cal.scaleY || 1) + 0.5 + (cal.offsetY || 0) / span;
  return [x, y];
}

function getCal() {
  const mapName = RS.replay ? RS.replay.mapName : null;
  const alias = mapName === "Erangel_Main" ? "Baltic_Main" : mapName;
  // PubgUI.POI hat DATA intern; wir holen mapKm/cal über die pois-API direkt.
  return RS._poiBlob || { mapKm: RS.replay ? RS.replay.mapKm : 8, pinCalibration: {} };
}

// normalisiertes (0-1) → Canvas-Pixel (mit Zoom + Pan)
function projToCanvas(nx, ny) {
  const blob = getCal();
  const [cx, cy] = applyCal(nx, ny, blob.mapKm || 8, blob.pinCalibration || {});
  const cnv = document.getElementById("map");
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2;
  const offY = (cnv.height - base) / 2;
  const px = offX + cx * base;
  const py = offY + cy * base;
  return [
    (px - cnv.width / 2) * RS.view.zoom + cnv.width / 2 + RS.view.panX,
    (py - cnv.height / 2) * RS.view.zoom + cnv.height / 2 + RS.view.panY,
  ];
}
```

- [ ] **Step 2: POI-Blob für die Map laden (mapKm + Kalibrierung)**

In `loadReplay`, nach `await PubgUI.POI.ready`, den POI-Blob für die Map holen:

```javascript
  const mapName = RS.replay.mapName;
  const alias = mapName === "Erangel_Main" ? "Baltic_Main" : mapName;
  RS._poiBlob = await PubgUI.fetchJson(
    "/api/pubg/pois?map=" + encodeURIComponent(alias));
```

- [ ] **Step 3: Basemap-Bild laden + Canvas-Resize + Render-Loop-Skelett**

```javascript
let _mapImg = null;
function loadMapImage(mapName) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = "/widgets/pubg/maps/" + mapName + ".webp";
  });
}

function resizeCanvas() {
  const cnv = document.getElementById("map");
  const r = cnv.parentElement.getBoundingClientRect();
  cnv.width = Math.floor(r.width);
  cnv.height = Math.floor(r.height);
}

window._rsInitCanvas = async function () {
  resizeCanvas();
  _mapImg = await loadMapImage(
    RS.replay.mapName === "Erangel_Main" ? "Baltic_Main" : RS.replay.mapName);
  renderFrame();
};
window.addEventListener("resize", () => { resizeCanvas(); renderFrame(); });

function drawBasemap(ctx) {
  const cnv = document.getElementById("map");
  ctx.fillStyle = "#0d061a";
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  if (!_mapImg) return;
  // Quadrat-Crop des Map-Bildes auf den Canvas-Quadrat-Bereich,
  // dann Zoom/Pan via projToCanvas-Eckpunkte.
  const [x0, y0] = projToCanvas(0, 0);
  const [x1, y1] = projToCanvas(1, 1);
  ctx.drawImage(_mapImg, x0, y0, x1 - x0, y1 - y0);
}

function renderFrame() {
  const cnv = document.getElementById("map");
  const ctx = cnv.getContext("2d");
  drawBasemap(ctx);
  // Pins/Marker/Streaks kommen in Task 9
}
```

- [ ] **Step 4: Manueller Smoke-Test**

Browser: Match auswählen. Erwartet: Das Kartenbild der richtigen Map wird im Canvas gezeichnet und füllt den Stage-Bereich. Beim Fenster-Resize bleibt es korrekt.

- [ ] **Step 5: Commit**

```bash
git add tools/match-replay.js
git commit -m "feat(tools): match-replay Canvas-Basemap + Koordinaten-Projektion"
```

---

## Task 9: Pin-Interpolation + Marker + Streaks rendern

**Files:**
- Modify: `tools/match-replay.js`

- [ ] **Step 1: Position-Index pro Spieler aufbauen (für Interpolation)**

Adaptiere die Interpolations-Idee aus `mdInterpolatePin` (`session-report.html:1344`): pro Spieler eine nach `ts` sortierte Liste von `position`+`landing`-Punkten; zum Cursor-Zeitpunkt linear zwischen den zwei umschließenden Punkten interpolieren. Tod blendet den Pin aus, ein erneutes `landing` (Respawn) nach `death` reaktiviert ihn.

```javascript
function buildPlayerTracks() {
  const tracks = {};   // accountId → [{ts,x,y}]
  const deaths = {};   // accountId → [ts,...]
  const relands = {};  // accountId → [ts,...]  (landings nach erstem)
  for (const e of RS.replay.events) {
    if (e.type === "position" || e.type === "landing") {
      (tracks[e.actorId] = tracks[e.actorId] || []).push(
        { ts: e.ts, x: e.x, y: e.y });
      if (e.type === "landing")
        (relands[e.actorId] = relands[e.actorId] || []).push(e.ts);
    } else if (e.type === "death") {
      (deaths[e.actorId] = deaths[e.actorId] || []).push(e.ts);
    }
  }
  RS._tracks = tracks;
  RS._deaths = deaths;
  RS._relands = relands;
  // accountId → teamId und → color Lookup
  RS._accTeam = {};
  RS._accName = {};
  RS._teamColor = {};
  for (const t of RS.replay.teams) {
    RS._teamColor[t.teamId] = t.color;
    for (const p of t.players) {
      RS._accTeam[p.accountId] = t.teamId;
      RS._accName[p.accountId] = p.name;
    }
  }
}
```

Rufe `buildPlayerTracks()` am Ende von `loadReplay` (nach `buildTeamList()`) auf.

- [ ] **Step 2: Interpolierte Position + Lebend-Status zum Cursor**

```javascript
function posAt(acc, ms) {
  const tr = RS._tracks[acc];
  if (!tr || !tr.length) return null;
  // tot? letzter death vor ms ohne nachfolgendes reland
  const dts = RS._deaths[acc] || [];
  const rts = RS._relands[acc] || [];
  let dead = false;
  for (const d of dts) {
    if (d <= ms) {
      const reland = rts.find(r => r > d && r <= ms);
      dead = !reland;
    }
  }
  if (dead) return null;
  if (ms <= tr[0].ts) return { x: tr[0].x, y: tr[0].y };
  if (ms >= tr[tr.length - 1].ts) {
    const last = tr[tr.length - 1];
    return { x: last.x, y: last.y };
  }
  for (let i = 1; i < tr.length; i++) {
    if (tr[i].ts >= ms) {
      const a = tr[i - 1], b = tr[i];
      const f = (ms - a.ts) / Math.max(1, b.ts - a.ts);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return null;
}
```

- [ ] **Step 2b: Statische Marker (Kills/Knocks) + aktive Streaks zum Cursor sammeln**

```javascript
function markersUpTo(ms) {
  const out = [];
  for (const e of RS.replay.events) {
    if (e.ts > ms) break;
    if (e.type === "kill" && RS.toggles.kills) out.push(e);
    if (e.type === "knock" && RS.toggles.knocks) out.push(e);
  }
  return out;
}

function activeStreaks(ms) {
  if (!RS.toggles.streaks) return [];
  // Hit-Events deren Einschlag < 200ms her ist
  return RS.replay.events.filter(e =>
    e.type === "hit" && e.ts <= ms && ms - e.ts <= 200);
}
```

- [ ] **Step 3: Render-Loop vervollständigen**

Ersetze `renderFrame()` aus Task 8 durch die volle Version:

```javascript
function teamColorOf(acc) {
  const tid = RS._accTeam[acc];
  return RS._teamColor[tid] || "#888";
}

function renderFrame() {
  const cnv = document.getElementById("map");
  const ctx = cnv.getContext("2d");
  drawBasemap(ctx);
  if (!RS.replay) return;
  const ms = RS.cursorMs;

  // 1) Bullet-Streaks (unter den Pins)
  for (const e of activeStreaks(ms)) {
    const [ax, ay] = projToCanvas(e.ax, e.ay);
    const [tx, ty] = projToCanvas(e.tx, e.ty);
    const age = ms - e.ts;
    ctx.globalAlpha = 0.7 * (1 - age / 200);
    ctx.strokeStyle = teamColorOf(e.actorId);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 2) Kill/Knock-Marker (X)
  for (const e of markersUpTo(ms)) {
    const [mx, my] = projToCanvas(e.tx, e.ty);
    const sz = e.type === "kill" ? 6 : 3;
    ctx.strokeStyle = teamColorOf(e.actorId);
    ctx.globalAlpha = e.type === "kill" ? 1 : 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
    ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 3) Spieler-Pins
  const nameScale = Math.max(8, Math.min(12, 12 / RS.view.zoom));
  for (const acc in RS._accTeam) {
    const p = posAt(acc, ms);
    if (!p) continue;
    const [px, py] = projToCanvas(p.x, p.y);
    const tid = RS._accTeam[acc];
    const focused = RS.focusedTeam == null || RS.focusedTeam === tid;
    ctx.fillStyle = focused ? RS._teamColor[tid] : "#bbb";
    ctx.globalAlpha = focused ? 1 : 0.7;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    // Teamnummer immer
    ctx.fillStyle = "#000";
    ctx.font = "bold 8px DM Sans";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(tid), px, py);
    // Namens-Badge (nur fokussiertes Team + Toggle)
    if (RS.toggles.names && RS.focusedTeam === tid) {
      ctx.fillStyle = "#fff";
      ctx.font = `${nameScale}px DM Sans`;
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(RS._accName[acc] || "", px + 7, py - 5);
    }
    ctx.globalAlpha = 1;
  }
}
```

- [ ] **Step 4: Toggle-Checkboxen verdrahten**

```javascript
["Kills", "Knocks", "Streaks", "Names"].forEach(k => {
  const cb = document.getElementById("tgl" + k);
  cb.addEventListener("change", () => {
    RS.toggles[k.toLowerCase()] = cb.checked;
    renderFrame();
  });
});
```

- [ ] **Step 5: Manueller Smoke-Test**

Browser: Match wählen. Erwartet: Spieler-Pins erscheinen an Landepositionen mit Teamnummer. Toggles für Kills/Knocks/Streaks/Namen blenden die jeweiligen Elemente ein/aus. Fokussiertes Team ist farbig + zeigt Namens-Badges, andere sind grau. (Bewegung kommt erst mit der Wiedergabe in Task 10 — bei cursorMs=0 sieht man den Startzustand.)

- [ ] **Step 6: Commit**

```bash
git add tools/match-replay.js
git commit -m "feat(tools): match-replay Pins, Marker, Bullet-Streaks rendern"
```

---

## Task 10: Wiedergabe-Steuerung (Play/Pause/Scrubber/Speed)

**Files:**
- Modify: `tools/match-replay.js`

- [ ] **Step 1: Animations-Loop mit requestAnimationFrame**

```javascript
function tick(wallNow) {
  if (RS.playing && RS.replay) {
    const dt = wallNow - (RS.lastFrameWall || wallNow);
    RS.cursorMs += dt * RS.speed;
    if (RS.cursorMs >= RS.replay.durationMs) {
      RS.cursorMs = RS.replay.durationMs;
      RS.playing = false;
      document.getElementById("playPause").textContent = "▶";
    }
    syncScrubberAndClock();
    renderFrame();
  }
  RS.lastFrameWall = wallNow;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function syncScrubberAndClock() {
  if (!RS.replay) return;
  const scr = document.getElementById("scrubber");
  scr.value = String(Math.round(
    (RS.cursorMs / Math.max(1, RS.replay.durationMs)) * 1000));
  document.getElementById("clock").textContent =
    fmtClock(RS.cursorMs) + " / " + fmtClock(RS.replay.durationMs);
}
```

- [ ] **Step 2: Controls verdrahten**

```javascript
document.getElementById("playPause").addEventListener("click", () => {
  if (!RS.replay) return;
  RS.playing = !RS.playing;
  if (RS.playing && RS.cursorMs >= RS.replay.durationMs) RS.cursorMs = 0;
  document.getElementById("playPause").textContent = RS.playing ? "❚❚" : "▶";
  RS.lastFrameWall = performance.now();
});

document.getElementById("scrubber").addEventListener("input", () => {
  if (!RS.replay) return;
  const f = Number(document.getElementById("scrubber").value) / 1000;
  RS.cursorMs = f * RS.replay.durationMs;
  RS.playing = false;
  document.getElementById("playPause").textContent = "▶";
  syncScrubberAndClock();
  renderFrame();
});

document.getElementById("speedSelect").addEventListener("change", e => {
  RS.speed = Number(e.target.value);
});
```

- [ ] **Step 3: Beim Laden eines Matches Scrubber zurücksetzen**

In `loadReplay`, nach `buildPlayerTracks()`:

```javascript
  syncScrubberAndClock();
```

- [ ] **Step 4: Manueller Smoke-Test**

Browser: Match wählen, Play drücken. Erwartet: Pins bewegen sich flüssig über die Karte entlang der Telemetrie. Scrubber läuft mit, Uhr zählt hoch. Scrubber ziehen springt zur Position. Speed-Wechsel beschleunigt sichtbar. Bei Match-Ende stoppt die Wiedergabe.

- [ ] **Step 5: Commit**

```bash
git add tools/match-replay.js
git commit -m "feat(tools): match-replay Wiedergabe-Steuerung"
```

---

## Task 11: Zoom, Pan, Hover-Tooltips

**Files:**
- Modify: `tools/match-replay.js`

- [ ] **Step 1: Zoom (Scrollwheel) + Pan (Drag)**

```javascript
const stageEl = () => document.querySelector(".stage");

stageEl().addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  RS.view.zoom = Math.max(0.5, Math.min(20, RS.view.zoom * factor));
  renderFrame();
}, { passive: false });

let _drag = null;
stageEl().addEventListener("mousedown", e => {
  _drag = { x: e.clientX, y: e.clientY,
            px: RS.view.panX, py: RS.view.panY };
});
window.addEventListener("mousemove", e => {
  if (!_drag) return;
  RS.view.panX = _drag.px + (e.clientX - _drag.x);
  RS.view.panY = _drag.py + (e.clientY - _drag.y);
  renderFrame();
});
window.addEventListener("mouseup", () => { _drag = null; });
```

- [ ] **Step 2: Hover-Tooltips für Pins + Kill/Knock-Marker**

```javascript
const TOOLTIP = () => document.getElementById("tooltip");

function hitTest(mx, my) {
  const ms = RS.cursorMs;
  // 1) Pins (Radius 7px)
  for (const acc in RS._accTeam) {
    const p = posAt(acc, ms);
    if (!p) continue;
    const [px, py] = projToCanvas(p.x, p.y);
    if (Math.hypot(px - mx, py - my) <= 7) {
      const tid = RS._accTeam[acc];
      // Kills/Knocks dieses Spielers bis Cursor zählen
      let k = 0, kn = 0;
      for (const e of RS.replay.events) {
        if (e.ts > ms) break;
        if (e.actorId === acc && e.type === "kill") k++;
        if (e.actorId === acc && e.type === "knock") kn++;
      }
      return `Team ${tid} · ${RS._accName[acc]} · ${k} Kills · ${kn} Knocks`;
    }
  }
  // 2) Kill/Knock-Marker (8px)
  for (const e of markersUpTo(ms)) {
    const [ex, ey] = projToCanvas(e.tx, e.ty);
    if (Math.hypot(ex - mx, ey - my) <= 8) {
      const verb = e.type === "kill" ? "killed" : "knocked";
      const dist = e.distance != null ? Math.round(e.distance / 100) + "m" : "?";
      const wp = (e.weapon || "?").replace(/^Weap/, "").replace(/_C$/, "");
      return `${RS._accName[e.targetId] || "?"} ${verb} by `
           + `${RS._accName[e.actorId] || "?"} · ${wp} · ${dist}`;
    }
  }
  return null;
}

stageEl().addEventListener("mousemove", e => {
  if (_drag) return;
  const cnv = document.getElementById("map");
  const r = cnv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const txt = hitTest(mx, my);
  const tt = TOOLTIP();
  if (txt) {
    tt.textContent = txt;
    tt.style.display = "block";
    tt.style.left = (mx + 12) + "px";
    tt.style.top = (my + 12) + "px";
  } else {
    tt.style.display = "none";
  }
});
stageEl().addEventListener("mouseleave", () => {
  TOOLTIP().style.display = "none";
});
```

Hinweis: PUBG-`distance` ist bereits in cm (World-Units). Treffer-Distanz in m = `distance/100`. Falls Tests zeigen dass `distance` schon in m kommt, den Faktor anpassen — beim Smoke-Test gegen bekannte Werte prüfen.

- [ ] **Step 3: Manueller Smoke-Test**

Browser: Scrollwheel zoomt, Drag verschiebt die Karte. Hover über einen Pin zeigt Team/Name/Kills/Knocks. Hover über ein X zeigt „X killed by Y · Waffe · Distanz". Namens-Badges schrumpfen beim Reinzoomen.

- [ ] **Step 4: Commit**

```bash
git add tools/match-replay.js
git commit -m "feat(tools): match-replay Zoom, Pan, Hover-Tooltips"
```

---

## Task 12: README + Demo-Eintrag

**Files:**
- Modify: `README.md`
- Modify: `widgets/pubg/index.html` (oder die Tool-Übersicht, falls vorhanden)

- [ ] **Step 1: README-Abschnitt ergänzen**

Dokumentiere das neue Tool: Pfad `tools/match-replay.html`, URL-Parameter `?match=MATCH_ID`, dass es HiDrive-Telemetrie braucht, und die Bedienung (Dropdown, Team-Fokus, Toggles, Wiedergabe). Folge dem Stil bestehender README-Einträge.

- [ ] **Step 2: Tool in der Übersichtsseite verlinken**

Falls eine Tool-/Widget-Übersicht existiert (Tile-Grid, KEINE iframes — siehe Projekt-Konvention), eine Kachel mit Titel „Match Replay", Größe „Browser-Tab" und Parameter-Doku ergänzen.

- [ ] **Step 3: Commit**

```bash
git add README.md widgets/pubg/index.html
git commit -m "docs: match-replay Tool in README + Uebersicht"
```

---

## Self-Review-Ergebnis

- **Spec-Coverage:** Dropdown+URL (T7), HiDrive-Fetch+Session-Cache (T6), alle Teams mit Farben (T2/T4/T9), Fokus bleibt bis Klick (T7), graue Nicht-Fokus-Teams (T9), Teamnummer immer + Namens-Badge skaliert mit Zoom (T9/T11), Kill/Knock als X in Killer-Farbe (T9), Bullet-Streaks 200ms (T3/T9), Hover-Tooltips Pin + X (T11), Play/Pause/Scrubber/Speed (T10), Respawn-Handling (T9 `posAt` reland-Logik). ✓
- **Platzhalter:** keine — jeder Schritt hat vollständigen Code.
- **Typ-Konsistenz:** `normalize_coords`, `team_colors`, `extract_events`, `build_replay` Signaturen durchgängig; Event-Felder (`type/ts/actorId/targetId/ax/ay/tx/ty/weapon/distance/x/y`) konsistent zwischen Backend (T3) und Frontend (T9/T11); `RS`-State-Felder einheitlich.
- **Offen/zu verifizieren beim Bauen:** (1) `distance`-Einheit (cm vs m) beim Smoke-Test gegen bekannten Wert prüfen. (2) pinCalibration im 0-1-Raum (`applyCal`) gegen session-report.html visuell vergleichen — falls Pins verschoben sind, Offset-Normalisierung justieren. (3) Respawn-Bug im Report selbst ist NICHT Teil dieses Plans (separat, siehe Memory `project_revive_bug`).
