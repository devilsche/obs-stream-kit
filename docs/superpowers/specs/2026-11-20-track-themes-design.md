# Strecken-Themen (Konzept)

Stand: 2026-11-20 · Status: freigegeben („go“), Bau nach dem Dashboard-Umbau

## Wozu

Die fünf Car-Race-Strecken sehen außen herum zu gleich aus. Jede Strecke bekommt ein eigenes Thema (Umgebung, Licht,
Boden, Himmel) und optisches Höhenprofil – im Chat-Rennen-Overlay (`js/car-race.js`) und in Car Drive, beide über
`js/car-track-scene.js`.

## Themen

- **Speedway** – Stadion: große Tribünen, Flutlichtmasten, Werbebanden, Fahnen, Boxengasse; flach.
- **Twister** – Wald: Nadelbäume, Felsen, Holzzaun, Bach mit Brücke; sanfte Hügel.
- **Hairpin** – Alpen: Berge im Hintergrund, Felswände, Schneereste, Kehren am Hang; deutliches Auf und Ab.
- **Coast** – Küste: Meer, Strand, Palmen, Leuchtturm, Klippe; leichtes Auf und Ab.
- **Kart** – Industrie: Reifenstapel als Begrenzung, Container, Lagerhalle, Asphaltflächen; flach.

Je Thema eigener Himmel, Licht und Bodenfarbe (z. B. warme Abendstimmung an der Küste, kühles Licht in den Alpen).

## Entscheidungen

- Höhe ist **nur Optik**: Sim (`js/car-race-sim.js`) und Fahrphysik (`js/car-drive-phys.js`) bleiben 2D; Autos folgen
  der Geländehöhe sichtbar und neigen sich mit. Rennergebnisse ändern sich nicht (Determinismus bleibt).
- Deko zuerst **prozedural low-poly** (Spielzeug-Stil, schnell geladen, Instancing); später einzelne Blickfänger als
  Sketchfab-Modelle (Leuchtturm, Lagerhalle, Brücke, Tribüne) – Kandidaten wählt der Nutzer wie bei den Autos.
- Leistung: Overlay-Budget wie bisher (Instancing, wenige Zeichenaufrufe, Render-Auflösung passt sich an).
- Deko darf Kameras (Podest, Totale, TV-Kameras) nicht verdecken; Auslauf/Kiesbett/Leitplanken bleiben frei.
