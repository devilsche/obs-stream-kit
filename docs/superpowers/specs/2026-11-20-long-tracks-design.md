# Lange Strecken, Drift, Begrüßung (Konzept)

Stand: 2026-11-20 · Status: freigegeben (Nutzer-Antworten), Bau nach Strecken-Oberfläche und Motor-Sounds

## Entscheidungen (Nutzer)

- Strecken **3× so lang**, Chat-Rennen **2 Runden** (~2:20 min). Neue Streckenführung je Strecke (mehr Kurven,
  Geraden, Schikanen) – nicht einfach strecken.
- **Kart bleibt deutlich kürzer** als die anderen und eng/verwinkelt („dafür ist es Kart“): große Supersportwagen
  haben dort einen Nachteil (Länge/Breite/Wendekreis zählen in engen Kurven), wendige Autos (Krabby Patty, Kleinwagen)
  einen Vorteil.
- **Drift** als Fahrzeugeigenschaft: manche Autos driften besser als andere (Car Drive: Heckverhalten, Handbremse,
  Gegenlenken; Sim: Kurvenspeed in engen Kehren / Abfluggefahr). Wert je Auto in den Race stats (Schätzung nach
  Antrieb, Gewicht, Radstand; im Car editor änderbar).
- **Rundenrekorde zurücksetzen** (alte Strecken nicht vergleichbar).
- **Begrüßung vor dem Start** (Need-for-Speed-Klassiker als Vorbild, eigene Gestaltung): „WELCOME TO <Strecke>“ zu
  Beginn der Fahrervorstellung, „START YOUR ENGINES“ vor der Ampel, Motoraufheulen des Feldes; in Car Drive vor dem
  Countdown. Theme-Farben, bei reduzierter Bewegung stehend. Keine Sprachausgabe (OBS hat meist keine Stimme).

## Umsetzung (grob)

- `js/car-race-sim.js` LAYOUTS neu (Längen ×3, Kart ~×1,3 und enger), Kurvenbreite/-radien so, dass Fahrzeuggröße
  zählt; Balance-Prüfung über 1000 Rennen (`scripts/check_car_race_sim.js`) mit neuen Zielwerten.
- `fx/race.py`: LAPS 2, RACE_MAX/Ziel-Frist an die Rundenzeit anpassen; Overlay-Kamera (Feld im Bild) prüfen.
- Car Drive: Standard-Runden, Plausibilität (Mindest-Rundenzeiten, `drive-limits.json`) neu.
- Kulisse/Blickfänger folgen der neuen Streckenführung (Plätze aus der Strecke abgeleitet).
- Rekord-Tabelle `obs.fx_race_lap_record` leeren.
