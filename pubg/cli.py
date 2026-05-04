import os
import sys
import time
from pubg.config import load_config, load_api_key
from pubg.db import (connect, init_schema, upsert_player, get_player_by_name)
from pubg.api_client import PubgClient
from pubg.poller import run_single_tick


def init_db(root: str) -> str:
    os.makedirs(os.path.join(root, "data"), exist_ok=True)
    db_path = os.path.join(root, "data", "pubg-history.db")
    conn = connect(db_path)
    init_schema(conn)
    conn.close()
    print(f"Schema initialisiert: {db_path}")
    return db_path


def cold_start(root: str, max_matches: int = 30):
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

    print(f"Cold-Start: ziehe bis zu {max_matches} Matches…")
    total_imported = 0
    for _ in range(max_matches // 5 + 1):
        stats = run_single_tick(conn, client, cfg["playerName"],
                                 my_acc_id, max_matches_per_tick=5)
        total_imported += stats["new_matches"]
        if stats["errors"]:
            print(f"  Errors: {stats['errors']}")
        if stats["new_matches"] == 0 and stats["skipped"] == 0:
            break
        print(f"  Importiert: +{stats['new_matches']}, "
              f"insgesamt: {total_imported}, skipped: {stats['skipped']}")
        time.sleep(12)
    conn.close()
    print(f"Cold-Start fertig — {total_imported} Matches in DB.")
    return 0


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) > 1 and sys.argv[1] == "init":
        init_db(root)
    elif len(sys.argv) > 1 and sys.argv[1] == "cold-start":
        sys.exit(cold_start(root))
    else:
        print("Usage: python -m pubg.cli init | cold-start")
