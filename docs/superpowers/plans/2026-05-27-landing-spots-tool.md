# Landing Spots Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser-Tool `tools/landing-spots.html` (1920×1080-tauglich) das pro Karte zeigt, wo bis zu 4 gefilterte Spieler landen — als kombinierte Heatmap + per-Spieler-Scatter + POI-Liste mit per-Spieler-Aufschlüsselung. Optionaler Flugrouten-Filter (≤1,5km Querdistanz).

**Architecture:** Zwei neue Endpoints. `/api/pubg/landing-heatmap` aggregiert `LogParachuteLanding`-Events (bereits in `telemetry_events`) gefiltert nach Squad-Konstellation, ordnet jede Landung via Point-in-Polygon einem POI zu (Python-Port der Logik aus `_pubg_pois.js`), und liefert pro POI die per-Spieler-Counts + rohe Scatter-Punkte. `/api/pubg/player-search` liefert Autocomplete. Die POI-Zuordnung lebt in einem isolierten, testbaren Modul `pubg/poi_match.py`.

**Tech Stack:** Python 3.12 stdlib, pytest. Frontend: vanilla JS, Canvas 2D Heatmap, kein Build-Tool.

---

## Datenlage (verifiziert)

- Landings: `telemetry_events` WHERE `event_type='Landing'` mit `actor_account, actor_x, actor_y, actor_z, actor_health, match_id, timestamp_ms`. Die Best-Touchdown-Heuristik (z<80000cm, health>0, Fallback Position-Event) ist in `_landings` (`pubg/endpoints.py:327`) bereits ausformuliert und wird wiederverwendet.
- POIs: `data/pubg-pois.json` → `{<map>: {mapKm, pinCalibration, regions:[{name, points:[[x,y]...]}]}}`. Points in World-cm. Geladen via `EndpointRegistry._load_pois()`.
- Point-in-Polygon + Nearest-POI-Logik existiert als JS in `widgets/pubg/_pubg_pois.js` (Funktionen `pointInPoly`, `polyArea`, `distToPoly`). Muss nach Python portiert werden.
- Squad-Konstellation: `match_team_mapping(match_id, account_id, team_id)`. Zwei Spieler waren zusammen ⇔ gleiches `(match_id, team_id)`.
- Spieler: `players(account_id, name)`.
- Flugroute: rekonstruierbar aus frühen `LogPlayerPosition`-Events (z≥150000cm = Cruise) — aber NUR Squad-Positionen sind in `telemetry_events`. Für den Routen-Filter genügen die eigenen Positionen (Start→Ende der Cruise-Phase des Spielers). **Verifizieren beim Bauen ob genügend Position-Events vorhanden sind**; sonst Match als `routeUnknown` einbeziehen.
- `_ok`/`_err` + Dispatch-Tabelle wie in `pubg/endpoints.py`. Test-Muster `tests/pubg/test_endpoints.py`.

---

## File Structure

- **Create `pubg/poi_match.py`** — reine Geometrie: `point_in_poly`, `poly_area`, `dist_to_poly`, `match_poi(x, y, regions)`, `perp_distance_to_route(px, py, ax, ay, bx, by)`. Keine DB/HTTP. Isoliert testbar.
- **Modify `pubg/endpoints.py`** — `_landing_heatmap(qs)`, `_player_search(qs)`, zwei Dispatch-Zeilen.
- **Create `tools/landing-spots.html`** + **`tools/landing-spots.js`** — das Tool.
- **Create `tests/pubg/test_poi_match.py`** — Geometrie-Tests.
- **Modify `tests/pubg/test_endpoints.py`** — Endpoint-Tests.

---

## Task 1: Geometrie-Primitive in poi_match

**Files:**
- Create: `pubg/poi_match.py`
- Test: `tests/pubg/test_poi_match.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/pubg/test_poi_match.py
from pubg.poi_match import point_in_poly, poly_area, dist_to_poly


SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]]


def test_point_in_poly_inside():
    assert point_in_poly(50, 50, SQUARE) is True


def test_point_in_poly_outside():
    assert point_in_poly(150, 50, SQUARE) is False


def test_poly_area_square():
    assert poly_area(SQUARE) == 10000


def test_dist_to_poly_outside_is_positive():
    # Punkt 50 rechts der rechten Kante
    d = dist_to_poly(150, 50, SQUARE)
    assert abs(d - 50) < 1e-6


def test_dist_to_poly_inside_touches_edge():
    # Punkt innen, naechste Kante 10 entfernt
    d = dist_to_poly(10, 50, SQUARE)
    assert abs(d - 10) < 1e-6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_poi_match.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pubg.poi_match'`

- [ ] **Step 3: Write minimal implementation**

```python
# pubg/poi_match.py
"""Reine Geometrie fuer POI-Zuordnung von Lande-Koordinaten.
Python-Port der Logik aus widgets/pubg/_pubg_pois.js. World-cm.
Keine DB-/HTTP-Abhaengigkeit — isoliert testbar."""
import math


def poly_area(points):
    if not points or len(points) < 3:
        return 0.0
    a = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def point_in_poly(px, py, points):
    if not points or len(points) < 3:
        return False
    inside = False
    n = len(points)
    j = n - 1
    for i in range(n):
        xi, yi = points[i]
        xj, yj = points[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def dist_to_poly(px, py, points):
    if not points or len(points) < 2:
        return float("inf")
    best = float("inf")
    n = len(points)
    for i in range(n):
        ax, ay = points[i]
        bx, by = points[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        len2 = dx * dx + dy * dy
        t = 0.0
        if len2 > 0:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
        qx, qy = ax + t * dx, ay + t * dy
        d = math.hypot(px - qx, py - qy)
        if d < best:
            best = d
    return best
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_poi_match.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/poi_match.py tests/pubg/test_poi_match.py
git commit -m "feat(pubg): poi_match Geometrie-Primitive"
```

---

## Task 2: match_poi — kleinste umschließende Region gewinnt

**Files:**
- Modify: `pubg/poi_match.py`
- Test: `tests/pubg/test_poi_match.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_poi_match.py
from pubg.poi_match import match_poi


def _regions():
    # Grosse Region "City" enthaelt kleine "Downtown"
    return [
        {"name": "City",     "points": [[0, 0], [200, 0], [200, 200], [0, 200]]},
        {"name": "Downtown", "points": [[80, 80], [120, 80], [120, 120], [80, 120]]},
        {"name": "",         "points": [[300, 300], [400, 300], [350, 400]]},
    ]


def test_match_poi_smallest_enclosing_wins():
    # Punkt im Downtown (auch in City) → Downtown (kleinere Flaeche)
    assert match_poi(100, 100, _regions()) == "Downtown"


def test_match_poi_only_outer():
    assert match_poi(20, 20, _regions()) == "City"


def test_match_poi_none_when_outside():
    assert match_poi(1000, 1000, _regions()) is None


def test_match_poi_ignores_unnamed_regions():
    # Punkt im namenlosen Dreieck → None (kein Label)
    assert match_poi(350, 330, _regions()) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_poi_match.py -k match_poi -v`
Expected: FAIL with `ImportError: cannot import name 'match_poi'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to pubg/poi_match.py

def match_poi(x, y, regions):
    """Liefert den POI-Namen fuer eine Koordinate. Kleinste umschliessende
    benannte Region gewinnt (Nesting-faehig). None wenn in keiner Region.
    Namenlose Regionen ('') werden ignoriert."""
    best = None
    best_area = float("inf")
    for r in regions or []:
        name = r.get("name")
        if not name:
            continue
        pts = r.get("points") or []
        if point_in_poly(x, y, pts):
            a = poly_area(pts)
            if a < best_area:
                best_area = a
                best = name
    return best
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_poi_match.py -k match_poi -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/poi_match.py tests/pubg/test_poi_match.py
git commit -m "feat(pubg): match_poi kleinste-Region-gewinnt"
```

---

## Task 3: perp_distance_to_route — Querdistanz Punkt↔Flugroute

**Files:**
- Modify: `pubg/poi_match.py`
- Test: `tests/pubg/test_poi_match.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_poi_match.py
from pubg.poi_match import perp_distance_to_route


def test_perp_distance_on_line_is_zero():
    # Route entlang x-Achse (0,0)->(100,0); Punkt (50,0) liegt drauf
    d = perp_distance_to_route(50, 0, 0, 0, 100, 0)
    assert abs(d) < 1e-6


def test_perp_distance_perpendicular():
    # Punkt 30 ueber der Linie
    d = perp_distance_to_route(50, 30, 0, 0, 100, 0)
    assert abs(d - 30) < 1e-6


def test_perp_distance_degenerate_route():
    # A == B → Distanz = Punkt-zu-Punkt
    d = perp_distance_to_route(3, 4, 0, 0, 0, 0)
    assert abs(d - 5) < 1e-6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_poi_match.py -k perp -v`
Expected: FAIL with `ImportError: cannot import name 'perp_distance_to_route'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to pubg/poi_match.py

def perp_distance_to_route(px, py, ax, ay, bx, by):
    """Kuerzeste Distanz von Punkt P zur UNENDLICHEN Geraden durch A,B.
    (Flugzeug fliegt ueber die ganze Karte → unendliche Linie, nicht
    Segment.) Bei A==B: Punkt-zu-Punkt-Distanz."""
    dx, dy = bx - ax, by - ay
    denom = math.hypot(dx, dy)
    if denom == 0:
        return math.hypot(px - ax, py - ay)
    # |(B-A) x (A-P)| / |B-A|
    cross = abs(dx * (ay - py) - dy * (ax - px))
    return cross / denom
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_poi_match.py -k perp -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/poi_match.py tests/pubg/test_poi_match.py
git commit -m "feat(pubg): perp_distance_to_route fuer Flugrouten-Filter"
```

---

## Task 4: Endpoint /api/pubg/player-search

**Files:**
- Modify: `pubg/endpoints.py` (dispatch + Methode)
- Test: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_endpoints.py
def test_player_search_matches_prefix(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "Mate1", "steam", False)
    upsert_player(conn, "account.C", "LuckyGuy", "steam", False)
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/player-search?q=Luc", b"", {})
    assert code == 200
    payload = json.loads(body)
    names = {p["name"] for p in payload}
    assert "PEX_LuCKoR" in names      # account.A aus _setup
    assert "LuckyGuy" in names
    assert "Mate1" not in names


def test_player_search_empty_query_returns_empty(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/player-search?q=", b"", {})
    assert code == 200
    assert json.loads(body) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py -k player_search -v`
Expected: FAIL (Route unbekannt → 404)

- [ ] **Step 3: Write minimal implementation**

In `dispatch()` nach der `landings`-Zeile (`pubg/endpoints.py:114`):

```python
        if route == ("GET", "/api/pubg/player-search"):
            return self._player_search(qs)
        if route == ("GET", "/api/pubg/landing-heatmap"):
            return self._landing_heatmap(qs)
```

Methode (nach `_landings`):

```python
    def _player_search(self, qs):
        conn = self.get_conn()
        q = (qs.get("q") or "").strip()
        if not q:
            return _ok([])
        rows = conn.execute(
            "SELECT account_id, name FROM players "
            "WHERE name LIKE ? ORDER BY name LIMIT 20",
            (f"%{q}%",)).fetchall()
        return _ok([{"accountId": r["account_id"], "name": r["name"]}
                    for r in rows if r["name"]])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py -k player_search -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): /api/pubg/player-search Autocomplete-Endpoint"
```

---

## Task 5: Landing-Aggregation in aggregations (Konstellations-Filter)

**Files:**
- Modify: `pubg/aggregations.py` (neue Funktion `compute_landing_spots`)
- Test: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_aggregations.py
from pubg.db import connect, init_schema, upsert_player
from pubg.aggregations import compute_landing_spots


def _seed_landings(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "acc.A", "LuCKoR", "steam", True)
    upsert_player(conn, "acc.B", "Mate1", "steam", False)
    upsert_player(conn, "acc.C", "Rando", "steam", False)
    # Match 1: A + B im Team 1
    conn.execute("INSERT INTO matches (match_id, played_at, map_name, game_mode) "
                 "VALUES ('m1','2026-05-01T10:00:00Z','Baltic_Main','squad')")
    for acc, tid in [("acc.A", 1), ("acc.B", 1)]:
        conn.execute("INSERT INTO match_team_mapping (match_id, account_id, team_id) "
                     "VALUES (?,?,?)", ("m1", acc, tid))
        conn.execute("INSERT INTO participants (match_id, account_id, name, team_id) "
                     "VALUES (?,?,?,?)", ("m1", acc,
                     "LuCKoR" if acc == "acc.A" else "Mate1", tid))
    # A landet bei (400000,400000), B bei (410000,410000)
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z, actor_health) "
                 "VALUES ('m1','Landing',1000,'acc.A',400000,400000,100,90)")
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z, actor_health) "
                 "VALUES ('m1','Landing',1000,'acc.B',410000,410000,100,90)")
    # Match 2: A + C im Team 1 (andere Konstellation)
    conn.execute("INSERT INTO matches (match_id, played_at, map_name, game_mode) "
                 "VALUES ('m2','2026-05-02T10:00:00Z','Baltic_Main','squad')")
    for acc, tid in [("acc.A", 1), ("acc.C", 1)]:
        conn.execute("INSERT INTO match_team_mapping (match_id, account_id, team_id) "
                     "VALUES (?,?,?)", ("m2", acc, tid))
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z, actor_health) "
                 "VALUES ('m2','Landing',1000,'acc.A',600000,600000,100,90)")
    conn.commit()
    return conn


def test_landing_spots_filters_by_constellation(tmp_db_path):
    conn = _seed_landings(tmp_db_path)
    # Filter: A + B zusammen → nur Match 1 zaehlt
    res = compute_landing_spots(conn, "Baltic_Main", ["acc.A", "acc.B"])
    accs_with_points = {p["accountId"] for p in res["scatterPoints"]}
    assert "acc.A" in accs_with_points
    assert "acc.B" in accs_with_points
    # Match 2 (A+C) ist ausgeschlossen → A hat nur 1 Landung (aus m1)
    a_points = [p for p in res["scatterPoints"] if p["accountId"] == "acc.A"]
    assert len(a_points) == 1
    assert res["totalMatches"] == 1


def test_landing_spots_single_player_all_matches(tmp_db_path):
    conn = _seed_landings(tmp_db_path)
    # Nur A → beide Matches
    res = compute_landing_spots(conn, "Baltic_Main", ["acc.A"])
    a_points = [p for p in res["scatterPoints"] if p["accountId"] == "acc.A"]
    assert len(a_points) == 2
    assert res["totalMatches"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_aggregations.py -k landing_spots -v`
Expected: FAIL with `ImportError: cannot import name 'compute_landing_spots'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to pubg/aggregations.py

def compute_landing_spots(conn, map_name, player_accs, pois_blob=None,
                          route_filter=False):
    """Aggregiert Landings auf einer Map, gefiltert auf Matches in denen
    ALLE player_accs im selben Squad waren (Konstellations-Filter).
    Leere player_accs-Liste → alle Matches der Map.

    pois_blob: {mapKm, regions:[...]} der Map (fuer POI-Zuordnung).
    route_filter: nur Matches wo der Landing-POI <=1.5km Querdistanz zur
                  Flugroute hatte (siehe Task 6 — hier noch ignoriert).

    Returns:
      { "pois": [{name, cx, cy, total, byPlayer:{acc:{name,count,pct}}}],
        "scatterPoints": [{accountId, x, y, matchId}],
        "totalMatches": int }
    """
    from pubg.poi_match import match_poi, poly_area
    player_accs = [a for a in (player_accs or []) if a]

    # 1) Matches der Map bestimmen, die den Konstellations-Filter erfuellen
    match_rows = conn.execute(
        "SELECT match_id FROM matches WHERE map_name = ?",
        (map_name,)).fetchall()
    match_ids = []
    for mr in match_rows:
        mid = mr["match_id"]
        if not player_accs:
            match_ids.append(mid)
            continue
        # Alle player_accs muessen im selben team_id dieses Matches sein
        rows = conn.execute(
            "SELECT account_id, team_id FROM match_team_mapping "
            "WHERE match_id = ?", (mid,)).fetchall()
        team_of = {r["account_id"]: r["team_id"] for r in rows}
        teams = {team_of.get(a) for a in player_accs}
        if None in teams or len(teams) != 1:
            continue
        match_ids.append(mid)

    if not match_ids:
        return {"pois": [], "scatterPoints": [], "totalMatches": 0}

    # 2) Landings dieser Matches fuer die gewuenschten Spieler holen.
    #    Best-Touchdown: fruehestes Landing mit z<80000 + health>0 pro
    #    (match, actor). Vereinfachte Variante der _landings-Heuristik.
    ph = ",".join("?" * len(match_ids))
    acc_clause = ""
    params = list(match_ids)
    if player_accs:
        acc_ph = ",".join("?" * len(player_accs))
        acc_clause = f"AND te.actor_account IN ({acc_ph})"
        params += player_accs
    rows = conn.execute(f"""
        WITH best AS (
          SELECT match_id, actor_account, MIN(timestamp_ms) AS ts
          FROM telemetry_events
          WHERE event_type='Landing' AND match_id IN ({ph})
            AND actor_x IS NOT NULL AND actor_y IS NOT NULL
            AND (actor_z IS NULL OR actor_z < 80000)
            AND (actor_health IS NULL OR actor_health > 0)
          GROUP BY match_id, actor_account
        )
        SELECT te.match_id, te.actor_account, te.actor_x, te.actor_y,
               p.name AS player_name
        FROM best b
        JOIN telemetry_events te
          ON te.match_id=b.match_id AND te.actor_account=b.actor_account
         AND te.timestamp_ms=b.ts AND te.event_type='Landing'
        LEFT JOIN players p ON p.account_id = te.actor_account
        WHERE 1=1 {acc_clause}
    """, params).fetchall()

    regions = (pois_blob or {}).get("regions") or []
    # POI-Zentren vorberechnen (Vertex-Mittel) + Flaeche fuer Sortier-Stabilitaet
    poi_centroid = {}
    for r in regions:
        nm = r.get("name")
        if not nm:
            continue
        pts = r.get("points") or []
        if pts:
            sx = sum(p[0] for p in pts) / len(pts)
            sy = sum(p[1] for p in pts) / len(pts)
            poi_centroid[nm] = (sx, sy)

    mapKm = (pois_blob or {}).get("mapKm") or 8
    span = mapKm * 100000.0

    scatter = []
    poi_acc = {}  # poi_name → {acc → count}
    for r in rows:
        x, y = r["actor_x"], r["actor_y"]
        acc = r["actor_account"]
        scatter.append({
            "accountId": acc,
            "x": max(0.0, min(1.0, x / span)),
            "y": max(0.0, min(1.0, y / span)),
            "matchId": r["match_id"],
        })
        name = match_poi(x, y, regions) or "—"
        poi_acc.setdefault(name, {})
        poi_acc[name][acc] = poi_acc[name].get(acc, 0) + 1

    # Namens-Lookup
    name_of = {r["actor_account"]: (r["player_name"] or r["actor_account"][:8])
               for r in rows}

    pois_out = []
    for name, accmap in poi_acc.items():
        total = sum(accmap.values())
        cx, cy = poi_centroid.get(name, (None, None))
        by = {}
        for acc, cnt in accmap.items():
            by[acc] = {"name": name_of.get(acc, acc[:8]),
                       "count": cnt,
                       "pct": round(cnt / total * 100)}
        pois_out.append({
            "name": name,
            "cx": (cx / span) if cx is not None else None,
            "cy": (cy / span) if cy is not None else None,
            "total": total,
            "byPlayer": by,
        })
    pois_out.sort(key=lambda p: p["total"], reverse=True)

    return {"pois": pois_out, "scatterPoints": scatter,
            "totalMatches": len(match_ids)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_aggregations.py -k landing_spots -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/aggregations.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): compute_landing_spots mit Konstellations-Filter"
```

---

## Task 6: Flugrouten-Filter in compute_landing_spots

**Files:**
- Modify: `pubg/aggregations.py`
- Test: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_aggregations.py
def test_landing_spots_route_filter_excludes_far_pois(tmp_db_path):
    conn = _seed_landings(tmp_db_path)
    # Flugroute fuer m1: zwei Cruise-Position-Events (z>=150000) entlang
    # der Linie x=400000 (vertikal). POI bei (400000,400000) liegt drauf
    # (0km Querdistanz), also bleibt er drin.
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z) "
                 "VALUES ('m1','Position',100,'acc.A',400000,0,160000)")
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z) "
                 "VALUES ('m1','Position',200,'acc.A',400000,800000,160000)")
    conn.commit()
    # Filter A allein, route_filter an. POIs der Map kommen aus pois_blob.
    pois = {"mapKm": 8, "regions": [
        {"name": "OnRoute",  "points": [[390000,390000],[410000,390000],
                                        [410000,410000],[390000,410000]]},
        {"name": "FarAway",  "points": [[10000,10000],[30000,10000],
                                        [30000,30000],[10000,30000]]},
    ]}
    res = compute_landing_spots(conn, "Baltic_Main", ["acc.A"],
                                pois_blob=pois, route_filter=True)
    # m1-Landung (400000,400000) ist auf der Route → bleibt.
    # m2 hat keine Cruise-Events → routeUnknown → bleibt ebenfalls.
    poi_names = {p["name"] for p in res["pois"]}
    assert "OnRoute" in poi_names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_aggregations.py -k route_filter -v`
Expected: FAIL — `route_filter` wird in Task 5 noch ignoriert, KeyError/AssertionError je nach Datenlage. (Falls der Test zufällig grün ist, weil nichts gefiltert wird: trotzdem Step 3 umsetzen, damit der Filter real greift, und einen zweiten Assert ergänzen der eine far-route ausschließt.)

- [ ] **Step 3: Write minimal implementation**

In `compute_landing_spots`, NACH dem Bestimmen von `match_ids` (vor dem Landings-Query), den Routen-Filter einbauen. Ergänze den Import `from pubg.poi_match import match_poi, poly_area, perp_distance_to_route` und filtere `match_ids`:

```python
    # Flugrouten-Filter: nur Matches behalten wo die Landung des
    # Referenz-Spielers <=1.5km Querdistanz zur Cruise-Route lag.
    # Referenz = erster angegebener Spieler (oder self bei leerer Liste).
    if route_filter and player_accs:
        ref = player_accs[0]
        ROUTE_MAX_CM = 150000  # 1.5km
        kept = []
        for mid in match_ids:
            cruise = conn.execute("""
                SELECT actor_x, actor_y FROM telemetry_events
                WHERE match_id=? AND actor_account=? AND event_type='Position'
                  AND actor_z >= 150000
                ORDER BY timestamp_ms ASC
            """, (mid, ref)).fetchall()
            land = conn.execute("""
                SELECT actor_x, actor_y FROM telemetry_events
                WHERE match_id=? AND actor_account=? AND event_type='Landing'
                  AND actor_x IS NOT NULL
                ORDER BY timestamp_ms ASC LIMIT 1
            """, (mid, ref)).fetchone()
            if len(cruise) < 2 or not land:
                kept.append(mid)  # routeUnknown → einbeziehen
                continue
            ax, ay = cruise[0]["actor_x"], cruise[0]["actor_y"]
            bx, by = cruise[-1]["actor_x"], cruise[-1]["actor_y"]
            d = perp_distance_to_route(land["actor_x"], land["actor_y"],
                                       ax, ay, bx, by)
            if d <= ROUTE_MAX_CM:
                kept.append(mid)
        match_ids = kept
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_aggregations.py -k landing -v`
Expected: PASS (alle landing-Tests)

- [ ] **Step 5: Commit**

```bash
git add pubg/aggregations.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): Flugrouten-Filter in compute_landing_spots"
```

---

## Task 7: Endpoint /api/pubg/landing-heatmap

**Files:**
- Modify: `pubg/endpoints.py`
- Test: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/pubg/test_endpoints.py
def test_landing_heatmap_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute("INSERT INTO matches (match_id, played_at, map_name, game_mode) "
                 "VALUES ('m1','2026-05-01T10:00:00Z','Baltic_Main','squad')")
    conn.execute("INSERT INTO match_team_mapping (match_id, account_id, team_id) "
                 "VALUES ('m1','account.A',1)")
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z, actor_health) "
                 "VALUES ('m1','Landing',1000,'account.A',400000,400000,100,90)")
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/landing-heatmap?map=Baltic_Main&p0=account.A", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["totalMatches"] == 1
    assert len(payload["scatterPoints"]) == 1


def test_landing_heatmap_requires_map(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/landing-heatmap", b"", {})
    assert code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py -k landing_heatmap -v`
Expected: FAIL (Methode fehlt)

- [ ] **Step 3: Write minimal implementation**

Methode (nach `_player_search`):

```python
    def _landing_heatmap(self, qs):
        from pubg.aggregations import compute_landing_spots
        conn = self.get_conn()
        map_name = (qs.get("map") or "").strip()
        if not map_name:
            return _err(400, "map required")
        accs = [qs.get(k) for k in ("p0", "p1", "p2", "p3")]
        accs = [a for a in accs if a]
        route_filter = qs.get("routeFilter") == "1"
        pois = self._load_pois()
        alias = "Baltic_Main" if map_name == "Erangel_Main" else map_name
        blob = pois.get(alias) or pois.get(map_name) or {"mapKm": 8, "regions": []}
        result = compute_landing_spots(
            conn, map_name, accs, pois_blob=blob, route_filter=route_filter)
        return _ok(result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -m pytest tests/pubg/test_endpoints.py -k landing_heatmap -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): /api/pubg/landing-heatmap Endpoint"
```

---

## Task 8: Tool-Grundgerüst tools/landing-spots.html

**Files:**
- Create: `tools/landing-spots.html`
- Create: `tools/landing-spots.js`

- [ ] **Step 1: HTML-Skelett (1920×1080, WCAG-konform)**

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>PUBG Landing Spots</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/widgets/pubg/_pubg.css">
  <style>
    html, body { margin: 0; width: 1920px; height: 1080px;
                 background: #0d061a; color: #eee;
                 font-family: "DM Sans", sans-serif; overflow: hidden; }
    .app { display: grid; grid-template-rows: auto 1fr;
           width: 1920px; height: 1080px; }
    .header { display: flex; align-items: center; gap: 16px;
              padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .header label { font-size: 0.8em; color: #aaa; margin-right: 4px; }
    select, input { font-family: inherit; background: #1a0f2e; color: #eee;
                    border: 1px solid #5e2a79; border-radius: 6px;
                    padding: 6px 10px; min-height: 24px; }
    .pwrap { position: relative; }
    .ac-list { position: absolute; top: 100%; left: 0; right: 0;
               background: #1a0f2e; border: 1px solid #5e2a79; z-index: 20;
               max-height: 220px; overflow-y: auto; display: none; }
    .ac-list div { padding: 6px 10px; cursor: pointer; min-height: 24px; }
    .ac-list div:hover, .ac-list div[aria-selected="true"] { background: #5e2a79; }
    .body { display: grid; grid-template-columns: 1fr 480px; min-height: 0; }
    .mapwrap { position: relative; }
    canvas { display: block; width: 100%; height: 100%; }
    .players-bar { position: absolute; bottom: 10px; left: 10px;
                   display: flex; gap: 8px; }
    .pchip { display: flex; align-items: center; gap: 6px; padding: 4px 10px;
             border-radius: 14px; background: #1a0f2e80; cursor: pointer;
             border: 1px solid transparent; min-height: 24px; }
    .pchip.active { border-color: #f2b705; }
    .pchip .dot { width: 12px; height: 12px; border-radius: 50%; }
    .poi-list { overflow-y: auto; padding: 12px 16px;
                border-left: 1px solid rgba(255,255,255,0.1); }
    .poi { margin-bottom: 12px; }
    .poi-head { display: flex; justify-content: space-between; font-weight: 700; }
    .bar { height: 6px; background: #5e2a79; border-radius: 3px; margin: 4px 0; }
    .poi-player { display: flex; justify-content: space-between;
                  font-size: 0.85em; color: #ccc; padding-left: 12px; }
    button:focus-visible, select:focus-visible, input:focus-visible,
    [tabindex]:focus-visible { outline: 3px solid #f2b705; outline-offset: 2px; }
  </style>
</head>
<body>
  <main class="app">
    <div class="header">
      <span><label for="mapSelect">Karte</label>
        <select id="mapSelect" aria-label="Karte"></select></span>
      <span class="pwrap"><label for="p0">P1</label>
        <input id="p0" autocomplete="off" aria-label="Spieler 1">
        <div class="ac-list" id="ac0" role="listbox"></div></span>
      <span class="pwrap"><label for="p1">P2</label>
        <input id="p1" autocomplete="off" aria-label="Spieler 2">
        <div class="ac-list" id="ac1" role="listbox"></div></span>
      <span class="pwrap"><label for="p2">P3</label>
        <input id="p2" autocomplete="off" aria-label="Spieler 3">
        <div class="ac-list" id="ac2" role="listbox"></div></span>
      <span class="pwrap"><label for="p3">P4</label>
        <input id="p3" autocomplete="off" aria-label="Spieler 4">
        <div class="ac-list" id="ac3" role="listbox"></div></span>
      <label><input type="checkbox" id="routeFilter"> Flugrouten-Filter (≤1,5km)</label>
      <span id="matchCount" aria-live="polite"></span>
    </div>
    <div class="body">
      <div class="mapwrap">
        <canvas id="heat"></canvas>
        <div class="players-bar" id="playersBar"></div>
      </div>
      <section class="poi-list" id="poiList" aria-label="POI-Liste"></section>
    </div>
  </main>
  <script src="/widgets/pubg/_pubg.js"></script>
  <script src="/tools/landing-spots.js"></script>
</body>
</html>
```

- [ ] **Step 2: Karten-Selektor füllen (Maps aus DB) + State**

Erstelle `tools/landing-spots.js`:

```javascript
const LS = {
  data: null,            // landing-heatmap Response
  players: [],           // [{accountId, name}] der 4 Felder (nur gefüllte)
  activeScatter: new Set(),  // accountIds deren Scatter sichtbar ist
  mapName: null,
  mapImg: null,
};
const SCATTER_COLORS = ["#f2b705", "#3cb44b", "#46f0f0", "#f032e6"];

async function loadMaps() {
  // Maps aus der Match-Liste ableiten (distinct)
  const list = await PubgUI.fetchJson("/api/pubg/matches-list?limit=200");
  const maps = [...new Set(list.map(m => m.mapName).filter(Boolean))];
  const sel = document.getElementById("mapSelect");
  sel.innerHTML = maps.map(m =>
    `<option value="${m}">${m.replace("_Main", "")}</option>`).join("");
  sel.addEventListener("change", () => { LS.mapName = sel.value; refresh(); });
  LS.mapName = sel.value || maps[0];
  if (LS.mapName) { sel.value = LS.mapName; refresh(); }
}

loadMaps();
```

- [ ] **Step 3: Manueller Smoke-Test**

Browser: `http://localhost:9000/tools/landing-spots.html`. Erwartet: Karten-Dropdown ist mit den in der DB vorhandenen Maps gefüllt. Layout sitzt auf 1920×1080 (Header oben, Karte links, POI-Liste rechts).

- [ ] **Step 4: Commit**

```bash
git add tools/landing-spots.html tools/landing-spots.js
git commit -m "feat(tools): landing-spots Grundgeruest + Karten-Selektor"
```

---

## Task 9: Spieler-Autocomplete + Daten-Fetch (refresh)

**Files:**
- Modify: `tools/landing-spots.js`

- [ ] **Step 1: Autocomplete pro Eingabefeld**

```javascript
function wireAutocomplete(idx) {
  const input = document.getElementById("p" + idx);
  const list = document.getElementById("ac" + idx);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { list.style.display = "none"; setPlayer(idx, null); return; }
    timer = setTimeout(async () => {
      const res = await PubgUI.fetchJson(
        "/api/pubg/player-search?q=" + encodeURIComponent(q));
      list.innerHTML = res.map(p =>
        `<div role="option" tabindex="0" data-acc="${p.accountId}">${p.name}</div>`
      ).join("");
      list.style.display = res.length ? "block" : "none";
      list.querySelectorAll("div").forEach(d => {
        const pick = () => {
          input.value = d.textContent;
          setPlayer(idx, { accountId: d.dataset.acc, name: d.textContent });
          list.style.display = "none";
          refresh();
        };
        d.addEventListener("click", pick);
        d.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); pick(); }
        });
      });
    }, 200);
  });
  input.addEventListener("blur", () =>
    setTimeout(() => { list.style.display = "none"; }, 150));
}

function setPlayer(idx, player) {
  LS.players[idx] = player;  // kann null sein
}

[0, 1, 2, 3].forEach(wireAutocomplete);
document.getElementById("routeFilter")
  .addEventListener("change", refresh);
```

- [ ] **Step 2: refresh() — Heatmap-Daten laden**

```javascript
async function refresh() {
  if (!LS.mapName) return;
  const params = new URLSearchParams();
  params.set("map", LS.mapName);
  [0, 1, 2, 3].forEach(i => {
    if (LS.players[i]) params.set("p" + i, LS.players[i].accountId);
  });
  if (document.getElementById("routeFilter").checked)
    params.set("routeFilter", "1");
  LS.data = await PubgUI.fetchJson("/api/pubg/landing-heatmap?" + params);
  document.getElementById("matchCount").textContent =
    LS.data.totalMatches + " Matches";
  await ensureMapImage();
  buildPlayersBar();
  renderPoiList();
  renderHeatmap();   // Task 10
}
```

- [ ] **Step 3: Manueller Smoke-Test**

Browser: In P1 einen Namen tippen → Autocomplete-Dropdown erscheint, Auswahl möglich. Match-Count aktualisiert sich. (Heatmap noch leer bis Task 10.)

- [ ] **Step 4: Commit**

```bash
git add tools/landing-spots.js
git commit -m "feat(tools): landing-spots Autocomplete + Daten-Fetch"
```

---

## Task 10: Heatmap + Scatter rendern

**Files:**
- Modify: `tools/landing-spots.js`

- [ ] **Step 1: Map-Bild laden + Canvas-Projektion (0-1 → Pixel)**

```javascript
function ensureMapImage() {
  const name = LS.mapName === "Erangel_Main" ? "Baltic_Main" : LS.mapName;
  if (LS.mapImg && LS._imgName === name) return Promise.resolve();
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { LS.mapImg = img; LS._imgName = name; res(); };
    img.onerror = () => { LS.mapImg = null; res(); };
    img.src = "/widgets/pubg/maps/" + name + ".webp";
  });
}

function fitCanvas() {
  const cnv = document.getElementById("heat");
  const r = cnv.parentElement.getBoundingClientRect();
  cnv.width = Math.floor(r.width);
  cnv.height = Math.floor(r.height);
}

// normalisiert (0-1) → Canvas-Pixel (Map quadratisch zentriert)
function projXY(nx, ny) {
  const cnv = document.getElementById("heat");
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2;
  const offY = (cnv.height - base) / 2;
  return [offX + nx * base, offY + ny * base];
}
```

- [ ] **Step 2: Heatmap-Blobs + Scatter zeichnen**

```javascript
function renderHeatmap() {
  fitCanvas();
  const cnv = document.getElementById("heat");
  const ctx = cnv.getContext("2d");
  ctx.fillStyle = "#0d061a";
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  // Basemap quadratisch
  if (LS.mapImg) {
    const [x0, y0] = projXY(0, 0);
    const [x1, y1] = projXY(1, 1);
    ctx.drawImage(LS.mapImg, x0, y0, x1 - x0, y1 - y0);
  }
  if (!LS.data) return;

  // Heatmap-Blobs pro POI (Radius ~ total, Farbe Gold→Lila nach Intensität)
  const maxTotal = Math.max(1, ...LS.data.pois.map(p => p.total));
  for (const poi of LS.data.pois) {
    if (poi.cx == null) continue;
    const [px, py] = projXY(poi.cx, poi.cy);
    const intensity = poi.total / maxTotal;
    const radius = 20 + intensity * 60;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, `rgba(94,42,121,${0.25 + intensity * 0.45})`);
    grad.addColorStop(1, "rgba(242,183,5,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    // POI-Label
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px DM Sans";
    ctx.textAlign = "center";
    ctx.fillText(poi.name + " " + poi.total + "×", px, py - radius - 4);
  }

  // Scatter-Punkte nur fuer aktive Spieler
  for (const sp of LS.data.scatterPoints) {
    if (!LS.activeScatter.has(sp.accountId)) continue;
    const idx = LS.players.findIndex(
      p => p && p.accountId === sp.accountId);
    const color = SCATTER_COLORS[idx] || "#fff";
    const [px, py] = projXY(sp.x, sp.y);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  }
}
window.addEventListener("resize", renderHeatmap);
```

- [ ] **Step 3: Players-Bar (Scatter-Toggle pro Spieler)**

```javascript
function buildPlayersBar() {
  const bar = document.getElementById("playersBar");
  const active = LS.players.map((p, i) => ({ p, i })).filter(o => o.p);
  bar.innerHTML = active.map(({ p, i }) => `
    <div class="pchip" role="button" tabindex="0" data-acc="${p.accountId}"
         aria-label="Scatter ${p.name} umschalten">
      <span class="dot" style="background:${SCATTER_COLORS[i]}"></span>
      ${p.name}
    </div>`).join("");
  bar.querySelectorAll(".pchip").forEach(chip => {
    const acc = chip.dataset.acc;
    const toggle = () => {
      if (LS.activeScatter.has(acc)) LS.activeScatter.delete(acc);
      else LS.activeScatter.add(acc);
      chip.classList.toggle("active", LS.activeScatter.has(acc));
      renderHeatmap();
    };
    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}
```

- [ ] **Step 4: Manueller Smoke-Test**

Browser: Spieler wählen. Erwartet: Heatmap-Blobs erscheinen über den häufigen Lande-POIs mit Label „Pochinki 8×". Player-Chips unten links; Klick blendet die farbigen Scatter-Punkte dieses Spielers ein/aus. Kartenbild korrekt im Hintergrund.

- [ ] **Step 5: Commit**

```bash
git add tools/landing-spots.js
git commit -m "feat(tools): landing-spots Heatmap + Scatter-Rendering"
```

---

## Task 11: POI-Liste mit per-Spieler-Aufschlüsselung

**Files:**
- Modify: `tools/landing-spots.js`

- [ ] **Step 1: POI-Liste rendern**

```javascript
function renderPoiList() {
  const host = document.getElementById("poiList");
  if (!LS.data || !LS.data.pois.length) {
    host.innerHTML = `<p>Keine Landings für diese Auswahl.</p>`;
    return;
  }
  const maxTotal = Math.max(1, ...LS.data.pois.map(p => p.total));
  host.innerHTML = LS.data.pois.map(poi => {
    const players = Object.entries(poi.byPlayer)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, v]) =>
        `<div class="poi-player"><span>${v.name}</span>`
        + `<span>${v.count}× · ${v.pct}%</span></div>`).join("");
    const w = Math.round(poi.total / maxTotal * 100);
    return `
      <div class="poi" data-poi="${poi.name}">
        <div class="poi-head"><span>${poi.name}</span><span>${poi.total}×</span></div>
        <div class="bar" style="width:${w}%"></div>
        ${players}
      </div>`;
  }).join("");
}
```

- [ ] **Step 2: Hover-Verknüpfung Liste ↔ Karte (POI pulsen)**

```javascript
function highlightPoi(name) {
  LS._hoverPoi = name;
  renderHeatmap();
  if (!name) return;
  const cnv = document.getElementById("heat");
  const ctx = cnv.getContext("2d");
  const poi = LS.data.pois.find(p => p.name === name);
  if (!poi || poi.cx == null) return;
  const [px, py] = projXY(poi.cx, poi.cy);
  ctx.strokeStyle = "#f2b705";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(px, py, 36, 0, Math.PI * 2); ctx.stroke();
}

document.getElementById("poiList").addEventListener("mouseover", e => {
  const el = e.target.closest(".poi");
  if (el) highlightPoi(el.dataset.poi);
});
document.getElementById("poiList").addEventListener("mouseout", e => {
  if (e.target.closest(".poi")) highlightPoi(null);
});
```

- [ ] **Step 3: Manueller Smoke-Test**

Browser: POI-Liste rechts zeigt POIs nach Häufigkeit sortiert, jeweils mit Balken + per-Spieler-Zeilen (`LuCKoR 8× · 57%`). Hover über einen Listeneintrag pulst den entsprechenden Blob auf der Karte gelb.

- [ ] **Step 4: Commit**

```bash
git add tools/landing-spots.js
git commit -m "feat(tools): landing-spots POI-Liste + Hover-Verknuepfung"
```

---

## Task 12: README + Übersicht

**Files:**
- Modify: `README.md`
- Modify: `widgets/pubg/index.html` (Tool-Übersicht, falls vorhanden)

- [ ] **Step 1: README-Abschnitt**

Dokumentiere `tools/landing-spots.html`: Karten-Auswahl, 4 Spieler-Filter mit Autocomplete (leer = beliebig, Konstellations-Filter), Flugrouten-Filter (≤1,5km Querdistanz), kombinierte Heatmap + per-Spieler-Scatter, POI-Liste. Stil bestehender Einträge folgen.

- [ ] **Step 2: Übersichts-Kachel (KEINE iframes)**

Kachel „Landing Spots", Größe „Browser-Tab / 1920×1080", Parameter-Doku ergänzen.

- [ ] **Step 3: Commit**

```bash
git add README.md widgets/pubg/index.html
git commit -m "docs: landing-spots Tool in README + Uebersicht"
```

---

## Self-Review-Ergebnis

- **Spec-Coverage:** eine Map zur Zeit + Selektor (T8), 4 Autocomplete-Felder leer=beliebig (T9), Konstellations-Filter (T5), Flugrouten-Filter ≤1,5km Querdistanz/90° (T3+T6), kombinierte Heatmap (T10), per-Spieler-Scatter umschaltbar (T10), POI-Liste mit per-Spieler-Aufschlüsselung (T11), 1920×1080 (T8). ✓
- **Platzhalter:** keine — vollständiger Code je Schritt.
- **Typ-Konsistenz:** `compute_landing_spots`-Signatur (conn, map_name, player_accs, pois_blob, route_filter) konsistent zwischen T5/T6/T7; Response-Felder (`pois[].name/cx/cy/total/byPlayer`, `scatterPoints[].accountId/x/y/matchId`, `totalMatches`) durchgängig Backend↔Frontend; `poi_match`-Funktionsnamen (`point_in_poly`, `poly_area`, `dist_to_poly`, `match_poi`, `perp_distance_to_route`) konsistent.
- **Offen/zu verifizieren beim Bauen:** (1) Ob genug `Position`-Events mit z≥150000 für die Flugrouten-Rekonstruktion vorhanden sind — sonst fallen viele Matches in `routeUnknown`. (2) `pinCalibration` wird hier NICHT auf die Heatmap angewandt (Scatter/POI sind über `_landings`-konsistente World-cohärente cm normalisiert) — falls Pins gegenüber dem Kartenbild verschoben wirken, dieselbe `applyCal`-Logik wie im Replay-Tool ergänzen. (3) POI-Centroid ist Vertex-Mittel (wie `_pubg_pois.js`), genügt für Blob-Platzierung.
