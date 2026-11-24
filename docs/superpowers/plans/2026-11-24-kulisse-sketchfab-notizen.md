# Kulisse aus den Sketchfab-Notizen – Plan

Stand: 2026-11-24 · nicht gebaut, wartet auf „go“
Quelle: `/admin/sketchfab`, 5 offene Einträge (data/sketchfab-notes.json auf Prod), dazu eigene Suche auf Sketchfab.

## Was in den Notizen steht

1. **Mehr Bäume und Umgebung:** Baumstumpf und Low-Poly-Baum. Selbst weitere passende Modelle suchen. Unklar ist
   „oceandrive verdient eher halten“ (siehe offene Fragen).
2. **Stadt:** Stadt-Elemente einzeln nehmen und eine eigene Stadt bauen, ein Street-Race für die Kartbahn. Gelände
   recherchieren, auf dem eine Kartbahn steht, gegebenenfalls eine riesige Halle.
3. **Noch mehr für eine Stadt:** „Realistic city“.
4. **Noch mehr Bäume und vor allem Gras.**
5. **Pflanzen:** Stylized Lowpoly Nature Pack.

## Prüfung der Links (Sketchfab-API)

| Modell | Lizenz | Download | Dreiecke | Einsatz |
|---|---|---|---|---|
| Stylized Lowpoly Nature & Plants (POLYSCAN3D) | – | **nein** (Store) | 27 k | nicht nutzbar |
| Realistic Grass 3D (kj3dx) | Standard | **nein** (Store) | 1,8 k | nicht nutzbar → Ersatz unten |
| Realistic Trees Collection (jungle_jim) | CC BY | ja | 128 k (Paket) | Wald/Alpen, je Baum ein Teil, je ~8 k |
| Realistic High Poly Tree (chenuka_wy) | CC BY | ja | 200 k | auf ~8 k vereinfachen, Wald/Stadion |
| Realistic European Tree (BBARTS) | CC BY | ja | 681 k | nur, wenn es vereinfacht gut bleibt (Prüfung mit `--inspect`) |
| Tree low poly (00amza) | CC BY | ja | 1,6 k | Füllbäume im Hintergrund (viele Instanzen) |
| Free Old Tree Stump (Onnix) | CC BY | ja | **3,9 Mio.** | stark vereinfachen (≤ 3 k) oder weglassen |
| Realistic city (Pasha.) | CC BY | ja | 257 k | Häuserblöcke einzeln herauslösen |
| City pack 8 (Pasha.) | CC BY | ja | 36 k | Gebäude einzeln |
| Asian Low Poly Night City (99.Miles) | CC BY | ja | 6 k | Skyline/Nacht, sehr leicht |
| Low Poly Night City Skyline (99.Miles) | CC BY | ja | 6 k | Hintergrund-Skyline |
| Building (buildify) NYC | Free Standard | ja | 207 k | ein Hochhaus, vereinfachen |
| Abandoned Building Lowpoly (Fridqeir) | CC BY | ja | 15 k | Industrie/Stadtrand |

**Eigene Funde (frei, CC BY, herunterladbar):**
- **Gras als Ersatz für das Store-Modell:**
  - „low poly grass clump“ (5948b849…, 1,2 k)
  - „Dry grass“ (d1484537…, 112)
  - „Simple grass chunks“ (eb4f6dc9…, Paket 78 k)
- **Busch:** „Stylized Bush“ (9d9ce79d…, 1 k)
- **Kartbahn:**
  - „Mini Catalunya Indoor Karting Track“ (4e7b5919…, 108 k, CC BY), eine Hallen-Kartbahn
  - „MIKS Karting 2022 Indoor“ (f06cbb40…, 508 k, CC BY)
  - Beide eignen sich als Vorlage oder Teile (Hallendach, Reifenstapel, Banden). Die Strecke selbst bleibt unsere.
- **Rennzubehör:**
  - „Race Track Assets Pack“ (4a863e70…, CC BY), mit Reifenstapeln, Banden und Schildern
  - „Industrial asset pack (Free)“ (94c50117…, CC BY)
- **Straße:** „[FREE] City Road Layout Mockup“ (3260e3fe…, 8 k, CC BY), mit Straßenmöbeln

## Vorschlag in drei Stufen

### Stufe 1: Bäume und Gras (schnell, sichtbar)

- **Bäume:**
  - Die neuen Bäume kommen als weitere Modelle in `assets/track-props/candidates.json` (kind tree, Themen forest,
    alpine, stadium).
  - Gebaut wird mit `scripts/build_track_props.py`.
  - Die Bäume werden auf ≤ 8 k Dreiecke vereinfacht, die Füllbäume bleiben bei ≤ 2 k.
- **Gras:**
  - Neue Art `grass`: Büschel-Modelle als Instanzen am Streckenrand, im Auslauf und unter Bäumen.
  - Geplant sind einige tausend Stück mit einem Zeichenaufruf je Modell.
  - In Car Drive ergänzen sie das bisherige Shader-Gras (`js/car-drive-grass.js`), im Overlay (Car Race) gibt es nur
    die Nähe der Kamera.
- **Lizenzen:** CC BY verlangt Namensnennung. Die Credits stehen schon im Katalog, ich prüfe, wo sie angezeigt werden.

### Stufe 2: Stadt-Bausatz

- **Bausatz:** Die Gebäude aus Realistic city, City pack 8, NYC und Abandoned werden einzeln herausgelöst, normiert
  und als Arten `building-s/m/l` und `skyline` angelegt.
- **Platzierung:** Ein neuer Platzierer stellt Häuserblöcke entlang der Strecke auf.
  - Sie stehen mit Abstand zum Auslauf und mit Gehweg.
  - Dahinter steht die Skyline von 99.Miles als Kulisse.
  - Das ist ein neues Thema `city`.

### Stufe 3: Kart-Thema neu (Entscheidung nötig)

- **Halle:** Die Kartbahn liegt in einer großen Halle.
  - Dach mit Stahlträgern, Hallenlicht, Reifenstapel als Begrenzung, Banden, Zuschauer-Empore.
  - Teile kommen aus Mini Catalunya / MIKS und dem Race Track Assets Pack.
  - Ohne Himmel, Licht von oben.
- **Street-Race:** Die Kartbahn liegt zwischen Häusern (Stadt-Bausatz aus Stufe 2).
  - Leitplanken und Betonblöcke als Rand, Straßenlaternen, abends.
  - Passt zur Nacht-Skyline von 99.Miles.

## Offen für dich

1. Kart-Thema: **Halle** oder **Street-Race**? Beides geht. Die Halle passt eher zur kurzen, engen Strecke, die Stadt
   ist mehr Arbeit, wirkt aber stärker.
2. „oceandrive verdient eher halten“: Was ist gemeint? Coast hat schon Palmen und Leuchttürme. Meinst du dort
   **Palmen** statt Bäume oder **Hallen**?
3. Fange ich mit Stufe 1 an? Sie lässt sich ohne die Entscheidungen 1 und 2 bauen.
