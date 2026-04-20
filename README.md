# obs-stream-kit

Komplettes OBS Stream-Overlay-Set als statische HTML/CSS/JS Browser-Sources.

Purple/Gold Entry-Style — für den Twitch-Kanal [LuCKoR_HD](https://twitch.tv/LuCKoR_HD).

---

## Schnellstart

1. Repo klonen
2. `assets/logo.png` mit deinem Logo ersetzen
3. In OBS: **Browser-Source** hinzufügen → **Lokale Datei** auswählen
4. Browser-Source-Größe wie unten angegeben einstellen
5. Alerts/Widgets: Streamer.bot konfigurieren für URL-Parameter + Source-Sichtbarkeit

---

## Szenen

Alle Szenen sind **1920×1080 Fullscreen-Overlays**. In OBS einfach als Browser-Source mit diesen Maßen anlegen.

| Datei | Beschreibung | OBS Browser-Source |
|-------|-------------|--------------------|
| `scenes/starting-soon.html` | Animierte Warteszene (looped) | 1920×1080 |
| `scenes/brb-pause.html` | Pause mit automatischem Twitch Clip-Player | 1920×1080 |
| `scenes/stream-ending.html` | Animierte Abschlussszene | 1920×1080 |
| `scenes/gameplay.html` | Gameplay Overlay (transparenter Hintergrund mit Sparkles) | 1920×1080 |
| `scenes/just-chatting.html` | Fullscreen-Kamera mit Chat-Bereich, Blitz-Arcs und Sparkles | 1920×1080 |

### Starting Soon

Animierter Titel mit Glow-Effekt. Fadet ein, hält, fadet aus — loopt automatisch.

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `hold` | `20` | Sekunden, die der Text sichtbar bleibt |

### BRB / Pause

Automatischer Twitch Clip-Player mit Countdown-Overlay und BRB-Animation.

> **Wichtig:** Benötigt einen lokalen Server (`python3 -m http.server 8080`) — funktioniert NICHT als lokale Datei. Siehe [docs/brb-setup.md](docs/brb-setup.md) für die vollständige Anleitung.

| Parameter | Pflicht | Default | Beschreibung |
|-----------|---------|---------|--------------|
| `channel` | nein | `LuCKoR_HD` | Twitch-Kanalname |
| `client_id` | ja* | — | Twitch App Client-ID |
| `client_secret` | ja* | — | Twitch App Client-Secret |
| `clips` | ja* | — | Manuelle Clip-Slugs (kommagetrennt) |
| `count` | nein | `100` | Anzahl Clips (max 100) |
| `countdown` | nein | `5` | Countdown-Sekunden zwischen Clips |

\* Entweder `client_id` + `client_secret` (automatisch via Twitch API) ODER `clips` (manuell).

**Features:**
- Clips werden automatisch von der Twitch API geladen und zufällig abgespielt
- Meta-Bar unter dem Video zeigt Clip-Titel, Datum und Views
- Countdown-Overlay mit Boom-Drop-Effekt (3/2/1) zwischen Clips
- BRB-Text mit Wave-Pulse-Animation + BE/RIGHT/BACK Stamp-Wechsel

### Szenen-Setup in OBS

- Jede Szene als eigene OBS-Szene anlegen
- Browser-Source: `Breite: 1920`, `Höhe: 1080`
- Hintergrund ist transparent — Szenen liegen über Game-Capture oder Kamera
- BRB-Szene: **Audio über OBS steuern** aktivieren für Clip-Sound

---

## Widgets

Widgets sind kleinere Elemente, die unabhängig positioniert werden können. Die Browser-Source muss **größer als der sichtbare Inhalt** sein, damit Effekte (Glow, Sparkles) nicht abgeschnitten werden.

### Logo

| | |
|-|-|
| **Datei** | `widgets/logo.html` |
| **Beschreibung** | Animiertes Logo mit Streifen-Animation (Aufbau → Abbau → Knight Rider → Loop) |
| **Interner Canvas** | 400×152 |
| **OBS Browser-Source** | Frei wählbar — OBS skaliert automatisch |

> **Skalierung:** Der interne Canvas ist 400×152px. Die **OBS Browser-Source-Größe** bestimmt, wie groß das Logo auf dem Stream erscheint. OBS skaliert den Inhalt proportional runter. Für ein kleines Sender-Logo in der Ecke z.B. **200×76** oder **150×57** einstellen. Für ein großes Logo **400×152** oder mehr.

| Gewünschte Logo-Höhe | OBS Browser-Source |
|-----------------------|--------------------|
| ~60px | **158×60** |
| ~76px | **200×76** |
| ~100px | **263×100** |
| ~152px (Original) | **400×152** |

**URL-Parameter:**

| Parameter | Default | Beschreibung |
|-----------|---------|-------------|
| `width` | `400` | Interner Canvas-Breite in px (ändert Rendering-Auflösung, nicht OBS-Größe) |
| `pause` | `10` | Pause zwischen Loops in Sekunden |
| `speed` | `200` | Millisekunden pro Streifen-Step |
| `lines` | `logo_lines_blue_t.png` | Streifen-Bild in `assets/` — austauschbar für andere Logos |
| `text` | `logo_text_luckor_hd.png` | Text-Bild in `assets/` — austauschbar für andere Logos |
| `glow` | *(lila↔gold)* | Glow-Farbe: `purple`, `gold`, oder Hex-Code (`#ff0000`) |

**Beispiele:**
- `widgets/logo.html?pause=15` → Standard-Logo, 15s Pause
- `widgets/logo.html?glow=purple` → nur lila Glow
- `widgets/logo.html?glow=#00ccff&lines=sponsor_lines.png&text=sponsor_text.png` → anderes Logo mit eigenem Glow

### Webcam-Rahmen

| | |
|-|-|
| **Datei** | `widgets/webcam-frame.html` |
| **Beschreibung** | Standalone Cam-Rahmen mit Blitz-Arcs und Sparkles auf transparentem Hintergrund |
| **Standard-Cam** | 400×225 |

**OBS Browser-Source Größe berechnen:**
Die Browser-Source muss ca. **100px breiter** und **100px höher** als die Cam-Größe sein, damit die Blitz-Arcs und Sparkles Platz haben.

| Cam-Größe (Parameter) | OBS Browser-Source |
|------------------------|--------------------|
| 400×225 (Default) | **500×325** |
| 425×240 | **525×340** |
| 500×280 | **600×380** |
| 640×360 | **740×460** |

**URL-Parameter:**

| Parameter | Default | Beschreibung |
|-----------|---------|-------------|
| `width` | `400` | Breite des Cam-Bereichs in px |
| `height` | `225` | Höhe des Cam-Bereichs in px |

**OBS-Setup:**
1. Webcam-Source in OBS anlegen (z.B. 400×225) und positionieren
2. Browser-Source mit `webcam-frame.html` **darüber** legen (Größe = Cam + 100×100)
3. Rahmen-Source so ausrichten, dass das Cam-Cutout (50px Innenabstand) exakt über der Cam liegt

**Beispiel:** `widgets/webcam-frame.html?width=500&height=280` → Browser-Source auf **600×380** setzen

### Welcome-Widget

| | |
|-|-|
| **Datei** | `widgets/welcome.html` |
| **Beschreibung** | Fullscreen-Alert für Erstbesucher im Chat — Name-Box mittig, Sparkles über den gesamten Canvas, Pop-Burst beim Einblenden |
| **Interner Canvas** | 1920×1080 |
| **OBS Browser-Source** | 1920×1080 (Fullscreen) |

**URL-Parameter:**

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `name` | `NewViewer42` | Angezeigter Username |

**OBS-Setup:**
1. Browser-Source hinzufügen → Größe **1920×1080** (Fullscreen-Overlay)
2. Source auf **unsichtbar** stellen (Auge-Icon aus)
3. **Show Transition** einstellen: Rechtsklick → Show Transition → *Slide* oder *Fade*
4. Per Streamer.bot bei First-Chat-Event die URL setzen (`?name=%user%`) und die Source einblenden
5. Nach X Sekunden Source wieder ausblenden (OBS übernimmt die Animation)

**Beispiel:** `widgets/welcome.html?name=NeuerChatter`

### Info-Widgets

Kompakte Browser-Sources, die frei in OBS positioniert werden können. Die Widgets zeigen sich sofort an — **Ein-/Ausblenden über OBS-Source-Transitions** (Slide, Fade, etc.) steuern.

| Datei | Beschreibung | Farbe | Interner Canvas | OBS Browser-Source |
|-------|-------------|-------|-----------------|---------------------|
| `widgets/latest-follower.html` | Name-Box | Gold | 500×100 | **500×100** |
| `widgets/latest-sub.html` | Name-Box | Lila | 500×100 | **500×100** |
| `widgets/latest-tip.html` | Name + Betrag | Gold | 500×100 | **500×100** |
| `widgets/subgoal.html` | Fortschrittsbalken | Lila | 500×120 | **500×120** |

> **Dimensionen:** Die Widget-Box ist ~450×70px (Subgoal ~450×90px). Der Canvas ist etwas größer (500×100/120), damit Glow-Effekte und Sparkles nicht abgeschnitten werden. Du kannst die OBS-Source auch kleiner machen, um die Widgets zu verkleinern — OBS skaliert proportional.

**OBS-Setup:**
1. Browser-Source hinzufügen → Größe wie oben einstellen
2. Source frei auf dem Canvas positionieren (z.B. linker Rand, untere Ecke, etc.)
3. **Show Transition** auf der Source einstellen: Rechtsklick → Show Transition → z.B. *Slide* oder *Fade*
4. Source per Streamer.bot ein-/ausblenden — OBS übernimmt die Animation

**URL-Parameter:**

| Widget | Parameter | Default | Beschreibung |
|--------|-----------|---------|-------------|
| latest-follower | `name` | `GamerDude42` | Angezeigter Name |
| latest-sub | `name` | `SubHero99` | Angezeigter Name |
| latest-tip | `name` | `GenPlayer` | Angezeigter Name |
| latest-tip | `amount` | `5,00 €` | Betrag |
| subgoal | `current` | `23` | Aktuelle Subs |
| subgoal | `goal` | `50` | Ziel-Subs |

---

## Alerts

Alerts sind **1920×1080 Fullscreen-Overlays** mit einmaliger Animation.

| Datei | Typ | OBS Browser-Source | Parameter |
|-------|-----|--------------------|-----------|
| `alerts/follow.html` | Center-Stage (Gold) | 1920×1080 | `?username=X&message=Y` |
| `alerts/sub.html` | Center-Stage (Purple) | 1920×1080 | `?username=X&message=Y` |
| `alerts/resub.html` | Center-Stage (Purple) | 1920×1080 | `?username=X&months=N&message=Y` |
| `alerts/bits.html` | Center-Stage (Gold) | 1920×1080 | `?username=X&amount=N&message=Y` |
| `alerts/giftsub.html` | Fullscreen-Flash (Purple, skaliert nach Menge) | 1920×1080 | `?username=X&amount=N&tier=1\|2\|3\|prime` |
| `alerts/raid.html` | Fullscreen-Flash (Gold) | 1920×1080 | `?username=X&viewers=N` |

> **GiftSub-Skalierung:** je nach `amount` wird der Alert unterschiedlich gross:
> - **1–4 Gifts** → Standard-Alert (weisser Text, 25 Partikel)
> - **5–14 Gifts** → groesserer Text ("5× Gift Subs"), 45 Partikel
> - **15+ Gifts** → **SUB BOMB!** — XL-Text, Gold-Akzent, 70 Partikel, breiter Divider

### Alerts mit Streamer.bot einrichten

Die Alert-Dateien sind statisches HTML — sie brauchen **Streamer.bot** als Brücke zwischen Twitch-Events und OBS.

**So funktioniert der Ablauf:**

```
Twitch Event (Follow, Sub, Bits, ...)
  → Streamer.bot empfängt das Event mit Daten (Username, Betrag, etc.)
  → Streamer.bot setzt die URL der OBS Browser-Source mit den richtigen Parametern
  → Streamer.bot blendet die Source ein
  → Alert-Animation spielt ab
  → Streamer.bot blendet die Source nach X Sekunden wieder aus
```

**Schritt für Schritt:**

1. **OBS vorbereiten:**
   - Eine Browser-Source `Alert` anlegen (1920×1080)
   - Lokale Datei erstmal auf irgendeinen Alert setzen (z.B. `alerts/follow.html`)
   - Source auf **unsichtbar** stellen (Auge-Icon aus)

2. **Streamer.bot → OBS verbinden:**
   - In Streamer.bot unter *Stream Apps* → *OBS* die WebSocket-Verbindung einrichten

3. **Action pro Alert-Typ erstellen:**
   Für jeden Alert (Follow, Sub, Bits, etc.) eine Streamer.bot Action anlegen mit diesen Sub-Actions:

   | # | Sub-Action | Was sie tut |
   |---|-----------|-------------|
   | 1 | **OBS Set Browser Source URL** | URL auf den Alert setzen, z.B.: `file:///pfad/zum/repo/alerts/follow.html?username=%user%` |
   | 2 | **OBS Set Source Visibility** | Source `Alert` → **Sichtbar** |
   | 3 | **Delay** | 4–6 Sekunden warten (je nach Alert-Dauer) |
   | 4 | **OBS Set Source Visibility** | Source `Alert` → **Unsichtbar** |

   > `%user%`, `%amount%`, `%message%` etc. sind Streamer.bot Variablen die automatisch aus dem Twitch-Event befüllt werden.

4. **Trigger zuweisen:**
   - Action mit dem passenden Twitch-Event verknüpfen (z.B. *Twitch → Follow* triggert die Follow-Action)

**Beispiel-URLs die Streamer.bot setzt:**

```
alerts/follow.html?username=CoolViewer42
alerts/sub.html?username=SubHero99&message=Hype!
alerts/resub.html?username=OldFan&months=12&message=Ein%20Jahr!
alerts/bits.html?username=CheerKing&amount=500&message=Take%20my%20bits
alerts/giftsub.html?username=GiftGod&amount=5&tier=2
alerts/raid.html?username=BigStreamer&viewers=150
```

> **Tipp:** Du kannst auch eine eigene Browser-Source pro Alert-Typ anlegen statt eine einzige zu recyclen. Vorteil: mehrere Alerts können gleichzeitig angezeigt werden.

---

## Stingers / Meme-Overlays

Fullscreen-Overlays zum manuellen Auslösen (z.B. per Streamer.bot Hotkey oder Chat-Command). Spielen einmal ab, blenden sich selbst aus.

| Datei | Trigger-Idee | Dauer | OBS Browser-Source |
|-------|--------------|-------|--------------------|
| `stingers/trap.html` | Hotkey bei Bait-Situation | ~3s | 1920×1080 |
| `stingers/crash.html` | Ingame-Unfall / Tod | ~2s | 1920×1080 |
| `stingers/nani.html` | Überraschender Move | ~3s | 1920×1080 |
| `stingers/gg.html` | End-of-Match / Sieg | ~3.3s | 1920×1080 |
| `stingers/noice.html` | Gelungener Play | ~2s | 1920×1080 |
| `stingers/luke.html` | Hund im Bild / Shoutout | ~3.5s | 1920×1080 |
| `stingers/smort.html` | B99-Deadpan-Approval (Holt-Style) | ~2s | 1920×1080 |
| `stingers/cool.html` | B99 nervöse Zustimmung (Jake-Style) | ~3s | 1920×1080 |
| `stingers/over-9000.html` | DBZ-Reaktion (Vegeta-Scouter, mit MP3) | ~3.5s | 1920×1080 |
| `stingers/kamehameha.html` | DBZ-Energy-Blast (Kame-Hame-HA) | ~4s | 1920×1080 |
| `stingers/super-saiyan.html` | DBZ-Transformation (Goku-Aura-Schrei) | ~3.5s | 1920×1080 |
| `stingers/indeed.html` | Stargate-Deadpan (Teal'c-Twin zu Noice/Smort) | ~3.3s | 1920×1080 |
| `stingers/chevron-locked.html` | Stargate-Aktivierung (Gate-Ring + Kawoosh) | ~4.4s | 1920×1080 |
| `stingers/crying-out-loud.html` | Stargate-Frustration (O'Neill-Catchphrase) | ~3.1s | 1920×1080 |
| `stingers/khan.html` | Star-Trek-Drama (Kirk-Scream, mit MP3) | ~4.1s | 1920×1080 |
| `stingers/make-it-so.html` | Star-Trek-Befehl (Picard + LCARS) | ~3.2s | 1920×1080 |
| `stingers/engage.html` | Star-Trek-Warp-Hype (Picard) | ~3.1s | 1920×1080 |
| `stingers/resistance-futile.html` | Star-Trek-Borg (CRT-Terminal-Look) | ~3.8s | 1920×1080 |
| `stingers/heart.html` | Geheimer Herzschlag (Sparkle-Heart) | ~5.4s | 1920×1080 |

> **Audio:** Stinger mit eigener MP3 binden die Datei via `<audio autoplay>` ein — OBS Browser-Sources spielen das automatisch ab (stelle sicher dass **Audio über OBS steuern** aktiviert ist). Weitere Sounds: Datei in `assets/stingers/` ablegen und im Stinger-HTML per `<audio autoplay src="...">` referenzieren.

### Setup in Streamer.bot

1. Pro Stinger eine Browser-Source in OBS anlegen (1920×1080), **unsichtbar**
2. Streamer.bot Action pro Stinger:
   - **OBS Set Source Visibility** → Source sichtbar
   - **Delay** → Dauer des Stingers (siehe Tabelle)
   - **OBS Set Source Visibility** → Source unsichtbar
3. Action per **Hotkey** oder **Chat-Command** (`!trap`, `!crash`, etc.) triggern

> **Tipp:** Für Sound-Effekte lege entsprechende Audio-Files in `assets/stingers/` (z.B. `trap.mp3`) und spiele sie per Streamer.bot parallel zum Stinger ab. Die HTML-Dateien enthalten bewusst keine Audio-Tags — so kannst du Sound frei tauschen.

---

## Transition

| Datei | Beschreibung | OBS-Setup |
|-------|-------------|-----------|
| `transitions/stinger.html` | Partikel/Geometrie (1s) | Browser Transition Plugin, Duration: 1000ms, Transition Point: 350ms |

---

## Übersicht Browser-Source-Größen

| Typ | Größe | Grund |
|-----|-------|-------|
| Szenen | **1920×1080** | Fullscreen |
| Alerts | **1920×1080** | Fullscreen |
| Info-Widgets | **500×100** (Subgoal: 500×120) | Kompakt, frei positionierbar, OBS-Transition |
| Welcome-Widget | **1920×1080** | Fullscreen, Name-Box mittig + Sparkles überall |
| Logo | **400×152** (oder kleiner, z.B. 158×60) | OBS skaliert proportional |
| Webcam-Rahmen | **Cam + 100×100** | Platz für Blitz-Arcs und Sparkles |

---

## Design

- **Farben:** Purple `#5e2a79` / Gold `#f2b705`
- **Font:** DM Sans (`assets/DM-Sans.woff2`)
- **Dark Theme:** `#0d0d1a` / `#1a0d2e`
- Animationen: CSS `@keyframes` + Web Animations API + `requestAnimationFrame`
- Keine externen Abhängigkeiten — alles Vanilla HTML/CSS/JS
- Meiste Szenen `file://`-kompatibel — BRB-Szene benötigt lokalen Server (Twitch Embed)
