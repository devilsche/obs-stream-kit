# Car Drive – selbst fahren (Konzept)

Stand: 2026-11-20 · Status: freigegeben („go für Autosteuerung“), Bau Schritt 1

## Wozu

Der Streamer will das Rennen selbst fahren – als eigene Anwendung im Browser (Vollbild), mit den echten Autos aus dem
Katalog in voller Qualität, auf den Car-Race-Strecken, gegen KI-Gegner.

## Entscheidungen (Nutzer)

- Browser, three.js (wie Car Race), später ggf. Unity.
- **Volle Modelle** (`api/fx/cars/model/<uid>.glb`, nicht `.race.glb`), Lack/Zonen/Räder/Fahrer-Ente aus dem Car editor.

## Vorschläge (Claude, im Bau anpassbar)

- Seite `tools/car-drive.html` (Admin, `/app/tools/car-drive`), Vollbild, Menü: Auto wählen (Katalog, Farbset),
  Strecke wählen (die 5 Car-Race-Strecken), Gegner 0–7, Runden 1–5.
- Steuerung: Tastatur (WASD/Pfeile, Leertaste Handbremse, Shift Nitro, R zurück auf die Strecke, C Kamera),
  Gamepad (Gamepad-API: Trigger Gas/Bremse, Stick lenken), analoges Lenken mit Glättung.
- Fahrphysik „Arcade“: eigenes Einspurmodell (keine Physik-Engine) – Antrieb/Bremse/Grip/Gewicht aus den echten
  Werten (Race stats), Untersteuern/Übersteuern, Handbremsen-Drift, Kies/Gras bremst, Leitplanken federn zurück.
- Gegner: Car-Race-Simulation (gleiche Werte, Ideallinie); Kontakt Spieler ↔ Gegner als Schubser (Masse).
- Kameras: Verfolger (Standard), Motorhaube, Cockpit (falls Ente/Lenkrad), TV.
- HUD: Tacho (km/h aus Spielzeug-Maßstab hochgerechnet), Runde, Position, Rundenzeiten, Bestzeit je Auto+Strecke
  (localStorage).
- Später: Bestzeiten auf dem Server, Geister-Auto, Stream-Overlay „Streamer fährt“.

## Schritt 1 (MVP)
Menü, ein Auto fahren auf allen Strecken mit Tastatur+Gamepad, Arcade-Physik, Kies/Leitplanke, Verfolgerkamera,
HUD mit Rundenzeit/Bestzeit, 3 Runden, Gegner aus der Sim (bis 7), Positionsanzeige, Zielbildschirm.
