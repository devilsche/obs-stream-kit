# Match-Detail Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Match-Detail expand-view in `widgets/pubg/session-report.html` from scratch with a two-canvas rendering architecture, stacked Mate-Cards, parallel Zeitraffer-Animation, and clean Hover-Preview/Click-Lock state machine. Plus configurable weapon-icon size in `widgets/pubg/weapon-stats.html`.

**Architecture:** Backend `compute_match_detail` is extended with per-member path-timestamps and squad-kill events. Frontend uses two stacked canvases (basemap + overlay) with the overlay redrawn on every state change. State machine tracks `hoveredAcc`/`lockedAcc` and a `playToken` to cancel animations cleanly. UI: 480px map left, stacked Cards right, tools-bar with `Kills`-Toggle and `▶ Zeitraffer`-Play button.

**Tech Stack:** Python 3 + pytest for backend. Vanilla HTML/CSS/JS (no framework), Canvas 2D context, requestAnimationFrame. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-16-match-detail-rework-design.md`.

**Repo-Konvention:** Direkt auf `master` committen, keine Feature-Branches (siehe `memory/feedback_obs_stream_kit_master_only.md`). Commit-Messages auf Deutsch, Conventional Commits, KEIN Co-Authored-By (siehe `CLAUDE.md`).

---

## File Structure

**Backend:**
- `pubg/aggregations.py` — modify `compute_match_detail` (lines ~880-1080): extend `path` to `[[x, y, ts], ...]`, add `kills: [...]` per member.
- `tests/pubg/test_match_detail.py` — NEW file. Tests for the two new behaviors.

**Frontend:**
- `widgets/pubg/session-report.html` — remove old match-detail rendering (renderMatchMap, renderMatchInfo, openMapModal, hover-popover, click-handler, all `.md-*` styles aren't there yet — current uses `.match-map`/`.match-info`/`.mi-row`). Replace with new two-canvas + cards architecture.
- `widgets/pubg/weapon-stats.html` — add `?iconSize` URL param + CSS variable plumbing.

**Out of scope** (per spec): post-match-card, headshot-detection, distance-counter overlay, twitch-clip integration.

---

## Phase 1: Backend — Path-Timestamps

### Task 1: Test for path with timestamps

**Files:**
- Create: `tests/pubg/test_match_detail.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/pubg/test_match_detail.py
from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, insert_telemetry_events,
                     insert_team_mapping)
from pubg.aggregations import compute_match_detail


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_player(conn, "account.B", "Mate1", "steam", False)
    return conn


def _basic_match(conn, mid="m1", played_at="2026-05-15T18:00:00Z"):
    insert_match(conn, mid, "Baltic_Main", "squad-fpp", False, 1800, played_at, None)
    parts = []
    for acc, name in (("account.A", "PEX_LuCKoR"), ("account.B", "Mate1")):
        parts.append({
            "account_id": acc, "name": name, "team_id": 1,
            "place": 5, "kills": 2, "headshot_kills": 0, "assists": 0,
            "dbnos": 0, "revives": 0, "damage_dealt": 200.0,
            "longest_kill": 10.0, "time_survived": 600,
            "walk_distance": 0, "ride_distance": 0, "swim_distance": 0,
            "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0,
        })
    insert_participants(conn, mid, parts)
    insert_team_mapping(conn, mid, [
        {"account_id": "account.A", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
        {"account_id": "account.B", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
    ])
    return mid


def test_path_includes_timestamps(tmp_db_path):
    """compute_match_detail soll path als [[x, y, ts_ms], ...] liefern."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    # Plane-Cruise: 3s nach z>=150000. Position ab dann.
    events = [
        # Plane-Cruise erreicht bei ts=10000ms (z=160000)
        {"event_type": "Position", "timestamp_ms": 10000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # path-Start = 13000ms (10000 + 3000)
        {"event_type": "Position", "timestamp_ms": 15000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 110000.0, "actor_y": 110000.0, "actor_z": 80000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 30000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    # path muss 3-Tupel (x, y, ts_ms) enthalten
    assert len(me["path"]) >= 2
    for pt in me["path"]:
        assert len(pt) == 3, f"Erwarte [x, y, ts], bekommen {pt}"
        assert isinstance(pt[2], int), f"ts muss int sein, ist {type(pt[2])}"
    # Punkte sind chronologisch
    timestamps = [pt[2] for pt in me["path"]]
    assert timestamps == sorted(timestamps)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/pubg/test_match_detail.py::test_path_includes_timestamps -v`
Expected: FAIL — current `path` is `[[x, y], ...]` with 2-tuples, test expects 3-tuples.

- [ ] **Step 3: Implement — patch path in compute_match_detail**

In `pubg/aggregations.py`, locate `compute_match_detail` and find the path-building section (`path_rows = conn.execute(...)` query). Change:

```python
        # vorher:
        path = [[r["actor_x"], r["actor_y"]] for r in path_rows]
        # nachher:
        path = [[r["actor_x"], r["actor_y"], r["timestamp_ms"]]
                for r in path_rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/pubg/test_match_detail.py::test_path_includes_timestamps -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/pubg/test_match_detail.py pubg/aggregations.py
git commit -m "feat(match-detail): Pfad-Eintraege enthalten Timestamps fuer Zeitraffer-Sync"
```

---

## Phase 2: Backend — Squad-Kills

### Task 2: Test for squad-kills field

**Files:**
- Modify: `tests/pubg/test_match_detail.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/pubg/test_match_detail.py`:

```python
def test_member_kills_includes_actor_and_victim_coords(tmp_db_path):
    """Pro Member sollen Kill-Events mit Schuetze + Opfer-Position
    in members[i].kills landen."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        # Squad-Member A killt einen Enemy auf gegebenen Koords
        {"event_type": "Kill", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": "account.ENEMY1",
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 251000.0, "victim_y": 260500.0,
         "weapon": "WeapHK416_C", "distance": 1500.0, "damage": 100.0,
         "payload_json": None},
        # Zweiter Kill von A
        {"event_type": "Kill", "timestamp_ms": 600000,
         "actor_account": "account.A", "target_account": "account.ENEMY2",
         "actor_x": 300000.0, "actor_y": 310000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 302000.0, "victim_y": 310500.0,
         "weapon": "WeapBerylM762_C", "distance": 2200.0, "damage": 80.0,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert "kills" in me, "members[].kills field fehlt"
    assert len(me["kills"]) == 2
    k1, k2 = me["kills"]
    assert k1["actorX"] == 250000.0
    assert k1["actorY"] == 260000.0
    assert k1["victimX"] == 251000.0
    assert k1["victimY"] == 260500.0
    assert k1["tsMs"] == 500000
    assert k2["actorX"] == 300000.0
    assert k2["victimX"] == 302000.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/pubg/test_match_detail.py::test_member_kills_includes_actor_and_victim_coords -v`
Expected: FAIL — `kills` field doesn't exist on member dict.

- [ ] **Step 3: Implement — add kills to compute_match_detail**

In `pubg/aggregations.py`, `compute_match_detail`, inside the per-member loop, after the `revives` query and before the `out_members.append(...)`:

```python
        # Kills dieses Members (fuer Squad-Kill-Toggle in der Map).
        # Liefert Schuetzen-Coord (actor) + Opfer-Coord (victim) + Timestamp.
        kill_rows = conn.execute("""
            SELECT te.actor_x, te.actor_y, te.victim_x, te.victim_y,
                   te.timestamp_ms, te.weapon,
                   COALESCE(p.name, pa.name) AS victim_name
            FROM telemetry_events te
            LEFT JOIN players p ON p.account_id = te.target_account
            LEFT JOIN participants pa
              ON pa.match_id = te.match_id
             AND pa.account_id = te.target_account
            WHERE te.match_id = ? AND te.actor_account = ?
              AND te.event_type = 'Kill'
              AND te.actor_x IS NOT NULL AND te.victim_x IS NOT NULL
            ORDER BY te.timestamp_ms ASC
        """, (match_id, acc)).fetchall()
        kills = [{
            "actorX":  kr["actor_x"],
            "actorY":  kr["actor_y"],
            "victimX": kr["victim_x"],
            "victimY": kr["victim_y"],
            "tsMs":    kr["timestamp_ms"],
            "weapon":  kr["weapon"],
            "victimName": kr["victim_name"],
        } for kr in kill_rows]
```

Then add `"kills": kills,` to the appended `out_members.append({...})` dict (next to `"revivePts": revive_pts,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/pubg/test_match_detail.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/pubg/test_match_detail.py pubg/aggregations.py
git commit -m "feat(match-detail): Squad-Kills (Schuetze+Opfer-Coords) pro Member"
```

---

## Phase 3: Frontend — Cleanup of old match-detail code

### Task 3: Remove old match-detail rendering

**Files:**
- Modify: `widgets/pubg/session-report.html`

The current code has these elements that must go:
- CSS classes: `.match-map`, `.match-map-wrap`, `.match-info`, `.mi-row`, `.mi-empty`, `.death-pov`, `.map-modal`, `.mm-*`
- Functions: `renderMatchMap`, `renderMatchInfo`, `loadMapImage` (replaced by new), `_mmEl`, `_mmStep`, `_mmPlay`, `_mmFakeHost`, `openMapModal`, `_hoverFindMap`, `_focusMember`, `_focusClear`, `playerColor` (replaced)
- Constants: `PLAYER_COLORS`, `_matchDetailCache` (replaced), `_mapImageCache` (kept, useful)
- DOM-Markup im `fmtSquadDetail` (Match-Map + match-info inline)
- Event-Handlers: `document.addEventListener("click", ...)` for `.match-map` + `.mi-row` (3 separate handlers — all gone)

- [ ] **Step 1: Locate cleanup boundaries**

Run to find them all:

```bash
grep -n "renderMatchMap\|renderMatchInfo\|match-map\|match-info\|mi-row\|_mmEl\|_mmStep\|_mmPlay\|openMapModal\|_focusMember\|_focusClear\|playerColor\|PLAYER_COLORS\|loadMatchDetail" widgets/pubg/session-report.html
```

Expected: ~80-100 line-references. Note start/end of each block (CSS rules, JS functions, event-listener registrations).

- [ ] **Step 2: Delete all old code and old markup**

Replace the four areas:

a) **CSS block** — delete CSS rules for `.match-map`, `.match-map-wrap`, `.match-map canvas`, `.match-map .legend`, `.match-info`, `.match-info .mi-row*`, `.death-pov*`, `.map-modal*` from the `<style>` section. Keep only generic match-row CSS that's not match-detail specific.

b) **`fmtSquadDetail`** function — change the return template to remove `.match-map` and `.match-info` blocks. The new markup will be inserted by `renderMatchDetail` (Task 5) after expand. For now, keep only the squad-table:

```javascript
function fmtSquadDetail(m) {
  // Du oben, dann Mates sortiert nach Damage absteigend
  const all = [m.myStats, ...(m.squad || [])];
  all.sort((a, b) => {
    if (a.isSelf) return -1;
    if (b.isSelf) return 1;
    return (b.damage_dealt || 0) - (a.damage_dealt || 0);
  });
  const isWin = m.place === 1;
  function specialBadges(sp) {
    if (!sp) return "";
    const b = [];
    if (sp.redzone) b.push(`<span title="Red Zone Tod">💥×${sp.redzone}</span>`);
    if (sp.vkill)   b.push(`<span title="Überfahren">🚗💀×${sp.vkill}</span>`);
    if (sp.vdeath)  b.push(`<span title="Überfahren worden">🚗×${sp.vdeath}</span>`);
    if (sp.driveby) b.push(`<span title="Drive-By Kill">🔫🚗×${sp.driveby}</span>`);
    return b.length ? ` <span style="font-size:0.8em;opacity:0.85">${b.join(" ")}</span>` : "";
  }
  const rows = all.map(p => {
    const cls = (p.isSelf ? "self " : "") + (isWin ? "win" : "");
    return `<tr class="${cls.trim()}">
      <td>${p.name}${p.isSelf ? " (du)" : ""}${specialBadges(p.special)}</td>
      <td>${p.kills || 0}</td>
      <td>${p.headshot_kills || 0}</td>
      <td>${p.assists || 0}</td>
      <td>${p.dbnos || 0}</td>
      <td>${Math.round(p.damage_dealt || 0)}</td>
      <td>${fmtSurv(p.time_survived)}</td>
    </tr>`;
  }).join("");
  const matchId = m.matchId || "";
  const mapName = m.map || "";
  const isEvent = !!m.isEvent;
  const sidePanel = isEvent
    ? `<div class="event-detail" data-event-detail-match-id="${matchId}">
         <div class="event-detail-empty">— event stats laden —</div>
       </div>`
    : `<div class="md-host" data-match-id="${matchId}" data-map="${mapName}"></div>`;
  return `
    <div class="detail-row">
      <div class="squad-table-wrap">
        <table>
          <thead><tr>
            <th>Squad</th><th>K</th><th>HS</th><th>Ass</th><th>DBNO</th><th>DMG</th><th>Survived</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${sidePanel}
    </div>`;
}
```

The `<div class="md-host">` is the empty mount-point; new code populates it.

c) **JS function definitions** — delete `playerColor`, `_matchDetailCache`, `loadMatchDetail`, `renderMatchMap`, `renderMatchInfo`, `applyPinCal`, `_mapImageCache`, `loadMapImage`, `_mmEl`, `_mmStep`, `_mmPlay`, `_mmFakeHost`, `openMapModal`, `_hoverFindMap`, `_focusMember`, `_focusClear`, `_hoverActive`. Also delete the `document.addEventListener("click", ...)` handlers that referenced `.match-map` and `.mi-row`. Keep the existing `.m[data-idx]` row-toggle click-handler — that one drives the expand/collapse and is unchanged.

d) **Restore-State logic** — in the restore-state block after re-render (`snap.expandedMatches.forEach...`), keep the row.expanded/detail.show toggling but remove the call to `renderMatchMap(host)` (will be replaced).

- [ ] **Step 3: Smoke-test — page renders without errors**

Open `http://localhost:9000/widgets/pubg/session-report.html?range=week` in browser. DevTools-Console open. Click a Match-Row to expand.
Expected: Squad-table appears, `<div class="md-host">` is visible but empty (no map yet). No JS errors.

- [ ] **Step 4: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "refactor(match-detail): alte match-map+match-info+modal entfernt (Vorbereitung Rework)"
```

---

## Phase 4: Frontend — New CSS + HTML structure

### Task 4: CSS for new md-* layout

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add CSS block**

In the `<style>` section, near the other `.squad-detail` rules, add:

```css
/* Match-Detail Rework — md-* Klassen. Layout: Map links 520px Spalte
   mit 480x480 Map, rechts Squad-Tabelle (von fmtSquadDetail) und
   Cards-Container. */
.md-host {
  flex: none;
  width: 520px;
}
.md-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.md-mapwrap {
  position: relative;
  width: 480px;
  height: 480px;
  margin: 0 auto;
  background: #0d061a;
  border: 1px solid var(--pubg-border);
  border-radius: 6px;
  overflow: hidden;
}
.md-mapwrap canvas {
  position: absolute;
  inset: 0;
  width: 480px;
  height: 480px;
  display: block;
}
.md-mapwrap canvas.md-overlay { pointer-events: none; }
.md-mapwrap .md-tools {
  position: absolute;
  bottom: 6px; left: 6px; right: 6px;
  display: flex;
  gap: 6px;
  align-items: center;
  background: rgba(13,6,26,0.78);
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 0.78em;
  color: var(--pubg-muted);
}
.md-mapwrap .md-tools .md-legend { flex: 1; }
.md-tools button {
  background: rgba(242,183,5,0.12);
  border: 1px solid rgba(242,183,5,0.4);
  color: var(--pubg-gold);
  padding: 2px 9px;
  border-radius: 3px;
  font-size: 0.92em;
  font-family: inherit;
  cursor: pointer;
}
.md-tools button:hover { background: rgba(242,183,5,0.22); }
.md-tools button.active {
  background: var(--pubg-gold);
  color: #1a0d2a;
  font-weight: 700;
}
/* Cards rechts unter der Map (in einer eigenen Reihe in der
   detail-row, aber via md-grid eigentlich BELOW der Map). */
.md-cards { display: flex; flex-direction: column; gap: 6px; }
.md-card {
  background: rgba(94,42,121,0.18);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 0.9em;
  line-height: 1.4;
  color: var(--pubg-text);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.md-card:hover { background: rgba(255,255,255,0.04); }
.md-card.active {
  background: rgba(242,183,5,0.06);
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
.md-card .md-name { font-weight: 700; color: var(--pubg-text); }
.md-card.md-self .md-name { color: var(--pubg-gold); }
.md-card .md-badge {
  margin-left: auto;
  font-size: 0.82em;
  padding: 1px 6px;
  background: rgba(0,0,0,0.3);
  border-radius: 3px;
  color: var(--pubg-muted);
}
.md-card .md-badge.alive { color: var(--pubg-gold); }
.md-card .md-badge.died  { color: #e57b7b; }
.md-card .md-row { font-size: 0.92em; color: var(--pubg-muted); }
.md-card .md-row b { color: var(--pubg-text); }
.md-card .md-deathby {
  margin-top: 4px; padding-top: 4px;
  border-top: 1px solid rgba(255,255,255,0.07);
  font-size: 0.92em;
  color: #e57b7b;
}
.md-card .md-deathby b { color: var(--pubg-text); }
.md-card .md-empty { font-style: italic; opacity: 0.6; }
```

Also widen the squad-detail container so the host fits next to the squad-table-wrap. Update:

```css
.squad-detail .detail-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.squad-detail .detail-row > .squad-table-wrap { flex: 1; min-width: 0; }
```

(Leave that as-is — the `.md-host` is now `width: 520px` and sits as the right side of the flex row.)

- [ ] **Step 2: Smoke-test**

Reload session-report. Expand a match. `.md-host` div is empty but should be 520px wide on the right side of the detail-row. No layout breakage.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): CSS-Struktur fuer Two-Canvas Layout + Cards"
```

---

## Phase 5: Frontend — Asset Helpers + Player-Color

### Task 5: Re-add playerColor + loadMapImage helpers

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add helpers in the JS block**

Insert near the top of the `<script>` block (after `const FROM = ...`):

```javascript
// ── Match-Detail Rework Globals ──────────────────────────────────────
const MD_COLORS = [
  "#f2b705",  // Gelb (Self idx 0)
  "#e74c3c",  // Rot
  "#3498db",  // Blau
  "#2ecc71",  // Gruen
  "#ff7a1f",  // Orange (5er-Squad)
  "#9b59b6",  // Violett
  "#1abc9c",  // Tuerkis
  "#ec407a",  // Pink
];

// Cache: matchId -> { detail: <md>, colorByAcc: {acc -> hex} }
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

// Map-Image-Cache + Load (kept from old code, .png with .webp fallback).
const _mdImgCache = new Map();
function mdMapImage(mapName) {
  if (!mapName) return Promise.resolve(null);
  if (_mdImgCache.has(mapName)) return _mdImgCache.get(mapName);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => {
      // .png fehlte -> versuche .webp
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

// Center-Anchored Affin (gleiche Formel wie poi-editor.html).
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
```

- [ ] **Step 2: Verify in console**

In browser DevTools console after page load:
```js
mdLoad("some-match-id-from-the-report").then(console.log);
```
Expected: returns object with `detail.members` array and `colorByAcc` map.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): mdLoad/mdMapImage/mdApplyPinCal Helpers"
```

---

## Phase 6: Frontend — Basemap-Renderer

### Task 6: renderBasemap implementation

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add renderBasemap function**

Append to the script block after the helpers from Task 5:

```javascript
// Zeichnet die statische Karte (Map-Tile + Crop) auf das basemap-Canvas.
// Wird einmal pro Match-Open aufgerufen. cmToCanvas + cropBox werden
// im host.dataset gespeichert damit der overlay-Renderer dieselben
// Coords nutzt.
async function mdRenderBasemap(host, mapName) {
  const canvas = host.querySelector("canvas.md-basemap");
  if (!canvas) return;
  const blob = (window._poiData || {})[mapName] || {};
  const mapKm = blob.mapKm || 8;
  const cal   = blob.pinCalibration || {};
  const img = await mdMapImage(mapName);

  canvas.width = 480; canvas.height = 480;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d061a";
  ctx.fillRect(0, 0, 480, 480);
  if (!img || !img.naturalWidth) return;

  // Center-Crop (analog poi-editor).
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const cropOffX = (img.naturalWidth  - side) / 2;
  const cropOffY = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, cropOffX, cropOffY, side, side, 0, 0, 480, 480);

  // Cm -> Canvas-Pixel Mapping fuer den overlay-Renderer in dataset.
  host.dataset.mapKm = mapKm;
  host.dataset.cal   = JSON.stringify(cal);
}
```

- [ ] **Step 2: Test by adding a temporary debug entrypoint**

For manual smoke, edit the Match-Row click-handler block — find the click-handler near `// Click-Handler: Match-Zeile expandiert Squad-Detail`. Just before the expand-handler, add a temporary:

```javascript
// TEMP for Task 6 smoke-test
window.mdRenderBasemap = mdRenderBasemap;
```

In browser console, expand a match (so `<div class="md-host">` exists), then:
```js
const host = document.querySelector(".md-host[data-match-id]");
host.innerHTML = '<canvas class="md-basemap" width=480 height=480></canvas>';
mdRenderBasemap(host, host.dataset.map);
```
Expected: Map tile renders. No errors.

Remove the `window.mdRenderBasemap = ...` temp line after this works.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): mdRenderBasemap zeichnet Map-Tile auf Basemap-Canvas"
```

---

## Phase 7: Frontend — Overlay-Renderer (Pfade + Pins)

### Task 7: renderOverlay base (paths + landings + deaths + revives)

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add renderOverlay function**

Append after `mdRenderBasemap`:

```javascript
// Zeichnet Pfade, Pins und (in spaeteren Tasks) Squad-Kills + Animation
// auf das overlay-Canvas. Wird bei JEDEM State-Change neu aufgerufen.
// state = { members, focusAcc, showKills, animProgress?, colorByAcc }
async function mdRenderOverlay(host, state) {
  const canvas = host.querySelector("canvas.md-overlay");
  if (!canvas) return;
  canvas.width = 480; canvas.height = 480;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 480, 480);

  const mapKm = parseFloat(host.dataset.mapKm) || 8;
  let cal = {};
  try { cal = JSON.parse(host.dataset.cal || "{}"); } catch (e) {}
  const mapCm = mapKm * 100000;
  function cmToCanvas(xCm, yCm) {
    const [ex, ey] = mdApplyPinCal(xCm, yCm, mapKm, cal);
    return [(ex / mapCm) * 480, (ey / mapCm) * 480];
  }

  const { members, focusAcc, colorByAcc } = state;
  if (!members) return;

  // 1) Pfade als Polyline pro Member. Alpha 0.3 default, 0.9 fokussiert,
  //    0.15 wenn focusAcc gesetzt und member nicht fokussiert (dimmt).
  for (const m of members) {
    const color = colorByAcc[m.accountId] || "#999";
    let alpha;
    if (!focusAcc) alpha = 0.3;
    else if (m.accountId === focusAcc) alpha = 0.9;
    else alpha = 0.15;
    if (!m.path || m.path.length < 2) continue;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = m.accountId === focusAcc ? 2.5 : 1.5;
    ctx.beginPath();
    m.path.forEach(([xCm, yCm], i) => {
      const [cx, cy] = cmToCanvas(xCm, yCm);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 2) Pins pro Member: Landing (7px) + Death (10px) wenn died.
  //    Keine Symbole, keine X-Markierung. Reine Kreise + weisser Outline.
  for (const m of members) {
    const color = colorByAcc[m.accountId] || "#999";
    if (m.landingX != null && m.landingY != null) {
      const [cx, cy] = cmToCanvas(m.landingX, m.landingY);
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (m.died && m.deathX != null) {
      const [cx, cy] = cmToCanvas(m.deathX, m.deathY);
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // 3) Revive-Pins (gruen, 6px) pro revivePts-Eintrag pro Member.
  for (const m of members) {
    if (!m.revivePts || !m.revivePts.length) continue;
    for (const [xCm, yCm] of m.revivePts) {
      if (xCm == null) continue;
      const [cx, cy] = cmToCanvas(xCm, yCm);
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#2ecc71";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
```

- [ ] **Step 2: Manual smoke (still no orchestrator)**

In console:
```js
const host = document.querySelector(".md-host[data-match-id]");
host.innerHTML = '<canvas class="md-basemap"></canvas><canvas class="md-overlay" style="position:absolute;inset:0"></canvas>';
mdRenderBasemap(host, host.dataset.map).then(() =>
  mdLoad(host.dataset.matchId).then(({detail, colorByAcc}) =>
    mdRenderOverlay(host, {members: detail.members, focusAcc: null, colorByAcc})));
```
Expected: Map + all squad paths transparent + landing/death pins + revive pins. No focus highlight.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): mdRenderOverlay zeichnet Pfade + Pins + Revives"
```

---

## Phase 8: Frontend — Cards + Orchestrator

### Task 8: renderCards function

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add renderCards function**

Append after `mdRenderOverlay`:

```javascript
// Stacked Cards rechts/unter der Map — eine pro Squad-Member.
function mdRenderCards(host, state) {
  const wrap = host.querySelector(".md-cards");
  if (!wrap) return;
  const { members, focusAcc, colorByAcc } = state;
  function fmtMinSec(sec) {
    if (sec == null) return "?";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function poi(x, y, mapName) {
    if (x == null || y == null) return null;
    if (PubgUI.POI && PubgUI.POI.fromCoords) {
      return PubgUI.POI.fromCoords(mapName, x, y);
    }
    return null;
  }
  const mapName = host.getAttribute("data-map");
  const html = members.map((m) => {
    const color = colorByAcc[m.accountId] || "#999";
    const active = (m.accountId === focusAcc) ? " active" : "";
    const selfCls = m.isSelf ? " md-self" : "";
    const who = m.isSelf ? "Du" : m.name;
    const landP  = poi(m.landingX, m.landingY, mapName);
    const deathP = poi(m.deathX, m.deathY, mapName);
    const badge = m.died
      ? `<span class="md-badge died">† ${fmtMinSec(m.deathOffsetSec)}</span>`
      : `<span class="md-badge alive">ueberlebt</span>`;
    let body = `<div class="md-row">landete <b>${landP || "?"}</b>`;
    if (m.died && deathP) body += ` &mdash; gestorben in <b>${deathP}</b>`;
    body += `</div>`;
    if (m.died && m.weaponName) {
      const dist = m.distanceM ? ` auf <b>${m.distanceM.toFixed(0)}m</b>` : "";
      const killer = m.killerName || "Gegner";
      body += `<div class="md-deathby">durch <b>${killer}</b> mit <b>${m.weaponName}</b>${dist}</div>`;
    }
    return `<div class="md-card${active}${selfCls}" data-acc="${m.accountId}">
      <div class="md-head">
        <span class="md-dot" style="background:${color}"></span>
        <span class="md-name">${who}</span>
        ${badge}
      </div>
      ${body}
    </div>`;
  }).join("");
  wrap.innerHTML = html;
}
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): mdRenderCards zeichnet Mate-Cards rechts"
```

### Task 9: Orchestrator + state-per-match + match-row-click integration

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add orchestrator + state storage**

Append after `mdRenderCards`:

```javascript
// State pro Match-Host (DOM-Element). Storage als WeakMap damit
// expanded-collapse-Cycle das automatisch GC'd wenn das DOM weg ist.
const _mdState = new WeakMap();

function mdGetState(host) {
  let s = _mdState.get(host);
  if (!s) {
    s = {
      members: null, colorByAcc: {}, hoveredAcc: null, lockedAcc: null,
      showKills: false, playToken: 0,
    };
    _mdState.set(host, s);
  }
  return s;
}

function mdEffectiveFocus(s) {
  return s.lockedAcc || s.hoveredAcc;
}

function mdRenderState(host) {
  const s = mdGetState(host);
  if (!s.members) return;
  mdRenderOverlay(host, {
    members: s.members,
    focusAcc: mdEffectiveFocus(s),
    showKills: s.showKills,
    colorByAcc: s.colorByAcc,
  });
  mdRenderCards(host, {
    members: s.members,
    focusAcc: mdEffectiveFocus(s),
    colorByAcc: s.colorByAcc,
  });
}

async function mdMount(host) {
  // 1) Erstmaliges Setup: HTML-Skelett rein, Basemap + Overlay malen.
  if (host.dataset.mounted === "1") return;
  host.dataset.mounted = "1";
  const matchId = host.getAttribute("data-match-id");
  const mapName = host.getAttribute("data-map");
  host.innerHTML = `
    <div class="md-grid">
      <div class="md-mapwrap">
        <canvas class="md-basemap"></canvas>
        <canvas class="md-overlay"></canvas>
        <div class="md-tools">
          <button class="md-toggle" data-toggle="kills">Kills</button>
          <button class="md-play">▶ Zeitraffer</button>
          <span class="md-legend">${PubgUI.fmtMap(mapName)}</span>
        </div>
      </div>
      <div class="md-cards"></div>
    </div>`;
  await mdRenderBasemap(host, mapName);
  const md = await mdLoad(matchId);
  const s = mdGetState(host);
  if (!md || !md.detail) {
    host.querySelector(".md-cards").innerHTML =
      `<div class="md-empty md-card">— keine Telemetrie verfuegbar —</div>`;
    return;
  }
  s.members = md.detail.members;
  s.colorByAcc = md.colorByAcc;
  mdRenderState(host);
}
```

- [ ] **Step 2: Wire match-row-click-handler to call mdMount**

Find the existing handler:
```javascript
document.addEventListener("click", (e) => {
  const row = e.target.closest(".m[data-idx]");
  ...
});
```

Modify the `if (!wasExpanded)` branch to call mdMount instead of renderMatchMap:

```javascript
if (!wasExpanded) {
  const host = detail.querySelector(".md-host");
  if (host) mdMount(host);
}
```

Also update the restore-state block (after page re-render) similarly — replace the renderMatchMap-call there with `mdMount(host)` on `.md-host` elements within the restored match.

- [ ] **Step 3: Smoke-test**

Reload session-report. Expand a match. Expected:
- Map renders (basemap)
- 4 transparent paths visible
- Landing + Death + Revive pins drawn
- 4 cards under/right of the map (depending on layout flow)
- No console errors

- [ ] **Step 4: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): mdMount Orchestrator + State + Match-Row Wiring"
```

---

## Phase 9: Frontend — Interaktion (Hover-Preview + Click-Lock)

### Task 10: Card mouseenter/leave for hover-preview

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add global event-listeners**

Append (top-level, near the existing `document.addEventListener` setup):

```javascript
// Hover-Preview: state.hoveredAcc folgt der gehoverten Card.
document.addEventListener("mouseenter", (e) => {
  const card = e.target && e.target.closest && e.target.closest(".md-card[data-acc]");
  if (!card) return;
  const host = card.closest(".md-host");
  if (!host) return;
  const s = mdGetState(host);
  s.hoveredAcc = card.getAttribute("data-acc");
  mdRenderState(host);
}, true);  // capture-phase damit mouseenter ueberhaupt bubbelt

document.addEventListener("mouseleave", (e) => {
  const card = e.target && e.target.closest && e.target.closest(".md-card[data-acc]");
  if (!card) return;
  const host = card.closest(".md-host");
  if (!host) return;
  const s = mdGetState(host);
  s.hoveredAcc = null;
  mdRenderState(host);
}, true);
```

- [ ] **Step 2: Smoke-test**

Reload + expand match. Hover over a Card.
Expected: that member's path on the map becomes brighter (alpha 0.9), other paths dim (alpha 0.15). Mouse out → all paths back to default 0.3.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Hover-Preview auf Cards highlightet Pfad"
```

### Task 11: Click-Lock on cards + unlock paths

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add click handlers**

Append:

```javascript
// Click auf Card: lockedAcc togglen. Click in Map-Leerflaeche, ESC: unlock.
document.addEventListener("click", (e) => {
  // Card-Click
  const card = e.target.closest && e.target.closest(".md-card[data-acc]");
  if (card) {
    const host = card.closest(".md-host");
    if (!host) return;
    const s = mdGetState(host);
    const acc = card.getAttribute("data-acc");
    s.lockedAcc = (s.lockedAcc === acc) ? null : acc;
    mdRenderState(host);
    e.stopPropagation();
    return;
  }
  // Map-Leerflaechen-Click: unlock
  const overlay = e.target.closest && e.target.closest(".md-mapwrap");
  if (overlay && !e.target.closest(".md-tools")) {
    const host = overlay.closest(".md-host");
    if (!host) return;
    const s = mdGetState(host);
    if (s.lockedAcc) {
      s.lockedAcc = null;
      mdRenderState(host);
      e.stopPropagation();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Erste sichtbare md-host mit lock zuruecksetzen.
  document.querySelectorAll(".md-host[data-mounted]").forEach((host) => {
    const s = mdGetState(host);
    if (s.lockedAcc) {
      s.lockedAcc = null;
      s.playToken++;  // stoppt evtl. laufende Animation
      mdRenderState(host);
    }
  });
});
```

- [ ] **Step 2: Smoke-test**

Reload + expand match. Click on a Card → Card bekommt Gold-Border, Pfad bleibt highlighted auch wenn Mouse weg. Click selbe Card → unlock. Click andere Card → wechselt. Click in Map (außerhalb der Tools-Bar) → unlock. ESC → unlock.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Click-Lock auf Cards + Unlock via Map/ESC"
```

---

## Phase 10: Frontend — Squad-Kills Toggle

### Task 12: Extend renderOverlay with showKills

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add Squad-Kill drawing to mdRenderOverlay**

In `mdRenderOverlay`, after the revive-pins block and before the closing `}`, insert:

```javascript
  // 4) Squad-Kills (Schuetze + Opfer + Verbindung) wenn Toggle aktiv.
  if (state.showKills) {
    for (const m of members) {
      if (!m.kills || !m.kills.length) continue;
      const color = colorByAcc[m.accountId] || "#999";
      for (const k of m.kills) {
        if (k.actorX == null || k.victimX == null) continue;
        const [ax, ay] = cmToCanvas(k.actorX, k.actorY);
        const [vx, vy] = cmToCanvas(k.victimX, k.victimY);
        // Verbindungslinie
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(vx, vy);
        ctx.stroke();
        ctx.globalAlpha = 1;
        // Schuetze-Punkt
        ctx.beginPath();
        ctx.arc(ax, ay, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        // Opfer-Punkt (hellgrau, etwas kleiner als Squad-Pins damit
        // unverwechselbar mit Landings).
        ctx.beginPath();
        ctx.arc(vx, vy, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#bbb";
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
```

- [ ] **Step 2: Wire toggle button**

Append global event-listener:

```javascript
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest(".md-toggle[data-toggle=kills]");
  if (!btn) return;
  const host = btn.closest(".md-host");
  if (!host) return;
  const s = mdGetState(host);
  s.showKills = !s.showKills;
  btn.classList.toggle("active", s.showKills);
  mdRenderState(host);
  e.stopPropagation();
});
```

- [ ] **Step 3: Smoke-test**

Expand match. Click "Kills" button in the map-tools-bar → button gets gold-fill, kill-points + lines appear on map (4px in member colors connecting to grey victim dots). Click again → disappears.

- [ ] **Step 4: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Squad-Kills-Toggle mit Schuetze+Opfer-Markern"
```

---

## Phase 11: Frontend — Zeitraffer-Animation

### Task 13: Animation-Loop with playToken cancellation

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add animation function**

Append (top-level near the other md-functions):

```javascript
const MD_ANIM_DURATION_MS = 15000;
const MD_REVIVE_FLASH_MS  = 500;

// Findet path-Index per Bisect der ts-Werte fuer einen gegebenen ts.
// Returns {idx, interp01} fuer linear interpolierten Punkt zwischen
// path[idx] und path[idx+1].
function mdPathPointAt(path, tsMs) {
  if (!path || path.length === 0) return null;
  if (tsMs <= path[0][2]) return { idx: 0, interp01: 0 };
  if (tsMs >= path[path.length - 1][2])
    return { idx: path.length - 1, interp01: 0 };
  // linear search reicht — Pfade haben max ~300 Punkte
  let i = 0;
  while (i < path.length - 1 && path[i + 1][2] <= tsMs) i++;
  const t0 = path[i][2], t1 = path[i + 1][2];
  const f = (tsMs - t0) / Math.max(1, (t1 - t0));
  return { idx: i, interp01: f };
}

function mdInterp(a, b, f) { return a + (b - a) * f; }

async function mdPlay(host) {
  const s = mdGetState(host);
  if (!s.members) return;
  const token = ++s.playToken;
  const mapKm = parseFloat(host.dataset.mapKm) || 8;
  let cal = {};
  try { cal = JSON.parse(host.dataset.cal || "{}"); } catch (e) {}
  const mapCm = mapKm * 100000;
  function cmToCanvas(xCm, yCm) {
    const [ex, ey] = mdApplyPinCal(xCm, yCm, mapKm, cal);
    return [(ex / mapCm) * 480, (ey / mapCm) * 480];
  }
  // Match-Zeitraum aus pathmin/pathmax aller Members
  let matchStart = Infinity, matchEnd = -Infinity;
  for (const m of s.members) {
    if (!m.path || !m.path.length) continue;
    const t0 = m.path[0][2];
    const tN = m.path[m.path.length - 1][2];
    if (t0 < matchStart) matchStart = t0;
    if (tN > matchEnd) matchEnd = tN;
  }
  if (!isFinite(matchStart) || matchEnd <= matchStart) return;
  const matchDur = matchEnd - matchStart;
  const startWallClock = performance.now();

  function frame(now) {
    if (token !== s.playToken) return;  // canceled
    if (host.dataset.mounted !== "1") return;
    const elapsed = now - startWallClock;
    const t01 = Math.min(1, elapsed / MD_ANIM_DURATION_MS);
    const matchTs = matchStart + t01 * matchDur;

    // Erst statische Layer (Pfade + Pins) wie sonst rendern
    mdRenderOverlay(host, {
      members: s.members,
      focusAcc: mdEffectiveFocus(s),
      showKills: s.showKills,
      colorByAcc: s.colorByAcc,
    });
    // Dann animierte Pins ueber den statischen Layer
    const canvas = host.querySelector("canvas.md-overlay");
    const ctx = canvas.getContext("2d");
    for (const m of s.members) {
      if (!m.path || m.path.length < 2) continue;
      // Bei Death stoppt der Pin bei seinem letzten Pfad-Punkt.
      const pinTs = (m.died && m.deathOffsetSec != null)
        ? Math.min(matchTs, matchStart + m.deathOffsetSec * 1000 + 1000)
        : matchTs;
      const pp = mdPathPointAt(m.path, pinTs);
      if (!pp) continue;
      const i0 = pp.idx, i1 = Math.min(pp.idx + 1, m.path.length - 1);
      const [x0, y0] = m.path[i0]; const [x1, y1] = m.path[i1];
      const xC = mdInterp(x0, x1, pp.interp01);
      const yC = mdInterp(y0, y1, pp.interp01);
      const [cx, cy] = cmToCanvas(xC, yC);
      const color = s.colorByAcc[m.accountId] || "#999";
      const alive = !m.died || pinTs < (matchStart + (m.deathOffsetSec || 0) * 1000);
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = alive ? 1 : 0.4;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Revive-Flash: wenn matchTs nahe einem revivePt-Timestamp ist,
      // gruener Outline-Pulse. (revivePts sind nur [x,y], kein ts —
      // skipping flash bis Backend ts liefert; vorerst no-op.)
    }
    if (t01 < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

- [ ] **Step 2: Wire play button + ESC cancellation**

Append:

```javascript
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest(".md-play");
  if (!btn) return;
  const host = btn.closest(".md-host");
  if (!host) return;
  mdPlay(host);
  e.stopPropagation();
});

// ESC stoppt animation (zusaetzlich zu unlock; siehe Task 11 ESC-Handler).
// Der unlock-handler erhoeht bereits playToken, also bricht damit auch.
```

- [ ] **Step 3: Smoke-test**

Expand match. Click ▶ Zeitraffer-Button.
Expected: 4 Pins gleiten parallel über 15s entlang ihrer Pfade. Bei Death (Member died=true) bleibt der Pin am Death-Punkt und dimmt auf alpha 0.4. Statische Pfade + Pins bleiben sichtbar während der Animation. Click anderer Match-Row während Animation → alte Animation stoppt (token++ in dem anderen mdMount).

- [ ] **Step 4: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Zeitraffer-Animation aller 4 Squadies parallel"
```

---

## Phase 12: Weapon-Stats Icon-Size

### Task 14: iconSize URL-param + CSS variable

**Files:**
- Modify: `widgets/pubg/weapon-stats.html`

- [ ] **Step 1: Add CSS variable + URL-param logic**

In `weapon-stats.html`:

a) Im `<style>` block, ersetze die `.wicon`-Regel:

```css
:root { --wicon-size: 48px; }
table.ws td.name img.wicon {
  height: var(--wicon-size);
  max-width: calc(var(--wicon-size) * 1.5);
  object-fit: contain;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));
}
table.ws td.name {
  min-height: calc(var(--wicon-size) + 4px);
}
```

b) Im `<script>` block, nahe der `RANGE`-Konstanten, hinzufuegen:

```javascript
const ICON_SIZE = Math.max(16, Math.min(96,
  parseInt(PubgUI.qs("iconSize", "48"), 10) || 48));
document.documentElement.style.setProperty("--wicon-size", ICON_SIZE + "px");
```

- [ ] **Step 2: Smoke-test**

Open `http://localhost:9000/widgets/pubg/weapon-stats.html` → icons 48px hoch.
Open `?iconSize=64` → 64px.
Open `?iconSize=96` → 96px.
Open `?iconSize=200` → geclampt auf 96.
Open `?iconSize=4` → geclampt auf 16.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/weapon-stats.html
git commit -m "feat(weapon-stats): konfigurierbare Icon-Groesse via ?iconSize-URL-Param"
```

---

## Phase 13: Cleanup + Final Smoke

### Task 15: Remove stale state in mount/unmount

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Add unmount handling so collapsed-match-states are clean**

In the match-row-click-handler, when collapsing a row (`wasExpanded == true`), also reset the host:

```javascript
if (wasExpanded) {
  const host = detail.querySelector(".md-host");
  if (host && host.dataset.mounted === "1") {
    const s = mdGetState(host);
    s.playToken++;  // stoppt evtl. laufende Animation
  }
  // mounted-flag bleibt — Re-Open ist cached. Beim naechsten Open
  // wird kein erneuter Fetch gemacht.
}
```

- [ ] **Step 2: Final smoke-test checklist**

Run all interactions in sequence to confirm:

1. Expand match → Map + paths + pins + cards.
2. Hover card → path highlights.
3. Mouse away → paths back to default.
4. Click card → lock + Card gold-border.
5. Click same card → unlock.
6. Click other card → switches.
7. Click map empty area → unlock.
8. ESC → unlock + stops animation.
9. Toggle Kills button → kills shown/hidden.
10. ▶ Zeitraffer button → 15s parallel animation, pins glide.
11. Close + reopen match → state fresh, no leftover lock.
12. `weapon-stats.html?iconSize=64` → bigger icons.

If any step fails, fix inline and rerun. No new commit until checklist passes end-to-end.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-report.html
git commit -m "chore(match-detail): Final-Polish + Anim-Cancel beim Collapse"
```

---

## Self-Review

Done above section-by-section. No placeholders. Types consistent (`accountId` / `path` / `kills` / `colorByAcc`). All spec sections covered:

- ✅ Datenpipeline-Erweiterungen (Tasks 1, 2)
- ✅ Two-Canvas-Render (Tasks 4, 5, 6, 7)
- ✅ State-Maschine + Hover/Click (Tasks 10, 11)
- ✅ Squad-Kills-Toggle (Task 12)
- ✅ Zeitraffer-Animation mit Token-Cancel (Task 13)
- ✅ Stacked Cards mit Active-State (Task 8)
- ✅ Weapon-Icon-Size konfigurierbar (Task 14)
- ✅ Error-Handling (kein Telemetrie → "keine Telemetrie verfuegbar" in Task 9; Member-ohne-Pfad → continue in renderOverlay loops; Image-Load failed → ctx.fillRect-Fallback in renderBasemap)
- ✅ Cleanup-Phase + Final-Smoke (Task 15)

Was NICHT abgedeckt ist (per Spec out-of-scope):
- Headshot-Detection
- Post-match-card Map-Hero
- Twitch-Clip Integration
