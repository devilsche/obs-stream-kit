# Weather-Source Teil 4: Herbst, Frühling, Sommer + Aufräumen – Bauplan

**Goal:** Die übrigen Jahreszeiten-Themen in `effects/weather.html`; danach entfallen die alten Effekt-Seiten (`autumn/spring/summer/winter/xmas/rain/snow.html`) ersatzlos (Entscheidung des Streamers).

**Spec:** `docs/superpowers/specs/2026-11-09-weather-source-design.md` (Deko-Ebene). Muster: Teil 3 (`fx/weather_snow.py`, `js/theme-winter.js`).

## Entscheidungen

- **Thema `auto`:** März–Mai Frühling, Juni–August Sommer, September–November Herbst, Dezember–Februar Winter; die Xmas-Zeit ist immer Winter. Schalter `theme` kennt zusätzlich `spring`, `summer`, `autumn`.
- **Mechaniken auf dem Server** (`fx/weather_season.py`, Tabelle `fx_weather_season`, JSON je Tenant), angetrieben vom wirksamen Wetter statt von eigenen An/Aus-Schaltern:
  - Herbst – Laub (0..100): fällt stetig mit (1 + 2 × Wind) %/min × `leafrate`, Regen drückt es nicht weg; `!rake` −5 (Rangliste „Top rakers“), `!jump` nur Show, Mods `sweep` → 0.
  - Frühling – Bodenfeuchte (0..100): trocknet mit 2 %/min (bei Hitze 6), Regen gießt mit 30 %/min × Regenmenge; `!water` +10; Unkraut wächst 1 %/min, `!weed` −3, Gruppe (3 Namen in 20 s) halbiert, Mods `&force=1`. Gießen und Jäten zählen für „Top gardeners“.
  - Sommer – Hitze (0..100): steigt bei Hitzewelle 20 %/min, bei Sonne (`sun` > 0,4, Tag) 2 %/min, sinkt bei Regen 10 %/min und nachts 3 %/min; `!splash` −5 („Top coolers“), Mods `cool` → 0.
- **Follower-Items** wie bisher: Kürbisse (`autumn_db`), Blumen und Sandburgen (`season_db` spring/summer). `cmd=follow` legt je Thema das passende Item an (Winter: Kugel bzw. Mini-Schneemann).
- **Befehle** über `/api/fx/weather`: `pumpkin`, `rake`, `jump`, `sweep`, `flower`, `water`, `weed`, `bee`, `castle`, `splash`, `ice`, `cool`, `seasonboard`; `celebrate` und `clear` gemeinsam (`kind` erweitert um `pumpkins|leaves|flowers|garden|castles|heat`).
- **Optik** aus den alten Seiten als `js/theme-autumn.js`, `js/theme-spring.js`, `js/theme-summer.js` mit derselben Schnittstelle wie `ThemeWinter`; Wetter wirkt auf die Deko (Regen gießt sichtbar, Hitze lässt Eis schmelzen, Wind treibt Laub).

## Tasks

1. Server: `fx/weather_season.py` + Tests; Thema `auto` nach Monat.
2. Server: Befehle, Persist, Deko-Stand im ersten Poll, Zustand (`seasonLevels`, `seasonTop`) + Tests.
3. Overlay: drei Themen-Bausteine + Einbindung.
4. Katalog, README, Prod-Tabelle, Deploy, Prüfung.
5. Aufräumen: alte Effekt-Seiten, ihre Katalogeinträge und Effekt-Kanäle entfernen; README bereinigen.
