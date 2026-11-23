# Chatrennen: Server fährt die KI (Weg 2) – Plan

Stand: 2026-11-23 · nicht gebaut, wartet auf „go“

## Ziel

Im Chatrennen sehen die KI-Autos die Car-Drive-Piloten und reagieren in Echtzeit: Sie fahren hinterher, überholen
außen herum und fahren nicht mehr durch die Piloten hindurch, so wie heute im Solo-Rennen. Overlay und alle Fahrer
zeigen dieselben KI-Positionen.

## Heute

- Die KI rechnet jede Instanz selbst aus Seed + race_events (js/car-race-sim.js, deterministisch): das Overlay
  (js/car-race.js) und jeder Fahrer (js/car-drive.js, rcBuildSim).
- Piloten sind in der Sim „Geister“: Die KI kennt ihre Lage nicht, weil sie nicht in allen Instanzen gleich vorläge.
- Das Overlay meldet am Ende die Plätze an Flask (accept_result), die Piloten-Zeiten kommen vom WS-Dienst.
- Weg 1 (Treffer als Ereignis, 84af127) wirkt bereits überall, aber nur 0,25 s verzögert und ohne Ausweichen.

## Ansatz

Der WS-Dienst (drive_ws.py, obs-drive) startet je laufendem Chatrennen einen Node-Kindprozess mit derselben Sim
(scripts/race_sim_host.js). Der Prozess rechnet das Rennen live mit den Piloten als Hindernissen (setObstacles,
gibt es schon für Solo). Er schickt die KI-Lage 20-mal pro Sekunde zurück, und der WS-Dienst verteilt sie wie die
Piloten-Zustände.

**Verworfen:**
- **Sim nach Python übersetzen:** 20- bis 50-mal langsamer, und zwei Fassungen liefen auseinander.
- **Piloten-Positionen als Ereignisse in die deterministische Sim:** Jede verspätete Meldung erzwingt ein
  Nachrechnen ab dem Start, bei 10 Meldungen pro Sekunde und Pilot ist das zu viel. Die KI würde außerdem auf
  0,3 bis 0,5 s alte Lagen reagieren.

**Last:** Ein Rennen braucht etwa 0,13 % eines Kerns, das Senden etwa 8 KB/s pro Verbindung. Prod hat 4 Kerne.

## Kosten und Risiken

- **Node auf Prod:** `apt install nodejs`. Ubuntu 26.04 liefert Version 22.22, das passt.
- **Nicht mehr deterministisch:** Ein Rennen mit Piloten lässt sich nicht mehr aus Seed + Ereignissen nachrechnen.
  Wer neu lädt, bekommt die Lage aus dem laufenden Strom. Rennen ohne Piloten bleiben wie heute.
- **Der Server wird Pflicht:** Fällt der Kindprozess aus, rechnen Overlay und Fahrer ab der letzten bekannten Lage
  selbst weiter (heutiges Verfahren, ohne Ausweichen). Die Plätze liefert in dem Fall das Overlay.
- **Verzögerung:** Das Overlay zeigt die KI wie die Piloten etwa 100 bis 150 ms verzögert. KI und Piloten passen
  dort also besser zusammen als heute. Car Drive sagt die KI um die Laufzeit voraus.

## Aufgaben

### 1. Sim-Host in Node (scripts/race_sim_host.js)

- Liest JSON-Zeilen auf stdin:
  - `start {seed, track, laps, fw, cars, events, starts_at}`
  - `p {t, d: [[id, x, z, yaw, speed, prog], …]}` (Piloten)
  - `ev {…}` (nitro, bump, hit, takeover, release)
  - `stop`
- Rechnet in festen Sim-Schritten nach der Server-Uhr. Piloten → Hindernisse `{s, d, v, len, w}`, d per
  Projektion auf die Strecke (neue Funktion in der Sim, die Car Drive mitbenutzt).
- Schreibt `A {t, d: [[i, s, d, x, z, yaw, steer, speed, spin], …]}` mit 20 Hz und am Ende `R {places, times}`.
- Ein Treffer gilt im Live-Rennen sofort, ohne HIT_LEAD.
- **Prüfung (Node-Skript):**
  - Ein Pilot steht auf der Ideallinie, die KI fährt nie in ihn hinein und überholt ihn.
  - Ohne Piloten ist das Ergebnis bitgleich zur heutigen Sim.

### 2. WS-Dienst (drive_ws.py, fx/drive_race.py)

- Flask schickt im Abgleich zusätzlich mit: `seed`, Fahrzeug-Stats je Fahrer und `events`
  (fx/race.drive_info erweitern).
- Bei Rennstart mit mindestens einem Piloten startet der Dienst den Kindprozess (asyncio subprocess). Er reicht ihm
  die Piloten-Zustände, Treffer, Übernahmen, Nitro und Bump weiter und verteilt `A` an alle Verbindungen des
  Tenants.
- Beim Ende kommen die Plätze aus `R` an Flask (accept_result), das Overlay meldet dann nichts mehr.
- Zeitlimits:
  - Startet der Kindprozess nicht innerhalb von 2 s oder schweigt er 1 s, gilt `ai_live: false`.
  - Das wird im race-Objekt verteilt, die Clients rechnen dann selbst.
- Höchstens ein Kindprozess je Tenant. Nach Rennende plus Auslauf wird er beendet.
- **Tests (pytest):** Start und Stopp mit einem falschen Kindprozess, `A` wird verteilt, Ausfall setzt
  `ai_live: false`, `R` geht an accept_result, ohne Piloten startet kein Prozess.

### 3. Overlay (js/car-race.js)

- Bei `ai_live` zeigt es die KI aus `A` mit demselben Puffer und derselben Interpolation wie die Piloten.
  Die eigene Sim läuft nur noch für Vorstellung und Startaufstellung.
- Ausfall oder Lücke über 1 s: Es übernimmt die letzte Lage in die eigene Sim (follower ab dieser Lage) und rechnet
  weiter.
- Neu laden mitten im Rennen: Es wartet auf das erste `A`.

### 4. Car Drive (js/car-drive.js)

- Im Chatrennen mit `ai_live` kommen die KI-Autos aus `A`.
  - Sie werden um die gemessene Laufzeit vorausgesagt (Tempo × Δt entlang der Strecke).
  - Kein rcBuildSim-Nachrechnen mehr.
- Kollision bleibt wie heute: KI als kinematischer Schieber, Treffer per WS. Der Server wendet ihn jetzt sofort an.
- Ausfall: dasselbe Verfahren wie beim Overlay.
- **Prüfung:** Bestehender Car-Drive-Check plus ein Fall „KI aus Strom, Ausfall nach 10 s → lokale Sim übernimmt
  ohne Sprung“.

### 5. Deploy und README

- README: Abschnitt Chatrennen, Datenfluss und Ausfallverhalten.
- docs/drive-systemd.service.example: Node als Voraussetzung.
- Prod:
  - `apt install nodejs`
  - `git pull --ff-only`
  - Dienste neu starten: obs-api, obs-stream-kit, obs-overlays, obs-drive
- Danach ein Testrennen mit einem Piloten, du schaust zu.

## Offen für dich

- Reicht dir das Ausfallverhalten (lokal weiterrechnen ohne Ausweichen), oder soll das Rennen bei einem
  Server-Ausfall lieber kurz anhalten?
