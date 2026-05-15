#!/usr/bin/env python3
"""Standalone PUBG-Fetch-Job fuer PostgreSQL.

Laeuft als Cronjob (alle 6h) oder manuell. Holt neue Matches +
Telemetrie von der PUBG-API und schreibt sie in die PostgreSQL-DB.

Nutzung:
    python -m pubg.fetch_job                     # einmaliger Lauf
    python -m pubg.fetch_job --init-schema       # Schema anlegen + Lauf
    python -m pubg.fetch_job --init-schema-only  # nur Schema anlegen

Konfiguration (aus .secrets oder Env-Vars):
    PUBG API Key    oder  PUBG_API_KEY
    PUBG PG DSN     oder  PUBG_PG_DSN
    Spieler aus config/pubg.json

GitHub Actions Beispiel (.github/workflows/fetch.yml):
    on:
      schedule:
        - cron: '0 */6 * * *'
    jobs:
      fetch:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - run: pip install psycopg2-binary
          - run: python -m pubg.fetch_job
        env:
          PUBG_API_KEY: ${{ secrets.PUBG_API_KEY }}
          PUBG_PG_DSN:  ${{ secrets.PUBG_PG_DSN }}
"""

import os, sys, time, datetime, argparse, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _log(msg: str) -> None:
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def _load_api_key() -> str:
    # 1. Umgebungsvariable
    key = os.environ.get("PUBG_API_KEY", "").strip()
    if key:
        return key
    # 2. .secrets
    secrets = os.path.join(ROOT, ".secrets")
    if os.path.exists(secrets):
        from pubg.config import load_api_key
        k = load_api_key(secrets)
        if k:
            return k
    raise RuntimeError("Kein PUBG-API-Key gefunden (env PUBG_API_KEY oder .secrets)")


def _load_dsn() -> str:
    dsn = os.environ.get("PUBG_PG_DSN", "").strip()
    if dsn:
        return dsn
    secrets = os.path.join(ROOT, ".secrets")
    from pubg.db_pg import load_dsn
    d = load_dsn(secrets)
    if d:
        return d
    raise RuntimeError(
        "Kein PostgreSQL-DSN gefunden.\n"
        "Trag in .secrets ein:\n  PUBG PG DSN: postgresql://user:pass@host/db\n"
        "oder setze Umgebungsvariable PUBG_PG_DSN."
    )


def ingest_match(conn, client, my_account_id: str, match_id: str) -> bool:
    """Holt einen Match von der API, speichert in PG. Returns True wenn neu."""
    from pubg.db_pg import (upsert_player, upsert_match, upsert_participant,
                             upsert_team_mapping, CURRENT_MATCH_SCHEMA)
    try:
        m = client.get_match(match_id)
    except Exception as e:
        _log(f"  WARN get_match({match_id[:16]}): {e}")
        return False

    attrs = m["data"]["attributes"]
    included = m.get("included", [])

    # Match upserten
    is_new = upsert_match(
        conn,
        match_id=match_id,
        map_name=attrs.get("mapName", ""),
        game_mode=attrs.get("gameMode", ""),
        duration_secs=attrs.get("duration"),
        played_at=attrs.get("createdAt", ""),
        telemetry_url=next(
            (a["attributes"]["URL"] for a in included
             if a.get("type") == "asset"), None),
        is_ranked="ranked" in attrs.get("gameMode", "").lower(),
    )

    # Participants + Team-Mapping
    parts_by_id = {p["id"]: p["attributes"]["stats"]
                   for p in included if p.get("type") == "participant"}
    for roster_ref in m["data"]["relationships"]["rosters"]["data"]:
        roster = next((x for x in included if x["id"] == roster_ref["id"]), None)
        if not roster:
            continue
        team_id = roster["attributes"].get("stats", {}).get("teamId",
                  roster["attributes"].get("rank", 0))
        for pp in roster["relationships"]["participants"]["data"]:
            s = parts_by_id.get(pp["id"])
            if not s:
                continue
            acc = s["playerId"]
            upsert_player(conn, acc, s.get("name", acc[:16]), "steam")
            upsert_participant(conn, match_id, acc, {
                "name":             s.get("name", ""),
                "team_id":          team_id,
                "place":            s.get("winPlace"),
                "kills":            s.get("kills"),
                "headshot_kills":   s.get("headshotKills"),
                "assists":          s.get("assists"),
                "dbnos":            s.get("DBNOs"),
                "revives":          s.get("revives"),
                "damage_dealt":     s.get("damageDealt"),
                "longest_kill":     s.get("longestKill"),
                "time_survived":    int(s.get("timeSurvived", 0)),
                "walk_distance":    s.get("walkDistance"),
                "ride_distance":    s.get("rideDistance"),
                "swim_distance":    s.get("swimDistance"),
                "weapons_acquired": s.get("weaponsAcquired"),
                "heals":            s.get("heals"),
                "boosts":           s.get("boosts"),
                "team_kills":       s.get("teamKills"),
            })
            upsert_team_mapping(conn, match_id, [{
                "account_id":    acc,
                "team_id":       team_id,
                "kills":         s.get("kills"),
                "place":         s.get("winPlace"),
                "time_survived": int(s.get("timeSurvived", 0)),
            }])
    conn.commit()
    return is_new


def fetch_telemetry(conn, client, my_account_id: str, match_id: str,
                    tel_url: str) -> bool:
    """Holt Telemetrie, filtert Squad-Events, speichert in PG."""
    from pubg.telemetry import filter_squad_events
    from pubg.db_pg import (insert_telemetry_events, mark_telemetry_fetched,
                             mark_telemetry_schema, CURRENT_TELEMETRY_SCHEMA)
    import psycopg2, urllib.error

    # Squad-Members fuer diesen Match
    with conn.cursor() as cur:
        cur.execute("""
            SELECT account_id FROM participants
            WHERE match_id=%s AND team_id=(
                SELECT team_id FROM participants
                WHERE match_id=%s AND account_id=%s LIMIT 1)
        """, (match_id, match_id, my_account_id))
        squad = {r["account_id"] for r in cur.fetchall()}
    squad.add(my_account_id)

    try:
        raw = client.get_telemetry(tel_url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            mark_telemetry_fetched(conn, match_id)
            mark_telemetry_schema(conn, match_id, CURRENT_TELEMETRY_SCHEMA)
            _log(f"  telemetry 404 abandoned: {match_id[:16]}")
        else:
            mark_telemetry_fetched(conn, match_id)
        return False
    except Exception as e:
        mark_telemetry_fetched(conn, match_id)
        _log(f"  telemetry error {match_id[:16]}: {e}")
        return False

    # Alte Events loeschen (bei Re-Fetch)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM telemetry_events WHERE match_id=%s", (match_id,))
    conn.commit()

    events = list(filter_squad_events(raw, squad))
    insert_telemetry_events(conn, match_id, events)
    mark_telemetry_fetched(conn, match_id)
    mark_telemetry_schema(conn, match_id, CURRENT_TELEMETRY_SCHEMA)
    conn.commit()
    return True


def run(conn, client, player_name: str, my_account_id: str) -> dict:
    """Haupt-Fetch-Loop: neue Matches + Telemetrie."""
    from pubg.db_pg import get_matches_needing_telemetry

    _log(f"Fetch-Job gestartet fuer {player_name} ({my_account_id[:16]}...)")

    # 1) Neue Match-IDs von PUBG-API
    resp = client.get_player(player_name)
    all_ids = client.extract_match_ids(resp)
    _log(f"  PUBG-API: {len(all_ids)} Match-IDs verfuegbar")

    # Bereits in DB vorhandene Match-IDs
    with conn.cursor() as cur:
        cur.execute("SELECT match_id FROM matches")
        existing = {r["match_id"] for r in cur.fetchall()}

    new_ids = [mid for mid in all_ids if mid not in existing]
    _log(f"  Neu: {len(new_ids)} Matches")

    new_count = 0
    for i, mid in enumerate(new_ids, 1):
        if ingest_match(conn, client, my_account_id, mid):
            new_count += 1
            _log(f"  [{i}/{len(new_ids)}] ingested {mid[:16]}")
        time.sleep(0.12)

    # 2) Telemetrie fuer Matches die sie noch brauchen
    pending = get_matches_needing_telemetry(conn, limit=50)
    _log(f"  Telemetrie pending: {len(pending)}")
    tel_count = 0
    for row in pending:
        if fetch_telemetry(conn, client, my_account_id,
                           row["match_id"], row["telemetry_url"]):
            tel_count += 1
            _log(f"  telemetry ok: {row['match_id'][:16]}")
        time.sleep(0.15)

    _log(f"Fetch-Job fertig: {new_count} neue Matches, {tel_count} Telemetrien")
    return {"new_matches": new_count, "telemetry": tel_count}


def main():
    parser = argparse.ArgumentParser(description="PUBG PostgreSQL Fetch-Job")
    parser.add_argument("--init-schema", action="store_true",
                        help="Schema anlegen falls nicht vorhanden")
    parser.add_argument("--init-schema-only", action="store_true",
                        help="Nur Schema anlegen, kein Fetch")
    args = parser.parse_args()

    # Imports
    sys.path.insert(0, ROOT)
    from pubg.config import load_config
    from pubg.api_client import PubgClient
    from pubg.db_pg import connect, init_schema, get_player_by_name, upsert_player

    cfg = load_config(os.path.join(ROOT, "config", "pubg.json"))
    api_key = _load_api_key()
    dsn = _load_dsn()

    conn = connect(dsn)
    _log(f"PostgreSQL verbunden")

    if args.init_schema or args.init_schema_only:
        init_schema(conn)
        _log("Schema initialisiert")
        if args.init_schema_only:
            conn.close()
            return

    client = PubgClient(api_key=api_key, platform=cfg["platform"])

    # Self-Account sicherstellen
    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        _log(f"Resolving account-id fuer {cfg['playerName']}...")
        resp = client.get_player(cfg["playerName"])
        acc_id = resp["data"][0]["id"]
        upsert_player(conn, acc_id, cfg["playerName"], cfg["platform"], is_self=True)
        conn.commit()
        my_account_id = acc_id
    else:
        my_account_id = self_p["account_id"]

    run(conn, client, cfg["playerName"], my_account_id)
    conn.close()


if __name__ == "__main__":
    main()
