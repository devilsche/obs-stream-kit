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
| `endHold` | nein | `1.5` | Sekunden, die der letzte Frame nach Clip-Ende stehen bleibt, bevor ausgeblendet wird |
| `sound` | nein | – | `0` = Clips immer stumm. Ohne den Parameter laufen sie mit Ton; scheitert das Audiogerät (Fehler oder Hänger), spielen sie stumm weiter |

Im Server-Betrieb werden die Clips server-seitig über `/s/<token>/api/twitch/clips` geladen — der Twitch-Channel und die App-Credentials des Tenants bleiben am Server, das Client-Secret landet **nie** im Browser. Der `clips`-Parameter schränkt den Abruf auf die genannten Slugs ein (`?slugs=…` am selben Endpoint); auch dieser Modus braucht den Server, weil nur er die abspielbaren Clip-URLs holen kann.

**Features:**
- Clips werden automatisch von der Twitch API geladen und zufällig abgespielt
- Wiedergabe als natives `<video>` (kein Twitch-iframe) — dadurch kein
  „Start Watching"-Interstitial bei Kanälen mit Content Classification Labels
- Weitergeschaltet wird am tatsächlichen Clip-Ende (`ended`), nicht per Timer —
  kein zu früher Countdown mehr, wenn ein Clip verzögert startet
- Läuft Autoplay mit Ton in einem normalen Browser-Tab nicht an, spielt der Clip
  stumm weiter statt zu warten; in OBS bleibt der Ton erhalten
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
| **Datei** | `alerts/welcome.html` |
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

**Beispiel:** `alerts/welcome.html?name=NeuerChatter`

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
| `stingers/heart.html` | Geheimer Herzschlag (Sparkle-Heart); `?name=%user%&to=%targetUser%&avatar=%targetUserProfileImageUrl%&msg=%rawInput%` (in Streamer.bot vorher „Get User Info for Target“): „<3 @Tim“ zeigt unten Tims Profilbild und Namen, „<3 Text“ den Text, darüber jeweils klein „from Absender“; „<3“ allein wie bisher den Absender | ~5.4s | 1920×1080 |
| `stingers/kickers-remake.html` | Kickers-Intro CSS-Nachbau (Fußballfeld + Ball-Swarm + 2× HURRA + Titel „Die tollen Superzocker") — `?tune=1` fürs Tune-Panel | ~7.7s | 1920×1080 |
| `stingers/sad.html` | `!sad` — Regenwolke mit traurigem Gesicht + Sad Trombone, Titel „sad.“ — `?left=30` linke Wolkenkante in px (Standard 30, 740 = Mitte) | ~4.6s | 1920×1080 |
| `stingers/you-died.html` | `!sad` Souls-Style: schwarzer Balken, roter Serifentext, Gong — `?text=HOPE%20DIED` eigener Text | ~4.7s | 1920×1080 |
| `stingers/motivation.html` | `!sad` Statusbalken fällt 100 → 64 → 21 → 3 %, Stempel „sad.“ — `?label=Skill` eigener Name | ~4.3s | 1920×1080 |

> **Audio:** Stinger mit eigener MP3 binden die Datei via `<audio autoplay>` ein — OBS Browser-Sources spielen das automatisch ab (stelle sicher dass **Audio über OBS steuern** aktiviert ist). Weitere Sounds: Datei in `assets/stingers/` ablegen und im Stinger-HTML per `<audio autoplay src="...">` referenzieren.

> **`?sound=0`:** Stinger ohne eigenen Ton, etwa wenn Streamer.bot den Sound abspielt. Videos (Trap, Kickers) laufen dann stumm und sofort. Ohne Parameter gilt: Hängt die Audio-Ausgabe von OBS, lädt ein Video-Stinger nach spätestens 1,2 s stumm neu und blendet ein.

> **Synthetischer Sound:** `sad`, `you-died` und `motivation` erzeugen ihren Ton per Web Audio im Browser (keine MP3, `js/stinger-kit.js`). `?volume=0.8` (0–1) regelt die Lautstärke, `?sound=0` schaltet stumm, `?tune=1` öffnet das Timing-Panel. Im normalen Browser startet der Ton erst nach einem Klick, OBS spielt ihn direkt. Derselbe Ton liegt fertig als `assets/stingers/sad.wav`, `you-died.wav` und `motivation.wav` — für Streamer.bot: Stinger mit `?sound=0` (Dashboard: Sound → Off) einbinden und in der Action **Play Sound** mit der WAV direkt neben dem Einblenden der Source starten. Die WAVs beginnen beim Stinger-Start, laufen also synchron.

> **Tipp für `!sad`:** Eine Browser-Source sieht das Spiel dahinter nicht und kann es daher nicht entsättigen. Dafür auf der Game-Capture-Source einen Filter **Farbkorrektur** mit Sättigung −1 anlegen (deaktiviert) und in der Streamer.bot-Action per **OBS Set Source Filter State** für die Dauer des Stingers ein- und wieder ausschalten.

### Setup in Streamer.bot

1. Pro Stinger eine Browser-Source in OBS anlegen (1920×1080), **unsichtbar**
2. Streamer.bot Action pro Stinger:
   - **OBS Set Source Visibility** → Source sichtbar
   - **Delay** → Dauer des Stingers (siehe Tabelle)
   - **OBS Set Source Visibility** → Source unsichtbar
3. Action per **Hotkey** oder **Chat-Command** (`!trap`, `!crash`, etc.) triggern

> **Tipp:** Für Sound-Effekte lege entsprechende Audio-Files in `assets/stingers/` (z.B. `trap.mp3`) und spiele sie per Streamer.bot parallel zum Stinger ab. Die HTML-Dateien enthalten bewusst keine Audio-Tags — so kannst du Sound frei tauschen.

---

## Effects

Overlays mit transparentem Hintergrund (1920×1080), liegen in `effects/`. Alle stumm — Ton kommt über Streamer.bot.

| Datei | Beschreibung | Dauer |
|-------|-------------|-------|
| `effects/weather.html` | Wetter: echtes Wetter am eigenen Ort, gefärbt von der K/D der laufenden Session, per Chat zeitweise übersteuerbar, dazu Spektakel (Tsunami, Mega-Blitze, Kugelblitz, Lawine) | Dauerhaft |
| `effects/rain.html`, `effects/snow.html` | alte URLs, leiten auf `weather.html` um (Regen bzw. Schnee fest) — im Dashboard ausgeblendet | — |
| `effects/xmas.html` | Weihnachtsschmuck: Lichterkette, Baum mit Stern, hängende Kugeln, Schneehaufen — alles einzeln schalt- und einstellbar; Follower-Kugeln und Geschenke (Sub, Bits, Raid …) per Streamer.bot, dauerhaft gespeichert | Dauerhaft |
| `effects/autumn.html` | Herbstdeko: Blätterranke mit Lichtern, Ast in der Ecke, fallendes Laub, Laubhaufen, Follower-Kürbisse mit Namen — der Chat recht das Laub weg (Rangliste) oder springt hinein | Dauerhaft |
| `effects/winter.html` | Winterdeko ohne Weihnachten: Eiszapfen, Raureif, Schneedecke, Schneemann (wächst mit Subs), Follower-Mini-Schneemänner — schippen, kratzen, Eiszapfen abbrechen, Schneebälle | Dauerhaft |
| `effects/spring.html` | Frühlingsdeko: Blumenwiese mit Follower-Blumen, Kirschblütenzweig, Bienen und Schmetterlinge — gießen, Unkraut zupfen | Dauerhaft |
| `effects/summer.html` | Sommerdeko: Sonne, Strand mit Follower-Sandburgen, Hitzeflimmern, Abend mit Glühwürmchen — Hitzewelle abkühlen, Eis schmilzt | Dauerhaft |
| `effects/questionmarks.html` | Fragezeichen (Video) | ~9s |
| `effects/explosion.html` | Explosion (Video) | ~14s |
| `effects/particle-swirl.html` | Partikel-Wirbel (Video) | ~6s |
| `effects/lens-flare.html` | Lens Flare — `?n=1…7` wählt die Variante | Videolänge |

### Wetter (`weather.html`)

Drei Schichten, die oberste gewinnt:

1. **Echtes Wetter** am Ort aus `place` (Open-Meteo, ohne Key, alle 10 min, Ortssuche 24 h im Cache). Der Server schickt den Ort nie ans Overlay zurück — er steht aber in der OBS-URL, wer die Source-Einstellungen sieht, sieht ihn also auch. Ein größerer Nachbarort reicht. Ohne Ort oder wenn der Dienst nicht antwortet, gilt die **Fallback-Lage**; die letzte gute Antwort gilt bis zu 60 min weiter.
2. **K/D-Stimmung** der laufenden Session (nur BR-Runden, alle verfolgten Accounts, ab 3 Runden, Session = letzte Runde < 4 h her). Unter der unteren Grenze (Standard 1,5) wird es trüb mit Niesel, ab drei Vierteln davon (≈ 1,1) Regen — nie Gewitter. Über der oberen Grenze (Standard 2,5) kommt Sonne durch, auch bei Regen oder Schnee. Dazwischen verläuft es stufenlos, bei 2,0 neutral. Regen aus schlechter K/D kühlt eine Hitzewelle fast ganz ab, schon eine mäßige K/D dämpft sie. Gute K/D lichtet Nebel; bei Gewitter und Schneesturm kommt höchstens ein Hauch Sonne durch, bei Regen und Schnee ein Sonnenregen. Abdunklung und Nebel liegen nur am Rand, die Bildmitte bleibt frei; mit `veil=1` kommt ein leichter Grauschleier (höchstens 10 %) übers ganze Bild.
3. **Chat-Übersteuerung** per `cmd=weather&to=<lage>` für 2,5 min (`hold` in Sekunden, `0` = bis `cmd=auto`). Mehrere Befehle innerhalb von 15 s: der jüngste wartet, bis die 15 s um sind — kein Flackern. Bestelltes Wetter mischt sich: Nebel legt sich über Regen, Niesel, Gewitter, Schnee, Schneeregen und Wolken (in beiden Reihenfolgen), Regen und Schnee ergeben Schneeregen; Schneesturm, Hitze und Klar ersetzen. Erzwungenes Wetter überlebt einen Server-Neustart.

Lagen: `clear`, `cloudy`, `fog`, `drizzle`, `rain`, `storm`, `sleet`, `snow`, `sleet` (Schneeregen: nasse, schwere, grau-weiße Flocken, fallen schneller und tauen nach unten hin zu Tropfen), `blizzard` (Schneesturm: fast waagerechter Schnee, Whiteout an den Rändern, Treibschnee am Boden, kalter Ton – auch bei echtem Schneefall mit Sturm ab etwa 40 km/h), `heat`, dazu `night` (Sternenhimmel), `dawn` (Sonnenaufgang, Sonne tief im Osten) und `dusk` (Abenddämmerung, Sonne tief im Westen) für feste Lage und Chat. Live kommen Nacht und Dämmerung aus Sonnenauf- und -untergang am Ort: ±45 min um Auf-/Untergang färbt sich der Rand orange-rosa, nachts gibt es statt Sonne Sterne oben am Rand und ab und zu eine Sternschnuppe (bei Wolken weniger, bei Niederschlag keine). Teilweise bewölkt zählt als klar; der Wolkenanteil bestimmt, wie viel Sonne durchkommt. Sonne und Mond stehen dort am oberen Rand, wo sie am Ort gerade am Himmel stehen (Osten links, Westen rechts; Südhalbkugel gespiegelt), und erscheinen nur über dem Horizont; der Mond mit echter Phase. Abends zeigt die K/D sich an Mond und Sternen: schlechte K/D = Wolken und Niesel, gute = heller Mond, mehr Sterne und Sternschnuppen, sehr gute (`aurorakd`) = Polarlicht. Sonnenzeiten und genaue Stände bleiben auf dem Server, das Overlay bekommt nur grob gerundete Bildpositionen. Übergänge: echtes Wetter/Stimmung 25 s, Übersteuerung und Änderungen aus dem Dashboard 4 s, Regen geht über Schneeregen in Schnee über.

**Parameter (URL und `cmd=set`):**

| Parameter | Werte | Standard |
|-----------|-------|----------|
| `place` | Ort fürs Live-Wetter, z. B. `Hamburg`; eingrenzen mit Komma (`St. Helena, ZA`, `Jamestown, SH` – Ländercode, Land oder Region) oder Koordinaten (`-15.93, -5.72`). Die Karte zeigt den gefundenen Ort, Wetter, Ortszeit, Sonnenzeiten und bei mehreren Treffern die Alternativen zum Anklicken | — |
| `lock` | feste Lage statt Live-Wetter (ersetzt nur das echte Wetter, K/D-Stimmung, Tageszeit und Chat wirken weiter), `off` = live | `off` |
| `fallback` | Lage ohne Ort oder bei Ausfall | `clear` |
| `mood` | `0` … `1`, Stärke der K/D-Stimmung | `1` |
| `kdlow` / `kdhigh` | Grenzen schlechte/gute K/D | `1.5` / `2.5` |
| `kdtest` | Test-K/D statt der echten, `off` = echt — zum Ausprobieren im Dashboard, nicht in OBS stehen lassen | `off` |
| `aurorakd` | ab dieser K/D zieht nachts ein ruhiges Polarlicht auf, `0` = aus | `3` |
| `veil` | `1` Grauschleier übers ganze Bild bei mieser Stimmung | `0` |
| `testbg` | Bild-URL als Testhintergrund (z. B. ein Gameplay-Screenshot), nur in Vorschau und Browser-Tab — in OBS ignoriert | — |
| `wind` | `auto` = Wind der Lage (live: echter Wind), `random` = wechselt alle 6–15 s weich, mal von links, mal von rechts, oder fest `-1` … `1` | `auto` |

**Frost:** Bei echter Temperatur ≤ 0 °C oder im Schneesturm wachsen Eisblumen von den Ecken über die Ränder ins Bild (Mitte bleibt frei): (2 + Kältegrade) % pro Minute, im Schneesturm mindestens 10 %; über 0 °C taut es langsam ((1 + Temperatur/2) % pro Minute), bei Hitze – auch eingestellt – schmilzt er mit 25 % pro Minute. Der Stand liegt auf dem Server und überlebt Reload und Neustart. `!scrape` kratzt 6 % frei (Kratzer fährt eine Bahn), `!warm` haucht 10 % frei (Atemwolke, Dampf); beides wirkt nur an der Stelle, die übrige Scheibe bleibt; freie Stellen frieren in etwa 90 s wieder zu. Beide zählen für die Rangliste „Top frost fighters“; ist die Scheibe ganz frei, funkelt es. Schalter `frost` (`1`/`0`) und `frostrate` (`0.25`–`4`).

**Deko-Themen:** Schalter `theme` (`auto` = kalendarisch: `spring` ab 20.3., `summer` ab 21.6., `autumn` ab 22.9., `winter` ab 21.12. und während der Xmas-Zeit; oder fest, `none` = nur Wetter). `cmd=season&to=next` (Knopf „Start next season now“) startet die nächste Jahreszeit sofort und hält, bis der Kalender sie erreicht; `to=winter|spring|summer|autumn` wählt gezielt, `to=auto` hebt den Frühstart auf. Ein per Knopf aufgebauter Weihnachtsbaum zeigt immer Winter, auch bei fest gewähltem Herbst, bis zum Abschied. Es ist immer genau ein Thema aktiv; die Mechaniken laufen auf dem Server und folgen dem wirksamen Wetter:

- **Herbst:** Blätterranke, Ast, fallendes Laub, Laubhaufen (wächst stetig, bei Wind schneller, `leafrate`), Follower-Kürbisse (nachts bekommen sie Kürbis für Kürbis ihr Gesicht: die Hälfte glimmt weich auf, 40 % rollen zur Kante hinaus und kommen mit Gesicht zurückgerollt, selten platzt einer und ein geschnitzter fällt an seinen Platz; morgens erlöschen sie nacheinander weich). `!rake` (−5, „Top rakers“), `!extinguish` (eigene Rangliste „Top firefighters“, `!board` zeigt sie im Herbst nach den Laubrechern), Mods `!leafstorm` (Knopf „Leaf storm“: +25 % Laub auf den Haufen, z. B. damit ein Blitz wieder etwas zum Anzünden hat; zählt für keine Rangliste), `!jump`, Mods `sweep`.
- **Frühling:** Blumenwiese mit Follower-Blumen (sechs Sorten: Margerite, Tulpe, Mohn, Glockenblume, kleine Sonnenblume, Gänseblümchen-Büschel; Höhe, Neigung und Kopfgröße je Blume verschieden), Kirschblütenzweig, Bienen, Schmetterlinge. Die Erde trocknet (2 %/min, bei Hitze 6), Regen gießt (30 %/min), unter 30 % lassen die Blumen die Köpfe hängen; Unkraut wächst 1 %/min. `!water` (+10), `!weed` (−3, 3 Leute in 20 s ziehen die Hälfte; „Top gardeners“), `!bee`.
- **Sommer:** Strand mit Follower-Sandburgen, Sonnenschirm, abends Glühwürmchen. Die Hitze steigt bei Hitzewelle (20 %/min) und Sonne (2 %/min), sinkt bei Regen (10 %/min), Schnee (25 %/min), nachts (3 %/min), ohne Sonne (4 %/min) und an kalten Orten unter 15 °C (8 %/min). Schnee auf heißem Sand dampft, und sobald Schnee liegt, glüht der Sand nicht mehr. Die Follower-Sandburgen haben vier Bauformen (Klassiker, Eimerburg, breite Mauer, Doppelturm mit Spitzdächern), drei Sandtöne, teils gespiegelt oder mit Muschel. `!splash` (−5, „Top coolers“), `!ice` (Eis schmilzt mit der Hitze), Mods `cool`.
- **`!fries` und die Möwe:** `!ice` steckt schräg (10–25°) mit der Waffel im Sand; etwa jedes dritte Eis klaut nach ein paar Sekunden eine Möwe („A seagull stole …'s ice cream!“), die leere Waffel verblasst. `!fries` (`cmd=fries&name=%user%`) stellt eine rot-weiße Pommesschale an den Rand („… got fries!“); nach 15–40 s holt die Möwe die Pommes in 2–4 Flügen oder einem großen Griff, dann verblasst die Schale.
- **Winter:** siehe unten.

**Deko reagiert auf Wetter und Spektakel** (nur das sichtbare Thema, alles vorübergehend, kein Follower verschwindet):

- **Regen/Gewitter (Sommer):** Der stehende Sonnenschirm hält Regen und Schnee ab (Tropfen zerplatzen auf ihm, an den Rändern tropft es ab, Flocken bleiben liegen); Burgen direkt darunter bleiben trocken und ohne Schneehaube, der Sand darunter bleibt fast schneefrei. Fliegt der Schirm weg (Sturm, Blizzard, Windhose), ist der Schutz weg. Sandburgen sacken je nach Regenmenge zusammen (Türme flacher, Fahnen hängen, Sand rutscht vor den Fuß), der Sandpalast etwas; nach dem Regen bauen sie sich in 1–2 min nach und nach wieder auf.
- **Schnee/Schneesturm (jedes Thema):** Liegen bleibt erst etwas, wenn die ersten Flocken unten ankommen (nach etwa 8 s). Am Boden legt sich Schnee hin (erst Puder, bei viel Schnee eine Decke mit Verwehungen vor den Sandburgen; der Laubhaufen wird überzuckert, die Wiese weiß, Grashalme schauen heraus), nach dem Schnee taut er weg. Im Sommer bekommen Sandburgen, Sandpalast und Sonnenschirm Schneehauben, im Herbst Kürbisse und der Hut der Vogelscheuche; im Schneesturm dicker, nach dem Schnee in etwa 1 min weggeschmolzen. Im Frühling lassen die Blumen und die Sonnenblume die Köpfe hängen. Im Winter schneien die Mini-Schneemänner im Schneesturm bis zum Hut ein und graben sich danach in etwa 1 min frei.
- **Tsunami:** Im Sommer spült die Welle die Sandburgen flach, sobald sie sie erreicht; danach Wiederaufbau. Im Herbst schwimmen die Kürbisse auf dem Wasser auf und setzen sich wieder.
- **Wind und Windhose (Herbst):** Die Vogelscheuche biegt sich bei Sturm und schwankt bei Böen; naht die Windhose, wird sie durchgeschüttelt, Hut und Krähe fliegen davon und kommen danach zurück, Stroh und Laub wirbeln mit. Sie schwingt danach weich aus.
- **Windhose (Sommer, Sandpalast):** Der Palast bebt, sobald die Windhose naht, verliert Türme und Fahnen (etwa die Hälfte sackt zusammen) und baut sich danach wieder auf.
- **Schneesturm (Herbst):** pustet den Laubhaufen weg (25 %/min), die Blätter fliegen mit dem Wind seitlich aus dem Bild.
- **Windhose:** Im Herbst wirbelt sie Laub auf und reißt 2–4 Kürbisse mit, die zurückfallen; im Frühling zerrt sie an den Blumen, Blütenblätter fliegen; im Sommer reißt sie die Sandburgen auf ihrem Weg ein (Sand und Fahnen fliegen, flacher Haufen bleibt; Wiederaufbau 0–60 s danach in je ~25 s), der Sandpalast verliert nur seine Fahnen und etwas Höhe.
- **Blitz trifft Deko:** Ein naher Blitz, der höchstens 70–90 px neben einem Kürbis (Herbst), einem Mini-Schneemann (Winter) oder einer Sandburg (Sommer, nicht unter dem Schirm) endet, trifft ihn mit 35 %: Der Kürbis platzt in Brocken, der Mini zerstiebt zu Schnee, die Burg zerbröselt mit Funken und Sand. Kürbis und Mini wachsen nach 8–14 s mit der Aufbau-Animation nach und zeigen dann kurz ihren Namen (solange sie fehlen, wählt der Namens-Scheinwerfer sie nicht aus), die Burg baut sich wie nach Regen wieder auf; der Follower bleibt.
- **Sturm im Winter:** Weihnachtsbaum und großer Schneemann biegen sich bei Sturm, Böen und naher Windhose und schwingen gedämpft aus (wie der Baum am Strand); nur der Baum, nicht Wehe und Geschenke. Zieht eine Windhose durchs Bild, zittern die Minis.
- **Blitzfeuer im Laub (Herbst):** Jeder nahe Blitz, der in den Laubhaufen fährt (Laub über 5 %), zündet ihn; ein naher Blitz bis 250 px neben dem Haufen springt hinein. Bis zu 5 Feuer brennen gleichzeitig: Ein Blitz in ein brennendes Feuer facht es neu an, trockene Feuer springen nach 8–14 s mit 70 % auf eine Nachbarstelle über (mit dem Wind eher in seine Richtung, im Regen nie). Flammen, Funken, Rauch und warmer Schein brennen nur an ihrer Stelle ein Loch in den Haufen, das sich in ~4 min wieder füllt; der gemeinsame Laubstand beider Haufen bleibt. Trocken ~30 s, bei Regen nur Zischen, Dampf und ~8 s Glut. `!extinguish` löscht je Aufruf das älteste Feuer mit Wasser und Dampf („… put out the fire! 2 left“) und zählt für die Herbst-Rangliste; ohne Feuer nur ein kleiner Spritzer.
- **Sonnenschirm nachts (Sommer):** Bei Nacht (über 60 %, wieder auf unter 40 %) klappt der Schirm zu: die Kuppel schrumpft und geht in eine schlanke, gestreifte Hülle mit Halteband über, die entlang der Stange hängt, kein Regen- und Schneeschutz mehr, die Burgen darunter werden nass; ein Blitz kann den zugeklappten Schirm nicht anzünden, wegwehen kann er weiterhin.
- **Sonnenschirm (Sommer):** Ein naher Blitz in den Schirm setzt die Bespannung in Brand, sie brennt in ~6 s bis auf Speichen und Stange ab, die Stange qualmt, nach ~60 s steht ein neuer. Sturm (Wind ≥ 0,8), Gewitter, Schneesturm oder eine nahe Windhose wehen ihn weg; ist es ~20 s ruhig, fällt er zurück und steckt sich in den Sand. Solange der Weihnachtsbaum am Strand davor steht, passiert beides nicht.
- **Nasses Laub (Herbst):** Bei Regen werden Haufen, Ranke, Ast und fallende Blätter dunkler und glänzen leicht, Wind löst nur noch ~30 % so viel Laub; danach trocknet es in ~2 min.
- **Mega-Blitz (jedes Thema):** Während des Spektakels dunkelt eine Gewitter-Trübung das Bild ab und die Deko wird gedimmt; die Blitze hellen weiter auf.
- **Lawine (Winter):** Die Minis in der Ecke, in der sie aufschlägt, sind kurz begraben.
- **Hagel (Frühling):** Ein paar Blumen knicken um und richten sich nach 20–30 s wieder auf.

Der Strand lässt in der Bildmitte (Lebensbalken) nur einen flachen Streifen frei.

**Ansturm im Chat:** Der Server hebt je Source die letzten 100 Befehle auf (Abfrage jede Sekunde), auch 50 Schneebälle in wenigen Sekunden gehen nicht verloren. Höchstens 6 Schneeflecken stehen gleichzeitig im Bild, weitere Bälle zerstäuben nur in Flocken; höchstens 8 Eis und 4 Pommesschalen stehen am Strand. Namensschilder werden gesammelt: das erste sofort, was in den nächsten 2,5 s nachkommt, als ein Schild („Tim, Anna and 23 others threw snowballs too!“); gilt für Schneeball, Eis, Pommes, Rechen, Springen und Bienen.

**Gemeinsame Follower:** Alle Jahreszeiten teilen eine Follower-Liste. `cmd=follow&name=%user%` trägt den Namen einmal ein (doppelte Namen zählen nicht), und er erscheint in jedem Thema in dessen Form (in der Weather-Source 5 s nach dem Befehl, damit der Wechsel nicht unter dem Follow-Alert untergeht): Kürbis, Blume, Sandburg, im Winter Kugel am Baum (Xmas-Zeit) bzw. Mini-Schneemann (sonst; in der Xmas-Zeit ausgeblendet, damit jeder Follower nur einmal im Bild ist). Beim Umschalten des Themas sind also gleich viele Follower zu sehen. Das Aussehen kommt fest aus dem Namen (Kürbis-Sorte, Größe und Form; Blumensorte, Farbe und Höhe; Sandburg-Form, Sandton und Fahne; Mützenfarbe des Minis; Baumschmuck), der Platz bestimmt nur Lage und Tiefe; so sieht ein Follower nach einem Platzwechsel und beim `!whereiam`-Besuch gleich aus. Kürbisse haben eine dunkle Kontur und einen weichen Kontaktschatten, damit sie sich vom gleichfarbigen Laub abheben. Kürbisse und Mini-Schneemänner stehen in die Tiefe gestaffelt: je Platz fest zwischen vorn (unterer Rand) und hinten (oben auf Laub bzw. Schneedecke); je höher Laub oder Schnee, desto weiter liegen vorn und hinten auseinander, bei flachem Laub oder wenig Schnee steht mal einer halb vor dem Nachbarn. Zeigt der Namens-Scheinwerfer einen Follower, hebt sich Kürbis bzw. Mini etwas an und wackelt (der Kürbis-Schatten bleibt am Boden und wird kleiner, auch beim Hüpfen und Feiern; beim Rollen dreht er nicht mit, sondern wandert flach mit und wird je nach Drehlage breiter oder schmaler), der Blütenkopf nickt, die Sandburg wackelt. Winter-Befehle (`shovel`, `icicle`, `snowball`, `snowboard`) wirken nur, solange der Winter zu sehen ist. Zu sehen sind je Thema die neuesten **12** (dichter an den Ecken, die Mitte bleibt frei), gespeichert bleiben alle. Kommt ein 13. dazu, macht der älteste Platz: Kürbis, Mini-Schneemann und Sandburg rollen zur nächsten Kante hinaus, die Blume purzelt davon, und etwa jedes vierte Mal holt ihn stattdessen ein Vogel ab (Krähe, im Frühling eine Amsel, am Strand eine Möwe); danach fällt bzw. wächst der Neue an seinem Platz. Die bisher gesammelten Kugeln, Kürbisse, Blumen, Sandburgen und Mini-Schneemänner wurden zusammengeführt. **Import:** Auf der Weather-Karte im Tab **Chat commands** holt „Import last 60 Twitch followers“ per einmaligem Twitch-Login (Recht `moderator:read:followers`) die letzten 60 Follower; der Token wird nicht gespeichert. Daneben holt „Import current subscribers as gifts“ (Recht `channel:read:subscriptions`) die aktuellen Abonnenten als Geschenke unter den Baum: Tier 2/3 zählen mehr, Geschenk-Subs zählen für den Schenkenden, wer schon ein Geschenk hat, wird übersprungen. Twitch liefert nur aktuelle Abonnenten ohne Datum. Namen, die nach einer nicht ersetzten Streamer.bot-Variable aussehen (`latestFollower.user`, `%user%`, `user`), lehnt der Server ab.

**Sub-Projekt:** Jeder Sub (`cmd=build&name=%user%`) baut ein Teil am gemeinsamen Projekt (8 Teile, gleicher Fortschritt in allen Themen): Winter Schneemann, Herbst Vogelscheuche, Frühling Sonnenblume, Sommer Sandpalast. Zurückgesetzt wird nur per Knopf „Start a new sub project“ (`cmd=snowmanreset`).

`cmd=celebrate`, `cmd=seasonboard` (Rangliste des aktiven Themas), `cmd=clear&kind=pumpkins|leaves|flowers|garden|castles|heat`.

**Winter mit Xmas-Zeit:** Winter: Schneedecke mit Schneebergen in den Ecken (wächst, solange es schneit: Blizzard 25 %/min, Schnee 10, Schneeregen 6, jeweils × `snowrate`; eine Lawine lässt 20 % liegen; Hitze und Tauwetter lassen sie schmelzen), Eiszapfen, Schneemann (ein Teil pro Sub, in der Xmas-Zeit mit Mütze und Lichterkette) und Mini-Schneemänner der Follower. Xmas-Zeit von `xmasfrom` (`advent` = 1. Advent oder `MM-DD`) bis `xmasto` (`MM-DD`, Standard `12-26`): Lichterkette, Baum mit Follower-Kugeln, hängende Kugeln, Geschenke. Der **Aufbau** ist ab dem Beginn fällig und spielt beim ersten Stream, sobald die Source 2 min live im Programm ist; der **Abschied** ebenso nach dem Ende (Kugeln fallen nacheinander ab und zerbersten am Boden in Scherben, Baum geht, Geschenke-Rangliste ein letztes Mal); beim Aufbau fliegt jede Kugel einzeln von der Seite im Bogen an ihren Platz. `cmd=setup` / `cmd=farewell` (Knöpfe „Set up Christmas“ / „Christmas farewell“) lösen jederzeit sofort aus und machen den automatischen Schritt der Saison hinfällig. Einzelteile per Schalter `lights`, `tree`, `baubles`, `gifts`, `snowman`, `minis`, `icicles`, `cover`. Kugeln, Geschenke, Mini-Schneemänner und Schneemann aus `xmas.html`/`winter.html` werden übernommen.

**Weihnachten am Strand:** Die Jahreszeiten richten sich nach dem Ort. Auf der Südhalbkugel sind sie um ein halbes Jahr versetzt; bis 25° um den Äquator oder bei tropischem Klima (kältester Monat ≥ 18 °C) ist immer Sommer, wo selbst der wärmste Monat unter 10 °C bleibt, immer Winter. Fällt Weihnachten so in den Sommer, steht die Deko am Strand: Lichterkette oben, ein Tannenbaum im Sand rechts neben der Bildmitte (Sandhügel mit Seestern und Muschel am Fuß, der Sonnenschirm steht dahinter) mit den Follower-Kugeln und den Geschenken darunter. Aufbau und Abschied laufen wie im Winter (automatisch fällig oder per `cmd=setup` / `cmd=farewell`), Geschenke und `cmd=celebrate` ebenso; Schalter `lights`, `tree`, `gifts` gelten auch hier. Solange der Baum steht, treten die Follower-Sandburgen zur Seite (jeder Follower ist genau einmal im Bild, als Kugel), der Sandpalast bleibt; nach dem Abschied kommen die Burgen zurück. Ein Follow erscheint dann als Kugel am Baum, die Sandburg wird still mitgeführt. Sturm und Windhose biegen den Baum (nur den Baum, bei naher Windhose kräftig, die Kugeln wackeln; danach schwingt er weich aus), Böen lassen Baum und Sonnenschirm kurz wackeln; der Schirm fliegt auch bei stehendem Baum weg. Bei Hitze färbt sich auch der Hügel unter dem Baum, bei Schnee bekommen Hügel, Baum, Geschenke und Lichterkette Schnee ab wie im Winter.

| Befehl | Wirkung |
|--------|---------|
| `cmd=whereami&name=%user%` | `!whereiam`: die eigene Figur (Kürbis, Blume, Sandburg, Mini oder Kugel) leuchtet im sichtbaren Thema auf und hüpft dreimal, eine Kugel am Baum wackelt („… is right here!“). Wer nicht unter den neuesten 12 steht (solange der Weihnachtsbaum steht: 30), bekommt einen **Kurzbesuch**: Kürbis und Mini rollen von der nächsten Kante herein, Blume und Sandburg wachsen auf, am Baum schwebt die Kugel groß daneben; „… drops by!“, nach gut 5 s geht die Figur wieder (rollt hinaus, Krähe bzw. Möwe holt sie, die Kugel fliegt davon). Solange ein Besuch läuft, pausiert der Namens-Scheinwerfer; ein Name, den er gerade zeigt, blendet beim Start sofort aus. Antwort `visible` und `say`: Satz für den Chat, wenn sie nicht im Bild ist, noch kein Follower ist oder der Streamer selbst fragt (Gastgeber; Kanal aus den Zugangsdaten) |
| `cmd=follow&name=%user%` | Follow: in alle Themen (Winter: Kugel am Baum in der Xmas-Zeit, sonst Mini-Schneemann; Strand: Kugel am Baum in der Xmas-Zeit, sonst Sandburg) |
| `cmd=build&name=%user%` | Sub: nächstes Teil des Sub-Projekts (8 Teile, alle Themen) |
| `cmd=gift&name=%user%&type=sub\|resub\|giftsub\|bits\|raid&amount=…` | Geschenk unter dem Baum |
| `cmd=shovel&name=%user%` | 5 % Schnee schippen (Rangliste „Top snow shovelers“) |
| `cmd=shake&name=%user%` | Schnee abschütteln, gelingt bei 5 Leuten in 20 s (`&force=1` sofort) |
| `cmd=icicle&name=%user%` / `cmd=snowball&name=%user%` | Eiszapfen abbrechen (zählt) / Schneeball werfen |
| `cmd=celebrate[&name=…]`, `cmd=snowboard` | Feiern / Rangliste zeigen |
| `cmd=setup` / `cmd=farewell` | Xmas-Aufbau / -Abschied sofort |
| `cmd=clear&kind=followers\|gifts\|snow\|snowman` | Mods: dauerhaft löschen (`followers` leert die gemeinsame Liste aller Themen) |

**Befehle** an `https://stream-overlay.com/s/<token>/api/fx/weather?cmd=…` (Streamer.bot **Fetch URL**):

| Befehl | Wirkung |
|--------|---------|
| `cmd=weather&to=storm` | Gewitter für 2,5 min, danach zurück; `&hold=60` = 60 s, `&hold=0` = bis `auto` |
| `cmd=auto` | zurück zum Live-Wetter |
| `cmd=spectacle&type=tsunami` | Spektakel: `tsunami` (erst zieht sich das Wasser zurück, dann rollt eine schäumende Flutwand heran, das Land steht unter Wasser, es läuft wieder ab), `megabolt` (Gewitterwand mit vielen Blitzen), `ballbolt` (nach einem Einschlag glimmt eine gelb-orange Kugel auf, schwebt taumelnd und erlischt lautlos oder platzt — Event für ein Knall-WAV), `avalanche` (Staublawine: Abriss oben in der Ecke, Druckwelle mit Schneestaub und Böe, die brodelnde Wolke rauscht schräg aus der Ecke den Hang hinunter, kurz fast weiß, danach sinkt feiner Schnee aus der Wolke), `aurora` (Polarlicht), `rainbow` (Regenbogen wie in echt: blendet langsam ein, steht 25 s, unscharf, Farben verlaufen ineinander, innen heller Himmel, außen das dunklere Alexander-Band, Helligkeit schwankt entlang des Bogens), `hail` (Hagelschauer), `meteors` (Sternschnuppenregen), `tornado` (Windhose; im Winter, bei liegendem Schnee über 15 % oder kräftigem Schneefall eine Schneehose: hell, halb durchsichtig, wirbelt Schnee statt Staub), `fogwall` (Nebelwand, 2,5 Bildbreiten tief, zieht etwa 19 s durchs Bild); ohne `type` zufällig. Spektakel reichen bis an die Bildränder und passen sich nachts an (dunkleres Wasser, mondbeschienener Schnee, Mondregenbogen, Blitze in der Windhose), Regen, Schnee und Blitze blenden am Rand weich aus. Bis zu 15 laufen gleichzeitig (auch mehrmals dasselbe, z. B. fünf Tornados plus Tsunami und Megabolt), weitere warten, bis Platz ist. Bei mehreren Windhosen heult nur eine Sirene auf einmal; jede Windhose zerrt an der Deko in ihrer Nähe, im Herbst übernimmt eine Windhose Kürbisse, die eine andere im Wirbel hat oder fallen lässt, und schnappt sich als Wasserhose Kürbisse, die auf dem Tsunami treiben. Feuer (Laub, Sonnenschirm) liegen hinter den Spektakeln; der Tsunami löscht sie, sobald das Wasser darüber steht, und unter Wasser zündet kein Blitz. Der Tornado bringt Sturmrauschen mit (mit `siren=1` auch eine Sirene) und biegt Bäume, Schirm, Vogelscheuche und Schneemann |
| `cmd=strike` | Blitz (`&dist=near` / `&dist=far`, passend zum Donner-WAV) |
| `cmd=gust` | Windböe |
| `cmd=scrape&name=%user%` / `cmd=warm&name=%user%` | Frost kratzen / warm anhauchen, zählt für die Rangliste |
| `cmd=leaders` | Rangliste „Top frost fighters“ zeigen (10 s) |
| `cmd=frostclear` / `cmd=frostreset` | Mods: allen Frost entfernen / Rangliste leeren |
| `cmd=set&…` / `cmd=reset` | Parameter live ändern / zurück auf die URL |

Beispiele für Chat-Befehle: `!gewitter` → `cmd=weather&to=storm`, `!schneesturm` → `cmd=weather&to=blizzard`, `!tsunami` → `cmd=spectacle&type=tsunami`. Abklingzeiten laufen über Streamer.bot. **Ton** gibt es optional direkt in der Source (`sound=1`, Standard aus): Regen und Wind folgen der Lage und blenden weich über (leichter Wind bleibt still), jeder Blitz bekommt einen Donner (`assets/stingers/thunder-124463.mp3`; setzt mit dem Blitz ein, ferne Blitze leiser und tiefer), Böen rauschen; `volume` (0–1, Standard 0,6), `thunder` (0–1) und `ambient` (Regen, Wind und Böen relativ zur Gesamtlautstärke, 0–1, Standard 0,3, damit das Spiel hörbar bleibt). Ein Tornado bringt eigenes Sturmrauschen mit (lauter, je näher er der Bildmitte kommt, unabhängig von `ambient`); `siren=1` lässt dazu eine ferne Warnsirene heulen (Standard aus). In OBS „Audio über OBS steuern“ aktivieren. Der ganze Ton läuft über Web Audio, weil OBS `<audio>`-Elemente einer Browser-Source stumm lässt (bis 10.11.2026 waren deshalb Regen, Wind, Böen und das Tornado-Rauschen in OBS nicht zu hören, nur der Donner). Wer den Ton lieber über Streamer.bot abspielt, lässt `sound` aus und nutzt die WAVs unten.

**Wetter gegen Bits oder Spende:** `/s/<token>/api/fx/weather/paid?kind=bits|money&amount=…&name=…&msg=…` (in Streamer.bot beim Cheer bzw. bei der Spende aufrufen, `msg` als letzten Parameter). Steht ein Befehl in der Nachricht (z. B. „cheer500 !tornado“), gilt genau der, sonst wählt der Betrag zufällig aus der höchsten erreichten Stufe: Wetter für 2,5 min (`!thunderstorm`, `!blizzard`, `!rain`, `!snow`, `!fog`, `!heatwave`, `!night`) ab 100 Bits bzw. 1 €, kleine Spektakel (`!rainbow`, `!aurora`, `!meteors`, `!hail`, `!fogwall`, `!ballbolt`) ab 200 Bits bzw. 2 €, große (`!tornado`, `!megabolt`, `!tsunami`, `!avalanche`) ab 500 Bits bzw. 5 €. Reicht der Betrag für den gewünschten Befehl nicht, passiert nichts, die Antwort nennt den Preis. `kind=raid&amount=%viewers%` begrüßt Raids ab 20 Zuschauern mit Sternschnuppen, Regenbogen oder Polarlicht, ab 50 mit einem Unwetter. Antwort `{"offer", "say"}`: `say` ist ein fertiger Satz für den Chat (leer = nichts sagen). **Chat-Sätze:** `/s/<token>/api/fx/weather/info?what=weather|project|top|tip|commands|rotate[&place=…]` (`commands` = nur die kostenlosen Befehle, die in der aktuellen Jahreszeit wirken, Frost-Befehle nur bei Frost) liefert `{"say"}` für `!weather` („Live aus Berlin: Regen, 3 °C. Im Stream ist Winter, die Schneedecke liegt 20 % hoch.“; „Live aus …“ nur bei echtem Wetter, der Ort kommt aus `place`; bei bestelltem Wetter „Im Bild gerade: Regen (bestellt von Tim, noch 2 min)“, bei bestellter Tageszeit „Tageszeit: Nacht (…)“, bei fester Lage „Wetter im Stream: Schnee (fest eingestellt)“, in der Xmas-Zeit „Weihnachtszeit“; den Besteller nennt `&name=` am Befehl `cmd=weather`, bei Bits/Spenden automatisch; gerechnet wird mit den Einstellungen, mit denen die Source zuletzt gefragt hat, also Thema und feste Lage wie im Stream), den Stand des Sub-Projekts, die Rangliste des Themas, einen Befehls-Tipp; `rotate` wechselt reihum (für eine Erinnerung per Timer, leere Ranglisten werden übersprungen). `cmd=build` antwortet zusätzlich mit `project`, `left`, `completed` und `say` („Danke X! Noch 3 Subs bis zur fertigen Vogelscheuche.“).

**Ereignisse an Streamer.bot:** Mit `sbaction=<Action-Name>` startet die Source in OBS bei Ereignissen eine Streamer.bot-Action über dessen lokalen WebSocket-Server (`sbws`, Standard `ws://127.0.0.1:8080/`, nur lokale Adressen, ohne Passwort; in Streamer.bot unter Servers/Clients → WebSocket Server starten). Argumente: `event` (`fire`, `fireOut` = von selbst ausgebrannt, `extinguished`, `struck` = Blitz trifft Deko, mit `target` = `pumpkin`/`snowman`/`castle`/`umbrella` und `name` = Follower, `spectacle` = ein Spektakel beginnt, mit `type` wie bei `cmd=spectacle` und `snow` = 1 bei der Schneehose; wartende Spektakel melden sich erst, wenn sie starten), `fires` (brennen noch), `wet`, `cause` (`lightning`/`spread`), `side` (`left`/`right`), `name` (wer gelöscht hat) und `theme`. Nur in OBS, Vorschauen im Browser lösen nichts aus. Die Source hält die Verbindung offen und baut sie nach einem Neustart von Streamer.bot von selbst wieder auf (Versuche alle 2–30 s, ohne aufzugeben; ein hängender Aufbau wird nach 8 s verworfen); Meldungen älter als 30 s verfallen.

**OBS-Dock:** `https://stream-overlay.com/app/dock/weather?place=Berlin` in OBS unter Docks → Benutzerdefinierte Browser-Docks eintragen (einmal im Dock anmelden, der Login bleibt). Schmale Steuerseite ohne Menü: oben die Statuszeile wie `!weather` (Live-Wetter am Ort, bestelltes Wetter mit Besteller und Restzeit, Jahreszeit; alle 20 s und nach jedem Knopf neu), darunter die Knöpfe der Weather-Source in aufklappbaren Gruppen. Wetter und Tageszeit aus dem Dock laufen unter dem eigenen Namen. `place` wie in der Overlay-URL.

**Vorschau Baumschmuck:** Tools (nur Admin) „Christmas ornaments preview“: Entwürfe für den Follower-Schmuck am Weihnachtsbaum (Glaskugel, Nussknacker, Tannenzapfen, Zuckerstange, Strohstern, Glocke, Lebkuchenherz) groß und in Originalgröße an einem Probe-Baum; der Typ hängt fest am Namen.

**Testseite Kürbisdrehung:** Im Dashboard unter Tools (nur Admin) „Pumpkin turn preview“: fünf Kürbisse mit denselben Styles wie die Source, Regler für Dauer, Kurve und Zeitlupe, Knöpfe für Drehen, Wegrollen, Aufglimmen und Erlöschen; die eingestellten Werte stehen als CSS darunter (`--pk-turn-dur`, `--pk-turn-ease`).

**Tageszeit:** `day`, `dawn`, `dusk` und `night` (eigene Knopfgruppe „Time of day for 2.5 min“ bzw. `cmd=weather&to=day`) übersteuern nur die Tageszeit, nicht das Wetter: Nach „Night“ bleibt es bei „Rain“ Nacht, „Day“ macht es mitten in der Nacht hell, ohne das Wetter zu ändern. `cmd=auto` setzt Wetter und Tageszeit zurück. Die Deko dunkelt in etwa 4 s weich ab bzw. auf.

**Testen:** Die Knöpfe auf der Karte wirken wie Chat-Befehle 2,5 min lang, dauerhaft geht über `Fixed weather`. Unter **Location** zeigt die Karte den gefundenen Ort, das Wetter dort und die Sonnenzeiten. Im Dashboard **Stream → Weather** „Apply setting changes live“ einschalten, dann `Fixed weather`, `Test K/D` und `Grey veil` durchschalten und die Knöpfe (Thunderstorm, Tsunami, …) drücken — wirkt sofort auf die Source in OBS.

**Alte Rain-/Snow-URLs:** `rain.html?intensity=…&wind=…` (auch `wind=random`) leitet auf `weather.html` mit fester Lage um (`light` → Niesel, `medium`/`heavy` → Regen, `storm` → Gewitter) und hört weiter auf `/api/fx/rain` (`strike`, `gust`, `start`, `stop`, `set&intensity=…`, `reset`). `snow.html` zeigt festen Schnee. Farbe, Spritzer und Browser-Ton der alten Rain-Source gibt es nicht mehr.

#### Live control im Dashboard (ohne Streamer.bot)

Weather, Xmas, Autumn, Winter, Spring und Summer haben im Dashboard (**Stream → <Effekt>**) eine Box **Live control**. Sie wirkt auf die Source, die gerade in OBS läuft, wie ein Streamer.bot-Befehl innerhalb von etwa einer Sekunde:

- **Knöpfe** für das, was man von Hand auslöst (dieselben im Dashboard-Reiter „Live control“ und im OBS-Dock): Wetter für 2,5 min (alle Lagen inkl. Cloudy, Drizzle, Sleet, Heat wave), Tageszeit für 2,5 min (Day, Dawn, Dusk, Night), Jahreszeit (Winter, Spring, Summer, Autumn, Next season, Back to calendar; nur bei Theme „auto“), Blitz, Böe, alle Spektakel und ein zufälliges, Frost, Deko (Weihnachtsaufbau/-abschied, Sub-Projekt), je Jahreszeit ihre Aktionen (z. B. Fries, Ice cream, Rake, Shovel). Knöpfe schicken keinen Namen und zählen deshalb nicht für Ranglisten (im Dock laufen Wetter und Tageszeit unter dem eigenen Namen). Dauerhaftes Löschen (`cmd=clear`) gibt es bewusst nicht als Knopf.
- **Shake off** und **Pull weeds** gelingen sofort, ohne auf weitere Chatter zu warten (`&force=1`, auch als Mod-Befehl für Streamer.bot nutzbar).
- **Apply setting changes live**: jede Änderung an einem Schalter geht sofort per `cmd=set` an die laufende Source. Beim Einschalten wird einmal der komplette Stand der Schalter geschickt.
- **Back to OBS URL** (`cmd=reset`): die Source nimmt wieder die Werte aus ihrer URL; das Live-Setzen schaltet sich dabei aus.

Live-Einstellungen speichert der Server nicht. Lädt OBS die Source neu (Szenenwechsel mit Refresh, OBS-Neustart), gilt wieder die URL — dauerhaft wird eine Einstellung erst, wenn die neue URL in OBS steht.

### Weihnachtsschmuck (`xmas.html`)

Eine Source für alles; jedes Element einzeln an/aus. Alle Werte stehen im Dashboard unter **Stream → Xmas** als Schalter und lassen sich live per Streamer.bot ändern.

| Parameter | Werte | Standard |
|-----------|-------|----------|
| `lights` | `top` (oben), `frame` (oben + Seiten), `off` | `top` |
| `pattern` | `steady`, `twinkle`, `chase` (Lauflicht), `wave` | `twinkle` |
| `colors` | `classic`, `warm` (Warmweiß), `theme` (Lila/Gold), `icy` — gilt für Lichter und hängende Kugeln | `classic` |
| `lightsy` | 0–400 px — Lichterkette tiefer setzen (z. B. unter einen Kompass) | `0` |
| `sag` | 0–160 px — Durchhang der Bögen | `74` |
| `baubles` | `both`, `left`, `right`, `off` — hängende Kugeln in den oberen Ecken | `both` |
| `blen` | 0.3–2 — Fadenlänge (Faktor), kurz z. B. über einer Minimap | `1` |
| `bsize` | 0.5–1.6 — Kugelgröße (Faktor) | `1` |
| `tree` | `1` / `0` | `1` |
| `treepos` | `right`, `left` | `right` |
| `treex` | 0–1500 px Abstand zum Rand (`460` = neben einer 400-px-Cam) | `40` |
| `tsize` | 0.5–1.5 — Baumgröße (Faktor) | `1` |
| `treesnow` | `1` / `0` — Schnee auf den Ästen | `1` |
| `snow` | `1` / `0` — Schneehaufen unten | `1` |
| `ground` | `1` / `0` — Schneedecke über die ganze Breite unten, wächst ab ~25 % Schnee bis 60 px (aus, wenn sie das Spiel-HUD verdeckt) | `1` |

**Befehle** (`https://stream-overlay.com/s/<token>/api/fx/xmas?cmd=…`, Streamer.bot **Fetch URL**):

| Befehl | Wirkung |
|--------|---------|
| `cmd=set&…` | beliebige Parameter von oben live ändern, z. B. `cmd=set&lights=off` oder `cmd=set&tree=0&snow=0` |
| `cmd=celebrate` | 4 s Lauflicht, alles heller, Kugeln wackeln, Stern dreht schnell — z. B. bei Sub |
| `cmd=ornament&name=%user%` | Follow: Kugel an den Baum, Name kurz sichtbar. Pro Name nur eine Kugel (Refollow zählt nicht doppelt) |
| `cmd=gift&type=…&name=%user%&amount=…` | Geschenk unter den Baum, Name kurz sichtbar. Typen und Streamer.bot-Variablen siehe unten |
| `cmd=clear` | **alles dauerhaft löschen**; `&kind=ornaments` bzw. `&kind=gifts` nur eine Sorte |
| `cmd=reset` | zurück auf die Werte aus der Source-URL |

| Ereignis (Streamer.bot-Trigger) | Befehl | Aussehen |
|---------------------------------|--------|----------|
| Follow | `cmd=ornament&name=%user%` | Kugel |
| Sub | `cmd=gift&type=sub&name=%user%` | rotes Paket, goldene Schleife |
| Resub | `cmd=gift&type=resub&name=%user%&amount=%cumulative%` | grünes Paket, ab 12 Monaten größer |
| Gift Sub / Gift Bomb | `cmd=gift&type=giftsub&name=%user%&amount=%gifts%` | lila Paket, wächst mit der Anzahl |
| Cheer | `cmd=gift&type=bits&name=%user%&amount=%bits%` | kleines blaues Paket, ab 1000 / 10000 Bits größer |
| Raid | `cmd=gift&type=raid&name=%user%&amount=%viewers%` | großes oranges Paket, ab 50 Zuschauern größer |

**Dauerhaft:** Kugeln und Geschenke liegen in der Datenbank (Tabelle `fx_xmas_item`) und überstehen Neuladen, Szenenwechsel und Server-Neustarts — geleert wird nur per `cmd=clear`. Sichtbar sind die neuesten **30 Kugeln** (Weather-Source; früher 60, das wurde zu voll); in der Weather-Source hängt jeder Follower als eigener Baumschmuck: Glaskugel (40 %, Farbe je Name), Nussknacker, Tannenzapfen, Zuckerstange, Strohstern, Glocke oder Lebkuchenherz (je 10 %). Typ und Farbe kommen fest aus dem Namen, wer am Baum hängt, sieht in jedem Stream gleich aus und behält seinen Platz und **15 Geschenke**, ältere bleiben gespeichert; unter dem Baum zählt eine Zeile, was hängt („30 ornaments · 23 gifts“). Ist der Baum voll, fällt zuerst die älteste Kugel wie beim Abbau zur Erde und zerbirst in Scherben; dann blendet der neue Follower 2,5-fach vergrößert neben dem Baum ein (auf der Seite seines Platzes, sonst auf der Seite mit freiem Bildschirm), fliegt in flachem Bogen hin, schrumpft auf Baumgröße und pendelt am Faden aus; danach leuchtet an der Stelle ein goldener Lichtkranz mit Funken auf, und sein Name steht rund 6 s am Baum, während die Kugel ab und zu am Faden schwingt. Auch wenn das Spotlight zufällig einen Namen am Baum zeigt oder jemand `!whereiam` schreibt, wackelt die gemeinte Kugel kurz am Faden (statt zu hüpfen).

**Spotlight:** Alle 8 s leuchtet eine zufällige Kugel oder ein Geschenk auf und zeigt kurz den Namen — so kommt im Lauf des Streams jeder mal dran.

**Einschneien, Schippen, Rütteln:** `!snow` lässt den Schmuck einschneien, der Chat muss ihn wieder freiräumen.

| Befehl | Wirkung |
|--------|---------|
| `cmd=snowtoggle` | Schneefall an/aus — in die `!snow`-Action, die das Schneefall-Video ein- und ausblendet. Solange es schneit, wächst der Schnee um `snowrate` % pro Minute. Schon nach wenigen Prozent liegt eine sichtbare Schneelinie auf Draht und Baumkanten, ab ~10 % Kappen auf den Kugeln, ab ~60 % Mütze auf dem Stern, ab 70 % gedämpfte Lichter; vor dem Baum steigt eine Schneewehe, die bei 100 % alle Geschenke begräbt und die unterste Baumstufe halb verschluckt |
| `cmd=snowfall` / `cmd=snowstop` | Schneefall gezielt an bzw. aus; `cmd=snowfall&secs=120` hört nach 120 s von selbst auf |
| `cmd=shovel&name=%user%` | −`shovel` %, Schaufel wirft einen Brocken weg, Name kurz sichtbar; zählt für die Rangliste (nur wenn es etwas zu schippen gab). Cooldown pro User in Streamer.bot setzen, z. B. 10 s |
| `cmd=shake&name=%user%` | einzeln nur ein Wackeln; `shakeneed` verschiedene Leute innerhalb `shakewin` s schütteln den ganzen Schnee ab. Oben zeigt „Shake it off! 3/5“ mit Zeitbalken den Stand. Schneit es noch, schneit es danach wieder zu. `cmd=shake&force=1` schüttelt sofort ab (Dashboard-Knopf, Mod-Befehl) |
| `cmd=leaders` | Rangliste „Top shovelers“ (Top 5) für 10 s (Spitzenreiter erscheinen nicht mehr von selbst in der Bildmitte, nur auf Abruf) |
| `cmd=melt` | Schnee weg, Rangliste bleibt (ein laufender Schneefall geht weiter) |
| `cmd=clear&kind=snow` | Schnee **und** Rangliste dauerhaft löschen (`cmd=clear` ohne `kind` löscht alles) |

| Parameter | Werte | Standard |
|-----------|-------|----------|
| `snowrate` | 1–300 % pro Minute Schneefall (20 = nach 5 min eingeschneit) | `20` |
| `shovel` | 1–50 % pro Schippe | `5` |
| `shakeneed` | 1–20 verschiedene Chatter | `5` |
| `shakewin` | 5–120 s Zeitfenster | `20` |

Der Schnee taut nicht von selbst. Der Server speichert nur die Ereignisse (Schneefall an/aus, Schippen, Rütteln, Tauen) dauerhaft und kennt so auch den Stand des Umschalters; Schneehöhe und Rangliste rechnet die Source beim Laden mit ihren Regeln nach — Neuladen (auch mitten im Schneefall) und Server-Neustarts verlieren also nichts, und geänderte Regeln gelten rückwirkend.

`?tune=1` zeigt Verbindungsstatus; Tasten **C** = Celebrate, **O** = Test-Kugel, **G** = Test-Geschenk, **S** = Schneefall an/aus, **V** = Schippen, **K** = Rütteln, **L** = Rangliste (nur lokal, nicht gespeichert).

### Herbstdeko (`autumn.html`)

Gleiches Prinzip wie der Weihnachtsschmuck: eine Source, jedes Element einzeln an/aus, alle Werte im Dashboard unter **Stream → Autumn** und live per Streamer.bot. Ein bisschen Laub liegt immer in den Ecken, damit die Kürbisse nie in der Luft stehen.

| Parameter | Werte | Standard |
|-----------|-------|----------|
| `garland` | `1` / `0` — Blätterranke mit Eicheln oben | `1` |
| `fairy` | `1` / `0` — warme Lichter an der Ranke | `1` |
| `garlandy` | 0–400 px — Ranke tiefer setzen (z. B. unter einen Kompass) | `0` |
| `branch` | `left`, `right`, `off` — Ast in der oberen Ecke; verliert beim Laubfall Blätter, die nachwachsen | `left` |
| `falling` | `1` / `0` — ständig ein paar fallende Blätter (beim Laubfall fallen immer welche) | `1` |
| `density` | `light`, `medium`, `heavy` — Menge der fallenden Blätter | `medium` |
| `pile` | `1` / `0` — Laubhaufen | `1` |
| `spread` | `corners` (Ecken), `full` (ganze Breite) — Form des Haufens, verteilt auch die Kürbisse | `corners` |
| `pumpkins` | `1` / `0` | `1` |
| `faces` | `1` / `0` — geschnitzte, flackernd leuchtende Gesichter | `0` |
| `colors` | `classic`, `golden`, `maple` (Rotahorn), `theme` (Lila/Gold) | `classic` |
| `leafrate` | 1–300 % pro Minute Laubfall (20 = nach 5 min voll) | `20` |
| `rake` | 1–50 % pro Rechenzug | `5` |

**Befehle** (`https://stream-overlay.com/s/<token>/api/fx/autumn?cmd=…`, Streamer.bot **Fetch URL**):

| Befehl | Wirkung |
|--------|---------|
| `cmd=pumpkin&name=%user%` | Follow: ein Kürbis fällt auf den Haufen, Name kurz sichtbar. Pro Name nur ein Kürbis |
| `cmd=celebrate&name=%user%` | Laubfontäne aus beiden Ecken, Lichter blinken schnell, Kürbisse hüpfen, „Thank you, …!“ — für Sub, Resub, Gift Sub, Cheer, Raid (`name` optional) |
| `cmd=leaftoggle` | Laubfall an/aus (`!leaves`). Solange Laub fällt, wächst der Haufen um `leafrate` % pro Minute und deutlich mehr Blätter fallen |
| `cmd=leaffall` / `cmd=leafstop` | Laubfall gezielt an bzw. aus; `cmd=leaffall&secs=120` hört nach 120 s von selbst auf |
| `cmd=rake&name=%user%` | `!rake`: −`rake` %, ein Rechen fährt durch den Haufen, zählt für die Rangliste (nur wenn es etwas zu rechen gab). Cooldown pro User in Streamer.bot setzen, z. B. 10 s |
| `cmd=jump&name=%user%` | `!jump`: jemand springt in den Haufen, das Laub spritzt hoch — nur Show, ändert nichts |
| `cmd=gust` | Windböe: wirbelt Laub von den Haufen und weht die fallenden Blätter zur Seite (passt zur `wind-gust`-WAV) |
| `cmd=leaders` | Rangliste „Top rakers“ (Top 5) für 10 s; das Spotlight zeigt den Ersten zwischendurch auch von selbst |
| `cmd=sweep` | ein Sturm fegt alles Laub weg, Rangliste bleibt |
| `cmd=clear` | **alles dauerhaft löschen**; `&kind=pumpkins` nur Kürbisse, `&kind=leaves` Laub **und** Rangliste |
| `cmd=set&…` / `cmd=reset` | Parameter live ändern / zurück auf die Source-URL |

**Dauerhaft:** Kürbisse und das Laub-Protokoll liegen in der Tabelle `fx_autumn_item`. Sichtbar sind die neuesten **12 Kürbisse** (in der Weather-Source; der älteste rollt weg oder eine Krähe holt ihn); alle 8 s leuchtet einer auf und zeigt seinen Namen. Wie beim Schnee rechnet die Source Laubhöhe und Rangliste beim Laden aus den Ereignissen nach — Neuladen und Server-Neustarts verlieren nichts.

`?tune=1` zeigt Verbindungsstatus und Laubstand; Tasten **C** = Celebrate, **P** = Test-Kürbis, **F** = Laubfall an/aus, **R** = Rechen, **J** = Reinspringen, **W** = Böe, **X** = Wegfegen, **L** = Rangliste (nur lokal, nicht gespeichert).

### Winter, Frühling, Sommer (`winter.html`, `spring.html`, `summer.html`)

Gleiches Prinzip wie Herbst und Weihnachten: eine Source pro Jahreszeit, alles einzeln an/aus im Dashboard unter **Stream → Winter / Spring / Summer** und live per Streamer.bot (`https://stream-overlay.com/s/<token>/api/fx/<jahreszeit>?cmd=…`). Follower hinterlassen etwas mit ihrem Namen (pro Name einmal, alle 8 s leuchtet eins mit Namen auf), der Chat spielt ein kleines Aufräum-Spiel mit Rangliste. Alles liegt dauerhaft in der Tabelle `fx_season_item`; Stände und Ranglisten rechnet die Source beim Laden aus den gespeicherten Ereignissen nach. Geleert wird nur per `cmd=clear`. Alle drei teilen sich `js/season-kit.js` und `js/season-kit.css`.

**Winter** — Eiszapfen oben, Raureif aus den Ecken, Schneedecke, Schneemann, Mini-Schneemänner, fallender Schnee.

| Ereignis / Befehl | Wirkung |
|-------------------|---------|
| Follow: `cmd=mini&name=%user%` | Mini-Schneemann mit bunter Mütze (sichtbar die neuesten 12) |
| Sub: `cmd=build&name=%user%` | nächstes Teil am großen Schneemann: Kugel, Bauch, Kopf, Gesicht, Karotte, Knöpfe und Arme, Schal, Zylinder (8 Teile, dann zieht er den Hut). `cmd=snowmanreset` beginnt einen neuen |
| `cmd=celebrate&name=%user%` | Schneefontäne, Schneemann winkt, „Thank you, …!“ |
| `!snow` → `cmd=snowtoggle` | Schneefall an/aus: Schnee wächst um `snowrate` % pro Minute, Raureif halb so schnell, Eiszapfen mit dem Schnee (bei 70 % voll lang) |
| `!shovel` / `!scrape` / `!icicle` → `cmd=shovel` / `cmd=scrape` / `cmd=icicle` `&name=%user%` | Schnee schippen (−`shovel` %), Raureif freikratzen (−`scrape` %), Eiszapfen abbrechen — alles zählt für „Top helpers“ |
| `!shake` → `cmd=shake&name=%user%` | `shakeneed` verschiedene Leute in `shakewin` s schütteln allen Schnee ab; `cmd=shake&force=1` sofort (Dashboard-Knopf, Mod-Befehl) |
| `!snowball` → `cmd=snowball&name=%user%` | Schneeball klatscht an den Bildschirm und rutscht ab (nur Show) |
| `cmd=leaders` / `cmd=melt` | Rangliste 10 s zeigen / Schnee und Raureif tauen (Rangliste bleibt) |
| `cmd=clear&kind=snow\|minis\|snowman` | Schnee + Rangliste / Mini-Schneemänner / Schneemann dauerhaft löschen |

Parameter: `icicles`, `frost`, `cover`, `minis`, `snowman`, `falling` (je `1`/`0`), `density` (`light`/`medium`/`heavy`), `smpos` (`left`/`right`), `smx` (0–1500 px vom Rand, Standard 260), `snowrate` (20), `shovel` (5), `scrape` (5), `shakeneed` (5), `shakewin` (20). Testtasten mit `?tune=1`: **C** **M** **B** **S** **V** **K** **X** **I** **N** **L**.

**Frühling** — Blumenwiese, Kirschblütenzweig mit rieselnden Blüten, Schmetterlinge.

| Ereignis / Befehl | Wirkung |
|-------------------|---------|
| Follow: `cmd=flower&name=%user%` | Blume wächst aus der Wiese und blüht auf (Margerite, Tulpe, Mohn; sichtbar die neuesten 40) |
| `cmd=celebrate&name=%user%` | alle Blumen tanzen, Blütenregen, „Thank you, …!“ |
| `!rain` → `cmd=raintoggle` | Regen gießt mit `rainrate` % pro Minute — in die bestehende `!rain`-Action mit aufnehmen |
| `!water` → `cmd=water&name=%user%` | Gießkanne, +`waterpct` %, zählt für „Top gardeners“ |
| `!weed` → `cmd=weed&name=%user%` | zupft etwas Unkraut (−3 %, zählt); `pullneed` Leute in `pullwin` s ziehen die Hälfte raus; `cmd=weed&force=1` sofort |
| `!bee` → `cmd=bee&name=%user%` | Biene fliegt eine Blume an (nur Show) |
| `cmd=leaders` / `cmd=clear&kind=garden\|flowers` | Rangliste / frischer Garten (volles Wasser, kein Unkraut, Rangliste leer) bzw. Blumen dauerhaft löschen |

Die Erde trocknet mit `dryrate` % pro Minute aus (Standard 2 = in 50 min leer), Unkraut wächst mit `weedrate` % pro Minute (Standard 1) — **ab dem ersten Ereignis und auch, während du offline bist**: nach einer Nacht ist der Garten trocken und verwildert, der Chat muss beim Streamstart erst gießen und zupfen. Unter 30 % Wasser lassen die Blumen die Köpfe hängen und das Gras wird gelb. Wer das nicht will, stellt `dryrate=0` und `weedrate=0`. Weitere Parameter: `meadow`, `petals`, `bugs` (`1`/`0`), `branch` (`left`/`right`/`off`), `colors` (`bright`/`pastel`/`cherry`/`theme`), `waterpct` (10), `rainrate` (30), `pullneed` (3), `pullwin` (20). Testtasten: **C** **F** **R** **W** **P** **B** **L**.

**Sommer** — Sonne mit Sonnenbrille, Strand mit Sandburgen und Sonnenschirm, Hitzeflimmern, abends Glühwürmchen.

| Ereignis / Befehl | Wirkung |
|-------------------|---------|
| Follow: `cmd=castle&name=%user%` | Sandburg mit Fahne (sichtbar die neuesten 24) |
| `cmd=celebrate&name=%user%` | Wasserball hüpft über den Strand, Konfetti, „Thank you, …!“ |
| `!sun` → `cmd=heattoggle` | Hitzewelle an/aus: Hitze steigt um `heatrate` % pro Minute — Sonne wird größer, das Bild wärmer, ab 15 % flimmert die Luft |
| `!splash` → `cmd=splash&name=%user%` | Wasserfontäne, −`splash` % Hitze, zählt für „Top coolers“ |
| `!ice` → `cmd=ice&name=%user%` | Eis im Sand, schmilzt in 40 s (kühl) bis 12 s (volle Hitze) — nur Show |
| `cmd=leaders` / `cmd=cool` / `cmd=clear&kind=heat\|castles` | Rangliste / alles abkühlen (Rangliste bleibt) / Hitze + Rangliste bzw. Sandburgen dauerhaft löschen |

Parameter: `sun`, `beach`, `umbrella`, `shimmer` (`1`/`0`), `sunpos` (`left`/`right`), `evening` (`1` = Abend mit Glühwürmchen), `heatrate` (20), `splash` (5). Testtasten: **C** **B** **H** **S** **I** **L**.

#### Wetter-Sound über Streamer.bot (WAV)

Fällt unter Windows das Audiogerät kurz weg, öffnet die OBS-Browser-Source ihre Tonausgabe nicht neu und bleibt stumm. Deshalb hat die Weather-Source keinen eigenen Ton; Streamer.bot spielt fertige WAVs:

| Datei | Inhalt | Einsatz |
|-------|--------|---------|
| `assets/effects/rain-loop-light.wav` | 20 s Nieselregen, nahtlos | OBS **Media Source** mit „Loop“ |
| `assets/effects/rain-loop-medium.wav` | 20 s Regen, nahtlos | OBS **Media Source** mit „Loop“ |
| `assets/effects/rain-loop-storm.wav` | 20 s Sturmregen mit Wind, nahtlos | OBS **Media Source** mit „Loop“ |
| `assets/effects/wind-loop-light.wav` | 20 s leichter, schwankender Wind, nahtlos | OBS **Media Source** mit „Loop“ |
| `assets/effects/wind-loop-strong.wav` | 20 s starker, schwankender Wind, nahtlos | OBS **Media Source** mit „Loop“ |
| `assets/effects/wind-gust.wav` | einzelne Böe (~3 s) | Streamer.bot **Play Sound** zusammen mit `cmd=gust` |
| `assets/effects/thunder-near-1.wav`, `-2` | naher Einschlag mit Knall, ~0,5 s Verzögerung eingebaut | Streamer.bot **Play Sound** zusammen mit `cmd=strike&dist=near` |
| `assets/effects/thunder-far-1.wav`, `-2` | fernes Grollen, ~2–2,6 s Verzögerung eingebaut | Streamer.bot **Play Sound** zusammen mit `cmd=strike&dist=far` |

Die Verzögerung zwischen Blitz und Donner steckt schon in der WAV (Stille am Anfang) — Fetch URL und Play Sound also gleichzeitig auslösen. Regen-Loop: eigene Media Source pro Stärke, per Streamer.bot sichtbar/unsichtbar schalten (z. B. `!storm` → Storm-Loop an, Medium aus). Download über `https://stream-overlay.com/s/<token>/assets/effects/<datei>.wav`.

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

### Der `range`-Parameter

Alle Zeitraum-Endpoints kennen genau vier Werte:

| Wert | Zeitraum |
|---|---|
| `session` | seit Session-Start (automatisch erkannt oder per `sessionStartedAt` gesetzt) |
| `day` | seit heute 00:00 UTC |
| `week` | letzte 7 Tage |
| `all` | alles |

Alles andere wird mit **HTTP 400** `range must be session|day|week|all`
abgelehnt. Das ist wichtiger, als es klingt: Intern faellt ein
unbekannter Wert auf den Stichtag 1970 zurueck — ein Tippfehler wie
`range=month` haette also nicht etwa nichts geliefert, sondern
**alles**, ohne dass es jemandem auffaellt.

Ein paar Endpoints nehmen zusaetzlich `from=`/`to=` als ISO-Zeitstempel;
wo beides gesetzt ist, gewinnt `from`/`to`.

### Setup

1. **API-Key** unter [developer.pubg.com](https://developer.pubg.com) holen (kostenlos, 10 RPM Default).
2. Key unter **`/app/settings` → PUBG API key** eintragen. Er wird
   verschlüsselt in der DB gespeichert (`tenant_credentials`); `.secrets`
   wird dafür nur noch beim einmaligen Admin-Seed (`core/seed_admin.py`)
   gelesen. Beim Speichern wird der Key geprüft — Format (`eyJ…`, JWT) und
   ein Live-Aufruf; ein Steam-Key im PUBG-Feld oder ein abgelehnter Key wird
   mit Hinweis abgewiesen, und es wird **nichts** gespeichert.
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

### Mehrere Accounts

Unter **Settings → PUBG-Accounts** lassen sich beliebig viele eigene In-game-Namen
hinterlegen. Alle werden gepollt; einer davon ist der **primäre** und die
Standardquelle für Widgets ohne `account`-Parameter.

Der Poller löst sämtliche Accounts in **einem** `/players`-Request auf (PUBG erlaubt
10 Namen je Filter) — zusätzliche Accounts kosten also keinen weiteren Request des
10-RPM-Budgets. Match-Details und Telemetrie sind bei PUBG ohnehin limitfrei; ein
gemeinsam gespieltes Match wird nur einmal geladen.

| Parameter | Wirkung |
|---|---|
| `?account=<name>` | Widget zeigt diesen Account (gilt für alle PUBG-Widgets) |
| `?account=<accountId>` | dasselbe, über die PUBG-Account-ID |
| `?account=all` | Summe über alle Accounts — `api/pubg/session` und die Report-Routen (siehe unten) |

**Ein Spieler, mehrere Steam-Accounts.** Die eigenen Accounts sind derselbe Mensch.
Der Session-Report zählt deshalb ohne `account`-Parameter **alle** Accounts als „ich“:
Matches, Phasen, Match-Detail, Lobby, Top Speed, Fahrzeuge, Landungen, Hot Drop,
Payday und Achievements. Je Match spielt man nur mit einem Account. Dort steht der
Name, mit dem gespielt wurde, und der Zweit-Account erscheint nie als Mitspieler.
Verknüpft wird über die Account-ID, nicht über den Namen. Mit `?account=<name>`
zeigt der Report weiterhin nur einen Account.

Auch als **Mitspieler** zählt so ein Spieler einmal. Ist ein Account bei irgendeinem
Tenant zusammen mit weiteren hinterlegt, rechnet `co-player` die gemeinsamen Matches
über alle diese Accounts: seine K/D mit dir, deine K/D mit ihm, Wins, Rauswürfe aus
Fahrzeugen und gleiche Lobby. Lifetime und Season bleiben beim gesuchten Account.
Die übrigen Widgets folgen schrittweise.

`account=all` addiert Matches, Kills, Damage, Wins und die übrigen additiven Werte;
K/D, Kills/Match und Kopftreffer-Quote werden aus den Summen neu berechnet (nicht
gemittelt). **Season-Rang und RP lassen sich nicht summieren** — sie gehören zu genau
einem Account und tauchen in der Summenansicht nicht auf.

Neue Accounts liefern nur Matches der letzten **14 Tage** — ältere gibt die PUBG-API
nicht mehr heraus, lediglich Season-Aggregate reichen weiter zurück.

### Browser-Source-Komponenten

Alle URLs unter `http://localhost:8080/widgets/pubg/<datei>.html`.

| Datei | Zweck | URL-Parameter |
|---|---|---|
| `live-bar.html` | Slim-Counter Gameplay | `stats` (Werte + Reihenfolge, z.B. `kills,kd,dmg,wins,top10,matches`; Default `kills,dmg,wins,matches`; möglich: `kills dmg wins matches kd kpm hs top10 best longest assists knocks heals boosts healed` — `healed` = geheilte HP aus den Heal-Events der Telemetrie; im Konfigurator `/app/urls` per Drag & Drop, Alt+Pfeiltasten oder Pfeil-Buttons sortierbar), `refreshMs` |
| `flyout-full.html` | Großes Detail-Panel mit Filter-Slider und Reset-Button | — |
| `mates.html` | Squad-Mates der Range | `layout=carousel\|stack\|fold\|mosaic`, `range=session\|week` |
| `top-mates.html` | Top-5-Liste | `sortBy=avgPlace\|kd\|winRate\|mostPlayed`, `limit`, `minMatches` |
| `post-match-card.html` | 10s-Pop-up nach Match-Ende | `durationMs` |
| `map-distribution.html` | Map-Häufigkeits-Bars | `range=session\|day\|week\|all` — nur BR-Karten, ohne Camp Jackal und Safe House |
| `first-fight.html` | Survival-% mit Sparkline | `range` |
| `session-summary.html` | Vollformat Stream-Ending | `hideMaps=1`, `hideMates=1` |
| `session-report.html` | After-Session-Report mit Phasen, Match-Liste und Match-Detail | `from`, `to` (ISO, sonst laufende Session) |
| `career-card.html` | Lifetime-Anzeige | `player`, `mode=all\|squad-fpp\|...` |
| `performance-history.html` | K/D-Verlauf pro Session / Tag / Monat | `groupBy=session\|day\|month`, `metric`, `limit`, `player` |
| `news-ticker.html` | Marquee-Bar mit rotierenden Snippets (Session-Stats, Maps, Mates, Hot Drops, Achievements, Top Speed der Session + in dieser Session gebrochene Tempo-Rekorde je Fahrzeug-Gruppe) | `rotateMs`, `focus=session\|lifetime\|mix` |
| `squad-compare.html` | Vergleich über die letzten **gemeinsamen** Squad-Matches | `players=A,B,C,D`, `matches` |
| `chat-stats-popup.html` | Streamer.bot-driven Pop-up | `player`, `duration` (Sek) |
| `milestone-celebrate.html` | Vollbild-Feier bei jedem 100. Career-Win | `n`, `wait`, `force`, `mute` |
| `weapon-milestone.html` | Vollbild-Feier für Waffen- und Karriere-Meilensteine | `wait`, `poll`, `tag=plain\|ghost`, `design=b\|d`, `demo=<anlass>\|1\|all`, `value`, `subject` |
| `weapon-milestone-bar.html` | Dieselben Meilensteine als Leiste am Bildrand | `wait`, `poll`, `pos=bottom\|top`, `confetti=0`, `demo=<anlass>\|1\|all`, `value`, `subject` |

Cross-Player-Web-View: `http://localhost:8080/widgets/pubg/coplayer.html?player=NAME`
(alte URL `overlays/stats.html?player=NAME` leitet weiter)

`/api/pubg/co-player/NAME` liefert zusätzlich `together` (gemeinsame Matches, 0 bei unbekanntem Namen oder ohne gemeinsames Spiel). Streamer.bot prüft das bei `!coplayer`, bevor es die Karte zeigt; ohne Namen antwortet der Bot mit einer kurzen Anleitung.

**Fremdsicht (`?asTenant=`)**: Admins können jedes Tool und Widget in der Sicht eines
anderen Tenants öffnen — `?asTenant=2` oder `?asTenant=<slug>`. Der Parameter wird von
`_pubg.js` an alle API-Calls angehängt. Datei-servierte Tools bekommen dabei ein
Banner „Viewing as … (Tenant #N)" mit Rücksprung-Link (die Dashboard-Seiten haben es
über `base.html` schon); der Link behält alle übrigen Query-Parameter. Damit das
Banner auch auf Seiten mit eigenem `body`-Padding randlos oben sitzt, läuft es
über `100vw` + `overflow-x: clip`.

Voraussetzung für die Fremdsicht: die Seite muss ihre API-Calls über
`PubgUI.fetchJson` schicken — nur dort wird `asTenant` angehängt. Ein roher
`fetch()` landet stumm im eigenen Tenant.

Widgets über ihre Token-URL (`/s/<token>/widgets/…?asTenant=3`) zeigen die
Fremdsicht nur, wenn der Browser einen **Admin-Login** mitschickt — also im
selben Browser, in dem man auf stream-overlay.com eingeloggt ist. Ohne Login
(OBS-Browser-Source), mit Nicht-Admin-Login oder bei unbekanntem Tenant gilt
weiter allein der Tenant des Tokens; im Stream erscheint deshalb nie ein Banner.

#### Anlass „Hardest Lobby"

`career_hardest_lobby` feiert eine Lobby, die härter war als jede zuvor —
gemessen an der **Karriere-K/D der Mitspieler**, nicht an der Todesrate der
Runde. Quelle ist `pubg/lobby_kd.py`, dieselbe Zahl, die der Session-Report je
Match zeigt.

Eine eigene Rechnung wäre falsch und war es auch: das Modul nimmt den
**modusspezifischen** Wert mit einer Fallback-Kette (gleicher Modus → gleiche
Perspektive → Season → Lifetime). Wer stattdessen über alle Modi und Seasons
summiert, landet deutlich zu niedrig — 1,83 statt 2,46 als Bestwert.

Drei Fallstricke, alle im Code festgehalten:

* **Untergrenze 1,8.** Der Median liegt bei 1,35; darunter ist jede Runde
  gewöhnlich. Bei 2,0 wäre der bisherige Bestwert von 2,46 knapp über der
  Schwelle und der Anlass praktisch tot.
* **Beim ersten Mal werden alle Matches gerechnet**, danach nur die jüngsten
  25 (`LOBBY_RECORD_WINDOW`). Wer immer nur das Fenster ansieht, hält das
  Maximum der letzten Woche für den Alltime-Rekord und feiert beim nächsten
  guten Match einen Rekord, der keiner ist.
* **`counts_for_average` filtert mit**: mindestens 20 Spieler und 25 %
  Abdeckung. Ohne das gewinnt eine Arcade-Runde mit vier Spielern und K/D 8,3.
  Achtung, `coverage` ist ein **Prozentwert**, kein Anteil.

Die Kennzahl trägt zwei Dezimalstellen (`decimals: 2`) — auf eine ganze Zahl
gerundet wäre aus 2,46 eine 2 und damit keine Nachricht mehr. Der
Meilenstein-Schlüssel behält sie ebenfalls, sonst gälten 2,46 und 2,44 als
derselbe Meilenstein.

**Die Feier zeigt die Verteilung, nicht nur den Schnitt**: Top-5-Ø, Median,
Bottom-5-Ø und die K/D des eigenen Squads. Fehlt der Squad-Wert — solo
unterwegs, oder kein Mitspieler mit bekannter K/D —, rückt der härteste Gegner
mit Namen nach. Eine **0,00 wäre dort falsch**: sie hieße „Squad mit K/D 0"
statt „kein Squad". Erst beide Ränder trennen „fünf Haie
oben, fünf Anfänger unten" von einem durchgehend starken Feld — der Mittelwert
ist in beiden Fällen derselbe.

Diese Zahlen kommen aus **`lobby_detail`**, derselben Funktion, hinter der im
Report das Lobby-Modal hängt; nachgebaut wäre doppelt und würde abweichen. Sie
werden **im Moment des Rekords** in der Spalte `extra` festgehalten: später
geholt wären es andere Werte, weil die Karriere-K/D der Mitspieler weiterläuft.

Stand: Bestwert **2,46** (03.05., Rondo, 80 von 80 Spielern bekannt), eigene
K/D 1,66 — in 11 % der Matches war die Lobby stärker.

#### Waffennamen: deutscher Schlüssel, englische Anzeige

`WEAPON_NAMES` in `pubg/aggregations.py` ist **deutsch gepflegt und ist der
Datenschlüssel** — die Werte stehen so in `match_weapon_stats.weapon`. Daran
wird nichts geändert; eine Umbenennung hieße migrieren (siehe oben, 51.553
Zeilen).

Übersetzt wird deshalb **erst beim Ausliefern**, über `weapon_display(name)`
und `weapon_name_en(roh_id)`. Ohne diese Schicht stand in der durchgehend
englischen Oberfläche „Rauchbombe", „Blendgranate", „Blauzonen-Granate" und
„Pfanne (Wurf)". Betroffen waren zwei Anzeige-Pfade — `thrown[].weapon` im
Shot-Quality-Tool und `weaponName` im Match-Detail. `_weapon_label` selbst
übersetzt **nicht**, weil sein Rückgabewert der DB-Schlüssel ist.

Prüfen lässt sich das nur live: die deutschen Namen stehen an vielen Stellen
auch als Objekt*schlüssel* im JSON, was kein Anzeigefehler ist. Ein reiner
Textvergleich meldet deshalb falsche Treffer — es braucht den Abgleich der
JSON-Pfade.

#### Visiere, Leuchtpistole, Airdrops (Stand 2026-09-11)

**Visier-Sektion im Shot-Quality-Tool.** Quelle ist `attachments` bei
Kill-Ereignissen — die Telemetrie legt dort die komplette Aufsatzliste ab,
184.847 Zeilen lagen dafür ungenutzt in der Datenbank.

Die internen Namen täuschen, und das ist die eigentliche Falle:
**`CQBSS` ist das 8×**, nicht das 4× — das heißt `ACOG_01`. Das 15× läuft als
`PM2_01`, das 2× als `Aimpoint`. Ein `Scope4x` oder `Scope8x` existiert
**nicht**; wer darauf filtert, verliert beide und beschriftet das 8× als 4×.
Die Zuordnung steht als `SCOPES` in `pubg/shot_quality.py`, ein Test hält jeden
einzelnen Namen fest.

Gemessen am eigenen Konto: Red Dot 782 Kills auf Ø 25 m, 8× 199 auf Ø 161 m
(27,6 % davon jenseits 200 m), 4× 123 auf Ø 117 m, 15× nur 5. „Ohne Visier"
meint Kimme und Korn und ist nicht dasselbe wie fehlende Daten — die stehen
getrennt als Hinweis.

**Drei neue Anlässe.** `flare_gun` (selten, mit der Waffe aus dem gerufenen
Paket im Label), `airdrop_looted` und `career_suicides` („Own Goals", alle 25).
Die Leuchtpistole sucht das Paket im Zeitfenster von zwei Minuten nach dem
Schuss — ohne das wäre jedes Paket des Matches ein Kandidat.

**Airdrop-Sektion im Match-Analysis-Tool**: welches Paket fiel, was lag drin,
wer war dran. Dafür liest der Import jetzt drei bisher verworfene Log-Typen
mit (`LogCarePackageLand`, `LogItemPickupFromCarepackage`,
`LogPlayerUseFlareGun`). Das Tool selbst arbeitet ohnehin auf der
Rohtelemetrie und kommt daher **auch für alte Matches** an die Zahlen; die
Achievements brauchen neue Matches.

**Zugeordnet wird über die Position**, nicht über eine Paket-Id:
`carePackageUniqueId` steht in den gemessenen Daten auf 0 oder 1, nicht je
Paket verschieden. Der Pakettyp allein ist zu grob — ein Match hatte 44
Landungen bei einer Handvoll Typen, wodurch jede Entnahme an drei Pakete
gleichzeitig gezählt wurde. Wer ein Paket ausräumt, steht daran: die
gemessenen Abstände liegen bei einem bis zwei Metern, die Toleranz bei 50 m.

Als „erwähnenswert" gelten nicht nur die Drop-Waffen, sondern auch Level-3-
Ausrüstung und die großen Visiere — sonst stand bei einem Paket mit Weste Lv3
und 8×-Visier „nichts Besonderes", obwohl das der häufigste Inhalt überhaupt
ist und der Grund, warum Leute hinlaufen.

#### Red Zone: drei Achievements (Stand 2026-09-11)

Von der Zonen-Bombardierung erwischt zu werden ist jetzt ein Highlight — in
drei getrennten Fällen, weil sie sich deutlich unterscheiden:

| ID | Label | wann | rare |
|---|---|---|---|
| `redzone_vehicle_death` | Bombed While Driving | im Fahrzeug erwischt | ja |
| `redzone_death` | Red Zone Victim | zu Fuß **getötet** | ja |
| `redzone_knock` | Red Zone Shockwave | zu Fuß niedergestreckt | nein |

Jeder Treffer zählt in genau einen der drei — zwei Meldungen für dasselbe
Ereignis wären Lärm. Im Fahrzeug wird nicht weiter nach Kill und Knock
getrennt: dort ist das Fahren der Anlass, und man sieht die Bombardierung zu
spät, um noch auszusteigen.

**`redzone_death` war jahrelang blind.** Die Bedingung lautete nur
`event_type='Kill'`, und die Red Zone erzeugt in den Daten **ausschließlich
Knocks** — 74 Ereignisse über alle Tenants, kein einziger Kill. Das Achievement
war vollständig registriert (Label, Priorität, Icon-Platzhalter) und konnte
trotzdem nie auslösen.

**Zweiter Fehler, zweimal an verschiedenen Stellen:** das Waffen-Muster
`LIKE '%Bomb%'` fing auch `Bluezonebomb_EffectActor_C` ein — die *geworfene*
Blauzonen-Granate, die mit der Zonen-Bombardierung nichts zu tun hat (siehe
oben). In der Todesursachen-Zuordnung des Match-Details stand sie sogar
namentlich als `kill_redzone`, während die echte Bombardierung
(`RedZoneBombingField_*`) im Waffen-Fallback gar nicht vorkam. Als
Umgebungstod gezählt verlor die Granate außerdem ihren Verursacher.

Icons: `widgets/pubg/assets/achievements/redzone_*.png` (seit 2026-10-28).

#### Luft-Kills und Kimme und Korn (Stand 2026-10-28)

Fünf seltene Achievements, alle unter 1 % der Matches je Tenant und deshalb
auch in der Sektion „Special Achievements" des Session-Reports:

| ID | Label | wann |
|---|---|---|
| `skeet_shooter` | Skeet Shooter | Opfer noch am Fallschirm getroffen (Knock oder Kill) |
| `glider_down` | Glider Down | Opfer saß im Motorgleiter |
| `welcome_committee` | Welcome Committee | Treffer bis 3 s nach der Landung des Opfers |
| `iron_sights_100` | Iron Sights | Kill ab 100 m ohne Visier-Aufsatz |
| `iron_sights_200` | Iron Sights | Kill ab 200 m ohne Visier-Aufsatz (ersetzt die 100er) |

Das Label nennt Waffe und Distanz, bei Skeet Shooter auch die Höhe über
Grund, wenn sie deutlich ist: „Skeet Shooter · Kar98k · 204 m · 22 m up".

**Wie „in der Luft" erkannt wird.** Die Telemetrie hat keinen Luft-Zustand.
Wird jemand am Fallschirm getroffen, beendet das Spiel den Flug und schreibt
dafür ein `LogParachuteLanding` 0–20 ms vor dem Knock. Maßgeblich ist nur die
**erste** Landung nach dem Verlassen von Flugzeug, Redeploy-Flugzeug oder
Emergency Pickup: dasselbe Event feuert auch bei Knocks am Boden, bis zu
sechsmal je Spieler und Match. Über alle Daten gemessen: 148 Treffer 0–20 ms
nach der ersten Landung, 685 bis 3 s danach, 561.196 später. Die Höhe über
Grund ist der Median der Landungen anderer Spieler im 150-m-Umkreis — grob,
Dach oder Straße machen schnell 10 m aus, deshalb nur Anzeige, keine Bedingung.

Im Emergency Pickup getroffen bleibt **Sky Snipe** (`em_pickup_kill`).

**Iron Sights** nutzt die Aufsätze der Killerwaffe (`killerDamageInfo.
additionalInfo`): kein `Upper_`-Teil = kein Rotpunkt, Holo oder Zielfernrohr.
Ein echter No-Scope (aus der Hüfte) ist nicht erkennbar — ob anvisiert wurde,
steht nicht in der Telemetrie. Ausgenommen: Waffen mit eingebautem Visier
(VSS) und Knocks, die keine Aufsätze tragen.

Je Opfer zählt ein Anlass nur einmal; die Erkennung läuft in einem eigenen
`try`-Block je Match. Icons: `widgets/pubg/assets/achievements/<id>.png`,
im selben Medaillon-Stil wie die übrigen (Goldring, Lila/Orange, gemalt).

#### Wurfgeräte: vier fehlende Mappings (Stand 2026-09-11)

Vier Wurfgeräte tragen `Item_Weapon_`-Präfix statt `Proj` und fehlten
deshalb in `WEAPON_NAMES`. Folge: Klasse „other", `is_thrown = false`, und
sie tauchten in **keiner** Wurf-Wertung auf — obwohl die Rauchbombe mit
1.560 Würfen das meistgeworfene Gerät überhaupt ist.

| rohe Id | Name | Zeilen (alle Tenants) |
|---|---|---|
| `Item_Weapon_SmokeBomb_C` | Rauchbombe | 30.179 |
| `Item_Weapon_FlashBang_C` | Blendgranate | 14.266 |
| `Item_Weapon_BluezoneGrenade_C` | Blauzonen-Granate | 6.155 |
| `Item_Weapon_StunGun_C` | Taser | 677 |

**Die Blauzonen-Granate war zweifach falsch.** Unter ihrem eigenen Namen
stehen nur die Würfe; Schaden und Tötung laufen über den Effekt-Aktor
`Bluezonebomb_EffectActor_C`, und der war als **„Red Zone"** beschriftet.
Eigene Granaten-Kills landeten damit in der Umgebungs-Spalte statt bei der
Waffe — 302 Kills bei null Würfen in derselben Zeile. Das ist dieselbe
Trennung wie beim Molotov, wo das Feuer tötet und nicht der Aufschlag, und
wird mit demselben Mittel gelöst: einem Alias in `_WEAPON_ALIASES`.

Dass es Granaten-Kills sein *müssen*, folgt aus der Spielmechanik: die echte
Red Zone (`RedZoneBombingField_*`) schreibt niemandem einen Kill zu und
steht gar nicht in `match_weapon_stats`.

**`is_thrown` war zusätzlich in 67.712 Zeilen falsch** — die Spalte wurde
erst ab August 2026 mitgeschrieben, obwohl ihr Wert eine reine Funktion des
Waffennamens ist (`class_of_weapon_name(...) == "throwable"`).

Korrigiert wird das mit `scripts/remap_throwables.py --apply`. Es **legt
zusammen statt umzubenennen**: ein Match hat oft beide Zeilen (Würfe unter
`BluezoneGrenade`, Kills unter `Red Zone`), ein reines `UPDATE` liefe in den
Primärschlüssel. Ein Re-Backfill wäre der sauberere Weg — `upsert_weapon_stats`
ersetzt den kompletten Satz eines Matches —, erreicht aber nur Matches mit
vorliegender Telemetrie; die Lobby-Referenz umfasst 23.000 Spieler, deren
Zeilen über Monate gewachsen sind.

#### Meilenstein-Feiern (Waffen und Karriere)

Zwei Browser-Sources feiern erreichte Marken, eingestellt wird das im Tool
**Milestone Celebrations** (`/app/tools/milestones`):

* `weapon-milestone.html` — Vollbild, für seltene Anlässe. Bei einem als
  `huge` gemeldeten Meilenstein schaltet es auf die große Fassung um:
  Größenordnung statt Zählerstand („2.5 M"), die Zahl in Worten, Lichtring
  und ein zweiter Konfetti-Burst.
* `weapon-milestone-bar.html` — eine Leiste am Bildrand, für Anlässe die oft
  fallen. Ein Vollbild-Overlay bei jedem 25.000er Waffenschaden würde den
  Stream zudecken.

Beide fragen `/api/pubg/milestone-pending?widget=big|bar` und führen **je
einen eigenen Anzeige-Marker**. Deshalb können beide gleichzeitig laufen,
ohne sich Anlässe wegzunehmen; welcher Anlass wohin geht (`big`, `bar` oder
`both`), steht in der Konfiguration.

**Drei Datenquellen, je nach Anlass:**

| Quelle | was sie liefert | Reichweite |
|---|---|---|
| `weapon_mastery` (API) | Schaden, Kills, Kopftreffer, weiteste Tötung, Match-Kill-Rekord und Level je Waffe | ganze Karriere |
| `seasons/lifetime` (API) | kontoweite Summen über **alle** Modi, plus Strecke, Zeit, Heilung und die Karriere-Rekorde | ganze Karriere |
| `match_weapon_stats` (DB) | Match-Schadensrekord je Waffe und Wurfzahlen je Wurfgerät | ab Beginn der Aufzeichnung |

**Tempo-Rekord je Fahrzeug-Gruppe** (`vehicle_top_speed`, seit 2026-10-28):
gefeiert wird, wenn du **deinen eigenen** Bestwert in einer Gruppe schlägst (am
Steuer, ab 100 km/h). Die Feier nennt das konkrete Fahrzeug („Coupe RB ·
Porsche 911"), die Karte und — nur als Info — den Lobby-Bestwert der Gruppe.

Gruppen = Basisfahrzeug plus die Skins, die daraus entstehen
(`aggregations.FAHRZEUG_GRUPPEN`). Ein Skin ändert laut PUBG nur das Aussehen,
HP, Tempo und Fahrverhalten bleiben die der Basis (pubg.com/news/6546):

| Gruppe | Basis | Skins |
|---|---|---|
| Coupe RB | Coupe RB | Porsche 911, Aston Vantage, Bugatti Chiron, Lambo Countach, McLaren GT, Bentley Continental GTC |
| Sedan | Dacia, Mirado | Sedan 01/02, Porsche Panamera, Bentley Flying Spur |
| SUV | UAZ (Erangel, Taego), Niva/Zima (Vikendi), Pickup (Miramar, Deston), Blanc (Rondo) | Porsche Cayenne, Aston DBX, Lambo Urus, Classic Car |
| Motorbike | Motorrad | Ducati Panigale, Harley Road Glide, FBR Bike, El Solitario |

Alles andere (Rony, Buggy, Pony Coupe, …) ist eine eigene Gruppe. Belegt über
die Umwandlung in den Daten: wo ein Skin zum ersten Mal bestiegen wird, ist kurz
davor an derselben Stelle jemand aus dem Basisfahrzeug gestiegen. Die
Telemetrie selbst nennt die Basis nirgends — weder ein Feld noch ein Event.
Die frühere Zuordnung „Sedan 01 = Dacia, Sedan 02 = Mirado" war aus dem Tempo
geschlossen und falsch; beide entstehen überwiegend aus dem Dacia.

Im Report zeigt die Tempo-Box je Gruppe den besten Wert, darunter aufklappbar
jede Variante mit eigenem Wert und dem Lobby-Wert — alle Gruppen, nicht nur
die ersten sechs. Der frühere Gesamt-Rekord
(`career_top_speed`) ist standardmäßig aus, sonst feierte ein neuer Bestwert
zweimal; im Tool lässt er sich wieder einschalten.

Warum: seit `maxSpeed` (2026-10-26) kennt die Lobby-Wertung die echte Spitze
**jedes** Fahrers. Vorher stand das Tempo nur als Stichprobe an Events —
eigene Fahrten hatten im Schnitt 5,8 davon, fremde 2,1, deren Spitzen fehlten
also fast immer. Jetzt stehen dort 180+-Werte, fast alle Motorräder und
vermutlich mit Sprung oder bergab. Eigene Werte haben sich nicht verändert
(Stichprobe 163,7 gegen `maxSpeed` 163,4): wer lange auf Höchsttempo fährt,
wird von der Stichprobe gut getroffen.

Zwei Eigenheiten der API, die im Code festgehalten sind:

* Die **ingame sichtbare Zahl ist `OfficialStatsTotal` + `CompetitiveStatsTotal`**
  — am Konto belegt an der M416 (3156 + 23 = 3179) und der Mk12 (1962 + 11 =
  1973). Der dritte Block `StatsTotal` ist eine ältere, eigene Zählung und
  *keine* Teilmenge; er bleibt außen vor.
* **Level, Tier und XP sind drei Ebenen.** Das Level läuft innerhalb eines Tiers
  und endet bei 99 — danach steigt man ins nächste Tier auf und beginnt wieder
  bei 1. **Level 100 gibt es nur in Tier 6 („Master")**, weil dort kein Aufstieg
  mehr möglich ist. Ohne Tier heißt es ingame „Basic". Innerhalb eines Levels
  zählt das Spiel den Fortschritt zum nächsten mit (etwa „9.334/12.500" bei
  Level 70), und jedes Level hat seinen eigenen, mit dem Level wachsenden Bedarf.

  `LevelCurrent` zählt **ab null**: roh 99 ist ingame 100. Die Messwerte
  bestätigen das von der anderen Seite — rohe 99 kommt ausschließlich in Tier 6
  vor, in allen anderen Tiers ist 98 der Höchstwert.

* **`XPTotal` ist die XP im laufenden Tier**, nicht die der Laufbahn. Belegt
  daran, dass bei *gleichem Level dieselbe XP-Summe* steht, egal in welchem Tier:
  Level 13 kommt in Tier 2 und Tier 5 vor (40.259 gegen 42.337 XP), Level 60 in
  Tier 0 und Tier 5 (435.027 gegen 442.079). Ein voller Satz kostet **952.500 XP**
  — exakt der Wert, auf dem alle ausgelevelten Waffen sitzen, Streuung null.

  Gegenprobe über den XP-Verbrauch pro Kill, der nicht von der Waffe abhängen
  darf: mit dieser Rechnung streuen die Werte um Faktor 9, bei kumulativer XP um
  Faktor 72 (MP5K 202 gegen Vector 14.591 XP/Kill).

* **Das Level allein sagt deshalb nichts.** Eine Waffe in Tier 5 auf Level 14 ist
  weiter als eine in Tier 1 auf Level 98 — was die Kills bestätigen (1.344 gegen
  143). Zum Vergleichen gibt es `progress(tier, level)`. **Ausgelevelt ist
  `Tier == 6`**, nicht ein bestimmtes Level; darauf triggert `weapon_mastered`.
  Der Tier-Aufstieg ist ein eigener Anlass (`weapon_tier`), vorbelegt nur für die
  Leiste. Die Rangnamen zwischen Basic und Master sind nicht bekannt und werden
  als Zahl gezeigt.

Der Match-Schadensrekord kommt bewusst aus der eigenen Aufzeichnung: die API
führt `MostDamagePlayerInAGame` nur im alten Block und meldet dort 682 Schaden
für die M416, wo `match_weapon_stats` 976 belegt — ein Rekord-Celebrate darauf
löste an einer längst überbotenen Marke aus.

**Ein fehlender Vorwert ist keine Null.** Kommt eine Metrik im alten Stand gar
nicht vor — weil der Anlass neu ist oder seine Metrik gewechselt hat —, wird
sie übernommen und **nicht** gefeiert. Ohne diese Sperre holt jeder neue Anlass
den gesamten Bestand nach: `career_suicides` feierte 150 Selbsttode auf einmal,
und `weapon_mastered` meldete nach dem Wechsel von Level auf Tier sieben Waffen
gleichzeitig als frisch gemeistert. Die Rekord-Anlässe waren nie betroffen, weil
sie schon immer einen Vorwert über null verlangen — bei den Stufen fehlte das.

**Erkennung** läuft im Poller (`refresh_milestones`), aber nur nach neuen
Matches — die Mastery-Werte bewegen sich sonst nicht. Der **erste Lauf legt den
Ausgangsstand an und feiert nichts**, sonst wäre die ganze bisherige Karriere
auf einmal fällig. Erkannte Meilensteine landen in `pubg_milestones_seen`; der
Schlüssel trägt den Wert (`weapon_damage:M416:450000`), womit dieselbe Marke
nie zweimal gefeiert wird.

**Ohne Wartezeit ansehen**, auf zwei Wegen:

* **`?demo=<anlass>` an der Source** — z. B. `?demo=weapon_mastered`. Der Wert
  kommt aus dem letzten Stand, die gezeigte Marke ist also die, die wirklich
  als nächste fällt; bei Waffen-Anlässen wird die Waffe genommen, die ihrer
  nächsten Marke am nächsten ist. `?demo=1` nimmt den ersten Anlass, der zu
  dieser Fassung gehört, `?demo=all` spielt alle der Reihe nach durch.
  `?value=` und `?subject=` erzwingen Wert bzw. Waffe. Eine Vorschau wird
  **nicht eingereiht** und blockiert daher keinen echten Meilenstein — sie
  lässt sich beliebig wiederholen. In der Widget-Übersicht steht die
  Anlass-Liste als Auswahlfeld, direkt aus der Registry erzeugt.
* **„Preview" im Config-Tool** legt einen Probelauf in dieselbe
  Warteschlange, die auch der Poller benutzt — das testet den ganzen Weg
  einschließlich Marker und Quittierung, nicht nur die Darstellung; eine
  laufende Source greift ihn innerhalb eines Poll-Takts. Die Einstellungen
  gehen **aus dem Formular** mit, ohne gespeichert zu werden: eine geänderte
  Schrittweite lässt sich so ausprobieren, ohne sie festzuschreiben. Der
  Umschalter **„Preview at"** wählt den Wert — *Current value*, *Next mark*
  oder *Next loud one*; ohne die dritte Stufe bekäme man die große Fassung
  nie zu sehen, denn die nächste echte Marke ist fast immer eine
  gewöhnliche. Probeläufe sind über `is_test` getrennt und wegwerfbar.
  Oben an jeder Source-URL stehen **Copy** und **Preview** (letzteres
  öffnet sie mit `?demo=all`).

Die angezeigten Source-URLs tragen den Widget-Token (`/s/<token>/widgets/...`).
Ohne ihn antwortet die Widget-Route mit **404** — eine URL ohne Token sieht
richtig aus und ist unbrauchbar, deshalb reicht `_serve_tool` den Token als
`window.__WIDGET_TOKEN__` an Tools durch, die Source-URLs zum Kopieren zeigen.

Die Leiste ist gegenüber dem ersten Entwurf um ein Fünftel geschrumpft: mit
92-px-Ziffern brach sie bei „22,000 km" um — nicht wegen der Breite, sondern
am Leerzeichen vor der Einheit. Dagegen hilft `white-space: nowrap`; die
Staffelung nach Zeichenzahl greift erst ab zehn Zeichen.

**Am Ende wird ausgeblendet, nicht abgerissen.** Die Dauer steht als
`--ms-fade` im Stylesheet (1.200 ms im Vollbild, 600 ms in der Leiste, die nur
wenige Sekunden steht); das JS setzt lediglich `data-leaving` und wartet
dieselbe Spanne ab. So bleibt der Wert an einer Stelle und es braucht kein
`style`-Attribut — die bestehende Career-Wins-Feier löst dasselbe über
`style.setProperty`, was hier nicht erlaubt ist. Wer `prefers-reduced-motion`
gesetzt hat, bekommt kein Ausblenden: dann wäre die Bühne eine Sekunde reglos
sichtbar, was schlechter ist als ein sofortiges Ende.

#### Zwei Werte je Bedeutung: Fläche und Text

Die Tokens `--theme-accent`, `--theme-accent-2`, `--theme-ok`,
`--theme-danger`, `--theme-warn` und `--theme-primary` sind für **Flächen**
gewählt: Ränder, Balken, Füllungen. Als Textfarbe tragen sie in hellen Themes
nicht — `swiss` hat mit `accent: #4be39a` auf Weiß einen Kontrast von 1,37,
und ein knalliger Akzent lässt sich in einem hellen Theme nicht lesbar machen,
ohne seinen Charakter zu verlieren.

Darum hat jedes dieser Tokens eine **`-text`-Variante**:

```css
.foo  { color: var(--theme-accent-text); }   /* Text auf der Karte  */
.bar  { border-color: var(--theme-accent); } /* Fläche, Rand, Balken */
```

Wo beide gleich taugen — alle dunklen Themes — fällt die Text-Variante per
Default in `themes/_alias.css` auf den Basiswert zurück; dort gibt es keinen
Unterschied zu pflegen. Eigene Werte haben nur `barrier`, `editorial`,
`oldcamp`, `sect` und `swiss`, zusammen 20 Definitionen.

**Regel für neuen Code:** `color:` nimmt die `-text`-Form, alles andere den
Basiswert. `scripts/check_contrast.py` meldet jeden Verstoß, auch wenn der
Kontrast im aktuellen Theme zufällig reicht — sonst kippt es beim nächsten
hellen Theme.

Ausnahme sind Regeln, die ihren **eigenen** Hintergrund einfärben: dort gehört
`--theme-on-primary` hin, nicht die Text-Variante. `color-mix(… 15%,
var(--theme-surface))` zählt dabei nicht als eigener Grund — das ist eine
leicht getönte Karte.

`--theme-text-faint` ist dagegen von Haus aus eine Textfarbe und wurde direkt
angehoben: sie lag in allen acht Themes unter 4,5 (2,46 bis 3,69).

#### Kontrast prüfen (scripts/check_contrast.py)

```
python3 scripts/check_contrast.py [--min 4.5] [--all] [pfad …]
```

Rechnet jede `color:`-Deklaration in `widgets/`, `tools/` und `app/static/`
gegen **alle zehn Themes** und meldet, was unter WCAG 1.4.3 fällt. Die Fehler
tauchen nicht beim Schreiben auf, sondern erst wenn jemand ein helles Theme
wählt: ein festes Hell-Grün sieht auf dem dunklen Standard gut aus und ist auf
`editorial` mit Kontrast 1,5 unsichtbar. Niemand testet acht Themes von Hand.

Der Check liest den **eigenen Hintergrund derselben Regel** — ein Badge, das
`background: var(--theme-primary)` setzt, wird gegen primary geprüft, nicht
gegen die Karte. Durchscheinende Gründe (`transparent`, `color-mix(… 10%,
transparent)`, `rgba(…, 0.1)`) gelten als „Fläche darunter": ohne diese
Unterscheidung meldet der Check jeden korrekten Akzent-Knopf als Fehler — bei
der ersten Fassung waren es 933 Treffer, davon der Großteil falsch.

#### Lobby-Modal: Zeitraum statt Match-IDs

`/api/pubg/lobby-detail` nimmt zwei Wege:

* `matches=id1,id2` — für eine einzelne Zelle oder eine Phase, begrenzt auf
  250 IDs, weil sie in der URL stehen.
* `from=`/`to=` (ISO) — für einen Zeitraum. Der Server sucht die Matches
  selbst (BR-Modi, dieser Tenant), die URL bleibt kurz und **es wird nicht
  gekürzt**.

Der zweite Weg entstand aus einem Widerspruch: der Report zeigte für 30 Tage
einen Top-5-Schnitt von 14,10, das Modal daneben 11,28. Die Rechnung war
identisch (`phase_top5` und `totals.topAvg` liefern denselben Wert), nur die
Menge nicht — gekürzt wurde an **zwei** Stellen, im Frontend mit
`slice(0, 60)` und im Endpoint mit `[:60]`, und die Kopfzeile schrieb dazu
die ungekürzte Zahl.

Gemessen: 60 IDs ergeben 11,28, 120 ergeben 11,50, alle 220 ergeben 14,10. Der
Grund für die Grenze war nicht die Laufzeit (220 Matches rechnen in 1,1 s),
sondern die URL-Länge — eine Match-ID ist 37 Zeichen, 1134 wären 41 KB.

Der Endpoint liefert `matchesRequested`, `matchesUsed` und `byRange`, damit
eine Kürzung nie unbemerkt bleibt. Die Phasen-Buttons nutzen weiter ID-Listen
(eine Phase hat selten mehr als 250 Matches) und weisen eine Kürzung in der
Kopfzeile aus.

#### Auswahl im session-report

Zeitraum und Session stehen in **einer Leiste**, mit demselben `switch`-Element
wie in `shot-quality` und `landing-spots`:

```
Range     [Current][Today][7 days][30 days][All][Custom…]
Session   ◀  Sat 06 Sep 21:14 · 19 matches · 3 W  ▾  ▶     89 sessions
Squad K/D [After match][Before match]
```

**Squad K/D** wählt, welcher eingefrorene K/D-Stand je Match gilt: *After
match* (Standard) rechnet das Match selbst mit ein, *Before match* zeigt, wie
stark jemand in die Runde ging. Gilt für Match-Zeile, Team-Kacheln, Lobby-Modal
und Match-Detail; die Wahl merkt sich der Browser. Die API nimmt dafür
`?kd=before` an `session-report`, `lobby-detail`, `lobby-kd` und
`match-detail` — ohne Parameter gilt *after*. Gespeichert werden beide Stände
in `match_player_kd` (`kd` / `kd_nach`); alte Einträge ohne Nach-Stand fallen
auf den Vor-Stand zurück. Nachfüllen: `python -m pubg.cli kd-backfill --all
--neu-ab 2026-01-01`.

**Phasen** trennt der Report, wenn der Stamm-Squad wechselt, zwischen Battle
Royale und Event, zwischen Ranked und Normal — und zwischen Solo, Duo und
Squad, auch mit demselben Mate.

**Timelog im Match-Detail:** „killed" heißt direkter Kill ohne Knock,
„finished" erledigt einen Knock (eigenen oder vom Mate), „stole the knock"
holt sich den Knock eines anderen Teams — auch wenn dabei weder Täter noch
Opfer zum Squad gehören. Redeploys (Bluechip, Comeback) zählen: ein
zurückgeholter Mate lebt wieder. Bei Platz 1 schließt „Winner Winner Chicken
Dinner" ab. Airdrops nennen, wer das Paket vorher schon geplündert hat und
was er mitnahm; dafür speichert das Einlesen seit 2026-10-21 alle Griffe ins
Paket. Für ältere Matches: `python -m pubg.cli airdrop-backfill` (aus dem
Archiv, sonst vom CDN; wiederholbar).

Seit 2026-10-26 speichert das Einlesen außerdem die Knock-Id (`dBNOId`), die
den Tod eindeutig seinem Knock zuordnet, die Todesursache vom Finish statt
vom Knock (`Damage_DBNO` = ausgeblutet), das Spitzentempo jeder Fahrt
(`maxSpeed`) und die Mitfahrer beim Ein- und Aussteigen (`fellowPassengers`).
Damit trennt die Karte zwei gleiche Autos ohne Positions-Schätzung, und der
Tempo-Rekord nennt, wer mitfuhr. Für ältere Matches:
`python -m pubg.cli felder-backfill` (gleiche Quellen, wiederholbar).

Vorher waren es zwei Tabs — *Sessions* mit Monats-Akkordeons und *Custom
Range* mit fünf Presets. Zwei Wege zum selben Ziel, und „Yesterday" stand als
Knopf **und** als Session in der Liste. Der Sprung zur Session davor, die
häufigste Aktion, kostete Monat-aufklappen plus Scrollen; jetzt ist es ein
Klick auf `◀`.

Weggefallen: die Tabs, die Monats-Akkordeons samt ihrem localStorage-Zustand,
das Sortier-Dropdown (fünf Optionen — ein Überrest aus dem Akkordeon-Baum) und
das Preset *Yesterday*. Dazugekommen: *30 days* und die Pfeile. Der
`view`-URL-Parameter steuerte die Tabs und wird beim Wechsel entfernt.

Die Monatsköpfe in der Liste sind **Trenner**, keine Akkordeons — nichts zum
Aufklappen. Ein gewählter Zeitraum, der keiner Session entspricht, lässt den
Schalter auf *Custom* und die Session-Zeile sagt das ausdrücklich, statt eine
fremde Session als gewählt auszugeben.

Die drei verworfenen Entwürfe stehen als klickbares Mockup in
`docs/design-proposals/session-picker.html` (mit den echten 89 Sessions).

**TopScorer** im `session-report` ist der beste Einzelspieler der **ganzen Lobby** —
eigener Squad eingeschlossen, im Gegensatz zum "Stärksten Gegner" in
`session-lobbies.html`. Er steht jetzt in drei Auflösungen da: je Match (eigene
Spalte in der Match-Liste), je Phase und für die Session als Ganzes. Format
`16K / 3A` (Kills / Assists); bei Gleichstand in den Kills entscheiden die
Assists. Die Assists der Lobby kamen erst mit der `assists`-Spalte in
`match_team_mapping` dazu — Matches, die vorher eingelesen wurden, zeigen nur
`16K`. Für alles, was noch im API-Fenster liegt, lädt

```bash
python -m pubg.cli assists-backfill [--tenant N|--all] [--days 14] [--limit N]
```

die Match-Payloads erneut und schreibt die Assists nach — `/matches/{id}` zählt nicht
gegen das Rate-Limit, der Lauf braucht also keine Drosselung. Ältere Matches bleiben
ohne Assists: die Payloads sind nach rund 14 Tagen endgültig weg.

**performance-history** zeichnet den Verlauf über die eigenen Matches — K/D (Default),
Win-Rate, Ø DMG, Kills oder Matches, gruppiert nach `session`, `day` oder `month`.
`session` nutzt dieselbe Gap-Regel wie der session-report: eine Pause länger als
`sessionGapHours` (Default 4h) beginnt eine neue Session, hier aber über die ganze
Historie statt nur bis zum letzten Cutoff. K/D ist `kills / (matches - wins)`, identisch
zum session-report. Abgrenzung zu `season-history.html`: das zeigt PUBG-Season-Aggregate
aus der API, dieses Widget rechnet aus den gespeicherten Match-Zeilen — die beiden
Grundgesamtheiten sind nicht identisch.

**squad-compare** zeigt die letzten `matches` Partien, in denen **alle** unter `players`
genannten Spieler gemeinsam in **einem Squad** waren — es sucht dafür so weit zurück wie
nötig, statt die letzten eigenen Matches zu nehmen. Der eigene Account wird nicht
erzwungen: zwei Mates lassen sich auch vergleichen, wenn man selbst nicht dabei war.
Gegner-Begegnungen in derselben Lobby zählen nicht (dafür wäre ein eigenes
„Lobby Compare" nötig). Unbekannte Namen werden als solche gemeldet.

### Browser-Tools

Werden im normalen Browser-Tab geöffnet — **nicht** als OBS-Source. Schreib-/Lese-Zugriff
auf das Backend; kein Streaming nötig.

| Datei | Zweck | Größe |
|---|---|---|
| `tools/match-replay.html` | Animierter Replay eines PUBG-Matches auf der Karte | Browser-Tab |
| `tools/landing-spots.html` | **Landing Spot Analyzer**: Tabelle je Landeplatz mit eigenem Ergebnis gegen die Lobby, Karte auf Klick | Browser-Tab |
| `tools/g1r-database.html` | Vollständiger G1R-Item-Katalog aus dem Object-Dump (Nah-/Fernkampf, Runen, Schriftrollen) mit Live-Suche | Browser-Tab (admin) |
| `tools/match-analysis.html` | Telemetrie-Auswertung eines Matches: Accuracy, Trefferzonen, Kill-Timeline, Auffälligkeiten | Browser-Tab |
| `tools/weapon-performance.html` | Dieselben Kennzahlen über einen **Zeitraum** — je Waffe oder je Spieler | Browser-Tab |
| `tools/squad-playstyle.html` | Spielstil je Squad-Mate: wer eröffnet die Gefechte, wie gehen sie aus, wer hängt zu weit weg | Browser-Tab |
| `tools/shot-quality.html` | Schussqualität, Todesbild und Perzentil-Rang gegen Lobby und Squad | Browser-Tab |

#### tools/landing-spots.html — Landing Spot Analyzer

Karte und Bewertung an einem Ort. **Links die Tabelle** — eine Zeile je
Landeplatz mit Lobby-Landungen, eigenen Drops, *Squad held*, *You died*,
*Died alone*, Lobby-Quote, Differenz, Überlebenszeit und Platzierung, alle
zehn Spalten sortierbar mit Richtungspfeil. **Rechts die Karte** mit Heatmap
und Scatter je Spieler. Dieselben Größen und Richtungen wie in
`shot-quality`, damit man nicht zwei Sprachen lernt.

Umschalter **View: Mine / Lobby** steuert Tabelle **und** Karte gemeinsam.
Bei *Mine* färbt die Heatmap nach den Landungen der gewählten Spieler und
Plätze ohne eigene Landung verschwinden ganz (auf Erangel 40 statt 100
Blobs, 350 statt 34.776 Landungen) — vorher standen dort Marker und Namen
ohne Inhalt. Bei *Lobby* färbt sie nach allen und die Tabelle listet jeden
Platz.

Die Lobby-Gesamtsicht bleibt in beiden Fällen ablesbar: die Zeile über der
Tabelle nennt immer beides („44 of 99 spots · 31.966 lobby landings · 344
yours"), und die Lobby-Spalte je Zeile ändert sich nicht mit dem Schalter.

Spieler-Modi: **Same squad** nimmt nur Matches, in denen alle Genannten im
selben Team waren, **Any of them** jedes Match mit mindestens einem und
zählt deren Landungen kumuliert. An echten Daten: mit `PEX_LuCKoR` und
`original_Hat3` sind das 118 gegen 349 Matches und 236 gegen 468 Landungen.
Der Schalter erscheint erst ab zwei Spielern, weil beide Modi bei einem
dasselbe liefern; der Flugrouten-Filter erst mit mindestens einem, weil er
ohne Referenzspieler stillschweigend ignoriert wird.

Kein festes 1920×1080 mehr — das Tool füllt das Fenster. Unter 68 rem
rutscht die Karte unter die Tabelle und die Seite darf scrollen.

Hat ein Unterbereich keine eigenen Landungen, aber der Oberplatz welche,
steht dort **nicht** „nichts hier", sondern ein Verweis: „Your landings here
are counted under **Bootyard** — 86 drops there", als Knopf, der hinspringt
und den Ort auf der Karte hervorhebt. Auf Erangel betrifft das 21 der 100
Regionen (`Bootyard - Warehouses`, `Bootyard - Shop`, `Pochinki - B` …) —
ohne den Verweis las sich eine Polygon-Grenze wie „hier war ich nie".

**Klick auf einen Landeplatz zentriert ihn auf der Karte** (Zoom mindestens
3×, eine höhere bleibt erhalten) — das war der fehlende Weg zwischen Zahl
und Ort. Hover hebt ihn wie zuvor nur hervor.

Zwei Quellen, ein Zeitraum: die Heatmap kommt aus
`/api/pubg/landing-heatmap` (alle Spieler der Lobby, eine Karte), die
Bewertung aus `/api/pubg/shot-quality` (eigener Account, alle Karten).
Beide bekommen denselben `range`, und dafür hat `landing-heatmap` einen
`range`-Parameter bekommen — ohne Angabe weiterhin der ganze Bestand, damit
bestehende Aufrufe unverändert bleiben. Eine Karte aus allen Matches neben
einer Tabelle aus der Session wäre schlimmer als zwei getrennte Tools. Die
beiden Aufrufe laufen parallel, weil `shot-quality` auf dem vollen Bestand
rund 2,5 s braucht.

Fällt `shot-quality` aus, bleibt die Karte nutzbar und die Zahlen fehlen
still — die Heatmap ist die Hauptsache des Tools.

#### tools/shot-quality.html

Beantwortet „wie gut sitzt jede Kugel, wann sterbe ich, und wo stehe ich damit" —
nicht „wie viele Kills habe ich". Parameter: `?range=session|day|week|all`,
`player=` (Default: eigener Account), `minMatches=` (Kohorten-Schwelle, Default 20).

Neun Sektionen:

*Shot quality* — Trefferquote, **Schaden je 100 Schuss** (bündelt Quote und
Trefferwucht in eine Zahl), **Anteil der Schüsse im Gefecht**, Kopftreffer-Anteil,
Schüsse und Schaden je Match. Jeder Wert mit dem Delta der letzten 20 Matches
gegen die 20 davor.

*Where you rank* — Perzentil je Metrik gegen zwei Referenzgruppen, umschaltbar:

* **Lobby** — jeder Gegner, dem man begegnet ist, aus `match_weapon_stats`
  (fünfstellig viele Accounts, davon rund 800 mit ≥ 5 Matches). Breit, aber nur
  Schuss-Metriken: Fremde stehen nicht in `participants`, also gibt es dort kein
  K/D und keine Überlebenszeit.
* **Squad & regulars** — eigene Accounts und Mates aus `participants`
  (Größenordnung 25 Spieler mit ≥ 20 Matches). Klein, dafür mit vollem Bild
  inklusive K/D, Überlebenszeit, Heals und Boosts.

Perzentil heißt „Anteil der Referenzgruppe, der schlechter ist als du"; bei
*Deaths before 5 min* zählt ein niedriger Wert als besser. Der eigene Account
fällt aus dem Vergleich, sonst schlägt man sich selbst.

**Eigene Werte und Referenz kommen aus demselben Fenster.** Wird ein Zeitraum
gewählt, wandert die Referenz mit — sonst landet ein Session-Ausschlag zu weit
außen, weil Lifetime-Werte fremder Spieler über hunderte Matches gemittelt
sind und darum viel enger streuen als Session-Werte.

Die **Mindest-Matchzahl** muss dafür mitwandern. Mit den Lifetime-Schwellen
bliebe bei einer Session fast niemand übrig; gemessen an Prod-Daten:

| Zeitraum | ≥ 1 Match | ≥ 2 | ≥ 5 |
|---|---|---|---|
| Session (19 Matches) | 1.533 | 73 | 5 |
| 7 Tage (64 Matches) | 4.930 | 438 | 11 |
| alltime (1.132) | 53.467 | 13.435 | 850 |

Bei gewähltem Zeitraum gilt darum **ein** Match, sonst die Lifetime-Schwelle.
Welche galt, steht im Untertitel und als `scoped` bzw. `lobbyMinMatches` in
der Antwort — sonst vergleicht man unbemerkt gegen eine Handvoll Leute.

Die Gruppengrößen zählen den **eigenen Account nicht mit**: `rank_me` lässt
ihn aus dem Vergleich, also darf die Anzeige ihn nicht mitzählen. Bei 850
Spielern fällt das nicht auf, bei drei schon.

*By round phase* — dieselben Schusswerte getrennt nach Überlebenszeit
(early < 5 min, mid 5–15 min, late > 15 min). Eine Trefferquote, die zur späten
Phase hin abfällt, zeigt auf Feuerdisziplin auf Distanz, nicht auf das Zielen.

*Deaths* — wann in der Runde, auf welche Distanz, durch welche **Waffenklasse**
(trennt „ich sterbe an SMGs im Nahkampf" von „ich werde gesnipert") und durch
welche Waffe. Quelle sind `Kill`-Events mit `target_account = ich`.

„Durch wen" ist bewusst keine Kachel: von 1099 Gegnern, die den Nutzer erledigt
haben, kamen 1083 auf genau einen Kill und 16 auf zwei — keiner auf drei. Eine
nach Häufigkeit sortierte Namensliste liest sich wie „das sind deine
Angstgegner", zeigt aber nur, wer alphabetisch vorne steht. Wiederholungstäter ab
`REPEAT_KILLER_MIN` (3) Toden stehen als Fußnote; gibt es keine, sagt die Zeile
genau das.

**Datenlage wird ausgewiesen, nicht verschwiegen.** Unter 20 Matches mit
Telemetrie erscheint eine *Thin data*-Warnung (die Trefferquote ist dann vom
Zufall einzelner Gefechte dominiert), unter 10 Referenzspielern eine
*Small reference group*-Warnung. Tenant 2 hat etwa 640 Matches, aber nur 95 mit
archivierter Telemetrie — die Schusswerte ruhen auf diesen 95.

*Burst discipline* — der **Index des ersten Treffers im Feuerstoß**, je
Waffenklasse. Die Trefferquote sagt, wie viele Schüsse ankommen, aber nicht wann:
zwei Spieler mit derselben Quote können sehr verschieden zielen — einer setzt den
Eröffnungsschuss ins Ziel, der andere zieht drei Schüsse lang nach. Das ist der
messbare Anteil von Crosshair-Placement.

Getrennt nach **Rolle**, weil die Zahl sonst mindestens so viel Spielweise misst
wie Zielverhalten: wer aus dem Hinterhalt eröffnet, hat den Erstschuss-Treffer
leichter als wer auf einen schon schießenden Gegner antwortet. Ein Stoß gilt als
*answered*, wenn in den 10 s davor Feuerschaden eintraf, sonst als *opened*. Die
Lücke zwischen beiden Zeilen sagt mehr als jede einzeln.

Waffenklassen sind **nicht untereinander vergleichbar**: eine Repetierbüchse
trifft mit dem ersten Schuss fast immer, SMG-Dauerfeuer fast nie (gemessen: 98 %
gegen 20 %). Verglichen wird darum nur innerhalb der Klasse, gegen zwei Größen —
den **Pool** (alle Feuerstöße aller anderen zusammengeworfen, robust) und ein
**Perzentil** (nur Spieler mit ≥ 10 eigenen Treffer-Stößen, einordnend). Raten
unter 20 Treffer-Stößen stehen kursiv.

Die Zahlen kommen aus acht Spalten in `match_weapon_stats`, berechnet in
`pubg/burst_analysis.py` aus der **rohen** Telemetrie im Poller — an derselben
Stelle wie die Accuracy und aus demselben Grund: `telemetry_events` enthält nur
Squad-Events (siehe `filter_squad_events`) und damit rund zwei Schützen je Match,
die Rohtelemetrie alle ~90. Rückwirkend trägt `scripts/backfill_bursts.py` sie
aus dem SFTP-Archiv nach:

```
python3 scripts/backfill_bursts.py --tenant 1 [--limit N] [--dry-run] [--redo]
```

Nicht jedes Archiv-File ist roh — ältere wurden aus der DB rekonstruiert und
haben wieder nur Squad-Events. Die erkennt das Skript an der Zahl verschiedener
Schützen und lässt sie aus, statt Zahlen zu schreiben, die aus zwei Spielern
statt neunzig kommen. Standard tastet nur die Feuerstoß-Spalten an; `--rebuild`
schreibt die ganze Zeile neu und wird für Korrekturen außerhalb dieser Spalten
gebraucht. Der Endpoint liefert den Block nur mit `withBursts=1`, weil er die
ganze Lobby liest.

Drei Zahlen stehen in der Sektion nebeneinander, weil sie verschiedene Dinge
messen:

* **Hit nothing** — Anteil der Feuerstöße, die überhaupt nichts trafen. Die
  Signatur wahllosen Feuers, mit dem größten Nenner (alle Stöße).
* **1st shot lands** — Visierlage. Nenner sind nur die Stöße *mit* Treffer:
  ein Stoß ohne jeden Treffer sagt nichts darüber, wo das Visier stand.
* **After 1st hit** — Trefferquote der Schüsse *nach* dem ersten Treffer. Das
  Ziel ist gefunden und im Visier; was hier fehlt, ist Rückstoßkontrolle und
  Nachführen, nicht Zielen.

Unter fünf Treffer-Stößen wird **keine Quote** gebildet, sondern die Rohzahl
gezeigt: „1 von 1" ergäbe 100 % und läse sich als Befund.

*Utility* — Wurfgeräte, getrennt von den Schusswaffen, weil die Kennzahlen
andere sind. Granaten, Molotov, C4 und Panzerfaust richten echten Schaden an
und standen vorher mit Würfen und null Treffern in der Tabelle, weil ihr
Schaden keine Gun-Kategorie trägt.

Der aussagekräftige Wert ist **Schaden je getroffenem Wurf**: er trennt die
Wirkung eines guten Wurfs davon, wie oft einer gelingt, während Schaden je
Wurf beides mischt und damit weder das eine noch das andere zeigt — genau wie
bei den Schusswaffen, wo dafür `avgDamagePerLandedShot` steht. Nenner ist der
getroffene **Wurf**, nicht der getroffene Gegner: eine Granate in eine
Dreiergruppe ist ein guter Wurf, kein dreifacher. Die getroffenen Gegner
stehen als eigene Spalte daneben.

Ob ein Schadensereignis einem Wurfgerät gehört, entscheidet die **Waffenklasse
des Verursachers** (`throwable` oder `melee`), nicht eine Liste von
Kategorienamen. Eine solche Liste veraltet bei jeder neuen Waffe, und genau das
ist passiert: geraten war `Damage_Explosion_StickyGrenade`, die Klebebombe
meldet `Damage_Explosion_StickyBomb` — 927 Würfe lobbyweit standen mit null
Treffern da, bei 0,5 Kills je 100 Würfen. Zwei Kategorien bleiben explizit
(`Damage_Molotov`, `Damage_MeleeThrow`), weil Molotov-Schaden überwiegend über
den Feuer-Controller läuft, der als eigene Waffenzeile geführt wird.

Blauzone, Rotzone, Fahrzeug, Benzinkanister und Gaspumpe bleiben ganz draußen:
das richtet die Umgebung an, nicht ein Spieler — der Kanister explodiert auch,
wenn ihn jemand anders anschießt.

Wurfgeräte tragen `is_thrown` und werden aus **allen** Ziel-Metriken
gefiltert: eine Granate, die drei Gegner erwischt, wäre sonst ein Schuss mit
drei Treffern.

*Cohort bands* — Mittelwerte je K/D-Band, die eigene Zeile nach K/D
einsortiert. Bewusst über den ganzen Bestand statt über den gewählten Zeitraum,
damit die Referenz beim Range-Wechsel nicht springt.

*Deaths* enthält auch die **Karten-Ebene**: Matches, Tode und Todesrate je
Karte. Rohe Todeszahlen sagen nur, wo man viel spielt — Erangel führt die
Liste immer an; erst die Rate pro Match trennt „viel gespielt" von „läuft
dort schlecht". Karten unter 20 Matches sind als `thin` markiert und aus der
Markierung der schlechtesten Rate ausgenommen.

Einzelne **Landeplätze zeigt dieses Tool nicht** — die gehören zum
[Landing Spot Analyzer](#toolslanding-spotshtml--landing-spot-analyzer), wo
die Karte danebensteht. `landing_stats` bleibt im Modul und wird über
`?withLandings=1` geliefert; ohne den Parameter entfällt der Aufruf und
`shot-quality` spart die rund zwei Sekunden.

*Trend* — die letzten 20 / 50 / 100 Matches gegen die gleich langen davor.
**Nicht** an `range` gekoppelt: eine Session hat zu wenige Matches, um eine
Trefferquote zu tragen; 20 Matches sind das Minimum für ein lesbares Signal.

Zur Tenant-Trennung: `telemetry_events` führt **keine** `tenant_id`. Jede Abfrage
dort joint auf `matches` und filtert erst da — ein direkter Zugriff würde Tode aus
fremden Tenants mitziehen. `tests/pubg/test_shot_quality.py` hält das fest.

#### tools/squad-playstyle.html

Zwei Tabellen je Squad-Mate über `?range=session|day|week|all`, dazu
`players=A,B,C` (nur Matches, in denen **alle** Genannten dabei waren),
`minMatches=` und `includeBots=1`.

*Fights* — je Mate, der ein Gefecht eröffnet: Eröffnungen pro Match, **Target down %**
(er trifft zuerst — geht genau dieser Gegner zu Boden?), davon selbst erledigt,
Eröffnungsdistanz, „Any down" (irgendwer aus dem gegnerischen Team fällt),
gewonnen / verloren / wirkungslos, Downs je Eröffnung für das ganze Squad und davon
selbst, eigene Verluste je Eröffnung. Die Oberfläche ist englisch wie die übrigen
Widgets.
Ein Gefecht ist „unser Squad gegen ein gegnerisches Team"; nach 45 s Ruhe beginnt
gegen dasselbe Team ein neues. Ein Down ist **ein umgelegter Spieler**, nicht ein
Event: Knock und der spätere Finisher sind derselbe Vorgang, auch wenn Minuten und
ein Gefechtswechsel dazwischen liegen. Ein `Revive` stellt den Gegner wieder hin —
dann zählt der nächste Knock erneut. Ein Kill ohne vorherigen Knock zählt normal,
denn der letzte Spieler eines Teams stirbt ohne DBNO; das sind an Prod-Daten
gemessen rund 27 % aller Kills. Bots bleiben per Vorgabe draußen, sonst schönen
Bot-Kills jede Quote.

*Playstyle* — **Loot-Tempo**: Items je Minute, aber der Nenner ist die Zeit IN den
Loot-Phasen, nicht die Lebenszeit. Pickups werden gebündelt, eine Pause über 20 s
beginnt eine neue Phase; wer in 20 s dreißig Items nimmt und dann zehn Minuten
läuft, lootet schnell — über die Lebenszeit gerechnet sähe er aus wie ein Trödler.
Einzel-Pickups ohne Nachbarn haben keine messbare Dauer und stehen als *grabbed on
the way* daneben, statt die Rate zu sprengen. Kein pauschaler Zeitaufschlag je
Item: drei Items in einer Sekunde sind gutes Multi-Pickup und müssen dreimal so
schnell herauskommen wie drei in drei Sekunden. Daneben die **Loot-Zeit je Match**
als zweite Achse (schnell UND lang ist der Geier) und das Box-Verhalten getrennt
(**Sekunden je Leiche**, Items je Leiche — im Endgame ist das Festhängen an der Box
ein Todesurteil). Alle Raten aus Summen, nicht als Mittelwert von Match-Raten.
Weiter: Loot in den ersten zehn Minuten, **spätes Sammeln ab Minute 15** als eigene Rate
(wer da noch wühlt, hält das Squad auf), Lebenszeit, Median-Abstand zum
nächsten Mate, Zeitanteil über 100 m weg, Abstand zum Team beim eigenen Knock
(aus den 25 s davor gemessen — mit einem Fenster um den Knock herum misst man den
Mate, der zur Rettung rennt), Anteil der Matches als Erster unten, Standzeit in der
zweiten Lebenshälfte.

Datenquelle ist `telemetry_events`, also rückwirkend für alles in der DB und ohne
Roh-Blob. Zu beachten: Position-Events liegen dort **nur fürs eigene Squad**, und
Schadensereignisse nur mit Squad-Beteiligung — für eine Squad-Auswertung reicht das
genau, für Aussagen über fremde Teams untereinander nicht. Zwei Eingabefelder, die bewusst
Verschiedenes tun: **Matches with** wählt die *Runden* (nur Matches, in denen alle
genannten dabei waren), **Show only** wählt die *Zeilen* — die Matchmenge und damit
alle Nenner bleiben gleich, es wird nur ausgeblendet. Anteile zweier Spieler
summieren sich deshalb nicht auf 100 %: „First to drop" gehört in einem Vierer-Squad
dem, der tatsächlich zuerst umkippt, der Rest verteilt sich auf die anderen Mates
(gemessen über 263 gemeinsame Runden: 37,6 % + 20,2 % für zwei feste Spieler, die
übrigen 42 % auf dritte und vierte Mitspieler). Werte aus weniger als
fünf Matches bzw. Eröffnungen zeigt die Ansicht blass und nimmt sie von den
Spitzenreiter-Markierungen aus.

**Lobby-Stärke** steht im **Session-Report** (Spaltenbreiten dort in `fr`, erste und
letzte Spalte doppelt: mit festen Pixeln sammelte sich der freie Platz vor der
Lobby-Spalte). Fehlt der Wert noch, zeigt die Zelle einen Ring statt eines Strichs —
ein Strich hieße „gibt es nicht", tatsächlich sammelt der Hintergrund-Dienst nur noch
(rund 15 Minuten je frischer Lobby, der Tooltip nennt den Stand). Auf den Report
wartet dabei nichts: die Werte kommen aus der DB, gemessen 0,7 ms je Match: je Match-Zeile der Ø-Alltime-K/D der
Gegner (eigener Squad herausgerechnet) und dahinter der Vorsprung des eigenen Squads
als Differenz, in den Totals der Schnitt über die Session. Dort geht man die Runden
durch — „war die Lobby hart" liest sich neben Platz und Kills, nicht in einem eigenen
Tool. Der Endpoint `/api/pubg/lobby-kd` bleibt für Abfragen über Zeiträume.

Die Zahl ist die **Alltime-K/D, gemessen am Modus des Matches** — in drei Stufen,
jede erst wenn die vorige zu dünn ist: der Modus selbst, dann dieselbe Perspektive
(alle FPP bzw. alle TPP), zuletzt die ganze Karriere. Eine Stufe zählt nur ab
**50 Runden** und wenn sie mindestens **10 % der gespielten Runden** ausmacht; reicht
auch die letzte Stufe nicht, gibt es keinen Wert statt eines erfundenen. Der Dialog
schreibt hinter jeden Wert, worauf er beruht.

Vorher wurde immer sofort über alle Modi summiert. Das erzeugte Zerrbilder in beide
Richtungen: ein Account mit 20 Kills aus **zwei** Solo-Runden stand als „20er K/D" an
der Spitze einer squad-fpp-Lobby (dort hatte derselbe Spieler 0,43 aus 49 Runden), und
im eigenen Solo-Match fiel die Rechnung auf 25 Third-Person-Runden zurück (4,74),
obwohl daneben 10.663 Runden squad-fpp mit 1,50 lagen. Gemessen an 40 Prod-Matches
stammen jetzt 76 % der Rand-Werte direkt aus dem gespielten Modus, 18 % aus derselben
Perspektive, 6 % aus der Gesamtkarriere — bei 96,5 % Abdeckung.

Der Grund für die Rückfall-Stufen bleibt bestehen: wer nur Duo spielt, hätte in
`squad-fpp` keine Zahl, und ein Lifetime-Abruf liefert ohnehin alle Modi mit. Spieler, die die API
wirklich nicht kennt, bekommen einen Negativ-Eintrag; ein Rate-Limit (429) oder
Serverfehler dagegen **nicht** — sonst brennt sich eine Fehlanzeige dauerhaft ein.
Ebenso wenig bekommt einen Negativ-Eintrag, wer irgendwo schon Zahlen hat: auf prod
stand ein Spieler mit frischen `solo-fpp`-Werten 14 Minuten später mit einer leeren
`squad-fpp`-Zeile da und galt dem Sammler danach als erledigt — die API kannte ihn
sehr wohl (21 Kills, 49 Tode, 49 Runden).
`python -m pubg.cli lobby-kd-reset-unknown` räumt solche Altlasten weg.

Der Langläufer `lobby-kd-backfill` läuft als Template-Unit **je Tenant**
(`obs-lobby-backfill@1`, `@2`, …): jeder Tenant hat einen eigenen PUBG-API-Key mit
eigenem Rate-Limit, vier Läufe konkurrieren also nicht miteinander. Ist der eigene
Tenant durch, sammelt der Lauf für die anderen weiter — `player_season_snapshot` ist
global, ein Account gehört niemandem, und ein untätiger Key wäre verschenktes Budget
(`--no-share` schaltet das ab).

Datenbeschaffung (`/api/pubg/lobby-kd`): Season-K/D aller
Spieler einer Lobby, gemittelt je Match, gegen den Schnitt des **eigenen Squads**
gehalten. Der eigene Squad ist dabei aus der Lobby-Seite herausgerechnet — sonst
misst man sich zum Teil gegen sich selbst.
Lifetime-Zahlen gibt die API nur einzeln heraus — 93 Requests je Match bei einem
Budget von 10 pro Minute; Season-Zahlen kommen im Zehnerpack
(`/seasons/{id}/gameMode/{mode}/players?filter[playerIds]=…`), also rund zehn
Requests je Lobby. Der Poller sammelt pro Tick ein Zehnerpack in
`player_season_snapshot` (global, nicht pro Tenant — die Zahlen gehören dem
Spieler); Spieler, die die API im Modus nicht kennt, bekommen einen Negativ-Eintrag,
damit sie nicht endlos erneut angefragt werden. Die Abdeckung steht an jedem Match,
und Matches unter 25 % fallen aus dem Gesamtschnitt. Ebenso Mini-Lobbys unter
20 echten Gegnern: TDM und Heist haben 13 bzw. 3 Spieler statt 96 und wögen im
Phasen-Schnitt sonst genauso schwer wie eine volle Runde. Der Wert ist ein
Schnappschuss von heute, nicht vom Match-Tag — die API hat keine Historie.

**Ranked-Matches** tragen ein Abzeichen hinter dem Map-Namen (`is_ranked` aus
`matchType == "competitive"`). Normal-Matches bleiben unmarkiert — ein „Normal"-Label
an jedem zweiten Match wäre Rauschen. Rückwirkend lässt sich das nicht nachtragen: die
Match-Payloads der API sind nach rund 14 Tagen weg, ältere Matches stehen deshalb alle
auf „nicht ranked".

**Harte Lobbys sind markiert:** Maßstab ist der Schnitt der stärksten Fünf, nicht der
Gesamtschnitt — der liegt fast immer um 1,3 und sagt nichts darüber, ob oben Haie
sassen. Ab 3,0 bekommt die Zahl den Highlight-Effekt, ab 4,0 deutlicher; in der
Match-Zeile wie im Phasen-Kopf.

**Aufschlüsselung per Klick:** Die Lobby-Zahl in der Match-Zeile und die im
Phasen-Header sind Buttons; dahinter öffnet ein Dialog mit Ø, Median, härtestem
Gegner sowie den fünf stärksten und fünf schwächsten Spielern namentlich
(`/api/pubg/lobby-detail?matches=id1,id2`). Der Median steht daneben, weil K/D
bei 0 endet und nach oben offen ist — an Prod-Daten sind das allerdings nur 0,05
bis 0,10 Unterschied zum Ø; die Aussage steckt in Top gegen Low (2,87 gegen 0,32
in einer typischen Lobby). Dieselbe Mechanik hängt an der **Squad-K/D**-Zahl: dort listet der Dialog die
eigenen Leute mit ihrem Karriere-Schnitt (im Phasen-Dialog dazu, wer wie viele
Runden dabei war) — ohne Top/Low, bei vier Leuten wäre das Unsinn. Beim
Phasen-Dialog werden die Match-Werte gemittelt
statt alle Spieler in einen Topf geworfen: sonst wögen volle Lobbys schwerer als
kurze Matches, und „die stärksten Fünf" wären immer dieselben Ausreißer.

#### tools/match-replay.html

Quellen-Kette für die Roh-Telemetrie, in dieser Reihenfolge:

1. **SFTP-Archiv** — das Blob ändert sich nie, der Griff ins Archiv spart jeden
   externen Call. Jeder Tenant kann unter `/app/settings` seinen **eigenen**
   SFTP-Speicher hinterlegen (Host/Port/User/Passwort/Verzeichnis, verschlüsselt
   im Vault, mit „Verbindung testen"-Knopf); ohne eigenen Zugang gilt der
   geteilte aus `.secrets` — und der nur für Admin-Tenants, sonst würden fremde
   Streamer in den Bucket des Betreibers schreiben. Ist ein Archiv hinterlegt,
   lädt der Poller jedes neue Match dorthin.
2. **PUBG-CDN** über `matches.telemetry_url` — kein API-Key nötig, reicht rund
   14 Tage zurück. Fehlt die URL in der DB, wird das Match einmal frisch von
   `/matches/{id}` geholt (nicht rate-limitiert) und die URL daraus genommen.
3. **`telemetry_events` aus der DB** — wenn kein Roh-Blob mehr zu bekommen ist.
   Die flachen Rows werden zu Pseudo-Roh-Events zurückgebaut und durch dieselbe
   `extract_events()`-Pipeline geschickt, damit es nur einen Renderer gibt.

Stufe 3 ist bewusst ein Teil-Replay: `telemetry_events` speichert Position-Events
**nur für das eigene Squad** und `LogGameStatePeriodic` gar nicht. Gegner erscheinen
also an ihren Lande-, Knock- und Kill-Punkten, haben aber keine Bewegungsspur, und
es gibt keine Bluezone. Das Ergebnis sagt das selbst: `replaySource` ist `hidrive`,
`api`, `api-live` oder `db-squad`, und `coverage` nennt die Lücken
(`positions: squad-only|all`, `zones: true|false`, `hits: squad-only|all`,
`flightPath: true|false` — die Flugroute hängt an Position-Events oberhalb
150000 cm, die je Match in der DB liegen oder nicht). Das Tool
zeigt daraufhin einen Hinweis und sperrt den Bluezone-Schalter.

#### tools/weapon-performance.html

Waffen-Kennzahlen über einen **Zeitraum** statt über ein einzelnes Match: `?range=session|day|week|all`.
Zwei Blickrichtungen über `groupBy`:

- `weapon` — „womit treffe ich am besten", eine Zeile je Waffe
- `player` — „wer trifft womit am besten", eine Zeile je Spieler

Dazu Filter `player=` und `weapon=`. Also etwa `range=session&player=Nipplz` für „letzte Session
von Nipplz" oder `range=all&weapon=Kar98k&groupBy=player` für „was macht die Kar98k, über alle
Spieler". Ein Klick auf eine Zeile setzt den passenden Filter und dreht die Sicht um.

Clan-Tags der Lobby holt ein Hintergrund-Worker nach (`player_clans`), aber nur für
Spieler, die es wert sind: eigener Squad oder mindestens fünf gesehene Matches. Die
PUBG-API erlaubt 10 Requests pro Minute — geteilt mit dem Match-Polling —, und von
76.416 einmal gesehenen Lobby-Spielern bringt ein Clan-Tag nichts. Altbestand räumt

```bash
python -m pubg.cli clan-queue-prune [--min-seen 5] [--dry-run]
```

auf; schon aufgelöste Einträge bleiben.

**Was als Treffer zählt:** `Acc %` ist *getroffene Schüsse / abgegebene Schüsse* —
jeder Schuss zählt im Nenner, auch Rumballern in die Landschaft. Ein Schrotschuss
ist dabei ein Schuss, nicht neun Einschläge (Deduplizierung über `attackId`).
Daneben steht in der Match-Analyse `Acc in fight %`: dieselbe Quote, aber nur über
Schüsse, die **während eines laufenden Gefechts** fielen — also im Zeitfenster von
±20 s um ein Schadensereignis, an dem der Spieler **oder sein Squad** beteiligt war
(in beide Richtungen: zurückschießen zählt). `Idle shots %` ist der Rest.

Die Squad-Fenster sind nötig, weil ein Fehlschuss **kein Ereignis erzeugt**: Wer sein
Team auf Distanz unterstützt und dabei nicht trifft, stünde sonst als „ballert ins
Leere" da. An Prod-Daten gemessen war genau das der Grund, warum Kar98k (39,5 %) und
M24 (38,7 %) die höchsten Idle-Quoten hatten, während SMGs unter 10 % lagen — ein
Artefakt der Messung, keine Eigenschaft der Waffe. Beides steht auch in der Zeitraum-Ansicht
(`weapon-performance`): `shots_in_fight` wird beim Telemetrie-Fetch je Waffe
mitgespeichert, sonst müsste man für eine Quote über Wochen jedes Match neu
durchrechnen (gemessen: 1.063 Matches = 18 Minuten).

Warum zeitlich und nicht räumlich: `LogPlayerAttack` enthält **weder Richtung noch
Einschlagpunkt** — nur Schützen-Position, Waffe und `attackId`. Wo eine verfehlte
Kugel landet, steht nirgends in der Telemetrie. Eine Prüfung „war ein Gegner in X m"
misst deshalb nur den Abstand *Schütze↔Gegner* und sagt nichts darüber, ob überhaupt
in seine Richtung gezielt wurde. Der Zeitpunkt ist die einzige belastbare Auskunft.

**Nachschüsse auf liegende Gegner** zählen nicht mit: Die Telemetrie meldet für
Treffer auf einen Spieler im DBNO **0 Schaden**, weil dort kein normales HP-Konto
mehr läuft. Zählte man sie mit, sähe jede Sniper-Statistik aus wie ein Fehlschlag —
gemessen an einem echten Match: M24, drei Treffer, davon zwei Finisher, Ø-Schaden
33 statt 100. Sie stehen deshalb getrennt in Klammern hinter Schüssen und
Einschlägen (`(+2)`), und der zugehörige Schuss fällt auch aus dem
Accuracy-Nenner — sonst zählte der Schuss unten, der Treffer aber nicht oben.
Ein `Revive` stellt den Gegner wieder her, danach zählt er normal.

Datenquelle ist die Tabelle `match_weapon_stats`, gefüllt beim Telemetrie-Fetch. Für die Historie:

```bash
python -m pubg.cli weapon-stats-backfill [--tenant N] [--limit N]
```

Rund 0,9 s je Match (Download aus dem Archiv plus Analyse). Was nicht im HiDrive-Archiv liegt und
älter als die API-Retention ist, lässt sich nicht nachrechnen und wird übersprungen. Wie viele
Matches im gewählten Zeitraum noch fehlen, steht unter der Tabelle.

#### tools/match-analysis.html

Wertet die **Roh-Telemetrie** eines Matches aus — unabhängig davon, ob wir seine Events
je in die DB eingelesen haben. Aufruf mit `?matchId=<uuid>`, optional `&player=<name>`.

Datenquelle in dieser Reihenfolge:

1. **HiDrive-Archiv** (`pubg/hidrive_telemetry.py`) — Telemetrie ist unveränderlich, ein
   archiviertes Match ändert sich nie. Kein externer Call, kein Rate-Limit.
2. **PUBG-API** — nur solange die CDN-Datei existiert. Gemessen am 2026-08-26: Matches ab
   dem 09.08. abrufbar, alles davor `403`. Das sind rund **17 Tage**, nicht 14.
3. Was von der API kommt, wird direkt ins Archiv hochgeladen — sonst ist es nach Ablauf
   der Retention endgültig weg.

Pro Spieler: Schüsse, getroffene Schüsse, Accuracy, komplette Trefferzonen-Verteilung,
Headshot-Rate, Wallbangs, Schaden, Treffer auf Bots vs. Menschen, Waffen und
Distanzverteilung. Dazu eine Kill-Timeline mit Zeit, Ort, Waffe, Distanz und Trefferzone.

**Auffälligkeiten** (`flag_anomalies`) suchen nach dem *Muster*, nicht nach hohen Werten:
Beim Sprayen streut der Rückstoß über den ganzen Körper, Arm-, Bein- und Beckentreffer
sind unvermeidlich. Fehlen sie fast völlig, passt das nicht zu menschlichem Zielen.
Geprüft wird per Binomialtest gegen die Referenz **desselben Matches** — kein fester
Schwellwert, der je nach Map und Spielweise driftet. Weil dabei viele Spieler gleichzeitig
getestet werden, steht die Bonferroni-Schwelle im Ergebnis; ohne sie findet man in jedem
großen Feld einen scheinbaren Ausreißer.

Gegen Manipulation abgesichert: Wer seine Accuracy drücken will, kann ins Leere schießen.
Deshalb wird pro Schuss geprüft, ob überhaupt ein lebender Gegner in 300 m war
(`emptyShotPct`, aus den Positions-Events im 10-Sekunden-Raster). Das Kernsignal — die
Zonenverteilung — ist ohnehin immun, weil es nur Treffer kennt.

> Auffälligkeiten sind statistische Muster, **kein Beweis**. Bei kleinen Stichproben
> können sie täuschen. Ein hoher Einzelwert allein sagt fast nichts — sehr gute Spieler
> haben hohe Accuracy *und* normale Streuung.

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
telemetryProcessed, achievementsDetected, rateLimitRemaining}`. Der Poller
erkennt PUBG-Session-Milestones serverseitig automatisch — nach jedem neuen
Match bzw. nachgelieferter Telemetrie (`achievementsDetected` = Anzahl neu
erkannter). Brauchbar für ein internes Dashboard
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
- **`matchRecent`** — ist das letzte Match vor weniger als `thresholdMin`
  (Default 30) Minuten **zu Ende** gegangen (Start + Dauer)? Wird **immer**
  aus der DB berechnet, auch wenn PUBG geschlossen ist.

Weitere Felder: `pubgOpen` (Alias für `active`, rückwärtskompatibel),
`lastMatchAt` (Matchstart), `lastMatchEndAt` (Matchende),
`lastMatchAgeMin` (Minuten seit Matchende), `thresholdMin`, `steamChecked`.

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
nur aktiv wenn Steam-Key + SteamID64 unter `/app/settings` hinterlegt sind.

### Setup

1. Steam-Key holen: <https://steamcommunity.com/dev/apikey>.
2. SteamID64 ermitteln: <https://steamid.io/>.
3. Beides unter **`/app/settings` → Steam** eintragen (Feld „Steam Web API
   key"). Geprüft wird wie beim PUBG-Key: 32 Zeichen Hex + Live-Aufruf;
   ein PUBG-Key im Steam-Feld oder ein von Steam abgelehnter Key wird
   abgewiesen, nichts wird gespeichert.
4. Der Poller holt sich die neuen Credentials beim nächsten Durchlauf.

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

**Achievement Browser** (`/app/tools/achievement-browser`, Steam + PUBG gemeinsam):
Schalter **Show** mit `All`, `Latest drop` (nur was mit dem letzten Match bzw.
dem letzten Steam-Freischalt-Schub kam; bleibt stehen, bis etwas Neueres
kommt), `This session`, `Last 7 days`, `Latest 50`. **Dim older** nimmt in den
anderen Ansichten alles außer dem neuesten Schub zurück und markiert diesen mit
„Just in". Steam-Freischaltungen gelten als ein Schub, solange zwischen ihnen
höchstens 10 Minuten liegen. Die Wahl merkt sich der Browser; per URL
vorbelegbar mit `?show=all|drop|session|7d|latest`.

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
Der Endpoint liefert zu jedem Clip eine direkte, signierte MP4-URL (`mp4`) mit;
die Overlays spielen den Clip damit in einem eigenen `<video>`-Element statt im
`clips.twitch.tv`-iframe. Grund: Kanäle mit **Content Classification Labels**
bekommen im iframe ein „Start Watching"-Interstitial vorgeschaltet, das auf
einen Klick wartet — im Overlay klickt niemand, der Clip bliebe stehen.
Mit `?slugs=A,B,C` liefert derselbe Endpoint gezielt einzelne Clips (nutzt der
`clips`-Parameter der Overlays).

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
