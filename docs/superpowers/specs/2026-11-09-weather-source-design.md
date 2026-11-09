# Weather-Source: echtes Wetter, Stimmung, Chat-Ereignisse, Deko-Themen

Stand: 2026-11-09 · Status: freigegeben 2026-11-09, nicht gebaut

## Warum

Heute ist Wetter auf sieben Sources verteilt: `effects/rain.html`,
`effects/snow.html` und die Jahreszeiten `xmas`, `winter`, `spring`,
`summer`, `autumn`, die jeweils ihr eigenes Wetter mitbringen
(Schneefall, Regen, Hitze, Laubfall). Zwei Seiten wissen nichts
voneinander — ein Wechsel von Regen zu Schnee heißt in OBS die eine
Source aus-, die andere einschalten, ohne Übergang.

Ziel des Streamers: **eine** Source, die das Wetter bei ihm draußen
zeigt, sich durch seine Spiel-Laune und durch den Chat verändern lässt
und die Deko der Jahreszeit (Tannenbaum, Blumen, …) wahlweise mitbringt.
Das Wetter soll im Overlay sichtbare Folgen haben, nicht nur Kulisse
sein.

## Ziele

- Eine Source `effects/weather.html` für alles Wetter.
- Wetter folgt einer Wetter-API für den Ort des Streamers.
- Weiche Übergänge zwischen Wetterlagen (Regen wird zu Schnee).
- Spiel-Laune (K/D des Abends) färbt das Wetter.
- Chat kann Wetterlagen zeitweise erzwingen und Spektakel auslösen.
- Deko-Themen der bisherigen Jahreszeiten-Sources als zuschaltbare
  Ebene derselben Source.
- Frost als eigene, interaktive Ebene (Eisblumen am Rand, `!warm`).
- Bestehende OBS-URLs laufen weiter.

## Nicht-Ziele

- Kein eigener Cooldown/Spam-Schutz für Chat-Befehle — macht
  Streamer.bot.
- Kein Ton-Mix im Browser als Standard (siehe Ton).
- Das OBS-Audio-Problem auf dem Windows-Rechner ist eine eigene
  Baustelle, nicht Teil dieses Projekts.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Die K/D verfälscht das echte Wetter so, dass es nicht mehr erkennbar
  ist (Gewitter bei Sonnenschein, nur weil der Abend schlecht lief).
- Dauerton, der unter Stimme und Spielton liegt.
- Flackern, wenn mehrere Chatter gleichzeitig Befehle schicken.
- Ort des Streamers in URL, Stream oder Frontend sichtbar.
- Partikel, die hart an Bildkanten auftauchen/verschwinden
  (Projekt-Regel: immer Rand-Fade).
- Bestehende OBS-Sources brechen nach dem Deploy.

## Aufbau: drei Wetter-Schichten + Deko-Ebene

Jede Schicht kann die darunter überstimmen.

### Schicht 1 — Grundlage: echtes Wetter

- Server fragt die Wetter-API ab; Overlays pollen nur unseren Server.
  Ein Abruf je Tenant alle 10–15 min, gecacht, egal wie viele Tabs
  offen sind.
- Bestimmt, **was** fällt und wie es aussieht: klar, bewölkt, Nebel,
  Niesel, Regen, Gewitter, Schnee, Schneeregen, Hitze; dazu
  Temperatur (für Frost) und Wind.
- Ort wird einmal in der Konfiguration des Tenants hinterlegt, bleibt
  serverseitig.
- Wechsel der echten Lage → langsamer Übergang (ca. 20–30 s).
- Ohne Ort/ohne API-Antwort: Source fällt auf eine manuell gewählte
  Grund-Lage zurück (Einstellung, Standard „klar“).

### Schicht 2 — Stimmung: K/D des Abends

- Quelle: K/D der laufenden PUBG-Session (vorhandener Endpoint
  `/api/pubg/session`). Nur Battle-Royale-Runden zählen — Arcade-Modi
  bleiben draußen (siehe `is_br_mode`).
- Grenzen stellt der Streamer selbst ein: untere Grenze (trüb) und
  obere Grenze (sonnig), dazwischen fließend. Standard ohne Einstellung:
  relativ zum eigenen Schnitt, damit es für andere Tenants ohne
  Konfiguration funktioniert.
- Stärke-Regler 0…1; bei 0 zeigt die Source reines echtes Wetter.
- Wirkung, abgestuft:
  - gute K/D: Wolken reißen auf, Sonnenstrahlen, Flocken glitzern —
    auch bei Frost/Schnee bleibt der Niederschlag, nur das Licht ändert
    sich;
  - schlechte K/D: grauer, dunkler, Nebel; unter der unteren Grenze
    darf sie Niesel bzw. Regen dazuholen, auch wenn es draußen trocken
    ist;
  - **nie** Gewitter oder Spektakel — die bleiben Chat und Ereignissen
    vorbehalten.
- Keine laufende Session → Schicht 2 neutral.

### Schicht 3 — Ereignisse: zeitweise Übersteuerung

Zwei Arten:

| Art | Beispiele | Verhalten |
|---|---|---|
| Wetterlage | `!gewitter`, `!schneesturm`, `!sonne` | löst die vorige ab, kurzer Übergang 3–5 s, hält 2–3 min (einstellbar), dann zurück auf Schicht 1+2; neuer Befehl startet den Zähler neu |
| Spektakel | `!tsunami`, Mega-Blitze, Kugelblitz, Lawine | einmaliger Effekt **über** der aktuellen Lage, verstellt nichts |

- Mindestdauer je Wetterlage ~15 s: kommt der nächste Befehl früher,
  wartet er nur den Rest ab (kein Flackern). Keine Warteschlange über
  mehr als einen Befehl — der jüngste gewinnt.
- „Erzwingen“ aus Live control im Dashboard = dieselbe Schicht ohne
  Zeitlimit; Button „Auto“ gibt an Schicht 1+2 zurück.
- **Keine Spiel-Ereignisse als Auslöser** (Chicken Dinner, früher
  Tod): die PUBG-API liefert ein Match erst nach Rundenende, ein früher
  Tod käme bis zu 30 min zu spät. Ohne zeitlichen Bezug bringt der
  Effekt nichts. Die K/D-Stimmung verträgt die Verzögerung, weil sie
  sich ohnehin langsam ändert.
- Auslösung per Streamer.bot „Fetch URL“ an `/s/<token>/api/fx/weather`
  wie bei den heutigen fx-Sources (`fx/commands.py`).

### Frost-Ebene

- Bei Frost draußen (Temperatur ≤ 0 °C) wachsen Eisblumen von Ecken und
  Rändern ins Bild, weich zur Mitte auslaufend.
- `!warm` (Zuschauer haucht warm): taut eine Stelle frei, kurzer Dampf.
- Bei anhaltendem Frost friert es langsam wieder zu; je kälter, desto
  schneller.
- Rangliste wie beim Schneeschippen; Freude-Animation, wenn die Scheibe
  ganz frei ist.
- Zustand überlebt Reload (persistiert wie die Jahreszeiten-Events in
  `fx/season_db.py`).

### Deko-Ebene: Themen

Immer nur **ein** Thema aktiv, innerhalb des Themas Teile einzeln
schaltbar:

| Thema | Teile (heutige Herkunft) |
|---|---|
| Winter | Tannenbaum, Kugeln, Geschenke (xmas), Schneemann (winter) |
| Frühling | Blumen, Unkraut, Bienen (spring) |
| Sommer | Sandburg, Eis (summer) |
| Herbst | Kürbisse, Laub (autumn) |
| keins | nur Wetter |

- Optional „Thema nach Datum“; feste Wahl hat Vorrang.

#### Xmas-Zeit im Winter-Thema (vom Streamer bestätigt)

- Winter: Schnee, Frost, Schneemann. Xmas-Zeit zusätzlich: Tannenbaum,
  Kugeln, Geschenke; der Schneemann bleibt und trägt Weihnachtsmütze
  und Lichterkette. Follow/Sub bauen in beiden Zeiträumen am Schneemann.
- Zeitraum einstellbar, Standard 1. Advent bis 26.12.
- **Aufbau** (Baum wird aufgestellt, erste Kugeln hängen sich auf) und
  **Abschied** (Kugeln fallen nacheinander ab, Baum wird abgebaut,
  Geschenke-Rangliste ein letztes Mal) sind spiegelbildlich.
- Nicht an Mitternacht gebunden, weil der Streamer nicht 24/7 sendet:
  ab dem Datum ist Aufbau bzw. Abschied **fällig** (Server merkt es
  sich). Das Overlay spielt ihn, sobald die Source zum ersten Mal live
  im Programm ist (OBS-Browser-API `obsstudio.onActiveChange`), nach
  ca. 2 min Wartezeit. Danach „erledigt“, auch über Reloads und
  weitere Streams.
- Buttons „Set up“ und „Farewell“ in Live control lösen sofort aus,
  jederzeit — z. B. Aufbau schon Mitte November. Ein manueller Aufbau
  bzw. Abschied macht den fälligen automatischen für diese Saison
  hinfällig (kein zweiter Aufbau am 1. Advent).
- Erster Stream nach dem 26.12. erst, wenn schon ein anderes Thema
  aktiv ist (z. B. Frühling): Baum still entfernt, kein Abschied.
- Auch per Streamer.bot auslösbar (`cmd=setup`, `cmd=farewell`).
- Chat-Interaktionen der Themen (Follow hängt Kugel, Sub baut am
  Schneemann, `!water` gießt, …) bleiben, wie sie heute sind, und
  gelten fürs aktive Thema.
- Wetter wirkt auf die Deko: Regen gießt die Blumen, Hitze lässt den
  Schneemann schmelzen, Schnee bleibt auf dem Baum liegen.
- Die bisherigen Jahreszeiten-URLs werden Voreinstellungen dieser
  Source (z. B. „spring“ = Thema Frühling).

## Ton

- Standard: Source macht selbst **keinen** Ton. Ton spielt
  Streamer.bot in derselben Aktion, die den Befehl schickt (Muster wie
  heute beim Regen-Sound mit WAVs). Grund: Browser-Source-Audio in OBS
  setzt beim Streamer unter Windows regelmäßig aus.
- Ton im Browser bleibt als Schalter, getrennt nach Schicht:
  Dauerwetter (Standard aus), Ereignisse (an, blendet nach Ablauf aus),
  Akzente wie Blitz/Donner/Böe/Welle (an). Je ein Lautstärkeregler.
- Wechsel durch API oder K/D bleiben still.

## Übergänge

- Beim Wechsel einer Lage laufen bestehende Partikel zu Ende; neue
  entstehen in der neuen Art, Anteile verschieben sich über die
  Übergangszeit (Regen → Schneeregen → Schnee). Kein Tropfen
  verwandelt sich im Flug.
- Licht/Himmel/Nebel blenden über dieselbe Zeit.

## Migration

- `effects/rain.html` und `effects/snow.html` leiten auf die
  Weather-Source um, alte URL-Parameter (`intensity`, `wind`,
  `lightning`, Lautstärken) werden übernommen; ihre `cmd=`-Befehle
  (`start`, `stop`, `strike`, `gust`, `set`) funktionieren weiter.
- Die Jahreszeiten-Sources leiten auf die Weather-Source mit dem
  passenden Thema um. Gesammelte Daten (Kugeln, Blumen, Ranglisten in
  `season_db`/`xmas_db`) bleiben erhalten und erscheinen im Thema.
- Wetter-Code (Regen, Schnee, Wind, Blitz, Hitze, Laub) liegt danach an
  einer Stelle.
- Dashboard: Live control der Weather-Source mit Wetterlagen-Buttons,
  Lightning, Gust, Auto; Einstellungen für Ort, Stimmungsgrenzen,
  Stärke, Thema, Ton.
- README-Abschnitt neu, alte Abschnitte zu Rain/Snow/Jahreszeiten
  verweisen darauf.

## Festlegungen nach Prüfung (Calls des Konzepts, vom Streamer zu prüfen)

- **Alte Wetter-Schalter der Jahreszeiten** (`snowfall`/`snowstop`/
  `snowtoggle`, Regen an/aus, Hitze an/aus) werden zu „Erzwingen“ ohne
  Zeitlimit — sie verhalten sich also wie heute (an bleibt an). „Auto“
  bzw. der Aus-Befehl gibt an Schicht 1+2 zurück.
- **Echtes Wetter wächst die Deko** (Schneehaufen, Gießen, Frost). Damit
  ein Reload denselben Stand ergibt, schreibt der **Server** jeden
  Wechsel der wirksamen Lage ins Event-Log (`season_db`), nicht das
  Overlay. Das Overlay rekonstruiert wie heute aus dem Log.
- **Umgeleitete `rain.html`/`snow.html`-URLs** sehen aus wie vorher:
  sie bedeuten „Erzwingen“ der bisherigen Lage mit den alten Parametern,
  kein echtes Wetter. Echtes Wetter gibt es nur über die neue URL.
- **Frost:** Winter hat heute schon Frost mit `!scrape` und Rangliste.
  Die Frost-Ebene ist dieser Frost, verallgemeinert: wächst bei echter
  Temperatur ≤ 0 °C oder erzwungenem Schneesturm. `!scrape` (kratzen)
  bleibt, `!warm` (warm hauchen, mit Dampf) kommt daneben; beide zählen
  für dieselbe, übernommene Rangliste. (Vom Streamer bestätigt.)
- **Xmas + Winter → ein Thema „Winter“:** Xmas und Winter liefen nie
  gleichzeitig; die Xmas-Zeit ist ein Abschnitt im Winter (vom
  Streamer bestätigt). Ein Schnee-System (Haufen, Frost, Abschütteln)
  läuft durch beide Zeiträume, nichts wird beim Wechsel zurückgesetzt. Die Kanäle `/api/fx/xmas` und
  `/api/fx/winter` bleiben als Aliase gültig, bestehende
  Streamer.bot-Aktionen laufen weiter. Gesammelte Daten beider bleiben.
- **Einstellungen:** wie heute als URL-Parameter (Dashboard baut die
  URL, Live control setzt sie per `cmd=set`). Nur der **Ort** liegt in
  den Tenant-Einstellungen auf dem Server.
- **„Eigener Schnitt“** = K/D der aktuellen Season (Normal-Formel aus
  `reference_kd_formeln`, nur BR, alle eigenen Accounts). Stimmung
  wirkt erst ab 3 Runden der Session; davor neutral.

## Offen

Nichts. Geklärt am 2026-11-09:

- **Gewitter** = wie heute in `rain.html` (Starkregen, Wind, Blitze;
  `intensity=storm`, `lightning=2`), vom Streamer bestätigt.
- **Spektakel** (einmalig, über der aktuellen Lage, verstellen nichts):
  - Tsunami: Welle rauscht durchs Bild.
  - Mega-Blitze: kurzes Blitzgewitter mit sehr vielen Einschlägen.
  - Kugelblitz: leuchtende Kugel fegt quer durchs Bild.
  - Lawine: Schneelawine rollt durchs Bild.
- Interne Befehle englisch (`cmd=spectacle&type=tsunami|megabolt|
  ballbolt|avalanche`); die Chat-Wörter (`!tsunami`, `!lawine`, …)
  legt der Streamer in Streamer.bot fest.

## Entscheidungen, die beim Bauen fallen dürfen

- Wahl der Wetter-API (Vorschlag: Open-Meteo, kostenlos, ohne Key) und
  Abbildung ihrer Wettercodes auf unsere Lagen.
- Technik der Partikel (Canvas vs. DOM), sofern Rand-Fade und
  OBS-Performance passen.
- Genaue Übergangszeiten und Farbwerte im Rahmen oben.
- Ob Rain/Snow per HTTP-Redirect oder per dünner HTML-Hülle umgeleitet
  werden.
