# Match-Detail Rework — Design Spec

**Datum:** 2026-05-30
**Status:** Approved (Brainstorming → Plan)

## Problem

Aktuelle Match-Detail-Ansicht in `widgets/pubg/session-report.html` hat drei Schwachpunkte:

1. **Kein Event-Timeline.** Pro Match werden nur Life-Summaries pro Member gezeigt („landete in POI, gestorben in POI durch …"). Es fehlt die chronologische Geschichte des Matches: wann hat wer wen geknockt/gekillt/wiederbelebt, wann ging wer aus dem Fahrzeug raus.
2. **Inline-Expand quetscht den Detail-View in die Session-Liste.** Bei vielen Matches verschiebt das Aufklappen den Scroll-Kontext stark; Map + Squad-Tabelle + Cards bekommen wenig Platz.
3. **Monats-Tabs sind nicht klappbar.** Bei vielen Monaten wird die Übersicht oben unübersichtlich; man sieht nur einen aktiven Monat, alle anderen sind nur als Tab-Buttons in einer Zeile sichtbar.

## Ziel

- Match-Detail bekommt eine **chronologische Event-Timeline** (Knocks, Kills, Revives, mit Fahrzeug-Kontext bei Bedarf).
- Match-Detail öffnet sich als **Slide-In-Panel** von rechts (~90% Desktop, 100% Mobile) statt inline-expand.
- **Monats-Tabs werden zu `<details>`-Blöcken**, default ist der aktuelle Monat offen, alle anderen zu.

## Out of Scope (YAGNI)

- Event-Timeline pro-Member-Filter (Filter-Chips per Event-Type reichen).
- Timeline-Highlights / Multi-Kill-Detection (existierende Achievement-Sektion deckt das ab).
- Drag-to-Resize fürs Slide-In-Panel (fixe 90%).
- Animation für Slide-In wenn `prefers-reduced-motion: reduce` aktiv ist (Panel poppt direkt rein).
- Per-Member-Gruppierung der Timeline (User hat eine einzige chronologische Liste gewählt).
- Eject-Events („du bist aus dem Auto gesprungen") als eigene Timeline-Einträge (Eject ist nur Fahrzeug-Kontext zu bestehenden Knock/Kill-Events).

## Architektur

### A. Event-Timeline

**Backend:** `pubg/aggregations.py::compute_match_detail` bekommt im Response ein neues Feld `events[]`. Liste, chronologisch sortiert nach `tsMs`. Ein Event nur dann enthalten wenn `actor` oder `target` ein Squad-Mitglied ist (Lobby-Events ohne Squad-Bezug fliegen raus). Pro Event:

```json
{
  "tsMs": 184321,
  "type": "knock_dealt" | "knock_taken" | "kill_dealt" | "kill_taken"
        | "revive_given" | "revive_received",
  "actorAccount":  "account.abc...",
  "actorName":     "Du",
  "actorSlot":     1,
  "targetAccount": "account.def...",
  "targetName":    "EnemyXYZ",
  "targetSlot":    null,
  "weapon":        "M16A4",
  "distanceM":     142,
  "poi":           "School",
  "victimVehicleLabel":  "Pico Bus",
  "shooterVehicleLabel": null
}
```

- `type` ist aus Sicht des Squad-Mitglieds. Wenn das Squad-Mitglied `actor` ist und das Event ein Kill ist → `kill_dealt`. Wenn `target` und Kill → `kill_taken`.
- Bei Revive analog: Squad-Member ist `actor` → `revive_given`; ist `target` → `revive_received`.
- Bei einem Squad-internen Revive (Mate revived Mate) wird das Event ZWEI Mal eingetragen: einmal aus `actor`-Sicht (`revive_given`), einmal aus `target`-Sicht (`revive_received`). Das ist OK weil die Timeline alle relevanten Perspektiven zeigt.
- Squad-vs-Squad Kills (Friendly Fire) zählen analog: einmal `kill_dealt` für Actor, einmal `kill_taken` für Target.
- `victimVehicleLabel` / `shooterVehicleLabel` werden über das schon existierende Vehicle-Intervall-Computing in `compute_match_detail` ermittelt (`_vehicle_label_at`). Für non-Squad-Actor/Target gilt: das Label ist nur dann gesetzt, wenn dieser Spieler ein Squad-Mate ist (Vehicle-Intervalle für Non-Squad-Spieler werden nicht gequeried — zu teuer).
- `poi`: NICHT im Backend-Response. Stattdessen liefert Backend `victimX` / `victimY` zusätzlich; Frontend bestimmt das POI-Label clientseitig via `poiOfV(mapName, victimX, victimY)` (existierende Funktion).
- Headshot-Indikator ist NICHT Teil dieses Specs (Daten liegen aktuell in `telemetry_events.payload_json` und sind nicht ohne Schema-Erweiterung greifbar). Kann in Folge-Iteration nachgeschoben werden.

**Implementierung im Backend:**
- Innerhalb `compute_match_detail` werden Kill-/Knock-/Revive-Events bereits per `ev_rows`-Query pro Squad-Member geladen. Das doppelt — pro Member ein eigener Query.
- Sauberer: ein einziger Squad-weiter Event-Query nach dem Members-Loop (oder davor), und daraus sowohl die per-Member-Lives als auch die globale `events[]` ableiten.
- Hier wählen wir den **minimal-invasiven Weg:** Nach dem Members-Loop ein neuer Query über alle Events mit `actor_account IN (squad)` OR `target_account IN (squad)`, daraus die `events[]` aufbauen. Doppelte Queries akzeptieren — Performance ist OK weil Squad ≤ 4 Members.

**Frontend:** Im Slide-In-Panel eine neue Sektion `<section class="md-timeline">`:
- Sticky-Header mit Titel „Timeline" + Filter-Chips:
  - `Alle` (default)
  - `Du` (filtert auf Events wo actorAccount=mySelf oder targetAccount=mySelf)
  - `Knocks` (knock_dealt + knock_taken)
  - `Kills` (kill_dealt + kill_taken)
  - `Revives` (revive_given + revive_received)
- Dense-Row-Liste, ein Event pro Zeile, 5-Spalten-Grid:
  1. Uhrzeit (wall-clock HH:MM:SS, berechnet aus `match.playedAt + tsMs`)
  2. Actor-Name (Slot-Farbe via `MD_SLOT_COLORS[slot-1]` wenn Squad, sonst neutral)
  3. Verb-Icon + Verb-Label (Pfeil-Richtung: → für dealt, ← für taken)
  4. Target-Name + Fahrzeug-Inline („EnemyXYZ aus Pico Bus")
  5. Waffe + Distanz + POI
- Standard: collapsible `<details>` mit Header „Timeline (N Events)", **default open**.

### B. Slide-In Match-Detail Panel

**Trigger:** Click auf Match-Row in der Session-Liste. Aktueller Inline-Expand (`<div class="squad-detail">`) entfällt; stattdessen öffnet sich das Slide-In.

**DOM-Struktur** (genau einmal im Body, am Ende von `session-report.html`):

```html
<div id="mdPanel" class="md-panel" hidden role="dialog" aria-modal="true"
     aria-labelledby="mdPanelTitle">
  <div class="md-panel__backdrop" data-md-close></div>
  <div class="md-panel__sheet">
    <header class="md-panel__header">
      <h2 id="mdPanelTitle" class="md-panel__title">…</h2>
      <button class="md-panel__close" data-md-close
              aria-label="Match-Detail schließen">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="md-panel__body" id="mdPanelBody"></div>
  </div>
</div>
```

**CSS:**
- Backdrop: `position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);`
- Sheet (Desktop ≥ 768px): `position: fixed; top: 0; right: 0; bottom: 0; width: 90vw; max-width: 1600px; background: var(--pubg-purple-bg); transform: translateX(100%); transition: transform 220ms ease;` — wenn `is-open`: `transform: translateX(0)`.
- Mobile (< 768px): `width: 100vw;` — fullscreen.
- Header sticky-top im Sheet.
- Body: `overflow-y: auto; height: calc(100vh - header-height);`
- Bei `prefers-reduced-motion: reduce` → keine `transition`, Panel poppt direkt rein.

**JS:**
```js
function mdPanelOpen(matchId) {
  const panel = document.getElementById("mdPanel");
  const body  = document.getElementById("mdPanelBody");
  // Body-Content: existierende md-host-Logik wiederverwenden.
  body.innerHTML = renderMatchDetailHostHtml(matchId);
  mdMount(body.querySelector(".md-host"));
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("is-open"));
  document.body.style.overflow = "hidden";
  // URL-Hash setzen
  history.pushState({ matchId }, "", "#match=" + encodeURIComponent(matchId));
  // Focus-Trap initialisieren
  mdPanelTrapFocus(panel);
}
function mdPanelClose() {
  const panel = document.getElementById("mdPanel");
  panel.classList.remove("is-open");
  setTimeout(() => { panel.hidden = true; }, 220);
  document.body.style.overflow = "";
  if (location.hash.includes("match="))
    history.pushState({}, "", location.pathname + location.search);
}
// Backdrop + X + Esc
document.addEventListener("click", e => {
  if (e.target.closest("[data-md-close]")) mdPanelClose();
});
document.addEventListener("keydown", e => {
  const panel = document.getElementById("mdPanel");
  if (e.key === "Escape" && panel && !panel.hidden) mdPanelClose();
});
// Browser-Back schließt Panel via popstate
window.addEventListener("popstate", () => {
  const m = (location.hash || "").match(/match=([^&]+)/);
  if (m) mdPanelOpen(decodeURIComponent(m[1]));
  else mdPanelClose();
});
// Deep-Link bei Page-Load
window.addEventListener("DOMContentLoaded", () => {
  const m = (location.hash || "").match(/match=([^&]+)/);
  if (m) mdPanelOpen(decodeURIComponent(m[1]));
});
```

**Match-Row:** `fmtMatchRow` erzeugt jetzt eine Row, deren Click via Event-Delegation `mdPanelOpen(matchId)` aufruft. Inline `<div class="squad-detail">` entfällt komplett (siehe Migration unten).

**Inner Body Layout (Desktop ≥ 1024px):**
```
┌──────────────────────────────────────────────────────────┐
│ #N · Erangel · 21:18 → 21:45  [X]                        │ ← sticky
├──────────────┬───────────────────────────────────────────┤
│ Mini-Map     │ Squad-Tabelle (kompakt)                  │
│ (links,      │                                          │
│  scrub+      │                                          │
│   speeds)    │                                          │
│              ├───────────────────────────────────────────┤
│              │ Member-Cards                              │
│              ├───────────────────────────────────────────┤
│              │ ▼ Timeline (N Events) [Filter-Chips]    │
│              │   21:18:24  Du  →  knocked  Enemy ...    │
│              │   21:18:31  Du  →  killed   Enemy ...    │
│              │   …                                       │
└──────────────┴───────────────────────────────────────────┘
```

**Mobile (< 768px):** Stack — Map oben (max 40vh), Squad-Tabelle, Cards, Timeline darunter. Alles im Sheet-Body scrollbar.

### C. Monats-Tabs collapsible

**Aktuell:** Horizontale Tab-Buttons → Click aktiviert einen Monat, andere sind nur Buttons.

**Neu:** Vertikale Liste von `<details>` pro Monat. Pro Monat:
```html
<details class="month-group" data-month-key="2026-04">
  <summary class="month-group__head">
    <span class="month-group__name">April 2026</span>
    <span class="month-group__count">8 Sessions · 47 Matches</span>
    <span class="material-symbols-outlined month-group__chev"
          aria-hidden="true">expand_more</span>
  </summary>
  <div class="month-group__body">
    <!-- Sessions/Tag-Tiles dieses Monats -->
  </div>
</details>
```

- `summary` zeigt Monat-Name + Session/Match-Count + Chevron-Icon (Material `expand_more`).
- CSS rotiert das Chevron um 180° bei `[open]`.
- Default: nur der aktuelle Monat ist offen (`<details open>`); alle älteren zu.
- **State-Persistenz:** Offen/zu-Status pro Monat in `localStorage` unter `"obs.month.<key>.open"` — Wiederherstellung bei Page-Reload.
- Bestehende `sortBy`/`renderItems`-Logik bleibt; nur das Rendering wird umstrukturiert.

## Datenfluss

1. `session-report.html` lädt Session-Liste über existierende `/api/pubg/sessions`-Endpoints.
2. Monats-Tabs werden als `<details>`-Liste gerendert; LocalStorage steuert Default-Zustand pro Monat.
3. Click auf Match-Row → `mdPanelOpen(matchId)` → URL-Hash gesetzt → Slide-In animiert ein → Body bekommt `overflow:hidden`.
4. Panel-Body ruft existierende `mdMount`-Logik auf (Map, Scrub, Squad-Tabelle, Cards) — keine Änderung an diesem Pfad.
5. Backend `/api/pubg/match-detail` liefert zusätzlich `events[]` im Response.
6. Frontend rendert `events[]` als Timeline-Sektion am Ende des Panel-Bodies, mit Filter-Chips und Slot-Farben aus `MD_SLOT_COLORS`.
7. Close (X / Esc / Backdrop / Browser-Back) → `mdPanelClose()` → URL-Hash wird entfernt → Slide-Out animiert.

## Dateien

| Datei | Änderung |
|---|---|
| `pubg/aggregations.py` | `compute_match_detail` ergänzt: einmaliger Squad-weiter Event-Query nach Members-Loop, baut `events[]` mit den definierten Feldern. Bestehende Member-Loops bleiben unverändert. |
| `widgets/pubg/session-report.html` | (a) Neuer `#mdPanel`-DOM am Body-Ende. (b) Slide-In CSS-Sektion. (c) JS: `mdPanelOpen/Close/TrapFocus`, Event-Delegation für Match-Row-Click, Hash/Popstate-Handling, Deep-Link bei DOMContentLoaded. (d) Inline `<div class="squad-detail">`-Render in `fmtMatchRow` entfällt. (e) Neue `renderTimeline(events)`-Funktion + CSS für Dense-Rows + Filter-Chips. (f) `renderItems`/`monthTabs`-Aufbau wechselt von Tab-Buttons zu `<details class="month-group">`-Liste mit LocalStorage-State. |
| `app/static/dashboard.css` | Falls Material Symbol-Klassen noch nicht reichen — kleine Ergänzung möglich, aber primär CSS in session-report.html (eigenständiges Widget). |

## Komponenten-Verträge

**Backend `compute_match_detail` Response-Erweiterung:**
- Bestehende Felder bleiben unverändert.
- Neues Feld `events`: Array sortiert nach `tsMs` asc. Jedes Event-Objekt hat genau die Felder aus der Architektur-Sektion.
- Wenn ein Match keine Squad-Events hat (extrem selten — z.B. AFK-Match): `events: []`.

**Frontend `mdPanelOpen(matchId)`:**
- Input: matchId (string).
- Side-Effect: Panel wird sichtbar, URL-Hash gesetzt, Body scroll-locked.
- Idempotent: erneuter Aufruf mit gleicher matchId rerendert nicht; mit anderer matchId tauscht Body-Inhalt aus.

**Frontend `renderTimeline(events)`:**
- Input: `events[]` Array vom Backend.
- Output: HTML-String für die Timeline-Sektion.
- Filter-State: lebt im DOM (active-class auf Filter-Chip), kein JS-State außerhalb.

**Frontend Month-Group `<details>`:**
- Input: Monats-Key (z.B. "2026-04") + Sessions/Matches.
- Output: collapsible Block.
- State: LocalStorage `obs.month.<key>.open` = "1" / "0".

## Error Handling

- **Backend liefert `events: undefined`** (alte API-Version vor diesem Deploy): Frontend rendert Timeline als „Keine Events verfügbar" (Fallback).
- **Match-Detail-Fetch schlägt fehl im Slide-In:** Panel zeigt Error-State im Body („Konnte Match nicht laden — Server ggf. neu starten"), X/Esc schließt weiterhin.
- **Slot fehlt bei Member** (alte Matches vor der Slot-Migration): Fallback auf neutralen grauen Akteur-Namen in der Timeline (statt Slot-Farbe).
- **Browser-Back-Stack mit mehrfachem Panel-Open:** pushState pro Open, popstate öffnet/schließt entsprechend. Bei explizitem Close ohne Hash-Change ein leerer pushState (siehe JS-Snippet) — verhindert dass Browser-Back zur vorigen Session-View geht statt das Panel zu schließen.

## Testing

Frontend ist Vanilla JS ohne Test-Infrastruktur → manuelle Smoke-Tests:

1. **Desktop ≥ 1024px:** Click auf Match → Panel slidet von rechts ein, Map links, Squad-Tabelle + Cards + Timeline rechts. X / Esc / Backdrop-Click / Browser-Back schließen jeweils.
2. **Mobile < 768px (DevTools):** Panel fullscreen, Stack-Layout, alles im Sheet-Body scrollbar.
3. **Deep-Link:** `https://stats-overlay.info/widgets/pubg/session-report.html?...#match=<id>` öffnet Session, dann automatisch Slide-In für die matchId.
4. **Timeline-Filter:** „Knocks" zeigt nur knock_dealt/knock_taken; „Du" zeigt nur Events wo ich Actor oder Target bin.
5. **Vehicle-Tag:** Match wo ich aus Pico Bus erschossen wurde → Timeline-Zeile enthält „aus Pico Bus" inline.
6. **Slot-Farben in Timeline:** Actor-Name in derselben Farbe wie Member-Card-Header.
7. **Monats-Gruppen:** Default nur aktueller Monat offen. Klick auf alten Monat öffnet ihn, LocalStorage merkt's nach Reload.
8. **`prefers-reduced-motion`:** OS-Setting → kein Slide-In-Animation, Panel poppt direkt.
9. **Backend-Tests:** `pytest tests/pubg/test_aggregations.py` (falls Match-Detail-Tests existieren) bleibt grün. Neue Asserts für `events[]` falls Test-Fixture ein Squad-Event enthält.

## Risiken

- **Performance Squad-weiter Event-Query:** Bei einem Match mit 30+ Squad-Events sind das ~30 Rows zusätzlich. Vernachlässigbar.
- **Doppelte Revive-Einträge bei Squad-intern:** Wenn Mate1 Mate2 wiederbelebt, erscheinen 2 Events (`revive_given` für Mate1, `revive_received` für Mate2). Gewollt, weil beide Perspektiven für die Timeline-Lesbarkeit relevant sind. Bei Filter „Knocks/Kills" werden Revives sowieso ausgeblendet.
- **History.pushState + popstate + page-internal Hash-Navigation:** Konflikt-Potential wenn andere Seiten-Logik bereits am Hash zieht. **Check:** Es gibt bereits Hash-State an anderen Stellen (URL-Page, Welcome-Widget). Im session-report ist Hash bisher unbenutzt → kein Konflikt erwartet.
- **LocalStorage-Quota:** Pro Monat ~50 Bytes. Bei 12 Monaten = 600 Bytes. Vernachlässigbar.
- **Mobile-Scroll-Lock auf iOS:** `document.body.style.overflow = "hidden"` reicht meist nicht bei iOS Safari — wenn Probleme auftauchen, zusätzlich `position: fixed; top: -scrollY`-Trick. **Falls aktuelle iOS-Tests sauber sind:** kein Eingriff nötig.

## Migration / Backout

- **Migration:** Keine DB-Migration nötig (rein Frontend + ein Backend-Field-Add).
- **Slot-Migration ist bereits live** (Commit `dd6c438`) — Events mit Slot-Farben funktionieren ab da für neue Matches; ältere zeigen neutralen Style.
- **Backout:** Revert der Commit(s) dieses Plans. Bestehende Datenstruktur bleibt unverändert; nur das Frontend-Rendering und das zusätzliche `events[]`-Feld entfallen.
