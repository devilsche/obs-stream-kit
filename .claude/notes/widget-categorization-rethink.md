# Rethink: Widget-Kategorisierung + Weapon-Stats (TODO, später)

Stand: 2026-05-30. Aktuelle Tabs in `/app/urls` + die Weapon-Stats
sind "gaga" (User-O-Ton). Bevor wir aufräumen: einmal in Ruhe
durchgehen, was jedes Widget eigentlich KANN und soll, dann passende
Kategorien wählen.

## 1. Widget-Inventur — was tut jedes Widget WIRKLICH?

Jedes Widget braucht eine **klare Definition**:
- Was zeigt es genau (Datenfelder, Aggregation, Range-Verhalten)?
- Wann triggert es / wann updated es (Push, Poll, Trigger)?
- Wo gehört es UX-mässig hin (Live-Overlay, Post-Match-Card,
  Sidebar, Stinger, …)?
- Was sind die wichtigsten Parameter und sinnvolle Defaults?

Mögliche Top-Level-Kategorien (statt der aktuellen `PUBG · Stats`
etc.):

- **Live-Overlay** (während des Matches sichtbar, auto-versteckt
  zwischen Matches): Live-Bar, Streak-Counter, Hot-Drop-Indicator,
  Lookup, Chat-Stats-Popup.
- **Post-Match** (nach jedem Match kurz eingeblendet):
  Post-Match-Card, Milestone-Celebrate, Session-Achievements,
  Session-Goal.
- **Session-Overview** (gesammelte Stats der laufenden Session,
  immer sichtbar): Session-Summary, Session-Lobbies, Map-
  Distribution, News-Ticker.
- **Career / Long-Term** (eher Just-Chatting / Pre-Stream):
  Career-Card, Season-History, Trend-Indicator, Map-Performance,
  Weapon-Stats.
- **Mates** (Squad-Synergie / Co-Player): Mates-Carousel, Mates-
  Flyout, Top-Mates, Top-Mates-Slider, Anti-Mates, Chicken-Together,
  Squad-Compare, Coplayer.
- **Maps** (Map-fokussierte Visualisierungen): Chicken-Map,
  Hot-Drop, evtl. Map-Distribution (auch denkbar in Session).
- **Steam**: Now-Playing, Games-Ticker, Achievement-Feed,
  Achievement-Popup, Combined-Popup.

Manche Widgets passen in **mehrere** Kategorien (z.B. Hot-Drop ist
Map UND Session). Lösung: ein Primär-Tab + optional "Tags" als
Sekundärfilter.

## 2. Pro Widget zu klären

| Widget | Offen / Unsicher |
|---|---|
| Live-Bar | Was zeigt es genau wenn KEIN Match läuft? "Last match summary"? "Hidden"? Default? |
| Streak-Counter | Default-Type (chicken/top10/kd1/kd2)? Wann reset? |
| Hot-Drop | Wieviele "Teams im 500m-Radius" = Hot-Drop? Aktuell harter Schwellenwert. |
| News-Ticker | Was sind die News? Achievements? Karriere-Highlights? Wieviele auf einmal? |
| Lookup | Funktioniert nur via Chat-Trigger (StreamerBot) — User-flow dokumentieren |
| Chat-Stats-Popup | Trigger-Mechanismus (Chat-Command), Player-Param, Auto-Hide |
| Map-Performance | Per-Map-Stats — welche Metriken sind sinnvoll? K/D, DMG, Place, Hot-Drops? |
| Chicken-Map | Nur Wins-Locations? Oder mit Top-10 Pins auch? |
| Map-Distribution | Bar-Chart oder Pie? Welche Stats pro Map? |
| Top-Mates / Slider | Default = team-K/D? Was bei wenig Matches mit jemandem? |
| Anti-Mates | Welche Metrik? Reverse-team-K/D? Min-Shared-Matches? |
| Session-Summary | Was zeigt es minimal? Was, wenn Session=0 Matches? |
| Session-Goal | Goal-Setting im Frontend oder Backend? Persistierung? |
| Session-Lobbies | "Lobby-Strength" — wie wird das berechnet? Bot-Count? |
| Payday-Stats | Nur PUBG-Heist? Per Map gefiltert? |
| Milestone-Celebrate | Welche Trigger-Events? Bisher: 100er-Win-Schwelle |
| Session-Achievements | Wie wird "Session" definiert (Match-Lücke?) |
| Career-Card | Welche Season? Aktuelle vs. Lifetime? `?player=` für Mate-Lookup |
| Season-History | Welche Metriken im Chart? Avg-DMG, K/D, Wins, Top-10? |
| Trend-Indicator | Worauf basiert "Trend"? Letzte N Matches vs. Career? |
| Weapon-Stats | Siehe Abschnitt 3 unten |

## 3. Weapon-Stats — was wirklich rein soll

Aktuell pro Waffe: Kills, Ø Distanz, Max-Distanz, Used-in-Matches,
Kills/Match.

**Lücken zu schliessen** (siehe vorheriger Chat):
- **Bot-Kills separat** (Spalte oder Toggle) — derzeit zählen
  Bot-Kills wie echte PvP-Kills.
- **Knocks** als eigene Spalte — wenn du knockst und ein Teammate
  finisht, kein Kill für dich.
- **Total Damage** Summe pro Waffe (cheap: SUM(damage)).
- **Headshot-Rate** via `damageReason` aus dict — bisher ungenutzt.
- **Accuracy / Hit-Count** via TakeDamage-Events. Volumen ist gross,
  aber per-Waffe-Aggregation cacheable.
- **HR-Pattern mappen** — `*_HR_C` und `HR_*` Suffixe abschneiden,
  damit "M416 Hot-Round" und "M416" als EINE Waffe gezählt werden.
  Siehe Memory `project-unknown-weapons-to-map`.
- **Kategorie-Summary**: aggregierte Zeilen pro Kategorie (AR / DMR
  / SR / SMG / SG / Pistol / Vehicle / Environment).
- **DBNO-Followups**: wenn du knockst und Teammate finisht, soll
  das im Knock-Counter auftauchen mit Indikator "led to kill".

**Semantik-Klärungen (User-Fragen 2026-05-30)**:
- **"Match" = ?** Aktuell: Matches mit ≥1 Kill mit der Waffe (zu eng).
  Vorschlag neue Spalten:
  - `pickups` — `COUNT(*)` aus ItemPickup-Events pro Waffe (cheap)
  - `carryMatches` — distinkte Matches mit ≥1 Pickup der Waffe
  - `killsPerCarry` — kills / carryMatches (sinnvoller als heute kills/match)
- **"Wie oft ohne Kill gestorben mit der Waffe"?** Schwierig:
  Telemetry sagt nicht direkt "was hattest du in der Hand beim Tod".
  Heuristik: letzter ItemPickup/Attack-Event vor eigenem Kill-Target-
  Event → angenommene Waffe in der Hand. ~80% Genauigkeit.
- **"Kills/Playtime"?** Beste Metrik wäre `kills / carry_minutes` (Zeit
  zwischen Pickup und Drop, summiert). Daten via ItemPickup+ItemDrop
  vorhanden, aber Drop-Events haben evtl. Lücken (Waffenwechsel beim
  Looten). Phase-2-Feature. Simpler Proxy: `killsPerCarry` (oben).

**Frontend-Parameter** (`/api/pubg/weapon-stats?…`):
- `range` (session/week/all) — vorhanden
- `from`/`to` ISO — vorhanden
- `player=<name>` — Mate-Lookup, vorhanden
- `minKills=N` — Frontend-Filter, vorhanden
- `sortBy` — kills/distance/etc., vorhanden
- **Neu**: `bots=include|exclude|only` — Bot-Filter
- **Neu**: `category=ar,dmr,sr,…` — Kategorie-Filter

## 4. Nächste Schritte (wenn das Thema drankommt)

1. Mit User durchgehen: pro Widget die offenen Punkte aus
   Abschnitt 2 klären. Vielleicht in 3-4 Sessions à 4-5 Widgets.
2. Neue Kategorien beschliessen → `app/widget_catalog.py` umbauen.
3. Tab-Reihenfolge in `urls.html` an häufigste Use-Cases anpassen.
4. Weapon-Stats: Backend erweitern (HR-Mapping, Bot-Filter,
   Headshot, Knocks, Damage). Frontend-Spalten + Toggle dazu.
5. Eventuell pro Widget eine Mini-Doku-Seite generieren
   (statt nur Tab-Eintrag) — Klick auf Widget öffnet Detail-Doku.
