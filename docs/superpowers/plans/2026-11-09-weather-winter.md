# Weather-Source Teil 3: Winter-Thema mit Xmas-Zeit – Bauplan

**Goal:** `effects/weather.html` bekommt eine Deko-Ebene „Winter“: Schneedecke, Eiszapfen, Schneemann (Sub baut), Mini-Schneemänner (Follow) – und in der Xmas-Zeit zusätzlich Lichterkette, Baum mit Follower-Kugeln, hängende Kugeln und Geschenke, mit Aufbau- und Abschied-Animation. Ersetzt `winter.html` und `xmas.html`.

**Spec:** `docs/superpowers/specs/2026-11-09-weather-source-design.md` (Deko-Ebene, Xmas-Zeit, Festlegungen).

## Entscheidungen

- **Thema** per Schalter `theme` = `auto` | `winter` | `none` (Teil 4 ergänzt `spring`/`summer`/`autumn`). `auto`: Winter von Dezember bis Februar **und** während der Xmas-Zeit (die im November beginnen kann), sonst `none` bis Teil 4.
- **Xmas-Zeit** per Schalter `xmasfrom` (`advent` = 1. Advent, oder `MM-DD`, Standard `advent`) und `xmasto` (`MM-DD`, Standard `12-26`). Saison = Jahr des Beginns (Januar zählt zur Vorjahres-Saison).
- **Ablauf Aufbau/Abschied auf dem Server** (`fx_weather_theme`, JSON je Tenant): `off` → (Datum erreicht) `setup` fällig → (Overlay hat gespielt) `on` → (Datum vorbei) `farewell` fällig → `done`. Knöpfe `cmd=setup` / `cmd=farewell` springen sofort und machen den fälligen automatischen Schritt der Saison hinfällig. Liegt das Ende hinter einem Themenwechsel, wird still abgebaut. Das Overlay spielt einen fälligen Schritt, sobald es live im Programm ist (`obsstudio` aktiv) und 2 min gewartet hat, im Browser-Tab sofort; danach `cmd=xmasdone&step=…`.
- **Schneedecke auf dem Server** wie der Frost (`fx_weather_snow`): wächst, solange die wirksame Lage schneit (Menge × `snowrate`), taut bei Hitze und über 0 °C langsam; `!shovel` (−5) und `!shake` (Gruppe: `shakeneed` Leute in `shakewin` s → alles ab, Mods `&force=1`). Rangliste „Top snow shovelers“ (Schippen, Eiszapfen).
- **Gesammelte Daten weiter nutzen:** Kugeln und Geschenke aus `fx_xmas_item`, Mini-Schneemänner und Schneemann-Stufe aus `fx_season_item` (effect `winter`). Befehle laufen über `/api/fx/weather`: `ornament`, `gift`, `mini`, `build`, `snowmanreset`, `shovel`, `shake`, `icicle`, `snowball`, `celebrate`, `setup`, `farewell`, `xmasdone`, `clear&kind=…`. Der erste Poll liefert den Deko-Stand (`load_state`).
- **Wetter wirkt auf die Deko:** Schnee auf Baum und Schneemann folgt der Schneedecke; Hitze lässt den Schneemann sichtbar schwitzen/schrumpfen, solange sie anhält; Raureif kommt aus der Frost-Ebene (Teil 2), fallender Schnee aus dem Wetter.
- **Optik** aus `xmas.html`/`winter.html` übernommen (SVG-Bausteine), als `js/theme-winter.js`; Schneemann trägt in der Xmas-Zeit Mütze und Lichterkette.
- Alte Seiten bleiben bis zum Ende von Teil 4 und werden dann ersatzlos entfernt (Entscheidung des Streamers).

## Tasks

1. Server: `fx/weather_theme.py` (Thema nach Datum, 1. Advent, Xmas-Ablauf) + `fx/weather_snow.py` (Schneedecke, Schippen, Schütteln, Rangliste) + Tests.
2. Server: Befehle/Settings, Persist-Hooks auf `xmas_db`/`season_db`, Deko-Stand im ersten Poll, `theme`/`xmas`/`snow` im Zustand + Tests.
3. Overlay: `js/theme-winter.js` – Schneedecke, Eiszapfen, Schneemann + Minis, Animationen (Schippen, Schütteln, Eiszapfen, Schneeball, Celebrate).
4. Overlay: Xmas-Teile – Lichterkette, Baum + Kugeln, hängende Kugeln, Geschenke; Aufbau-/Abschied-Animation, Auslösung bei live.
5. Katalog (Schalter, Knöpfe, Chat-Befehle gegliedert), README, Prod-Tabellen, Deploy, Prüfung.
