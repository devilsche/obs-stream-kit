"""Migration: SQLite (pubg-history.db, steam-history.db) → PostgreSQL.

Verwendung:
    python -m core.migrate_sqlite_to_pg pubg  --tenant-id 1 [--db data/pubg-history.db]
    python -m core.migrate_sqlite_to_pg steam --tenant-id 1 [--db data/steam-history.db]
    python -m core.migrate_sqlite_to_pg pois  [--json data/pubg-pois.json]
    python -m core.migrate_sqlite_to_pg all   --tenant-id 1
"""
import argparse
import json
import os
import sqlite3
import sys

from core import db as core_db


# (column-list, sqlite-select) je Tabelle. ORDER matters: parents first.
PUBG_TABLES = [
    ("players",
     ["account_id","name","platform","is_self","first_seen_at","last_polled_at"]),
    ("matches",
     ["match_id","map_name","game_mode","is_ranked","duration_secs","played_at",
      "telemetry_url","telemetry_fetched","telemetry_schema"]),
    ("participants",
     ["match_id","account_id","name","team_id","place","kills","headshot_kills",
      "assists","dbnos","revives","damage_dealt","longest_kill","time_survived",
      "walk_distance","ride_distance","swim_distance","weapons_acquired",
      "heals","boosts","team_kills"]),
    ("match_team_mapping",
     ["match_id","account_id","team_id","kills","place","time_survived"]),
    ("player_lifetime",
     ["account_id","mode","rounds_played","wins","top10s","win_rate","top10_rate",
      "kills","kd_ratio","headshot_kills","headshot_rate","avg_damage",
      "longest_kill","time_survived_sec","assists","damage_dealt","dbnos",
      "revives","team_kills","losses","last_refreshed"]),
    ("player_season",
     ["account_id","season_id","mode","rounds_played","wins","top10s","win_rate",
      "top10_rate","kills","kd_ratio","headshot_kills","headshot_rate",
      "avg_damage","longest_kill","time_survived_sec","assists","damage_dealt",
      "dbnos","revives","team_kills","losses","last_refreshed"]),
    ("settings", ["key","value","updated_at"]),
    ("pubg_achievements_seen",
     ["achievement_id","match_id","label","icon","played_at","detected_at",
      "displayed_at","is_rare"]),
    ("telemetry_events",
     ["match_id","event_type","timestamp_ms","actor_account","target_account",
      "actor_x","actor_y","actor_z","actor_health",
      "victim_x","victim_y","weapon","distance","damage","payload_json"]),
]

STEAM_PER_TENANT_TABLES = [
    ("steam_achievements_seen",
     ["steam_id","app_id","achievement_api_name","unlocked_at","display_name",
      "description","icon_url","displayed_at"]),
    ("steam_app_progress", ["steam_id","app_id","unlocked_count","last_checked"]),
    ("steam_owned_games",
     ["steam_id","app_id","name","img_icon_url","img_logo_url",
      "playtime_forever_min","playtime_2weeks_min","last_played_at",
      "steam_last_played","last_synced"]),
]

STEAM_GLOBAL_TABLES = [
    ("steam_app_schema",
     ["app_id","game_name","achievement_count","schema_json","global_pct_json",
      "global_pct_cached_at","cached_at"]),
    ("steam_app_schema_lang", ["app_id","lang","schema_json","cached_at"]),
    ("steam_app_details",
     ["app_id","header_image","short_description","is_coop","is_multiplayer",
      "category_ids","genre_names","cached_at"]),
]


def _copy(sqlite_conn, pg_conn, table, cols, tenant_id):
    """Copy rows from sqlite into postgres. If tenant_id is not None, prepend it."""
    sq_rows = sqlite_conn.execute(
        f"SELECT {','.join(cols)} FROM {table}"
    ).fetchall()
    if not sq_rows:
        print(f"  {table}: 0 Rows")
        return 0
    if tenant_id is None:
        pg_cols = cols
        values_tpl = "(" + ",".join(["%s"] * len(cols)) + ")"
        rows = [tuple(r) for r in sq_rows]
    else:
        pg_cols = ["tenant_id"] + cols
        values_tpl = "(" + ",".join(["%s"] * (len(cols) + 1)) + ")"
        rows = [(tenant_id, *tuple(r)) for r in sq_rows]
    with pg_conn.cursor() as cur:
        from psycopg2.extras import execute_values
        execute_values(
            cur,
            f"INSERT INTO {table} ({','.join(pg_cols)}) VALUES %s "
            f"ON CONFLICT DO NOTHING",
            rows,
            template=values_tpl,
        )
    pg_conn.commit()
    print(f"  {table}: {len(rows)} Rows")
    return len(rows)


def migrate_pubg(sqlite_path: str, pg_conn, tenant_id: int) -> None:
    sq = sqlite3.connect(sqlite_path)
    sq.row_factory = sqlite3.Row
    print(f"PUBG-Migration aus {sqlite_path} → tenant_id={tenant_id}")
    for table, cols in PUBG_TABLES:
        try:
            _copy(sq, pg_conn, table, cols, tenant_id)
        except sqlite3.OperationalError as e:
            print(f"  {table}: SKIP ({e})")
    sq.close()


def migrate_steam(sqlite_path: str, pg_conn, tenant_id: int) -> None:
    sq = sqlite3.connect(sqlite_path)
    sq.row_factory = sqlite3.Row
    print(f"Steam-Migration aus {sqlite_path} → tenant_id={tenant_id}")
    for table, cols in STEAM_PER_TENANT_TABLES:
        try:
            _copy(sq, pg_conn, table, cols, tenant_id)
        except sqlite3.OperationalError as e:
            print(f"  {table}: SKIP ({e})")
    for table, cols in STEAM_GLOBAL_TABLES:
        try:
            _copy(sq, pg_conn, table, cols, None)
        except sqlite3.OperationalError as e:
            print(f"  {table}: SKIP ({e})")
    sq.close()


def migrate_pois(json_path: str, pg_conn) -> None:
    if not os.path.exists(json_path):
        print(f"POI-JSON nicht gefunden: {json_path}")
        return
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Erwartetes Format: {<map_name>: [{name,x,y,radius_m?,tags?,notes?}, ...]}
    rows = []
    for map_name, pois in data.items():
        for poi in pois:
            rows.append((
                map_name, poi["name"], poi["x"], poi["y"],
                poi.get("radius_m"), poi.get("tags") or [], poi.get("notes"),
            ))
    if not rows:
        print("Keine POIs gefunden.")
        return
    with pg_conn.cursor() as cur:
        from psycopg2.extras import execute_values
        execute_values(
            cur,
            "INSERT INTO pois (map_name,name,poi_x,poi_y,radius_m,tags,notes) "
            "VALUES %s ON CONFLICT DO NOTHING",
            rows,
        )
    pg_conn.commit()
    print(f"POIs: {len(rows)} Rows")


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["pubg", "steam", "pois", "all"])
    p.add_argument("--tenant-id", type=int, default=1)
    p.add_argument("--db", help="Pfad zur SQLite-DB (Default: data/<domain>-history.db)")
    p.add_argument("--json", help="POI-JSON (Default: data/pubg-pois.json)")
    args = p.parse_args(argv)

    pg = core_db.connect()
    try:
        if args.cmd in ("pubg", "all"):
            path = args.db or "data/pubg-history.db"
            migrate_pubg(path, pg, args.tenant_id)
        if args.cmd in ("steam", "all"):
            path = args.db or "data/steam-history.db"
            migrate_steam(path, pg, args.tenant_id)
        if args.cmd in ("pois", "all"):
            path = args.json or "data/pubg-pois.json"
            migrate_pois(path, pg)
    finally:
        pg.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
