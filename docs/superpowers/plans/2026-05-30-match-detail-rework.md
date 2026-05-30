# Match-Detail Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match-Detail wird Slide-In-Panel (~90% Viewport) statt Inline-Expand, bekommt eine chronologische Event-Timeline (Knocks/Kills/Revives mit Fahrzeug-Kontext), und Monats-Tiles in der Session-Liste werden collapsible.

**Architecture:** Backend ergänzt `compute_match_detail` um ein squad-bezogenes `events[]`-Feld (chronologische Knock/Kill/Revive-Events aller Squad-Mitglieder, mit Vehicle-Kontext). Frontend-Widget `widgets/pubg/session-report.html` bekommt einen Slide-In-Panel-DOM (am Body-Ende), Match-Row-Klick öffnet das Panel statt inline auszuklappen. Das Panel re-nutzt die existierende `mdMount`-Logik (Map, Scrub, Squad-Tabelle, Cards) und ergänzt eine Timeline-Sektion mit Filter-Chips. Monats-Tabs werden zu `<details>`-Blöcken mit LocalStorage-Persistenz.

**Tech Stack:** Python 3.14 + Flask (Backend), Vanilla JS + CSS (Frontend), pytest (Backend-Tests). Material Symbols für Icons.

**Spec:** `docs/superpowers/specs/2026-05-30-match-detail-rework-design.md`

**Master-Only Commit-Policy:** Direkt auf `master` committen, kein Feature-Branch, kein Worktree, KEIN Co-Authored-By-Trailer. Push erst am Ende per Task explicit.

---

## File Map

| Datei | Verantwortung | Op |
|---|---|---|
| `pubg/aggregations.py` | `compute_match_detail` ergänzt um Squad-Event-Query + `events[]`-Response-Feld | Modify |
| `widgets/pubg/session-report.html` | DOM (Slide-In Panel + Monats-Gruppen), CSS (Panel + Timeline + Month-Group), JS (Panel open/close/hash, Timeline render+filter, Month-Group LocalStorage, alte Inline-Expand entfernen) | Modify |

Backend-Test infrastruktur für Match-Detail ist sparse; siehe `tests/pubg/` für vorhandene Fixtures. Wenn ein passender Match-Detail-Test fehlt, fügen wir minimal-invasiven Coverage hinzu.

---

## Task 1: Backend — Squad-Event-Liste in `compute_match_detail`

**Files:**
- Modify: `pubg/aggregations.py:986-1360` (Funktion `compute_match_detail`)

- [ ] **Step 1: Squad-Account-Liste vor dem Member-Loop sammeln**

In `compute_match_detail`, nach Zeile 1044 (`members_rows` Query), füge ein:

```python
    squad_accs = [r["account_id"] for r in members_rows if r["account_id"]]
    if not squad_accs:
        return {"matchId": match_id, "mapName": map_name, "members": [], "events": []}
```

(Die existierende Early-Return-Zeile 1037 wird durch dieses ersetzt, damit auch der `events`-Key gesetzt ist.)

- [ ] **Step 2: Per-Member Vehicle-Intervalle nach dem Loop in einem Dict sammeln**

Innerhalb des bestehenden `for mem in members_rows`-Loops (ab Zeile 1046) wird `veh_intervals` schon gebaut. Sammle es jetzt zusätzlich nach Member-Account in ein Dict, das nach dem Loop verfügbar ist.

Direkt vor dem Loop (vor Zeile 1046) initialisieren:

```python
    veh_intervals_by_acc = {}
```

Im Loop, nach dem Aufbau von `veh_intervals` (nach dem Block der bei `_cur_enter is not None: veh_intervals.append(...)` endet, also direkt vor `def _vehicle_label_at(ts)`), ergänzen:

```python
        veh_intervals_by_acc[acc] = list(veh_intervals)
```

- [ ] **Step 3: Squad-weiter Event-Query nach dem Loop**

Direkt nach dem `for mem in members_rows`-Loop und vor `out_members.sort(...)`, neuen Block einfügen:

```python
    # Squad-weite Event-Liste fuer Match-Detail-Timeline. Holt Knock/Kill/
    # Revive-Events bei denen actor ODER target ein Squad-Mitglied ist,
    # chronologisch sortiert. Pro Event werden dealt/taken-Perspektive(n)
    # in die finale Liste geschrieben.
    ph_sq = ",".join(["?"] * len(squad_accs))
    sq_events_rows = conn.execute(f"""
        SELECT event_type, timestamp_ms, actor_account, target_account,
               victim_x, victim_y, weapon, distance
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('Kill', 'Knock', 'Revive')
          AND (actor_account IN ({ph_sq}) OR target_account IN ({ph_sq}))
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id, *squad_accs, *squad_accs)).fetchall()

    # Name-Lookup fuer Actor/Target — Players + Match-Participants
    _name_cache = {}
    def _name_of(acc):
        if not acc:
            return None
        if acc in _name_cache:
            return _name_cache[acc]
        nrow = conn.execute("""
            SELECT COALESCE(p.name, pa.name) AS n
            FROM (SELECT NULL AS dummy) x
            LEFT JOIN players p ON p.tenant_id = ? AND p.account_id = ?
            LEFT JOIN participants pa ON pa.tenant_id = ? AND pa.match_id = ?
                  AND pa.account_id = ?
        """, (tenant_id, acc, tenant_id, match_id, acc)).fetchone()
        n = nrow["n"] if nrow else None
        _name_cache[acc] = n
        return n

    # Slot-Lookup nur fuer Squad-Members (out_members hat das schon)
    slot_by_acc = {mem["accountId"]: mem.get("slot") for mem in out_members}

    def _veh_label_for(acc, ts):
        """Vehicle-Label fuer einen Squad-Member zum Zeitpunkt ts.
        Non-Squad-Members liefern immer None (Vehicle-Intervalle nicht
        gequeried)."""
        if not acc or acc not in veh_intervals_by_acc:
            return None
        for a, b, vid in veh_intervals_by_acc[acc]:
            if a <= ts <= b and vid:
                for needle, label in _VEHICLE_PATTERNS:
                    if needle in vid:
                        return label
                return vid
        return None

    sq_set = set(squad_accs)
    events_out = []
    for e in sq_events_rows:
        et = e["event_type"]
        actor  = e["actor_account"]
        target = e["target_account"]
        ts     = e["timestamp_ms"]
        weapon = e["weapon"]
        weapon_name = _weapon_label(weapon)[0] if weapon else None
        dist_m = (round((e["distance"] or 0) / 100.0, 1)
                  if e["distance"] else None)
        victim_veh = _veh_label_for(target, ts)
        shooter_veh = _veh_label_for(actor, ts)
        # Pro Event je nach Squad-Perspektive 1 oder 2 Eintraege erzeugen.
        # Type-Map: ("Kill", actor_in_squad) -> kill_dealt, etc.
        perspectives = []
        if et == "Kill":
            if actor in sq_set:
                perspectives.append("kill_dealt")
            if target in sq_set:
                perspectives.append("kill_taken")
        elif et == "Knock":
            if actor in sq_set:
                perspectives.append("knock_dealt")
            if target in sq_set:
                perspectives.append("knock_taken")
        elif et == "Revive":
            if actor in sq_set:
                perspectives.append("revive_given")
            if target in sq_set:
                perspectives.append("revive_received")
        for ptype in perspectives:
            events_out.append({
                "tsMs":          ts,
                "type":          ptype,
                "actorAccount":  actor,
                "actorName":     _name_of(actor),
                "actorSlot":     slot_by_acc.get(actor),
                "targetAccount": target,
                "targetName":    _name_of(target),
                "targetSlot":    slot_by_acc.get(target),
                "weapon":        weapon,
                "weaponName":    weapon_name,
                "distanceM":     dist_m,
                "victimX":       e["victim_x"],
                "victimY":       e["victim_y"],
                "victimVehicleLabel":  victim_veh,
                "shooterVehicleLabel": shooter_veh,
            })
    # Sortiert nach tsMs (sq_events_rows war schon sortiert, aber durch
    # die 2-Perspektiven-Aufteilung leichte Reihenfolgewechsel moeglich)
    events_out.sort(key=lambda x: x["tsMs"] or 0)
```

- [ ] **Step 4: `events`-Feld ans Return-Dict anhängen**

Im finalen Return (Zeile ~1337) das `events`-Feld ergänzen:

```python
    return {
        "matchId":  match_id,
        "mapName":  map_name,
        "members":  out_members,
        "events":   events_out,
    }
```

(Die bestehenden Keys bleiben wie sie sind — nur `"events": events_out` neu dazu.)

- [ ] **Step 5: Manueller Smoke-Test des Backend-Calls**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python -c "
from app import create_app
app = create_app(testing=True)
with app.app_context():
    print('compute_match_detail import OK')
    from pubg.aggregations import compute_match_detail
    print('signature:', compute_match_detail.__doc__[:120])
"
```
Expected: `compute_match_detail import OK` und docstring-Anfang.

- [ ] **Step 6: App-Test-Suite — keine Regression**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && pytest tests/app/ -q
```
Expected: alle Tests PASS (gleicher Stand wie vorher).

- [ ] **Step 7: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add pubg/aggregations.py
git commit -m "feat(match-detail): events[]-Liste mit Knock/Kill/Revive + Vehicle-Kontext aller Squad-Member"
```

---

## Task 2: Frontend — Slide-In Panel Scaffolding (DOM + CSS + Open/Close)

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Panel-DOM am Body-Ende einfügen**

In `widgets/pubg/session-report.html`, direkt vor dem schließenden `</body>` (vor allen Script-Blöcken — also vor dem ersten `<script>` nach `<body>`-Content, suche nach dem letzten `</main>` oder vor `<script src="_pubg.js">`, gleich am Ende des `<body>`):

```html
<div id="mdPanel" class="md-panel" hidden role="dialog" aria-modal="true"
     aria-labelledby="mdPanelTitle">
  <div class="md-panel__backdrop" data-md-close></div>
  <div class="md-panel__sheet" role="document">
    <header class="md-panel__header">
      <h2 id="mdPanelTitle" class="md-panel__title">Match-Detail</h2>
      <button class="md-panel__close" data-md-close type="button"
              aria-label="Match-Detail schließen">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="md-panel__body" id="mdPanelBody"></div>
  </div>
</div>
```

- [ ] **Step 2: CSS für Panel ans Ende des `<style>`-Blocks im `<head>` einfügen**

Suche im `<head>` den letzten `</style>`-Tag und ergänze davor:

```css
/* ─── Slide-In Match-Detail Panel ───────────────────────────────────── */
.md-panel {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; justify-content: flex-end;
}
.md-panel[hidden] { display: none; }
.md-panel__backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(2px);
  opacity: 0;
  transition: opacity 220ms ease;
}
.md-panel.is-open .md-panel__backdrop { opacity: 1; }
.md-panel__sheet {
  position: relative;
  width: 90vw; max-width: 1600px;
  height: 100vh;
  background: var(--pubg-purple-bg);
  border-left: 1px solid var(--pubg-border);
  transform: translateX(100%);
  transition: transform 220ms ease;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.md-panel.is-open .md-panel__sheet { transform: translateX(0); }
.md-panel__header {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px;
  background: rgba(20, 12, 30, 0.95);
  border-bottom: 1px solid var(--pubg-border);
}
.md-panel__title {
  margin: 0;
  color: var(--pubg-gold);
  font-size: 1.05em; font-weight: 700;
  letter-spacing: 0.04em;
}
.md-panel__close {
  background: transparent; border: 0;
  color: var(--pubg-text);
  cursor: pointer;
  padding: 6px; border-radius: 6px;
  min-width: 44px; min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
}
.md-panel__close:hover { background: rgba(255,255,255,0.08); }
.md-panel__close:focus-visible {
  outline: 2px solid var(--pubg-gold);
  outline-offset: 2px;
}
.md-panel__body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 32px;
}
@media (max-width: 767px) {
  .md-panel__sheet { width: 100vw; max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .md-panel__backdrop, .md-panel__sheet { transition: none; }
}
```

- [ ] **Step 3: JS-Open/Close-Funktionen im letzten Script-Block einfügen**

Suche den letzten `<script>`-Block (der die meiste App-Logik enthält, beginnt mit `const FROM = PubgUI.qs("from", "");`), und am Ende dieses Blocks (vor `</script>`) ergänzen:

```js
    // ── Slide-In Match-Detail Panel ───────────────────────────────────
    let _mdPanelLastFocused = null;
    let _mdPanelCurrentId = null;

    function mdPanelOpen(matchId) {
      const panel = document.getElementById("mdPanel");
      const title = document.getElementById("mdPanelTitle");
      const body  = document.getElementById("mdPanelBody");
      if (!panel || !body) return;
      if (_mdPanelCurrentId === matchId && !panel.hidden) return;
      _mdPanelLastFocused = document.activeElement;
      _mdPanelCurrentId = matchId;
      // Body: existierende mdMount-Logik nutzen via md-host
      body.innerHTML = `
        <div class="md-host" data-match-id="${matchId}" data-map=""
             data-table=""></div>
        <section class="md-timeline" id="mdTimelineSection" hidden></section>`;
      title.textContent = "Match-Detail · lädt …";
      const host = body.querySelector(".md-host");
      mdMount(host);
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add("is-open"));
      document.body.style.overflow = "hidden";
      // URL-Hash setzen (replace damit der Open kein Doppel-State erzeugt)
      const newHash = "#match=" + encodeURIComponent(matchId);
      if (location.hash !== newHash) {
        history.pushState({ matchId }, "", newHash);
      }
      // Focus auf Close-Button
      const closeBtn = panel.querySelector(".md-panel__close");
      if (closeBtn) closeBtn.focus();
    }

    function mdPanelClose() {
      const panel = document.getElementById("mdPanel");
      if (!panel || panel.hidden) return;
      panel.classList.remove("is-open");
      const finish = () => {
        panel.hidden = true;
        document.body.style.overflow = "";
        _mdPanelCurrentId = null;
        if (_mdPanelLastFocused && _mdPanelLastFocused.focus) {
          _mdPanelLastFocused.focus();
        }
      };
      // Wenn reduced-motion: sofort schließen, sonst nach Transition
      const reduced = window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) finish();
      else setTimeout(finish, 230);
      if (location.hash.includes("match=")) {
        history.pushState({}, "", location.pathname + location.search);
      }
    }

    // Backdrop + X + Esc-Handling
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-md-close]")) mdPanelClose();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const panel = document.getElementById("mdPanel");
      if (panel && !panel.hidden) mdPanelClose();
    });

    // Browser-Back → öffnet/schließt Panel je nach Hash
    window.addEventListener("popstate", () => {
      const m = (location.hash || "").match(/match=([^&]+)/);
      if (m) mdPanelOpen(decodeURIComponent(m[1]));
      else mdPanelClose();
    });

    // Deep-Link: bei Page-Load nach #match=<id> schauen.
    // Da die Session-Liste asynchron lädt, warten wir 800ms damit
    // mdMount eine Match-ID greifen kann (sonst nur Telemetrie-Fetch
    // — der funktioniert ohnehin matchId-only).
    document.addEventListener("DOMContentLoaded", () => {
      const m = (location.hash || "").match(/match=([^&]+)/);
      if (m) mdPanelOpen(decodeURIComponent(m[1]));
    });
```

- [ ] **Step 4: Manueller Smoke-Test im Browser**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python serve.py 9100 &
sleep 2
curl -s -H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: stats-overlay.info" \
  http://localhost:9100/widgets/pubg/session-report.html | grep -c 'id="mdPanel"'
kill %1 2>/dev/null; wait %1 2>/dev/null
```
Expected: `1` (Panel-DOM ist im gerenderten HTML).

- [ ] **Step 5: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Slide-In Panel-DOM + CSS + Open/Close/Hash/Esc — noch nicht verkabelt"
```

---

## Task 3: Frontend — Match-Row-Click migrieren, Inline-Expand entfernen

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Inline-Expand-Click-Handler durch Panel-Open ersetzen**

Suche im Script-Block den Block ab Zeile ~2950 mit Kommentar `// Click-Handler: Match-Zeile expandiert Squad-Detail` (Pattern `e.target.closest(".m[data-idx]")`). Ersetze den kompletten Block durch:

```js
    // Click-Handler: Match-Zeile öffnet Slide-In Match-Detail-Panel
    document.addEventListener("click", (e) => {
      const row = e.target.closest(".m[data-idx]");
      if (!row) return;
      const mid = row.getAttribute("data-match-id");
      if (!mid) return;
      mdPanelOpen(mid);
    });
```

- [ ] **Step 2: `fmtSquadDetail` und das inline-`<div class="squad-detail">` entfernen**

In `fmtMatchRow` (Zeile ~2275) wird aktuell ein zweites Element zurückgegeben:

```js
        <div class="squad-detail" data-idx-detail="${idx}">${fmtSquadDetail(m)}</div>`;
```

Diese Zeile löschen, sodass `fmtMatchRow` nur noch das `<div class="m ..."></div>`-Element zurückgibt. Suche das `return \`` in `fmtMatchRow` und entferne die `<div class="squad-detail" …>`-Zeile.

Beispiel — vorher:
```js
      return `
        <div class="m ${isWin && !isEvent ? 'win' : ''}${isEvent ? ' is-event' : ''}" data-idx="${idx}" data-match-id="${m.matchId || ''}"${dimAttr}>
          ...
        </div>
        <div class="squad-detail" data-idx-detail="${idx}">${fmtSquadDetail(m)}</div>`;
```

Nachher:
```js
      return `
        <div class="m ${isWin && !isEvent ? 'win' : ''}${isEvent ? ' is-event' : ''}" data-idx="${idx}" data-match-id="${m.matchId || ''}"${dimAttr}>
          ...
        </div>`;
```

- [ ] **Step 3: `fmtSquadDetail`-Funktion komplett entfernen**

Suche im Script `function fmtSquadDetail(m) {` (Zeile ~2182) und entferne die gesamte Funktion (von `function fmtSquadDetail(m) {` bis zur korrespondierenden schließenden `}` der Funktion).

Begründung: `fmtSquadDetail` baute den Inline-Detail-Inhalt. Im Slide-In-Panel wird stattdessen direkt `mdMount` auf einen frisch erzeugten `.md-host`-Div angewendet (Panel-Open in Task 2 macht das schon). Die Squad-Tabelle wird dabei nicht mehr separat als Pre-rendered HTML übergeben — `mdMount` erwartet sie via `data-table`-Attribut, das jetzt leer ist (`data-table=""`).

→ **Konsequenz:** `mdMount` muss die Squad-Tabelle selbst rendern können, wenn `data-table` leer ist. Siehe Step 4.

- [ ] **Step 4: `mdMount` fallback bauen, wenn `data-table` leer ist**

Suche `async function mdMount(host)` (Zeile ~1571). Direkt nach:

```js
      const tableHtml = decodeURIComponent(host.getAttribute("data-table") || "");
```

ergänze einen Fallback der die Squad-Tabelle direkt aus dem geladenen Match-Detail-Response rendert. Ersetze den nachfolgenden Block bis zum Ende der `host.innerHTML = ...`-Zuweisung, sodass die rechte Spalte nur `<div class="squad-table-wrap"></div>` enthält (Inhalt wird in Step 5 nach `mdLoad` befüllt):

Konkret: die Zeile

```js
            <div class="squad-table-wrap">${tableHtml}</div>
```

ersetzen durch:

```js
            <div class="squad-table-wrap" id="mdSquadTableWrap_${matchId}"></div>
```

- [ ] **Step 5: Squad-Tabelle nach mdLoad clientseitig rendern**

Suche im selben `mdMount` den Block ab `const md = await mdLoad(matchId);` (Zeile ~1612). Nach `s.colorByAcc = md.colorByAcc;` (Zeile ~1620) ergänzen:

```js
      // Squad-Tabelle aus Match-Detail-Response rendern.
      // Liefert das gleiche `<table>` wie zuvor fmtSquadDetail im
      // session-report-Kontext — aber datenbasiert aus md.detail.members
      // statt aus dem Session-Match-Objekt.
      const tableWrap = host.querySelector(
        `#mdSquadTableWrap_${CSS.escape(matchId)}`);
      if (tableWrap && md && md.detail && md.detail.members) {
        tableWrap.innerHTML = renderMdSquadTable(md.detail.members,
                                                  md.colorByAcc);
      }
      // Panel-Titel aktualisieren (Map + Match-Nr + Uhrzeit)
      const panelTitle = document.getElementById("mdPanelTitle");
      if (panelTitle && md && md.detail) {
        const mapLbl = PubgUI.fmtMap(md.detail.mapName);
        panelTitle.textContent = `Match · ${mapLbl}`;
      }
```

Und neue Helper-Funktion `renderMdSquadTable` einfügen — direkt vor `function mdMount(host)`:

```js
    function renderMdSquadTable(members, colorByAcc) {
      const rows = members.map(m => {
        const color = colorByAcc[m.accountId] || "#999";
        const slotLbl = (m.slot != null) ? `Slot ${m.slot}` : "";
        const lives = m.lives || [];
        const totalKills = lives.reduce((n, l) =>
          n + ((l.kills || []).length), 0);
        const died = lives.some(l => l.death);
        return `<tr>
          <td><span class="md-dot" style="background:${color}"></span>
              <b>${m.name}${m.isSelf ? " (du)" : ""}</b>
              <span style="color:var(--pubg-muted);font-size:0.8em;margin-left:6px">${slotLbl}</span></td>
          <td style="text-align:right">${totalKills}</td>
          <td style="text-align:right">${died ? "✗" : "✓"}</td>
        </tr>`;
      }).join("");
      return `<table class="md-squad-table">
        <thead><tr><th>Member</th><th style="text-align:right">Kills</th><th style="text-align:right">Surv.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }
```

- [ ] **Step 6: Tote CSS `.squad-detail` Rules NICHT löschen**

Begründung: Die Rules `.squad-detail`, `.squad-detail.show`, `.squad-detail .detail-row`, `.squad-detail table`, etc. (Zeile ~147-237) werden nicht mehr von HTML gematched. Trotzdem nicht entfernen, da sie als Referenz für die `md-squad-table`-Cascade nützlich bleiben können. **Aber** — die Klasse `.squad-detail` wird durch `.md-squad-table` ersetzt. Füge ans Ende der bestehenden Style-Sektion (im `<head>`, nach den Squad-Detail-Rules) hinzu:

```css
/* Slide-In: Squad-Tabelle (clientseitig aus md.detail.members gerendert) */
.md-squad-table {
  width: 100%; border-collapse: collapse;
  margin-bottom: 12px;
  font-size: 0.92em;
}
.md-squad-table th {
  text-align: left; padding: 6px 8px;
  color: var(--pubg-muted);
  font-size: 0.78em; text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.md-squad-table td {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.md-squad-table .md-dot {
  display: inline-block; width: 10px; height: 10px;
  border-radius: 50%; margin-right: 6px;
  vertical-align: -1px;
}
```

- [ ] **Step 7: Manueller Browser-Smoke-Test**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python serve.py 9100 &
sleep 2
curl -s -H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: stats-overlay.info" \
  http://localhost:9100/widgets/pubg/session-report.html | head -1
kill %1 2>/dev/null; wait %1 2>/dev/null
```
Expected: `<!DOCTYPE html>` oder gleichwertig — die Seite rendert ohne JS-Fehler beim Serve.

- [ ] **Step 8: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Inline-Expand entfernt; Match-Row oeffnet Slide-In Panel + clientseitige Squad-Tabelle"
```

---

## Task 4: Frontend — Timeline-Rendering + Filter-Chips

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: Timeline-CSS einfügen**

Im `<head>`-`<style>`-Block, am Ende, ergänzen:

```css
/* ─── Match-Detail Timeline ─────────────────────────────────────────── */
.md-timeline {
  margin-top: 18px;
  border-top: 1px solid var(--pubg-border);
  padding-top: 12px;
}
.md-timeline__head {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
  margin-bottom: 10px;
}
.md-timeline__title {
  color: var(--pubg-gold);
  font-size: 1em; font-weight: 700;
  margin: 0;
  cursor: pointer;
  list-style: none;
}
.md-timeline__title::-webkit-details-marker { display: none; }
.md-timeline__filters {
  display: inline-flex; gap: 6px; flex-wrap: wrap;
}
.md-timeline__chip {
  background: transparent;
  color: var(--pubg-muted);
  border: 1px solid var(--pubg-border);
  border-radius: 100px;
  padding: 4px 12px;
  font: inherit; font-size: 12px;
  cursor: pointer;
  min-height: 32px;
}
.md-timeline__chip:hover { color: var(--pubg-text); }
.md-timeline__chip.is-active {
  background: var(--pubg-purple);
  color: #fff;
  border-color: var(--pubg-purple);
}
.md-timeline__chip:focus-visible {
  outline: 2px solid var(--pubg-gold); outline-offset: 2px;
}
.md-timeline__list {
  display: flex; flex-direction: column;
  gap: 2px;
  font-size: 0.92em;
  font-variant-numeric: tabular-nums;
}
.md-tl-row {
  display: grid;
  grid-template-columns: 78px minmax(90px, 130px) 28px 1fr auto;
  gap: 8px;
  padding: 4px 6px;
  align-items: baseline;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.md-tl-t      { color: var(--pubg-text); }
.md-tl-actor  { font-weight: 700; }
.md-tl-arrow  { color: var(--pubg-muted); text-align: center; }
.md-tl-rest b { color: var(--pubg-text); }
.md-tl-rest .md-tl-veh {
  color: var(--pubg-gold);
  font-size: 0.92em;
  margin-left: 6px;
}
.md-tl-meta {
  color: var(--pubg-muted);
  font-size: 0.85em;
  white-space: nowrap;
}
.md-tl-empty {
  color: var(--pubg-muted);
  font-style: italic;
  padding: 12px 0;
}
@media (max-width: 600px) {
  .md-tl-row {
    grid-template-columns: 64px minmax(80px, 1fr) 22px 1fr;
  }
  .md-tl-meta { grid-column: 1 / -1; padding-left: 86px; }
}
```

- [ ] **Step 2: Timeline-Render-Funktionen einfügen**

Im Script-Block, direkt vor `function mdMount(host)`, ergänzen:

```js
    // ── Match-Detail Timeline (collapsible, gefiltert) ────────────────
    const _MD_TIMELINE_TYPE_LABEL = {
      knock_dealt:     ["knocked",       "&rarr;"],
      knock_taken:     ["geknockt von",  "&larr;"],
      kill_dealt:      ["killed",        "&rarr;"],
      kill_taken:      ["gekillt von",   "&larr;"],
      revive_given:    ["revived",       "&rarr;"],
      revive_received: ["revived von",   "&larr;"],
    };
    const _MD_TIMELINE_FILTERS = [
      ["all",     "Alle",    null],
      ["me",      "Du",      null],
      ["knocks",  "Knocks",  ["knock_dealt", "knock_taken"]],
      ["kills",   "Kills",   ["kill_dealt", "kill_taken"]],
      ["revives", "Revives", ["revive_given", "revive_received"]],
    ];

    function mdTlFmtAbsClock(playedAtIso, msIntoMatch) {
      if (!playedAtIso) return "?";
      const start = Date.parse(playedAtIso);
      if (isNaN(start)) return "?";
      const d = new Date(start + (msIntoMatch || 0));
      return `${String(d.getHours()).padStart(2,"0")}:` +
             `${String(d.getMinutes()).padStart(2,"0")}:` +
             `${String(d.getSeconds()).padStart(2,"0")}`;
    }

    function mdTlPickColor(slot, colorByAcc, account) {
      if (account && colorByAcc && colorByAcc[account]) return colorByAcc[account];
      if (slot >= 1 && slot <= MD_SLOT_COLORS.length)
        return MD_SLOT_COLORS[slot - 1];
      return "var(--pubg-muted)";
    }

    function mdTlRowHtml(ev, ctx) {
      const [verbLbl, arrow] = _MD_TIMELINE_TYPE_LABEL[ev.type] || [ev.type, "·"];
      const tCell = mdTlFmtAbsClock(ctx.playedAt, ev.tsMs);
      const actorColor = mdTlPickColor(ev.actorSlot, ctx.colorByAcc,
                                        ev.actorAccount);
      const actorName  = ev.actorName || "?";
      const targetName = ev.targetName || "?";
      // POI clientseitig aus victimX/Y
      let poi = "";
      if (ctx.mapName && PubgUI.POI && PubgUI.POI.fromCoords
          && ev.victimX != null && ev.victimY != null) {
        const p = PubgUI.POI.fromCoords(ctx.mapName, ev.victimX, ev.victimY);
        if (p) poi = `<span class="md-tl-poi">· ${p}</span>`;
      }
      const vehVictim  = ev.victimVehicleLabel
        ? ` <span class="md-tl-veh">aus <b>${ev.victimVehicleLabel}</b></span>`
        : "";
      const vehShooter = ev.shooterVehicleLabel
        ? ` <span class="md-tl-veh">aus eigenem <b>${ev.shooterVehicleLabel}</b></span>`
        : "";
      const weapon = ev.weaponName ? `<b>${ev.weaponName}</b>` : "";
      const dist   = ev.distanceM ? ` · ${ev.distanceM.toFixed(0)}m` : "";
      const meta   = (weapon || dist) ? `${weapon}${dist}` : "";
      return `<div class="md-tl-row" data-ev-type="${ev.type}"
                   data-ev-me="${ev.actorAccount === ctx.myAccount
                                  || ev.targetAccount === ctx.myAccount}">
        <span class="md-tl-t">${tCell}</span>
        <span class="md-tl-actor" style="color:${actorColor}">${actorName}</span>
        <span class="md-tl-arrow">${arrow}</span>
        <span class="md-tl-rest">${verbLbl} <b>${targetName}</b>${vehVictim}${vehShooter} ${poi}</span>
        <span class="md-tl-meta">${meta}</span>
      </div>`;
    }

    function renderMdTimeline(events, ctx) {
      const filters = _MD_TIMELINE_FILTERS.map(([key, lbl]) =>
        `<button type="button" class="md-timeline__chip${key === "all" ? " is-active" : ""}"
                 data-tl-filter="${key}">${lbl}</button>`).join("");
      if (!events || !events.length) {
        return `<details class="md-timeline-details" open>
          <summary class="md-timeline__title">Timeline</summary>
          <div class="md-tl-empty">Keine Squad-Events in diesem Match.</div>
        </details>`;
      }
      const rows = events.map(ev => mdTlRowHtml(ev, ctx)).join("");
      return `<details class="md-timeline-details" open>
        <summary class="md-timeline__title">Timeline (${events.length} Events)</summary>
        <div class="md-timeline__head">
          <div class="md-timeline__filters">${filters}</div>
        </div>
        <div class="md-timeline__list">${rows}</div>
      </details>`;
    }

    function wireMdTimelineFilters(rootEl, myAccount) {
      const chips = rootEl.querySelectorAll(".md-timeline__chip");
      const rows  = rootEl.querySelectorAll(".md-tl-row");
      chips.forEach(chip => {
        chip.addEventListener("click", () => {
          chips.forEach(c => c.classList.remove("is-active"));
          chip.classList.add("is-active");
          const key = chip.getAttribute("data-tl-filter");
          const spec = _MD_TIMELINE_FILTERS.find(f => f[0] === key);
          const allow = spec ? spec[2] : null;
          rows.forEach(r => {
            const t = r.getAttribute("data-ev-type");
            const me = r.getAttribute("data-ev-me") === "true";
            let show = true;
            if (key === "me") show = me;
            else if (allow) show = allow.indexOf(t) >= 0;
            r.style.display = show ? "" : "none";
          });
        });
      });
    }
```

- [ ] **Step 3: mdMount — Timeline-Sektion nach Squad-Tabelle füllen**

Im `mdMount`-Block, in dem Step-5 von Task 3 die Squad-Tabelle rendert, direkt nach dem panelTitle-Block ergänzen:

```js
      // Timeline-Sektion fuellen (nur sichtbar wenn Slide-In aktiv ist —
      // dort gibt es <section id="mdTimelineSection">)
      const tlSect = document.getElementById("mdTimelineSection");
      if (tlSect && md && md.detail) {
        tlSect.hidden = false;
        const myAcc = (md.detail.members.find(x => x.isSelf) || {}).accountId;
        const ctx = {
          playedAt:    null,  // wird via /api/pubg/match-detail nicht direkt
                              // geliefert; clientseitig aus Session-Match
                              // gesucht falls verfuegbar.
          mapName:     md.detail.mapName,
          colorByAcc:  md.colorByAcc,
          myAccount:   myAcc,
        };
        // playedAt aus Session-Match-Liste suchen (window._allMatchIds
        // sortiert Matches in chrono Order — wir matchen via matchId)
        const matchIdAttr = host.getAttribute("data-match-id");
        try {
          const sessMatch = (window._allMatchIds || []).indexOf(matchIdAttr);
          if (sessMatch >= 0 && window._allMatchesByIdx
              && window._allMatchesByIdx[sessMatch]) {
            ctx.playedAt = PubgUI.matchStartIso(
              window._allMatchesByIdx[sessMatch].matchEnd,
              window._allMatchesByIdx[sessMatch].durationSec);
          }
        } catch (_) {}
        tlSect.innerHTML = renderMdTimeline(md.detail.events || [], ctx);
        wireMdTimelineFilters(tlSect, myAcc);
      }
```

- [ ] **Step 4: `window._allMatchesByIdx` befüllen**

Suche im Script-Block den Block `window._allMatchIds = _sorted.map(m => m.matchId ...)` (in `renderSessionSummary`, Zeile ~2415). Direkt darunter ergänzen:

```js
      window._allMatchesByIdx = _sorted;
```

Damit liefert `window._allMatchesByIdx[i]` das vollständige Match-Objekt mit `matchEnd` + `durationSec` für die playedAt-Berechnung.

- [ ] **Step 5: Manueller Smoke**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python serve.py 9100 &
sleep 2
curl -s http://localhost:9100/healthz
echo
kill %1 2>/dev/null; wait %1 2>/dev/null
```
Expected: `{"status":"ok"}`.

- [ ] **Step 6: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add widgets/pubg/session-report.html
git commit -m "feat(match-detail): Event-Timeline mit Filter-Chips (Alle/Du/Knocks/Kills/Revives)"
```

---

## Task 5: Frontend — Monats-Tabs zu collapsible `<details>`-Gruppen

**Files:**
- Modify: `widgets/pubg/session-report.html`

- [ ] **Step 1: CSS für Month-Group ans Ende des Style-Blocks**

```css
/* ─── Monats-Gruppen in der Session-Picker-Liste ────────────────────── */
.month-group {
  border: 1px solid var(--pubg-border);
  border-radius: var(--pubg-radius);
  margin-bottom: 8px;
  background: rgba(20, 12, 30, 0.4);
}
.month-group > summary.month-group__head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  min-height: 44px;
}
.month-group > summary.month-group__head::-webkit-details-marker { display: none; }
.month-group__name {
  flex: 1;
  color: var(--pubg-gold);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.month-group__count {
  color: var(--pubg-muted);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
}
.month-group__chev {
  color: var(--pubg-muted);
  transition: transform 180ms ease;
}
.month-group[open] > summary .month-group__chev { transform: rotate(180deg); }
.month-group__body {
  padding: 0 10px 10px;
}
.month-group > summary:focus-visible {
  outline: 2px solid var(--pubg-gold);
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  .month-group__chev { transition: none; }
}
```

- [ ] **Step 2: `renderItems`-Funktion umbauen**

Suche `function renderItems()` (Zeile ~2110) und ersetze den Body komplett durch eine Variante die `<details>`-Gruppen pro Monat baut:

```js
    function renderItems() {
      const months = [...new Set(allSessions.map(s => monthKey(s.from)))]
        .sort().reverse();
      const sortFns = {
        newest:  (a, b) => b.from.localeCompare(a.from),
        oldest:  (a, b) => a.from.localeCompare(b.from),
        wins:    (a, b) => (b.wins||0) - (a.wins||0) || b.from.localeCompare(a.from),
        matches: (a, b) => (b.matches||0) - (a.matches||0) || b.from.localeCompare(a.from),
        kills:   (a, b) => (b.kills||0) - (a.kills||0) || b.from.localeCompare(a.from),
      };
      if (!months.length) {
        document.getElementById("sessionList").innerHTML =
          `<div class="empty">Keine Sessions im Zeitraum.</div>`;
        return;
      }
      const currentMonth = months[0];  // hoechster Key = neuester Monat
      const html = months.map(k => {
        const inMonth = allSessions.filter(s => monthKey(s.from) === k);
        const sorted = [...inMonth].sort(sortFns[sortBy] || sortFns.newest);
        const totalMatches = inMonth.reduce((n, s) => n + (s.matches || 0), 0);
        // LocalStorage: Default = aktueller Monat offen, andere zu
        const lsKey = "obs.month." + k + ".open";
        let openLs = localStorage.getItem(lsKey);
        if (openLs === null) openLs = (k === currentMonth) ? "1" : "0";
        const isOpen = openLs === "1";
        const items = sorted.map(s => {
          const origIdx = allSessions.indexOf(s);
          const cls = "item" + (s.current ? " current" : "");
          return `<div class="${cls}" data-from="${s.from}" data-to="${s.to}"
                       data-idx="${origIdx}">
            <div class="item-date">${PubgUI.fmtDate(s.from)}</div>
            <div class="item-meta">${s.matches || 0} Matches · ${s.wins || 0} W</div>
          </div>`;
        }).join("");
        const monthLabel = _monthLabel(k);
        return `<details class="month-group" data-month-key="${k}"${isOpen ? " open" : ""}>
          <summary class="month-group__head">
            <span class="month-group__name">${monthLabel}</span>
            <span class="month-group__count">${inMonth.length} Sessions · ${totalMatches} Matches</span>
            <span class="material-symbols-outlined month-group__chev" aria-hidden="true">expand_more</span>
          </summary>
          <div class="month-group__body">${items}</div>
        </details>`;
      }).join("");
      document.getElementById("sessionList").innerHTML = html;
      document.getElementById("monthCounter").textContent =
        `${months.length} Monate · ${allSessions.length} Sessions gesamt`;
      // LocalStorage-Persistenz: bei jedem toggle den State speichern
      document.querySelectorAll(".month-group").forEach(el => {
        el.addEventListener("toggle", () => {
          const k = el.getAttribute("data-month-key");
          localStorage.setItem("obs.month." + k + ".open",
                                el.open ? "1" : "0");
        });
      });
    }

    function _monthLabel(monthKey) {
      // monthKey: "YYYY-MM" → "Monat-Name YYYY" auf Deutsch
      const [y, m] = monthKey.split("-");
      const months = ["Januar", "Februar", "März", "April", "Mai", "Juni",
                      "Juli", "August", "September", "Oktober",
                      "November", "Dezember"];
      const idx = parseInt(m, 10) - 1;
      return `${months[idx] || m} ${y}`;
    }
```

- [ ] **Step 3: Alte Monats-Tab-Logik entfernen**

Suche im selben Script den Block der die alten `<div class="month-tabs">` baute (Zeile ~2072-2103 mit `monthTabs = months.map(...)` und den `btn.addEventListener("click", ...)`-Aufrufen) und entferne ihn vollständig. Suche nach diesem Pattern: 

```js
      const months = [...new Set(allSessions.map(s => monthKey(s.from)))]
        .sort().reverse();
      const monthTabs = months.map(k => { ... }).join("");
      document.getElementById("session-picker").innerHTML = `...month-tabs...`;
      ...
      months.forEach(k => {
        ...
        btn.addEventListener("click", () => { activeMonth = k; renderItems(); });
      });
```

Diesen ganzen Block ersatzlos streichen. Stattdessen wird in der HTML-Struktur eine einfache Hülle benötigt:

Suche im HTML-Body den `<div class="session-picker">`-Container (in der Aside-Spalte des Reports) und ersetze sein Inneres:

```html
<div class="session-picker">
  <div class="session-picker__header">
    <span id="monthCounter" class="session-picker__counter">—</span>
  </div>
  <div id="sessionList"></div>
</div>
```

Die `activeMonth`-Variable und alle Verweise darauf (außerhalb der entfernten Tab-Logik) werden ebenfalls entfernt:
- Suche `let activeMonth` — Zeile entfernen.
- Suche `activeMonth = monthKey(FROM)` — Zeile entfernen.
- Suche `inMonth = allSessions.filter(s => monthKey(s.from) === activeMonth)` — nicht mehr nötig, neue `renderItems` arbeitet pro Monat.

- [ ] **Step 4: Click-Handler auf Session-Items belassen**

Der bestehende Handler (Zeile ~2155, `document.addEventListener("click", (e) => { const it = e.target.closest(".session-picker .item"); ... })`) funktioniert weiterhin, da Items innerhalb der `.month-group__body`-Divs nach wie vor `.item.session-picker .item` matchen werden — moment, der Selektor ist `.session-picker .item`, das matched auch innerhalb der Month-Groups. ✓ Kein Eingriff nötig.

- [ ] **Step 5: Smoke-Test**

```bash
cd /home/ruschinski/git/obs-stream-kit && python -c "
from jinja2 import Environment
print('JS-Syntax-Check via Node:')
" && node -e "
const fs = require('fs');
const html = fs.readFileSync('widgets/pubg/session-report.html', 'utf8');
const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
for (const s of scripts) {
  const body = s.replace(/<\/?script[^>]*>/g, '');
  try { new Function(body); }
  catch (e) { console.error('SYNTAX:', e.message); process.exit(1); }
}
console.log('OK — alle <script>-Blöcke sind parsebar');
"
```
Expected: `OK — alle <script>-Blöcke sind parsebar`.

- [ ] **Step 6: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add widgets/pubg/session-report.html
git commit -m "feat(session-report): Monats-Tabs werden collapsible <details>-Gruppen mit LocalStorage-Persistenz"
```

---

## Task 6: Push + Live-Smoke + Manuelle Browser-Verifikation

**Files:** keine — Deploy-/Verifikations-Task.

- [ ] **Step 1: Push aller Commits**

```bash
cd /home/ruschinski/git/obs-stream-kit
git push origin master
```
Expected: `master -> master` push erfolgreich.

- [ ] **Step 2: Deploy auf Prod**

```bash
ssh -i ~/.ssh/obskit root@31.70.95.217 \
  "cd /opt/obs-stream-kit && git pull --ff-only && systemctl restart obs-stream-kit && systemctl is-active obs-stream-kit"
```
Expected: `Fast-forward ... active`.

- [ ] **Step 3: Healthz-Check**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://stats-overlay.info/healthz
```
Expected: `200`.

- [ ] **Step 4: Browser-Verifikation (manuell)**

Auf https://stats-overlay.info/widgets/pubg/session-report.html prüfen:

- Desktop ≥ 1024px: Monats-Gruppen sichtbar, aktueller Monat offen, alte zu. Click auf alten Monat → öffnet, Click wieder → zu. Reload → State bleibt.
- Click auf Match-Row → Slide-In-Panel slidet von rechts ein. Map links, Squad-Tabelle + Timeline rechts.
- X-Button / Esc / Click auf Backdrop / Browser-Back → Panel schließt.
- Timeline zeigt chronologisch Events. Filter „Du" → nur Events mit dir. „Knocks" → nur Knock-Events.
- Vehicle-Tag erscheint inline: „aus Pico Bus" wenn du beim Tod im Bus warst.
- Slot-Farben: Actor-Namen in Slot-Farbe (grün/orange/blau/pink) wenn Squad-Member.
- Mobile (DevTools < 768px): Panel ist fullscreen, Stack-Layout, alles im Sheet scrollbar.
- Deep-Link: `…?from=…&to=…#match=<id>` öffnet Panel automatisch.

- [ ] **Step 5: Bei Bedarf Bugfix-Commits + Push**

Falls etwas hakt, separate Fix-Commits direkt auf master, dann erneut Step 2-3.

---

## Self-Review

**Spec coverage:**
- ✅ Backend `events[]`-Liste mit Knock/Kill/Revive + Vehicle-Kontext → Task 1
- ✅ Slide-In Panel von rechts, ~90% Desktop, 100% Mobile, X/Esc/Backdrop/Hash → Task 2
- ✅ Inline-Expand entfernt, Click öffnet Slide-In → Task 3
- ✅ Squad-Tabelle clientseitig aus Match-Detail-Response → Task 3 Steps 4-6
- ✅ Timeline-Rendering mit Filter-Chips (Alle/Du/Knocks/Kills/Revives) → Task 4
- ✅ Vehicle-Inline-Tag in Timeline-Rows + POI clientseitig → Task 4 Step 2 (`mdTlRowHtml`)
- ✅ Slot-Farben in Timeline → Task 4 (`mdTlPickColor`)
- ✅ Monats-Tabs zu `<details>`-Gruppen mit LocalStorage → Task 5
- ✅ Push + Deploy + Verifikation → Task 6

**Placeholder scan:** keine TODO/TBD/vague-handling-Strings; alle Code-Blöcke vollständig; alle Schritte haben konkrete Befehle + Expected.

**Type consistency:**
- `mdPanelOpen(matchId)` / `mdPanelClose()` — konsistent über Tasks 2, 3, 4.
- `_MD_TIMELINE_FILTERS` Array — gleiches Schema (`[key, label, allowed-types]`) in renderMdTimeline + wireMdTimelineFilters.
- `MD_SLOT_COLORS` — bereits aus vorherigem Commit `dd6c438` definiert, in Timeline verwendet.
- `colorByAcc` — kommt aus `mdLoad`-Result, in Squad-Table + Timeline gleich verwendet.
- `_VEHICLE_PATTERNS` (backend) → wird in Task 1 für `_veh_label_for` benutzt; Frontend hat eigenes (Port aus früherem Commit) für `fmtVeh` aber NICHT für Timeline-Rows (dort kommt der gelabelte String direkt aus Backend).
- `mdMount` — Signatur unverändert (host: HTMLElement); innere Logik in Task 3 erweitert.
- `renderSessionSummary` — `window._allMatchesByIdx` neu gesetzt in Task 4 Step 4; in Task 4 Step 3 ausgelesen.

Plan ist konsistent und vollständig.
