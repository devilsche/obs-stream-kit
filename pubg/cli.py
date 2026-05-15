import datetime
import os
import shutil
import sys
import time
from pubg.config import load_config, load_api_key
from pubg.db import (connect, init_schema, upsert_player, get_player_by_name,
                      integrity_check)
from pubg.api_client import PubgClient, RateLimitError
from pubg.poller import (run_bulk_catchup, run_bulk_telemetry_catchup,
                          run_bulk_match_schema_upgrade,
                          get_current_season_id)
from pubg.db import upsert_season, set_setting
from pubg.match_parser import parse_season_response, aggregate_season_modes
from pubg.backup import (load_ftp_config, list_remote_backups,
                          download_from_ftp)


def init_db(root: str) -> str:
    os.makedirs(os.path.join(root, "data"), exist_ok=True)
    db_path = os.path.join(root, "data", "pubg-history.db")
    conn = connect(db_path)
    init_schema(conn)
    conn.close()
    print(f"Schema initialized: {db_path}")
    return db_path


def cold_start(root: str, max_matches: int | None = None):
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    api_key = load_api_key(os.path.join(root, ".secrets"))
    if not api_key:
        print("No PUBG-API-Key in .secrets!")
        return 1
    db_path = init_db(root)
    client = PubgClient(api_key=api_key, platform=cfg["platform"])
    conn = connect(db_path)

    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print(f"Resolving account-id for {cfg['playerName']}…")
        try:
            resp = client.get_player(cfg["playerName"])
        except Exception as e:
            print(f"API error: {e}")
            return 1
        if not resp.get("data"):
            print("Player not found!")
            return 1
        my_acc_id = resp["data"][0]["id"]
        upsert_player(conn, my_acc_id, cfg["playerName"],
                      cfg["platform"], is_self=True)
    else:
        my_acc_id = self_p["account_id"]
        print(f"Player already in DB: {my_acc_id}")

    # Single get_player() call (rate-limited) returns all available
    # match-IDs. Then sequential ingest_match() for each new ID — no
    # cap; /matches/{id} is NOT rate-limited per PUBG docs. 100ms
    # politeness-pace between calls.
    cap_msg = "no cap" if max_matches is None else f"max {max_matches}"
    print(f"Cold-Start: fetching match list + ingesting all new matches "
          f"({cap_msg})…")

    def _progress(i, total, imported):
        if i % 10 == 0 or i == total:
            print(f"  ...{i}/{total} matches processed "
                  f"(new in DB: {imported})")

    stats = run_bulk_catchup(conn, client, cfg["playerName"], my_acc_id,
                              max_matches=max_matches, pacing_ms=100,
                              progress_cb=_progress)
    if stats["errors"]:
        print(f"  Errors: {stats['errors'][:5]}"
              f"{'...' if len(stats['errors']) > 5 else ''} "
              f"({len(stats['errors'])} total)")

    total_matches_in_db = conn.execute(
        "SELECT COUNT(*) FROM matches").fetchone()[0]
    print(f"Cold-Start (matches): fetched {stats['new_matches']} new "
          f"→ {total_matches_in_db} matches total in DB.")

    # Phase 1b: Schema-Upgrade für alte Matches (z.B. team_mapping
    # nachträglich ziehen). /matches/{id} ist nicht rate-limited, also
    # einfach durchgehen. Idempotent.
    print("Cold-Start (schema): re-ingesting matches that need schema "
          "upgrade (e.g. for new lobby team mapping)…")

    def _s_progress(i, total, done):
        if i % 10 == 0 or i == total:
            print(f"  ...{i}/{total} matches upgraded (ok: {done})")

    s_stats = run_bulk_match_schema_upgrade(conn, client, my_acc_id,
                                              pacing_ms=100,
                                              progress_cb=_s_progress)
    if s_stats["errors"]:
        print(f"  Schema-upgrade errors: {s_stats['errors'][:3]}"
              f"{'...' if len(s_stats['errors']) > 3 else ''} "
              f"({len(s_stats['errors'])} total)")
    print(f"Cold-Start (schema): upgraded {s_stats['upgraded']} matches.")

    # Phase 2: Telemetry bulk-catchup. /telemetry-cdn is not rate-
    # limited, so process all pending in a row. Telemetry files are
    # large (5-50MB), realistic ~1-3s per match plus parsing.
    print("Cold-Start (telemetry): fetching telemetry events for all "
          "matches that don't have them yet…")

    def _t_progress(i, total, done):
        if i % 5 == 0 or i == total:
            print(f"  ...{i}/{total} telemetries processed (ok: {done})")

    t_stats = run_bulk_telemetry_catchup(conn, client, my_acc_id,
                                          pacing_ms=100,
                                          progress_cb=_t_progress)
    if t_stats["errors"]:
        print(f"  Telemetry errors: {t_stats['errors'][:3]}"
              f"{'...' if len(t_stats['errors']) > 3 else ''} "
              f"({len(t_stats['errors'])} total — typically >14d matches)")
    total_telemetry_events = conn.execute(
        "SELECT COUNT(DISTINCT match_id) FROM telemetry_events").fetchone()[0]
    print(f"Cold-Start (telemetry): fetched {t_stats['processed']} new "
          f"→ {total_telemetry_events} matches with telemetry total in DB.")

    conn.close()
    print("Cold-Start done.")
    return 0


def pull_from_ftp(root: str) -> int:
    """Holt das aktuellste DB-Backup vom FTP und ersetzt die lokale DB.
    Vorher wird die lokale DB als pubg-history.db.before-pull-YYYYMMDD-HHMMSS
    weggesichert. Auf Laptop nutzbar wenn der PC die DB schreibt."""
    cfg = load_ftp_config(os.path.join(root, ".secrets"))
    if not cfg:
        print("Keine FTP-Config in .secrets gefunden.")
        return 1

    db_path = os.path.join(root, "data", "pubg-history.db")
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    print(f"Listing FTP backups at {cfg['host']}{cfg['path'] or '/'} …")
    try:
        remote = list_remote_backups(cfg)
    except Exception as e:
        print(f"FTP listing failed: {e}")
        return 1
    if not remote:
        print("No backups found.")
        return 1

    latest = remote[-1]
    print(f"Latest backup: {latest}")
    print(f"Available total: {len(remote)} ({remote[0]} → {remote[-1]})")

    # Move local DB out of the way as safety copy
    if os.path.exists(db_path):
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        safety = f"{db_path}.before-pull-{ts}"
        shutil.copy2(db_path, safety)
        print(f"Local DB backed up to: {safety}")
        # Drop WAL/SHM files (if any) — they wouldn't match the new DB
        for ext in ("-wal", "-shm"):
            p = db_path + ext
            if os.path.exists(p):
                os.remove(p)

    print(f"Downloading {latest} → {db_path}")
    ok, msg = download_from_ftp(latest, db_path, cfg)
    print(msg)
    if not ok:
        return 1

    # Integrity check
    conn = connect(db_path)
    try:
        ic = integrity_check(conn)
        print(f"Integrity: {ic}")
        if ic != "ok":
            print("WARNING: DB integrity not ok. Restore the local safety copy?")
            return 1
        cnt = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        print(f"Matches in DB: {cnt}")
    finally:
        conn.close()
    return 0


def seasons_backfill(root: str, only_self: bool = True) -> int:
    """Iteriert ALLE PUBG-Seasons (~99 historisch + aktuelle) und holt
    die non-ranked Aggregate für self (oder alle DB-Spieler). Rate-limited
    via /seasons-Endpoint (10 RPM), pacing automatisch durch RateLimiter.
    Idempotent — schon gespeicherte Seasons werden upsertet."""
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    api_key = load_api_key(os.path.join(root, ".secrets"))
    if not api_key:
        print("No PUBG-API-Key in .secrets!")
        return 1
    db_path = os.path.join(root, "data", "pubg-history.db")
    conn = connect(db_path)
    init_schema(conn)

    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print(f"Player {cfg['playerName']} nicht in DB — erst cold-start laufen lassen.")
        return 1

    client = PubgClient(api_key=api_key, platform=cfg["platform"])

    print("Lade Season-Liste …")
    try:
        seasons_payload = client.get_seasons()
    except Exception as e:
        print(f"API-Fehler: {e}")
        return 1
    seasons = seasons_payload.get("data", [])
    current_id = client.extract_current_season_id(seasons_payload)
    if current_id:
        set_setting(conn, "pubg.current_season_id", current_id)
        set_setting(conn, "pubg.current_season_id_fetched_at", _iso())
    print(f"  {len(seasons)} Seasons gefunden, aktuelle: {current_id}")

    accounts = [(self_p["account_id"], self_p["name"])]
    if not only_self:
        rows = conn.execute(
            "SELECT account_id, name FROM players").fetchall()
        accounts = [(r["account_id"], r["name"]) for r in rows]

    refreshed = 0
    skipped = 0
    errors = []
    for acc_id, name in accounts:
        print(f"\n→ {name} ({acc_id})")
        for i, s in enumerate(seasons, 1):
            sid = s.get("id")
            if not sid:
                continue
            # Skip wenn schon vorhanden + nicht stale.
            existing = conn.execute(
                "SELECT 1 FROM player_season "
                "WHERE account_id=? AND season_id=? AND mode='all'",
                (acc_id, sid)).fetchone()
            if existing:
                skipped += 1
                continue
            # Bei Rate-Limit: warten bis Slot frei ist (max 70s, eine
            # Window-Periode + Buffer), dann nochmal versuchen.
            payload = None
            for attempt in range(2):
                try:
                    payload = client.get_season(acc_id, sid)
                    break
                except RateLimitError:
                    print(f"  [{i}/{len(seasons)}] {sid} → rate-limited, "
                          f"warte 7s …")
                    time.sleep(7)
                except Exception as e:
                    errors.append(f"{name}/{sid}: {e}")
                    print(f"  [{i}/{len(seasons)}] {sid} → ERROR: {e}")
                    payload = None
                    break
            if payload is None:
                continue
            try:
                modes = parse_season_response(payload)
                for mode, stats in modes.items():
                    upsert_season(conn, acc_id, sid, mode, stats)
                agg = aggregate_season_modes(modes)
                upsert_season(conn, acc_id, sid, "all", agg)
                refreshed += 1
                played = agg["rounds_played"]
                marker = f"  [{i}/{len(seasons)}] {sid} → {played} matches"
                if played > 0:
                    marker += (f" / K {agg['kills']} / "
                               f"K/D {agg['kd_ratio']:.2f}")
                print(marker)
            except Exception as e:
                errors.append(f"{name}/{sid}: parse/persist: {e}")
                print(f"  [{i}/{len(seasons)}] {sid} → PARSE ERROR: {e}")
            # Höflichkeits-Pacing zwischen Calls. Rate-Limit ist 10 RPM
            # → 6s zwischen Calls reicht, mit 200ms Buffer für Bursts.
            time.sleep(0.2)

    print(f"\nDone: {refreshed} neu gespeichert, {skipped} schon vorhanden, "
          f"{len(errors)} Fehler.")
    if errors:
        print("Erste Fehler:", errors[:3])
    conn.close()
    return 0


def _iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")


def wipe_day(root: str, date_str: str = None,
             suppress_popups: bool = True) -> int:
    """Wipe milestones + telemetry fuer einen Tag und stosse Refetch an.
    Default-Tag = heute (lokal). suppress_popups markiert NEUE Milestones
    die nach Re-Detection auftauchen sofort als 'displayed', damit kein
    Popup-Replay feuert.

    Nutzung:
        python -m pubg.cli wipe-day                # heute
        python -m pubg.cli wipe-day 2026-05-13     # spezifischer Tag
        python -m pubg.cli wipe-day --keep-popups  # ohne Popup-Suppression
    """
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}")
        return 1
    if not date_str:
        date_str = datetime.date.today().isoformat()

    conn = connect(db_path)
    print(f"\n=== wipe-day {date_str} ===")

    # 1) Was hat der Tag drin?
    matches = conn.execute(
        "SELECT match_id, played_at, map_name, game_mode "
        "FROM matches WHERE played_at LIKE ? ORDER BY played_at",
        (f"{date_str}%",)).fetchall()
    if not matches:
        print(f"Keine Matches fuer {date_str} in DB.")
        conn.close()
        return 0
    print(f"\n{len(matches)} Match(es) am {date_str}:")
    for m in matches:
        print(f"  - {m['played_at']} · {m['map_name']:<14} · "
              f"{m['game_mode']:<20} · {m['match_id']}")
    achs = conn.execute(
        "SELECT achievement_id, match_id, label, played_at "
        "FROM pubg_achievements_seen WHERE played_at LIKE ? "
        "ORDER BY played_at",
        (f"{date_str}%",)).fetchall()
    print(f"\n{len(achs)} Milestone(s) am {date_str}:")
    for a in achs:
        print(f"  - {a['played_at']} · {a['achievement_id']:<24} · "
              f"{a['label'] or '-'}")

    ans = input(f"\nWeiter? Loescht alle Milestones + Telemetry fuer "
                f"{date_str} und triggert Refetch [y/N] ").strip().lower()
    if ans != "y":
        print("Abgebrochen.")
        conn.close()
        return 0

    # 2) Milestones weg
    cur = conn.execute(
        "DELETE FROM pubg_achievements_seen WHERE played_at LIKE ?",
        (f"{date_str}%",))
    print(f"  -> {cur.rowcount} Milestones geloescht")

    # 3) Telemetry-Events der heutigen Matches weg
    match_ids = [m["match_id"] for m in matches]
    ph = ",".join("?" * len(match_ids))
    cur = conn.execute(
        f"DELETE FROM telemetry_events WHERE match_id IN ({ph})",
        match_ids)
    print(f"  -> {cur.rowcount} Telemetry-Events geloescht")

    # 4) Schema-Marker auf 0 -> Poller picks them up
    cur = conn.execute(
        f"UPDATE matches SET telemetry_schema=0, telemetry_fetched=NULL "
        f"WHERE match_id IN ({ph})", match_ids)
    print(f"  -> {cur.rowcount} Matches als 'needs refetch' markiert")
    conn.commit()

    # 5) Refetch synchron im Foreground anstossen.
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    api_key = load_api_key(os.path.join(root, ".secrets"))
    if not api_key:
        print("\nKein API-Key in .secrets — Refetch uebersprungen.\n"
              "Nach Server-Restart wird der Poller die Matches automatisch "
              "neu holen.")
        conn.close()
        return 0
    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print("Self-Player nicht in DB — Refetch uebersprungen.")
        conn.close()
        return 0
    print("\nRefetch Telemetry...")
    client = PubgClient(api_key=api_key, platform=cfg["platform"])

    def _tp(i, total, done):
        print(f"  ...{i}/{total} ({done} fetched)")

    stats = run_bulk_telemetry_catchup(
        conn, client, self_p["account_id"],
        max_matches=len(match_ids), pacing_ms=150,
        progress_cb=_tp)
    print(f"  -> {stats.get('fetched', 0)} Match(es) neu geholt, "
          f"{len(stats.get('errors', []))} Fehler")

    # 6) Optional: Popups suppressen indem wir alle NEU detectierten
    #    Milestones direkt als displayed markieren. Das passiert
    #    aber erst auf dem naechsten Poll-Tick im Server — wir koennen
    #    das hier nicht praeemptiv tun ohne die Detection aufzurufen.
    #    Workaround: nach einer Wartezeit markieren wir alle aktuell
    #    undisplayed-Milestones fuer den Tag als gesehen.
    if suppress_popups:
        print("\nPopup-Suppression: warte 8s bis der Server-Poller "
              "die neu detectierten Milestones eingetragen hat...")
        time.sleep(8)
        ts_now = int(time.time() * 1000)
        cur = conn.execute(
            "UPDATE pubg_achievements_seen "
            "SET displayed_at = ? "
            "WHERE displayed_at IS NULL AND played_at LIKE ?",
            (ts_now, f"{date_str}%"))
        conn.commit()
        print(f"  -> {cur.rowcount} re-detected Milestones als "
              f"'displayed' markiert (kein Popup-Replay)")

    conn.close()
    print(f"\n=== wipe-day {date_str} fertig ===")
    return 0


def hidrive_backfill(root: str) -> int:
    """Uploadet alle Altmatches aus der lokalen SQLite-DB als rekonstruierte
    Telemetrie-Blobs auf HiDrive. Matches die schon archiviert sind werden
    uebersprungen (idempotent).

    Nutzung:
        python -m pubg.cli hidrive-backfill
    """
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}")
        return 1
    from pubg.hidrive_telemetry import backfill_from_db, list_archived
    conn = connect(db_path)
    secrets = os.path.join(root, ".secrets")
    print("Prüfe bereits archivierte Matches auf HiDrive...")
    already = list_archived(secrets)
    print(f"  {len(already)} bereits auf HiDrive")
    print("\nStarte Backfill (Altmatches aus SQLite payload_json → HiDrive)...")
    stats = backfill_from_db(conn, secrets_path=secrets, pacing_s=0.3)
    print(f"\nFertig: {stats['uploaded']} hochgeladen, "
          f"{stats['skipped']} schon da, {stats['errors']} Fehler")
    conn.close()
    return 0


def purge_before(root: str, date_str: str) -> int:
    """Loescht alle Milestones (pubg_achievements_seen) deren played_at
    < date_str ist. Ohne Refetch, ohne Backfill — die historischen
    Milestones sind einfach weg.

    Nutzung:
        python -m pubg.cli purge-before 2026-05-01
    """
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}")
        return 1
    if not date_str:
        print("Fehlende Datums-Angabe. Beispiel: "
              "python -m pubg.cli purge-before 2026-05-01")
        return 1
    # Akzeptiert YYYY-MM-DD oder YYYY-MM-DDT...
    try:
        datetime.date.fromisoformat(date_str[:10])
    except ValueError:
        print(f"Ungueltiges Datum: {date_str} (erwarte YYYY-MM-DD)")
        return 1

    conn = connect(db_path)
    cnt = conn.execute(
        "SELECT COUNT(*) FROM pubg_achievements_seen WHERE played_at < ?",
        (date_str,)).fetchone()[0]
    print(f"\n{cnt} Milestones aelter als {date_str} in DB.")
    if cnt == 0:
        conn.close()
        return 0
    # Stichprobe
    sample = conn.execute(
        "SELECT achievement_id, played_at FROM pubg_achievements_seen "
        "WHERE played_at < ? ORDER BY played_at DESC LIMIT 5",
        (date_str,)).fetchall()
    print("Stichprobe der juengsten zu loeschenden:")
    for r in sample:
        print(f"  {r['played_at']}  {r['achievement_id']}")
    ans = input(f"\nWirklich alle {cnt} Eintraege < {date_str} loeschen? "
                f"[y/N] ").strip().lower()
    if ans != "y":
        print("Abgebrochen.")
        conn.close()
        return 0
    cur = conn.execute(
        "DELETE FROM pubg_achievements_seen WHERE played_at < ?",
        (date_str,))
    conn.commit()
    print(f"  -> {cur.rowcount} Eintraege geloescht")
    conn.close()
    return 0


def list_milestones(root: str, pattern: str = None) -> int:
    """Listet Milestones in der DB, gruppiert nach achievement_id mit
    Count + letztem played_at. Mit pattern: LIKE-Filter auf
    achievement_id (z.B. 'heist%' fuer alle Heist-Milestones).
    """
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}")
        return 1
    conn = connect(db_path)
    if pattern:
        rows = conn.execute(
            "SELECT achievement_id, COUNT(*) AS n, MAX(played_at) AS last "
            "FROM pubg_achievements_seen "
            "WHERE achievement_id LIKE ? "
            "GROUP BY achievement_id ORDER BY achievement_id",
            (pattern,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT achievement_id, COUNT(*) AS n, MAX(played_at) AS last "
            "FROM pubg_achievements_seen "
            "GROUP BY achievement_id ORDER BY achievement_id"
        ).fetchall()
    if not rows:
        print(f"Keine Milestones {'mit Pattern ' + pattern if pattern else ''}.")
        conn.close()
        return 0
    print(f"\n{'achievement_id':<30}  {'count':>5}  last_played")
    print("-" * 70)
    for r in rows:
        print(f"{r['achievement_id']:<30}  {r['n']:>5}  {r['last']}")
    print(f"\n{len(rows)} distinct IDs.")
    conn.close()
    return 0


def reset_milestones(root: str, ids: list) -> int:
    """Wipe spezifische Milestone-IDs aus pubg_achievements_seen
    und re-evaluiere ueber ALLE Sessions (backfill_session_achievements).
    Sinnvoll wenn die Detection-Logik fuer eine ID geaendert wurde
    (z.B. hot_drop_match von Counter -> Streak).

    suppress_popup=True bei Re-Insert -> kein Popup-Replay."""
    from pubg.aggregations import backfill_session_achievements
    from pubg.config import load_config
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}")
        return 1
    if not ids:
        print("Fehlende Milestone-IDs. Beispiel:")
        print("  python -m pubg.cli reset-milestones "
              "hot_drop_match hot_drop_match_survived")
        return 1
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    conn = connect(db_path)
    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print("Self-Player nicht in DB.")
        conn.close()
        return 1

    print(f"\n=== reset-milestones {ids} ===")
    ph = ",".join("?" * len(ids))
    cnt = conn.execute(
        f"SELECT COUNT(*) FROM pubg_achievements_seen "
        f"WHERE achievement_id IN ({ph})", ids).fetchone()[0]
    print(f"  {cnt} bestehende Eintraege mit diesen IDs.")
    if cnt == 0:
        print("  Nichts zu loeschen — Backfill laeuft trotzdem fuer "
              "evtl. nie-detectierte Eintraege.")

    ans = input(f"\nLoeschen + ueber alle Sessions neu detecten? "
                f"[y/N] ").strip().lower()
    if ans != "y":
        print("Abgebrochen.")
        conn.close()
        return 0

    cur = conn.execute(
        f"DELETE FROM pubg_achievements_seen WHERE achievement_id IN ({ph})",
        ids)
    conn.commit()
    print(f"  -> {cur.rowcount} Eintraege geloescht")

    print("\nRe-Detection ueber alle historischen Sessions "
          "(suppress_popup=True)...")
    stats = backfill_session_achievements(
        conn, self_p["account_id"], gap_hours=6, suppress_popup=True)
    print(f"  -> {stats.get('sessions', 0)} Sessions verarbeitet, "
          f"{stats.get('inserted', 0)} Milestones (neu) eingetragen.")
    if stats.get("errors"):
        print(f"  Fehler: {stats['errors'][:3]}")
    conn.close()
    print("=== reset-milestones fertig ===")
    return 0


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) > 1 and sys.argv[1] == "init":
        init_db(root)
    elif len(sys.argv) > 1 and sys.argv[1] == "cold-start":
        sys.exit(cold_start(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "pull-ftp":
        sys.exit(pull_from_ftp(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "seasons-backfill":
        sys.exit(seasons_backfill(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "wipe-day":
        args = sys.argv[2:]
        keep_popups = "--keep-popups" in args
        date_arg = next((a for a in args if not a.startswith("--")), None)
        sys.exit(wipe_day(root, date_arg, suppress_popups=not keep_popups))
    elif len(sys.argv) > 1 and sys.argv[1] == "reset-milestones":
        sys.exit(reset_milestones(root, sys.argv[2:]))
    elif len(sys.argv) > 1 and sys.argv[1] == "list-milestones":
        pat = sys.argv[2] if len(sys.argv) > 2 else None
        sys.exit(list_milestones(root, pat))
    elif len(sys.argv) > 1 and sys.argv[1] == "purge-before":
        date_arg = sys.argv[2] if len(sys.argv) > 2 else None
        sys.exit(purge_before(root, date_arg))
    elif len(sys.argv) > 1 and sys.argv[1] == "hidrive-backfill":
        sys.exit(hidrive_backfill(root))
    else:
        print("Usage: python -m pubg.cli init | cold-start | pull-ftp | "
              "seasons-backfill | wipe-day [YYYY-MM-DD] [--keep-popups] | "
              "reset-milestones <id1> [<id2> ...] | "
              "list-milestones [pattern] | "
              "purge-before YYYY-MM-DD")
