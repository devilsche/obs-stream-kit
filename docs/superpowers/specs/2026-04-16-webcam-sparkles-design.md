# Animationen & Sparkles Upgrade — Design Spec

## Motivation

Der aktuelle Webcam-Rahmen in `gameplay.html` ist statisch (2px lila Border, kein Glow, keine Animation) und fest in die Gameplay-Scene eingebettet. Dadurch kann er nicht unabhängig ein-/ausgeschaltet werden. Der Just-Chatting-Rahmen hat zwar animierte Gradient-Borders, wirkt aber im Vergleich zu den anderen Szenen (Starting Soon, Stream Ending) noch zu zurückhaltend. Es fehlt ein durchgängiger visueller Stil mit Sparkles und Glow über alle sichtbaren Elemente.

**Ziel:** Konsistentes visuelles Upgrade über Webcam-Rahmen, Gameplay-Overlay, Logo und Info-Widgets — mit langsamen Blitzen, fliegenden Sparkles und Neon-Glow.

## Änderungen

### 1. Neue Datei: `widgets/webcam-frame.html`

Standalone Webcam-Widget, unabhängig von Szenen ein-/ausschaltbar in OBS.

**Layout:**
- 1920×1080 Canvas
- Grüner Chroma-Key-Hintergrund (`#00b140`) — wird in OBS per Chroma Key Filter entfernt
- Zentrierter Webcam-Bereich, Standardgröße 400×225 (16:9)
- Konfigurierbar via URL-Parameter: `?width=400&height=225`

**Langsame Blitz-Arcs (SVG):**
- 4 SVG Polylines entlang der Kanten (oben, unten, links, rechts)
- Leicht gezackte Linien die dem Rahmen folgen
- Oben + Links: `--color-purple-light` (#c9a0dc)
- Unten + Rechts: `--color-gold` (#f2b705)
- Flicker via CSS `@keyframes` mit 3–5 Sekunden Zyklen (nicht schneller)
- SVG `feGaussianBlur` Filter für Glow-Effekt
- 6 Spark-Punkte an Blitz-Knotenpunkten, langsam pulsierend (3–4.5s Zyklen)

**Fliegende Sparkles (JS):**
- ~14 Sparkles die frei über den gesamten Widget-Bereich fliegen
- Farbverteilung: Gold (~35%), Lila (~35%), Weiß (~30%)
- Verschiedene Größen (big, normal, small)
- Bewegung via `requestAnimationFrame`:
  - Sanftes Wandern mit `sin/cos`-basiertem Wobble
  - Zufällige Richtungswechsel (gelegentlich, ~0.3% pro Frame)
  - Wrap-Around an den Rändern
- Fade In/Out: sinusförmig, 4–8s Zyklen, versetzt
- Darstellung: Unicode `✦` mit `text-shadow` Glow passend zur Farbe

### 2. Neue Datei: `widgets/logo-watermark.html`

Animiertes Logo-Watermark — wie ein Sender-Logo in einer Bildschirmecke.

**Layout:**
- 1920×1080 Canvas, transparenter Hintergrund
- Logo (`assets/logo.png`) dezent in einer Ecke positioniert
- Logo-Größe: ~80–120px breit, proportional skaliert

**Animationen:**
- Langsam pulsierender Neon-Glow um das Logo (2–3s Zyklus)
  - Wechsel zwischen `--color-purple` und `--color-gold` Glow
  - `box-shadow` / `filter: drop-shadow()` für den Effekt
- 4–6 kleine Sparkles die um das Logo schweben
  - Kleiner und dezenter als beim Webcam-Widget
  - Bleiben im Umkreis des Logos (kein Wrap-Around über den ganzen Screen)
- Logo-Opacity leicht pulsierend (0.7–0.9) für lebendigen Eindruck

### 3. Modifiziert: `scenes/gameplay.html`

Cam-Frame entfernen, Sparkle-Overlay hinzufügen. Bei Bedarf ein-/ausschaltbar.

**Entfernen:**
- Das `.cam-frame` Element (div mit 400×225, lila Border)
- Zugehörige CSS-Regeln

**Hinzufügen:**
- ~18 fliegende Sparkles auf transparentem Hintergrund
- Gleiche Sparkle-Technik wie im Webcam-Widget, aber dezenter:
  - Langsamere Geschwindigkeit (`speed: 0.15–0.5`)
  - Niedrigere Opacity (max 0.8 statt 1.0)
  - Mehr kleine/winzige Sparkles, weniger große
- Sparkles verteilen sich über den gesamten 1920×1080 Canvas

### 4. Modifiziert: `scenes/just-chatting.html`

Bestehenden Cam-Rahmen mit gleichen Effekten aufwerten.

**Beibehalten:**
- Bestehendes Layout (Cam-Bereich links, Chat rechts)
- Animierte Gradient-Borders (borderSlide Keyframes)
- Gold Corner-Accents (8 kleine Divs in den Ecken)
- Bestehende Particles

**Hinzufügen:**
- Langsame Blitz-Arcs um den Cam-Bereich (gleicher SVG-Ansatz wie Webcam-Widget)
  - Skaliert auf die Cam-Bereich-Größe (größer als 400×225)
  - Gleiche Farben und Timing
- ~10 fliegende Sparkles im Cam-Bereich
  - Begrenzt auf den Cam-Ausschnitt, nicht über den Chat-Bereich
  - Gleiche Technik, leicht dezenter

### 5. Modifiziert: Info-Widgets (4 Dateien)

Betrifft: `widgets/latest-follower.html`, `widgets/latest-sub.html`, `widgets/latest-tip.html`, `widgets/subgoal.html`

Alle vier Widgets bekommen ein konsistentes visuelles Upgrade.

**Beibehalten:**
- Bestehendes Box-Layout und Slide-In-Animation
- Farbige linke Border (Gold für Follower/Tip, Lila für Sub)
- Bestehende Textdarstellung und Struktur

**Hinzufügen:**
- Neon-Glow auf der Box: `box-shadow` mit passender Farbe (Gold oder Lila), langsam pulsierend (3s Zyklus)
- 3–4 kleine Sparkles die nah an der Box schweben
  - Begrenzt auf den Widget-Bereich (~450×80px)
  - Sehr dezent — die Info soll lesbar bleiben
  - Farbe passend zum Widget-Thema (Gold oder Lila)
- Subtiler Glow auf dem farbigen linken Rand

## Technik

- Vanilla HTML/CSS/JS — konsistent mit dem Projektstandard
- Keine externen Abhängigkeiten
- CSS Custom Properties (`--color-purple`, `--color-gold`, etc.) aus dem bestehenden Design-System
- SVG inline im HTML (kein externer SVG-Import)
- JS Sparkle-Engine als `<script>` Block am Ende jeder Datei
- `file://` kompatibel (kein Server nötig)

## URL-Parameter

**Webcam-Widget (`widgets/webcam-frame.html`):**

| Parameter | Default | Beschreibung |
|-----------|---------|-------------|
| `width`   | `400`   | Breite des Cam-Bereichs in px |
| `height`  | `225`   | Höhe des Cam-Bereichs in px |

## Verifizierung

1. `widgets/webcam-frame.html` in Browser öffnen → Grüner Hintergrund, Cam-Bereich, langsame Blitze, fliegende Sparkles sichtbar
2. In OBS als Browser-Source hinzufügen → Chroma Key Filter anwenden → Grün verschwindet, nur Rahmen + Effekte bleiben
3. Widget ein-/ausschalten → Funktioniert unabhängig von Szenen
4. URL-Parameter testen: `?width=500&height=280` → Cam-Bereich passt sich an
5. `widgets/logo-watermark.html` in Browser öffnen → Logo mit pulsierendem Glow und kleinen Sparkles sichtbar
6. `scenes/gameplay.html` in Browser öffnen → Transparenter Hintergrund, nur Sparkles sichtbar, kein Cam-Frame
7. `scenes/just-chatting.html` in Browser öffnen → Bestehende Elemente intakt, zusätzlich Blitze und Sparkles am Cam-Rahmen
8. Info-Widgets in Browser öffnen → Slide-In-Animation + Glow + dezente Sparkles
9. Alle Animationen laufen flüssig ohne merkbare Performance-Einbußen
