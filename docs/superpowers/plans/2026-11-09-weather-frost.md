# Weather-Source Teil 2: Frost-Ebene – Bauplan

**Goal:** Eisblumen wachsen in `effects/weather.html` bei echtem Frost (≤ 0 °C) oder Schneesturm von Ecken und Rändern ins Bild; der Chat kratzt (`!scrape`) und haucht (`!warm`) sie frei, mit gemeinsamer Rangliste.

**Spec:** `docs/superpowers/specs/2026-11-09-weather-source-design.md` (Abschnitt „Frost-Ebene“, Festlegung „Frost“).

## Entscheidungen

- **Zustand auf dem Server**, nicht als Event-Replay im Overlay: Das Wachstum hängt an der echten Temperatur, die nur der Server kennt. Tabelle `fx_weather_frost(tenant_id PK, data TEXT, updated_at TEXT)`, `data` = `{"level", "at", "top"}`. Überlebt Reload und Neustart.
- **Wachstum** pro Minute: friert es (Temperatur ≤ 0 °C oder wirksame Lage `blizzard`), `+(2 + |Temp|) × frostrate`, im Schneesturm mindestens `+8`; sonst Tauen `−(5 + Temp)`. Obergrenze 100, Untergrenze 0. Fortgeschrieben bei jeder Zustandsabfrage; geschrieben wird nur bei Änderung ≥ 0,5 oder nach 60 s.
- **Befehle** an `/api/fx/weather`: `scrape&name=` (−6), `warm&name=` (−10), `frostclear` (alles weg, für Mods), `frostreset` (Rangliste leeren), `leaders` (Rangliste zeigen). Der Persist-Hook trägt das Ergebnis (`done`, `level`) in den Befehl ein, damit das Overlay passend animiert („no frost yet“).
- **Rangliste** gemeinsam für Kratzen und Hauchen, Top 5 im Zustand (`frostTop`).
- **Einstellungen** (URL/Live): `frost` an/aus (Standard an), `frostrate` 0,25–4 (Standard 1).
- **Optik:** eigene Canvas-Ebene; vorab erzeugte Kristall-Äste aus Ecken und Rändern mit Schwelle, ab welchem Stand sie sichtbar sind; Raureif-Schleier an den Rändern; Mitte bleibt frei. `scrape` = Kratzer fährt eine Bahn frei, `warm` = Atemwolke, freie Stelle mit Dampf; freie Stellen frieren in ~60 s wieder zu. Ganz frei durch einen Zuschauer → Freude-Funkeln + „Glass is clear!“. Namensschilder und Ranglisten-Kasten aus `js/season-kit.js`/`.css`.

## Tasks

1. `fx/weather_frost.py` + `tests/fx/test_weather_frost.py`: Wachstum/Tauen, Kratzen/Hauchen, Rangliste, Tenants getrennt.
2. Befehle/Settings in `fx/commands.py`, Persist-Hook + Zustand in `fx/endpoints.py`/`fx/weather_state.py`, Tests in `tests/fx/test_weather_endpoint.py`.
3. Overlay: Frost-Ebene in `effects/weather.html` (Zeichnen, Animationen, Schilder, Rangliste).
4. Katalog (Schalter, Knöpfe, Chat-Befehle), README, Prod-Tabelle, Deploy, Prüfung T1/T2.
