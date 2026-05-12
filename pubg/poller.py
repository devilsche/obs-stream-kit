import datetime
import os
import sqlite3
import threading
from pubg.db import (connect, upsert_player, insert_match, insert_participants,
                     get_known_match_ids, upsert_lifetime, upsert_season,
                     insert_telemetry_events, mark_telemetry_fetched,
                     get_matches_needing_telemetry, mark_telemetry_schema,
                     insert_team_mapping, mark_match_schema,
                     get_matches_needing_match_schema_update,
                     get_setting, set_setting,
                     CURRENT_MATCH_SCHEMA)
from pubg.match_parser import (parse_match_response, parse_lifetime_response,
                                aggregate_lifetime_modes,
                                parse_season_response, aggregate_season_modes)


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


def ingest_match(conn, client, my_account_id: str, match_id: str) -> None:
    """Lädt + persistiert ein einzelnes Match. Raises bei Fehler.
    `/matches/{id}` ist laut PUBG-Doku NICHT rate-limited — kann
    aggressiv sequentiell aufgerufen werden.

    Persistiert: match-Header, Squad-Participants (full stats),
    team_mapping für gesamte Lobby (lightweight), match_schema marker."""
    m_payload = client.get_match(match_id)
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
    if parsed.get("team_mapping"):
        insert_team_mapping(conn, parsed["match_id"], parsed["team_mapping"])
    mark_match_schema(conn, parsed["match_id"], CURRENT_MATCH_SCHEMA)


def run_single_tick(conn, client, my_player_name: str,
                    my_account_id: str, max_matches_per_tick: int = 5) -> dict:
    """One polling iteration. Returns stats dict for status reporting.
    Hier ist ein get_player()-Call (rate-limited) sinnvoll, weil wir in
    Echtzeit nach NEUEN Matches schauen wollen."""
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
            ingest_match(conn, client, my_account_id, mid)
            stats["new_matches"] += 1
        except Exception as e:
            stats["errors"].append(f"match {mid}: {e}")

    stats["skipped"] = max(0, len(new_ids) - max_matches_per_tick)
    return stats


def run_bulk_catchup(conn, client, my_player_name: str,
                     my_account_id: str, max_matches: int | None = None,
                     pacing_ms: int = 100, progress_cb=None) -> dict:
    """Ein einziger get_player()-Call (rate-limited), dann sequentielles
    ingest_match() für ALLE neuen IDs. /matches/{id} ist nicht rate-
    limited, daher braucht's keinen 12s-Sleep zwischen Iterationen.
    pacing_ms = höflicher 100ms-Sleep zwischen Match-Calls.
    max_matches=None (Default) → kein Cap, ALLE neuen IDs werden
    verarbeitet."""
    import time
    stats = {"new_matches": 0, "errors": [], "skipped": 0}

    try:
        player_payload = client.get_player(my_player_name)
    except Exception as e:
        stats["errors"].append(f"player: {e}")
        return stats

    match_ids = client.extract_match_ids(player_payload)
    known = get_known_match_ids(conn)
    new_ids = [mid for mid in match_ids if mid not in known]

    to_process = new_ids if max_matches is None else new_ids[:max_matches]
    stats["skipped"] = (0 if max_matches is None
                        else max(0, len(new_ids) - max_matches))

    for i, mid in enumerate(to_process, 1):
        try:
            ingest_match(conn, client, my_account_id, mid)
            stats["new_matches"] += 1
        except Exception as e:
            stats["errors"].append(f"match {mid}: {e}")
        if progress_cb:
            progress_cb(i, len(to_process), stats["new_matches"])
        if pacing_ms > 0 and i < len(to_process):
            time.sleep(pacing_ms / 1000)

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


_CURRENT_SEASON_TTL_DAYS = 7


def get_current_season_id(conn, client) -> str | None:
    """Cached current-season-id. PUBG-Seasons wechseln nur alle paar
    Monate, daher 7-Tage-Cache in settings — vermeidet unnötige Rate-
    Limit-Requests gegen /seasons. Bei Cache-Miss/-Stale wird neu gezogen."""
    cached_id = get_setting(conn, "pubg.current_season_id")
    cached_at = get_setting(conn, "pubg.current_season_id_fetched_at")
    if cached_id and not _is_stale(cached_at,
                                    max_age_hours=_CURRENT_SEASON_TTL_DAYS * 24):
        return cached_id
    payload = client.get_seasons()
    sid = client.extract_current_season_id(payload)
    if sid:
        set_setting(conn, "pubg.current_season_id", sid)
        set_setting(conn, "pubg.current_season_id_fetched_at", _iso_utc_now())
    return sid


def refresh_seasons(conn, client, min_matches: int = 5,
                    max_per_tick: int = 3,
                    max_age_hours: int = 6) -> dict:
    """Holt aktuelle Season-Stats (non-ranked) für self + qualified
    co-players. Cadence ist enger als Lifetime (6h statt 24h), weil
    Season-Stats sich öfter ändern (jedes neue Match)."""
    try:
        season_id = get_current_season_id(conn, client)
    except Exception as e:
        return {"refreshed": 0, "errors": [f"current-season-id: {e}"]}
    if not season_id:
        return {"refreshed": 0, "errors": ["no-current-season-id"]}

    rows = conn.execute("""
        SELECT p.account_id, p.name,
               (SELECT MAX(last_refreshed) FROM player_season
                WHERE account_id = p.account_id AND season_id = ?) AS last_refreshed
        FROM players p
        WHERE p.is_self = 1
        UNION
        SELECT q.account_id, q.name,
               (SELECT MAX(last_refreshed) FROM player_season
                WHERE account_id = q.account_id AND season_id = ?) AS last_refreshed
        FROM qualified_co_players q
        WHERE q.shared_matches >= ?
    """, (season_id, season_id, min_matches)).fetchall()

    refreshed = 0
    errors = []
    for r in rows:
        if not _is_stale(r["last_refreshed"], max_age_hours=max_age_hours):
            continue
        if refreshed >= max_per_tick:
            break
        try:
            payload = client.get_season(r["account_id"], season_id)
            modes = parse_season_response(payload)
            for mode, stats in modes.items():
                upsert_season(conn, r["account_id"], season_id, mode, stats)
            agg = aggregate_season_modes(modes)
            upsert_season(conn, r["account_id"], season_id, "all", agg)
            refreshed += 1
        except Exception as e:
            errors.append(f"{r['name']}: {e}")
    return {"refreshed": refreshed, "errors": errors,
            "seasonId": season_id}


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


def _process_one_telemetry(conn, client, my_account_id, row):
    """Lädt + persistiert Telemetry-Events für ein Match. Idempotent."""
    from pubg.telemetry import filter_squad_events
    try:
        raw = client.get_telemetry(row["telemetry_url"])
    except Exception as e:
        mark_telemetry_fetched(conn, row["match_id"])
        raise RuntimeError(f"telemetry {row['match_id']}: {e}")
    squad = _squad_account_ids_for_match(conn, row["match_id"])
    if my_account_id not in squad:
        squad.add(my_account_id)
    events = list(filter_squad_events(raw, squad))
    # Bei Re-Fetch (alte Schema-Version) erst alte events löschen,
    # sonst Doubletten.
    conn.execute("DELETE FROM telemetry_events WHERE match_id = ?",
                  (row["match_id"],))
    conn.commit()
    if events:
        insert_telemetry_events(conn, row["match_id"], events)
    mark_telemetry_fetched(conn, row["match_id"])
    mark_telemetry_schema(conn, row["match_id"])


def process_telemetry_backlog(conn, client, my_account_id, max_per_tick=5):
    """Verarbeitet bis zu max_per_tick Telemetries (für Poller-Tick)."""
    pending = get_matches_needing_telemetry(conn, limit=max_per_tick)
    processed = 0
    errors = []
    for row in pending:
        try:
            _process_one_telemetry(conn, client, my_account_id, row)
            processed += 1
        except Exception as e:
            errors.append(str(e))
    return {"processed": processed, "errors": errors}


def run_bulk_match_schema_upgrade(conn, client, my_account_id,
                                    pacing_ms: int = 100,
                                    progress_cb=None) -> dict:
    """Re-fetcht Matches deren match_schema unter CURRENT liegt
    (z.B. um team_mapping nachzuziehen). /matches/{id} ist nicht
    rate-limited."""
    import time
    stats = {"upgraded": 0, "errors": []}
    rows = get_matches_needing_match_schema_update(conn, CURRENT_MATCH_SCHEMA)
    total = len(rows)
    for i, row in enumerate(rows, 1):
        try:
            ingest_match(conn, client, my_account_id, row["match_id"])
            stats["upgraded"] += 1
        except Exception as e:
            stats["errors"].append(f"match {row['match_id']}: {e}")
        if progress_cb:
            progress_cb(i, total, stats["upgraded"])
        if pacing_ms > 0 and i < total:
            time.sleep(pacing_ms / 1000)
    return stats


def run_bulk_telemetry_catchup(conn, client, my_account_id,
                                max_matches: int | None = None,
                                pacing_ms: int = 100, progress_cb=None) -> dict:
    """Verarbeitet ALLE pending Telemetries ohne 60s-Tick-Drossel.
    /telemetry-cdn ist laut PUBG-Doku NICHT rate-limited — wir können
    sequentiell durchziehen, nur 100ms Höflichkeits-Pace zwischen Calls.

    max_matches=None → kein Cap, alle pending werden verarbeitet.
    """
    import time
    stats = {"processed": 0, "errors": [], "skipped": 0}
    pending = get_matches_needing_telemetry(
        conn, limit=max_matches if max_matches is not None else 100000)
    total = len(pending)
    for i, row in enumerate(pending, 1):
        try:
            _process_one_telemetry(conn, client, my_account_id, row)
            stats["processed"] += 1
        except Exception as e:
            stats["errors"].append(str(e))
        if progress_cb:
            progress_cb(i, total, stats["processed"])
        if pacing_ms > 0 and i < total:
            time.sleep(pacing_ms / 1000)
    return stats


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
                    s_stats = refresh_seasons(conn, self.client,
                                               self.lifetime_min, self.lifetime_max)
                except Exception as e:
                    s_stats = {"refreshed": 0, "errors": [f"season-batch: {e}"],
                               "seasonId": None}
                try:
                    t_stats = process_telemetry_backlog(conn, self.client,
                                                         self.my_account_id, 3)
                except Exception as e:
                    t_stats = {"processed": 0, "errors": [f"telemetry-batch: {e}"]}
                # Session-Achievement-Detection nach neuen Matches.
                # Detect erfasst alle Session-Milestones, INSERT IGNORE
                # filtert Duplikate (PK achievement_id+match_id).
                new_achievements = 0
                if m_stats["new_matches"] > 0 or t_stats["processed"] > 0:
                    try:
                        from pubg.aggregations import (
                            detect_and_store_session_achievements)
                        new_achievements = (
                            detect_and_store_session_achievements(
                                conn, self.my_account_id))
                    except Exception as e:
                        all_errors = (all_errors if 'all_errors' in dir() else [])
                        all_errors.append(f"achievement-detect: {e}")
                all_errors = (m_stats["errors"] + l_stats["errors"]
                              + s_stats["errors"] + t_stats["errors"])
                self._last_status = {
                    "polling": "ok" if not all_errors else "degraded",
                    "lastPollAt": _iso_utc_now(),
                    "errors": all_errors,
                    "newMatches": m_stats["new_matches"],
                    "lifetimeRefreshed": l_stats["refreshed"],
                    "seasonRefreshed": s_stats["refreshed"],
                    "currentSeasonId": s_stats.get("seasonId"),
                    "telemetryProcessed": t_stats["processed"],
                    "newAchievements": new_achievements,
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
