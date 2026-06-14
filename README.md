# obs-stream-kit

Komplettes OBS Stream-Overlay-Set als statische HTML/CSS/JS Browser-Sources.

Purple/Gold Entry-Style — generisch nutzbar für jeden Twitch-Streamer mit
PUBG-Stats-Backend. Trage deine Daten in `.secrets` und `config/pubg.json`
ein, und das Repo läuft sofort für deinen Account.

---

## Schnellstart

1. Repo klonen
2. **Twitch + PUBG konfigurieren:**
   - `.secrets.example` → `.secrets` kopieren, ausfüllen
     (Twitch Client-ID/Secret, Twitch-Channel, PUBG-API-Key)
   - `config/pubg.example.json` → `config/pubg.json` kopieren, eigenen
     PUBG-Nickname + Plattform eintragen
3. PUBG-DB initialisieren + Cold-Start:
   ```bash
   python serve.py --init-pubg-db
   python serve.py --pubg-cold-start
   ```
4. Server starten: `python serve.py`
5. `assets/logo.png` mit deinem Logo ersetzen
6. In OBS: **Browser-Source** hinzufügen → URL `http://localhost:8080/widgets/...`
7. Browser-Source-Größe wie unten angegeben einstellen
8. Alerts/Widgets: Streamer.bot konfigurieren für URL-Parameter + Source-Sichtbarkeit

---

## Szenen

Alle Szenen sind **1920×1080 Fullscreen-Overlays**. In OBS einfach als Browser-Source mit diesen Maßen anlegen.

| Datei | Beschreibung | OBS Browser-Source |
|-------|-------------|--------------------|
| `overlays/starting-soon.html` | Animierte Warteszene (looped) | 1920×1080 |
| `overlays/brb-pause.html` | Pause mit automatischem Twitch Clip-Player | 1920×1080 |
| `overlays/stream-ending.html` | Animierte Abschlussszene | 1920×1080 |
| `overlays/gameplay.html` | Gameplay Overlay (transparenter Hintergrund mit Sparkles) | 1920×1080 |
| `overlays/just-chatting.html` | Fullscreen-Kamera mit Chat-Bereich, Blitz-Arcs und Sparkles | 1920×1080 |

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
| `clips` | nein | — | Manuelle Clip-Slugs (kommagetrennt); überschreibt den Server-Abruf |
| `count` | nein | `100` | Anzahl Clips (max 100) |
| `countdown` | nein | `5` | Countdown-Sekunden zwischen Clips |

Im Server-Betrieb werden die Clips server-seitig über `/s/<token>/api/twitch/clips` geladen — der Twitch-Channel und die App-Credentials des Tenants bleiben am Server, das Client-Secret landet **nie** im Browser. Der `clips`-Parameter erlaubt weiterhin einen manuellen Modus ohne Server-Abruf.

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
| subgoal | `title` | `Sub Goal` | Angezeigter Titel (z.B. „Next Stream-Goal") |
| subgoal | `current` | `23` | Aktuelle Subs |
| subgoal | `goal` | `50` | Ziel-Subs |
| tipgoal | `title` | `Tip Goal` | Angezeigter Titel (z.B. „Neuer Gaming-Stuhl") |
| tipgoal | `current` | `0` | Aktueller Betrag (Komma oder Punkt als Dezimaltrenner) |
| tipgoal | `goal` | `100` | Ziel-Betrag |
| tipgoal | `currency` | `€` | Währungssymbol |
| tipgoal-banner | `title` / `current` / `goal` / `currency` | wie oben | Wie tipgoal, aber 600×180 (inner 480×80 + 60px Glow-Rand) mit Shine-Animation |

---

## Alerts

Alerts sind **1920×1080 Fullscreen-Overlays** mit einmaliger Animation.

| Datei | Typ | OBS Browser-Source | Parameter |
|-------|-----|--------------------|-----------|
| `alerts/follow.html` | Center-Stage (Gold) | 1920×1080 | `?username=X&message=Y` |
| `alerts/sub.html` | Center-Stage (Purple) | 1920×1080 | `?username=X&message=Y` |
| `alerts/resub.html` | Center-Stage (Purple) | 1920×1080 | `?username=X&months=N&message=Y` |
| `alerts/bits.html` | Center-Stage (Gold) | 1920×1080 | `?username=X&amount=N&message=Y` |
| `alerts/giftsub.html` | Fullscreen-Flash (Purple, skaliert nach Menge) | 1920×1080 | `?username=X&amount=N&tier=1\|2\|3\|prime&total=N` |
| `alerts/raid.html` | Fullscreen-Flash (Gold) | 1920×1080 | `?username=X&viewers=N` |

> **GiftSub-Skalierung:** je nach `amount` wird der Alert unterschiedlich gross:
> - **1–4 Gifts** → Standard-Alert (weisser Text, 25 Partikel)
> - **5–14 Gifts** → groesserer Text ("Multi Gift!"), 45 Partikel
> - **15+ Gifts** → **SUB BOMB!** — XL-Text, Gold-Akzent, 70 Partikel, breiter Divider
>
> **`total`**: optionaler Parameter für kumulative Gesamt-Gifts des Users. Wenn gesetzt (> 0), wird unten „Insgesamt X Subs verschenkt" angezeigt. In Streamer.bot ggf. als `%totalSubsGifted%` oder ähnliche Variable verfügbar.

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
alerts/giftsub.html?username=GiftGod&amount=5&tier=2&total=42
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
| `stingers/over-9000.html` | DBZ-Reaktion (Vegeta-Scouter, mit MP3) — `?level=X` setzt POWER LVL | ~3.5s | 1920×1080 |
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
| `stingers/kickers-remake.html` | Kickers-Intro CSS-Nachbau (Fußballfeld + Ball-Swarm + 2× HURRA + Titel „Die tollen Superzocker") — `?tune=1` fürs Tune-Panel | ~7.7s | 1920×1080 |

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

---

## PUBG Session Stats

Modulares PUBG-Stats-Set mit lokaler SQLite-Persistenz und Live-Polling der offiziellen
PUBG-Developer-API. Always-on-Backend (`serve.py` + `pubg/`-Modul) liefert JSON-Endpoints,
HTML-Widgets als Browser-Sources rendern.

### Setup

1. **API-Key** unter [developer.pubg.com](https://developer.pubg.com) holen (kostenlos, 10 RPM Default).
2. **`.secrets`** erweitern:
   ```
   PUBG-API-Key:  <dein-key>
   ```
3. **`config/pubg.json`** aus dem Template anlegen:
   ```bash
   cp config/pubg.example.json config/pubg.json
   ```
   Dann `playerName` (dein PUBG-Nickname) + `platform` (steam / kakao /
   xbox / psn) eintragen. Das File ist gitignored — bleibt lokal.
4. **DB initialisieren + Cold-Start** (zieht die letzten 30 Matches):
   ```bash
   python serve.py --init-pubg-db
   python serve.py --pubg-cold-start
   ```
5. **`serve.py` als Always-on-Service**: siehe `docs/pubg-systemd.service.example`.
6. **Browser-Sources** in OBS einfügen (Tabelle unten).

### Browser-Source-Komponenten

Alle URLs unter `http://localhost:8080/widgets/pubg/<datei>.html`.

| Datei | Zweck | URL-Parameter |
|---|---|---|
| `live-bar.html` | Slim-Counter Gameplay | `refreshMs` |
| `flyout-full.html` | Großes Detail-Panel mit Filter-Slider und Reset-Button | — |
| `mates.html` | Squad-Mates der Range | `layout=carousel\|stack\|fold\|mosaic`, `range=session\|week` |
| `top-mates.html` | Top-5-Liste | `sortBy=avgPlace\|kd\|winRate\|mostPlayed`, `limit`, `minMatches` |
| `post-match-card.html` | 10s-Pop-up nach Match-Ende | `durationMs` |
| `map-distribution.html` | Map-Häufigkeits-Bars | `range=session\|day\|week\|all` |
| `first-fight.html` | Survival-% mit Sparkline | `range` |
| `session-summary.html` | Vollformat Stream-Ending | `hideMaps=1`, `hideMates=1` |
| `career-card.html` | Lifetime-Anzeige | `player`, `mode=all\|squad-fpp\|...` |
| `news-ticker.html` | Marquee-Bar mit rotierenden Snippets | `rotateMs` |
| `squad-compare.html` | 4er-Vergleichs-Tabelle | `players=A,B,C,D`, `matches` |
| `chat-stats-popup.html` | Streamer.bot-driven Pop-up | `player`, `duration` (Sek) |

Cross-Player-Web-View: `http://localhost:8080/widgets/pubg/coplayer.html?player=NAME`
(alte URL `overlays/stats.html?player=NAME` leitet weiter)

### Browser-Tools

Werden im normalen Browser-Tab geöffnet — **nicht** als OBS-Source. Schreib-/Lese-Zugriff
auf das Backend; kein Streaming nötig.

| Datei | Zweck | Größe |
|---|---|---|
| `tools/match-replay.html` | Animierter Replay eines PUBG-Matches auf der Karte | Browser-Tab |
| `tools/landing-spots.html` | Heatmap + Scatter der Landeorte pro Karte und Spieler-Konstellation | Browser-Tab / 1920×1080 |

#### tools/match-replay.html

Zeigt einen aufgezeichneten PUBG-Match als animierten Replay aller Teams auf der
Karte. Lädt Raw-Telemetrie on-demand von HiDrive (gecached im Server-Memory).

**Features:**
- Spieler-Pins mit Teamnummer + Teamfarbe; Kill/Knock-Marker (×); Bullet-Streaks (200 ms)
- Sidebar: Match-Dropdown + Teamliste — Klick auf ein Team fokussiert es, die anderen werden grau
- Toggles: Kills / Knocks / Streaks / Namen ein-/ausblenden
- Wiedergabe: Play/Pause, Timeline-Scrubber, Speed 0,5×–8×
- Zoom (Scrollwheel), Pan (Drag), Hover-Tooltips auf Pins und Markern

| Parameter | Beschreibung |
|-----------|-------------|
| `match` | PUBG-Match-ID — öffnet direkt das angegebene Match |

**Endpoints:**
- `GET /api/pubg/last-match` — Match-Liste für das Dropdown
- Telemetrie-Blob wird on-demand über HiDrive geladen (`.secrets`: `HiDrive-*`)

#### tools/landing-spots.html

Zeigt pro Karte, wo Spieler landen — kombinierte Heatmap (alle Daten) und
per-Spieler-Scatter-Overlay. Auch als 1920×1080-Vollbild-Tab nutzbar.

**Features:**
- Karten-Selektor im Header wechselt die angezeigte Map
- 4 Spieler-Eingabefelder mit Autocomplete — leer = beliebig; alle ausgefüllten
  Felder müssen im selben Squad gewesen sein (Konstellations-Filter)
- Optionaler Flugrouten-Filter: nur Matches mit ≤ 1,5 km Querdistanz zur Cruise-Route
- POI-Liste rechts mit per-Spieler-Aufschlüsselung (z.B. `Pochinki — LuCKoR 8×, Mate1 3×`)
- Player-Chips schalten Scatter-Punkte pro Spieler ein/aus

| Parameter | Beschreibung |
|-----------|-------------|
| *(keine URL-Parameter — alles über UI steuerbar)* | |

**Endpoints:**
- `GET /api/pubg/landing-heatmap` — Heatmap-Daten gefiltert nach Karte + Spieler-Konstellation
- `GET /api/pubg/player-search` — Autocomplete für Spielernamen

### Streamer.bot-Setup für `!mypubgstats`

```
Trigger: Twitch Chat Command "!mypubgstats"
Action 1: $pubgName = User-Argument oder gespeichertes Mapping
Action 2: OBS Browser-Source URL setzen:
          http://localhost:8080/widgets/pubg/chat-stats-popup.html?player={pubgName}
Action 3: Source einblenden
Action 4: 12 Sekunden warten
Action 5: Source ausblenden
```

### Status-Monitoring

```
GET http://localhost:8080/api/pubg/status
```
Liefert `{polling, lastPollAt, errors, newMatches, lifetimeRefreshed,
telemetryProcessed, rateLimitRemaining}`. Brauchbar für ein internes Dashboard
oder zum Debuggen.

### Live-Detection für Szenen-Automation

```
GET http://localhost:8080/api/pubg/active
```

Zwei **unabhängige** Signale, gedacht für sekündliches Streamer.bot-Polling
(z.B. automatischer Szenen-Wechsel):

- **`active`** — läuft PUBG laut Steam? (`gameid == 578080`)
  `true` / `false` / `null` (wenn Steam nicht abfragbar ist). Unabhängig vom
  letzten Match.
- **`matchRecent`** — ist das letzte Match jünger als `thresholdMin` (Default
  30)? Wird **immer** aus der DB berechnet, auch wenn PUBG geschlossen ist.

Weitere Felder: `pubgOpen` (Alias für `active`, rückwärtskompatibel),
`lastMatchAt`, `lastMatchAgeMin`, `thresholdMin`, `steamChecked`.

| Parameter | Beschreibung |
|-----------|-------------|
| `thresholdMin` | Schwelle für `matchRecent` in Minuten (Default 30) |
| `thresholdSec` | Schwelle in Sekunden (überschreibt `thresholdMin`) |
| `noSteam=1` | Steam-Abfrage überspringen → `active: null` |
| `fakePubgOpen=0\|1` | Steam-Status für Tests/Debug erzwingen |

### Rate-Limit

Default 10 RPM reicht für 1-2 Matches/Min steady-state. Bei häufigen
`!mypubgstats`-Triggern oder vielen Stamm-Mates: Higher-Tier-Key unter
[developer.pubg.com](https://developer.pubg.com) beantragen (bis 60+ RPM).

## Steam-Integration

Live-Now-Playing-Card, Achievement-Popup mit Rare-Highlight, Library-
Ticker (alle / Co-op / Multiplayer) und Achievement-Feed. Optional —
nur aktiv wenn `Steam API Key:` + `Steam-ID:` in `.secrets` stehen.

### Setup

1. Steam-Key holen: <https://steamcommunity.com/dev/apikey>.
2. SteamID64 ermitteln: <https://steamid.io/>.
3. Beides in `.secrets`:
   ```
   Steam API Key: ABCDEF...
   Steam-ID:      76561198XXXXXXXXX
   ```
4. Server neu starten — Poller läuft im Hintergrund.

### Polling-Layer

| Layer | Intervall | Zweck |
|---|---|---|
| 1 | 10 s | `GetPlayerSummaries` — was läuft grad |
| 1 | 1×/h | `GetOwnedGames` — Library + Playtime |
| 2 | 5 s | `GetPlayerAchievements` (nur wenn Spiel läuft) — neue Unlocks erkennen |
| 2 | 1×/d | `GetGlobalAchievementPercentagesForApp` — Rare-Threshold |
| 3 | 12 s | Storefront `appdetails` (1 App/Tick) — Co-op/Multiplayer-Flag + Header-Image |

Bilder werden lokal in `data/steam-cache/images/` gecached — bleibt
auch nach Storefront-Delisting verfügbar (z.B. UT2004).

### Browser-Sources

Alle URLs unter `http://localhost:9000/widgets/steam/<datei>.html`.

| Datei | Zweck | URL-Parameter |
|---|---|---|
| `now-playing.html` | Bottom-Left-Card mit Avatar + Spiel + Live-Counter | `pollMs`, `livePlayers=0\|1`, `playersPollMs` |
| `popup.html` | Combined slide-in (Now-Playing + Achievement) mit Rare-Glow | `nowPollMs`, `achPollMs`, `durationMs`, `gapMs`, `rarePct` |
| `achievement-popup.html` | Pop-up nur für Achievements, separat von Now-Playing | `duration`, `gap`, `pollMs`, `rarePct` |
| `achievement-feed.html` | Rotierender Feed der letzten N Unlocks | `limit`, `rotateMs`, `refreshMs`, `rarePct`, `header` |
| `games-ticker.html` | Library/Co-op/Multiplayer-Rotator inkl. "Wanna play?"-Modus | `kind=all\|coop\|multiplayer`, `sort=playtime\|recent\|random\|name`, `playedSinceDays`, `rotateMs`, `cyclePauseMs`, `minPlaytime`, `limit`, `headerTitle` |

Demo + Größenempfehlungen: `http://localhost:9000/widgets/steam/index.html`

### API-Endpoints

| Route | Liefert |
|---|---|
| `/api/steam/now-playing` | Aktive Session inkl. Achievement-Progress |
| `/api/steam/current-players` | Live-Spielerzahl für aktuelle App |
| `/api/steam/recent-unlocks` | Noch nicht angezeigte Unlocks (`?markDisplayed=1` markiert) |
| `/api/steam/achievement-feed` | Letzte N Unlocks (auch alte, für Feed-Ticker) |
| `/api/steam/owned-games` | Library, gefiltert + sortiert |
| `/api/steam/recently-played` | Letzte ~10 Spiele |
| `/api/steam/status` | Poller-Health |

### Rare-Unlock-Effekt

Pro Achievement wird der globale Unlock-Prozentsatz (1×/Tag) gepullt.
Unlocks ≤ `rarePct%` (Default 5 %) bekommen im Popup einen pulsenden
Gold-Glow + geänderten Ribbon-Text ("Rare Achievement Unlocked"). Im
Feed wird ein **Rare**-Badge angezeigt.

---

## Deployment (Prod-Server)

Der Dienst läuft auf `stats-overlay.info` und wird als zwei getrennte systemd-Services
betrieben. Beide laufen unter dem Service-User `obskit`, lesen ihre Credentials aus
`/etc/obs-stream-kit.env` und liegen unter `/opt/obs-stream-kit`.

### Service 1 — stats-overlay.info (API + Dashboard + Widgets/Tools)

| | |
|-|-|
| **Einstiegspunkt** | `serve.py` |
| **Port** | `:9000` |
| **systemd-Unit** | `obs-stream-kit.service` |
| **Domain** | `stats-overlay.info` |

Stellt die PUBG-/Steam-API-Endpoints, das Haupt-Dashboard, alle Widgets und die
Browser-Tools bereit. **Login läuft ausschließlich über diese Domain.** Das
Session-Cookie gilt cross-subdomain, da in `/etc/obs-stream-kit.env` gesetzt ist:

```
OBS_KIT_COOKIE_DOMAIN=.stats-overlay.info
```

### Service 2 — overlays.stats-overlay.info (Overlay-Service)

| | |
|-|-|
| **Einstiegspunkt** | `serve_overlays.py` |
| **Port** | `:9001` |
| **systemd-Unit** | `obs-overlays.service` |
| **Domain** | `overlays.stats-overlay.info` |

Liefert die Produktions-Overlays (`starting-soon`, `brb-pause`, `stream-ending`,
`just-chatting`, `gameplay`) aus dem Verzeichnis `overlays/`. Die Dateien werden
token-scoped unter dem Pfad `overlays.stats-overlay.info/s/<token>/overlays/<datei>`
ausgeliefert; der Twitch-Channel des Tenants und die Twitch-Client-ID werden
server-seitig in jede Seite injiziert — kein Credential landet im Browser.

Der BRB-Clip-Player ruft server-seitig den Endpoint
`/s/<token>/api/twitch/clips` ab (kein Client-Secret im Browser-Quelltext).

Weil das Session-Cookie cross-subdomain gilt, ist kein separater Login auf der
Overlay-Domain nötig.

### DNS + TLS

1. A/AAAA-Record `overlays.stats-overlay.info` → IP des Servers anlegen.
2. TLS-Zertifikat um die neue Subdomain erweitern:
   ```bash
   certbot --expand -d stats-overlay.info -d overlays.stats-overlay.info
   ```
3. nginx-Proxy-Block aktivieren (Vorlage: `docs/overlays-nginx.conf.example`).

### systemd-Units aktivieren

```bash
# Service 2 (Overlay)
cp docs/overlays-systemd.service.example /etc/systemd/system/obs-overlays.service
systemctl daemon-reload
systemctl enable --now obs-overlays.service
systemctl status obs-overlays.service --no-pager -l

# Service 1 (Hauptservice, falls noch nicht aktiv)
# Vorlage: docs/pubg-systemd.service.example
```

Vorlagen-Dateien:
- `docs/overlays-systemd.service.example` — systemd-Unit für Service 2
- `docs/overlays-nginx.conf.example` — nginx Server-Block für `overlays.stats-overlay.info`
