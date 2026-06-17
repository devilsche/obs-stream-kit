# G1R Local Proxy — Prototyp (Items + Position)

Schlanker Test, um Gothic-1-Remake-Live-Daten (**Inventar + Welt-Position**) ins
OBS-Overlay zu bringen. Läuft komplett lokal auf dem Spiel-PC. **Karte/Marker
kommt später** — dieser Prototyp zeigt die Position nur als Rohzahlen (X/Y/Z in cm),
was zugleich die Vorarbeit für die spätere Karten-Kalibrierung ist.

```
[G1R + UE4SS-Mod] → schreibt g1r-state.json → [server.py @ localhost:9210] → [OBS-Widget]
```

## Teile
- `G1RExport/scripts/main.lua` — UE4SS-Lua-Mod (liest Inventar + Position, schreibt JSON)
- `server.py` — lokaler Mini-Server (liest JSON, serviert `http://localhost:9210/state`, CORS)
- Widget: `widgets/g1r/test.html` (liegt im Haupt-Repo, wird von prod serviert)

## Setup

### 1. Pfad festlegen (an EINER Stelle, muss übereinstimmen)
- In `G1RExport/scripts/main.lua`: `OUTPUT_PATH` (oben), z.B. `C:\obs-g1r\g1r-state.json`
- In `server.py`: `STATE_FILE` (oder per Umgebungsvariable `G1R_STATE_FILE`) — **derselbe Pfad**.
- Den Ordner (z.B. `C:\obs-g1r\`) vorher anlegen.

### 2. UE4SS-Mod installieren
Voraussetzung: UE4SS (RE-UE4SS) für Gothic 1 Remake installiert (siehe nexusmods.com/gothic1remake).
- Ordner `G1RExport` nach `<Gothic1Remake>/.../Binaries/Win64/ue4ss/Mods/` kopieren
  (genauer Pfad je nach UE4SS-Version — dort liegen die anderen Mods).
- In `Mods/mods.txt` eine Zeile ergänzen: `G1RExport : 1`
- Spiel starten. In der UE4SS-Konsole sollte stehen: `[G1RExport] geladen — schreibt nach …`

### 3. Lokalen Server starten
```
python3 server.py
```
(Läuft auf `http://localhost:9210`. Fenster offen lassen.)

### 4. Widget in OBS einbinden
Browser-Source mit der **prod-URL deines Tenants** (damit das Theme greift):
```
https://stream-overlay.com/s/<dein-token>/widgets/g1r/test.html?port=9210
```
Größe: 420×360. Das Widget lädt von prod, fetcht aber `http://localhost:9210` (deine lokalen Daten).

## Verifikation / Troubleshooting
- **Server-Test im Browser:** `http://localhost:9210/state` öffnen → JSON mit `pos` + `items`.
- **„lokaler Proxy nicht erreichbar":** `server.py` läuft nicht / falscher Port.
- **„warte auf G1R" / „Spiel pausiert":** JSON fehlt oder ist > 10 s alt → Mod schreibt nicht
  (Spiel zu, oder die Lua-Pfade greifen am Build nicht — siehe unten).
- **Position kommt, Items nicht (oder umgekehrt):** der Mod liest beide unabhängig (pcall).
  Items-Auslesen ist build-abhängig; wenn leer, die Slot-Pfade in `main.lua` (`readInventory`)
  an `inventory.lua` aus github.com/AndreyDudak/mods-g1r anpassen.
- **OBS zeigt nichts, Browser schon:** OBS' CEF blockt evtl. `http://localhost` von einer
  HTTPS-Seite (Private Network Access). Der Server setzt `Access-Control-Allow-Private-Network`;
  falls es trotzdem hakt, das Widget testweise lokal laden statt von prod.

## Status
Prototyp. Server + Widget lokal verifiziert (Mock-Daten). Der Lua-Mod ist **ungetestet**
(kein Spiel zur Hand) — Position via `K2_GetActorLocation` und das Inventar-Auslesen am
echten Build verifizieren. Item-Namen sind technische Klassennamen (z.B. `ItemSword_Rusty`);
ein Klarname-Mapping kommt später, ebenso die Karte.
