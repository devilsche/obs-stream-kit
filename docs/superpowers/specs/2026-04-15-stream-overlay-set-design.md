# Stream Overlay Set — Design Spec

## Übersicht

Komplettes OBS Stream-Overlay-Set für den Twitch-Kanal **LuCKoR_HD**. Alle Komponenten sind eigenständige HTML/CSS/JS-Dateien, die als OBS Browser-Sources eingebunden werden. Kein Build-Tool, kein Framework, kein Server.

**Design-Sprache:** Entry-inspiriert — Purple (#5e2a79) / Gold (#f2b705), DM Sans Font, Dark Theme. Animationen smooth und professionell, nicht übertrieben.

## Dateistruktur

```
obs-stream-kit/
├── scenes/
│   ├── starting-soon.html      — Animierte Warteszene
│   ├── brb-pause.html          — Pause mit Twitch Clip-Player
│   ├── stream-ending.html      — Animierte Abschlussszene
│   ├── gameplay.html           — Overlay mit Cam-Rahmen
│   └── just-chatting.html      — Fullscreen-Deko mit Cam-Ausschnitt + Chat-Bereich
├── alerts/
│   ├── follow.html             — Center-Stage Alert
│   ├── sub.html                — Center-Stage Alert
│   ├── resub.html              — Center-Stage Alert
│   ├── giftsub.html            — Fullscreen-Flash Alert
│   ├── bits.html               — Center-Stage Alert
│   └── raid.html               — Fullscreen-Flash Alert
├── widgets/
│   ├── latest-follower.html    — Einflug-Widget (geschlossene Box)
│   ├── latest-sub.html         — Einflug-Widget (geschlossene Box)
│   ├── latest-tip.html         — Einflug-Widget (geschlossene Box)
│   └── subgoal.html            — Fortschrittsbalken-Widget (geschlossene Box)
├── transitions/
│   └── stinger.html            — Partikel/Geometrie-Übergang
└── assets/
    ├── logo.png                — Vom User bereitgestellt
    └── DM-Sans.woff2           — Font, lokal eingebettet
```

## Technische Basis (gilt für alle Dateien)

- 1920×1080 Canvas
- Vanilla HTML/CSS/JS — kein Framework, kein Build-Tool
- Transparenter Hintergrund wo nötig
- Animationen via CSS @keyframes + Web Animations API
- DM Sans Font lokal eingebettet (assets/DM-Sans.woff2)
- Konfigurierbar via URL-Parameter (z.B. `?username=LuCKoR_HD&color=#f2b705`)
- Kein eingebautes Branding/Streamer-Name — Logo wird als eigene OBS-Source positioniert
- Dateien werden per `file://` Protokoll in OBS geladen (kein Server nötig)

## Szenen

### 1. Starting Soon (`scenes/starting-soon.html`)

**Typ:** Fullscreen, nicht transparent
**Zweck:** Wird vor Stream-Start angezeigt

**Layout:**
- Zentrierter Text "STARTING SOON" (52px, 900 weight, letter-spacing 12px)
- Darunter Gold-Divider (200px breit, 3px)
- Darunter Subtitle "Stream beginnt gleich" (18px, letter-spacing 5px)
- Hintergrund: Dunkler Gradient (#0d0d1a → #1a0d2e → #0d0d1a)

**Effekte:**
- Schwebende Partikel (Purple + Gold, mit Glow, ~10 Stück)
- Geometrische Akzent-Linien (halbtransparent)
- Unterer Akzent-Balken (4px, Purple→Gold→Purple Gradient)
- Titel mit Purple Text-Shadow/Glow

**Animationen:**
- Partikel schweben langsam (infinite, verschiedene Geschwindigkeiten)
- Titel faded ein mit Glow-Effekt
- Divider pulsiert dezent

### 2. BRB / Pause (`scenes/brb-pause.html`)

**Typ:** Fullscreen, nicht transparent
**Zweck:** Pause-Szene mit Twitch Clip-Player

**Layout:**
- Links: Großer Clip-Player-Bereich (Twitch Embed, 90% der linken Fläche)
- Rechts: Sidebar (280px) mit "BRB" (48px, 900 weight) + Gold-Divider + "Bin gleich zurück"
- Hintergrund: Gleicher dunkler Gradient wie Starting Soon
- Unterer Akzent-Balken

**Clip-Player:**
- Streamer.bot liefert eine komma-separierte Liste von Clip-Slugs via URL-Parameter (z.B. `?clips=slug1,slug2,slug3`)
- Clips werden in zufälliger Reihenfolge abgespielt, wechseln automatisch alle 30–60 Sekunden
- Twitch Embed API (`clips.twitch.tv/embed`) für die Wiedergabe
- Fallback bei fehlenden Parametern: Platzhalter-Anzeige "Keine Clips verfügbar"

**Sidebar:**
- Purple-Trennlinie (2px, mit Glow)
- Dunkler halbtransparenter Hintergrund

### 3. Stream Ending (`scenes/stream-ending.html`)

**Typ:** Fullscreen, nicht transparent
**Zweck:** Abschlussszene nach dem Stream

**Layout:**
- Zentriert: "DANKE FÜRS" (48px, weiß) + "ZUSCHAUEN" (48px, Gold)
- Gold-Divider + "Bis zum nächsten Mal" (18px)
- Gleicher Hintergrund + Partikel + Akzent-Balken wie Starting Soon

**Animationen:**
- Elemente faden langsam ein
- Partikel sinken nach unten
- Gold-Text hat Glow-Puls

### 4. Gameplay Overlay (`scenes/gameplay.html`)

**Typ:** Transparent, nur Cam-Rahmen
**Zweck:** Overlay über dem Gameplay

**Layout:**
- Kamera-Rahmen: 400×225px (16:9), links, 300px vom unteren Rand, 10px vom linken Rand
- Rahmen: 2px solid #5e2a79, border-radius 6px, Purple-Glow (box-shadow)
- Rest: Komplett transparent
- Kein Branding, kein Text, kein Top-Bar

### 5. Just Chatting (`scenes/just-chatting.html`)

**Typ:** Teilweise transparent (Cam-Ausschnitt)
**Zweck:** Fullscreen-Kamera-Szene mit Chat

**Layout:**
- Fullscreen dunkler Hintergrund (Gradient wie andere Szenen)
- Links: Quadratischer (1:1) Cam-Ausschnitt, 90% der Höhe, 3% vom linken Rand
  - Transparent — Kamera-Source liegt in OBS darunter
  - Purple-Rahmen (2px, border-radius 10px) mit Gold-Ecken-Akzente
- Rechts: Chat-Bereich, 38% Breite, 3% vom rechten Rand
  - Goldener halbtransparenter Hintergrund (Gradient: Gold 25% Opacity → Gold 5% Opacity, zum Rand auslaufend)
  - Goldener Rahmen (1px, 30% Opacity) mit Glow
  - "CHAT" Header (14px, Gold, letter-spacing 3px)
  - Chat-Widget wird als eigene OBS-Source darüber gelegt

**Effekte:**
- Animierter Purple/Gold-Rahmen um den gesamten Bildschirm (3px, Gradient wandert)
- Schwebende Partikel über alles (auch über den Cam-Ausschnitt)
- Geometrische Akzent-Linien im Hintergrund

**OBS Layer-Aufbau:**
1. (unten) Webcam/Greenscreen-Source
2. just-chatting.html Browser-Source
3. Chat-Widget (z.B. Twitch Chat)
4. (oben) Logo als Bild-Source

## Alerts

### Center-Stage Alerts (Follow, Sub, Resub, Bits)

**Typ:** Transparent, nur die Alert-Box
**Trigger:** Streamer.bot aktiviert die OBS Browser-Source
**Daten:** Via URL-Parameter (`?username=GamerDude42&event=follow&message=...`)

**Layout:**
- Zentrierte Box (max-width 50%)
- Dunkler Hintergrund (Gradient #0d0d1a → #1a0d2e, 95% Opacity)
- Abgerundete Ecken (14px), Gold-Ecken-Akzente
- Event-Typ oben (13px, letter-spacing 4px, uppercase)
- Username groß in der Mitte (36px, 900 weight)
- Divider (80px, 2px)
- Nachricht unten (16px)

**Farbschema:**
- Follow + Bits: Gold-Akzent (#f2b705) — goldener Rahmen, goldener Event-Text
- Sub + Resub: Purple-Akzent (#5e2a79 / #c9a0dc) — Purple-Rahmen, Purple-Event-Text

**Animation:**
- Box skaliert von 0% → 100% mit Bounce-Effekt
- Gold/Purple-Glow pulsiert
- Username faded 0.3s verzögert ein
- Nach 4 Sekunden: raus-skalieren (100% → 0%)

### Fullscreen-Flash Alerts (Raid, Gift Sub)

**Typ:** Fullscreen, transparent nach Ende
**Trigger:** Streamer.bot aktiviert die OBS Browser-Source

**Layout:**
- Fullscreen radial Gradient (Purple-Zentrum → Dunkel)
- Event-Typ oben (18px, Gold, letter-spacing 6px)
- Username riesig (56px, 900 weight)
- Divider + Detail-Info (z.B. "+247 Viewer" bei Raid, "5 Gift Subs" bei Gift Sub)
- Massive Partikel (~20–30 Stück, größer als bei Szenen)
- Geometrische Explosions-Linien (rotiert, verschiedene Winkel)

**Animation:**
- Kurzer Gold-Flash (0.2s, voller Bildschirm)
- Partikel explodieren vom Zentrum nach außen
- Text faded groß ein
- Geometrie-Linien rotieren und faden aus
- Nach 5 Sekunden: alles faded aus

## Widgets

Jedes Widget ist eine eigene HTML-Datei und eine eigene OBS Browser-Source. Streamer.bot steuert die Sichtbarkeit via OBS-WebSocket. Beim Sichtbar-Werden (`visibilitychange` Event) spielt die Einflug-Animation ab.

**Daten-Übergabe:** Streamer.bot setzt die Browser-Source-URL mit Parametern (z.B. `latest-follower.html?name=GamerDude42`).

### Latest Follower, Latest Sub, Latest Tip (`widgets/latest-*.html`)

**Layout:** Geschlossene Box (max-width 400px)
- Dunkler Hintergrund (#0d0d1a, 95% Opacity)
- Farbiger linker Rand (3px) — Gold für Follower + Tip, Purple für Sub
- Label links (10px, uppercase, letter-spacing 2px)
- Name/Wert rechts (18px, 700 weight, weiß)
- Abgerundete Ecken, farbiger Glow (box-shadow)

**Animation:** Slide-in von links (300ms ease-out), beim Sichtbar-Werden

### Sub Goal (`widgets/subgoal.html`)

**Layout:** Geschlossene Box (max-width 400px)
- Gleicher Stil wie die anderen Widgets
- Purple linker Rand
- Label "SUB GOAL" links + Zähler rechts (z.B. "23 / 50")
- Fortschrittsbalken darunter (6px Höhe, Purple→Gold Gradient, abgerundete Ecken)

**Daten:** Via URL-Parameter (`?current=23&goal=50`)

## Stinger Transition (`transitions/stinger.html`)

**Typ:** Fullscreen, transparent nach Ende
**Einbindung:** OBS Browser Transition Plugin — ruft die HTML-Datei direkt auf
**Duration:** 1000ms
**Transition Point:** 350ms (Bildschirm komplett bedeckt, Szenen-Wechsel passiert)

**Animation in 4 Phasen:**

1. **Partikel sammeln (0–200ms)**
   - ~20–30 Partikel (Purple + Gold, mit Glow) fliegen von den Rändern zur Bildmitte
   - Geometrische Linien erscheinen

2. **Explosion / Cover (200–500ms)**
   - Bildschirm komplett bedeckt (radial Gradient: Gold-Zentrum → Purple → Dunkel)
   - Rotierende Quadrate/Rauten expandieren vom Zentrum
   - Explosions-Linien in verschiedenen Winkeln
   - **Bei 350ms:** Szenen-Wechsel durch OBS

3. **Auflösung (500–800ms)**
   - Geometrie-Formen lösen sich auf (scale + fade out)
   - Partikel fliegen vom Zentrum nach außen
   - Hintergrund faded zu transparent

4. **Clean (800–1000ms)**
   - Letzte Partikel verschwinden
   - Komplett transparent — neue Szene voll sichtbar

**Sound:** Optionaler Whoosh/Impact-Sound via `<audio>` Element eingebaut

## Design-Tokens (konsistent über alle Dateien)

```
Farben:
  --color-purple:       #5e2a79
  --color-purple-light: #c9a0dc
  --color-gold:         #f2b705
  --color-bg-dark:      #0d0d1a
  --color-bg-purple:    #1a0d2e
  --color-text:         #ffffff
  --color-text-muted:   #888888

Font:
  --font-family:        'DM Sans', sans-serif
  --font-weight-normal: 400
  --font-weight-bold:   700
  --font-weight-black:  900

Effekte:
  --glow-gold:          0 0 20px rgba(242, 183, 5, 0.3)
  --glow-purple:        0 0 20px rgba(94, 42, 121, 0.3)
  --gradient-bg:        linear-gradient(135deg, #0d0d1a, #1a0d2e, #0d0d1a)
  --accent-bar:         4px, linear-gradient(Purple→Gold→Purple)

Radien:
  --radius-sm:          6px   (Gameplay Cam-Rahmen)
  --radius-md:          10px  (Szenen-Elemente, Chat-Box)
  --radius-lg:          14px  (Alert-Boxen)

Partikel:
  --particle-size-sm:   5–7px
  --particle-size-md:   8–10px
  --particle-size-lg:   12–16px (nur Fullscreen-Flash + Stinger)
```

## Datenfluss

```
Twitch Event → Streamer.bot → OBS WebSocket → Browser-Source URL/Sichtbarkeit

Alerts:    Streamer.bot setzt URL-Parameter + aktiviert Source → Animation spielt
Widgets:   Streamer.bot setzt URL-Parameter + toggelt Sichtbarkeit → Einflug-Animation
Clips:     Streamer.bot liefert Clip-URLs via URL-Parameter an brb-pause.html
Tips:      Streamlabs → Streamer.bot → Widget URL-Parameter
```

## Nicht im Scope

- Kein Server / Backend
- Kein Streamer.bot-Setup (der User konfiguriert das selbst)
- Kein Streamlabs-Setup
- Kein Logo-Design (User liefert logo.png)
- Kein Sound-Design (optionaler Platzhalter-Sound im Stinger)
- Kein Chat-Widget (User nutzt bestehendes Twitch-Chat-Widget)
