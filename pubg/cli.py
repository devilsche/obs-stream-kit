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


def backfill_pcts(root: str) -> int:
    """Fuellt session_pct und match_pct fuer alle bestehenden Milestones.
    Muss EINMALIG laufen nach dem Update der DB-Schema (neue Spalten).
    Verarbeitet chronologisch (ASC) damit der Snapshot korrekt ist.

    Nutzung:
        python -m pubg.cli backfill-pcts
    """
    from pubg.aggregations import _compute_snapshot_pcts
    from pubg.db import init_schema
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}"); return 1
    conn = connect(db_path)
    init_schema(conn)  # fuegt session_pct / match_pct Spalten hinzu falls noch nicht da
    # Force: alle Pcts neu berechnen (z.B. wenn die Logik geaendert wurde)
    force = "--force" in sys.argv
    if force:
        conn.execute("UPDATE pubg_achievements_seen "
                     "SET session_pct=NULL, match_pct=NULL")
        conn.commit()
        print("(--force: alle Pcts geloescht)")
    rows = conn.execute("""
        SELECT achievement_id, match_id, label, played_at
        FROM pubg_achievements_seen
        WHERE session_pct IS NULL OR match_pct IS NULL
        ORDER BY played_at ASC   -- chronologisch: wichtig fuer korrekten Snapshot
    """).fetchall()
    print(f"{len(rows)} Rows ohne Pct-Werte — berechne Snapshot-Pcts...")
    updated = 0
    for i, r in enumerate(rows, 1):
        try:
            sp, mp = _compute_snapshot_pcts(
                conn, r["achievement_id"], r["played_at"], r["label"])
        except Exception as e:
            print(f"  [{i}] FEHLER {r['achievement_id']}: {e}")
            continue
        conn.execute(
            "UPDATE pubg_achievements_seen SET session_pct=?, match_pct=? "
            "WHERE achievement_id=? AND match_id=?",
            (sp, mp, r["achievement_id"], r["match_id"]))
        updated += 1
        if i % 50 == 0:
            conn.commit()
            print(f"  {i}/{len(rows)} verarbeitet...")
    conn.commit()
    conn.close()
    print(f"Fertig: {updated} Rows mit Pct-Werten befuellt.")
    return 0


def rebuild_achievements(root: str) -> int:
    """Alle Milestones aus vorhandenen telemetry_events neu detektieren.
    Braucht KEINE HiDrive-Verbindung, keine payload_json.
    Loescht pubg_achievements_seen und befuellt neu aus Telemetrie-Daten.

    Nutzung:
        python -m pubg.cli rebuild-achievements
    """
    from pubg.aggregations import backfill_session_achievements
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}"); return 1
    conn = connect(db_path)
    me = conn.execute(
        "SELECT account_id FROM players WHERE is_self=1").fetchone()
    if not me:
        print("Self-Player nicht in DB"); conn.close(); return 1
    my_acc = me["account_id"]
    n_before = conn.execute(
        "SELECT COUNT(*) FROM pubg_achievements_seen").fetchone()[0]
    matches = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
    events = conn.execute(
        "SELECT COUNT(*) FROM telemetry_events").fetchone()[0]
    print(f"DB: {matches} Matches, {events} Telemetrie-Events")
    print(f"Aktuelle Achievements: {n_before}")
    print("\nDetektiere Milestones aus allen Sessions...")
    stats = backfill_session_achievements(
        conn, my_acc, gap_hours=4, suppress_popup=True)
    # Sicherheitsnetz: alle die noch NULL haben sofort als displayed markieren
    # (verhindert Popup-Burst wenn Widget gerade pollt)
    ts_now = int(time.time() * 1000)
    marked = conn.execute(
        "UPDATE pubg_achievements_seen SET displayed_at=? WHERE displayed_at IS NULL",
        (ts_now,)).rowcount
    conn.commit()
    n_after = conn.execute(
        "SELECT COUNT(*) FROM pubg_achievements_seen").fetchone()[0]
    conn.close()
    print(f"\nFertig: {stats.get('sessions',0)} Sessions durchlaufen")
    print(f"  Vorher: {n_before}  →  Nachher: {n_after} Milestones")
    if marked:
        print(f"  {marked} zusaetzlich als 'already shown' markiert (Popup-Schutz)")
    if stats.get('errors'):
        print(f"  Fehler: {stats['errors'][:3]}")
    return 0


def hidrive_clear_payload(root: str) -> int:
    """Loescht payload_json aus allen telemetry_events in SQLite.
    NUR ausfuehren NACHDEM hidrive-backfill erfolgreich war —
    danach ist HiDrive die Raw-Quelle, payload_json wird nicht mehr
    benoetigt.

    Spart ~50% SQLite-Groesse.

    Nutzung:
        python -m pubg.cli hidrive-clear-payload
    """
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}"); return 1
    conn = connect(db_path)
    n = conn.execute(
        "SELECT COUNT(*) FROM telemetry_events WHERE payload_json IS NOT NULL"
    ).fetchone()[0]
    print(f"{n} Rows mit payload_json.")
    if n == 0:
        print("Nichts zu tun."); conn.close(); return 0
    ans = input(f"payload_json aus allen {n} Rows loeschen? "
                f"(hidrive-backfill zuerst gelaufen?) [y/N] ").strip().lower()
    if ans != "y":
        print("Abgebrochen."); conn.close(); return 0
    conn.execute("UPDATE telemetry_events SET payload_json = NULL "
                 "WHERE payload_json IS NOT NULL")
    conn.commit()  # erst committen, dann VACUUM (ausserhalb Transaktion)
    conn.execute("PRAGMA wal_checkpoint(FULL)")
    try:
        conn.execute("VACUUM")
        print("Fertig + VACUUM. SQLite-Datei ist jetzt deutlich kleiner.")
    except Exception as e:
        print(f"UPDATE OK. VACUUM fehlgeschlagen: {e}")
        print("Tipp: serve.py stoppen und manuell ausfuehren:")
        print("  python3 -c \"import sqlite3; c=sqlite3.connect('data/pubg-history.db'); c.execute('VACUUM'); c.close()\"")
    conn.close()
    conn.close()
    return 0


def _download(url, timeout=15):
    import urllib.request as _ur
    with _ur.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _ensure_dir(p):
    os.makedirs(p, exist_ok=True)


def _asset_source(root):
    """Bevorzugt: ../api-assets/ neben obs-stream-kit. Fallback:
    GitHub raw URL. Returns ('local', path) oder ('remote', baseurl)."""
    local = os.path.abspath(os.path.join(root, "..", "api-assets"))
    if os.path.isdir(os.path.join(local, "Assets", "Maps")):
        return ("local", local)
    return ("remote",
            "https://raw.githubusercontent.com/pubg/api-assets/master")


def _fetch_asset(src, rel_path, timeout=15):
    """rel_path is repo-relative z.B. 'Assets/Item/Weapon/Main/Item_X.png'
    oder 'dictionaries/telemetry/mapName.json'. Returns bytes."""
    mode, base = src
    if mode == "local":
        p = os.path.join(base, rel_path)
        with open(p, "rb") as f: return f.read()
    return _download(f"{base}/{rel_path}", timeout=timeout)


def _save_icon_webp(png_bytes, out_path, max_size=256, quality=85):
    """PNG-Bytes -> verkleinertes WebP. Icons sind oft 4k+ HD, in der
    UI aber max 48-128px sichtbar — Resize spart Repo-Size massiv."""
    import io
    from PIL import Image
    img = Image.open(io.BytesIO(png_bytes))
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    img.save(out_path, "WEBP", quality=quality, method=6)


def refresh_assets(root: str) -> int:
    """Lade Maps + Dictionaries + Weapon/Vehicle/Killfeed-Icons aus
    pubg/api-assets in widgets/pubg/assets/ und widgets/pubg/maps/.

    Bevorzugt einen lokalen Clone (../api-assets/ neben obs-stream-kit),
    faellt sonst auf GitHub raw URL zurueck.

    Nutzung:
        python -m pubg.cli refresh-assets
    """
    src = _asset_source(root)
    print(f"Quelle: {src[0]} ({src[1]})")
    assets_dir = os.path.join(root, "widgets", "pubg", "assets")
    _ensure_dir(assets_dir)

    # 1) Dictionaries — kleine JSON-Files mit ID→Name Mappings
    dict_dir = os.path.join(assets_dir, "dictionaries")
    _ensure_dir(dict_dir)
    DICTS = [
        "telemetry/mapName.json",
        "telemetry/damageCauserName.json",
        "telemetry/damageTypeCategory.json",
        "gameMode.json",
    ]
    print("=== Dictionaries ===")
    for path in DICTS:
        rel = f"dictionaries/{path}"
        fname = path.split("/")[-1]
        out = os.path.join(dict_dir, fname)
        try:
            data = _fetch_asset(src, rel)
            with open(out, "wb") as f: f.write(data)
            print(f"  ok   {fname:30s} ({len(data)} B)")
        except Exception as e:
            print(f"  FAIL {fname:30s} {e}")

    # 2) Maps — schon vorhandene Funktion wiederverwenden
    print("\n=== Maps ===")
    refresh_maps(root)

    # 3) Weapon-Icons (alle Weap*.png aus Assets/Item/Weapon/Main/).
    #    Wir holen sie via dem damageCauserName-Dict — fuer jeden
    #    WeapXxx_C versuchen wir das passende Item_Weapon_XXX_C.png.
    print("\n=== Weapon-Icons ===")
    weap_dir = os.path.join(assets_dir, "weapons")
    _ensure_dir(weap_dir)
    import json as _json
    dcn_path = os.path.join(dict_dir, "damageCauserName.json")
    try:
        with open(dcn_path) as f: dcn = _json.load(f)
    except Exception:
        dcn = {}
    weap_ids = [k for k in dcn.keys() if k.startswith("Weap")]
    # Plus ein paar Special-Cases
    weap_ids += ["ProjGrenade_C", "ProjMolotov_C", "ProjC4_C",
                 "ProjStickyGrenade_C", "PanzerFaust100M_Projectile_C"]
    ok = err = 0
    # Spezial-Mappings fuer IDs die im File-Namen anders heissen.
    # Projektile/Throwables tragen meistens das Wort 'Projectile' / 'Proj'
    # im Telemetry-ID, im Assets-Repo aber nicht.
    SPECIAL_STEMS = {
        "ProjGrenade_C":              "Item_Weapon_Grenade_C",
        "ProjMolotov_C":              "Item_Weapon_Molotov_C",
        "ProjStickyGrenade_C":        "Item_Weapon_StickyGrenade_C",
        "ProjC4_C":                   "Item_Weapon_C4_C",
        "ProjSmokeBomb_C":            "Item_Weapon_SmokeBomb_C",
        "PanzerFaust100M_Projectile_C": "Item_Weapon_PanzerFaust100M_C",
        "Mortar_Projectile_C":        "Item_Weapon_Mortar_C",
        "WeapCrossbow_1_C":           "Item_Weapon_Crossbow_C",
        "WeapMosinNagant_C":          "Item_Weapon_Mosin_C",
        "WeapMacheteProjectile_C":    "Item_Weapon_Machete_C",
        "WeapPanProjectile_C":        "Item_Weapon_Pan_C",
        "WeapSickleProjectile_C":     "Item_Weapon_Sickle_C",
        "WeapPickaxeProjectile_C":    "Item_Weapon_Pickaxe_C",
    }
    for wid in weap_ids:
        clean = wid.replace("WeapDuncans", "Weap").replace("WeapJulies", "Weap")
        if wid in SPECIAL_STEMS:
            stem = SPECIAL_STEMS[wid]
        elif clean.startswith("Weap"):
            stem = "Item_Weapon_" + clean[len("Weap"):]
        else:
            stem = "Item_Weapon_" + clean
        out = os.path.join(weap_dir, f"{wid}.webp")
        if os.path.exists(out):
            ok += 1; continue
        success = False
        for sub in ("Main", "Handgun", "Melee", "Throwable"):
            rel = f"Assets/Item/Weapon/{sub}/{stem}.png"
            try:
                data = _fetch_asset(src, rel, timeout=8)
                _save_icon_webp(data, out, max_size=192, quality=85)
                ok += 1; success = True; break
            except Exception:
                continue
        # Letzter Versuch: /Assets/Item/Use/ (Throwables liegen dort)
        if not success:
            for sub in ("Use",):
                rel = f"Assets/Item/{sub}/{stem}.png"
                try:
                    data = _fetch_asset(src, rel, timeout=8)
                    _save_icon_webp(data, out, max_size=192, quality=85)
                    ok += 1; success = True; break
                except Exception:
                    continue
        if not success: err += 1
    print(f"  Weapon-Icons: {ok} ok, {err} fehlend (Skins/Special)")

    # 4) Vehicle-Icons
    print("\n=== Vehicle-Icons ===")
    veh_dir = os.path.join(assets_dir, "vehicles")
    _ensure_dir(veh_dir)
    VEHICLE_IDS = [
        "BP_BRDM_C", "BP_Buggy_C", "BP_CoupeRB_C", "BP_PonyCoupe_C",
        "BP_Mirado_A_00_C", "BP_Mirado_Open_00_C",
        "BP_Niva_00_C", "BP_PickupTruck_A_00_C", "BP_PickupTruck_B_00_C",
        "BP_Van_A_00_C", "BP_Porter_C", "BP_LootTruck_C",
        "BP_Motorbike_00_C", "BP_Motorbike_00_SideCar_C",
        "BP_Motorglider_C", "BP_M_Rony_A_00_C",
        "BP_Snowbike_00_C", "BP_Snowmobile_00_C",
        "BP_Scooter_00_A_C", "BP_TukTukTuk_A_00_C",
        "BP_ATV_C", "BP_Airboat_C", "BP_Dirtbike_C",
        "Boat_PG117_C", "Buggy_A_00_C",
        "Dacia_A_00_v2_C", "Dacia_A_00_v2_snow_C",
        "Uaz_A_00_C", "Uaz_B_00_C", "Uaz_C_00_C",
        "AquaRail_A_00_C", "PG117_A_00_C", "ParachutePlayer_C",
        "DummyTransportAircraft_C",
    ]
    ok = err = 0
    for vid in VEHICLE_IDS:
        rel = f"Assets/Vehicle/{vid}.png"
        out = os.path.join(veh_dir, f"{vid}.webp")
        try:
            if os.path.exists(out): ok += 1; continue
            data = _fetch_asset(src, rel, timeout=8)
            _save_icon_webp(data, out, max_size=192, quality=85)
            ok += 1
        except Exception:
            err += 1
    print(f"  Vehicle-Icons: {ok} ok, {err} fehlend")

    # 5) Killfeed-Icons — Death-Cause-Anzeige
    print("\n=== Killfeed-Icons ===")
    kf_dir = os.path.join(assets_dir, "killfeed")
    _ensure_dir(kf_dir)
    KF_ICONS = [
        "Headshot", "Bluezone", "Redzone", "Blackzone",
        "Drown", "Fall", "Punch", "Death", "DBNO", "Groggy",
        "Vehicle", "Vehicle_Explosion", "Kill_Truck", "Train",
        "Melee_Throw", "Headshot_DBNO", "Ferry", "Zombie_Punch",
        "Kill_Truck_Turret",
    ]
    ok = err = 0
    for kf in KF_ICONS:
        rel = f"Assets/Icons/Killfeed/{kf}.png"
        out = os.path.join(kf_dir, f"{kf}.webp")
        try:
            if os.path.exists(out): ok += 1; continue
            data = _fetch_asset(src, rel, timeout=8)
            _save_icon_webp(data, out, max_size=128, quality=85)
            ok += 1
        except Exception:
            err += 1
    print(f"  Killfeed-Icons: {ok} ok, {err} fehlend")

    # 6) Map-Selection Thumbnails
    print("\n=== Map-Selection-Thumbnails ===")
    ms_dir = os.path.join(assets_dir, "mapselection")
    _ensure_dir(ms_dir)
    MAP_THUMBS = {
        "Baltic_Main": "Erangel", "Erangel_Main": "Erangel",
        "Desert_Main": "Miramar", "Savage_Main": "Sanhok",
        "DihorOtok_Main": "Vikendi", "Summerland_Main": "Karakin",
        "Chimera_Main": "Paramo", "Range_Main": "Camp_Jackal",
        "Tiger_Main": "Taego", "Kiki_Main": "Deston",
        "Neon_Main": "Rondo", "Heaven_Main": "Haven",
    }
    ok = err = 0
    maps_dir = os.path.join(root, "widgets", "pubg", "maps")
    for internal, public in MAP_THUMBS.items():
        out = os.path.join(ms_dir, f"{internal}.webp")
        if os.path.exists(out): ok += 1; continue
        success = False
        # 1) Upstream MapSelection-Asset (existiert nicht fuer alle Maps —
        #    Tiger/Kiki/Neon/Heaven fehlen im pubg/api-assets-Repo)
        for ext in ("png", "jpg"):
            rel = f"Assets/MapSelection/{public}.{ext}"
            try:
                data = _fetch_asset(src, rel, timeout=8)
                _save_icon_webp(data, out, max_size=384, quality=85)
                ok += 1; success = True; break
            except Exception:
                continue
        if success: continue
        # 2) Fallback: HD-Map aus widgets/pubg/maps/ downsamplen
        local_map = os.path.join(maps_dir, f"{internal}.png")
        if os.path.exists(local_map):
            try:
                with open(local_map, "rb") as f:
                    data = f.read()
                _save_icon_webp(data, out, max_size=384, quality=85)
                ok += 1; success = True
            except Exception as e:
                print(f"  {internal}: downsample fehlgeschlagen — {e}")
        if not success: err += 1
    print(f"  Map-Thumbnails: {ok} ok, {err} fehlend")

    print("\n=== refresh-assets fertig ===")
    return 0


def refresh_skins(root: str) -> int:
    """Lade Weapon-/Vehicle-Icons von pubg.com/game-info/ — saubere
    Base-Renderings ohne Skins, stabile URLs.

    Default: NEUE Icons schreiben, existierende intakt lassen.
    Mit --force werden alle Icons ueberschrieben."""
    from pubg.skins import (WEAPON_SLUG_TO_CLASS, VEHICLE_SLUG_TO_CLASS,
                              download_weapon, download_vehicle)
    force = "--force" in sys.argv
    weap_dir = os.path.join(root, "widgets", "pubg", "assets", "weapons")
    veh_dir  = os.path.join(root, "widgets", "pubg", "assets", "vehicles")
    _ensure_dir(weap_dir); _ensure_dir(veh_dir)

    def _do(label, mapping, out_dir, downloader, max_size):
        print(f"\n=== {label} (pubg.com/game-info) ===")
        ok = err = skipped = 0
        for slug, cls in sorted(mapping.items()):
            out = os.path.join(out_dir, f"{cls}.webp")
            if os.path.exists(out) and not force:
                skipped += 1; continue
            try:
                data = downloader(slug, timeout=12)
                _save_icon_webp(data, out, max_size=max_size, quality=85)
                print(f"  {cls:<32} ← {slug}")
                ok += 1
            except Exception as e:
                print(f"  {cls:<32} FEHLER: {e}")
                err += 1
        print(f"  → {ok} geladen, {skipped} unveraendert, {err} fehlend")

    _do("Weapons", WEAPON_SLUG_TO_CLASS, weap_dir,
        download_weapon, max_size=192)
    _do("Vehicles", VEHICLE_SLUG_TO_CLASS, veh_dir,
        download_vehicle, max_size=256)

    print("\n=== refresh-skins fertig ===")
    print("Tipp: --force ueberschreibt bestehende Icons. Neue Waffen/"
          "Vehicles werden in pubg/skins.py erweitert.")
    return 0


NAME_MAP = {
    "Baltic_Main":     "Erangel",
    "Desert_Main":     "Miramar",
    "Savage_Main":     "Sanhok",
    "DihorOtok_Main":  "Vikendi",
    "Summerland_Main": "Karakin",
    "Chimera_Main":    "Paramo",
    "Tiger_Main":      "Taego",
    "Kiki_Main":       "Deston",
    "Neon_Main":       "Rondo",
    "Heaven_Main":     "Haven",
}


def _symlink_or_copy(target_abs, link_path):
    """Verlinkt link_path auf target_abs. Strategy:
      1. Hardlink (os.link)   — kein Admin auf NTFS noetig, 0 Disk-Cost
                                 wenn auf gleichem Filesystem
      2. Symlink (relative)   — braucht auf Windows Developer-Mode
      3. Copy                 — Letzter Fallback (Disk-Duplikation!)
    Existierender Eintrag wird vorher entfernt (idempotent)."""
    if os.path.islink(link_path) or os.path.exists(link_path):
        try: os.remove(link_path)
        except OSError: pass
    # 1) Hardlink — beste Option (kein Admin, kein Disk-Overhead)
    try:
        os.link(target_abs, link_path)
        return
    except OSError:
        pass  # z.B. cross-device link not permitted
    # 2) Symlink (relative damit Repo-portable)
    rel_target = os.path.relpath(target_abs, os.path.dirname(link_path))
    try:
        os.symlink(rel_target, link_path)
        return
    except (OSError, NotImplementedError):
        pass  # z.B. Windows ohne Developer-Mode
    # 3) Copy als letzter Ausweg — Warnung ausgeben
    import shutil
    shutil.copy2(target_abs, link_path)
    print(f"  WARN  {os.path.basename(link_path)} kopiert (kein hardlink/symlink moeglich)")


def refresh_maps(root: str) -> int:
    """Verlinkt die offiziellen No-Text-High-Res-Maps aus dem lokalen
    ../api-assets/Assets/Maps/-Clone in widgets/pubg/maps/.

        widgets/pubg/maps/Baltic_Main.png  ->
            ../../../api-assets/Assets/Maps/Erangel_Main_No_Text_High_Res.png

    Falls Lokal-Clone fehlt: Fallback auf GitHub-Download mit
    WebP-Komprimierung (Low_Res 2048x2048).

    Nutzung:
        python -m pubg.cli refresh-maps
    """
    out_dir = os.path.join(root, "widgets", "pubg", "maps")
    os.makedirs(out_dir, exist_ok=True)
    src = _asset_source(root)
    print(f"Schreibe in {out_dir}/  (Quelle: {src[0]})")

    if src[0] == "local":
        ok, err = 0, 0
        for internal, public in NAME_MAP.items():
            target = os.path.join(
                src[1], "Assets", "Maps",
                f"{public}_Main_No_Text_High_Res.png")
            link = os.path.join(out_dir, f"{internal}.png")
            if not os.path.exists(target):
                print(f"  FAIL {internal:18s} kein Target: {target}")
                err += 1; continue
            try:
                _symlink_or_copy(target, link)
                sz = os.path.getsize(target)
                print(f"  ok   {internal:18s} -> {public}  ({sz//1024} KB)")
                ok += 1
            except Exception as e:
                print(f"  FAIL {internal:18s}: {e}")
                err += 1
        print(f"\nFertig: {ok} Symlinks, {err} Fehler.")
        return 0 if err == 0 else 1

    # Remote-Fallback: Low-Res → WebP
    import io
    try:
        from PIL import Image
    except ImportError:
        print("PIL/Pillow fehlt — 'pip install pillow' und neu starten.")
        return 1
    print("Lokal-Clone von api-assets fehlt — Remote-Download mit Verkleinerung.")
    ok, err = 0, 0
    for internal, public in NAME_MAP.items():
        rel = f"Assets/Maps/{public}_Main_No_Text_Low_Res.png"
        out_path = os.path.join(out_dir, f"{internal}.webp")
        try:
            buf = _fetch_asset(src, rel, timeout=15)
            img = Image.open(io.BytesIO(buf))
            img.thumbnail((2048, 2048), Image.LANCZOS)
            img.save(out_path, "WEBP", quality=85, method=6)
            sz = os.path.getsize(out_path)
            print(f"  ok   {internal:18s} <- {public}  ({sz//1024} KB)")
            ok += 1
        except Exception as e:
            print(f"  FAIL {internal:18s}: {e}")
            err += 1
    print(f"\nFertig: {ok} ok, {err} Fehler.")
    return 0 if err == 0 else 1


def hidrive_refill(root: str, only_match: str = None) -> int:
    """SQLite telemetry_events aus HiDrive-Archiv neu befuellen.
    Nuetzlich wenn filter_squad_events erweitert wurde (neue Event-Typen)
    und alle historischen Matches neu verarbeitet werden sollen.

    Ablauf pro Match:
      1. Raw-Blob von HiDrive laden
      2. filter_squad_events() mit aktueller Logik
      3. telemetry_events in SQLite loeschen + neu einfuegen
      4. telemetry_schema auf CURRENT setzen

    Nutzung:
        python -m pubg.cli hidrive-refill                    # alle Matches
        python -m pubg.cli hidrive-refill --match MATCH_ID   # ein Match
    """
    db_path = os.path.join(root, "data", "pubg-history.db")
    if not os.path.exists(db_path):
        print(f"DB nicht gefunden: {db_path}")
        return 1

    from pubg.hidrive_telemetry import download_raw, list_archived
    from pubg.db import connect, insert_telemetry_events, mark_telemetry_schema
    from pubg.telemetry import filter_squad_events
    from pubg.db import CURRENT_TELEMETRY_SCHEMA

    conn = connect(db_path)
    secrets = os.path.join(root, ".secrets")
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print("Self-Player nicht in DB")
        conn.close()
        return 1
    my_acc = self_p["account_id"]

    # Match-IDs bestimmen
    if only_match:
        match_ids = [only_match]
    else:
        match_ids = list_archived(secrets)
    print(f"{len(match_ids)} Match(es) zum Refill aus HiDrive.\n")

    ok = 0; skip = 0; err = 0
    for i, mid in enumerate(match_ids, 1):
        raw = download_raw(mid, secrets)
        if raw is None:
            print(f"  [{i}/{len(match_ids)}] SKIP {mid[:20]} (nicht auf HiDrive)")
            skip += 1
            continue
        # Squad bestimmen
        squad_rows = conn.execute(
            "SELECT account_id FROM participants WHERE match_id=? "
            "AND team_id=(SELECT team_id FROM participants "
            "WHERE match_id=? AND account_id=?)",
            (mid, mid, my_acc)).fetchall()
        squad = {r["account_id"] for r in squad_rows} | {my_acc}
        # Spielernamen extrahieren + upserten fuer alle Lobby-Member
        try:
            from pubg.telemetry import extract_player_names
            from pubg.db import upsert_player
            for acc, nm in extract_player_names(raw).items():
                if acc and nm and acc != my_acc:
                    upsert_player(conn, acc, nm, cfg.get("platform", "steam"),
                                   is_self=False)
        except Exception:
            pass
        # Gefilterte Events aus Raw
        events = list(filter_squad_events(raw, squad))
        # SQLite: alte Events loeschen + neu einfuegen
        conn.execute("DELETE FROM telemetry_events WHERE match_id=?", (mid,))
        conn.commit()
        if events:
            insert_telemetry_events(conn, mid, events)
        mark_telemetry_schema(conn, mid, CURRENT_TELEMETRY_SCHEMA)
        print(f"  [{i}/{len(match_ids)}] {mid[:20]}  {len(raw)} raw → {len(events)} filtered")
        ok += 1

    conn.close()
    print(f"\nFertig: {ok} neu befuellt, {skip} uebersprungen, {err} Fehler")
    if ok > 0:
        print("Tipp: 'python -m pubg.cli reset-milestones <ids>' um "
              "Milestones mit neuer Logik neu zu detektieren.")
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
    elif len(sys.argv) > 1 and sys.argv[1] == "backfill-pcts":
        sys.exit(backfill_pcts(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "rebuild-achievements":
        sys.exit(rebuild_achievements(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "hidrive-clear-payload":
        sys.exit(hidrive_clear_payload(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "hidrive-refill":
        # Optional: --match MATCH_ID fuer einzelnen Match
        mid = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--match" else None
        sys.exit(hidrive_refill(root, only_match=mid))
    elif len(sys.argv) > 1 and sys.argv[1] == "refresh-maps":
        sys.exit(refresh_maps(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "refresh-assets":
        sys.exit(refresh_assets(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "refresh-skins":
        sys.exit(refresh_skins(root))
    else:
        print("Usage: python -m pubg.cli init | cold-start | pull-ftp | "
              "seasons-backfill | wipe-day [YYYY-MM-DD] [--keep-popups] | "
              "reset-milestones <id1> [<id2> ...] | "
              "list-milestones [pattern] | "
              "purge-before YYYY-MM-DD")
