# Snapshot-Historie: K/D zum Zeitpunkt des Matches

Stand: 2026-09-07 · Status: Entwurf, nicht gebaut

## Problem

Die Lobby-K/D eines Gegners wird heute mit dem **aktuellen** Snapshot
gerechnet, egal wann das Match war. Für ein Match im Mai ist ein Wert von
Ende August keine Aussage über die damalige Lobby, sondern über heute.

Zwei beobachtete Fälle aus der Session vom 2026-09-06:

- **WARWAR556** — eine einzige Runde (0 Kills, 1 Tod). Stand mit K/D 0,00
  in der Lobby und zog den Schnitt runter. Behoben durch
  `MIN_KD_ROUNDS_TOTAL = 10`, aber nur das Symptom.
- **Radarik** — 67 Runden `squad-fpp`, keine Duo-Werte, obwohl er im
  Spiel 47 Duo-Partien hat. Ursache war der fest auf `squad-fpp`
  verdrahtete Sammler; behoben durch `rotating_season_mode()`.

Beide zeigen dasselbe Muster: Der eine Wert, den wir speichern, muss für
alle Zeitpunkte herhalten.

## Was heute passiert

`player_season_snapshot` hat den Primärschlüssel
`(account_id, season_id, mode)`. Jeder Refresh **überschreibt**. Es gibt
keine Historie — das war eine bewusste Entscheidung und steht so im
Modul-Docstring von `pubg/lobby_kd.py`:

> Der Wert ist ein Schnappschuss von heute, nicht von damals: die API
> kennt keine Historie.

Verschärfend liefen bis 2026-09-07 vier Dauerläufer (einer je Tenant) mit
`--max-age-days 28`. Die haben Snapshots **altersbasiert** erneuert, ohne
dass ein neues Match mit dem Gegner stattgefunden hatte — also genau die
Werte überschrieben, die zu einem alten Match gehörten. Gestoppt.

## Harte Grenze: keine Rückwirkung

Die PUBG-API liefert ausschließlich den aktuellen Stand. Für ein Match im
Mai existiert kein Mai-Snapshot und wird nie einer existieren.

**Die Historie beginnt bei Null.** Alte Matches behalten den einen Wert,
den wir haben; sie werden durch den Umbau nicht besser, nur ehrlicher
etikettiert. Brauchbar wird das Ganze erst mit den Monaten.

Wer das nicht akzeptiert, braucht den Umbau nicht — dann ist die
Alternative, den Wert konsequent als „Stand heute" auszuweisen und die
Zuordnung zum Match gar nicht zu behaupten.

## Design

### 1. Schema

`fetched_at` wandert in den Primärschlüssel:

```sql
ALTER TABLE obs.player_season_snapshot
  DROP CONSTRAINT player_season_snapshot_pkey,
  ADD  CONSTRAINT player_season_snapshot_pkey
       PRIMARY KEY (account_id, season_id, mode, fetched_at);

CREATE INDEX idx_pss_lookup
  ON obs.player_season_snapshot (account_id, mode, fetched_at DESC);
```

Bestehende Zeilen bleiben unverändert und bilden den ersten
Historien-Punkt. Kein Datenverlust, keine Umschreibung.

Der neue Index trägt die Lese-Query („neuester Snapshot vor Zeitpunkt X").

### 2. Schreiben: Insert statt Upsert

`db_pg.upsert_season_snapshots` und `upsert_lifetime_snapshots` legen neue
Zeilen an, statt bestehende zu ersetzen.

Schutz gegen Zeilenflut: Ein neuer Snapshot wird nur geschrieben, wenn der
letzte für dieselbe Kombination **inhaltlich abweicht** (`rounds` oder
`kills` verändert). Ein Gegner, der zwischen zwei Kontakten nicht gespielt
hat, erzeugt keine zweite identische Zeile.

### 3. Lesen: der zum Match passende Snapshot

Für jedes Paar (Match, Account) gilt der letzte Snapshot **vor oder zum**
Match-Zeitpunkt:

```sql
SELECT DISTINCT ON (s.account_id, s.mode)
       s.account_id, s.mode, s.kills, s.losses, s.rounds, s.fetched_at
FROM obs.player_season_snapshot s
WHERE s.account_id = ANY(%s)
  AND s.fetched_at <= %s          -- matches.played_at
ORDER BY s.account_id, s.mode, s.fetched_at DESC
```

**Fallback** wenn es keinen früheren gibt (der Normalfall für alle heutigen
Daten): den frühesten **danach** nehmen und als solchen kennzeichnen. Sonst
verlieren alle Alt-Matches ihren Wert — das wäre eine Verschlechterung.

Der Fall „derselbe Gegner zweimal hintereinander in der Lobby" löst sich
damit von selbst: Für beide Matches gewinnt derselbe nächstgelegene
Snapshot, solange dazwischen keiner geholt wurde.

Die Herkunft gehört an den Wert, wie schon bei `source`/`seasonId`:

| Feld | Bedeutung |
|---|---|
| `snapshotAt` | Zeitstempel des verwendeten Snapshots |
| `snapshotAge` | Abstand zum Match, in Tagen (vorzeichenbehaftet) |
| `snapshotDirection` | `before` (sauber) / `after` (Fallback) |

Im Modal steht das analog zu heute, z. B.
`duo-fpp-season-42, 70 Runden · Stand 3 Tage vor dem Match`.

### 4. Refresh nur bei neuem Match-Kontakt

`--max-age-days` entfällt als Auslöser. Ein Account wird nur dann neu
abgefragt, wenn er in einem Match auftaucht, für das noch kein Snapshot
zum passenden Zeitpunkt vorliegt:

```sql
-- Kandidaten: Kontakt ohne Snapshot VOR dem Match-Zeitpunkt
SELECT DISTINCT mtm.account_id
FROM obs.match_team_mapping mtm
JOIN obs.matches m ON m.match_id = mtm.match_id
WHERE NOT EXISTS (
        SELECT 1 FROM obs.player_season_snapshot s
        WHERE s.account_id = mtm.account_id
          AND s.mode = %s
          AND s.fetched_at <= m.played_at)
```

Damit sammelt der Poller weiterhin kontinuierlich, aber zielgerichtet: für
jede neue Lobby einmal, danach nie wieder für dasselbe Match.

Die Modus-Rotation (`rotating_season_mode`, versetzt je Tenant) bleibt und
greift hier unverändert.

## Wachstum

Gemessen am 2026-09-07:

| | |
|---|---|
| Snapshot-Zeilen | 479.972 |
| Accounts | 108.798 |
| Tabellengröße | 135 MB |
| Match-Kontakte | 254.834 |
| Matches | 2.696 (ab 2026-04-20) |
| Accounts mit **einem** Kontakt | 78.968 (67 %) |
| Accounts mit mehreren | 39.165 |

Zwei Drittel aller Accounts tauchen genau einmal auf — für die bleibt es
bei einer Zeile. Nur die 39.165 Mehrfach-Accounts wachsen, und auch nur,
wenn sie zwischen zwei Kontakten tatsächlich gespielt haben (Regel 2).

Grobe Schätzung für ein Jahr: eine Verdopplung bis Verdreifachung, also
300–400 MB. Unkritisch.

Falls es je klemmt, ist die naheliegende Grenze eine Aufbewahrungsregel:
Snapshots, die zu keinem Match mehr als „passend" ausgewählt werden,
löschen.

## Offene Entscheidungen

1. **Fallback-Richtung** — soll ein Snapshot *nach* dem Match verwendet
   werden, wenn kein früherer existiert? Empfehlung: ja, gekennzeichnet.
   Sonst verlieren alle 2.696 bestehenden Matches ihren Lobby-Wert.
2. **Zuordnung persistieren?** — die Lese-Query löst es zur Laufzeit über
   den Zeitstempel. Eine Tabelle `match_player_snapshot` wäre schneller
   und stabiler, ist aber Redundanz. Empfehlung: erst zur Laufzeit, eine
   Zuordnungstabelle nur, wenn es messbar zu langsam wird.
3. **Alt-Werte kennzeichnen** — die 479.972 vorhandenen Zeilen haben ein
   `fetched_at` von heute und sind für Alt-Matches Fallbacks. Sollen sie
   im Modal sichtbar als „Stand nach dem Match" markiert werden?
   Empfehlung: ja, das ist der ganze Punkt der Übung.

## Umsetzungsschritte

1. Migration auf prod (`ALTER TABLE` + Index) — Schema-Prefix `obs.`,
   `sudo -u postgres psql`, siehe `reference_prod_db_migrations`
2. `db_pg`: Insert-statt-Upsert mit Abweichungs-Prüfung, plus die neue
   Lookup-Funktion mit Zeitpunkt-Parameter
3. `lobby_kd`: `kd_alltime`/`kd_for_mode` bekommen den Match-Zeitpunkt
   durchgereicht; Rückgabe um `snapshotAt`/`snapshotAge`/
   `snapshotDirection` erweitert
4. `poller`/`cli`: Kandidaten-Query auf Match-Kontakt umstellen,
   `--max-age-days` entfernen
5. Frontend: `basisHtml` um den Stand-Hinweis erweitern
6. Tests: Auswahl vor/nach Match, Fallback-Kennzeichnung, keine
   Doppel-Zeile bei unveränderten Werten

Schritte 2–6 sind TDD-fähig; Schritt 1 ist der einzige nicht umkehrbare.
