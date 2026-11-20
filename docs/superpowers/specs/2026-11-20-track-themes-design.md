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
- Speedway-Ausbau (2026-11-20): Boxengebäude und Oberrang als Plätze mit Modellen statt grauer Klötze.
  - Boxen (slot `pits`): „Red Bull F1 Garage“ (paman0744, 272k Dreiecke). Außenhülle geschlossen (Betonhülle mit Dach,
    Seiten- und Rückwand, offen nur zur Boxengasse); entfernt: Boxengassen-Boden, Boxenmauer (70k), Hintergrundwand,
    Feuerlöscher, Monitore → ~12,8k Dreiecke, 22,5 × 4 × 13,7 m, zwei Boxen nebeneinander, Tor nach −z. Der Platz
    ist dafür 14 m tief freigehalten (vorher 10,5).
  - Oberrang (slot `upper`): 56 Plätze im Ring (Ersatz: der bisherige geneigte Rang als Instanz-Art, ein
    Zeichenaufruf), Front nach innen, kleine Modelle nebeneinander. Katalog-Feld `slots: [...]` (optional) lässt ein
    Modell für mehrere Platz-Typen gelten: die Tribünen (`stand`, jetzt 7 Typen inkl. „Race Track/ Stadium Viewing
    Stand“ und „Stands/Tribunes“) gelten auch für `upper`, dazu nur dort die Eck-Tribüne „Stadium Stand“
    (abhisekh_nath; eigentlich ein L-förmiges Eckstück mit drei LOD-Stufen, nur LOD2 genutzt).
  - `build_track_props.py`: Dreiecks-Budget bezieht sich jetzt auf das, was nach dem Entfernen von Teilen übrig ist
    (vorher auf das Original – mit `keepNode`/`dropNode` wurde viel zu stark reduziert).
  - Speedway gesamt: ~163k Dreiecke, 26 Zeichenaufrufe (vorher 43k / 8), 3,1 MB.
- Bäume (2026-11-20): 12 Sketchfab-Modelle (CC BY), Pakete in einzelne Bäume zerlegt – je Teil ein Eintrag mit
  derselben uid, `part` und `keepNode` (Datei `<uid>-<part>.glb`, Route erlaubt das Anhängsel; eine Quellenangabe je
  Modell). 26 Einträge, je ~0,1–3,3k Dreiecke (gltfpack, bei dichten Modellen `aggressive`), Texturen 256 px, Blätter
  behalten ihr Alpha; halbtransparente Blätter (BLEND) werden beim Aufbereiten zu MASK (alphaTest 0,5) –
  BLEND wird bei Hunderten Instanzen nicht sortiert (Flackern), MASK schreibt Tiefe (`cutout`, Standard für tree/palm). Optionales Katalog-Feld `themes` wie `slots`.
  - Wald (slot `forestTree`): 70 nahe Bäume (×Streckenlänge, 15–50 m) als eigene Art, Ersatz Nadelbaum; Modelle:
    Conifer, Comicstyle Fir, 4 Birken, 3 Eichen (klein/mittel/groß), 4 Detail-Bäume aus dem Low Poly Forest Tree Pack
    (dessen Atlas-Hintergrundbäume und Steine weggelassen). Ferne Bäume bleiben prozedural (Budget).
  - Alpen (slot `alpineTree`): 60 nahe Bäume, Pine Tree Proto, Poplar, dazu Conifer + Comicstyle Fir (`themes`).
  - Küste (slot `palm`): alle Palmen-Plätze; 4 von 10 Palmen aus dem Low Poly Palms Pack, 4 Palmen (Palm Trees),
    Coconut Tree.
  - Stadion + Kart (neu, slot `parkTree` / `treeRow`): Laubbäume 30–120 m neben der Strecke, Ersatz prozeduraler
    Laubbaum bzw. Dreier-Reihe; „Oak Tree | Game Ready“ einzeln, „Oak Trees FREE“ ist eine Dreiergruppe in einem
    Netz (nicht trennbar) → eigener Platz-Typ Baumreihe.
  - Gemessen (Seed 1–5): Speedway 216k / 31 Zeichenaufrufe, Twister 270k / 43, Hairpin 275k / 19, Coast 165k / 75,
    Kart 245k / 67; 2,1–8,5 MB je Thema.

## Fassaden, Werbung, Graffiti (2026-11-20)

Ziel: keine grauen, leeren Flächen mehr an Bauten der Kulisse.

- Inventur (vorher grau/einfarbig): Werbebanden (Farbfläche je Instanz), Stadion-Betonmauer, Industrie-Hintergrund
  (Silos grau, Schornsteine nur Streifen), prozedurale Ersatz-Halle und Ersatz-Boxen (graue Klötze), Container (nur
  Farbe), Modelle ohne Textur: „Stands/Tribunes“ (weiß), „Sports Bleachers“ (dunkelgrau), „Stadium Stand“ (grau),
  „Warehouse FBX Model Free“ (Blech dunkelgrau, ohne UV), „Red Bull F1 Garage“ (Hülle weiß/grau).
- Fehler gefunden: `propParts` verlor die zusammengefassten einfarbigen Materialien (Gruppe wurde während
  `order.filter` angehängt und vom Filter nie besucht). Modelle nur aus einfarbigen Materialien waren unsichtbar
  (Stands/Tribunes, Sports Bleachers, Stadium Light), bei Boxen und Lagerhalle fehlte die Hülle. Behoben; damit die
  Kulissen im Budget bleiben, sechs Modelle mit kleinerem Dreiecks-Budget neu aufbereitet (Stadium Light 2,4k statt
  12k, Tribünen 1,8–2k, Warehouse 5k).
- Ein Atlas `CarTrackThemes.Art` (Canvas 2048 × 1024, zur Laufzeit gezeichnet, seitenweit geteilt, ~11 MB GPU mit
  Mipmaps, 0 Byte Download): 16 Fassaden-Kacheln (Beton, Büro-Fenster, Wellblech hell/rostig, Ziegel, Ziegel mit
  Fenstern, Dach, Silo, Publikum, Sitze, Rolltor, Holz, Beton verschmutzt, Fensterband, Paneele, Glas), 8 Werbeflächen
  mit frei erfundenen Sponsoren (Purple Peak, Golden Lap, Hypernoodle, Turbo Taco, Zephyr Fuel, Pixel Piston, Comet
  Cola, Gripworx – keine echten Marken), 6 Graffiti.
- Ein Material-Typ (`Art.material`): Kachel je Ecke (`aTile`, `aStep`: wiederholen/einmal), Farbe = Ecken-Farbe ×
  Textur, wo die Textur durchsichtig ist nur Ecken-Farbe; Kachel je Instanz über `iVar` (Banden, Graffiti). Mip-Stufe aus
  der ungebrochenen UV (`textureGrad`, gedeckelt), keine Nähte am Kachelrand. Kit-Teile tragen die Kachel (`Kit.add`
  `tile`/`uv: geo|box|cyl`/`faces`/`vary`), der Hintergrund bleibt eine Geometrie, jede Deko-Art ein InstancedMesh.
- Einsatz: Werbebanden (Sponsor je Bande, 2–4 gleiche hintereinander), Stadion-Mauer-Front (3-m-Felder, Schrift von der
  Strecke aus lesbar), Ersatz-Boxen/-Halle, Industrie-Silos/-Schornsteine, Kart: Graffiti-Mauern (8, längs zur Strecke)
  und Graffiti an der Außenseite äußerer unterer Container (sitzt ein Modell dort: auf dessen gemessener Seitenwand,
  `onProp` mit `faceZ`). Einfarbige Modelle über Katalog-Feld `paint` (`seats`, `warehouse`, `pits`, in
  `candidates.json`, vom Build-Skript durchgereicht): Teile ohne Textur bekommen Kacheln nach Flächen-Richtung
  (Box-Projektion) – Tribünen Publikum, Rückseite Werbeband, Seiten Beton; Halle Wellblech + Dach; Boxen helle Teile
  Paneele + Dach.
- Gemessen (Kulissen-Modelle, Seed 1–5): Speedway 297k / 39, Twister 278k / 44, Hairpin 275k / 19, Coast 173k / 76,
  Kart 282k / 68. Ganze Szene (Gelände, Fahrbahn, Deko, Modelle): Speedway 50 → 58 und Kart 84 → 87 Zeichenaufrufe
  (Graffiti-Aufkleber, Graffiti-Mauern und durch den Fix wieder sichtbare Modellteile), sonst +0/+1.
