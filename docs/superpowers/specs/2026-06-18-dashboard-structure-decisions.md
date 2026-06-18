# Dashboard-Struktur — Architektur-Entscheidungen

**Stand:** 2026-06-18 · **Status:** verbindlich festgezurrt. **Kein Bau in dieser Runde.**
Der Bau folgt in 4 Sub-Projekten (je eigene Spec→Plan). Reihenfolge: **2+3 (Fundamente) → 1 → 4.**

Zweck: Struktur für das eingeloggte Dashboard (`app/`) + die wachsende Zahl an Domains
(PUBG, Steam, G1R, …) festlegen, damit Designs/Komponenten/Parameter über alle Domains
identisch bleiben und nicht pro Domain neu erfunden werden.

## 1. Navigation: domain-first

Top-Nav-Cluster: **PUBG · Steam · G1R · Stream · Global**.
Pro Spiel-/Anbindungs-Cluster identisches Innen-Muster: **`URLs→[Typen] · Tools · Setup/Status`**.

| Cluster | URLs (OBS-Sources) | Tools (Editoren, normaler Tab) | Voraussetzung / Eigenheit |
|---|---|---|---|
| PUBG | Widgets: Stats·Mates·Match·Maps·News·Achievements (~31) | POI-Editor, Landing-Spots, Match-Replay | PUBG-API-Key (+ Steam-ID Presence) |
| Steam | Widgets: Now-Playing, Achievement-Popup … (5) | Achievement-Browser | Steam-Key + ID |
| G1R | Widgets: Livebar, News-Ticker, Career-Card (+ später Alerts/Milestones) | Mod-ZIP-Download (+ später Run-Manager) | lokaler Proxy + Mod, Tenant-Token fürs Ingest |
| Stream | Alerts (Follow/Sub/Resub/Gift/Bits/Raid/Donation/Welcome) · Szenen (Starting/BRB/Ending) · Stinger · Logos | — | Twitch via Streamer.bot |
| Global | — | Theme-/Ornament-/Icon-Preview | Cockpit · Settings · Admin |

Regeln:
- Generische, nicht-spielspezifische Sources (Alerts/Szenen/Stinger/Logos) gehören in **Stream**, nicht in die Spiel-Cluster.
- Design-Werkzeuge (Theme/Ornament/Icon-Preview) sind Werkzeuge für den Streamer, kein Stream-Output → **Global**.
- Settings/Admin/Cockpit = **Global**.
- Bricht die alte flache, typ-erste `/app/urls`-Master/Detail-Liste auf (war unübersichtlich).

## 2. Domain-Voraussetzungen + Leer-Zustände

Jede Domain hat einen definierten "nicht eingerichtet"-Zustand:
- **PUBG:** ohne API-Key → Cluster zeigt gesperrten Zustand + Setup-Hinweis/Link, keine 500.
- **Steam:** analog (Key + ID).
- **G1R:** kein API-Key; braucht lokalen Proxy + Mod. Tool **Mod-ZIP-Download** (fertiger
  `G1RExport`-Ordner). Status zeigt, ob Ingest-Daten ankommen (DB-Domain Subprojekt 1).
- Serverseitig liefert das Credentials-Gate bereits 403 (`credentials_required`); das Front-end
  rendert daraus den Leer-Zustand, statt zu brechen.

## 3. Komponenten-System (Quer-Standard) — Sub-Projekt 2

Prinzip: **jede UI-Komponente einmal designen, benennen, dann nur wiederverwenden.** Kein
lokaler Nachbau. „Ein Rahmen ist ein Rahmen, ein Fly-in-Left-Border ist *das*."

- Heimat: `widgets/_blocks.css` (`t-*`-Bausteine) + `widgets/_theme.css` (Tokens).
- Kanonisches Vokabular (Namen festzurren): Rahmen=`.t-card` (Ornament via `::before`),
  Header=`.t-header`/`.t-range`, Stat-Zelle=`.t-stat`/`.t-value`/`.t-label`,
  Highlight=`.t-hot`/`.t-hot-mark`, Marquee, Fly-in, Left-Border-Akzent.
- Regel: neue Sources komponieren aus diesem Set. Fehlt ein Baustein → er wird **einmal hier**
  ergänzt, nicht lokal nachgebaut. Keine Inline-Styles (bestehende Regel).
- Sub-Projekt-2-Inhalt: Inventur + Benennung des Vokabulars, Lücken schließen, Component-
  Preview-Seite, Migration bestehender Eigenbau-Widgets (u.a. G1R career-card) auf das Set.

## 4. Parameter-Modell (Quer-Standard) — Sub-Projekt 3

Prinzip: **nicht dieselben Parameter überall, aber dasselbe Schema**, wie Parameter definiert,
gruppiert und gerendert werden.

- Jede Source deklariert ihre Parameter in einer gemeinsamen Struktur:
  `{key, label, type (text|select|number|bool|color), group, default, help}`.
- Die Detailseite rendert daraus uniform + baut die Live-URL live zusammen (Kopieren, „In OBS").
- Heute: `app/widget_catalog.py` hält Sizes + Hints → wird zur strukturierten Parameter-
  Deklaration ausgebaut, die Detailseiten daraus generiert.

## 5. Milestone-Subsystem (Variante A) — Sub-Projekt 4

Gemeinsame, domain-agnostische Schnittstelle; Domains unterscheiden sich nur im **Provider**
(den Regeln). Display-/Queue-Infrastruktur teilt sich mit dem bestehenden Achievement-Popup.

- **Record-Schema (Skizze):** `{domain, key, title, subtitle, kind, tier, icon, value, at}`,
  `kind ∈ {threshold, record, event, rate}`. Dedup „feuert genau einmal" via seen-Marker
  (Store oder localStorage).
- **Milestone-Formen** (Logik im Provider, Schema bleibt gleich):
  - *threshold* — „Level 10", „100. Chicken Dinner".
  - *record* — „neuer härtester Treffer", „weiteste Strecke".
  - *event* — „Burning Hell · 5 Teams".
  - *rate / Zeitfenster* — **„X Wölfe pro Session", „X Gegner in 5 min"** (G1R: aus
    `g1r_event` kind=kill/meta.type — Count seit Run-Start bzw. Sliding-Window).
- **Provider:** PUBG (Chicken-Marken, Burning Hell, Tiers) und G1R (Level-Schwellen, Rekorde
  aus `g1r_event`/`g1r_sample`, Kill-Counts/Raten). Steam-Achievements bleiben getrennt
  (extern definiert), teilen aber die Display-Schicht.
- **Consumer:** *ein* Celebration-Widget + *ein* Manager (aktivieren/deaktivieren, Schwellen,
  Tier-Styling). Im domain-first-IA erscheinen Milestones pro Domain, getrieben von der einen Engine.

## Bau-Reihenfolge + Abgrenzung

1. **Sub-Projekt 2** (Komponenten) + **3** (Parameter) — Fundamente, zuerst.
2. **Sub-Projekt 1** (IA-Shell): domain-first Top-Nav, Cluster, App-Shell (kein Body-Scroll,
   baut auf dem bestehenden `app_shell_layout`-Plan), Leer-Zustände.
3. **Sub-Projekt 4** (Milestones): nachdem 2+3 stehen und G1R-DB-Domain Sub-2/3 Daten liefert.

Jedes Sub-Projekt bekommt eine eigene Spec + Plan. Dieses Doc ist nur die Struktur-Festlegung.
