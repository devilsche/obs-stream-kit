# Car Drive: Kollision neu (echte Umrisse, kein Flipper) – Plan

Stand: 2026-11-24 · nicht gebaut, wartet auf „go“

## Befund

- **Testrennen G6DN78:** 3 Bots mit der Browser-Kollision (`CarDrivePhys.stepContacts`) hatten in 3 Runden 100 Crashs
  und 5.071 Berührungen. Das ist Dauerprellen und kein Fahren.
- **Umriss:** Die Kollisionsform ist das Rechteck der Modell-Bounding-Box (`car.w = d.W·k`, `car.len`).
  - Die Ecken stehen dort über, wo das echte Auto rund ist (Bug, Heck).
  - Spiegel und Kotflügel machen das Rechteck rundherum breiter.
  - So kracht es, obwohl sich die Karosserien sichtbar noch nicht berühren.
- **Flipper, Ursache 1:**
  - Fremdautos stehen für die Kollision dort, wo sie vor dem Puffer waren, also 100–350 ms in der Vergangenheit.
  - Bei 30 m/s sind das 3–10 m. Man rammt einen Geist, der Echte ist schon weiter.
- **Flipper, Ursache 2:**
  - Beide Clients schieben jeweils ihr eigenes Auto ganz aus der Überlappung, also zusammen doppelt so weit.
  - Das geschieht in einem Teilschritt, also als Sprung.
  - Das Fremdauto gibt bei mir nie nach. Deshalb stößt es in jedem Teilschritt erneut, und es entsteht eine Kette aus
    Mini-Stößen, die sich wie ein Bumper anfühlt.

## Ansatz

### 1. Echter Umriss statt Rechteck (`js/toy-cars.js`, `js/car-drive-phys.js`)

- **Umriss beim Laden:** Beim Laden des Modells wird einmal je Auto der Grundriss berechnet.
  - Dazu dienen alle Vertices der Karosserie zwischen 10 % und 70 % der Höhe, also ohne Räder unten und ohne Dach und
    Spiegelspitzen oben.
  - Daraus wird eine 2D-Hülle von oben (konvexe Hülle) mit höchstens 16 Punkten gebildet, in Metern, auf die echte
    Länge skaliert.
  - Der Umriss wird je Auto-Schlüssel zwischengespeichert.
- **Wo kein Modell geladen ist:** KI aus der Sim, Bots und der Server bekommen ein Rechteck mit abgerundeten Ecken
  (Radius 0,35 × Breite).
- **Kontakttest:**
  - Konvexe Polygone, Trennachsen über alle Kantennormalen beider Umrisse.
  - Kontaktpunkt per Kantenschnitt (clipping) statt Eckenmittel.
  - Die Breitphase bleibt wie heute.

### 2. Kein Geist: Kontakt mit der Gegenwart (`js/car-drive.js`, `js/car-drive-net.js`)

- **Gegenwart für die Kollision:**
  - Fremdautos werden für den Kontakt auf „jetzt“ vorausgesagt: letzte Meldung plus Tempo × Alter, entlang der Strecke
    wie beim Weiterfahren.
  - Dafür kommt eine neue Funktion `net.predict(id, T)` dazu.
- **Anzeige in der Nähe:**
  - Bei Abstand unter 12 m wird das Fremdauto weich zwischen Puffer-Lage und Voraussage überblendet.
  - So sitzt der Kontakt sichtbar dort, wo er passiert.
  - Weiter weg bleibt der Puffer (ruhig, ohne Zittern).

### 3. Weicher Kontakt statt Sprung (`js/car-drive-phys.js`)

- **Lagekorrektur:**
  - Je Teilschritt nur 25 % der Überlappung, höchstens 2 m/s Korrekturtempo, statt sofort ganz heraus.
  - Fährt man selbst hinein, bleibt es dabei, dass man nie durchfährt.
- **Lastverteilung im Mehrspieler:**
  - Jeder Client nimmt nur seinen Massenanteil von Lagekorrektur und Stoß.
  - Der andere rechnet bei sich die andere Hälfte, zusammen ergibt das einmal und nicht doppelt.
- **Stoß:**
  - Der Stoß gilt einmal je Berührung (Kontakt-ID je Paar, hält solange die Berührung dauert) statt in jedem
    Teilschritt neu.
  - Danach drückt nur noch eine Feder-Dämpfer-Kraft nach Überlappung.
  - Ergebnis: Nebeneinander fahren und Anlehnen geht, Rammen bremst ab, nichts federt weg.
- **Kontakt-Meldung `bump`:**
  - Ein Client meldet einen harten Kontakt über den WebSocket als `{t:"bump", id, jx, jz, at}`.
  - Der andere wendet den Stoß sofort an, statt ihn erst bei der eigenen Berührung zu bemerken.
  - Der Server leitet die Meldung nur weiter und begrenzt sie wie die Zustände.
- **Solo und Chatrennen:** KI als Gegner bleibt wie heute (Gegenstoß über `sim.hit`), nur mit Umriss und weichem
  Kontakt.

### 4. Prüfung

- **Neues Node-Skript `scripts/check_car_drive_contact.js`:**
  - **Nebeneinander:** Gleich schnell mit 0,1 m Überlappung über 5 s ergibt eine Querbewegung unter 0,5 m/s und keinen
    Crash.
  - **Auffahren:** Bei Δv 6 m/s wird der Hintere langsamer, der Vordere schneller, sie trennen sich mit höchstens
    0,15 × Δv, und es gibt genau einen Crash.
  - **Mehrspieler mit 150 ms Puffer:** Zwei Clients fahren nebeneinander, Kontakte pro Sekunde unter 2, kein Abstand über
    3 m.
  - **Umriss:** Ein Porsche-Grundriss liegt innerhalb der Bounding-Box, ist an den Ecken mindestens 15 % kleiner und hat
    höchstens 16 Punkte.
- **Testrennen:** Das Bot-Testrennen wird wiederholt. Ziel sind unter 5 Crashs und keine Kette aus Berührungen, danach
  ein Rennen mit dir.

## Kosten und Risiken

- **Voraussage:** Sie liegt bei harten Bremsungen kurz falsch, bis 0,1–0,2 s. Das ist besser als heute (immer
  0,1–0,35 s falsch).
- **Umriss:** Die Hülle aus dem Modell kostet einmal beim Laden etwa 5–20 ms je Auto. Ungewöhnliche Modelle (Ente,
  Bus) werden in der Prüfung mit abgedeckt.
- **Solo und Chatrennen:** Sie fühlen sich danach auch anders an. Die KI-Treffer im Chatrennen bleiben als Ereignis.
