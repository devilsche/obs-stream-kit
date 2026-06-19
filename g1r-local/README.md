# G1R Local Proxy — Gothic-1-Remake Live-Daten ins OBS-Overlay

Liest Live-Daten aus Gothic 1 Remake (via UE4SS-Lua-Mod) und bringt sie ins OBS-Overlay.
Läuft komplett lokal auf dem Spiel-PC.

```
[G1R + UE4SS-Mod] → schreibt g1r-state.json → [server.py @ localhost:9210] → [OBS-Widget]
```

## Was das Widget zeigt (Stand 2026-06-17)
**Stabil:** Position (X/Y/Z cm) · Laufstrecke + Schritte · Stats (Level/XP/STR/GES/HP/Mana/
Resistenzen) · Session-Zähler (Schaden/HP-Regen/Mana-Verbrauch/-Regen/XP) · Gilde · Schlag
(Schlagrichtung) · Ingame-Uhr · Inventar (deutsche Namen, 576-Item-Mapping) · Waffen + Zauber/
Runen „dabei" (aus dem Inventar gefiltert).

**Nicht möglich am aktuellen G1R-Build:** „aktiver Zauber" und „geführte Waffe" als Live-Wert —
die Engine-Funktionen (`GetSpellConfigGivenACharacter`, `GetEquipedWeaponDefinition`) lösen einen
harten C++-Crash aus (auch auf dem Game-Thread, nicht per `pcall` fangbar). Ebenso die exakte
Hotbar-Belegung 0–9 (`QuickMemoryItems` = TMap<Enum,Struct>, crasht). Deshalb wird stattdessen
crashfrei aus dem Inventar gefiltert, was der Spieler an Waffen/Zaubern dabei hat. Kill-Ticker:
`PuzzlesSubsystem`-Map liefert keine Daten → aus (ein Death-Hook wäre der saubere Weg, später).

**Karte/Marker:** kommt später (Position liegt als Rohzahlen vor = Vorarbeit für die Kalibrierung).

## Teile
- `G1RExport/scripts/main.lua` — UE4SS-Lua-Mod (liest Live-Daten, schreibt `g1r-state.json`
  + persistente Gesamtwerte/Rekorde nach `g1r-totals.json`)
- `server.py` — lokaler Mini-Server (CORS). Zwei Endpoints:
  - `GET /state` — Einmal-Snapshot (Debug/Fallback).
  - `GET /events` — **Server-Sent Events**: Widgets abonnieren, der Server pusht bei jeder
    Änderung (kein Netzwerk-Polling). Heartbeat alle 15 s.
  Reichert an: stärkste **Nahkampf-/Fernkampfwaffe getrennt** (`weapon_damage.json`, je mit
  Schadenswert), stärkster nutzbarer Zauber (`spell_circle.json` + magicCircle), Item/Zauber-Namen
  (`item_names.json`/`spell_names.json`), Gilde → `guildKey`+Name. `?lang=de|en`. Steamname via
  Env-Var `G1R_STEAM_NAME`.
- `weapon_damage.json` / `spell_circle.json` — Wiki-Mappings (Schaden bzw. benötigter Kreis).
- Widgets (im Haupt-Repo, prod-serviert, alle theme-fähig + englisch, Ornament-Rahmen via `.t-card`,
  Subscription via SSE, `?port=9210`):
  - `widgets/g1r/livebar.html` (1040×30) — Level/Schritte/Schaden/Mana/Regen/Uhr, `?scope=session|all`
  - `widgets/g1r/news-ticker.html` (760×40) — Stats/Session/Melee+Ranged+Zauber (Laufband)
  - `widgets/g1r/career-card.html` (360×480) — Stats/Resistenzen + **ein** Scope (`?scope=session|all`,
    Default `all`) für Gesamtwerte UND Rekorde, Ausrüstung, Gilden-Wappen
  - `widgets/g1r/test.html` — Diagnose-Liste (alle Rohfelder)

### g1r-totals.json (persistente Gesamtwerte)
Liegt neben `g1r-state.json`. Der Mod summiert hier über ALLE Sessions: Schaden/Regen/Mana/XP/
Strecke/Schritte + Rekorde (härtester Treffer, max Mana/Tick, weiteste Strecke). Beim Start
geladen, alle ~10 s geschrieben. Löschen = Gesamtwerte zurücksetzen.

### Ausgeteilter Schaden (optional)
`READ_DMG_OUT` in `main.lua` (Default **aus**) aktiviert einen Damage-Hook. Engine-Eingriff →
erst in-game testen; bei Crash aus lassen (alles andere läuft crashfrei weiter).

## Setup

### 1. Pfad festlegen (an EINER Stelle, muss übereinstimmen)
- In `G1RExport/scripts/main.lua`: `OUTPUT_PATH` (oben), z.B. `C:\obs-g1r\g1r-state.json`
- In `server.py`: `STATE_FILE` (oder per Umgebungsvariable `G1R_STATE_FILE`) — **derselbe Pfad**.
- Den Ordner (z.B. `C:\obs-g1r\`) vorher anlegen.

### 2. UE4SS-Mod installieren
Voraussetzung: **UE4SS (RE-UE4SS) für Gothic 1 Remake** muss installiert sein
(passende Version: nexusmods.com/gothic1remake/articles/6). UE4SS gehört in:
```
steamapps\common\Gothic 1 Remake\G1R\Binaries\Win64\
```
(NICHT ins Spiel-Root — sonst Crash / Mods werden ignoriert.) Dort liegt dann der Ordner `ue4ss\Mods\`.

- Ordner **`G1RExport`** kopieren nach:
  `…\Gothic 1 Remake\G1R\Binaries\Win64\ue4ss\Mods\G1RExport\`
  (daneben liegen schon UE4SS-Standard-Mods wie `BPModLoaderMod`, `Keybinds`).
- **Aktivierung:** Die mitgelieferte leere Datei `enabled.txt` im Ordner `G1RExport`
  reicht — UE4SS lädt den Mod dann automatisch. (Alternativ in `Mods\mods.txt` die
  Zeile `G1RExport : 1` ergänzen.)
- Endstruktur:
  ```
  …\Win64\ue4ss\Mods\G1RExport\enabled.txt
  …\Win64\ue4ss\Mods\G1RExport\scripts\main.lua
  ```
- Spiel starten. Prüfen, ob der Mod lädt: die Datei **`…\G1R\Binaries\Win64\UE4SS.log`**
  öffnen und nach `[G1RExport] geladen` suchen. (Alternativ das UE4SS-Konsolenfenster — nur
  sichtbar, wenn in `UE4SS-settings.ini` unter `[Debug]` `GuiConsoleVisible = 1` gesetzt ist.
  NICHT die In-Game-`~`-Konsole, das ist die UE-Spielkonsole.)

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

## Item-Namen (Deutsch)
Der Mod liest den **lokalisierten Namen direkt aus dem Spiel** (`GothicCharacter:GetInventory`
→ `InventoryBase:GetItemNameByPos`), also automatisch in deiner Spielsprache (Deutsch). Kein
Mapping nötig. Schlägt dieser Weg am Build fehl, fällt der Mod auf die Container-Daten zurück
(technische Klassennamen wie `ItemGold`) — die übersetzt `server.py` dann via `item_names.json`
(`?lang=de|en`). Das `item_names.json` ist also nur noch der Fallback-Notnagel.

## Status
Prototyp. Server + Widget lokal verifiziert (Mock-Daten). Position via `K2_GetActorLocation`
und das Inventar (UI-Weg `InventoryBase`, DE-Namen) am echten Build bestätigen. Karte kommt später.
