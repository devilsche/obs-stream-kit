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

## Schritt 2 – Mehrspieler (freigegeben, „go“ 2026-11-20)

- Streamer öffnet eine Session (`!drive open` / Knopf in Car Drive) → Server erzeugt Raum mit Code, Chat bekommt
  `stream-overlay.com/drive/<code>`.
- Zuschauer: Seite `/drive/<code>`, Twitch-Login (Name/ID für Punkte), Auto aus der Garage oder Zufall, leichtere
  Grafikstufe (Renn-Modelle, niedrigere Auflösung) wählbar.
- Netz: eigener kleiner WebSocket-Dienst (`obs-drive`, Speicherbremse wie die anderen), Raum je Tenant, max. 8 Fahrer.
  Jeder Client rechnet sein Auto selbst (Arcade-Modell aus Schritt 1) und sendet ~20 Hz Zustand (Position, Lage, Tempo,
  Lenkung, Runde); Server verteilt, Clients interpolieren (100 ms Puffer). Start/Countdown/Ziel kommen vom Server.
- Plausibilitätsprüfung auf dem Server (Höchsttempo je Auto, Rundenzeit-Minimum, Sprungweite) → verdächtige Runden
  zählen nicht.
- Kontakt zwischen Spielern: jeder Client schubst sich selbst beim Überlappen (masseabhängig), kein Server-Physikrechnen.
- Stream: Car-Race-Overlay bekommt einen Modus „live“ (TV-Kamera, Rangliste) für diese Sessions.
- Wertung: Platzierung → Punkte/Coins wie im Chat-Rennen (nur plausible Ergebnisse).

Stand Bau Schritt 2 (2026-11-20): gebaut – `drive_ws.py` (WS-Dienst, Port 9010), `fx/drive_room.py` (Räume, Prüfung,
Wertung), `fx/drive_auth.py` (Tickets, Zuschauer-Cookie, interne Steuerung), Token-Route `…/api/fx/car-drive`,
Zuschauer-Seite `app/views_drive.py` (`/drive/<code>`), Client `js/car-drive-net.js` + Mehrspieler-Teil in
`js/car-drive.js`. Offen: Car-Race-Overlay-Modus „live“ (eigenes Teilprojekt, `js/car-race.js`), Zuschauen ohne
mitzufahren, Wiederaufnahme eines offenen Raums nach Neuladen der Streamer-Seite.
