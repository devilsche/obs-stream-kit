# Match-Detail v2 — Design

**Datum:** 2026-05-16 (zweite Iteration)
**Scope:** Komplettes Re-Design der Match-Expand-Sicht — scrubbable Zeitraffer, Auto-Zoom, manueller Zoom, Solo-Filter, Multi-Lives, kleinere Pins.
**Vorgaenger:** `2026-05-16-match-detail-rework-design.md` (v1, gepusht als Commits `1fd2867..c0e7f23`).

## Warum v2 noetig ist

v1 funktional aber visuell nicht ausreichend:
- Pins (7/10/6px) sind zu gross — auf Vollkarte verdeckt ein Pin ein ganzes Viertel, man sieht nicht in welches Gebaeude jemand gelandet ist.
- Pfade nach Landing nicht erkennbar (zu transparent + zu weit gezoomt).
- Zeitraffer ist nur Animation, nicht scrubbar — keine Detail-Inspektion moeglich.
- Map ist 480x480 ohne manuelles Zoom — nicht praezise genug.
- Multi-Lives (Comeback-Modi: zweite Landing nach Tod) sind ueberhaupt nicht modelliert — Backend liefert nur EINEN Landing+Death pro Member.

## Ziele

1. Scrubbare Timeline (Video-aehnliches Verhalten).
2. Tight 500m-Zoom-Window mit Auto-Camera-Follow.
3. Manuelles Zoom (Scrollwheel + Drag-Pan) bis Haus-Ebene.
4. Pins 50% kleiner, mit Hover-Labels.
5. Default-View clean (nur Flugroute + Landing-Pins).
6. Solo-Filter per Click, "Alle"-Button zum Resetten.
7. Multi-Lives-Support (Comeback) ueber Backend-Modell-Aenderung.

## Architektur-Aenderungen

### Backend (compute_match_detail)

**Datenmodell-Bruch:** Pro Member ein `lives`-Array statt flache `landingX/Y` + `deathX/Y` Felder.

```python
member = {
    "accountId":   "account.XXX",
    "name":        "PEX_LuCKoR",
    "isSelf":      True,
    "lives": [
        {
            "lifeIndex":   1,
            "planeRoute":  [[x_cm, y_cm, ts_ms], ...],   # Cruise → Landing
            "landing":     {"x": cm, "y": cm, "tsMs": int},
            "groundPath":  [[x_cm, y_cm, ts_ms], ...],   # Landing → Death/Ende
            "death":       {"x", "y", "tsMs", "killerName", "weaponName",
                            "weaponId", "distanceM"} | None,
            "kills":       [{"actorX","actorY","victimX","victimY","tsMs",
                             "weapon","victimName"}, ...]
        },
        # ggf. Leben 2, 3, ...
    ],
    "revivePts":   [[x_cm, y_cm, ts_ms], ...]   # innerhalb eines lebens
                                                  # (DBNO-Revive, nicht Comeback)
}
```

**Lives-Detection-Heuristik:**
- Splitte Telemetry-Events des Members an jedem `Kill`-Event mit `target == member`.
- Pro Segment: `planeRoute` = Positions/VehicleEnter/VehicleLeave ab Plane-Cruise (z >= 150000) + 3s bis erstes `Landing`-Event. `landing` = erstes Landing. `groundPath` = Positions ab landing-ts bis death-ts (oder bis naechstes Plane-Cruise = naechstes Leben, oder bis Match-Ende).
- Wenn nach einem Death des Members ein weiteres Plane-Cruise + Landing folgt: das ist ein Comeback. Neues Leben in `lives[]`.

**Backwards-Compat:** Frontend rechnet weiter mit Daten-Layout. Alte Felder bleiben in der API als deprecated (oder werden ganz entfernt — Decision: ENTFERNEN, da der Wechsel v2 ist und alte Felder verwirren wuerden).

### Frontend Layout

```
┌────────── md-host (Match-Detail Container, full width) ──────────┐
│ ┌─ Map-Col 300px ─┐  ┌──────── Cards-Col (rest) ──────────────┐ │
│ │                 │  │ ┌─ "Alle" Reset-Bar ────────────────┐  │ │
│ │   basemap-cv    │  │ │ [ ▶ Alle ] (groesseres Button)    │  │ │
│ │   overlay-cv    │  │ └───────────────────────────────────┘  │ │
│ │   (300x300)     │  │ ┌─ Squad-Tabelle (kompakt) ─────────┐  │ │
│ │                 │  │ │ Name | K | HS | DMG | ...         │  │ │
│ │   [zoom-ctrls]  │  │ └───────────────────────────────────┘  │ │
│ ├─ Scrub-Bar ─────┤  │ ┌─ Mate-Cards (stacked) ────────────┐  │ │
│ │ ⏵ ━━●━━ 02:14   │  │ │ • Du   alive  Pochinki            │  │ │
│ │      / 23:14    │  │ │ • Nob  † 12:34 Pochinki → Quarry  │  │ │
│ └─────────────────┘  │ │   ↳ Leben 2: Mansion → Mylta      │  │ │
│                      │ └───────────────────────────────────┘  │ │
│                      └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Map-Renderer (mdRender* Suite v2)

Two-Canvas-Pattern bleibt. Aber:
- Canvas-Groesse: 300×300 (statt 480×480).
- Neuer **Viewport-State** pro Host (statt fixem Zoom auf Squad-Bbox):
  ```js
  viewport = {
    centerCmX, centerCmY,  // Karten-Zentrum in cm
    zoom,                   // 1 = 500m sichtbarer Radius. 0.5 = 1000m. 2 = 250m.
    autoFollow              // bool: Auto-Camera bei Zeitraffer
  }
  ```
- `cmToCanvas(xCm, yCm)` rechnet anhand viewport, NICHT mehr global. Pinposition haengt vom Viewport ab.
- Default-Viewport beim Mount: zoom so dass alle Landings reinpassen, center = bbox-Mittelpunkt, autoFollow=true.

### Zeitraffer-State

```js
zeitraffer = {
  cursorTs,        // aktuelle Zeit in ms (matchStart-relativ)
  playing,         // bool
  playStartTs,     // performance.now() wenn play gestartet
  playStartCursor, // cursorTs zum Zeitpunkt von play-start
  durationMs,      // matchEnd - matchStart
  speed,           // 1x default, evtl. 2x / 0.5x spaeter (out of scope v2)
}
```

`playLoop()` setzt cursor = playStartCursor + (now - playStartTs) * speed bis durationMs erreicht.

Scrub: User-Drag auf Slider setzt cursorTs direkt + pausiert.
Step: ±1s via Buttons / Pfeiltasten.

### State pro Host

```js
state = {
  members,            // mit lives[]
  colorByAcc,
  soloAcc,            // null = alle, oder accountId fuer Solo-Mode
  viewport,           // zoom + center + autoFollow
  zeitraffer,         // cursorTs + playing + ...
  showKills,          // (aus v1)
  hoveredMarker,      // {acc, kind: 'landing'|'death'|'kill', lifeIdx, idx}
                      // fuer Hover-Label
  playToken,          // wie v1 fuer animation cancel
}
```

`effectiveFocus = soloAcc` (Hover-Preview entfaellt, Click ist primary).

### Default-View (kein Solo, Zeitraffer bei t=0)

- Zeichne pro Member `lives[0].planeRoute` als gestrichelte Linie (dash 4, 4)
- Zeichne pro Member `lives[0].landing` als Pin (3.5px in Member-Color)
- KEINE groundPath, KEINE Deaths, KEINE Kills sichtbar
- Viewport: bbox(alle Landings) mit Padding so dass 500m Radius minimum

**WICHTIG:** Sollte ein Member mehrere Leben haben (Comeback), zeigt Default-View NUR Leben 1 — andere Leben werden erst sichtbar wenn Zeitraffer durch ihre Time-Range scrubbt.

### Zeitraffer-View (cursorTs > 0)

Pro Member, pro Leben:
- Wenn `cursorTs >= lives[i].planeRoute[0].ts` und `< lives[i].landing.tsMs`:
  Pin am interpolierten Punkt der planeRoute zwischen den umliegenden Pfad-Stuetzpunkten.
- Wenn `cursorTs >= lives[i].landing.tsMs` und `<= lives[i].death.tsMs` (oder Match-Ende falls survived):
  Pin am interpolierten Punkt der groundPath. Landing-Pin sichtbar. Past-Trail von Landing bis cursor als solider Pfad in Member-Color alpha 0.7.
- Wenn `cursorTs > lives[i].death.tsMs`:
  Death-Pin sichtbar. Trail komplett. Pin selbst nicht mehr (Member ist tot).
- Kills (`life.kills`) erscheinen mit Kill-Marker sobald `cursorTs >= kill.tsMs`.

**Camera-Follow:** wenn `viewport.autoFollow`:
- bbox = alle currently-aktiven Pin-Positionen
- Wenn bbox kleiner als 500m: zoom auf 500m Radius
- Sonst: zoom so dass bbox + 20% padding sichtbar

Ease zwischen Frames damit Camera nicht ruckelt (lerp 0.15 pro frame).

### Solo-Mode

User clickt auf Card oder Marker oder Pin:
- `soloAcc = m.accountId` setzen.
- Rendering: alle anderen Members unsichtbar (Pfade, Pins, Cards alle nur fuer soloAcc).
- Camera: 500m um den geklickten Marker (Landing/Death/Kill); Zeitraffer-Cursor springt auf den Event-Timestamp und pausiert.
- Click auf Card (nicht Marker): Camera = bbox(landing+death+path) fuer Solo, cursorTs bleibt wo es ist.

### "Alle"-Reset-Bar

Oberhalb der Cards in der rechten Spalte:
```html
<button class="md-alle">▶ Alle</button>
```
Click:
- `soloAcc = null`
- `viewport` zurueck auf Default (Squad-Bbox + 500m, autoFollow=true)
- `zeitraffer.cursorTs = 0`, `playing = false`
- Re-render

Mehr Wert auf Button-Praesenz (groesser, gold-bordered, immer sichtbar) — dient als „home" fuer den User.

### Marker-Click-Behavior

Click auf Pin in der Map (Landing, Death, Kill):
- Setzt Solo-Mode auf den entsprechenden Member.
- Cursor springt auf event-Zeit.
- Viewport: 500m um den Marker, autoFollow=false (fixed view bis User wieder play oder „Alle" klickt).
- Pausiert Zeitraffer.

Click auf Pin der schon im Solo-Mode-Member ist: nochmal Snap zum Marker (kein Toggle-out — „Alle" macht das).

### Pin + Trail-Sizes (50% kleiner)

| Marker | v1 | v2 |
|---|---|---|
| Landing | 7px | 3.5px |
| Death | 10px (mit X) | 5px (ohne Symbol — Pin-Form reicht) |
| Revive | 6px (mit +) | 3px (ohne Symbol) |
| Kill-Marker Schuetze | 4px | 2.5px |
| Kill-Marker Opfer | 4px | 2.5px (graue Outline) |
| Zeitraffer-Pin | 8px | 4px |

Trail-Strichstaerke: 1.5px gedimmt, 2.5px focused (unchanged).

### Hover-Labels

Marker-Hover zeigt floating Label rechts oben vom Marker:
- Landing: "Landing" (Leben 1) oder "Landing 2" (Leben 2+)
- Death: "Death" oder "Death 2"
- Kill: "Kill — <Waffe>" und Opfer-Name darunter
- Revive: "Revive"

Implementation: `mousemove` auf overlay-canvas, berechne ob Maus nahe eines Markers, setze state.hoveredMarker, re-render mit floating-label.

### Manuelles Zoom

- **Scrollwheel** auf Map: zoom-at-cursor (cursor-Position bleibt fix, Karten-Center verschiebt sich entsprechend).
- **Drag-Pan**: Maustaste halten + ziehen.
- **Doubleklick** in Leerraum: viewport-Reset auf Default-Zoom.
- **Zoom-Buttons** (klein, oben rechts in Map-Tools): + / − fuer User die kein Scrollwheel haben.

Limits:
- Min-Zoom: ganze Map sichtbar
- Max-Zoom: ~50m Sichtfenster (Haus-Ebene)

Bei `viewport.autoFollow=true` schaltet sich autoFollow aus sobald User manuell zoomt/pant. Re-Aktivierung ueber „Alle"-Button.

### Multi-Lives-Card-Layout

Card pro Member zeigt:
```
• Du                                    [ueberlebt | †mm:ss]
   Leben 1: landete Pochinki — † in Quarry (12:34) durch X mit M416 89m
   Leben 2: landete Mansion — survived
```

Bei 1 Leben: nur eine Zeile (Leben-Nummer weggelassen).
Bei 2+ Leben: jede Zeile praefixiert mit „Leben N:".

Card-Click setzt `soloAcc`; Klick auf eine Leben-Zeile sollte ggf. nicht-Solo-Effect aber Cursor-Seek auf Landing-Zeit dieses Lebens. Edge case, kann spaeter implementiert werden.

## Out of Scope v2

- Speed-Slider fuer Zeitraffer (immer 1x Realtime via Anim_DURATION).
- Twitch-Clip-Snap an Markers.
- Headshot-Detection.
- Mate-Klick zoomt nicht zu seinem konkreten Leben-Marker (Solo-Mode zeigt alle Leben des Mate auf einmal).

## Migrationspfad

1. Backend (`compute_match_detail`): Lives-Detection-Logik einbauen, alte Felder DEPRECATEN (entfernen). Tests anpassen.
2. Frontend: gesamtes mdRender* Suite umschreiben fuer v2-Layout + Viewport-State.
3. Bestehende v1-Funktionen (`mdRenderBasemap`, `mdRenderOverlay`, `mdMount`, `mdPlay`, etc.) komplett ersetzen — kein dual-mode.

Kein Rollback-Pfad noetig — wir gehen direkt auf v2. Wenn was nicht passt: revert auf Commit `c0e7f23` (Ende v1).

## Testing

- Backend-pytest fuer `compute_match_detail`: Test mit Comeback-Szenario (2 Lives), Test mit Single-Life (Bestaetigt dass lives[0] korrekt befuellt), Test mit Survival (death=None).
- Frontend manuell:
  1. Match aufklappen → Default-View: 4 Flugrouten + 4 Landing-Pins, sonst nichts.
  2. Play → Zeitraffer laeuft, Pins gleiten, Events erscheinen.
  3. Scrub Slider → Cursor springt, Karte rendert State des Zeitpunkts.
  4. Click auf Landing-Pin → Solo, Zoom 500m, Cursor=Landing-Zeit, paused.
  5. Click „Alle" → Reset Solo + Viewport + Cursor=0.
  6. Scroll-Wheel auf Map → Zoom mit cursor-Anchor.
  7. Drag-Pan → Map verschiebt sich, autoFollow off.
  8. Comeback-Match: Member zeigt zwei Landing-Pins (L1+L2 wenn ueber Marker-Hover sichtbar) + zwei Death-Pins (D1+D2).
  9. Pin-Hover → Floating-Label "Landing 1" / "Death 2" etc.
