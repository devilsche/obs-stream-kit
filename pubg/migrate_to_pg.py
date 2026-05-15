#!/usr/bin/env python3
"""Migration: SQLite pubg-history.db → PostgreSQL.

Laueft auf dem Streaming-PC wo die SQLite-DB liegt.
Schreibt alle Daten in die PostgreSQL-Instanz.

Nutzung:
    python -m pubg.migrate_to_pg                         # alles migrieren
    python -m pubg.migrate_to_pg --init-schema           # Schema anlegen + migrieren
    python -m pubg.migrate_to_pg --table players         # nur eine Tabelle
    python -m pubg.migrate_to_pg --dry-run               # zählen ohne schreiben

DSN aus .secrets (Zeile: PUBG PG DSN: ...) oder env PUBG_PG_DSN.
"""

import os, sys, argparse, datetime
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def _log(msg):
    ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def migrate_players(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT account_id, name, platform, is_self, "
        "first_seen_at, last_polled_at FROM players"
    ).fetchall()
    _log(f"  players: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO players
                    (account_id, name, platform, is_self, first_seen_at, last_polled_at)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (account_id) DO UPDATE
                    SET name=EXCLUDED.name,
                        last_polled_at=EXCLUDED.last_polled_at
            """, (r["account_id"], r["name"], r["platform"],
                  r["is_self"], r["first_seen_at"], r["last_polled_at"]))
    pg_conn.commit()
    return len(rows)


def migrate_matches(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT match_id, map_name, game_mode, is_ranked, duration_secs, "
        "played_at, telemetry_url, telemetry_fetched, telemetry_schema "
        "FROM matches"
    ).fetchall()
    _log(f"  matches: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO matches
                    (match_id, map_name, game_mode, is_ranked, duration_secs,
                     played_at, telemetry_url, telemetry_fetched, telemetry_schema)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (match_id) DO NOTHING
            """, (r["match_id"], r["map_name"], r["game_mode"], r["is_ranked"],
                  r["duration_secs"], r["played_at"], r["telemetry_url"],
                  r["telemetry_fetched"], r["telemetry_schema"]))
    pg_conn.commit()
    return len(rows)


def migrate_participants(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT match_id, account_id, name, team_id, place, kills, "
        "headshot_kills, assists, dbnos, revives, damage_dealt, longest_kill, "
        "time_survived, walk_distance, ride_distance, swim_distance, "
        "weapons_acquired, heals, boosts, team_kills FROM participants"
    ).fetchall()
    _log(f"  participants: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO participants
                    (match_id, account_id, name, team_id, place, kills,
                     headshot_kills, assists, dbnos, revives, damage_dealt,
                     longest_kill, time_survived, walk_distance, ride_distance,
                     swim_distance, weapons_acquired, heals, boosts, team_kills)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (match_id, account_id) DO NOTHING
            """, tuple(r))
    pg_conn.commit()
    return len(rows)


def migrate_match_team_mapping(sqlite_conn, pg_conn, dry_run=False):
    try:
        rows = sqlite_conn.execute(
            "SELECT match_id, account_id, team_id, kills, place, time_survived "
            "FROM match_team_mapping"
        ).fetchall()
    except Exception:
        _log("  match_team_mapping: Tabelle nicht vorhanden — übersprungen")
        return 0
    _log(f"  match_team_mapping: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO match_team_mapping
                    (match_id, account_id, team_id, kills, place, time_survived)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (match_id, account_id) DO NOTHING
            """, (r["match_id"], r["account_id"], r["team_id"],
                  r["kills"], r["place"], r["time_survived"]))
    pg_conn.commit()
    return len(rows)


def migrate_telemetry_events(sqlite_conn, pg_conn, dry_run=False,
                              chunk_size=5000):
    total = sqlite_conn.execute(
        "SELECT COUNT(*) FROM telemetry_events").fetchone()[0]
    _log(f"  telemetry_events: {total} Rows (chunk={chunk_size})")
    if dry_run:
        return total
    offset = 0
    inserted = 0
    while True:
        rows = sqlite_conn.execute(
            "SELECT match_id, event_type, timestamp_ms, actor_account, "
            "target_account, actor_x, actor_y, actor_z, actor_health, "
            "victim_x, victim_y, weapon, distance, damage, payload_json "
            "FROM telemetry_events LIMIT ? OFFSET ?",
            (chunk_size, offset)
        ).fetchall()
        if not rows:
            break
        with pg_conn.cursor() as cur:
            for r in rows:
                cur.execute("""
                    INSERT INTO telemetry_events
                        (match_id, event_type, timestamp_ms, actor_account,
                         target_account, actor_x, actor_y, actor_z, actor_health,
                         victim_x, victim_y, weapon, distance, damage, payload_json)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, tuple(r))
        pg_conn.commit()
        inserted += len(rows)
        offset += chunk_size
        _log(f"    telemetry_events: {inserted}/{total} ...")
        if len(rows) < chunk_size:
            break
    return inserted


def migrate_player_lifetime(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT account_id, mode, rounds_played, wins, top10s, win_rate, "
        "top10_rate, kills, kd_ratio, headshot_kills, headshot_rate, avg_damage, "
        "longest_kill, time_survived_sec, assists, damage_dealt, dbnos, "
        "revives, team_kills, losses, last_refreshed FROM player_lifetime"
    ).fetchall()
    _log(f"  player_lifetime: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO player_lifetime
                    (account_id, mode, rounds_played, wins, top10s, win_rate,
                     top10_rate, kills, kd_ratio, headshot_kills, headshot_rate,
                     avg_damage, longest_kill, time_survived_sec, assists,
                     damage_dealt, dbnos, revives, team_kills, losses, last_refreshed)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (account_id, mode) DO UPDATE
                    SET rounds_played=EXCLUDED.rounds_played,
                        last_refreshed=EXCLUDED.last_refreshed
            """, tuple(r))
    pg_conn.commit()
    return len(rows)


def migrate_player_season(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT account_id, season_id, mode, rounds_played, wins, top10s, "
        "win_rate, top10_rate, kills, kd_ratio, headshot_kills, headshot_rate, "
        "avg_damage, longest_kill, time_survived_sec, assists, damage_dealt, "
        "dbnos, revives, team_kills, losses, last_refreshed FROM player_season"
    ).fetchall()
    _log(f"  player_season: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO player_season
                    (account_id, season_id, mode, rounds_played, wins, top10s,
                     win_rate, top10_rate, kills, kd_ratio, headshot_kills,
                     headshot_rate, avg_damage, longest_kill, time_survived_sec,
                     assists, damage_dealt, dbnos, revives, team_kills, losses,
                     last_refreshed)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (account_id, season_id, mode) DO NOTHING
            """, tuple(r))
    pg_conn.commit()
    return len(rows)


def migrate_achievements(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT achievement_id, match_id, label, icon, played_at, "
        "detected_at, displayed_at, is_rare FROM pubg_achievements_seen"
    ).fetchall()
    _log(f"  pubg_achievements_seen: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO pubg_achievements_seen
                    (achievement_id, match_id, label, icon, played_at,
                     detected_at, displayed_at, is_rare)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (achievement_id, match_id) DO NOTHING
            """, tuple(r))
    pg_conn.commit()
    return len(rows)


def migrate_settings(sqlite_conn, pg_conn, dry_run=False):
    rows = sqlite_conn.execute(
        "SELECT key, value, updated_at FROM settings"
    ).fetchall()
    _log(f"  settings: {len(rows)} Rows")
    if dry_run or not rows:
        return len(rows)
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO settings (key, value, updated_at)
                VALUES (%s,%s,%s)
                ON CONFLICT (key) DO UPDATE
                    SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at
            """, tuple(r))
    pg_conn.commit()
    return len(rows)


ALL_TABLES = [
    ("players",            migrate_players),
    ("matches",            migrate_matches),
    ("participants",       migrate_participants),
    ("match_team_mapping", migrate_match_team_mapping),
    ("player_lifetime",    migrate_player_lifetime),
    ("player_season",      migrate_player_season),
    ("pubg_achievements_seen", migrate_achievements),
    ("settings",           migrate_settings),
    # telemetry_events zuletzt (groesste Tabelle)
    ("telemetry_events",   migrate_telemetry_events),
]


def main():
    parser = argparse.ArgumentParser(
        description="Migriert pubg-history.db → PostgreSQL")
    parser.add_argument("--sqlite", default=None,
                        help="Pfad zur SQLite-DB (default: data/pubg-history.db)")
    parser.add_argument("--init-schema", action="store_true",
                        help="PostgreSQL-Schema anlegen vor der Migration")
    parser.add_argument("--table", default=None,
                        help="Nur diese Tabelle migrieren")
    parser.add_argument("--dry-run", action="store_true",
                        help="Nur zaehlen, nichts schreiben")
    args = parser.parse_args()

    sqlite_path = args.sqlite or os.path.join(ROOT, "data", "pubg-history.db")
    if not os.path.exists(sqlite_path):
        print(f"SQLite-DB nicht gefunden: {sqlite_path}")
        print("Tipp: --sqlite /pfad/zur/pubg-history.db")
        sys.exit(1)

    from pubg.db_pg import connect as pg_connect, init_schema, load_dsn
    secrets = os.path.join(ROOT, ".secrets")
    dsn = load_dsn(secrets)
    if not dsn:
        print("Kein PostgreSQL-DSN gefunden.")
        print("Trag in .secrets ein:  PUBG PG DSN: postgresql://user:pass@host/db")
        sys.exit(1)

    _log(f"SQLite:     {sqlite_path}")
    _log(f"PostgreSQL: {dsn.split('@')[-1]}")  # nur Host:Port/DB zeigen
    if args.dry_run:
        _log("DRY-RUN — es wird nichts geschrieben")

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row

    pg_conn = pg_connect(dsn)

    if args.init_schema:
        _log("Schema anlegen...")
        init_schema(pg_conn)
        _log("Schema OK")

    tables = ALL_TABLES
    if args.table:
        tables = [(t, fn) for t, fn in ALL_TABLES if t == args.table]
        if not tables:
            print(f"Unbekannte Tabelle: {args.table}")
            print("Verfuegbar:", ", ".join(t for t, _ in ALL_TABLES))
            sys.exit(1)

    _log(f"Starte Migration ({len(tables)} Tabellen)...")
    total = 0
    for table_name, fn in tables:
        _log(f"→ {table_name}")
        n = fn(sqlite_conn, pg_conn, dry_run=args.dry_run)
        total += n

    _log(f"Fertig — {total} Rows {'gezählt' if args.dry_run else 'migriert'}")
    sqlite_conn.close()
    pg_conn.close()


if __name__ == "__main__":
    main()
