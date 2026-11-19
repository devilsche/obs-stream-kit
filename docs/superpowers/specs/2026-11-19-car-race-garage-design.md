# Car Race – Garage, Sub-Extras, Kanalpunkte (Konzept)

Stand: 2026-11-19 · Status: freigegeben („go“), im Bau – Nitro/Anrempeln (Abschnitt 4) folgt als eigener Schritt

## Wozu

Langzeit-Motivation fürs Chat-Rennen: Wer oft mitfährt, sammelt Coins und schaltet bessere Autos frei (Garage).
Subs bekommen faire Extras (nichts, was den Sieg kauft). Kanalpunkte erlauben eine einmalige Autowahl.

## Anti-Ziele

- Kein Pay-to-win: Sub-Status und Geld entscheiden nie direkt über Sieg oder Werte.
- Keine echte Währung, kein Handel zwischen Zuschauern.
- Nichts, was Nicht-Subs vom Mitfahren abhält.

## 1. Garage mit Race Coins

- **Verdienen** (je echtem, gewertetem Rennen): Teilnahme 10 Coins, plus Platz: 1. +30, 2. +20, 3. +10; ins Ziel gekommen +5.
  DNF bekommt nur die Teilnahme. Testrennen und gestrichene Rennen geben nichts.
- **Preise nach Klasse** (aus den echten Werten, Rundenpace):
  - Kleinwagen/Oldies (Golf Mk1, 190E …): 150
  - Limousinen/Kombis/Sportlimousinen (A4, E39, M3 E30 …): 400
  - Sportwagen (911 Carrera, M3 G80, RS6 …): 900
  - Supersportwagen (Lambo, Ferrari, 918 …): 2.000
  - Rennwagen (GT3 R, 296 GT3, DTM, 917K): 3.500
  - W14 (F1): 6.000
  - Spaß-Fahrzeuge (Bus, Ural, CT680, Krabby Patty): 250 – für Chaos-Fans
  - (Richtwert: ein Stammzuschauer mit ~2 Rennen pro Stream hat nach ~3 Streams einen Sportwagen.)
- **Befehle:**
  - `!garage` – eigene Autos und Coin-Stand.
  - `!buy <auto>` – kaufen (unscharfe Namenssuche wie bei `!outfit`; Antwort mit Preis/Rest).
  - `!race <auto>` – mit eigenem Auto fahren (nur gekaufte; ohne Angabe: Zufallsauto wie bisher).
  - `!coins` – Stand.
- **Daten:** je Tenant DB-Tabellen `fx_race_wallet` (user_id, coins), `fx_race_garage` (user_id, car_key, bought_at);
  Coins werden beim gewerteten Ergebnis gutgeschrieben (gleiche Sperre wie Punkte, nie doppelt).
- **Dashboard:** Preise je Klasse anpassbar; einzelne Autos sperren („not for sale“); Coins von Hand vergeben (Giveaways).

## 2. Sub-Extras (fair)

- **Mehr Coins:** Tier 1 ×1,25, Tier 2 ×1,5, Tier 3 ×2 auf alles Verdiente.
- **Abzeichen** am Namensschild und in der Rangliste (Stern in Tier-Farbe).
- **Sub-Farbsets:** exklusive Lackierungen (z. B. Gold/Lila im Kanal-Theme) für gekaufte Autos, `!paint <set>`.
- **Reroll:** einmal pro Rennen `!reroll` – anderes Zufallsauto *derselben Klasse* (kein Upgrade).
- Sub-Status kommt von Streamer.bot mit der Anmeldung (`%isSubscribed%`, `%subscriptionTier%`), wird pro Rennen
  gespeichert, nicht dauerhaft.

## 3. Kanalpunkte

- Twitch-Belohnung „Choose your car for the next race“ (Preis im Twitch-Dashboard, z. B. 2.500 Punkte):
  Zuschauer gibt den Autonamen ein → Streamer.bot meldet ihn mit genau diesem Auto an (auch ohne es zu besitzen),
  einmalig für das nächste Rennen.
- Nicht verfügbare Autos/kein Rennen offen → Streamer.bot erstattet die Kanalpunkte automatisch.

## 4. Eingriffe der Zuschauer im Rennen (Nutzerwunsch, später)

- `!nitro`: kurzer Boost für das eigene Auto (z. B. +15 % Tempo für 2 s, einmal pro Rennen; Coins oder Kanalpunkte).
- `!bump <name>`: ein anderes Auto anrempeln (Schubser wie beim Kontakt, kleine Dreher-Chance; Kosten/Abklingzeit).
- Technisch: Befehle gehen an den Server, der sie mit Rennzeit als Ereignis an alle Overlays verteilt; die Simulation
  übernimmt sie deterministisch (gleiche Rennzeit → gleiches Ergebnis in jeder Instanz).

## Entscheidungen (Nutzer, 2026-11-19)

- Coin-Raten und Preise wie oben.
- Sub-Multiplikatoren 1,25 / 1,5 / 2 plus Stern, Sub-Lackierungen, `!reroll`.
- Kanalpunkt-Preis 2.500 (wird in Twitch/Streamer.bot eingestellt).
- Gekaufte Autos gelten nur im Rennen, nicht für `!burnout`.

## Umsetzung (grob)

Server (Wallet/Garage/Kauf, Gutschrift beim Ergebnis, Befehle), Streamer.bot-Aktionen (`!garage`, `!buy`, `!coins`,
`!race <auto>`, `!reroll`, `!paint`, Kanalpunkt-Belohnung mit Erstattung), Overlay (Abzeichen, Sub-Farbsets),
Dashboard (Preise, Sperren, Coins vergeben), Tests, README. Geschätzt 1 größerer Bauplan mit ~6 Schritten.
