# Car Race Garage – Bauplan

Spec: docs/superpowers/specs/2026-11-19-car-race-garage-design.md · Basis: Car Race (fx/race.py, fx/race_db.py, fx/endpoints.py, js/car-race.js)

Globale Regeln: wie Car Race (keine Inline-Styles, UI englisch, Kommentare/Commits deutsch ohne Co-Authored-By, `?`-SQL,
je Tenant getrennt, nur betroffene Tests, README). Coins/Garage nie doppelt gutschreiben (gleiche Sperre wie Punkte).

## Task G1 – Server: Klassen, Preise, Wallet, Garage, Gutschrift
- `fx/race_shop.py`: Klasse je Katalog-Schlüssel (small/sedan/sport/super/race/f1/fun) – Zuordnung aus der Task-9-Werte-
  tabelle (Liste je Klasse, Regex-Fallback wie js/car-race-stats.js), Preise wie Spec, `price(key)`, `class_of(key)`,
  `find_car(query, catalog)` (unscharfe Namenssuche, Muster duck_viewers), Name bereinigen.
- `fx/race_db.py`: Tabellen `fx_race_wallet(tenant_id, user_id, display, coins, updated_at)` (unique tenant+user) und
  `fx_race_garage(tenant_id, user_id, car_key, bought_at)` (unique tenant+user+car); `coins(…)`, `add_coins(…)`,
  `buy(…)` atomar (Stand prüfen, abziehen, eintragen), `garage(…)`.
- Gutschrift beim gewerteten Ergebnis (nur echte Fahrer, wie Punkte): Teilnahme 10, Platz 1/2/3 +30/+20/+10, Ziel +5;
  Sub-Multiplikator aus dem beim Join gespeicherten Tier (1000/2000/3000 → 1,25/1,5/2). Testfahrer nie.
- Tests: tests/fx/test_race_shop.py, Erweiterungen in test_race.py/test_race_db.py.

## Task G2 – Server: Befehle
- `cmd=join` nimmt `car=<Text>` (eigenes Auto aus der Garage; unbekannt/nicht besessen → freundliche Absage, Zufallsauto
  ohne Angabe), `sub=1&tier=1000|2000|3000` (unaufgelöste %…% = kein Sub), `pick=<Text>&reward=1` (Kanalpunkte: genau
  dieses Auto einmalig, auch ohne Besitz; bei Fehler `refund:true` in der Antwort).
- `cmd=coins`, `cmd=garage`, `cmd=buy&q=<Text>`, `cmd=reroll` (nur Subs, einmal pro Rennen, nur Lobby/Countdown,
  anderes Zufallsauto derselben Klasse), `cmd=paint&q=<Set>` (nur Subs; Sub-Lackierungen „Gold“, „Purple“, „Carbon“ –
  speichert für das nächste Rennen), `cmd=givecoins&id=&n=` (Streamer/Dashboard).
- Antworten `{ok, say}` englisch, kurz. EFFECT_META-Befehlsliste + README.

## Task G3 – Overlay
- Stern-Abzeichen in Tier-Farbe an Namensschild, Rangliste, Lobby-Karte, Vorstellung, Podest (state liefert `sub`).
- Sub-Lackierungen (state liefert `paint`): feste Farbsets über zoneMat/paintTemplate.

## Task G4 – Streamer.bot (Controller, braucht SB geschlossen)
- `!race [auto]` mit sub/tier, `!coins`, `!garage`, `!buy <auto>`, `!reroll`, `!paint <set>`; Kanalpunkt-Aktion
  (Trigger: Belohnung „Choose your car for the next race“, vom Nutzer in SB/Twitch angelegt) mit Erstattung bei `refund`.
