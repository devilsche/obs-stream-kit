# Car Race – Chat-Autorennen als Mini-Overlay (Design)

Stand: 2026-11-19 · Status: Konzept, nicht gebaut

## Wozu

Ein kleines Rennen, das nebenher im Stream läuft: Zuschauer melden sich mit `!race` an, bekommen ein
zufälliges echtes 3D-Auto aus dem Katalog (`data/car-rain`) und fahren gegeneinander. Unterhaltung plus
Langzeit-Motivation über Punkte (monatlich + ewige Bestenliste). Baut auf dem Auto-Bestand auf
(Car editor, Farbsets, Räder, Burnout) und gibt den gepflegten Autos einen zweiten Auftritt.

## Ziele

- Mini-Overlay, stört das Spiel nicht: 16:9, Standard 640×360, höchstens 960×540 (¼ des Bildes).
- Anmeldung per `!race`, 3–10 Teilnehmer, Startreihenfolge = Anmeldereihenfolge.
- Jedes Auto hat eigene Werte (PS, Gewicht, Top speed, Handling, Federung, Bremsen, Antrieb) aus dem Car editor.
- Rennen 60–90 s, Platzierung live, Siegerehrung, Punkte monatlich + ewig.
- Testbar ohne OBS/Streamer.bot: Vorschau-Rennen im Dashboard.

## Nicht-Ziele

- Keine Steuerung durch Zuschauer während des Rennens (keine Echtzeit-Eingabe aus dem Chat).
- Keine echte Physik-Engine, keine Kollisionsphysik.
- Kein Strecken-Editor in Version 1 (Strecken kommen aus dem Code, siehe unten).
- Keine Wetten/Kanalpunkte-Einsätze in Version 1.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Das Fenster ist groß oder lange sichtbar und verdeckt das Spiel.
- Das stärkste Auto gewinnt immer (kein Zufall, keine Spannung).
- Ruckeln oder Ladepausen in OBS (zehn 10-MB-Modelle).
- Autos bleiben hängen, fliegen weg oder fahren falsch herum.
- Punkte werden doppelt oder aus dem Vorschau-Rennen gezählt.

## Rahmenbedingungen

- Vanilla JS, three.js r128 (wie Burnout), keine Build-Tools; keine Inline-Styles; Frontend-Texte englisch.
- Chat liest nur Streamer.bot; `serve.py` hört nicht mit (siehe `project_streamerbot`).
- Multi-Tenant: alles je Tenant (Token-Route `/s/<token>/api/fx/...`, Tabellen mit `tenant_id`).
- Modelle der Lizenz „Free Standard“ nie ins Repo; nur vom Server ausliefern (wie heute `api/fx/cars/model/<uid>.glb`).
- Effekte starten beim Laden; in OBS „Shutdown source when not visible“.

## Ansätze (Fahrlogik)

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | **Gerechnetes Fahren auf der Ideallinie.** Jedes Auto hat Streckenposition `s` und Seitenversatz `d`; Tempo aus Werten und Kurvenradius, Zufallsereignisse. | Flüssig, robust, nie festgefahren, gleicher Seed = gleiches Rennen; sieht bei 60×30 px echt aus. Keine echten Crashes. |
| B | Physik-Engine (Rapier) + KI-Fahrer | Echte Kollisionen; aber Abstimmung aufwendig, Autos bleiben stecken, mehr CPU in OBS. |
| C | Server rechnet Ergebnis, Overlay spielt ab | Fälschungssicher; Logik doppelt (Python + JS), Bild und Ergebnis laufen leicht auseinander. |

Gewählt: **A** (vom Nutzer bestätigt). Dashboard-Vorschau und OBS laufen getrennt; nur OBS zählt.

## Ablauf eines Rennens (vom Nutzer festgelegt)

1. Ein Zuschauer schreibt `!race` → Anmeldung offen, im Stream noch nichts sichtbar.
2. Ab dem **3.** Teilnehmer blendet das Fenster ein: Strecke + Startaufstellung + Countdown **60 s**.
3. Jeder weitere `!race` (4.–10.) bekommt ein Zufallsauto, das sichtbar in den nächsten Startplatz rollt.
   Startplatz = Anmeldereihenfolge (1. Anmeldung = Pole).
4. Start nach Ablauf der 60 s, oder sofort beim 10. Teilnehmer.
5. Rennen (Ziel ~60 s Fahrzeit), dann Siegerehrung (~10 s), dann ausblenden.

Vorschläge (vom Nutzer nicht widersprochen, im Bau anpassbar):
- Doppeltes `!race` derselben Person zählt einmal.
- Unter 3 Anmeldungen: Lobby verfällt still nach 5 min.
- `!race` während eines laufenden Rennens zählt nicht.
- 2 min Pause nach einem Rennen, bevor eine neue Anmeldung öffnet.

## Darstellung (vom Nutzer festgelegt)

- **Start:** Kamera näher an der Startaufstellung, Autos gut erkennbar; Neuzugänge rollen sichtbar ein.
- **Rennen:** mitschwenkender Ausschnitt (vom Nutzer gewählt: Variante b+c). Die Kamera folgt dem Pulk und
  zoomt so weit heraus, dass Führender und Letzter ins Bild passen; Autos dabei ca. 20–60 px lang (Ziel ~60×30 px
  bei dichtem Feld). Ist das Feld zu weit auseinander (Zoom-Grenze), folgt sie der Spitzengruppe; der Rest steht
  in der Rangliste. Weiche Kamerafahrten, keine Nah-Schnitte.
- **Siegerehrung:** Schnitt aufs Podest, drei Erste groß, Sieger vorn; Platz, Punkte dieses Rennens,
  neuer Gesamtstand („+10 → 47 pts · #2 this month“).
- **Namensschild** über jedem Auto: Platz + Name, Rand in der Twitch-Chatfarbe; als Sprite in der
  3D-Szene (feste Bildschirmgröße), nicht als DOM-Element (keine Inline-Styles). Bei Gedränge kleiner/blasser,
  vorderste bleiben voll.
- **Rangliste** live am Rand (kompakt, alle Plätze bei ≤ 10).
- Rahmen im Theme-Look (`--theme-*`), Rand-Fade, `prefers-reduced-motion` respektieren (Kamerafahrten ruhiger).

## Maßstab (Variante b+c, vom Nutzer gewählt)

Autos behalten ihre echten Größenverhältnisse (über `len` auf echte Länge skaliert, wie heute: Bus groß,
Kleinwagen klein). Strecke und Tempo sind dagegen **spielzeughaft kompakt** (Kartbahn-/Micro-Machines-Gefühl):
Runde ca. 300–500 m, Strecke ~10 m breit, enge Kurven (Radien ~12–50 m), Tempo im Rennen herunterskaliert
(Durchschnitt grob 10–15 m/s), 2–3 Runden ≈ 60 s. Die Unterschiede zwischen den Autos (PS, Top speed …) wirken
relativ zueinander, nicht als echte km/h. Kamera in Metern; die Fenstergröße ändert nur den Ausschnitt.
Grund: Bei 640×360 und ~60 px Autolänge sieht man nur ~50 m Strecke; eine echte Runde wäre zu groß, das
Feld zöge zu weit auseinander.
`len` wird je Auto im Car editor einstellbar (Race stats), weil die Namens-Tabelle im Build-Skript grob ist
(Bus, Ural, Krabby Patty Wagon).

## Strecke

- Aus dem Code erzeugt: geschlossene Catmull-Rom-Kurve aus einem **Seed** → Asphaltband mit Curbs,
  Leitplanken, Wiese, ein paar Bäume/Tribünen (einfache Geometrie, keine großen Modelle).
- Strecke so dimensioniert, dass 2–3 Runden ≈ 60 s für ein Durchschnittsauto ergeben (siehe Maßstab).
- Ideallinie, Kurvenradien und Bremszonen werden aus der Kurve berechnet.
- Strecke je Rennen zufällig aus einer Liste guter Seeds (Favoriten im Code), Vorschau kann den Seed setzen.
- Später möglich: Strecken-Editor (Punkte setzen) als Erweiterung.

## Fahrlogik (Ansatz A)

- Zustand je Auto: `s` (Meter entlang der Linie), `d` (Seitenversatz), `v`, Runde.
- Zielgeschwindigkeit je Streckenpunkt: min(Top speed, Kurvengrenze aus Handling/Grip und Radius).
- Beschleunigung aus Leistungsgewicht (PS/Gewicht) und Antrieb (Traktion am Start), Bremsen aus Bremswert.
- Federung: sichtbares Wanken/Nicken, leichter Zeitverlust auf welligen Abschnitten.
- Überholen: dicht hinter einem langsameren Auto weicht `d` aus; Windschatten gibt kleinen Tempobonus.
- Kontakt (Nutzerwunsch): Berühren sich zwei Autos, schubst das schwerere/größere (Masse aus Weight und Länge) das leichtere zur Seite und bremst es; kleine Dreher-Chance für das leichtere. Ein Bus räumt also Kleinwagen ab, umgekehrt kaum.
- Abflug (Nutzerwunsch): zu schnell in der Kurve → das Auto rutscht nach außen über den Rand ins Gras/Kiesbett, verliert Zeit und fährt zurück; selten Einschlag in die Leitplanke = DNF. Strecke bekommt dafür Auslaufzonen.
- Zufall (aus Seed): Verbremser, Dreher (kurzer Halt, Auto dreht sich), guter/schlechter Start.
  Gewichtung so, dass Außenseiter realistisch gewinnen können: Pech-Ereignisse (Dreher, Crash mit längerem
  Stillstand) werden mit dem Tempo wahrscheinlicher, Windschatten hilft Hinterherfahrenden, Start mit Glücksanteil.
  Messlatte (Nutzerwunsch „ob ein Truck oder Bus jemals erster wird?“): über 1000 simulierte Rennen gewinnt der
  Bus gegen ein starkes Feld mindestens 2 %, das stärkste Auto höchstens 45 %.
- Räder drehen und lenken über die vorhandene Rad-Struktur (`Spin`, Lenk-Pivot), weich wie im Burnout.
- Ziel (vom Nutzer festgelegt): Platzierung = Reihenfolge beim Überqueren der Ziellinie. Nach dem Sieger bleiben
  höchstens **X Sekunden** (Standard 15 s, einstellbar), dann ist Schluss. Wer bis dahin nicht im Ziel ist, ist
  **DNF: ohne Platz, ohne Punkte** (in Rangliste und Podest als „DNF“). Ein schwerer Crash kann ebenfalls DNF sein.

## Werte je Auto („Race stats“ im Car editor)

Neuer Abschnitt im Car editor, gespeichert im Fahrzeug (`data/car-vehicles.json`), z. B.
`race: {on, power, speed, handling, susp, brakes, weight, drive: "fwd"|"rwd"|"awd", len}` – **Verhältnis-Werte 1–10**,
keine echten PS/km/h (Nutzerwunsch: nur im Verhältnis; ein Bus ist eben langsamer als ein Lambo).
- Startwerte: geschätzt nach Modell/Klasse (Liste im Code, z. B. Sportwagen/Limousine/Truck/Bus/Spaß-Auto),
  der Nutzer korrigiert.
- Welche Autos mitfahren dürfen: alle im Katalog, die im Mix sind (`mix`) – im Editor zusätzlich
  „Race: on/off“.

## Leichte Renn-Modelle

Katalog-Modelle sind 2–15 MB, den größten Teil machen Texturen aus. Das Build-Skript erzeugt je Auto zusätzlich
eine Renn-Version mit **unveränderter Geometrie** und Texturen auf 256 px, ausgeliefert als
`api/fx/cars/model/<uid>.race.glb` (fehlt sie: das normale Modell). Entscheidung Claude: keine Vereinfachung,
weil jede Geometrie-Änderung die Teile-Schlüssel verschiebt (beim Trolza-Neubau gesehen) und Farbzonen, Lack-
und Radteile dann nicht mehr passen. Geladen wird während des 60-s-Countdowns, Browser-Cache 7 Tage. Siegerehrung lädt
den Sieger in voller Qualität nach (Fallback: Renn-Version).

## Daten und Schnittstellen

**Lobby/Rennen (flüchtig, In-Memory je Tenant, wie `fx/commands.py`):**
- `POST /s/<token>/api/fx/race/join` – Streamer.bot meldet `user`, `color` (Chatfarbe). Server: Duplikate,
  max 10, Sperren während Rennen/Pause, Zufallsauto (aus Mix + Race on), Rennen-ID + Seed.
- `GET /s/<token>/api/fx/race/state` – Overlay pollt 1×/s: Phase (`idle|lobby|countdown|race|podium|cooldown`),
  Teilnehmer (Name, Farbe, Auto, Farbset, Startplatz), Countdown-Ende, Seed, Rennen-ID.
- `POST /s/<token>/api/fx/race/result` – Overlay meldet Platzierung je Rennen-ID; Server zählt nur die erste
  Meldung je ID und nur für echte (nicht Vorschau-)Rennen.
- Nach Server-Neustart geht eine offene Lobby verloren (akzeptiert).
- **Server führt die Uhr** (Entscheidung Claude): Phasenwechsel lobby → countdown → race → podium → cooldown nach
  Zeitgrenzen (Countdown 60 s, Rennen max. 90 s, Podium ~10 s). Die Fahrsimulation läuft mit festem Zeittakt und
  ist aus dem Seed vorspulbar: ein Overlay, das mitten im Rennen eingeblendet wird, springt zur aktuellen Rennzeit.
  Meldet bis 2 min nach dem Start kein Overlay ein Ergebnis, wird das Rennen nicht gewertet.
- **Spieler-Identität** (Entscheidung Claude): Twitch-User-ID aus Streamer.bot (`userId`) als Schlüssel; Login
  und Anzeigename werden mitgespeichert (Anzeige = zuletzt bekannter Name). Umbenennung teilt keine Punkte.

**Punkte (dauerhaft, DB je Tenant, Muster `fx/season_db.py`):**
- Tabelle `fx_race_result (tenant_id, race_id, at, user_id, login, display, place, field, points, car_key, void)`;
  `place` NULL = DNF.
- Punkte = Anzahl geschlagener Fahrer + 1 Bonus für den Sieg (3 Fahrer: 3/1/0; 10 Fahrer: 10/8/7/…/0).
  Geschlagen zählen alle hinter einem, auch DNF. DNF = 0 Punkte, zählt als Rennen, nicht als Ergebnis.
- Monatsstand und ewige Liste werden aus den Ergebnissen berechnet (Summe Punkte, Rennen, Siege, Podien,
  bestes Ergebnis). Monatsmeister = Monatserster nach Punkten (Gleichstand: mehr Siege, dann früher erreicht).
- Auto-Statistik nebenbei: Siege/Rennen je `car_key` (zeigt, ob die Werte ausgewogen sind).
- `GET /s/<token>/api/fx/race/board?scope=month|all` – Rangliste (Dashboard, Widget, später `!racestats`).

**Eingriffe (Entscheidung Claude):** im Dashboard „Cancel lobby“, „Start now“, „Void race“ (Rennen wird aus
Monats- und ewiger Wertung herausgerechnet, `void`), „Remove racer“ (Lobby). Admin-/Tenant-Rechte wie die
übrigen Dashboard-Aktionen; Mods später über Streamer.bot.

**Vorschau im Dashboard:** eigener Modus `?preview=1` mit Testfahrern (3–10 wählbar, Knopf „Add test racer“),
ohne Server-Lobby, schreibt nichts.

## Dateien (Vorschlag)

- `effects/car-race.html` + `js/car-race.js` (Overlay), Strecke/Fahrlogik ggf. `js/car-race-track.js`, `js/car-race-sim.js`.
- `fx/race.py` (Lobby in Memory), `fx/race_db.py` (Ergebnisse), Endpoints in `fx/endpoints.py`.
- Car editor: Abschnitt „Race stats“. Build-Skript: Renn-Version.
- Dashboard: Effekt-Eintrag mit Vorschau + Rangliste.
- Tests: `tests/fx/test_race.py` (Lobby-Regeln), `tests/fx/test_race_db.py` (Punkte, Monat, ewig).
- README.

## Offen für den Bau

- Genaue Startwerte der Klassen, Zufallsgewichtung, Rundenzahl/Länge je Seed (ausprobieren).
- Optik von Strecke, Schildern, Podest (Nutzer beurteilt).
- Streamer.bot-Aktion `!race` (später, wenn der Streaming-PC erreichbar ist) und `!racestats`.
