# G1R-Overlay — Design-Spec

**Datum:** 2026-06-18 · **Status:** Design approved (Mockups), bereit für Implementierungsplan

## Ziel

Aus dem G1R-Diagnose-Widget (`widgets/g1r/test.html`, eine Riesenliste) drei fokussierte,
theme-fähige OBS-Overlay-Bausteine machen, gespeist vom bestehenden lokalen Proxy
(UE4SS-Mod → `g1r-state.json` → `server.py` @ localhost:9210 → Widget).

Mockup (approved): `docs/design-proposals/g1r-overlay-mockup.html`.

## Komponenten

### 1. Livebar (≈ 720×46)
Horizontale Dauer-Leiste im PUBG-Livebar-Stil (`Wert Label · Wert Label · …`).
Felder: **Level · Steps · DMG out · DMG taken · Mana used · HP regen · Mana regen · Uhr**.

### 2. News-Ticker (≈ 760×40)
Laufband, das durch Info-Gruppen rotiert: **Stats** (STR/DEX/HP/Mana) → **Session-Werte**
(Strecke, DMG out/taken) → **stärkste Waffe** → **stärkster nutzbarer Zauber**.

### 3. Career-Card (≈ 360×480)
Detail-Tafel (Vorbild PUBG-Career-Card). Kopf: **Steamname** (aus `config`, nicht „Namenloser
Held") + Gilde/Lager/Level. Blöcke: Stats, Resistenzen, **Gesamt-Werte** (persistent über alle
Sessions), **Rekorde**, aktuelle Ausrüstung (stärkste Waffe/Zauber).

## Datenfelder — Quelle & Machbarkeit

| Feld | Quelle | Status |
|---|---|---|
| Level, Stats, HP/Mana, Resistenzen, magicCircle | GAS (`readStats`) | vorhanden |
| Strecke, Schritte (Session) | Position-Deltas | vorhanden |
| erhaltener Schaden, HP/Mana-Regen, Mana-Verbrauch (Session) | Stat-Deltas | vorhanden |
| Gilde, Uhr | vorhanden | vorhanden |
| Inventar (Waffen/Runen-Filter) | Container-Items (crashfrei) | vorhanden |
| **ausgeteilter Schaden** | UE4SS-`RegisterHook` auf eine Damage-Funktion (`OnDamageCaused`/`ApplyDamageTo`) | NEU, mittleres Crash-Risiko → einzeln testen (Flag) |
| **Gesamt-Werte (persistent)** | Zähler in Datei (`g1r-totals.json`) schreiben + beim Start laden, aufaddieren | NEU, crashfrei (reines io) |
| **Rekorde** (härtester erhaltener/ausgeteilter Treffer, weiteste Strecke/Schritte, max Mana/Tick) | Maximum der gemessenen Deltas, persistent | NEU, crashfrei (außer ausgeteilt = Hook) |
| **stärkste Waffe** | Wiki-Schadenswert-Ranking (Mapping `weapon_damage.json`) × Inventar-Waffen | NEU, crashfrei (Engine-Wert crasht → Wiki-Mapping) |
| **stärkster nutzbarer Zauber** | Wiki Rune→benötigter-Kreis (Mapping) × `magicCircle`; blendet nicht-nutzbare Runen aus | NEU, crashfrei |

**Bewusst NICHT:** „aktiver Zauber"/„geführte Waffe"/exakte Hotbar — crashen am Build (dokumentiert).

## Architektur

- **Mod (`main.lua`)** liefert die Rohdaten weiter wie bisher; NEU:
  - Damage-Hook (hinter `READ_DMG_OUT`-Flag, default aus bis verifiziert) für ausgeteilten Schaden + härtesten ausgeteilten Treffer.
  - Rekord-Maxima (härtester erhaltener Treffer, max Mana/Tick, weiteste Strecke/Schritte) aus den schon gemessenen Deltas.
  - Persistente Gesamt-Werte: beim Start `g1r-totals.json` laden, Session-Deltas drauf addieren, periodisch zurückschreiben.
- **`server.py`** reichert `/state` an:
  - `weapon_damage.json` (Wiki-Mapping Klassenname→Schaden) → bestimmt aus den Inventar-Waffen die stärkste.
  - `spell_circle.json` (Wiki-Mapping Rune→Kreis) + `magicCircle` → stärkster nutzbarer Zauber, filtert nicht-nutzbare Runen.
  - `?lang=de|en` (Default **en**) gilt jetzt auch für UI-Labels der drei Komponenten (nicht nur Item-Namen).
- **Widgets** `widgets/g1r/livebar.html`, `news-ticker.html`, `career-card.html`:
  - Theme-fähig über `--theme-*`-Tokens mit echten Entry-Defaults (KEINE zirkulären Vars), `_theme.css` laden, server-injiziertes `data-theme`.
  - Englische Default-Labels, `?lang`-fähig.
  - Keine Inline-Styles.
- **Wiki-Recherche (einmalig, Bau-Zeit):** Schadenswerte aller Waffen + Kreis-Anforderung aller Runen aus gothic-remake.wikily.gg → die beiden JSON-Mappings.

## Persistenz

`g1r-totals.json` (neben `g1r-state.json`, vom Mod geschrieben): kumulierte Gesamt-Werte +
Rekorde. Robust gegen halb-geschriebene Datei (try/except). Session-Werte bleiben flüchtig
(ab Mod-Start), Gesamt-Werte überleben.

## Theming & Sprache

Alle drei Komponenten strikt theme-fähig (`--theme-*`), Default-Sprache **en**, via `?lang=de|en`
umschaltbar — konsistent mit dem bestehenden Item-Namen-Mechanismus in `server.py`.

## Offene Risiken

- **Damage-Hook** (ausgeteilter Schaden) ist der einzige neue Engine-Eingriff → hinter Flag,
  einzeln in-game verifizieren (wie alle G1R-Reader). Fällt er aus, fehlt nur „DMG out" + der
  Rekord „härtester ausgeteilter Treffer"; alles andere ist crashfrei.

## Bau-Reihenfolge (Etappen)

1. **Wiki-Mappings** (`weapon_damage.json`, `spell_circle.json`) recherchieren + anlegen.
2. **server.py**: stärkste Waffe / nutzbarer Zauber / UI-`?lang`.
3. **Mod**: Persistenz (Gesamt-Werte) + Rekord-Maxima (crashfreie Felder) → dann Damage-Hook (Flag).
4. **Widgets**: Livebar → News-Ticker → Career-Card (theme-fähig, en).
