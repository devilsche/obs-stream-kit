#!/usr/bin/env python3
"""Feuerstoss-Kennzahlen aus dem Telemetrie-Archiv nachtragen.

**Warum ueberhaupt.** `telemetry_events` speichert nur Squad-Events (siehe
`filter_squad_events` im Poller), also rund zwei Schuetzen je Match. Fuer
eine Vergleichsgruppe braucht es alle ~90 — die stehen nur in der
Rohtelemetrie, und die liegt im SFTP-Archiv.

**Was rueckwirkend geht.** Nicht jedes Archiv-File ist roh: aeltere
Eintraege wurden aus der DB rekonstruiert (`upload_reconstructed_from_db`)
und enthalten damit wieder nur die Squad-Events. Solche Matches erkennt
das Skript an der Zahl verschiedener Schuetzen und laesst sie aus, statt
Zahlen zu schreiben, die aus zwei Spielern statt neunzig kommen.

**Zwei Modi.** Standard tastet nur die zwoelf Feuerstoss-Spalten an; der
Rest bleibt, wie der Ingest ihn geschrieben hat — ein Backfill soll
nichts stillschweigend neu berechnen. Mit `--rebuild` wird die ganze
Zeile neu erzeugt. Das braucht es fuer Korrekturen, die ausserhalb der
Feuerstoss-Spalten liegen: die durchschlagende Munition der Lynx AMR
(Treffer galten als kein Waffenschaden) und der Wurfgeraet-Schaden samt
`is_thrown`-Kennzeichnung.

    python3 scripts/backfill_bursts.py --tenant 1 [--limit N] [--dry-run]
    python3 scripts/backfill_bursts.py --tenant 1 --rebuild --redo
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import db as core_db                             # noqa: E402
from core.db_compat import SqliteCompatConn                # noqa: E402

#: Ab so vielen verschiedenen Schuetzen gilt ein Archiv-File als roh.
#: Ein rekonstruiertes hat die Squad-Groesse, ein rohes rund 90.
RAW_MIN_SHOOTERS = 20

BURST_COLS = ("bursts_init", "hit_bursts_init", "first_shot_init",
              "hit_index_sum_init", "bursts_react", "hit_bursts_react",
              "first_shot_react", "hit_index_sum_react",
              "shots_after_hit_init", "hits_after_hit_init",
              "shots_after_hit_react", "hits_after_hit_react")


def shooter_count(raw):
    ids = {(e.get("attacker") or {}).get("accountId")
           for e in raw or [] if e.get("_T") == "LogPlayerAttack"}
    ids.discard(None)
    return len(ids)


def full_rows_for_match(raw):
    """Komplette match_weapon_stats-Zeilen aus einer Rohtelemetrie.

    Dieselbe Kette wie im Poller, damit Backfill und Ingest nicht
    auseinanderlaufen.
    """
    from pubg.burst_analysis import analyse_bursts
    from pubg.telemetry_analysis import analyse
    from pubg.weapon_performance import to_db_rows
    return to_db_rows(analyse(raw), bursts=analyse_bursts(raw))


def rows_for_match(raw):
    """{(account_id, weapon): {spalte: wert}} aus einer Rohtelemetrie."""
    from pubg.burst_analysis import analyse_bursts, to_row_fields
    from pubg.telemetry_analysis import analyse

    # Account-Ids stehen nicht in jedem Attack-Event; die Analyse sammelt
    # sie ueber alle Event-Felder ein.
    acc_of = {}
    for name, p in ((analyse(raw) or {}).get("players") or {}).items():
        if p.get("accountId"):
            acc_of[name] = p["accountId"]

    out = {}
    for name, per_weapon in analyse_bursts(raw).items():
        acc = acc_of.get(name)
        if not acc:
            continue                      # ohne Id kein Primaerschluessel
        for weapon, stat in per_weapon.items():
            fields = to_row_fields(stat)
            if any(fields.values()):
                out[(acc, weapon)] = fields
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tenant", type=int, required=True)
    ap.add_argument("--limit", type=int, default=0,
                    help="nur die N neuesten Matches (0 = alle)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--redo", action="store_true",
                    help="auch Matches, die schon Werte haben")
    ap.add_argument("--rebuild", action="store_true",
                    help="ganze Zeile neu schreiben statt nur die "
                         "Feuerstoss-Spalten (fuer Korrekturen an Treffern, "
                         "Schaden oder is_thrown)")
    args = ap.parse_args(argv)

    from pubg.archive_config import archive_cfg_for_tenant
    from pubg import hidrive_telemetry as hd

    raw_conn = core_db.connect()
    conn = SqliteCompatConn(raw_conn)
    cfg = archive_cfg_for_tenant(conn, args.tenant)
    if not cfg:
        print(f"Tenant {args.tenant}: kein Telemetrie-Archiv konfiguriert")
        return 1

    have = set(hd.list_archived(cfg=cfg))
    print(f"{len(have)} Dateien im Archiv")

    # Matches ohne Werte zuerst — ein abgebrochener Lauf setzt fort,
    # statt von vorn zu beginnen.
    done_filter = "" if args.redo else """
      AND NOT EXISTS (SELECT 1 FROM match_weapon_stats w
                      WHERE w.tenant_id = m.tenant_id
                        AND w.match_id = m.match_id
                        AND w.bursts_init + w.bursts_react > 0)"""
    sql = f"""SELECT m.match_id, m.played_at FROM matches m
              WHERE m.tenant_id = ? {done_filter}
              ORDER BY m.played_at DESC"""
    todo = [r for r in conn.execute(sql, (args.tenant,)).fetchall()
            if r["match_id"] in have]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(todo)} Matches zu verarbeiten")

    t0 = time.time()
    stats = {"raw": 0, "reconstructed": 0, "missing": 0, "rows": 0,
             "no_row": 0, "failed": 0}
    for i, r in enumerate(todo, 1):
        mid = r["match_id"]
        try:
            blob = hd.download_raw(mid, cfg=cfg)
        except Exception as exc:                       # Netz, Auth, gzip
            stats["failed"] += 1
            print(f"  [{i}/{len(todo)}] {mid}: Download-Fehler {exc}")
            continue
        if not blob:
            stats["missing"] += 1
            continue
        n_shooters = shooter_count(blob)
        if n_shooters < RAW_MIN_SHOOTERS:
            stats["reconstructed"] += 1
            continue
        stats["raw"] += 1
        if args.rebuild:
            full = full_rows_for_match(blob)
            if args.dry_run:
                stats["rows"] += len(full)
            else:
                from pubg.db_pg import upsert_weapon_stats
                upsert_weapon_stats(raw_conn, args.tenant, mid, full)
                raw_conn.commit()
                stats["rows"] += len(full)
            if i % 25 == 0 or i == len(todo):
                el = time.time() - t0
                print(f"  [{i}/{len(todo)}] {el:.0f}s, {el/i:.1f}s/Match, "
                      f"roh {stats['raw']}, rekonstruiert "
                      f"{stats['reconstructed']}, Zeilen {stats['rows']}")
            continue
        rows = rows_for_match(blob)
        if args.dry_run:
            stats["rows"] += len(rows)
        else:
            with raw_conn.cursor() as cur:
                for (acc, weapon), fields in rows.items():
                    sets = ", ".join(f"{c}=%s" for c in BURST_COLS)
                    cur.execute(
                        f"UPDATE match_weapon_stats SET {sets} "
                        "WHERE tenant_id=%s AND match_id=%s "
                        "AND account_id=%s AND weapon=%s",
                        tuple(fields[c] for c in BURST_COLS)
                        + (args.tenant, mid, acc, weapon))
                    # Kein Treffer heisst: der Ingest kennt diese
                    # Spieler-Waffe nicht. Zaehlen statt eine Zeile
                    # anlegen — sonst entstuenden Zeilen ohne Schuesse.
                    if cur.rowcount:
                        stats["rows"] += cur.rowcount
                    else:
                        stats["no_row"] += 1
            raw_conn.commit()
        if i % 25 == 0 or i == len(todo):
            el = time.time() - t0
            print(f"  [{i}/{len(todo)}] {el:.0f}s, "
                  f"{el/i:.1f}s/Match, roh {stats['raw']}, "
                  f"rekonstruiert {stats['reconstructed']}, "
                  f"Zeilen {stats['rows']}")

    print(f"\nfertig in {time.time()-t0:.0f}s")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    if stats["no_row"]:
        print("  Hinweis: 'no_row' sind Spieler-Waffen-Kombinationen aus der "
              "Rohtelemetrie, zu denen match_weapon_stats keine Zeile hat.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
