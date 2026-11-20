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

## Kulissen-Modelle (Sketchfab, 2026-11-20)

- Der Nutzer hat je Thema Kandidaten gewählt („alle nehmen, wenn möglich“): 31 Modelle, 30 genutzt, der „Wooden
  Bridge Pack“ fällt weg (Baukasten aus 44 losen Teilen, keine fertige Brücke). Auswahl, Zielmaße und Eingriffe
  (entfernte Bodenplatten, Himmelskugeln, Figuren …) stehen in `assets/track-props/candidates.json`.
- Aufbereitung `scripts/build_track_props.py` (wie der Auto-Regen): Download auf dem Server (Token), gltfpack auf ein
  Dreiecksbudget je Modell, Texturen ≤ 512 px (Inseln 256 px), Normalen-/Rauheit-Texturen weg, normiert auf Meter
  (Fuß y = 0, Mitte, Längsseite entlang x; Tribünen mit der niedrigen Seite nach −z). Dateien nur auf dem Server
  (`data/track-props/`, Lizenzen), `catalog.json` mit `credits` (CC BY: Namensnennung im Car overview).
- Einbau `js/car-track-scene.js`: Themen melden je Deko-Art einen Platz-Typ (`ctx.kind(…, { prop: { slot, box } })`);
  Modelle eines Typs wechseln sich je Platz in Katalog-Reihenfolge ab (deterministisch). Laden erst nach dem Aufbau,
  nacheinander, im Overlay nie während des Rennens; Vorlagen (je Material ein Netz, einfarbige Materialien zu einem
  mit Ecken-Farbe) bleiben für weitere Rennen im Speicher; je Modell und Material ein InstancedMesh. Fehlt eine
  Datei: die prozedurale Deko bleibt. Kamerafahrten blenden Plätze über `setHidden` aus (gilt für beides).
- Modelle werden in ihren Platz nur verkleinert, nie vergrößert; kleine Tribünen stehen nebeneinander (bis 26 m).
