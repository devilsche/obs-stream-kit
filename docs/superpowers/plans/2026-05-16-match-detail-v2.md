# Match-Detail v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Match-Detail expand-view from v1 (Commits `1fd2867..c0e7f23`) into v2: 300×300 Map with manual zoom + Auto-Camera-Follow + scrubbable Zeitraffer + Solo-Filter + Multi-Lives-Support (Comeback-Modi).

**Architecture:** Backend `compute_match_detail` produces `members[].lives[]` array (lives detected via Telemetry-Split an Kill-Events). Frontend uses Two-Canvas-Pattern mit Viewport-State (center+zoom+autoFollow). Default-View zeigt nur Flugrouten + Landing-Pins; Pfade nach Landing erscheinen beim Scrubben über Trail-Rendering. Marker-Click setzt Solo-Mode + zoomt 500m drauf + seekt Zeitraffer-Cursor.

**Tech Stack:** Python 3 + pytest (Backend). Vanilla HTML/CSS/JS, Canvas 2D, requestAnimationFrame, MouseEvents (Frontend). Keine neuen Deps.

**Spec:** `docs/superpowers/specs/2026-05-16-match-detail-v2-design.md`.

**Repo-Konvention:** Direkt auf `master` committen, keine Feature-Branches. Commits deutsch, Conventional Commits, KEIN `Co-Authored-By`. Architektur-Konventionen siehe `CLAUDE.md`.

---

## File Structure

**Backend (modify):**
- `pubg/aggregations.py` — `compute_match_detail` Rewrite (lines ~880-1130). Output-Schema: `members[].lives[]` statt flat `landingX/Y` + `deathX/Y`.

**Backend (replace tests):**
- `tests/pubg/test_match_detail.py` — vorhandene v1-Tests werden ersetzt (Pfad-Timestamps + Squad-Kills-Tests bleiben in geänderter Form, plus 3 neue Lives-Tests).

**Frontend (rewrite):**
- `widgets/pubg/session-report.html` — komplette md-Suite ersetzen (Tasks 5-15 aus v1-Plan). Markup, CSS, JS aller `md*`-Funktionen neu.

Keine neuen Files. Kein Frontend-Test-Framework — manuelle Smoke pro Task.

---

## Phase 1: Backend — Lives-Model

### Task 1: Tests für lives[]-Struktur (alle Cases)

**Files:**
- Modify: `tests/pubg/test_match_detail.py`

- [ ] **Step 1: Replace existing tests with lives-aware variants**

Open `tests/pubg/test_match_detail.py`. Keep `_setup`/`_basic_match` helpers (already imported). REPLACE both existing test functions (`test_path_includes_timestamps`, `test_member_kills_includes_actor_and_victim_coords`) with these 4 new tests:

```python
def test_lives_single_life_wraps_landing_and_death(tmp_db_path):
    """Standard-Match (1 Leben): lives[0] enthaelt Landing+Death+Kills."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        # Plane-Cruise erreicht (z>=150000) bei ts=5000
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Landing bei ts=60000
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Position danach
        {"event_type": "Position", "timestamp_ms": 120000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 210000.0, "actor_y": 215000.0, "actor_z": 80.0,
         "actor_health": 90.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Kill durch Member
        {"event_type": "Kill", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": "account.ENEMY1",
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 251000.0, "victim_y": 260500.0,
         "weapon": "WeapHK416_C", "distance": 1500.0, "damage": 100.0,
         "payload_json": None},
        # Death des Members
        {"event_type": "Kill", "timestamp_ms": 700000,
         "actor_account": "account.ENEMY2", "target_account": "account.A",
         "actor_x": 290000.0, "actor_y": 295000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 290500.0, "victim_y": 295200.0,
         "weapon": "WeapBerylM762_C", "distance": 800.0, "damage": 95.0,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert "lives" in me, "members[].lives field fehlt"
    assert len(me["lives"]) == 1
    life = me["lives"][0]
    assert life["lifeIndex"] == 1
    # Landing
    assert life["landing"]["x"] == 200000.0
    assert life["landing"]["y"] == 200000.0
    assert life["landing"]["tsMs"] == 60000
    # Death
    assert life["death"] is not None
    assert life["death"]["x"] == 290500.0  # victim coords
    assert life["death"]["y"] == 295200.0
    assert life["death"]["weaponId"] == "WeapBerylM762_C"
    assert life["death"]["weaponName"] == "Beryl"  # via _weapon_label
    assert life["death"]["distanceM"] == 8.0  # 800cm / 100
    # Kills in diesem Leben
    assert len(life["kills"]) == 1
    assert life["kills"][0]["actorX"] == 250000.0
    assert life["kills"][0]["victimX"] == 251000.0
    # Pfade
    assert len(life["planeRoute"]) >= 1
    # planeRoute geht von cruise+3s (=8000ms) bis Landing (60000ms)
    for pt in life["planeRoute"]:
        assert pt[2] >= 8000 and pt[2] <= 60000
    # groundPath von Landing (60000) bis Death (700000)
    assert len(life["groundPath"]) >= 1
    for pt in life["groundPath"]:
        assert pt[2] >= 60000 and pt[2] <= 700000


def test_lives_survival_has_no_death(tmp_db_path):
    """Member ueberlebt: lives[0].death == None."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 600000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 80.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert len(me["lives"]) == 1
    assert me["lives"][0]["death"] is None


def test_lives_comeback_creates_two_lives(tmp_db_path):
    """Comeback-Modus: nach Death im selben Match wieder Plane+Landing.
    lives[0] = erstes Leben (mit Death), lives[1] = zweites Leben."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        # Leben 1: Plane → Landing → Death
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Kill", "timestamp_ms": 400000,
         "actor_account": "account.ENEMY1", "target_account": "account.A",
         "actor_x": 220000.0, "actor_y": 220000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 220500.0, "victim_y": 220500.0,
         "weapon": "WeapHK416_C", "distance": 500.0, "damage": 100.0,
         "payload_json": None},
        # Comeback: Leben 2 — neue Plane-Cruise + Landing
        {"event_type": "Position", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 300000.0, "actor_y": 300000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 550000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 400000.0, "actor_y": 400000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 700000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 410000.0, "actor_y": 410000.0, "actor_z": 100.0,
         "actor_health": 70.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert len(me["lives"]) == 2, f"Erwarte 2 Lives, bekommen {len(me['lives'])}"
    l1, l2 = me["lives"]
    assert l1["lifeIndex"] == 1 and l2["lifeIndex"] == 2
    # Leben 1: Death bei 400000
    assert l1["death"] is not None
    assert l1["death"]["tsMs"] == 400000
    # Leben 2: Landing bei 550000, kein Death (survived)
    assert l2["landing"]["tsMs"] == 550000
    assert l2["death"] is None


def test_path_timestamps_inside_lives(tmp_db_path):
    """Pfade in lives[].planeRoute und lives[].groundPath sind
    [x, y, ts_ms] 3-Tupel und chronologisch sortiert."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 30000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 150000.0, "actor_y": 150000.0, "actor_z": 100000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 120000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 210000.0, "actor_y": 210000.0, "actor_z": 80.0,
         "actor_health": 90.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    life = me["lives"][0]
    for pt in life["planeRoute"]:
        assert len(pt) == 3
        assert isinstance(pt[2], int)
    for pt in life["groundPath"]:
        assert len(pt) == 3
        assert isinstance(pt[2], int)
    pr_ts = [pt[2] for pt in life["planeRoute"]]
    gp_ts = [pt[2] for pt in life["groundPath"]]
    assert pr_ts == sorted(pr_ts)
    assert gp_ts == sorted(gp_ts)
```

- [ ] **Step 2: Run tests, verify all FAIL**

Run: `python -m pytest tests/pubg/test_match_detail.py -v`
Expected: 4 FAILS (some with `KeyError: 'lives'`, others with `assert 0 == 2`).

- [ ] **Step 3: Commit (RED stage)**

```bash
git add tests/pubg/test_match_detail.py
git commit -m "test(match-detail-v2): lives[]-Struktur + Comeback + Survival + Pfad-Timestamps"
```

---

### Task 2: Backend — compute_match_detail rewrite mit lives[]

**Files:**
- Modify: `pubg/aggregations.py` — `compute_match_detail` function (lines ~880-1130).

- [ ] **Step 1: Replace compute_match_detail with v2 implementation**

In `pubg/aggregations.py`, locate `def compute_match_detail(conn, my_account_id, match_id):` and replace the ENTIRE function body with this v2 version. Helper `_weapon_label` already exists (used as before).

```python
def compute_match_detail(conn, my_account_id, match_id):
    """v2: liefert pro Member ein lives[]-Array. Jedes Leben hat
    planeRoute, landing, groundPath, death (oder None), kills.
    Comeback-Detection ueber Telemetry-Split an Kill-target=member.

    Returns dict:
      {
        "matchId": ..., "mapName": ...,
        "members": [
          {
            "accountId", "name", "isSelf",
            "lives": [
              {
                "lifeIndex": 1, "planeRoute": [[x,y,ts], ...],
                "landing": {"x", "y", "tsMs"},
                "groundPath": [[x,y,ts], ...],
                "death": {"x", "y", "tsMs", "killerName", "weaponId",
                          "weaponName", "distanceM"} | None,
                "kills": [{"actorX", "actorY", "victimX", "victimY",
                            "tsMs", "weapon", "victimName"}, ...]
              },
              ...
            ],
            "revivePts": [[x, y, tsMs], ...]
          }, ...
        ]
      }
    """
    m_row = conn.execute(
        "SELECT match_id, map_name, played_at FROM matches WHERE match_id = ?",
        (match_id,)).fetchone()
    if not m_row:
        return None
    map_name = m_row["map_name"]
    match_start_ms = None
    if m_row["played_at"]:
        try:
            import datetime as _dt
            start_dt = _dt.datetime.fromisoformat(
                m_row["played_at"].replace("Z", "+00:00"))
            match_start_ms = int(start_dt.timestamp() * 1000)
        except Exception:
            pass

    # Squad-Mitglieder
    team_row = conn.execute(
        "SELECT team_id FROM match_team_mapping "
        "WHERE match_id = ? AND account_id = ?",
        (match_id, my_account_id)).fetchone()
    if not team_row:
        return {"matchId": match_id, "mapName": map_name, "members": []}
    members_rows = conn.execute("""
        SELECT mtm.account_id, p.name
        FROM match_team_mapping mtm
        LEFT JOIN players p ON p.account_id = mtm.account_id
        WHERE mtm.match_id = ? AND mtm.team_id = ?
    """, (match_id, team_row["team_id"])).fetchall()

    out_members = []
    for mem in members_rows:
        acc = mem["account_id"]
        if not acc:
            continue
        # Alle relevanten Events des Members chronologisch
        ev_rows = conn.execute("""
            SELECT event_type, timestamp_ms, actor_x, actor_y, actor_z,
                   actor_health, target_account, victim_x, victim_y,
                   weapon, distance, actor_account
            FROM telemetry_events
            WHERE match_id = ?
              AND (actor_account = ? OR target_account = ?)
              AND timestamp_ms IS NOT NULL
            ORDER BY timestamp_ms ASC
        """, (match_id, acc, acc)).fetchall()

        # Death-Events isolieren (Kill mit target=acc)
        death_events = [e for e in ev_rows
                        if e["event_type"] == "Kill" and e["target_account"] == acc]
        # Lives-Splitting: jedes Leben endet entweder mit einem death_event
        # oder dem Match-Ende. Pro Death suchen wir die Cruise-Phase davor
        # als Start des Lebens.
        live_segments = []
        last_death_ts = None
        for de in death_events:
            seg_start_ts = last_death_ts if last_death_ts is not None else 0
            live_segments.append((seg_start_ts, de["timestamp_ms"], de))
            last_death_ts = de["timestamp_ms"]
        # Letztes Segment ohne Death (Survival oder Match-Ende)
        live_segments.append((
            last_death_ts if last_death_ts is not None else 0,
            10**15,  # Match-Ende-Sentinel
            None
        ))

        lives = []
        for life_idx, (seg_start, seg_end, death_ev) in enumerate(live_segments, 1):
            # Plane-Cruise-Start fuer dieses Leben: erstes Event ab seg_start
            # mit z>=150000 (Plane-Cruise)
            cruise_ts = None
            for e in ev_rows:
                ts = e["timestamp_ms"]
                if ts < seg_start: continue
                if ts > seg_end: break
                if e["actor_account"] != acc: continue
                z = e["actor_z"]
                if z is not None and z >= 150000:
                    cruise_ts = ts
                    break
            if cruise_ts is None:
                # Kein Cruise gefunden — Leben hat evtl. nur Death (Edge),
                # skip dieses Segment damit lives nicht mit "leeren" Eintraegen
                # gefuellt wird. Ausnahme: lifeIndex==1 + erstes Leben → trotzdem
                # einen leeren Stub liefern damit Frontend rendern kann.
                if life_idx == 1 and not lives:
                    lives.append({
                        "lifeIndex": 1, "planeRoute": [],
                        "landing": None, "groundPath": [],
                        "death": None, "kills": [],
                    })
                continue
            path_start_ms = cruise_ts + 3000

            # Landing-Event in diesem Leben (erstes Landing nach cruise_ts)
            landing_ev = next((
                e for e in ev_rows
                if e["event_type"] == "Landing"
                and e["actor_account"] == acc
                and e["timestamp_ms"] >= cruise_ts
                and e["timestamp_ms"] <= seg_end
                and e["actor_x"] is not None
            ), None)
            landing = None
            if landing_ev:
                landing = {
                    "x": landing_ev["actor_x"],
                    "y": landing_ev["actor_y"],
                    "tsMs": landing_ev["timestamp_ms"],
                }
            landing_ts = landing["tsMs"] if landing else cruise_ts

            # planeRoute: ab path_start_ms bis landing_ts (inkl.)
            plane_route = [
                [e["actor_x"], e["actor_y"], e["timestamp_ms"]]
                for e in ev_rows
                if e["actor_account"] == acc
                and e["event_type"] in ("Position", "Landing",
                                         "VehicleEnter", "VehicleLeave")
                and e["actor_x"] is not None
                and e["timestamp_ms"] >= path_start_ms
                and e["timestamp_ms"] <= landing_ts
            ]

            # groundPath: nach landing_ts bis seg_end (oder death_ev.ts)
            path_end = death_ev["timestamp_ms"] if death_ev else seg_end
            ground_path = [
                [e["actor_x"], e["actor_y"], e["timestamp_ms"]]
                for e in ev_rows
                if e["actor_account"] == acc
                and e["event_type"] in ("Position", "Landing",
                                         "VehicleEnter", "VehicleLeave")
                and e["actor_x"] is not None
                and e["timestamp_ms"] > landing_ts
                and e["timestamp_ms"] <= path_end
            ]

            # Kills die der Member in diesem Leben gemacht hat
            life_kills = []
            for e in ev_rows:
                if e["event_type"] != "Kill": continue
                if e["actor_account"] != acc: continue
                if e["target_account"] == acc: continue  # eigener death
                if e["timestamp_ms"] < cruise_ts or e["timestamp_ms"] > seg_end:
                    continue
                # Victim-Name nachschlagen (players + participants)
                vrow = conn.execute("""
                    SELECT COALESCE(p.name, pa.name) AS n
                    FROM (SELECT NULL) x
                    LEFT JOIN players p ON p.account_id = ?
                    LEFT JOIN participants pa ON pa.match_id = ?
                          AND pa.account_id = ?
                """, (e["target_account"], match_id, e["target_account"])).fetchone()
                life_kills.append({
                    "actorX":  e["actor_x"],
                    "actorY":  e["actor_y"],
                    "victimX": e["victim_x"],
                    "victimY": e["victim_y"],
                    "tsMs":    e["timestamp_ms"],
                    "weapon":  e["weapon"],
                    "victimName": vrow["n"] if vrow else None,
                })

            # Death-Detail
            death_info = None
            if death_ev:
                wid = death_ev["weapon"]
                weapon_name = _weapon_label(wid)[0] if wid else None
                # Killer-Name analog
                kn = None
                if death_ev["actor_account"]:
                    krow = conn.execute("""
                        SELECT COALESCE(p.name, pa.name) AS n
                        FROM (SELECT NULL) x
                        LEFT JOIN players p ON p.account_id = ?
                        LEFT JOIN participants pa ON pa.match_id = ?
                              AND pa.account_id = ?
                    """, (death_ev["actor_account"], match_id,
                          death_ev["actor_account"])).fetchone()
                    kn = krow["n"] if krow else None
                death_info = {
                    "x":           death_ev["victim_x"],
                    "y":           death_ev["victim_y"],
                    "tsMs":        death_ev["timestamp_ms"],
                    "killerName":  kn,
                    "weaponId":    wid,
                    "weaponName":  weapon_name,
                    "distanceM":   (round((death_ev["distance"] or 0) / 100.0, 1)
                                    if death_ev["distance"] else None),
                }

            lives.append({
                "lifeIndex":  life_idx,
                "planeRoute": plane_route,
                "landing":    landing,
                "groundPath": ground_path,
                "death":      death_info,
                "kills":      life_kills,
            })

        # Revive-Pts (innerhalb von DBNO-Revives, separat von Comeback)
        revive_rows = conn.execute("""
            SELECT actor_x, actor_y, timestamp_ms
            FROM telemetry_events
            WHERE match_id = ? AND target_account = ?
              AND event_type = 'Revive'
              AND actor_x IS NOT NULL
            ORDER BY timestamp_ms ASC
        """, (match_id, acc)).fetchall()
        revive_pts = [[r["actor_x"], r["actor_y"], r["timestamp_ms"]]
                       for r in revive_rows]

        out_members.append({
            "accountId": acc,
            "name":      mem["name"] or acc[:8],
            "isSelf":    (acc == my_account_id),
            "lives":     lives,
            "revivePts": revive_pts,
        })

    out_members.sort(key=lambda x: (0 if x["isSelf"] else 1, x["name"].lower()))
    return {
        "matchId": match_id,
        "mapName": map_name,
        "members": out_members,
    }
```

- [ ] **Step 2: Run tests, all 4 PASS**

Run: `python -m pytest tests/pubg/test_match_detail.py -v`
Expected: 4 PASS.

- [ ] **Step 3: Run full backend suite — keine Regression**

Run: `python -m pytest tests/pubg/ -v 2>&1 | tail -10`
Expected: nur das bekannte `test_first_fight_rate_aggregates`-Failing (vor v2 schon broken).

- [ ] **Step 4: Commit**

```bash
git add pubg/aggregations.py
git commit -m "feat(match-detail-v2): compute_match_detail liefert lives[]-Struktur mit Comeback-Support"
```

---

## Phase 2: Frontend — Cleanup + CSS v2

### Task 3: Remove v1 frontend code + add new CSS

**Files:**
- Modify: `widgets/pubg/session-report.html` (CSS block + JS block)

- [ ] **Step 1: Identify v1 code blocks via grep**

```bash
grep -n "mdRenderBasemap\|mdRenderOverlay\|mdRenderCards\|mdRenderState\|mdMount\|mdPlay\|mdPathPointAt\|mdInterp\|mdGetState\|mdEffectiveFocus\|_mdState\|_mdCache\|_mdImgCache\|mdLoad\|mdMapImage\|mdApplyPinCal\|MD_COLORS\|MD_ANIM_DURATION_MS\|MD_REVIVE_FLASH_MS" widgets/pubg/session-report.html | head -30
```
Note line ranges of all v1 md-* function definitions.

```bash
grep -n "\.md-host\|\.md-grid\|\.md-mapwrap\|\.md-tools\|\.md-cards\|\.md-card\|\.md-empty" widgets/pubg/session-report.html | head -30
```
Note CSS blocks.

- [ ] **Step 2: Delete v1 CSS and JS, keep markup placeholder**

Delete from `<style>`:
- All `.md-host`, `.md-grid`, `.md-mapwrap`, `.md-mapwrap canvas`, `.md-mapwrap .md-tools`, `.md-tools button`, `.md-cards`, `.md-card`, `.md-card.active`, `.md-card .md-head`, `.md-card .md-dot`, `.md-card .md-name`, `.md-card.md-self`, `.md-card .md-badge`, `.md-card .md-row`, `.md-card .md-deathby`, `.md-card .md-empty` Regeln.

Delete from `<script>`:
- `MD_COLORS`, `_mdCache`, `mdLoad`, `_mdImgCache`, `mdMapImage`, `mdApplyPinCal`, `mdRenderBasemap`, `mdRenderOverlay`, `mdRenderCards`, `_mdState`, `mdGetState`, `mdEffectiveFocus`, `mdRenderState`, `mdMount`, `MD_ANIM_DURATION_MS`, `MD_REVIVE_FLASH_MS`, `mdPathPointAt`, `mdInterp`, `mdPlay`.
- All `document.addEventListener` blocks that reference `.md-card`, `.md-host`, `.md-mapwrap`, `.md-play`, `.md-toggle[data-toggle=kills]`, ESC-handler with `.md-host[data-mounted]`.

Keep:
- `fmtSquadDetail` returning `<div class="md-host" data-match-id="..." data-map="..."></div>` (unchanged).
- Match-row-click handler — empty body where `mdMount` was called.

After deletes verify with grep — 0 hits expected.

- [ ] **Step 3: Add new v2 CSS**

In the `<style>` section add (near where v1 CSS was):

```css
/* Match-Detail v2 — Two-Canvas 300x300 + Scrub-Bar + Cards-Col */
.md-host {
  flex: none;
  width: 100%;
}
.md-grid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 14px;
  align-items: start;
}
.md-mapcol { display: flex; flex-direction: column; gap: 6px; }
.md-mapwrap {
  position: relative;
  width: 300px; height: 300px;
  margin: 0;
  background: #0d061a;
  border: 1px solid var(--pubg-border);
  border-radius: 6px;
  overflow: hidden;
  user-select: none;
}
.md-mapwrap canvas {
  position: absolute; inset: 0;
  width: 300px; height: 300px; display: block;
}
.md-mapwrap canvas.md-overlay { pointer-events: none; }
.md-mapwrap .md-zoombtns {
  position: absolute; top: 6px; right: 6px;
  display: flex; flex-direction: column; gap: 3px;
  z-index: 5;
}
.md-zoombtns button {
  width: 22px; height: 22px;
  background: rgba(13,6,26,0.85);
  border: 1px solid var(--pubg-border);
  color: var(--pubg-gold);
  font-size: 13px; line-height: 18px; text-align: center;
  border-radius: 3px; cursor: pointer; padding: 0;
}
.md-zoombtns button:hover { border-color: var(--pubg-gold); }
.md-mapwrap .md-hover-label {
  position: absolute;
  background: rgba(13,6,26,0.92);
  color: var(--pubg-gold);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.78em;
  pointer-events: none;
  white-space: nowrap;
  z-index: 6;
  display: none;
}
.md-mapwrap .md-hover-label.show { display: block; }
/* Scrub-Bar */
.md-scrub {
  display: flex; gap: 6px; align-items: center;
  padding: 4px 6px;
  background: rgba(13,6,26,0.55);
  border: 1px solid var(--pubg-border);
  border-radius: 4px;
  font-size: 0.8em;
  color: var(--pubg-muted);
}
.md-scrub button {
  background: rgba(242,183,5,0.12);
  border: 1px solid rgba(242,183,5,0.4);
  color: var(--pubg-gold);
  padding: 2px 8px;
  border-radius: 3px;
  font-family: inherit; cursor: pointer; font-size: 0.95em;
}
.md-scrub button:hover { background: rgba(242,183,5,0.22); }
.md-scrub input[type=range] {
  flex: 1; cursor: pointer;
  accent-color: var(--pubg-gold);
}
.md-scrub .md-time {
  font-variant-numeric: tabular-nums;
  min-width: 90px; text-align: right;
  color: var(--pubg-text);
}
/* Cards-Col */
.md-cardcol { display: flex; flex-direction: column; gap: 8px; }
.md-allebar {
  display: flex; align-items: center; gap: 8px;
}
.md-allebtn {
  background: rgba(242,183,5,0.16);
  border: 1px solid var(--pubg-gold);
  color: var(--pubg-gold);
  padding: 5px 14px;
  border-radius: 4px;
  font-family: inherit; font-weight: 700;
  font-size: 0.9em; cursor: pointer;
}
.md-allebtn:hover { background: var(--pubg-gold); color: #1a0d2a; }
.md-allebtn.solo-active { background: var(--pubg-gold); color: #1a0d2a; }
.md-cards { display: flex; flex-direction: column; gap: 6px; }
.md-card {
  background: rgba(94,42,121,0.18);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 0.9em;
  line-height: 1.45;
  color: var(--pubg-text);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.md-card:hover { background: rgba(255,255,255,0.04); }
.md-card.active {
  background: rgba(242,183,5,0.08);
  border-color: var(--pubg-gold);
}
.md-card .md-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 4px;
}
.md-card .md-dot {
  width: 11px; height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.4);
  flex-shrink: 0;
}
.md-card .md-name { font-weight: 700; }
.md-card.md-self .md-name { color: var(--pubg-gold); }
.md-card .md-badge {
  margin-left: auto; padding: 1px 6px;
  background: rgba(0,0,0,0.3);
  font-size: 0.82em; border-radius: 3px;
  color: var(--pubg-muted);
}
.md-card .md-badge.alive { color: var(--pubg-gold); }
.md-card .md-badge.died  { color: #e57b7b; }
.md-card .md-life { padding-left: 4px; font-size: 0.93em; color: var(--pubg-muted); }
.md-card .md-life b { color: var(--pubg-text); }
.md-card .md-life .md-died { color: #e57b7b; }
.md-card .md-empty { font-style: italic; opacity: 0.6; }
```

- [ ] **Step 4: JS syntax check + commit**

```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('widgets/pubg/session-report.html','utf8');
const m = [...c.matchAll(/<script(?:[^>]*)>([\\s\\S]*?)<\\/script>/g)];
const last = m.filter(x => x[1] && x[1].trim()).pop();
try { new Function(last[1]); console.log('OK'); } catch(e){ console.log('FAIL',e.message); }
"
```

```bash
git add widgets/pubg/session-report.html
git commit -m "refactor(match-detail): v1 entfernt + v2 CSS (300px Map + Scrub-Bar + Cards-Col)"
```

---

## Phase 3: Frontend — Helpers + Viewport + Basemap

### Task 4: Add md helpers + viewport state

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add helpers at top of `<script>` after FROM/TO consts**

```javascript
// ── Match-Detail v2 Globals ──────────────────────────────────────────
const MD_COLORS = [
  "#f2b705", "#e74c3c", "#3498db", "#2ecc71",
  "#ff7a1f", "#9b59b6", "#1abc9c", "#ec407a",
];
const MD_MAP_PX = 300;
const MD_PAD_500M_CM = 50000;   // 500m padding fuer Default-Bbox
const MD_MIN_ZOOM_CM = 5000;    // 50m minimal sichtbarer Radius
const MD_MAX_ZOOM_CM = 800000;  // 8km — ganze Map default Erangel-Range
const MD_ANIM_DURATION_MS = 15000;

// Cache fuer match-detail responses
const _mdCache = new Map();
async function mdLoad(matchId) {
  if (!matchId) return null;
  if (_mdCache.has(matchId)) return _mdCache.get(matchId);
  let d = null;
  try {
    d = await PubgUI.fetchJson(
      `/api/pubg/match-detail?matchId=${encodeURIComponent(matchId)}`);
  } catch (e) { console.warn("mdLoad failed", matchId, e); }
  const colorByAcc = {};
  if (d && d.members) {
    d.members.forEach((m, i) => {
      colorByAcc[m.accountId] = MD_COLORS[i % MD_COLORS.length];
    });
  }
  const cached = { detail: d, colorByAcc };
  _mdCache.set(matchId, cached);
  return cached;
}

// Map-Image-Cache mit .png/.webp Fallback
const _mdImgCache = new Map();
function mdMapImage(mapName) {
  if (!mapName) return Promise.resolve(null);
  if (_mdImgCache.has(mapName)) return _mdImgCache.get(mapName);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => res(img2);
      img2.onerror = () => res(null);
      img2.src = `/widgets/pubg/maps/${mapName}.webp`;
    };
    img.src = `/widgets/pubg/maps/${mapName}.png`;
  });
  _mdImgCache.set(mapName, p);
  return p;
}

// Pin-Calibration (identisch poi-editor.html)
function mdApplyPinCal(xCm, yCm, mapKm, cal) {
  if (!cal) return [xCm, yCm];
  const mc = mapKm * 100000 / 2;
  let x = xCm, y = yCm;
  if (cal.flipX) x = 2 * mc - x;
  if (cal.flipY) y = 2 * mc - y;
  const rot = ((cal.rotate || 0) % 360 + 360) % 360;
  if (rot !== 0) {
    const dx = x - mc, dy = y - mc;
    if (rot === 90)  { x = mc - dy; y = mc + dx; }
    if (rot === 180) { x = mc - dx; y = mc - dy; }
    if (rot === 270) { x = mc + dy; y = mc - dx; }
  }
  const ex = (x - mc) * (cal.scaleX || 1) + mc + (cal.offsetX || 0);
  const ey = (y - mc) * (cal.scaleY || 1) + mc + (cal.offsetY || 0);
  return [ex, ey];
}

// State pro Host (DOM-Element) als WeakMap
const _mdState = new WeakMap();
function mdGetState(host) {
  let s = _mdState.get(host);
  if (!s) {
    s = {
      detail: null,           // match-detail-response
      colorByAcc: {},
      soloAcc: null,
      viewport: null,          // {centerX, centerY, zoom, autoFollow}
      zeitraffer: {            // cursorTs in ms relativ zu matchStart
        cursorTs: 0, playing: false,
        playStartWallTs: 0, playStartCursor: 0,
        matchStart: 0, matchEnd: 0,
      },
      hoveredMarker: null,
      playToken: 0,
      dragPan: null,            // {startX, startY, startCenterX, startCenterY}
    };
    _mdState.set(host, s);
  }
  return s;
}

// Cm-zu-Canvas-Pixel umrechnen anhand Viewport + Calibration
function mdCmToCanvas(host, xCm, yCm) {
  const s = mdGetState(host);
  const vp = s.viewport;
  if (!vp) return [0, 0];
  const mapKm = parseFloat(host.dataset.mapKm) || 8;
  let cal = {};
  try { cal = JSON.parse(host.dataset.cal || "{}"); } catch (e) {}
  const [ex, ey] = mdApplyPinCal(xCm, yCm, mapKm, cal);
  // Viewport.zoom = Pixel pro cm
  const px = (MD_MAP_PX / 2) + (ex - vp.centerX) * vp.zoom;
  const py = (MD_MAP_PX / 2) + (ey - vp.centerY) * vp.zoom;
  return [px, py];
}

// Inverse: Canvas-Pixel → cm (fuer Click-Hit-Testing)
function mdCanvasToCm(host, px, py) {
  const s = mdGetState(host);
  const vp = s.viewport;
  if (!vp) return [0, 0];
  return [
    vp.centerX + (px - MD_MAP_PX / 2) / vp.zoom,
    vp.centerY + (py - MD_MAP_PX / 2) / vp.zoom,
  ];
}

// Bbox aus Liste von [x, y] cm-Coords + Padding
function mdBboxFitViewport(coords, paddingCm) {
  if (!coords.length) {
    return { centerX: 400000, centerY: 400000, zoom: MD_MAP_PX / 800000,
              autoFollow: true };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of coords) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = Math.max(MD_PAD_500M_CM * 2,
                      (x1 - x0) + 2 * paddingCm,
                      (y1 - y0) + 2 * paddingCm);
  return {
    centerX: cx, centerY: cy,
    zoom: MD_MAP_PX / w,
    autoFollow: true,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): Helpers + Viewport-State + Bbox-Fit"
```

---

### Task 5: mdRenderBasemap v2

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add renderBasemap function**

Append after Task 4 helpers:

```javascript
async function mdRenderBasemap(host) {
  const canvas = host.querySelector("canvas.md-basemap");
  if (!canvas) return;
  const mapName = host.getAttribute("data-map");
  const blob = (window._poiData || {})[mapName] || {};
  const mapKm = blob.mapKm || 8;
  const cal = blob.pinCalibration || {};
  host.dataset.mapKm = mapKm;
  host.dataset.cal = JSON.stringify(cal);

  canvas.width = MD_MAP_PX; canvas.height = MD_MAP_PX;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d061a";
  ctx.fillRect(0, 0, MD_MAP_PX, MD_MAP_PX);

  const img = await mdMapImage(mapName);
  if (!img || !img.naturalWidth) return;

  const s = mdGetState(host);
  const vp = s.viewport;
  if (!vp) return;

  // Quell-Region berechnen: Viewport in Map-cm → in Bild-pixel
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const cropOffX = (img.naturalWidth  - side) / 2;
  const cropOffY = (img.naturalHeight - side) / 2;
  const mapCm = mapKm * 100000;

  // Welche cm-Region wollen wir zeichnen? Viewport: centerX +/- (150/zoom) cm
  const halfVisibleCm = (MD_MAP_PX / 2) / vp.zoom;
  let cmX0 = vp.centerX - halfVisibleCm;
  let cmY0 = vp.centerY - halfVisibleCm;
  let cmX1 = vp.centerX + halfVisibleCm;
  let cmY1 = vp.centerY + halfVisibleCm;

  // cm → Bild-Pixel: (cm / mapCm) * side + cropOff
  function cmToImg(cm, axis) {
    return (cm / mapCm) * side + (axis === "x" ? cropOffX : cropOffY);
  }
  const sx = cmToImg(cmX0, "x");
  const sy = cmToImg(cmY0, "y");
  const sw = ((cmX1 - cmX0) / mapCm) * side;
  const sh = ((cmY1 - cmY0) / mapCm) * side;

  // Clamping wenn Viewport ueber Karten-Rand geht — pad mit Hintergrund
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, MD_MAP_PX, MD_MAP_PX);
}
```

- [ ] **Step 2: JS syntax check + commit**

```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('widgets/pubg/session-report.html','utf8');
const m = [...c.matchAll(/<script(?:[^>]*)>([\\s\\S]*?)<\\/script>/g)];
const last = m.filter(x => x[1] && x[1].trim()).pop();
try { new Function(last[1]); console.log('OK'); } catch(e){ console.log('FAIL',e.message); }
"
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): mdRenderBasemap mit Viewport-Crop"
```

---

### Task 6: mdRenderOverlay (default-view: planeRoute + landings only)

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add renderOverlay default-mode**

Append after `mdRenderBasemap`:

```javascript
function mdRenderOverlay(host) {
  const canvas = host.querySelector("canvas.md-overlay");
  if (!canvas) return;
  canvas.width = MD_MAP_PX; canvas.height = MD_MAP_PX;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, MD_MAP_PX, MD_MAP_PX);

  const s = mdGetState(host);
  if (!s.detail || !s.detail.members) return;
  const cursorTs = s.zeitraffer.cursorTs;
  const matchStart = s.zeitraffer.matchStart;
  const absTs = matchStart + cursorTs;
  const soloAcc = s.soloAcc;

  // Members filtern fuer Solo-Mode
  const visibleMembers = soloAcc
    ? s.detail.members.filter(m => m.accountId === soloAcc)
    : s.detail.members;

  for (const m of visibleMembers) {
    const color = s.colorByAcc[m.accountId] || "#999";
    if (!m.lives) continue;
    for (const life of m.lives) {
      // PlaneRoute: gestrichelt, nur sichtbar wenn relevant fuer aktuellen
      // Cursor (oder Default-View bei cursor=0)
      const planeStartTs = life.planeRoute.length
        ? life.planeRoute[0][2] : null;
      const landingTs = life.landing ? life.landing.tsMs : null;
      // Default-View (cursor=0) zeigt planeRoute komplett + Landing-Pin
      const inDefault = (cursorTs === 0);
      const showPlaneRoute = inDefault
        || (landingTs && absTs <= landingTs && planeStartTs && absTs >= planeStartTs);
      if (showPlaneRoute && life.planeRoute.length >= 2) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        life.planeRoute.forEach(([xCm, yCm], i) => {
          const [cx, cy] = mdCmToCanvas(host, xCm, yCm);
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Landing-Pin (sobald cursor >= landing-ts oder im Default)
      const showLanding = inDefault
        || (landingTs && absTs >= landingTs);
      if (showLanding && life.landing) {
        const [cx, cy] = mdCmToCanvas(host, life.landing.x, life.landing.y);
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }

      // groundPath als Trail bis cursor (nicht im Default-View)
      if (!inDefault && landingTs && life.groundPath.length >= 2) {
        const trailEnd = life.death
          ? Math.min(absTs, life.death.tsMs)
          : absTs;
        if (trailEnd > landingTs) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < life.groundPath.length; i++) {
            const [xCm, yCm, ts] = life.groundPath[i];
            if (ts > trailEnd) break;
            const [cx, cy] = mdCmToCanvas(host, xCm, yCm);
            if (!started) { ctx.moveTo(cx, cy); started = true; }
            else { ctx.lineTo(cx, cy); }
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Death-Pin (sobald cursor >= death-ts)
      if (!inDefault && life.death && absTs >= life.death.tsMs) {
        const [cx, cy] = mdCmToCanvas(host, life.death.x, life.death.y);
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Kill-Marker (sobald cursor >= kill-ts)
      if (!inDefault) {
        for (const k of life.kills) {
          if (absTs < k.tsMs) continue;
          if (k.actorX == null || k.victimX == null) continue;
          const [ax, ay] = mdCmToCanvas(host, k.actorX, k.actorY);
          const [vx, vy] = mdCmToCanvas(host, k.victimX, k.victimY);
          // Verbindungslinie
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(ax, ay); ctx.lineTo(vx, vy);
          ctx.stroke();
          ctx.globalAlpha = 1;
          // Schuetze-Punkt
          ctx.beginPath();
          ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          // Opfer-Punkt (grau)
          ctx.beginPath();
          ctx.arc(vx, vy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#bbb";
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.lineWidth = 0.4;
          ctx.stroke();
        }
      }
    }

    // Revive-Pins (nur bis cursor erreicht)
    if (m.revivePts) {
      for (const [xCm, yCm, ts] of m.revivePts) {
        if (!inDefault && absTs < ts) continue;
        const [cx, cy] = mdCmToCanvas(host, xCm, yCm);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#2ecc71";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    // Aktiver Zeitraffer-Pin (interpolated Position)
    if (!inDefault && s.zeitraffer.playing || (!inDefault && cursorTs > 0)) {
      const activePin = mdInterpolatePin(m, absTs);
      if (activePin) {
        const [cx, cy] = mdCmToCanvas(host, activePin.x, activePin.y);
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}

// Liefert {x, y} fuer Member m zum Absolut-Timestamp absTs
// durch Interpolation im aktuellen Leben.
function mdInterpolatePin(m, absTs) {
  if (!m.lives) return null;
  for (const life of m.lives) {
    if (!life.landing) continue;
    if (life.death && absTs > life.death.tsMs) continue;
    const fullPath = [...(life.planeRoute || []), ...(life.groundPath || [])];
    if (fullPath.length < 2) {
      if (life.landing) return { x: life.landing.x, y: life.landing.y };
      continue;
    }
    if (absTs < fullPath[0][2]) return null;
    // Bisect
    for (let i = 0; i < fullPath.length - 1; i++) {
      const [x0, y0, t0] = fullPath[i];
      const [x1, y1, t1] = fullPath[i + 1];
      if (absTs >= t0 && absTs <= t1) {
        const f = (absTs - t0) / Math.max(1, (t1 - t0));
        return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f };
      }
    }
    const last = fullPath[fullPath.length - 1];
    return { x: last[0], y: last[1] };
  }
  return null;
}
```

- [ ] **Step 2: JS syntax + commit**

```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('widgets/pubg/session-report.html','utf8');
const m = [...c.matchAll(/<script(?:[^>]*)>([\\s\\S]*?)<\\/script>/g)];
const last = m.filter(x => x[1] && x[1].trim()).pop();
try { new Function(last[1]); console.log('OK'); } catch(e){ console.log('FAIL',e.message); }
"
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): mdRenderOverlay mit Default-View + Zeitraffer-aware Trail + Pins"
```

---

## Phase 4: Frontend — Cards + Orchestrator + Mount

### Task 7: mdRenderCards v2 (multi-lives)

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add renderCards**

Append:

```javascript
function mdRenderCards(host) {
  const wrap = host.querySelector(".md-cards");
  if (!wrap) return;
  const s = mdGetState(host);
  if (!s.detail || !s.detail.members) {
    wrap.innerHTML = "";
    return;
  }
  const soloAcc = s.soloAcc;
  function fmtMinSec(sec) {
    if (sec == null) return "?";
    const m = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${m}:${String(ss).padStart(2, "0")}`;
  }
  function poi(x, y, mapName) {
    if (x == null || y == null) return null;
    if (PubgUI.POI && PubgUI.POI.fromCoords)
      return PubgUI.POI.fromCoords(mapName, x, y);
    return null;
  }
  const mapName = host.getAttribute("data-map");
  const visible = soloAcc
    ? s.detail.members.filter(m => m.accountId === soloAcc)
    : s.detail.members;
  const html = visible.map((m) => {
    const color = s.colorByAcc[m.accountId] || "#999";
    const active = (m.accountId === soloAcc) ? " active" : "";
    const selfCls = m.isSelf ? " md-self" : "";
    const who = m.isSelf ? "Du" : m.name;
    // Overall-Badge: alive falls letztes Leben ohne Death, sonst der letzte Death
    let badge = '<span class="md-badge alive">ueberlebt</span>';
    if (m.lives && m.lives.length) {
      const last = m.lives[m.lives.length - 1];
      if (last.death) {
        const sec = Math.floor(
          (last.death.tsMs - (s.zeitraffer.matchStart || 0)) / 1000);
        badge = `<span class="md-badge died">† ${fmtMinSec(sec)}</span>`;
      }
    }
    // Lives-Detail (eine Zeile pro Leben)
    const livesHtml = (m.lives || []).map((life, idx) => {
      const prefix = m.lives.length > 1 ? `Leben ${life.lifeIndex}: ` : "";
      const landP = life.landing
        ? poi(life.landing.x, life.landing.y, mapName) : null;
      let row = `${prefix}landete <b>${landP || "?"}</b>`;
      if (life.death) {
        const deathP = poi(life.death.x, life.death.y, mapName);
        const killer = life.death.killerName || "Gegner";
        const wn = life.death.weaponName || "?";
        const dist = life.death.distanceM
          ? ` auf <b>${life.death.distanceM.toFixed(0)}m</b>` : "";
        row += ` <span class="md-died">— gestorben in <b>${deathP || "?"}</b> durch <b>${killer}</b> mit <b>${wn}</b>${dist}</span>`;
      } else if (m.lives.length > 1) {
        row += ` <span style="color:var(--pubg-gold)">— survived</span>`;
      }
      return `<div class="md-life">${row}</div>`;
    }).join("");
    return `<div class="md-card${active}${selfCls}" data-acc="${m.accountId}">
      <div class="md-head">
        <span class="md-dot" style="background:${color}"></span>
        <span class="md-name">${who}</span>
        ${badge}
      </div>
      ${livesHtml}
    </div>`;
  }).join("");
  wrap.innerHTML = html;
}
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): mdRenderCards mit Lives-Liste pro Member"
```

---

### Task 8: mdRenderState + mdMount + match-row wiring

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add orchestrator**

Append:

```javascript
function mdRenderState(host) {
  const s = mdGetState(host);
  if (!s.detail) return;
  mdRenderBasemap(host);
  mdRenderOverlay(host);
  mdRenderCards(host);
  mdUpdateScrubBar(host);
  mdUpdateAlleBar(host);
}

function mdUpdateScrubBar(host) {
  const s = mdGetState(host);
  const z = s.zeitraffer;
  const slider = host.querySelector("input.md-scrub-slider");
  const timeEl = host.querySelector(".md-scrub .md-time");
  const playBtn = host.querySelector(".md-scrub .md-play-btn");
  if (!slider || !timeEl) return;
  const dur = z.matchEnd - z.matchStart;
  slider.min = 0; slider.max = dur; slider.step = 1000;
  slider.value = z.cursorTs;
  function fmt(ms) {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
  }
  timeEl.textContent = `${fmt(z.cursorTs)} / ${fmt(dur)}`;
  if (playBtn) playBtn.textContent = z.playing ? "⏸" : "▶";
}

function mdUpdateAlleBar(host) {
  const s = mdGetState(host);
  const btn = host.querySelector(".md-allebtn");
  if (!btn) return;
  btn.classList.toggle("solo-active", !!s.soloAcc);
  btn.textContent = s.soloAcc ? "↺ Alle anzeigen" : "● Alle";
}

async function mdMount(host) {
  if (host.dataset.mounted === "1") return;
  host.dataset.mounted = "1";
  const matchId = host.getAttribute("data-match-id");
  const mapName = host.getAttribute("data-map");
  host.innerHTML = `
    <div class="md-grid">
      <div class="md-mapcol">
        <div class="md-mapwrap">
          <canvas class="md-basemap"></canvas>
          <canvas class="md-overlay"></canvas>
          <div class="md-zoombtns">
            <button class="md-zoom-in" title="Reinzoomen">+</button>
            <button class="md-zoom-out" title="Rauszoomen">−</button>
            <button class="md-zoom-reset" title="Reset">⊙</button>
          </div>
          <div class="md-hover-label"></div>
        </div>
        <div class="md-scrub">
          <button class="md-play-btn">▶</button>
          <input type="range" class="md-scrub-slider" min="0" max="100" value="0">
          <span class="md-time">0:00 / 0:00</span>
        </div>
      </div>
      <div class="md-cardcol">
        <div class="md-allebar">
          <button class="md-allebtn">● Alle</button>
        </div>
        <div class="md-cards"></div>
      </div>
    </div>`;
  const md = await mdLoad(matchId);
  const s = mdGetState(host);
  if (!md || !md.detail) {
    host.querySelector(".md-cards").innerHTML =
      `<div class="md-empty md-card">— keine Telemetrie verfuegbar —</div>`;
    return;
  }
  s.detail = md.detail;
  s.colorByAcc = md.colorByAcc;
  // Match-Zeitraum aus allen Pfaden ableiten
  let mStart = Infinity, mEnd = -Infinity;
  for (const m of s.detail.members) {
    if (!m.lives) continue;
    for (const life of m.lives) {
      const fullPath = [...(life.planeRoute||[]), ...(life.groundPath||[])];
      if (!fullPath.length) continue;
      const t0 = fullPath[0][2], tN = fullPath[fullPath.length - 1][2];
      if (t0 < mStart) mStart = t0;
      if (tN > mEnd) mEnd = tN;
    }
  }
  s.zeitraffer.matchStart = isFinite(mStart) ? mStart : 0;
  s.zeitraffer.matchEnd = isFinite(mEnd) ? mEnd : 1;
  s.zeitraffer.cursorTs = 0;

  // Viewport-Default: bbox(alle Landings) + 500m
  const landingCoords = [];
  for (const m of s.detail.members) {
    if (!m.lives) continue;
    for (const life of m.lives) {
      if (life.landing) landingCoords.push([life.landing.x, life.landing.y]);
    }
  }
  s.viewport = mdBboxFitViewport(landingCoords, MD_PAD_500M_CM);

  // Telemetrie-Pfad-Check: wenn KEIN Member einen Pfad hat (weder
  // planeRoute noch groundPath fuer irgendein Leben), zeigen wir
  // einen Hinweis statt einer halb-leeren Karte.
  let anyPath = false;
  for (const m of s.detail.members) {
    if (!m.lives) continue;
    for (const life of m.lives) {
      if ((life.planeRoute && life.planeRoute.length) ||
          (life.groundPath && life.groundPath.length)) {
        anyPath = true; break;
      }
    }
    if (anyPath) break;
  }
  if (!anyPath) {
    const banner = document.createElement("div");
    banner.className = "md-warning";
    banner.textContent = "Kein Bewegungspfad in der Telemetrie. "
      + "Eventuell historischer Match — 'python -m pubg.cli hidrive-refill' "
      + "fuellt fehlende Position-Events nach.";
    host.querySelector(".md-mapcol").appendChild(banner);
  }
  mdRenderState(host);
}
```

Plus CSS-Regel fuer den Hinweis (am Ende des CSS-Blocks aus Task 3 anhaengen):

```css
.md-warning {
  background: rgba(229,123,123,0.12);
  border: 1px solid rgba(229,123,123,0.4);
  color: #e57b7b;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.82em;
  line-height: 1.45;
}
```

- [ ] **Step 2: Wire match-row-click**

Find the existing match-row toggle click handler (search for "Click-Handler: Match-Zeile" or `.m[data-idx]`). Update the `if (!wasExpanded)` body:

```javascript
if (!wasExpanded) {
  const host = detail.querySelector(".md-host");
  if (host) mdMount(host);
}
```

And the `else` (was-expanded, now-collapsed) body:
```javascript
if (wasExpanded) {
  const host = detail.querySelector(".md-host");
  if (host && host.dataset.mounted === "1") {
    const s = mdGetState(host);
    s.playToken++;
    s.zeitraffer.playing = false;
  }
}
```

Same update in `restoreUiState` block — after `detail.classList.add("show")` add:
```javascript
const host = detail.querySelector(".md-host");
if (host) mdMount(host);
```

- [ ] **Step 3: JS syntax + commit**

```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('widgets/pubg/session-report.html','utf8');
const m = [...c.matchAll(/<script(?:[^>]*)>([\\s\\S]*?)<\\/script>/g)];
const last = m.filter(x => x[1] && x[1].trim()).pop();
try { new Function(last[1]); console.log('OK'); } catch(e){ console.log('FAIL',e.message); }
"
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): mdMount + Orchestrator + Match-Row Wiring"
```

- [ ] **Step 4: Smoke-test in browser**

Open `http://localhost:9000/widgets/pubg/session-report.html?range=week`. Expand a match.
Expected: 300x300 Map (Default-View mit Flugrouten + Landing-Pins), Scrub-Bar mit `0:00 / 0:00` oder Match-Dauer, Cards rechts mit Lives-Liste. Keine Console-Errors.

---

## Phase 5: Frontend — Scrub-Bar Interaktivität

### Task 9: Play/Pause + Slider + Step

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add play loop + slider handler**

Append after Task 8:

```javascript
function mdTogglePlay(host) {
  const s = mdGetState(host);
  const z = s.zeitraffer;
  if (z.playing) {
    z.playing = false;
    s.playToken++;
    mdRenderState(host);
    return;
  }
  z.playing = true;
  z.playStartWallTs = performance.now();
  z.playStartCursor = z.cursorTs;
  if (z.cursorTs >= z.matchEnd - z.matchStart) {
    z.cursorTs = 0;
    z.playStartCursor = 0;
  }
  const token = ++s.playToken;
  const dur = z.matchEnd - z.matchStart;
  function frame(now) {
    if (token !== s.playToken) return;
    if (host.dataset.mounted !== "1") return;
    const realElapsed = now - z.playStartWallTs;
    const scaledCursor = z.playStartCursor + realElapsed * (dur / MD_ANIM_DURATION_MS);
    z.cursorTs = Math.min(dur, scaledCursor);
    mdRenderOverlay(host);
    mdUpdateScrubBar(host);
    if (z.cursorTs < dur) {
      requestAnimationFrame(frame);
    } else {
      z.playing = false;
      mdUpdateScrubBar(host);
    }
  }
  requestAnimationFrame(frame);
}

// Slider-Input setzt cursor + pausiert
function mdScrubTo(host, cursorMs) {
  const s = mdGetState(host);
  const z = s.zeitraffer;
  z.cursorTs = Math.max(0, Math.min(z.matchEnd - z.matchStart, cursorMs));
  z.playing = false;
  s.playToken++;
  mdRenderOverlay(host);
  mdUpdateScrubBar(host);
}

// Globale Event-Delegations
document.addEventListener("click", (e) => {
  const playBtn = e.target.closest && e.target.closest(".md-play-btn");
  if (playBtn) {
    const host = playBtn.closest(".md-host");
    if (host) { mdTogglePlay(host); e.stopPropagation(); }
    return;
  }
});

document.addEventListener("input", (e) => {
  const slider = e.target.closest && e.target.closest(".md-scrub-slider");
  if (!slider) return;
  const host = slider.closest(".md-host");
  if (!host) return;
  mdScrubTo(host, parseInt(slider.value, 10) || 0);
});

document.addEventListener("keydown", (e) => {
  // Pfeil-Tasten ±1s wenn ein Match-Detail focused
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  // nicht in Inputs
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const host = document.querySelector(".md-host[data-mounted='1']");
  if (!host) return;
  const s = mdGetState(host);
  const delta = e.key === "ArrowLeft" ? -1000 : 1000;
  mdScrubTo(host, s.zeitraffer.cursorTs + delta);
  e.preventDefault();
});
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): Scrub-Bar mit Play/Pause + Slider + Pfeiltasten"
```

- [ ] **Step 3: Smoke**

Open Match-Detail. Click ▶ → cursor läuft, Pins erscheinen + Trail wächst. Click ⏸ pausiert. Slider drag verschiebt cursor live. Pfeiltasten ±1s.

---

## Phase 6: Manual Zoom + Drag-Pan

### Task 10: Scrollwheel zoom + drag-pan + reset

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add zoom/pan handlers**

Append:

```javascript
function mdZoomAt(host, deltaScale, anchorPx, anchorPy) {
  const s = mdGetState(host);
  const vp = s.viewport;
  if (!vp) return;
  // Welcher cm-Punkt liegt aktuell unter anchor?
  const [acmX, acmY] = mdCanvasToCm(host, anchorPx, anchorPy);
  // Neuer zoom
  let newZoom = vp.zoom * deltaScale;
  // Limits
  const maxZoom = MD_MAP_PX / MD_MIN_ZOOM_CM;  // tightest 50m visible
  const minZoom = MD_MAP_PX / MD_MAX_ZOOM_CM;  // ganze 8km Map
  newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
  vp.zoom = newZoom;
  // Center so dass anchor-cm-Punkt unter anchor-px bleibt
  vp.centerX = acmX - (anchorPx - MD_MAP_PX / 2) / vp.zoom;
  vp.centerY = acmY - (anchorPy - MD_MAP_PX / 2) / vp.zoom;
  vp.autoFollow = false;
  mdRenderBasemap(host);
  mdRenderOverlay(host);
}

document.addEventListener("wheel", (e) => {
  const wrap = e.target.closest && e.target.closest(".md-mapwrap");
  if (!wrap) return;
  e.preventDefault();
  const host = wrap.closest(".md-host");
  if (!host) return;
  const rect = wrap.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const scale = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  mdZoomAt(host, scale, px, py);
}, { passive: false });

document.addEventListener("mousedown", (e) => {
  const wrap = e.target.closest && e.target.closest(".md-mapwrap");
  if (!wrap) return;
  if (e.target.closest(".md-zoombtns")) return;
  const host = wrap.closest(".md-host");
  if (!host) return;
  // Right-click oder mit Shift = pan-start
  if (e.button !== 0) return;  // nur linke Maus
  const s = mdGetState(host);
  s.dragPan = {
    startX: e.clientX, startY: e.clientY,
    startCenterX: s.viewport.centerX, startCenterY: s.viewport.centerY,
  };
});

document.addEventListener("mousemove", (e) => {
  const host = document.querySelector(".md-host[data-mounted='1']");
  if (!host) return;
  const s = mdGetState(host);
  if (!s.dragPan) return;
  const dx = e.clientX - s.dragPan.startX;
  const dy = e.clientY - s.dragPan.startY;
  // 1 px = 1/zoom cm
  s.viewport.centerX = s.dragPan.startCenterX - dx / s.viewport.zoom;
  s.viewport.centerY = s.dragPan.startCenterY - dy / s.viewport.zoom;
  s.viewport.autoFollow = false;
  mdRenderBasemap(host);
  mdRenderOverlay(host);
});

document.addEventListener("mouseup", () => {
  const host = document.querySelector(".md-host[data-mounted='1']");
  if (!host) return;
  const s = mdGetState(host);
  s.dragPan = null;
});

document.addEventListener("dblclick", (e) => {
  const wrap = e.target.closest && e.target.closest(".md-mapwrap");
  if (!wrap) return;
  const host = wrap.closest(".md-host");
  if (!host) return;
  mdResetView(host);
});

function mdResetView(host) {
  const s = mdGetState(host);
  if (!s.detail) return;
  const coords = [];
  for (const m of s.detail.members) {
    if (!m.lives) continue;
    for (const life of m.lives) {
      if (life.landing) coords.push([life.landing.x, life.landing.y]);
    }
  }
  s.viewport = mdBboxFitViewport(coords, MD_PAD_500M_CM);
  mdRenderState(host);
}

document.addEventListener("click", (e) => {
  const zi = e.target.closest && e.target.closest(".md-zoom-in");
  if (zi) {
    const host = zi.closest(".md-host");
    mdZoomAt(host, 1.5, MD_MAP_PX / 2, MD_MAP_PX / 2);
    e.stopPropagation(); return;
  }
  const zo = e.target.closest && e.target.closest(".md-zoom-out");
  if (zo) {
    const host = zo.closest(".md-host");
    mdZoomAt(host, 1 / 1.5, MD_MAP_PX / 2, MD_MAP_PX / 2);
    e.stopPropagation(); return;
  }
  const zr = e.target.closest && e.target.closest(".md-zoom-reset");
  if (zr) {
    const host = zr.closest(".md-host");
    mdResetView(host);
    e.stopPropagation(); return;
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): manuelles Zoom + Drag-Pan + Doubleklick-Reset + Zoom-Buttons"
```

- [ ] **Step 3: Smoke**

Scrollwheel über Map zoomt rein/raus. Maus-Drag pant. Doubleklick reset. +/− Buttons zoomen.

---

## Phase 7: Marker-Click + Solo + "Alle"-Bar

### Task 11: Marker-Hit-Testing + Solo-Click

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Hit-test helper + click handler**

Append:

```javascript
// Findet Marker unter Maus-Position. Returns {acc, lifeIdx, kind, target}
// oder null. kind = 'landing' | 'death' | 'kill' | 'revive'
function mdHitTestMarker(host, canvasPx, canvasPy) {
  const s = mdGetState(host);
  if (!s.detail) return null;
  const HIT_PX = 8;  // 8px hit-radius
  const cursorTs = s.zeitraffer.cursorTs;
  const absTs = s.zeitraffer.matchStart + cursorTs;
  const inDefault = (cursorTs === 0);
  for (const m of s.detail.members) {
    if (s.soloAcc && m.accountId !== s.soloAcc) continue;
    if (!m.lives) continue;
    for (const life of m.lives) {
      // Landing
      if (life.landing && (inDefault || absTs >= life.landing.tsMs)) {
        const [cx, cy] = mdCmToCanvas(host, life.landing.x, life.landing.y);
        if (Math.hypot(cx - canvasPx, cy - canvasPy) <= HIT_PX) {
          return { acc: m.accountId, lifeIdx: life.lifeIndex,
                   kind: "landing", tsMs: life.landing.tsMs };
        }
      }
      // Death
      if (!inDefault && life.death && absTs >= life.death.tsMs) {
        const [cx, cy] = mdCmToCanvas(host, life.death.x, life.death.y);
        if (Math.hypot(cx - canvasPx, cy - canvasPy) <= HIT_PX) {
          return { acc: m.accountId, lifeIdx: life.lifeIndex,
                   kind: "death", tsMs: life.death.tsMs };
        }
      }
      // Kills
      if (!inDefault) {
        for (const k of life.kills) {
          if (absTs < k.tsMs) continue;
          const [ax, ay] = mdCmToCanvas(host, k.actorX, k.actorY);
          if (Math.hypot(ax - canvasPx, ay - canvasPy) <= HIT_PX) {
            return { acc: m.accountId, lifeIdx: life.lifeIndex,
                     kind: "kill", tsMs: k.tsMs };
          }
        }
      }
    }
  }
  return null;
}

// Click auf Marker: Solo + Zoom 500m + Cursor-Seek + Pause
async function mdMarkerClick(host, hit) {
  const s = mdGetState(host);
  s.soloAcc = hit.acc;
  s.zeitraffer.cursorTs = Math.max(0, hit.tsMs - s.zeitraffer.matchStart);
  s.zeitraffer.playing = false;
  s.playToken++;
  // 500m-Zoom auf Marker-Position
  const member = s.detail.members.find(m => m.accountId === hit.acc);
  let cx = null, cy = null;
  if (member && member.lives) {
    const life = member.lives.find(l => l.lifeIndex === hit.lifeIdx);
    if (life) {
      if (hit.kind === "landing" && life.landing) {
        cx = life.landing.x; cy = life.landing.y;
      } else if (hit.kind === "death" && life.death) {
        cx = life.death.x; cy = life.death.y;
      } else if (hit.kind === "kill") {
        const k = life.kills.find(kk => kk.tsMs === hit.tsMs);
        if (k) { cx = k.actorX; cy = k.actorY; }
      }
    }
  }
  if (cx != null) {
    s.viewport = {
      centerX: cx, centerY: cy,
      zoom: MD_MAP_PX / MD_PAD_500M_CM * 0.5,  // 500m wide visible
      autoFollow: false,
    };
  }
  mdRenderState(host);
}

document.addEventListener("click", (e) => {
  const wrap = e.target.closest && e.target.closest(".md-mapwrap");
  if (!wrap) return;
  if (e.target.closest(".md-zoombtns") || e.target.closest(".md-tools")) return;
  const host = wrap.closest(".md-host");
  if (!host) return;
  const rect = wrap.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = mdHitTestMarker(host, px, py);
  if (hit) {
    mdMarkerClick(host, hit);
    e.stopPropagation();
  }
});

// Card-Click setzt nur Solo + Reset-Viewport auf member-bbox
document.addEventListener("click", (e) => {
  const card = e.target.closest && e.target.closest(".md-card[data-acc]");
  if (!card) return;
  const host = card.closest(".md-host");
  if (!host) return;
  const s = mdGetState(host);
  const acc = card.getAttribute("data-acc");
  if (s.soloAcc === acc) {
    // Toggle off
    s.soloAcc = null;
  } else {
    s.soloAcc = acc;
    // Viewport: bbox(alle Landings + Deaths) des Members
    const m = s.detail.members.find(x => x.accountId === acc);
    const coords = [];
    if (m && m.lives) {
      for (const life of m.lives) {
        if (life.landing) coords.push([life.landing.x, life.landing.y]);
        if (life.death) coords.push([life.death.x, life.death.y]);
      }
    }
    if (coords.length) {
      s.viewport = mdBboxFitViewport(coords, MD_PAD_500M_CM);
    }
  }
  mdRenderState(host);
  e.stopPropagation();
});
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): Marker-Click setzt Solo + 500m-Zoom + Cursor-Seek"
```

---

### Task 12: "Alle"-Reset-Bar

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add alle-button handler**

Append:

```javascript
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest(".md-allebtn");
  if (!btn) return;
  const host = btn.closest(".md-host");
  if (!host) return;
  const s = mdGetState(host);
  s.soloAcc = null;
  s.zeitraffer.cursorTs = 0;
  s.zeitraffer.playing = false;
  s.playToken++;
  mdResetView(host);
  e.stopPropagation();
});
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): Alle-Button resettet Solo + Cursor + Viewport"
```

---

## Phase 8: Camera-Follow + Hover-Labels

### Task 13: Auto-Camera-Follow waehrend Play

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block — mdTogglePlay's frame)

- [ ] **Step 1: In mdTogglePlay's frame loop, after computing cursorTs, add camera-follow**

Find `mdTogglePlay` and modify the `frame` function so it ALSO runs camera-follow logic each frame. Replace the body of `frame(now)`:

```javascript
  function frame(now) {
    if (token !== s.playToken) return;
    if (host.dataset.mounted !== "1") return;
    const realElapsed = now - z.playStartWallTs;
    const scaledCursor = z.playStartCursor + realElapsed * (dur / MD_ANIM_DURATION_MS);
    z.cursorTs = Math.min(dur, scaledCursor);
    if (s.viewport && s.viewport.autoFollow) {
      mdAutoFollow(host);
    }
    mdRenderBasemap(host);
    mdRenderOverlay(host);
    mdUpdateScrubBar(host);
    if (z.cursorTs < dur) {
      requestAnimationFrame(frame);
    } else {
      z.playing = false;
      mdUpdateScrubBar(host);
    }
  }
```

Then add helper:

```javascript
function mdAutoFollow(host) {
  const s = mdGetState(host);
  const absTs = s.zeitraffer.matchStart + s.zeitraffer.cursorTs;
  const coords = [];
  const visibleMembers = s.soloAcc
    ? s.detail.members.filter(m => m.accountId === s.soloAcc)
    : s.detail.members;
  for (const m of visibleMembers) {
    const pin = mdInterpolatePin(m, absTs);
    if (pin) coords.push([pin.x, pin.y]);
  }
  if (coords.length === 0) return;
  const target = mdBboxFitViewport(coords, MD_PAD_500M_CM);
  // Smooth ease toward target (lerp 0.18 / frame)
  const t = 0.18;
  s.viewport.centerX += (target.centerX - s.viewport.centerX) * t;
  s.viewport.centerY += (target.centerY - s.viewport.centerY) * t;
  s.viewport.zoom += (target.zoom - s.viewport.zoom) * t;
  // autoFollow bleibt true
}
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): Camera-Follow waehrend Zeitraffer (smooth ease)"
```

---

### Task 14: Hover-Labels für Marker

**Files:**
- Modify: `widgets/pubg/session-report.html` (JS block)

- [ ] **Step 1: Add mousemove hover + label rendering**

Append:

```javascript
document.addEventListener("mousemove", (e) => {
  const wrap = e.target.closest && e.target.closest(".md-mapwrap");
  if (!wrap) return;
  const host = wrap.closest(".md-host");
  if (!host || host.dataset.mounted !== "1") return;
  const s = mdGetState(host);
  if (s.dragPan) return;  // waehrend Pan keine Hover-Label
  const rect = wrap.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = mdHitTestMarker(host, px, py);
  const labelEl = wrap.querySelector(".md-hover-label");
  if (!labelEl) return;
  if (!hit) {
    labelEl.classList.remove("show");
    return;
  }
  let txt = "?";
  const member = s.detail.members.find(m => m.accountId === hit.acc);
  const memberName = member && (member.isSelf ? "Du" : member.name);
  const lifeSuffix = (member && member.lives.length > 1)
    ? ` ${hit.lifeIdx}` : "";
  if (hit.kind === "landing") txt = `${memberName} • Landing${lifeSuffix}`;
  else if (hit.kind === "death") txt = `${memberName} • Death${lifeSuffix}`;
  else if (hit.kind === "kill") {
    const life = member.lives.find(l => l.lifeIndex === hit.lifeIdx);
    const k = life.kills.find(kk => kk.tsMs === hit.tsMs);
    const wn = k && k.weapon ? k.weapon.replace("Weap_", "").replace("_C", "") : "Kill";
    const victim = k && k.victimName ? k.victimName : "Gegner";
    txt = `${memberName} • ${wn} → ${victim}`;
  }
  labelEl.textContent = txt;
  labelEl.style.left = (px + 8) + "px";
  labelEl.style.top  = (py - 24) + "px";
  labelEl.classList.add("show");
});
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail-v2): Marker-Hover-Label (Landing/Death/Kill + Lebens-Nr.)"
```

---

## Phase 9: Final Polish + Smoke

### Task 15: Final smoke + minor polish

**Files:**
- Modify: `widgets/pubg/session-report.html` (if minor issues found)

- [ ] **Step 1: Full manual smoke-test checklist**

Open `http://localhost:9000/widgets/pubg/session-report.html?range=week`. Server muss laufen + Frontend mit aktuellem Code geladen sein. DevTools-Console offen.

Pro Match-Row mit Telemetrie:

1. **Expand** → Default-View: Map 300x300, 4 gestrichelte Flugrouten, 4 Landing-Pins (3.5px), Cards mit Lives-Liste, Scrub-Bar `0:00 / mm:ss`, "Alle"-Button-Bar.
2. **Click ▶** → Zeitraffer läuft, cursorTs steigt, Pin am Pfad-Punkt sichtbar, Trail wächst, Map folgt smooth (autoFollow).
3. **Click ⏸** → pausiert.
4. **Slider drag** → cursor springt, Map zeigt korrekten Zustand.
5. **Pfeiltasten ←/→** → ±1s, cursor steppt.
6. **Scrollwheel auf Map** → zoom-at-cursor, autoFollow false.
7. **Maus-Drag** → pan, autoFollow false.
8. **Doubleklick auf Map** → Reset-View.
9. **+/− Zoom-Buttons** → zoom rein/raus.
10. **Hover Landing-Pin** → Label "Name • Landing".
11. **Click Landing-Pin** → Solo, 500m-Zoom, cursor=landing-ts, paused.
12. **Click "Alle"** → Reset Solo + cursor=0 + viewport=Default.
13. **Click Card** → Solo (Card gold-border), Viewport=bbox(member-Landings+Deaths).
14. **Click Card erneut** → Solo aus.
15. **Match mit 2 Lives** (Comeback-Match falls vorhanden): Card zeigt "Leben 1: ... / Leben 2: ...", Hover-Label zeigt "Landing 1" / "Death 2".
16. **Match collapse** → Anim stoppt, State bleibt (re-open fast).

Wenn etwas nicht funktioniert: Console-Errors prüfen + inline fix + erneut testen.

- [ ] **Step 2: Commit (falls Fixes)**

```bash
git add widgets/pubg/session-report.html
git commit -m "chore(match-detail-v2): Smoke-Pass-Fixes"
```

Falls keine Fixes nötig: nichts committen, fertig.

- [ ] **Step 3: Final push**

```bash
git push 2>&1 | tail -3
```

---

## Self-Review

**Spec coverage:**
- ✅ Backend lives[] (Tasks 1, 2)
- ✅ Map 300x300 + Two-Canvas (Tasks 3, 5)
- ✅ Viewport-State + cmToCanvas (Task 4)
- ✅ Default-View nur Flugrouten + Landings (Task 6)
- ✅ Trail bei Zeitraffer (Task 6, im renderOverlay-Code mit groundPath-Slice)
- ✅ Cards mit Lives-Liste (Task 7)
- ✅ Orchestrator mdMount + Match-Row-Wiring (Task 8)
- ✅ Scrub-Bar Play/Pause/Slider/Step (Task 9)
- ✅ Scrollwheel/Drag-Pan/Doubleklick-Reset/Zoom-Buttons (Task 10)
- ✅ Marker-Click → Solo + Zoom + Seek (Task 11)
- ✅ Card-Click → Solo + Viewport (Task 11)
- ✅ "Alle"-Reset-Bar (Task 12)
- ✅ Camera-Follow smooth während Play (Task 13)
- ✅ Hover-Labels mit Lives-Nr. (Task 14)
- ✅ Pins 50% kleiner (3.5/5/3/2.5px) — siehe renderOverlay-Code in Task 6
- ✅ Smoke-Test-Checklist (Task 15)
- ✅ Hinweis wenn keine Pfad-Telemetrie da ist (Task 8, ergaenzt)

**Naming consistency:** mdMount/mdRenderState/mdRenderBasemap/mdRenderOverlay/mdRenderCards/mdGetState/mdCmToCanvas/mdCanvasToCm/mdBboxFitViewport/mdZoomAt/mdResetView/mdAutoFollow/mdInterpolatePin/mdHitTestMarker/mdMarkerClick/mdTogglePlay/mdScrubTo/mdUpdateScrubBar/mdUpdateAlleBar — alle md-prefixed, alle eindeutig.

**No placeholders.** Jeder Code-Block ist kompletter Code, kein "implement here later".
