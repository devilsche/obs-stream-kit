import datetime
import os
import shutil
import sys
import time
from pubg.config import load_config, load_api_key
from pubg.db import (connect, init_schema, upsert_player, get_player_by_name,
                      integrity_check)
from pubg.api_client import PubgClient
from pubg.poller import run_single_tick
from pubg.backup import (load_ftp_config, list_remote_backups,
                          download_from_ftp)


def init_db(root: str) -> str:
    os.makedirs(os.path.join(root, "data"), exist_ok=True)
    db_path = os.path.join(root, "data", "pubg-history.db")
    conn = connect(db_path)
    init_schema(conn)
    conn.close()
    print(f"Schema initialisiert: {db_path}")
    return db_path


def cold_start(root: str, max_matches: int = 500):
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    api_key = load_api_key(os.path.join(root, ".secrets"))
    if not api_key:
        print("Kein PUBG-API-Key in .secrets!")
        return 1
    db_path = init_db(root)
    client = PubgClient(api_key=api_key, platform=cfg["platform"])
    conn = connect(db_path)

    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print(f"Pulle Account-ID für {cfg['playerName']}…")
        try:
            resp = client.get_player(cfg["playerName"])
        except Exception as e:
            print(f"API-Fehler: {e}")
            return 1
        if not resp.get("data"):
            print("Player nicht gefunden!")
            return 1
        my_acc_id = resp["data"][0]["id"]
        upsert_player(conn, my_acc_id, cfg["playerName"],
                      cfg["platform"], is_self=True)
    else:
        my_acc_id = self_p["account_id"]
        print(f"Player bereits in DB: {my_acc_id}")

    # Loopt bis keine neuen Matches mehr in der API-Liste sind. Safety-Cap
    # max_matches verhindert Endlos-Schleifen bei unerwartetem API-Verhalten.
    print(f"Cold-Start: ingestiere alle verfügbaren Matches "
          f"(Safety-Cap {max_matches})…")
    total_imported = 0
    iterations = 0
    max_iterations = max_matches // 5 + 1
    while iterations < max_iterations:
        iterations += 1
        stats = run_single_tick(conn, client, cfg["playerName"],
                                 my_acc_id, max_matches_per_tick=5)
        total_imported += stats["new_matches"]
        if stats["errors"]:
            print(f"  Errors: {stats['errors']}")
        # Break wenn nichts neues mehr und auch nichts übersprungen
        if stats["new_matches"] == 0 and stats["skipped"] == 0:
            break
        print(f"  Importiert: +{stats['new_matches']}, "
              f"insgesamt: {total_imported}, "
              f"verbleibend in API-Liste: {stats['skipped']}")
        time.sleep(12)
    conn.close()
    if iterations >= max_iterations:
        print(f"Cold-Start: Safety-Cap erreicht nach {total_imported} Matches "
              f"({max_iterations} Iterations × 5 max). Restart triggert "
              f"Auto-Catch-Up der noch fehlt — oder max_matches erhöhen.")
    else:
        print(f"Cold-Start fertig — {total_imported} Matches in DB.")
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

    print(f"Liste FTP-Backups auf {cfg['host']}{cfg['path'] or '/'} …")
    try:
        remote = list_remote_backups(cfg)
    except Exception as e:
        print(f"FTP-Listing fehlgeschlagen: {e}")
        return 1
    if not remote:
        print("Keine Backups gefunden.")
        return 1

    latest = remote[-1]
    print(f"Neuestes Backup: {latest}")
    print(f"Verfügbar gesamt: {len(remote)} ({remote[0]} → {remote[-1]})")

    # Lokale DB wegsichern
    if os.path.exists(db_path):
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        safety = f"{db_path}.before-pull-{ts}"
        shutil.copy2(db_path, safety)
        print(f"Lokale DB gesichert: {safety}")
        # WAL/SHM-Files (falls noch da) entfernen — passen nicht zur neuen DB
        for ext in ("-wal", "-shm"):
            p = db_path + ext
            if os.path.exists(p):
                os.remove(p)

    print(f"Lade {latest} → {db_path}")
    ok, msg = download_from_ftp(latest, db_path, cfg)
    print(msg)
    if not ok:
        return 1

    # Integrität prüfen
    conn = connect(db_path)
    try:
        ic = integrity_check(conn)
        print(f"Integrität: {ic}")
        if ic != "ok":
            print("WARNUNG: DB-Integrität nicht ok. Lokale Sicherung wiederherstellen?")
            return 1
        cnt = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        print(f"Matches in der DB: {cnt}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) > 1 and sys.argv[1] == "init":
        init_db(root)
    elif len(sys.argv) > 1 and sys.argv[1] == "cold-start":
        sys.exit(cold_start(root))
    elif len(sys.argv) > 1 and sys.argv[1] == "pull-ftp":
        sys.exit(pull_from_ftp(root))
    else:
        print("Usage: python -m pubg.cli init | cold-start | pull-ftp")
