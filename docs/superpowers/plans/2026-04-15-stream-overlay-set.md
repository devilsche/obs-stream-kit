# Stream Overlay Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 16 eigenständige HTML/CSS/JS Browser-Sources für ein OBS Stream-Overlay-Set im Purple/Gold Entry-Style bauen.

**Architecture:** Jede Datei ist komplett eigenständig — kein Shared CSS, kein Build-Tool, kein Server. Jede HTML-Datei enthält alles inline (Styles, Scripts, Font-Face). Dateien werden per `file://` in OBS geladen. Daten kommen via URL-Parameter von Streamer.bot.

**Tech Stack:** Vanilla HTML5, CSS3 (@keyframes, CSS Custom Properties), JavaScript (Web Animations API, URL-Parameter-Parsing, Twitch Embed API für BRB-Szene)

**Spec:** `docs/superpowers/specs/2026-04-15-stream-overlay-set-design.md`

---

## Dateiübersicht

| # | Datei | Typ | Beschreibung |
|---|-------|-----|-------------|
| — | `assets/DM-Sans.woff2` | Font | Lokal eingebetteter Font |
| — | `assets/logo.png` | Asset | Placeholder, vom User ersetzt |
| 1 | `scenes/starting-soon.html` | Szene | Animierte Warteszene |
| 2 | `scenes/stream-ending.html` | Szene | Animierte Abschlussszene |
| 3 | `scenes/gameplay.html` | Szene | Cam-Rahmen Overlay |
| 4 | `scenes/just-chatting.html` | Szene | Cam-Ausschnitt + Chat-Bereich |
| 5 | `scenes/brb-pause.html` | Szene | Pause mit Clip-Player |
| 6 | `alerts/follow.html` | Alert | Center-Stage, Gold |
| 7 | `alerts/sub.html` | Alert | Center-Stage, Purple |
| 8 | `alerts/resub.html` | Alert | Center-Stage, Purple |
| 9 | `alerts/bits.html` | Alert | Center-Stage, Gold |
| 10 | `alerts/giftsub.html` | Alert | Fullscreen-Flash, Purple |
| 11 | `alerts/raid.html` | Alert | Fullscreen-Flash, Gold |
| 12 | `widgets/latest-follower.html` | Widget | Einflug-Box, Gold |
| 13 | `widgets/latest-sub.html` | Widget | Einflug-Box, Purple |
| 14 | `widgets/latest-tip.html` | Widget | Einflug-Box, Gold |
| 15 | `widgets/subgoal.html` | Widget | Fortschrittsbalken |
| 16 | `transitions/stinger.html` | Transition | Partikel/Geometrie |

---

## Gemeinsamer CSS-Block

Jede HTML-Datei enthält diesen CSS-Block im `<style>`. Hier einmal definiert, wird in jeder Task-Datei inline eingefügt. **Nicht als Shared-Datei — in jede HTML-Datei kopieren.**

```css
@font-face {
  font-family: 'DM Sans';
  src: url('../assets/DM-Sans.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}

:root {
  --color-purple: #5e2a79;
  --color-purple-light: #c9a0dc;
  --color-gold: #f2b705;
  --color-bg-dark: #0d0d1a;
  --color-bg-purple: #1a0d2e;
  --color-text: #ffffff;
  --color-text-muted: #888888;
  --glow-gold: 0 0 20px rgba(242, 183, 5, 0.3);
  --glow-purple: 0 0 20px rgba(94, 42, 121, 0.3);
}

*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  font-family: 'DM Sans', sans-serif;
  color: var(--color-text);
  /* background: transparent; — für Overlays/Alerts */
}
```

**Hinweis zum Font-Pfad:** Szenen in `scenes/` nutzen `../assets/DM-Sans.woff2`, Alerts in `alerts/` nutzen `../assets/DM-Sans.woff2`, usw. Der relative Pfad ist immer `../assets/`.

---

## Verifizierung

Da es kein Test-Framework gibt (reine statische HTML-Dateien), wird jede Datei nach Erstellung im Browser geöffnet und visuell geprüft:

```bash
# Datei im Browser öffnen (Linux)
xdg-open scenes/starting-soon.html
```

**Checkliste pro Datei:**
1. Öffnet fehlerfrei im Browser
2. DM Sans Font lädt korrekt
3. Animationen laufen smooth
4. Transparenz funktioniert (bei Overlays/Alerts: Hintergrund ist transparent, nicht weiß/schwarz)
5. URL-Parameter werden korrekt geparst (wo relevant)
6. Layout passt bei 1920×1080

---

### Task 1: Projekt-Setup + Assets

**Files:**
- Create: `assets/DM-Sans.woff2`
- Create: `assets/logo.png`
- Create: `scenes/` (leeres Verzeichnis)
- Create: `alerts/` (leeres Verzeichnis)
- Create: `widgets/` (leeres Verzeichnis)
- Create: `transitions/` (leeres Verzeichnis)

- [ ] **Step 1: Verzeichnisstruktur anlegen**

```bash
mkdir -p scenes alerts widgets transitions assets
```

- [ ] **Step 2: DM Sans Font herunterladen**

DM Sans ist ein Google Font. Die Variable-Weight woff2-Datei herunterladen:

```bash
curl -L -o assets/DM-Sans.woff2 "https://fonts.gstatic.com/s/dmsans/v15/rP2Hp2ywxg089UriCZOIHQ.woff2"
```

Falls der URL nicht funktioniert: Die Datei manuell von https://fonts.google.com/specimen/DM+Sans herunterladen und als `assets/DM-Sans.woff2` speichern.

- [ ] **Step 3: Placeholder-Logo erstellen**

Ein 200×200px transparentes PNG als Platzhalter. Der User ersetzt es später mit seinem echten Logo.

```bash
# Minimales 1x1 transparent PNG als Platzhalter
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > assets/logo.png
```

- [ ] **Step 4: Commit**

```bash
git add assets/ scenes/ alerts/ widgets/ transitions/
git commit -m "chore: Projektstruktur und Assets anlegen"
```

---

### Task 2: Starting Soon Szene

**Files:**
- Create: `scenes/starting-soon.html`

- [ ] **Step 1: HTML-Datei erstellen**

Komplette eigenständige HTML-Datei mit:
- Inline CSS: Gemeinsamer CSS-Block (siehe oben) + szenenspezifische Styles
- Hintergrund: `linear-gradient(135deg, var(--color-bg-dark), var(--color-bg-purple), var(--color-bg-dark))`
- Zentrierter Inhalt (flexbox): Titel → Divider → Subtitle
- 10 Partikel als `<div>`s mit absoluter Positionierung, verschiedene Größen (5–10px), Purple + Gold, `border-radius: 50%`, `box-shadow` für Glow
- 2–3 geometrische Akzent-Linien (horizontale Divs, `linear-gradient` von transparent zu Farbe zu transparent, `opacity: 0.3–0.5`)
- Unterer Akzent-Balken: `position: absolute; bottom: 0; height: 4px; background: linear-gradient(90deg, transparent 5%, var(--color-purple) 30%, var(--color-gold) 50%, var(--color-purple) 70%, transparent 95%)`

Titel-Styles:
```css
.title {
  font-size: 52px;
  font-weight: 900;
  letter-spacing: 12px;
  text-transform: uppercase;
  text-shadow: 0 0 30px rgba(94, 42, 121, 0.5), 0 0 60px rgba(94, 42, 121, 0.2);
  opacity: 0;
  animation: fadeInGlow 2s ease-out forwards;
}

.divider {
  width: 200px;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--color-gold), transparent);
  margin: 16px 0;
  animation: pulse 3s ease-in-out infinite;
}

.subtitle {
  font-size: 18px;
  color: var(--color-text-muted);
  letter-spacing: 5px;
  text-transform: uppercase;
  opacity: 0;
  animation: fadeIn 2s ease-out 0.5s forwards;
}
```

Animationen:
```css
@keyframes fadeInGlow {
  0% { opacity: 0; text-shadow: 0 0 0 transparent; }
  100% { opacity: 1; text-shadow: 0 0 30px rgba(94, 42, 121, 0.5), 0 0 60px rgba(94, 42, 121, 0.2); }
}

@keyframes fadeIn {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

@keyframes float {
  0%, 100% { transform: translateY(0) translateX(0); }
  25% { transform: translateY(-20px) translateX(10px); }
  50% { transform: translateY(-10px) translateX(-5px); }
  75% { transform: translateY(-30px) translateX(15px); }
}
```

Partikel bekommen `animation: float` mit verschiedenen Dauern (15s–30s) und Delays.

- [ ] **Step 2: Im Browser öffnen und prüfen**

```bash
xdg-open scenes/starting-soon.html
```

Prüfen: Font lädt, Titel faded ein mit Glow, Divider pulsiert, Partikel schweben, Akzent-Balken sichtbar.

- [ ] **Step 3: Commit**

```bash
git add scenes/starting-soon.html
git commit -m "feat: Starting Soon Szene mit Animationen"
```

---

### Task 3: Stream Ending Szene

**Files:**
- Create: `scenes/stream-ending.html`

- [ ] **Step 1: HTML-Datei erstellen**

Gleiche Struktur wie Starting Soon, mit folgenden Unterschieden:
- Titel zweizeilig: "DANKE FÜRS" (48px, weiß) + "ZUSCHAUEN" (48px, `color: var(--color-gold)`)
- Subtitle: "Bis zum nächsten Mal" (18px)
- Partikel-Animation: `float-down` statt `float` — Partikel sinken langsam nach unten
- Gold-Text bekommt zusätzlich Glow-Puls:

```css
.title-gold {
  font-size: 48px;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
  color: var(--color-gold);
  text-shadow: 0 0 30px rgba(242, 183, 5, 0.4);
  animation: fadeInGlow 2s ease-out forwards, glowPulse 3s ease-in-out 2s infinite;
}

@keyframes glowPulse {
  0%, 100% { text-shadow: 0 0 30px rgba(242, 183, 5, 0.4); }
  50% { text-shadow: 0 0 50px rgba(242, 183, 5, 0.6), 0 0 80px rgba(242, 183, 5, 0.3); }
}

@keyframes floatDown {
  0% { transform: translateY(0); opacity: var(--start-opacity); }
  100% { transform: translateY(100vh); opacity: 0; }
}
```

Titel "DANKE FÜRS" in weiß (gleicher Stil wie Starting Soon `.title`, aber 48px).

- [ ] **Step 2: Im Browser öffnen und prüfen**

```bash
xdg-open scenes/stream-ending.html
```

Prüfen: Zweizeiliger Titel, Gold-Glow pulsiert, Partikel sinken.

- [ ] **Step 3: Commit**

```bash
git add scenes/stream-ending.html
git commit -m "feat: Stream Ending Szene mit Animationen"
```

---

### Task 4: Gameplay Overlay

**Files:**
- Create: `scenes/gameplay.html`

- [ ] **Step 1: HTML-Datei erstellen**

Einfachste Szene — nur ein Cam-Rahmen auf transparentem Hintergrund.

Body-Background: `transparent` (wichtig für OBS-Overlay).

```css
body {
  /* ... gemeinsamer Block ... */
  background: transparent;
}

.cam-frame {
  position: absolute;
  bottom: 300px;
  left: 10px;
  width: 400px;
  height: 225px; /* 16:9 */
  border: 2px solid var(--color-purple);
  border-radius: 6px;
  box-shadow: 0 0 20px rgba(94, 42, 121, 0.4);
  background: transparent;
}
```

Kein weiteres HTML nötig — nur der `<div class="cam-frame">` im Body.

- [ ] **Step 2: Im Browser öffnen und prüfen**

```bash
xdg-open scenes/gameplay.html
```

Prüfen: Transparenter Hintergrund (Browser zeigt weiß, in OBS wird es transparent). Cam-Rahmen links unten, 300px vom Boden, Purple-Border mit Glow.

- [ ] **Step 3: Commit**

```bash
git add scenes/gameplay.html
git commit -m "feat: Gameplay Overlay mit Cam-Rahmen"
```

---

### Task 5: Just Chatting Szene

**Files:**
- Create: `scenes/just-chatting.html`

- [ ] **Step 1: HTML-Datei erstellen**

Komplexeste Szene. Aufbau:

**Hintergrund-Layer:**
```css
body {
  background: linear-gradient(135deg, var(--color-bg-dark), var(--color-bg-purple), var(--color-bg-dark));
}
```

**Cam-Ausschnitt (1:1, links):**
```css
.cam-cutout {
  position: absolute;
  top: 5%;       /* 54px */
  left: 3%;      /* 57.6px */
  height: 90%;   /* 972px */
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  border: 2px solid rgba(94, 42, 121, 0.6);
  box-shadow: 0 0 25px rgba(94, 42, 121, 0.3);
  background: transparent;
  /* Macht diesen Bereich transparent — Kamera liegt in OBS darunter */
}
```

Gold-Ecken-Akzente auf dem Cam-Ausschnitt: 4 pseudo-Elemente oder 4 kleine `<div>`s in den Ecken (30px lang, 2px dick, Gold).

**Chat-Bereich (rechts):**
```css
.chat-area {
  position: absolute;
  top: 5%;
  right: 3%;
  width: 38%;
  bottom: 5%;
  border-radius: 10px;
  overflow: hidden;
}

.chat-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg,
    rgba(242, 183, 5, 0.25),
    rgba(242, 183, 5, 0.15) 50%,
    rgba(242, 183, 5, 0.05));
  border-radius: 10px;
}

.chat-bg-radial {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center,
    rgba(242, 183, 5, 0.2),
    rgba(242, 183, 5, 0.08) 50%,
    transparent 80%);
  border-radius: 10px;
}

.chat-border {
  position: absolute;
  inset: 0;
  border-radius: 10px;
  border: 1px solid rgba(242, 183, 5, 0.3);
  box-shadow: 0 0 30px rgba(242, 183, 5, 0.1),
              inset 0 0 30px rgba(242, 183, 5, 0.05);
}

.chat-header {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(242, 183, 5, 0.2);
  position: relative;
  z-index: 1;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-gold);
  letter-spacing: 3px;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(242, 183, 5, 0.3);
}
```

**Animierter Rahmen (ganze Seite):**
4 `<div>`s für Top/Bottom/Left/Right, jeweils 3px dick, mit `linear-gradient`. Animation: Gradient-Position verschiebt sich mit `@keyframes borderGlow`.

```css
@keyframes borderGlow {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.border-top, .border-bottom {
  position: absolute;
  left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--color-purple), var(--color-gold), var(--color-purple), var(--color-gold));
  background-size: 200% 100%;
  animation: borderGlow 4s linear infinite;
  z-index: 11;
}
.border-top { top: 0; }
.border-bottom { bottom: 0; animation-direction: reverse; }

.border-left, .border-right {
  position: absolute;
  top: 0; bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--color-purple), var(--color-gold), var(--color-purple), var(--color-gold));
  background-size: 100% 200%;
  animation: borderGlowV 4s linear infinite;
  z-index: 11;
}

@keyframes borderGlowV {
  0% { background-position: 50% 0%; }
  100% { background-position: 50% 200%; }
}
.border-left { left: 0; }
.border-right { right: 0; animation-direction: reverse; }
```

**Partikel:** ~7 Stück über den gesamten Bildschirm (inkl. Cam-Ausschnitt), `z-index: 10`, `pointer-events: none`.

**Geometrische Linien:** 2–3 Stück im Hintergrundbereich.

- [ ] **Step 2: Im Browser öffnen und prüfen**

```bash
xdg-open scenes/just-chatting.html
```

Prüfen: Cam-Ausschnitt links (transparent in OBS), goldene Chat-Box rechts, animierter Rahmen wandert, Partikel schweben über alles.

- [ ] **Step 3: Commit**

```bash
git add scenes/just-chatting.html
git commit -m "feat: Just Chatting Szene mit Cam-Ausschnitt und Chat-Bereich"
```

---

### Task 6: BRB/Pause Szene mit Clip-Player

**Files:**
- Create: `scenes/brb-pause.html`

- [ ] **Step 1: HTML-Datei erstellen**

**Layout:** Flexbox, `flex-direction: row`.

**Clip-Player (links, `flex: 1`):**
```html
<div class="clip-area">
  <div id="clip-player" class="clip-player">
    <div class="clip-placeholder">Keine Clips verfügbar</div>
  </div>
</div>
```

```css
.clip-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 30px 30px 40px;
}

.clip-player {
  width: 90%;
  aspect-ratio: 16 / 9;
  border: 2px solid var(--color-purple);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(94, 42, 121, 0.4);
  position: relative;
  background: #000;
}

.clip-player iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.clip-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 18px;
  letter-spacing: 2px;
}
```

**Sidebar (rechts, 280px):**
```css
.sidebar {
  width: 280px;
  background: rgba(13, 13, 26, 0.9);
  border-left: 2px solid rgba(94, 42, 121, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px;
}

.brb-title {
  font-size: 48px;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
  text-shadow: 0 0 20px rgba(94, 42, 121, 0.5);
}

.brb-divider {
  width: 60px;
  height: 3px;
  background: var(--color-gold);
  margin: 12px 0;
}

.brb-subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
  letter-spacing: 3px;
  text-transform: uppercase;
  text-align: center;
}
```

**JavaScript — Clip-Player-Logik:**
```javascript
(function() {
  const params = new URLSearchParams(window.location.search);
  const clipsSrc = params.get('clips');
  if (!clipsSrc) return; // Placeholder bleibt sichtbar

  const slugs = clipsSrc.split(',').map(s => s.trim()).filter(Boolean);
  if (slugs.length === 0) return;

  // Shuffle
  for (let i = slugs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slugs[i], slugs[j]] = [slugs[j], slugs[i]];
  }

  const player = document.getElementById('clip-player');
  const placeholder = player.querySelector('.clip-placeholder');
  let currentIndex = 0;

  function loadClip(index) {
    if (placeholder) placeholder.style.display = 'none';
    const existing = player.querySelector('iframe');
    if (existing) existing.remove();

    const iframe = document.createElement('iframe');
    iframe.src = `https://clips.twitch.tv/embed?clip=${slugs[index]}&parent=localhost&autoplay=true&muted=false`;
    iframe.allowFullscreen = true;
    player.appendChild(iframe);
  }

  loadClip(0);

  // Alle 45 Sekunden nächsten Clip
  setInterval(() => {
    currentIndex = (currentIndex + 1) % slugs.length;
    loadClip(currentIndex);
  }, 45000);
})();
```

**Hinweis:** Der Twitch Embed braucht `parent=localhost` für localhost-Betrieb. Bei `file://` URLs funktioniert der Embed nicht direkt — Streamer.bot muss die Clip-Slugs liefern, und der User braucht ggf. einen einfachen lokalen Server für diese eine Szene, oder die Clips werden als direkte Video-URLs eingebettet. Dieses Problem in der Datei als Kommentar dokumentieren.

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open "scenes/brb-pause.html?clips=FunnyClip1,AwesomeClip2,EpicPlay3"
```

Prüfen: Sidebar rechts mit "BRB", Clip-Player links. Ohne Parameter: Placeholder-Text. Mit Parametern: Twitch Embed lädt (nur mit HTTP, nicht file://).

- [ ] **Step 3: Kommentar zur file:// Einschränkung hinzufügen**

Im HTML einen Kommentar am Anfang des Scripts einfügen:
```html
<!--
  HINWEIS: Twitch Embed funktioniert nicht mit file:// URLs.
  Optionen:
  1. Diese Datei über einen lokalen Server laden (z.B. python3 -m http.server 8080)
  2. Streamer.bot startet den Server automatisch
  3. Clip-Player als Alternative: Direkte Video-URLs statt Twitch Embed
-->
```

- [ ] **Step 4: Commit**

```bash
git add scenes/brb-pause.html
git commit -m "feat: BRB/Pause Szene mit Twitch Clip-Player"
```

---

### Task 7: Follow Alert (Center-Stage)

**Files:**
- Create: `alerts/follow.html`

- [ ] **Step 1: HTML-Datei erstellen**

Body: `background: transparent;`

**URL-Parameter parsen:**
```javascript
const params = new URLSearchParams(window.location.search);
const username = params.get('username') || 'Viewer';
const message = params.get('message') || 'Willkommen im Stream!';
```

**Alert-Box:**
```css
.alert-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.alert-box {
  background: linear-gradient(135deg, rgba(13, 13, 26, 0.95), rgba(26, 13, 46, 0.95));
  border: 2px solid rgba(242, 183, 5, 0.6);
  border-radius: 14px;
  padding: 32px 48px;
  text-align: center;
  box-shadow: 0 0 40px rgba(242, 183, 5, 0.2), 0 0 80px rgba(94, 42, 121, 0.15);
  max-width: 50%;
  position: relative;
  overflow: hidden;
  transform: scale(0);
  animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards,
             bounceOut 0.4s ease-in 4s forwards;
}

.alert-box::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(242, 183, 5, 0.08), transparent 70%);
  border-radius: 14px;
}

.event-type {
  font-size: 13px;
  color: var(--color-gold);
  letter-spacing: 4px;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(242, 183, 5, 0.4);
  margin-bottom: 8px;
  position: relative;
}

.username {
  font-size: 36px;
  font-weight: 900;
  position: relative;
  text-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
  opacity: 0;
  animation: fadeIn 0.4s ease-out 0.3s forwards;
}

.alert-divider {
  width: 80px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-gold), transparent);
  margin: 12px auto;
  position: relative;
}

.alert-message {
  font-size: 16px;
  color: #cccccc;
  position: relative;
}
```

**Animationen:**
```css
@keyframes bounceIn {
  0% { transform: scale(0); }
  50% { transform: scale(1.05); }
  70% { transform: scale(0.95); }
  100% { transform: scale(1); }
}

@keyframes bounceOut {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(0); opacity: 0; }
}

@keyframes glowPulse {
  0%, 100% { box-shadow: 0 0 40px rgba(242, 183, 5, 0.2), 0 0 80px rgba(94, 42, 121, 0.15); }
  50% { box-shadow: 0 0 60px rgba(242, 183, 5, 0.35), 0 0 100px rgba(94, 42, 121, 0.25); }
}
```

Gold-Glow pulsiert: `.alert-box` bekommt `animation: ..., glowPulse 2s ease-in-out 0.6s infinite`.

**Gold-Ecken-Akzente:** 4 `<div>`s mit `position: absolute` in den Ecken (20px × 2px und 2px × 20px).

**JavaScript:** Username und Message aus URL-Parametern in die DOM-Elemente setzen.

```javascript
document.querySelector('.username').textContent = username;
document.querySelector('.alert-message').textContent = message;
```

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open "alerts/follow.html?username=GamerDude42&message=Willkommen!"
```

Prüfen: Box bounced rein, Username faded ein, Glow pulsiert, nach 4s bounced raus.

- [ ] **Step 3: Commit**

```bash
git add alerts/follow.html
git commit -m "feat: Follow Alert (Center-Stage, Gold)"
```

---

### Task 8: Sub, Resub, Bits Alerts (Center-Stage)

**Files:**
- Create: `alerts/sub.html`
- Create: `alerts/resub.html`
- Create: `alerts/bits.html`

- [ ] **Step 1: Sub Alert erstellen**

Kopie von `follow.html` mit folgenden Änderungen:
- Event-Typ-Text: "NEW SUB"
- Farbschema: Purple statt Gold
  - Border: `rgba(94, 42, 121, 0.6)` statt `rgba(242, 183, 5, 0.6)`
  - `.event-type` Farbe: `var(--color-purple-light)` statt `var(--color-gold)`
  - Text-Shadow/Glow: Purple-Werte statt Gold
  - Ecken-Akzente: Purple
  - Divider: Purple Gradient
  - `box-shadow` in `glowPulse`: Purple-Werte
  - `::before` radial-gradient: Purple
- Default-Message: "Danke für den Sub!"

- [ ] **Step 2: Resub Alert erstellen**

Kopie von `sub.html` mit folgenden Änderungen:
- Event-Typ-Text: dynamisch aus URL-Parameter `months`: `RESUB — ${months} MONATE`
- URL-Parameter: `?username=X&months=6&message=Y`
- Default-Message: `${months} Monate dabei!`

```javascript
const months = params.get('months') || '1';
document.querySelector('.event-type').textContent = `RESUB — ${months} MONATE`;
document.querySelector('.alert-message').textContent = message || `${months} Monate dabei!`;
```

- [ ] **Step 3: Bits Alert erstellen**

Kopie von `follow.html` (Gold-Schema) mit folgenden Änderungen:
- Event-Typ-Text: dynamisch aus URL-Parameter `amount`: `BITS — ${amount}`
- URL-Parameter: `?username=X&amount=500&message=Y`
- Default-Message: `${amount} Bits! Mega!`

```javascript
const amount = params.get('amount') || '100';
document.querySelector('.event-type').textContent = `BITS — ${amount}`;
document.querySelector('.alert-message').textContent = message || `${amount} Bits! Mega!`;
```

- [ ] **Step 4: Alle drei im Browser testen**

```bash
xdg-open "alerts/sub.html?username=NightOwl"
xdg-open "alerts/resub.html?username=NightOwl&months=6"
xdg-open "alerts/bits.html?username=ChillVibes&amount=500"
```

Prüfen: Sub + Resub in Purple, Bits in Gold. Monate/Betrag im Event-Text sichtbar.

- [ ] **Step 5: Commit**

```bash
git add alerts/sub.html alerts/resub.html alerts/bits.html
git commit -m "feat: Sub, Resub und Bits Alerts (Center-Stage)"
```

---

### Task 9: Raid Alert (Fullscreen-Flash)

**Files:**
- Create: `alerts/raid.html`

- [ ] **Step 1: HTML-Datei erstellen**

Body: `background: transparent;`

**URL-Parameter:**
```javascript
const params = new URLSearchParams(window.location.search);
const username = params.get('username') || 'Raider';
const viewers = params.get('viewers') || '0';
```

**Fullscreen-Layout:**
```css
.flash-overlay {
  position: absolute;
  inset: 0;
  background: rgba(242, 183, 5, 0.3);
  opacity: 0;
  animation: flash 0.2s ease-out forwards;
  pointer-events: none;
  z-index: 20;
}

@keyframes flash {
  0% { opacity: 1; }
  100% { opacity: 0; }
}

.raid-bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center,
    rgba(94, 42, 121, 0.6),
    rgba(13, 13, 26, 0.95) 60%);
  opacity: 0;
  animation: fadeIn 0.5s ease-out 0.2s forwards,
             fadeOut 1s ease-in 4s forwards;
}

.raid-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
  opacity: 0;
  animation: fadeIn 0.5s ease-out 0.3s forwards,
             fadeOut 1s ease-in 4s forwards;
}

.raid-event {
  font-size: 18px;
  color: var(--color-gold);
  letter-spacing: 6px;
  text-transform: uppercase;
  text-shadow: 0 0 15px rgba(242, 183, 5, 0.5);
}

.raid-username {
  font-size: 56px;
  font-weight: 900;
  text-shadow: 0 0 30px rgba(255, 255, 255, 0.3),
               0 0 60px rgba(94, 42, 121, 0.3);
  margin: 8px 0;
}

.raid-viewers {
  font-size: 22px;
  color: var(--color-gold);
  text-shadow: 0 0 15px rgba(242, 183, 5, 0.4);
}

@keyframes fadeOut {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
```

**Partikel (~25 Stück):** Große Partikel (12–16px) mit `animation: explode` — starten in der Mitte, fliegen nach außen.

```css
@keyframes explode {
  0% {
    transform: translate(0, 0) scale(0);
    opacity: 1;
  }
  100% {
    transform: translate(var(--tx), var(--ty)) scale(1);
    opacity: 0;
  }
}
```

Jeder Partikel bekommt individuelle `--tx` und `--ty` CSS Custom Properties (z.B. `--tx: 400px; --ty: -300px`) per `style`-Attribut.

**Explosions-Linien:** 3 `<div>`s, jeweils `position: absolute; top: 50%; left: 50%`, mit verschiedenen `rotate()`, `linear-gradient` und fade-out Animation.

**JavaScript:** Username und Viewers in DOM setzen.

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open "alerts/raid.html?username=RaiderX&viewers=247"
```

Prüfen: Gold-Flash → Partikel explodieren → Username + Viewer-Count → nach 5s faded alles aus.

- [ ] **Step 3: Commit**

```bash
git add alerts/raid.html
git commit -m "feat: Raid Alert (Fullscreen-Flash, Gold)"
```

---

### Task 10: Gift Sub Alert (Fullscreen-Flash)

**Files:**
- Create: `alerts/giftsub.html`

- [ ] **Step 1: HTML-Datei erstellen**

Gleiche Struktur wie `raid.html` mit folgenden Änderungen:
- Flash-Farbe: Purple statt Gold (`rgba(94, 42, 121, 0.3)`)
- Event-Text: "GIFT SUBS"
- Detail-Text: dynamisch aus `amount`-Parameter: `${amount} Gift Subs!`
- Partikel-Farben: Mehr Purple als Gold (umgekehrtes Verhältnis)
- URL-Parameter: `?username=GenerousUser&amount=5`

```javascript
const amount = params.get('amount') || '1';
document.querySelector('.raid-event').textContent = 'GIFT SUBS';
document.querySelector('.raid-username').textContent = username;
document.querySelector('.raid-viewers').textContent = `${amount} Gift Subs!`;
```

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open "alerts/giftsub.html?username=GenerousUser&amount=5"
```

Prüfen: Purple-Flash, Purple-dominante Partikel, "5 Gift Subs!" sichtbar.

- [ ] **Step 3: Commit**

```bash
git add alerts/giftsub.html
git commit -m "feat: Gift Sub Alert (Fullscreen-Flash, Purple)"
```

---

### Task 11: Latest Follower Widget

**Files:**
- Create: `widgets/latest-follower.html`

- [ ] **Step 1: HTML-Datei erstellen**

Body: `background: transparent;`

**URL-Parameter:**
```javascript
const params = new URLSearchParams(window.location.search);
const name = params.get('name') || '';
```

**Widget-Box:**
```css
.widget-box {
  position: absolute;
  top: 50%;
  left: 20px;
  transform: translateY(-50%) translateX(-120%);
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(13, 13, 26, 0.95);
  border: 1px solid rgba(242, 183, 5, 0.3);
  border-left: 3px solid var(--color-gold);
  border-radius: 0 8px 8px 0;
  padding: 12px 24px;
  max-width: 400px;
  box-shadow: 0 0 20px rgba(242, 183, 5, 0.15);
}

.widget-label {
  font-size: 10px;
  color: var(--color-gold);
  letter-spacing: 2px;
  text-transform: uppercase;
  white-space: nowrap;
}

.widget-name {
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}
```

**Animation — Einflug bei visibilitychange:**
```javascript
function playEntrance() {
  const box = document.querySelector('.widget-box');
  box.animate([
    { transform: 'translateY(-50%) translateX(-120%)' },
    { transform: 'translateY(-50%) translateX(0)' }
  ], {
    duration: 300,
    easing: 'ease-out',
    fill: 'forwards'
  });
}

// Beim ersten Laden abspielen
if (document.visibilityState === 'visible') {
  playEntrance();
} else {
  // Wenn OBS die Source sichtbar macht
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      playEntrance();
    }
  });
}
```

**DOM:** Name aus URL-Parameter setzen.

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open "widgets/latest-follower.html?name=GamerDude42"
```

Prüfen: Box fliegt von links ein, Gold-Akzent, "LATEST FOLLOWER" Label, Name rechts daneben.

- [ ] **Step 3: Commit**

```bash
git add widgets/latest-follower.html
git commit -m "feat: Latest Follower Widget (Einflug-Box)"
```

---

### Task 12: Latest Sub + Latest Tip Widgets

**Files:**
- Create: `widgets/latest-sub.html`
- Create: `widgets/latest-tip.html`

- [ ] **Step 1: Latest Sub Widget erstellen**

Kopie von `latest-follower.html` mit folgenden Änderungen:
- Label: "LATEST SUB"
- Farbschema: Purple statt Gold
  - `border-left: 3px solid var(--color-purple)`
  - `.widget-label` Farbe: `var(--color-purple-light)`
  - `border: 1px solid rgba(94, 42, 121, 0.3)`
  - `box-shadow`: Purple-Glow

- [ ] **Step 2: Latest Tip Widget erstellen**

Kopie von `latest-follower.html` (Gold-Schema) mit folgenden Änderungen:
- Label: "LATEST TIP"
- Name-Anzeige: `${name} — ${amount}` (beide aus URL-Parametern)
- URL-Parameter: `?name=ChillVibes&amount=5,00 EUR`

```javascript
const name = params.get('name') || '';
const amount = params.get('amount') || '';
const display = amount ? `${name} — ${amount}` : name;
document.querySelector('.widget-name').textContent = display;
```

- [ ] **Step 3: Beide im Browser testen**

```bash
xdg-open "widgets/latest-sub.html?name=NightOwl"
xdg-open "widgets/latest-tip.html?name=ChillVibes&amount=5,00%20EUR"
```

Prüfen: Sub in Purple, Tip in Gold mit Betrag.

- [ ] **Step 4: Commit**

```bash
git add widgets/latest-sub.html widgets/latest-tip.html
git commit -m "feat: Latest Sub und Latest Tip Widgets"
```

---

### Task 13: Sub Goal Widget

**Files:**
- Create: `widgets/subgoal.html`

- [ ] **Step 1: HTML-Datei erstellen**

Body: `background: transparent;`

**URL-Parameter:**
```javascript
const params = new URLSearchParams(window.location.search);
const current = parseInt(params.get('current') || '0', 10);
const goal = parseInt(params.get('goal') || '50', 10);
const percent = Math.min(100, Math.round((current / goal) * 100));
```

**Widget-Box:**
```css
.widget-box {
  position: absolute;
  top: 50%;
  left: 20px;
  transform: translateY(-50%) translateX(-120%);
  background: rgba(13, 13, 26, 0.95);
  border: 1px solid rgba(94, 42, 121, 0.3);
  border-left: 3px solid var(--color-purple);
  border-radius: 0 8px 8px 0;
  padding: 12px 24px;
  max-width: 400px;
  min-width: 300px;
  box-shadow: 0 0 20px rgba(94, 42, 121, 0.15);
}

.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.widget-label {
  font-size: 10px;
  color: var(--color-purple-light);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.widget-count {
  font-size: 14px;
  font-weight: 700;
}

.progress-track {
  height: 6px;
  background: rgba(94, 42, 121, 0.3);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--color-purple), var(--color-gold));
  border-radius: 3px;
  box-shadow: 0 0 8px rgba(242, 183, 5, 0.4);
  transition: width 1s ease-out;
}
```

**JavaScript — Einflug + Fortschrittsbalken-Animation:**
```javascript
function playEntrance() {
  const box = document.querySelector('.widget-box');
  box.animate([
    { transform: 'translateY(-50%) translateX(-120%)' },
    { transform: 'translateY(-50%) translateX(0)' }
  ], {
    duration: 300,
    easing: 'ease-out',
    fill: 'forwards'
  });

  // Fortschrittsbalken nach Einflug animieren
  setTimeout(() => {
    document.querySelector('.progress-fill').style.width = percent + '%';
  }, 400);
}

// visibilitychange Handling wie bei den anderen Widgets
```

DOM: Zähler `${current} / ${goal}` in `.widget-count` setzen.

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open "widgets/subgoal.html?current=23&goal=50"
```

Prüfen: Box fliegt ein, Fortschrittsbalken füllt sich animiert auf 46%, Purple→Gold Gradient.

- [ ] **Step 3: Commit**

```bash
git add widgets/subgoal.html
git commit -m "feat: Sub Goal Widget mit Fortschrittsbalken"
```

---

### Task 14: Stinger Transition

**Files:**
- Create: `transitions/stinger.html`

- [ ] **Step 1: HTML-Datei erstellen**

Body: `background: transparent;`

Die gesamte Animation läuft einmal durch (1000ms) und endet transparent.

**HTML-Struktur:**
```html
<div class="stinger">
  <!-- Hintergrund — wird aufgebaut und abgebaut -->
  <div class="stinger-bg"></div>

  <!-- Geometrie-Formen -->
  <div class="geo geo-1"></div>
  <div class="geo geo-2"></div>
  <div class="geo geo-3"></div>

  <!-- Explosions-Linien -->
  <div class="line line-1"></div>
  <div class="line line-2"></div>
  <div class="line line-3"></div>

  <!-- Partikel (25 Stück, per JS generiert) -->
  <div id="particles"></div>
</div>
```

**CSS — Hintergrund:**
```css
.stinger {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.stinger-bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center,
    rgba(242, 183, 5, 0.9),
    rgba(94, 42, 121, 0.95) 40%,
    rgba(13, 13, 26, 1) 70%);
  opacity: 0;
  animation: bgIn 300ms ease-out 150ms forwards,
             bgOut 400ms ease-in 550ms forwards;
}

@keyframes bgIn {
  0% { opacity: 0; transform: scale(0.5); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes bgOut {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
```

**CSS — Geometrie (rotierende Quadrate):**
```css
.geo {
  position: absolute;
  top: 50%;
  left: 50%;
  border: 2px solid rgba(242, 183, 5, 0.6);
  opacity: 0;
}

.geo-1 {
  width: 300px; height: 300px;
  animation: geoIn 200ms ease-out 200ms forwards,
             geoSpin 600ms linear 200ms forwards,
             geoOut 300ms ease-in 600ms forwards;
  transform: translate(-50%, -50%) rotate(0deg) scale(0);
}
.geo-2 {
  width: 220px; height: 220px;
  border-color: rgba(94, 42, 121, 0.8);
  animation: geoIn 200ms ease-out 250ms forwards,
             geoSpin 500ms linear 250ms forwards,
             geoOut 300ms ease-in 650ms forwards;
  transform: translate(-50%, -50%) rotate(0deg) scale(0);
}
.geo-3 {
  width: 140px; height: 140px;
  animation: geoIn 200ms ease-out 300ms forwards,
             geoSpin 400ms linear 300ms forwards,
             geoOut 300ms ease-in 700ms forwards;
  transform: translate(-50%, -50%) rotate(0deg) scale(0);
}

@keyframes geoIn {
  0% { opacity: 0; transform: translate(-50%, -50%) rotate(0deg) scale(0); }
  100% { opacity: 1; transform: translate(-50%, -50%) rotate(45deg) scale(1); }
}

@keyframes geoSpin {
  0% { transform: translate(-50%, -50%) rotate(45deg) scale(1); }
  100% { transform: translate(-50%, -50%) rotate(135deg) scale(1.2); }
}

@keyframes geoOut {
  0% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(180deg) scale(1.5); }
}
```

**CSS — Explosions-Linien:**
```css
.line {
  position: absolute;
  top: 50%;
  left: 50%;
  height: 2px;
  background: linear-gradient(90deg, transparent 20%, var(--color-gold) 50%, transparent 80%);
  opacity: 0;
  transform-origin: center center;
}

.line-1 {
  width: 100%;
  animation: lineIn 300ms ease-out 200ms forwards,
             lineOut 400ms ease-in 550ms forwards;
  transform: translate(-50%, -50%) rotate(15deg);
}
.line-2 {
  width: 80%;
  background: linear-gradient(90deg, transparent 20%, var(--color-purple) 50%, transparent 80%);
  animation: lineIn 300ms ease-out 250ms forwards,
             lineOut 400ms ease-in 600ms forwards;
  transform: translate(-50%, -50%) rotate(-20deg);
}
.line-3 {
  width: 60%;
  animation: lineIn 300ms ease-out 300ms forwards,
             lineOut 400ms ease-in 650ms forwards;
  transform: translate(-50%, -50%) rotate(60deg);
}

@keyframes lineIn {
  0% { opacity: 0; }
  100% { opacity: 0.6; }
}

@keyframes lineOut {
  0% { opacity: 0.6; }
  100% { opacity: 0; }
}
```

**JavaScript — Partikel-Generator:**
```javascript
(function() {
  const container = document.getElementById('particles');
  const count = 25;
  const colors = ['var(--color-gold)', 'var(--color-purple)'];

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = 8 + Math.random() * 8; // 8–16px
    const color = colors[i % 2];
    const angle = (Math.PI * 2 * i) / count;
    const distance = 400 + Math.random() * 500; // 400–900px
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    const delay = 150 + Math.random() * 100; // 150–250ms (Phase 1: sammeln)

    p.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: 50%;
      box-shadow: 0 0 ${size * 2}px ${color};
      transform: translate(-50%, -50%);
      opacity: 0;
      --tx: ${tx}px;
      --ty: ${ty}px;
    `;

    // Phase 1 (0–200ms): Von Rand zur Mitte
    // Phase 2 (200–500ms): In der Mitte, sichtbar
    // Phase 3 (500–800ms): Explodieren nach außen
    p.animate([
      { transform: `translate(${-tx}px, ${-ty}px)`, opacity: 0 },
      { transform: 'translate(-50%, -50%)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -50%)', opacity: 1, offset: 0.5 },
      { transform: `translate(${tx * 0.5}px, ${ty * 0.5}px)`, opacity: 0 }
    ], {
      duration: 1000,
      delay: delay,
      easing: 'ease-in-out',
      fill: 'forwards'
    });

    container.appendChild(p);
  }
})();
```

**Optionaler Sound:**
```html
<!-- Auskommentiert — User kann eigene Sound-Datei einbinden -->
<!-- <audio id="sfx" src="../assets/stinger-whoosh.mp3" preload="auto"></audio> -->
<!-- <script>document.getElementById('sfx').play();</script> -->
```

- [ ] **Step 2: Im Browser testen**

```bash
xdg-open transitions/stinger.html
```

Prüfen: Partikel sammeln sich (0–200ms), Bildschirm bedeckt (200–500ms), Auflösung (500–800ms), clean (800–1000ms). Seite refreshen um nochmal abzuspielen.

- [ ] **Step 3: Commit**

```bash
git add transitions/stinger.html
git commit -m "feat: Stinger Transition mit Partikel/Geometrie-Animation"
```

---

### Task 15: Finaler Push + README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README aktualisieren**

```markdown
# obs-stream-kit

Komplettes OBS Stream-Overlay-Set als statische HTML/CSS/JS Browser-Sources.

Purple/Gold Entry-Style — für den Twitch-Kanal [LuCKoR_HD](https://twitch.tv/LuCKoR_HD).

## Szenen

| Datei | Beschreibung |
|-------|-------------|
| `scenes/starting-soon.html` | Animierte Warteszene |
| `scenes/brb-pause.html` | Pause mit Twitch Clip-Player |
| `scenes/stream-ending.html` | Animierte Abschlussszene |
| `scenes/gameplay.html` | Gameplay Overlay mit Cam-Rahmen |
| `scenes/just-chatting.html` | Fullscreen-Kamera mit Chat-Bereich |

## Alerts

| Datei | Typ | Trigger |
|-------|-----|---------|
| `alerts/follow.html` | Center-Stage (Gold) | `?username=X&message=Y` |
| `alerts/sub.html` | Center-Stage (Purple) | `?username=X&message=Y` |
| `alerts/resub.html` | Center-Stage (Purple) | `?username=X&months=N&message=Y` |
| `alerts/bits.html` | Center-Stage (Gold) | `?username=X&amount=N&message=Y` |
| `alerts/giftsub.html` | Fullscreen-Flash (Purple) | `?username=X&amount=N` |
| `alerts/raid.html` | Fullscreen-Flash (Gold) | `?username=X&viewers=N` |

## Widgets

| Datei | Beschreibung | Parameter |
|-------|-------------|-----------|
| `widgets/latest-follower.html` | Einflug-Box (Gold) | `?name=X` |
| `widgets/latest-sub.html` | Einflug-Box (Purple) | `?name=X` |
| `widgets/latest-tip.html` | Einflug-Box (Gold) | `?name=X&amount=Y` |
| `widgets/subgoal.html` | Fortschrittsbalken | `?current=N&goal=N` |

## Transition

| Datei | Beschreibung | OBS-Setup |
|-------|-------------|-----------|
| `transitions/stinger.html` | Partikel/Geometrie (1s) | Browser Transition Plugin, Duration: 1000ms, Transition Point: 350ms |

## Setup

1. Repo klonen
2. `assets/logo.png` mit deinem Logo ersetzen
3. In OBS: Browser-Source hinzufügen → lokale Datei auswählen
4. Alerts/Widgets: Streamer.bot konfigurieren für URL-Parameter + Source-Sichtbarkeit
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README mit vollständiger Übersicht"
```

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-Review Ergebnis

**Spec-Abdeckung:** Alle 5 Szenen, 6 Alerts, 4 Widgets, 1 Transition sind als Tasks abgedeckt. Design-Tokens sind im gemeinsamen CSS-Block definiert. Datenfluss via URL-Parameter ist in jeder Task dokumentiert.

**Placeholder-Scan:** Keine TBDs/TODOs. Jede Task enthält konkreten Code.

**Typ-Konsistenz:** URL-Parameter-Namen sind konsistent (`username`, `message`, `name`, `amount`, `months`, `viewers`, `current`, `goal`, `clips`). CSS Custom Properties sind überall identisch.

**Bekannte Einschränkung:** BRB Clip-Player (Task 6) funktioniert nicht mit `file://` URLs wegen Twitch Embed CORS. In der Datei dokumentiert mit Workaround-Optionen.
