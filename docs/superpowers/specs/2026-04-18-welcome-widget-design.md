# Welcome-Widget — Design Spec

## Motivation

Wenn ein Zuschauer das erste Mal im Chat erscheint, soll er kurz gefeiert werden — aber nicht auf Sub/Raid-Niveau (das passiert täglich mehrfach und würde schnell nerven). Das neue Widget ist ein **dezenter Toast**, ähnlich den bestehenden `latest-*`-Widgets, aber mit einer klar erkennbaren Celebration-Optik, die es vom normalen Follower-Widget abgrenzt.

**Zielrichtung: „Star Arrival"** — feierlich genug, dass Erstbesucher sich willkommen fühlen, aber kompakt und nicht aufdringlich.

## Abgrenzung / Scope

- **Nur das statische Widget-Design.** Slide-In/Out und OBS-Source-Transitions macht der Nutzer selbst.
- Widget ist persistent auf dem Canvas, sobald es geladen wird. Pop-Burst läuft einmal beim Laden, Sparkles laufen dauerhaft.
- Keine Streamer.bot-spezifischen Anpassungen hier — URL-Parameter genügen als Schnittstelle.

## Neue Datei: `widgets/welcome.html`

### Dimensionen

- **Interner Canvas:** 600×140
- **OBS Browser-Source:** 600×140 (oder kleiner, OBS skaliert proportional)
- Body: `overflow: hidden`, Hintergrund transparent
- Sparkle-Container und Pop-Burst-Container decken den gesamten Canvas ab

### Layout

```
┌────────────────────────────────────────┐
│       ✦ WILLKOMMEN ✦      [FIRST TIME] │
│                                        │
│          NeuerChatter                  │
│       ─────────────────                │
└────────────────────────────────────────┘
```

- Kicker oben zentriert
- Name XL mittig
- Gold-Divider unter dem Namen
- `FIRST TIME`-Badge oben rechts, leicht rotiert

### URL-Parameter

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `name` | `NewViewer42` | Angezeigter Username |

### Typografie

- **Font:** `DM Sans` (via `@font-face` aus `assets/DM-Sans.woff2`)
- **Kicker** `✦ WILLKOMMEN ✦`
  - 16px, Font-Weight 700, Gold `#f2b705`
  - Letter-Spacing 6px, `text-transform: uppercase`
  - `text-shadow: 0 0 10px rgba(242,183,5,0.8), 0 0 20px rgba(242,183,5,0.4)`
- **Name**
  - 44px, Font-Weight 900, Weiß `#ffffff`
  - `text-shadow: 0 0 20px rgba(255,255,255,0.6), 0 0 50px rgba(94,42,121,0.9), 0 0 80px rgba(155,85,192,0.4)`
  - White-space: nowrap, Overflow ellipsis falls zu lang
- **Badge `FIRST TIME`**
  - 11px, Font-Weight 700, Farbe `#c9a0dc`
  - Padding `4px 10px`, Border `1px solid #5e2a79`
  - Border-radius 4px
  - `transform: rotate(-8deg)`
  - Absolute Position: `top: 12px; right: 14px`
  - `text-shadow: 0 0 6px rgba(155,85,192,0.6)`
- **Divider**
  - 120px × 2px, 10px margin-top
  - `background: linear-gradient(90deg, transparent, #f2b705, transparent)`

### Farben

| Rolle | Hex |
|-------|-----|
| Gold | `#f2b705` |
| Purple | `#5e2a79` |
| Purple-Light | `#c9a0dc` |
| Purple-Mid | `#9b55c0` |
| Weiß | `#ffffff` |

## Effekte

### 1. Sparkle-Engine (dauerhaft)

Nutzt `js/sparkles.js` (bereits vorhanden):

```js
new SparkleEngine(container, {
  count: 14,
  speed: 0.4,
  maxOpacity: 1.0,
  colors: { gold: 0.4, purple: 0.4, white: 0.2 },
  sizeWeights: { big: 0.15, normal: 0.35, small: 0.35, tiny: 0.15 }
}).start();
```

- Container: `#sparkle-container`, `position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden`
- Edge-Fade-Zone (40px) + Bounce ist in `sparkles.js` bereits eingebaut → **Regel erfüllt**

### 2. Pop-Burst beim Laden (einmalig)

Zentraler Partikel-Burst beim Widget-Start, der das „Feier-Gefühl" auslöst.

**Mechanik:**
- 12 Partikel spawnen aus der Name-Zentrumsposition (Canvas-Mitte, etwa y=75)
- Jeder Partikel: Größe 8–14px, Farbe aus demselben Farbpool wie Sparkles (Gold/Purple/White)
- Animation-Dauer: 1.2s mit leichtem Delay-Jitter (0–150ms)
- Bewegung: Ausbreitung nach außen mit zufälligem Winkel `0–2π`

**Edge-Fade-Regel (Pflicht):**

Distanz pro Partikel wird **winkelbasiert gecappt**, sodass Endposition 40px vom Rand entfernt bleibt:

```
marginX = canvasW/2 - 40
marginY = canvasH/2 - 40
maxDist = min(marginX / |cos(angle)|, marginY / |sin(angle)|)
dist    = min(desiredDist, maxDist)
```

Wobei `desiredDist` z.B. `150 + Math.random() * 150` ist.

**Opacity-Kurve (fade vor Endposition):**

```
0%   → opacity 0, scale 0
15%  → opacity 1, scale 1       (quick pop in)
50%  → opacity 0.8
100% → opacity 0, final position
```

So verschwindet der Partikel, **bevor** er die Cap-Position erreicht → kein hartes Clipping am Rand.

**Container:** `#burst-container`, `position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden`. Einmalig generiert per JS beim DOMContentLoaded; nach Animation werden Elemente removed (oder bleiben mit `opacity: 0` liegen — unkritisch).

## Z-Index-Schichtung

| Element | z-index |
|---------|---------|
| Sparkle-Container | 0 |
| Burst-Container | 1 |
| Content (Kicker, Name, Divider, Badge) | 2 |

## Architektur

Eine einzelne HTML-Datei, kein zusätzlicher Build-Schritt:

- Inline `<style>` (Varianten, Keyframes, Layout)
- `<script src="../js/sparkles.js">` für die Sparkle-Engine (wie bei allen anderen Widgets)
- Inline `<script>` am Ende mit:
  1. URL-Param-Parsing
  2. Name-Injection in DOM
  3. `SparkleEngine`-Initialisierung
  4. Pop-Burst-Funktion (spawnt 12 Partikel)

Keine externen Abhängigkeiten.

## README-Integration

Abschnitt unter **Widgets** einfügen (neu zwischen Logo und den Info-Widgets):

```markdown
### Welcome-Widget

| | |
|-|-|
| **Datei** | `widgets/welcome.html` |
| **Beschreibung** | Toast-Widget für Erstbesucher im Chat — mit Pop-Burst beim Einblenden |
| **Interner Canvas** | 600×140 |
| **OBS Browser-Source** | 600×140 (OBS skaliert proportional) |

**URL-Parameter:** `?name=NeuerChatter`

**OBS-Setup:**
1. Browser-Source hinzufügen, 600×140
2. **Show Transition** (Slide / Fade) einstellen für Ein-/Ausblenden
3. Per Streamer.bot triggern, wenn ein neuer User zum ersten Mal chattet
```

Außerdem die Widget-Tabelle in der Übersicht aktualisieren.

## Testen / Verifikation

Lokal:
- `widgets/welcome.html?name=TestUser42` im Browser öffnen
- Prüfen: Sparkles bleiben innerhalb des Canvas, blenden am Rand aus
- Prüfen: Pop-Burst-Partikel sind bei `opacity: 0` wenn sie ihre Endposition erreichen (nie am Rand abgeschnitten sichtbar)
- Prüfen: Badge sauber rotiert, Name mit langen Strings wird via ellipsis gekürzt
- Prüfen: In OBS bei 600×140 sichtbar, bei Skalierung auf 400×93 weiterhin lesbar

## Out of Scope

- Streamer.bot-Action-Konfiguration (Nutzer macht das selbst)
- Sound-Effekt beim Einblenden
- Personalisierter Text basierend auf User-Daten (Land, Rolle, etc.)
- Fix der Partikel-Rand-Probleme in `alerts/giftsub.html` und `alerts/raid.html` — **separater Task** (audit-Ergebnis notiert)
