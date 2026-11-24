# Kart in der alten Halle – Plan

Stand: 2026-11-24 · „go“ erteilt

## Ziel

Die Kartbahn liegt in einer großen, alten Industriehalle: Wände aus Wellblech über einem Betonsockel, Stahlstützen,
Fachwerkträger unter dem Dach, Oberlichter, Hallenstrahler, Rolltore, Graffiti. Am Rand stehen Container und Fässer.
Begrenzung sind weiterhin Reifenstapel. Es gibt keinen Himmel, das Licht kommt von oben.

## Ansatz

- **Neues Thema `hall`** in `js/car-track-themes.js`.
  - Kart → `hall` (`BY_LAYOUT`). Das Außen-Thema `industrial` bleibt im Code und wird nicht mehr zugeordnet.
- **Hülle selbst gebaut**, passend zur Bahn: Ausdehnung der Strecke + Fahrbahn + 26 m Rand je Seite (Kart ≈ 165 × 150 m),
  16 m hoch.
- **Puppenhaus-Prinzip:**
  - Wände und Dach sind nur von innen sichtbar (einseitige Flächen, nach innen gerichtet).
  - Kameras außerhalb (Overlay-Regie, hohe Einstellungen) schauen ungehindert hinein.
  - Kameras innen (Car Drive) sehen eine geschlossene Halle.
- **Kein Himmel** (`theme.indoor`):
  - Die Kuppel entfällt, Nebel und Hintergrund in Hallengrau.
  - Die Sonne steht fast senkrecht und ist leicht warm, die Hemisphäre gedämpft.
- **Kulissen-Modelle:**
  - Die Halle nutzt die vorhandenen Container und Container-Gruppen aus dem Industrie-Katalog mit
    (`theme.propTheme = 'industrial'`).
  - Teile aus den Sketchfab-Hallen (Stützen, Tore, Schutt) und das Race Track Assets Pack kommen in Runde 2, nach
    deinem ersten Eindruck.

## Aufgaben

1. **Szene (`js/car-track-scene.js`):**
   - `theme.indoor` = keine Himmelskuppel.
   - `theme.propTheme` = Katalog-Thema für die Modelle.
2. **Thema `hall`:**
   - Boden aus Beton mit Flecken, außerhalb der Halle dunkel.
   - Hülle: Wellblech, Betonsockel, Fensterband.
   - Stützen alle 12 m, Fachwerkträger, Oberlichter (leuchtend, nur von unten sichtbar), Hallenstrahler am Untergurt.
   - Rolltore, Graffiti an den Wänden.
   - Container an den Wänden, Fässer.
   - Reifenstapel als Begrenzung wie bisher, kein Gras, keine Bäume.
3. **Prüfung:** Alle Strecken bauen im Headless-Chrome fehlerfrei. Die Anzahl der Dreiecke für die Halle bleibt im
   Rahmen der anderen Themen.
4. **README, Deploy, dann deine Rückmeldung.** Danach kommt Runde 2 mit Modell-Teilen und Licht-Feinschliff.

## Risiken

- **Licht:** Mit der Sonne von oben und der Hemisphäre allein kann es flach wirken. Echte Punktlichter sind teuer.
  Die Strahler sind deshalb nur leuchtende Flächen.
- **Overlay-Kameras:** Von außen sieht man durch die Wände hinein. Das ist gewollt, sieht aber anders aus als ein
  geschlossener Kasten.
