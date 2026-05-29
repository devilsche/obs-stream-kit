"""CLI: One-shot Steam-Achievement-Backfill fuer einen Tenant.

Iteriert die owned_games-Library und holt fuer jedes Spiel das Schema
sowie die Unlocks. Verwendet dieselbe Logik wie der Background-Poller
(Layer 4), aber tight-loop mit kurzer Pause damit das Steam-Rate-Limit
nicht reisst.

Usage:
    python -m steam.backfill --tenant 1
"""
import argparse
import sys
import time

from core import db as core_db, credentials
from steam.api_client import SteamClient
from steam.poller import run_backfill_step, SteamPoller


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", type=int, required=True)
    ap.add_argument("--language", default="english")
    ap.add_argument("--delay", type=float, default=1.2,
                     help="Sekunden zwischen API-Calls (Steam-Rate-Limit)")
    ap.add_argument("--max-steps", type=int, default=10_000)
    args = ap.parse_args()

    conn = core_db.connect()
    try:
        creds = credentials.get(conn, args.tenant)
    except LookupError:
        print(f"Tenant {args.tenant} nicht gefunden", file=sys.stderr)
        return 1
    if not creds.steam_api_key or not creds.steam_id:
        print(f"Tenant {args.tenant}: keine Steam-Credentials hinterlegt",
              file=sys.stderr)
        return 1

    client = SteamClient(api_key=creds.steam_api_key,
                          steam_id=creds.steam_id,
                          language=args.language)

    # Wir leihen uns _ensure_schema/_ensure_global_pct aus der Poller-
    # Instanz — instanziieren ohne Thread-Start.
    helper = SteamPoller(
        client_factory=lambda *a, **kw: client,
        root_dir=None,
        default_language=args.language)

    steps = {"schema": 0, "unlocks": 0, "skip": 0, "error": 0}
    new_unlocks_total = 0
    print(f"[backfill] tenant={args.tenant} starting…", flush=True)
    for step in range(args.max_steps):
        result = run_backfill_step(
            conn, args.tenant, client,
            ensure_schema_fn=helper._ensure_schema,
            ensure_global_pct_fn=helper._ensure_global_pct)
        kind = result[0]
        if kind == "done":
            print(f"[backfill] done after {step} iterations.", flush=True)
            break
        steps[kind] = steps.get(kind, 0) + 1
        app_id = result[1]
        if kind == "unlocks":
            new = result[2]
            new_unlocks_total += new
            print(f"[backfill] step {step+1}: unlocks app={app_id} "
                  f"(+{new} new)", flush=True)
        else:
            print(f"[backfill] step {step+1}: {kind} app={app_id}",
                  flush=True)
        time.sleep(args.delay)
    else:
        print(f"[backfill] hit --max-steps={args.max_steps}", flush=True)

    print(f"[backfill] summary: {steps}, new_unlocks={new_unlocks_total}",
          flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
