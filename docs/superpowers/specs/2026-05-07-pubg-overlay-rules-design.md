---
date: 2026-05-07
status: draft
topic: PUBG Overlay Rules
---

# PUBG Overlay Rules

## Goal

Project-wide rules for all overlay widgets in `widgets/pubg/` — covering visual
consistency, URL parameter conventions, visibility behavior, layout positioning,
and the OBS scene plan for a 1920×1080 stream.

These rules complement the project-wide style basics in `CLAUDE.md`
(Purple/Gold, DM Sans, Vanilla HTML/CSS/JS, transparent backgrounds, German
Conventional Commits).

## Realtime Disclaimer

PUBG provides **no realtime data** for the currently running match through
official channels:

| Source | Realtime? | Latency | Notes |
|---|---|---|---|
| PUBG-API | no | 2–5 min after match end | official lifetime + match results |
| PUBG Telemetry (CDN-JSON) | no | 2–5 min after match end | event-stream as batch per match |
| Game memory / overlays | yes | 0 | **ToS violation** — out of scope |
| Stream OCR | yes | sub-second | fragile, large engineering effort, separate spec track |

**Consequence for all widgets:** every metric shown is **post-match aggregated
over the session/range**. `live-bar`, `news-ticker`, etc. show *Session-Status*,
not *Live-Match-HUD*. Counters tick up only after a match ends and the API has
ingested it.

Stream-OCR-based realtime is out of scope here and tracked in Open Questions.

## Scene Architecture

Four scene types, each with a distinct widget set and visibility mode:

| Scene | When | Widget Set | Visibility |
|---|---|---|---|
| Starting Soon | before stream | Lifetime/Career widgets | always-on |
| Gameplay | active session | Session widgets | hide-when-no-session |
| BRB / Pause | active stream, AFK | Lifetime/Career widgets | always-on |
| Stream-Ending | end of stream | `session-report` + Career outro | session-report = active-only |

## Layout Plan — Gameplay Scene

```
┌────────────── 1920×1080 ──────────────┐
│ live-bar  (top-center, content-fit)    │ ← permanent @session
│                                        │
│        [GAME — fullscreen]             │
│                                        │
│ [Bot-Left-Slot 560×360]                │ ← rotation, 90s each @session
│                                        │
│ news-ticker (bot-center, 90% width)    │ ← 30s on / 10min off @session
└────────────────────────────────────────┘

Triggered overlays:
- chat-stats-popup     → top-right, on chat command
- post-match-card      → moved to slot rotation, no auto-trigger
```

## Widget Categories

### Live-Strips

- `live-bar` — top-center anchor, content-fit width, permanent during session
- `news-ticker` — bottom-center anchor, ~90% screen-width fixed, pop-up schedule
  (30s on / 10min off), snippets rotate internally every 8s

### Bot-Left Rotation Slots (560×360, 90s each, slide-in)

Activated and rotated via OBS source toggling. Each session-only:

- `mates-today`
- `map-performance`
- `top-mates-slider`
- `first-fight`
- `chicken-map`
- `chicken-together`
- `post-match-card` (now "Last Match" slot — no auto-trigger)
- (future) `session-lobbies` — Lobby K/D over session matches
- (future) `hot-drop` — Hot-Drop rate / survival

### Triggered Pop-ups

- `chat-stats-popup` — top-right, on chat command (`!stats <name>`)

### Fullscreen / BRB Cards

- `session-report` — Stream-Ending fullscreen
- `career-card` — Starting / BRB
- `lookup` — Just-Chatting / on-demand

## Header Rules

Every widget with a range-relevant data set shows a header:

- **Format:** `<Title> · <Range>` (English throughout)
- **Position:** at the widget's anchor edge
- **Deactivation:** `?header=0` URL parameter
- No "Aktuelle Session"-style prefixes — range is the dot-separated suffix

## Range System

| Key | Label | Source | Notes |
|---|---|---|---|
| `session` | `Session` | local DB since session-cutoff | default for live widgets |
| `week` | `7 days` | local DB last 7 days | |
| `all` | `Database (since DD.MM.)` | local DB all matches | "since" = `MIN(played_at)` formatted dd.MM. |
| `career` | `Career` | PUBG-API career-lifetime | external lifetime |

`day` (Heute) is **removed** — too redundant with `session`.

## URL Parameter Conventions

| Pattern | Meaning |
|---|---|
| `?<name>=0` | hide / disable. Default is on. Examples: `?header=0`, `?filter=0` |
| `?range=session\|week\|all\|career` | range selection |
| `?focus=session\|lifetime\|mix` | news-ticker only — snippet category focus |
| `?sortBy=<key>` | per-widget sort (existing) |
| `?layout=<value>` | per-widget layout selector (e.g., mates-today carousel/stack/fold/mosaic) |
| `?scale=0.8` | global zoom — existing in `_pubg.js` |

## Visibility Rules

- **Session-mode widgets** (`?range=session` or default): hide body when:
  - `session.matches === 0` (no current session matches), OR
  - last match older than 1 hour
- **Lifetime/Career-mode widgets** (`?range=all|career`, or `?focus=lifetime`):
  always visible — no hide check
- `live-bar`: session-only by design — no lifetime variant
- The body-level `hideIfStale()` helper must be skipped in lifetime/career mode

## Width Rules

| Widget Type | Width Behavior |
|---|---|
| Live-strip (`live-bar`) | content-fit (auto) |
| Rotating-strip (`news-ticker`) | ~90% screen-width, fixed |
| Bot-Left-Slot | 560×360 fixed |
| Pop-up | content-fit |
| Fullscreen | 100% |

## Anchor Concept

Every widget defines a single **anchor point** in its OBS source rectangle. All
animations originate from / grow away from that anchor.

| Widget / Slot | Anchor | Animation Direction |
|---|---|---|
| `live-bar` | top-center | static (fade only) |
| `news-ticker` | bottom-center | snippet y-axis fade |
| Bot-Left Slots | bottom-left | slide-in from right; lists grow up; fold opens up |
| `chat-stats-popup` | top-right | slide-in from right |
| `post-match-card` (in slot) | bottom-left | (per slot rules) |

Specifically for `mates-today` fold-layout: container `flex-direction:
column-reverse`, body `justify-content: flex-end` — new mates push the stack
upward.

## Overflow Strategy

When content exceeds slot dimensions (560×360):

- Default: **Top-N truncation** (N=5 typical)
- Per widget the right strategy:
  - Tables (`map-performance`) → Top-N rows by primary metric
  - Lists (`top-mates`, `chicken-map`, `chicken-together`) → Top-N
  - Cards (`mates-today`) → already fit per-mate, multiple via internal carousel
- Auto-scroll and auto-cycle reserved for fullscreen versions, not slot mode

## Implementation Backlog

Ordered roughly by impact:

### Bug fixes (urgent)

- [ ] `news-ticker.html` — skip `hideIfStale()` in `?focus=lifetime` mode
  (current implementation hides ticker on Starting/BRB scenes incorrectly)
- [ ] `live-bar.html` — switch to content-fit width
  (`width: auto`, `display: inline-flex`)
- [ ] `mates-today.html` fold-layout — anchor at bottom-left, unfold upward

### Spec adoption (medium)

- [ ] All widgets — header format `<Title> · <Range>` consistent
- [ ] All widgets — `?header=0` deactivation parameter implemented
- [ ] All widgets — remove `?range=day` option from filter bars and HTML
- [ ] Range labels — switch all to English (`Session`, `7 days`, `Career`,
      `Database (since DD.MM.)`)
- [ ] `post-match-card` — remove auto-trigger logic; behave as plain slot widget
- [ ] All widgets — declare anchor in code (CSS comment + body alignment)

### Backend (medium)

- [ ] Add field `firstMatchAt` to `/api/pubg/status` (or new endpoint) for
      dynamic "Database (since DD.MM.)" label
- [ ] Compute `lobbyAvgKd` per match — average K/D over all participants
      (data already in DB)
- [ ] Hot-drop aggregations: `hotDropRate`, `hotDropSurvivalSolo`,
      `hotDropSurvivalTeam`, `hotDropStreak` (uses existing telemetry ingestion)
- [ ] Trend-deltas: previous-session aggregations for K/D / Wins / DMG-Avg

### New widgets

- [ ] `session-lobbies.html` — Lobby-Avg-K/D with sparkline + diff to user's K/D
      (post-match aggregated over session matches)
- [ ] `hot-drop.html` — Hot-Drop rate, solo/team survival, streak — session
      aggregated
- [ ] Trend-Indicator — could be standalone widget or news-ticker-snippet:
      `Session vs. last session: K/D ↑0.3 · Wins ↑1 · DMG-Avg ↓120`
- [ ] `streak-counter.html` — current streak with flame icon, configurable type:
      `?type=chicken|top10|kd1` — increments per success match, resets on fail
- [ ] `session-goal.html` — progress bar toward configurable session goal:
      `?goal=kills:20 | chickens:3 | matches:10 | kd:2.0` — fills as session
      advances, hides when goal reached
- [ ] `session-achievements.html` — milestone log for current session. Triggers
      and persists entries like:
      - "First Chicken!" (first win)
      - "First Top-10!"
      - "Longest Kill 400m+"
      - "5+ Kills in a Match"
      - "Beast Chicken" (win with 5+ kills)
      - "Hot-Drop Survivor" (3-min fight, survived)
      - "Top-10 Streak ×3"
      Two display modes: persistent log card (slot-suitable) and pop-up alert
      when triggered (similar to alert animations)

### News-ticker enhancements

- [ ] Snippet pool expansion (Top-3 maps, longest kill, best K/D match,
      compare-to-last-session, lobby-diff, hot-drop) — required *before*
      considering permanent-on schedule

### Cleanup (deferred to separate spec)

- [ ] `map-distribution` — candidate for removal (subset of `map-performance`)
- [ ] `top-mates` (static) — candidate for removal in favor of `top-mates-slider`
- [ ] `session-summary` — candidate for merge into `session-report?compact=1`
- [ ] `flyout-full` — refactor to load other widgets as iframes instead of
      duplicating their logic
- [ ] `squad-compare` — review usage, possibly remove

## Open Questions

- **Local-process visibility triggers** — supplement the 1h-stale check with
  faster local signals about whether a PUBG match is currently running. Scope
  limited to **safe** approaches:
  - Process-watch on `tslgame.exe` (running / not) — trivial via local agent
  - Log-file tailing on `%LOCALAPPDATA%\TslGame\Saved\Logs\TslGame.log` —
    read-only, scan for match-start / match-end markers
  Explicitly excluded: process-memory reading, network packet manipulation, or
  anything BattlEye would flag. Use case: hide widgets *immediately* after
  match-end instead of waiting for the 1h stale-check; show a
  "match running"-indicator faster than API can.
- **Stream-OCR realtime track** — separate spec if/when invested in true
  realtime HUD (kill/dmg/place from rendered game frames)
- **Multi-tenant SaaS deployment** — running this for many streamers from
  a single hosted instance. Two paths considered:
  - *Self-host per user* (Docker Compose): 1–2 days packaging effort,
    each streamer hosts own instance. Recommended first step.
  - *Real SaaS* (shared server, per-user tokens + DBs): 2–3 weeks,
    requires Postgres, schema-wide `user_id`, per-user PUBG-API-keys.
    Critical bottleneck is **NOT the DB** but the PUBG-API rate limit
    (10 req/min per key). Multi-tenant only feasible if each user
    brings their own API key — shared platform key tops out at ~5
    active streamers.
  - DB scaling estimate: 1.000 active users feasible on a single
    Postgres VPS *if* telemetry events are aggregated at ingest (no
    raw event-row archive). 20.000 users → cluster + sharding +
    cold-storage, separate engineering effort.
- **Server-side cron deployment** — splitting `pubg/poller.py` from
  in-process thread to separate CLI tick (`--tick-matches`,
  `--tick-telemetry`), driven by cron / systemd timer on a server.
  Decouples data ingestion from streaming-PC uptime. ~1–2 days work.
  Pre-requisite for the SaaS path; also useful standalone for personal
  always-on collection.
- **Permanent news-ticker mode** — pending snippet-pool expansion
- **Fullscreen slot widgets for Pause-scene reuse** — `?fullscreen=1` param
  semantics tbd
- **Telemetry-driven widgets** (drop spots, weapon performance, death cause) —
  larger backend work, not prioritized here
