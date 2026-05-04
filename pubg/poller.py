import datetime
import os
import sqlite3
import threading
from pubg.db import (connect, upsert_player, insert_match, insert_participants,
                     get_known_match_ids, upsert_lifetime,
                     insert_telemetry_events, mark_telemetry_fetched,
                     get_matches_needing_telemetry)
from pubg.match_parser import (parse_match_response, parse_lifetime_response,
                                aggregate_lifetime_modes)


def rotate_backup(db_path: str, max_backups: int = 7,
                  ftp_cfg: dict | None = None) -> dict:
    """Erstellt täglichen Snapshot der DB + lädt optional auf FTP.
    Behält die letzten N lokalen Backups. Returns status dict."""
    status = {"local": None, "ftp": None}
    if not os.path.exists(db_path):
        return status
    today = datetime.datetime.utcnow().strftime("%Y%m%d")
    backup = f"{db_path}.{today}.bak"
    if os.path.exists(backup):
        status["local"] = "already-done"
    else:
        # SQLite Online-Backup-API: konsistenter Snapshot auch bei laufenden
        # Schreibvorgängen (anders als shutil.copy bei WAL-Mode → korrupt).
        try:
            src = sqlite3.connect(db_path)
            dst = sqlite3.connect(backup)
            with dst:
                src.backup(dst)
            src.close()
            dst.close()
            status["local"] = "ok"
        except Exception as e:
            status["local"] = f"error: {e}"
            return status
        # Alte Backups aufräumen
        dir_path = os.path.dirname(db_path) or "."
        backups = sorted(
            f for f in os.listdir(dir_path)
            if f.startswith(os.path.basename(db_path) + ".") and f.endswith(".bak")
        )
        for old in backups[:-max_backups]:
            try:
                os.remove(os.path.join(dir_path, old))
            except Exception:
                pass

    # FTP-Upload (nur wenn neu erstellt oder noch nicht hochgeladen)
    if ftp_cfg and status["local"] in ("ok", "already-done"):
        from pubg.backup import upload_to_ftp
        marker = f"{backup}.ftp-uploaded"
        if not os.path.exists(marker):
            ok, msg = upload_to_ftp(backup, ftp_cfg)
            status["ftp"] = msg
            if ok:
                try:
                    open(marker, "w").close()
                except Exception:
                    pass
        else:
            status["ftp"] = "already-uploaded"
    return status


def _iso_utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_single_tick(conn, client, my_player_name: str,
                    my_account_id: str, max_matches_per_tick: int = 5) -> dict:
    """One polling iteration. Returns stats dict for status reporting."""
    stats = {"new_matches": 0, "errors": [], "skipped": 0}

    try:
        player_payload = client.get_player(my_player_name)
    except Exception as e:
        stats["errors"].append(f"player: {e}")
        return stats

    match_ids = client.extract_match_ids(player_payload)
    known = get_known_match_ids(conn)
    new_ids = [mid for mid in match_ids if mid not in known]

    for mid in new_ids[:max_matches_per_tick]:
        try:
            m_payload = client.get_match(mid)
            parsed = parse_match_response(m_payload, my_account_id)
            insert_match(conn, parsed["match_id"], parsed["map_name"],
                         parsed["game_mode"], parsed.get("is_ranked", False),
                         parsed["duration_secs"], parsed["played_at"],
                         parsed.get("telemetry_url"))
            for p in parsed["squad_participants"]:
                upsert_player(conn, p["account_id"], p["name"],
                              client.platform,
                              is_self=(p["account_id"] == my_account_id))
            insert_participants(conn, parsed["match_id"], parsed["squad_participants"])
            stats["new_matches"] += 1
        except Exception as e:
            stats["errors"].append(f"match {mid}: {e}")

    stats["skipped"] = max(0, len(new_ids) - max_matches_per_tick)
    return stats


def _is_stale(iso_ts, max_age_hours=24):
    if not iso_ts:
        return True
    try:
        ts = datetime.datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    except Exception:
        return True
    age = datetime.datetime.now(datetime.timezone.utc) - ts
    return age.total_seconds() > max_age_hours * 3600


def refresh_lifetimes(conn, client, min_matches: int = 5,
                      max_per_tick: int = 3) -> dict:
    # Self + qualified co-players (>= min_matches together) get refreshed
    # every 24h. Self always counts; co-players only beyond threshold.
    rows = conn.execute("""
        SELECT p.account_id, p.name,
               (SELECT MAX(last_refreshed) FROM player_lifetime
                WHERE account_id = p.account_id) AS last_refreshed
        FROM players p
        WHERE p.is_self = 1
        UNION
        SELECT q.account_id, q.name,
               (SELECT MAX(last_refreshed) FROM player_lifetime
                WHERE account_id = q.account_id) AS last_refreshed
        FROM qualified_co_players q
        WHERE q.shared_matches >= ?
    """, (min_matches,)).fetchall()

    refreshed = 0
    errors = []
    for r in rows:
        if not _is_stale(r["last_refreshed"]):
            continue
        if refreshed >= max_per_tick:
            break
        try:
            payload = client.get_lifetime(r["account_id"])
            modes = parse_lifetime_response(payload)
            for mode, stats in modes.items():
                upsert_lifetime(conn, r["account_id"], mode, stats)
            agg = aggregate_lifetime_modes(modes)
            upsert_lifetime(conn, r["account_id"], "all", agg)
            refreshed += 1
        except Exception as e:
            errors.append(f"{r['name']}: {e}")
    return {"refreshed": refreshed, "errors": errors}


def _squad_account_ids_for_match(conn, match_id):
    rows = conn.execute(
        "SELECT account_id FROM participants WHERE match_id = ?", (match_id,)
    ).fetchall()
    return {r["account_id"] for r in rows}


def process_telemetry_backlog(conn, client, my_account_id, max_per_tick=5):
    from pubg.telemetry import filter_squad_events  # imported lazily, module created in Phase 9
    pending = get_matches_needing_telemetry(conn, limit=max_per_tick)
    processed = 0
    errors = []
    for row in pending:
        try:
            raw = client.get_telemetry(row["telemetry_url"])
        except Exception as e:
            errors.append(f"telemetry {row['match_id']}: {e}")
            mark_telemetry_fetched(conn, row["match_id"])
            continue
        squad = _squad_account_ids_for_match(conn, row["match_id"])
        if my_account_id not in squad:
            squad.add(my_account_id)
        events = list(filter_squad_events(raw, squad))
        if events:
            insert_telemetry_events(conn, row["match_id"], events)
        mark_telemetry_fetched(conn, row["match_id"])
        processed += 1
    return {"processed": processed, "errors": errors}


class PollerThread(threading.Thread):
    def __init__(self, db_path, client, my_player_name, my_account_id,
                 interval_secs=60, lifetime_min_matches=5,
                 lifetime_max_per_tick=3, match_max_per_tick=5,
                 ftp_backup_cfg=None):
        super().__init__(daemon=True, name="pubg-poller")
        self.db_path = db_path
        self.client = client
        self.my_player_name = my_player_name
        self.my_account_id = my_account_id
        self.interval = interval_secs
        self.lifetime_min = lifetime_min_matches
        self.lifetime_max = lifetime_max_per_tick
        self.match_max = match_max_per_tick
        self.ftp_backup_cfg = ftp_backup_cfg
        self._stop = threading.Event()
        self._last_status = {"polling": "starting", "lastPollAt": None,
                              "errors": [], "newMatches": 0,
                              "lifetimeRefreshed": 0,
                              "telemetryProcessed": 0}

    def run(self):
        # Beim Start: Integrität checken — Korruption fällt sofort auf,
        # nicht erst nach Wochen.
        try:
            from pubg.db import integrity_check
            conn0 = connect(self.db_path)
            ic = integrity_check(conn0)
            conn0.close()
            if ic != "ok":
                self._last_status["integrity"] = f"FAILED: {ic}"
            else:
                self._last_status["integrity"] = "ok"
        except Exception as e:
            self._last_status["integrity"] = f"check-error: {e}"

        last_backup_day = None
        while not self._stop.is_set():
            # Tägliches DB-Backup
            today = datetime.datetime.utcnow().strftime("%Y%m%d")
            if last_backup_day != today:
                bk = rotate_backup(self.db_path, ftp_cfg=self.ftp_backup_cfg)
                self._last_status["backup"] = bk
                last_backup_day = today
            try:
                conn = connect(self.db_path)
                m_stats = run_single_tick(conn, self.client,
                                          self.my_player_name, self.my_account_id,
                                          self.match_max)
                l_stats = refresh_lifetimes(conn, self.client,
                                            self.lifetime_min, self.lifetime_max)
                try:
                    t_stats = process_telemetry_backlog(conn, self.client,
                                                         self.my_account_id, 3)
                except Exception as e:
                    t_stats = {"processed": 0, "errors": [f"telemetry-batch: {e}"]}
                all_errors = m_stats["errors"] + l_stats["errors"] + t_stats["errors"]
                self._last_status = {
                    "polling": "ok" if not all_errors else "degraded",
                    "lastPollAt": _iso_utc_now(),
                    "errors": all_errors,
                    "newMatches": m_stats["new_matches"],
                    "lifetimeRefreshed": l_stats["refreshed"],
                    "telemetryProcessed": t_stats["processed"],
                    "rateLimitRemaining": self.client.limiter.remaining()
                                          if hasattr(self.client, "limiter") else None,
                }
                conn.close()
            except Exception as e:
                self._last_status = {"polling": "error", "errors": [str(e)],
                                     "lastPollAt": _iso_utc_now()}
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()

    def status(self):
        return dict(self._last_status)
