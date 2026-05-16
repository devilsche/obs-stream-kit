# Match-Detail Rework — Design

**Datum:** 2026-05-16
**Scope:** Session-Report Match-Expand-Sicht + Weapon-Stats-Icon-Groessen
**Hintergrund:** iterative Match-Detail-Sicht (Commits `42ada5b` bis
`5d5b6b0`) funktioniert nicht zufriedenstellend — Zeitraffer triggert
nicht, Pin/Pfad/Icon-Lesbarkeit mangelhaft. Memory-Notiz:
`memory/project_pubg_match_detail_open.md`.

## Ziele

1. Match-Expand-Bereich im Session-Report so umbauen dass Map + Pfade +
   Pins + Zeitraffer in einem **inline** Workflow zusammen funktionieren
   (kein Modal mehr noetig).
2. **Two-Canvas-Rendering** fuer performante Zeitraffer-Animation ueber
   alle 4 Squad-Members parallel.
3. **Konfigurierbare Weapon-Icon-Groesse** im weapon-stats Widget.
4. **Saubere Frontend-State-Maschine** fuer Hover-Preview + Click-Lock
   ohne die Bugs der bisherigen Iteration.

## Architektur

### Datenpipeline (Backend)

`compute_match_detail(conn, my_account_id, match_id)` in
`pubg/aggregations.py` wird erweitert um:

- **Pfad-Timestamps:** statt `path: [[x_cm, y_cm], ...]` jetzt
  `path: [[x_cm, y_cm, ts_ms], ...]`. Frontend braucht ts fuer
  synchrone Animation aller 4 Members in Wallclock-Time.
- **Pfad-Start:** unveraendert ab `actor_z >= 150000` (Plane-Cruise)
  + 3s Puffer (bewaehrt).
- **Squad-Kills:** neues Feld pro Member, `kills: [{actorX, actorY,
  victimX, victimY, victimName, tsMs}, ...]`. Quelle: Kill-Events mit
  `actor_account = member`, joined mit `participants.name` fuer
  Opfer-Namen.
- Bestehende Felder unveraendert: landingX/Y, deathX/Y, killerName,
  weaponId, weaponName, distanceM, deathOffsetSec, revivePts, isSelf.

Cache-Key `match-detail:<matchId>` bleibt — invalidate bei neuen Matches.

### Frontend-Struktur (session-report.html)

**Markup pro aufgeklapptem Match:**

```html
<div class="match-detail" data-match-id="...">
  <div class="md-grid">
    <div class="md-mapcol">
      <div class="md-mapwrap">
        <canvas class="md-basemap"></canvas>       <!-- Map-Tile (static) -->
        <canvas class="md-overlay"></canvas>       <!-- Pins/Pfade/Animation -->
        <div class="md-tools">
          <button class="md-toggle" data-toggle="kills">Kills</button>
          <button class="md-play">▶ Zeitraffer</button>
          <span class="md-legend">Squad-Pfade · Erangel</span>
        </div>
      </div>
    </div>
    <div class="md-cardcol">
      <table class="md-squad">...</table>
      <div class="md-cards">
        <div class="md-card" data-acc="..."> ... </div>   <!-- pro Mate -->
      </div>
    </div>
  </div>
</div>
```

**Two-Canvas-Pattern:**

- `md-basemap` (480×480): Map-Tile + Pin-Calibration-Anwendung, einmal
  gezeichnet beim Match-Open. Nicht angefasst danach.
- `md-overlay` (480×480, position:absolute, pointer-events:none):
  Pfade + Pins + Animation. Re-Render bei Focus-Wechsel, Toggle-
  Aenderung, Zeitraffer-Frame.

Beide haben identische Pixel-Dimensionen + Cropping. Frontend zeichnet
mit denselben `cmToCanvas(xCm, yCm)`-Coords in beide.

### Render-Funktionen

```
renderBasemap(host, mapName, mapKm, cal)
  - laedt Map-Image (cached via loadMapImage), crop center, drawImage
  - einmal pro Match-Open

renderOverlay(host, state)
  state = { members, focusAcc, showKills, animFrame }
  - clearRect overlay
  - fuer jeden Member: zeichne Pfad als Polyline
    - alpha 0.3 wenn !focusAcc oder member.acc != focusAcc
    - alpha 0.9 wenn member.acc == focusAcc
  - zeichne Landing-Pin (7px, Member-Farbe, weisser 1px Outline)
  - zeichne Death-Pin (10px, Member-Farbe, weisser 1.5px Outline)
    wenn died. ACHTUNG: KEINE X-Markierung, keine Symbole auf Pins.
  - zeichne Revive-Pin (6px gruen, weisser Outline) pro revivePts
  - wenn showKills: zeichne fuer jeden Member alle kills:
    - actor-Punkt 4px Member-Farbe
    - victim-Punkt 4px hellgrau
    - Verbindungslinie 1px Member-Farbe alpha 0.4
  - wenn animFrame: zeichne animierten Pin pro Member am
    interpolierten Punkt entlang seines Pfads (siehe Zeitraffer)

animLoop(host, state, startTs)
  - requestAnimationFrame-Loop
  - berechnet t = (now - startTs) / DURATION_MS
  - pro Member: findet path-Punkt anhand t * match_duration
  - ruft renderOverlay(host, {...state, animFrame: t}) auf
  - stoppt bei t >= 1 oder via Token-Cancellation
```

### State-Maschine (Interaktion)

```
matchState[matchId] = {
  members,        // aus loadMatchDetail
  hoveredAcc,     // null oder accountId
  lockedAcc,      // null oder accountId
  showKills,      // bool
  playToken,      // monoton hochzaehlend; aktive Anim bricht ab wenn != aktuell
}

focusAcc = lockedAcc ?? hoveredAcc
```

**Events:**

- `card.mouseenter` → `state.hoveredAcc = acc`, re-render overlay
- `card.mouseleave` → `state.hoveredAcc = null`, re-render overlay
- `card.click` → wenn `lockedAcc == acc`: unlock (set null); sonst lock (`lockedAcc = acc`)
- `basemap.click` (Leerflaeche) → unlock
- `ESC keydown` → unlock + stoppe Zeitraffer
- `tools-btn[data-toggle=kills].click` → `state.showKills = !state.showKills`
- `tools-btn.md-play.click` → starte Zeitraffer (token++, animLoop)

### Zeitraffer-Animation

- Konstante Dauer: `ANIM_DURATION_MS = 15000` (15s fuer typisches
  Match egal ob 8min Brawl oder 35min Endgame).
- Real-Time-Faktor: `(match_end_ms - match_start_ms) / 15000` —
  variabel pro Match.
- Pro Member: Pfad-Punkt-Index berechnen via Bisect ueber ts_ms ≤
  `match_start_ms + t * (match_end_ms - match_start_ms)`. Dazwischen
  linear interpolieren (smooth movement).
- Bei Death: Pin bleibt am letzten Punkt + dimmt auf alpha 0.5.
- Bei Revive: 500ms Gruen-Flash am Revive-Punkt waehrend Animation
  durch diese ts laeuft (alpha 0.5 → 1.0 → 0.0).
- Cancellation: `playToken` wird bei Modal-Close, Match-Wechsel,
  oder neuem Play-Klick incrementiert. Anim-Loop prueft Token und
  stoppt wenn != aktuell.

### Cards (rechte Spalte)

Pro Member eine Card:

```html
<div class="md-card" data-acc="...">
  <div class="head">
    <span class="dot" style="background:<member-color>"></span>
    <span class="name">{Name}</span>
    <span class="badge">{survived | †mm:ss}</span>
  </div>
  <div class="row">landete <b>{landing-POI}</b>
    {wenn died}: — gestorben in <b>{death-POI}</b></div>
  {wenn died:}
    <div class="death-by">
      durch <b>{killerName}</b> mit <b>{weaponName}</b> auf <b>{distM}m</b>
    </div>
</div>
```

Visual: gleiches Pattern wie Wireframe.
- Default: schwacher lila Hintergrund + transparenter Border.
- `md-card.active` (= focusAcc): Gold-Border + leicht goldener
  Hintergrund.
- Hover-State (`.md-card:hover`): subtiler Background-Wechsel (z.B.
  `rgba(255,255,255,0.04)`) als visuelles Feedback.

### Weapon-Stats Icon-Groesse

In `widgets/pubg/weapon-stats.html`:

- URL-Param `?iconSize=<n>` mit Default 48.
- CSS-Variable im `<style>` Block: `--wicon-size: 48px;` von JS gesetzt
  abhaengig vom Param.
- `.ws-name img.wicon { height: var(--wicon-size); max-width: calc(var(--wicon-size) * 1.5); }`.
- Akzeptierte Werte: clamp 16..96.

## Daten-Flow

1. **Match aufklappen**: bestehender Click-Handler ruft
   `renderMatchDetail(matchEl, matchId)`.
2. `renderMatchDetail`:
   a. Inline-DOM erzeugen (Map-Wrap, Cards-Container)
   b. `loadMatchDetail(matchId)` → state.members
   c. `renderBasemap(...)` einmal
   d. `renderOverlay(...)` mit state (kein Focus, kein Animation)
   e. Cards-DOM aus members generieren
   f. Event-Listener binden (hover/click auf Cards, Tools-Bar)
3. **State-Change** (hover/click/toggle/play): re-render Overlay nur,
   Basemap unangetastet.
4. **Match wechseln**: bestehende Match-Row-Click-Logic schliesst aktuelles
   Detail, oeffnet neues. State pro Match isoliert.

## Error-Handling

- **Keine Telemetrie** (Match noch nicht processed): members[] leer
  oder ohne path/landing. UI zeigt "— keine Telemetrie verfuegbar —"
  statt leerer Map. Toggle/Play disabled.
- **Member ohne Pfad** (Telemetrie luecken): zeichne nur Landing+Death-
  Pin, kein Pfad. Animation skippt diesen Member.
- **Image-Load failed** (Map fehlt): leeres Canvas mit Hintergrund,
  Pins werden trotzdem ueber Pin-Calibration-Coords gezeichnet.
- **iconSize ausserhalb 16..96**: clamp auf Range, kein Error.

## Testing

Manuell (kein automatisiertes UI-Testing in diesem Repo):

1. Match aufklappen → Map laedt, 4 Pfade transparent + Pins sichtbar.
2. Hover ueber eine Card → entsprechender Pfad hellt auf, andere dimmen.
3. Mouse leave → zurueck zu Default-Alphas.
4. Click auf Card → Card bekommt Gold-Border, Lock aktiv. Mouse weg
   → bleibt locked.
5. Click selbe Card → unlock. Click andere Card → wechselt.
6. Click in Map-Leerraum → unlock.
7. ESC → unlock + stoppt etwaige Animation.
8. Toggle "Kills" → 4px-Punkte + Linien erscheinen/verschwinden.
9. Play-Button → 4 Pins gleiten parallel ueber 15s ueber ihre Pfade.
10. Match-Row schliessen + neu oeffnen → state ist frisch.
11. `weapon-stats.html?iconSize=64` → Icons sichtbar groesser.

## Migration / Rollback

- Bestehende Match-Expand-Markup-Klassen (`.match-map`, `.match-info`,
  `.mi-row`) werden vom Re-Design ersetzt durch `.md-*` Klassen. Sauberer
  Cut, keine Doppel-Listener.
- `compute_match_detail`-Feld-Erweiterungen sind additiv — alte
  Cache-Eintraege gelten als stale und werden bei naechstem Aufruf
  neu berechnet.
- Bei Rollback: vorheriger Commit `5d5b6b0` revertiert das ganze
  Re-Design. compute_match_detail-Felder bleiben zusaetzlich, kosten
  aber nichts (Frontend ignoriert sie dann).

## Out of Scope

- Map-Hero in `post-match-card.html` (eigene Folge-Story).
- Headshot-Detection aus damageReason (braucht neuen Telemetrie-Parse,
  separates Mini-Spec wenn gewuenscht).
- Distance-Skalierung der Pfade in Echtzeit waehrend Zeitraffer
  (Pin folgt Pfad, kein Distance-Counter im Overlay).
- Twitch-Clip-Integration "play kill clip at this timestamp" — andere
  Baustelle.
