"""PUBG-Poller — tenant-aware.

Iteriert alle Tenants aus der Postgres-DB, laedt pro Tenant Credentials
aus dem Vault (core.credentials) und pollt die PUBG-API mit dem
tenant-eigenen API-Key und Spieler-Namen.

Telemetrie-Archivierung auf HiDrive ist an `users.is_admin` gebunden —
nur Admin-Owner-Accounts duerfen Telemetrie-Blobs auf den geteilten
FTP-Storage hochladen (Cost-/Datenschutz-Gate).
"""
import datetime
import threading

from core import db as core_db
from core import credentials
from core.db_compat import SqliteCompatConn
from pubg.db_pg import (upsert_player, insert_match, insert_participants,
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


def _iso_utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Telemetrie-Archivierungs-Gate
# ---------------------------------------------------------------------------

def maybe_archive_telemetry(conn, tenant_id: int, match_id: str,
                             telemetry_url: str) -> None:
    """Telemetrie-Upload-Gate: nur fuer Tenants, deren Owner-User
    `is_admin = TRUE` hat. Andere Tenants ueberspringen den FTP-Upload
    (Cost-/Storage-Gate auf dem geteilten HiDrive-Bucket).

    `conn` darf ein psycopg2-RealDict-Conn oder SqliteCompatConn sein —
    wir greifen nur ueber den Standard-cursor()-Pfad zu.
    """
    raw_conn = conn.raw if isinstance(conn, SqliteCompatConn) else conn
    with raw_conn.cursor() as cur:
        cur.execute("""
            SELECT u.is_admin
            FROM tenants t
            JOIN users u ON u.id = t.owner_user_id
            WHERE t.id = %s
        """, (tenant_id,))
        row = cur.fetchone()
    if not row or not row["is_admin"]:
        return
    _ftp_upload_telemetry(tenant_id, match_id, telemetry_url)


def _ftp_upload_telemetry(tenant_id: int, match_id: str,
                          telemetry_url: str) -> None:
    """Telemetrie vom PUBG-CDN ziehen und auf HiDrive ablegen.

    Verwendet die bestehende hidrive_telemetry.upload_raw()-Logik.
    Die Funktion signatur akzeptiert (match_id, raw_events) — wir ziehen
    die Events hier ad-hoc per HTTP-Get vom CDN, falls noch nicht
    geschehen. Im Normalfall wird maybe_archive_telemetry() nach einem
    erfolgreichen CDN-Fetch in _process_one_telemetry() aufgerufen, sodass
    der Aufrufer den `raw`-Blob bereits hat. Diese Helfer-Funktion ist
    daher primaer fuer kuenftige Wiederverwendung gedacht.

    `tenant_id` ist aktuell nicht Teil der hidrive_telemetry-Signatur —
    HiDrive-Pfad enthaelt nur die match_id. TODO: Tenant in Path
    aufnehmen wenn mehrere Admin-Tenants gleichzeitig archivieren.
    """
    try:
        import urllib.request, json, gzip
        req = urllib.request.Request(telemetry_url, headers={
            "Accept-Encoding": "gzip",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
        # PUBG-CDN liefert manchmal gzipped JSON ohne Content-Encoding-Header.
        # Erkennen via Magic-Bytes (0x1f 0x8b) und entpacken.
        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        raw = json.loads(body)
    except Exception as e:
        print(f"[archive] tenant {tenant_id} match {match_id[:16]}: "
              f"CDN-Fetch fehlgeschlagen: {e}")
        return
    try:
        from pubg import hidrive_telemetry
        hidrive_telemetry.upload_raw(match_id, raw)
    except Exception as e:
        print(f"[archive] tenant {tenant_id} match {match_id[:16]}: "
              f"HiDrive-Upload fehlgeschlagen: {e}")


# ---------------------------------------------------------------------------
# Match-Ingest
# ---------------------------------------------------------------------------

def ingest_match(conn, tenant_id: int, client, my_account_id: str,
                 match_id: str) -> None:
    """Laedt + persistiert ein einzelnes Match fuer einen Tenant.
    `/matches/{id}` ist nicht rate-limited."""
    m_payload = client.get_match(match_id)
    parsed = parse_match_response(m_payload, my_account_id)
    insert_match(conn, tenant_id, parsed["match_id"], parsed["map_name"],
                 parsed["game_mode"], parsed.get("is_ranked", False),
                 parsed["duration_secs"], parsed["played_at"],
                 parsed.get("telemetry_url"))
    for p in parsed["squad_participants"]:
        upsert_player(conn, tenant_id, p["account_id"], p["name"],
                      client.platform,
                      is_self=(p["account_id"] == my_account_id))
    insert_participants(conn, tenant_id, parsed["match_id"],
                        parsed["squad_participants"])
    if parsed.get("team_mapping"):
        insert_team_mapping(conn, tenant_id, parsed["match_id"],
                            parsed["team_mapping"])
    mark_match_schema(conn, tenant_id, parsed["match_id"],
                       CURRENT_MATCH_SCHEMA)
    # Telemetrie-Archivierung (nur Admin-Tenants)
    if parsed.get("telemetry_url"):
        try:
            maybe_archive_telemetry(conn, tenant_id, parsed["match_id"],
                                     parsed["telemetry_url"])
        except Exception as e:
            print(f"[archive] tenant {tenant_id} match "
                  f"{parsed['match_id'][:16]}: {e}")


def run_single_tick(conn, tenant_id: int, client, my_player_name: str,
                    my_account_id: str,
                    max_matches_per_tick: int = 5) -> dict:
    """Eine Polling-Iteration fuer einen Tenant."""
    stats = {"new_matches": 0, "errors": [], "skipped": 0}
    try:
        player_payload = client.get_player(my_player_name)
    except Exception as e:
        stats["errors"].append(f"player: {e}")
        return stats
    match_ids = client.extract_match_ids(player_payload)
    known = get_known_match_ids(conn, tenant_id)
    new_ids = [mid for mid in match_ids if mid not in known]
    for mid in new_ids[:max_matches_per_tick]:
        try:
            ingest_match(conn, tenant_id, client, my_account_id, mid)
            stats["new_matches"] += 1
        except Exception as e:
            stats["errors"].append(f"match {mid}: {e}")
    stats["skipped"] = max(0, len(new_ids) - max_matches_per_tick)
    return stats


def run_bulk_catchup(conn, tenant_id: int, client, my_player_name: str,
                     my_account_id: str, max_matches: int | None = None,
                     pacing_ms: int = 100, progress_cb=None) -> dict:
    """Ein get_player()-Call (rate-limited), dann sequentielles
    ingest_match() fuer alle neuen Match-IDs. /matches/{id} ist nicht
    rate-limited."""
    import time
    stats = {"new_matches": 0, "errors": [], "skipped": 0}
    try:
        player_payload = client.get_player(my_player_name)
    except Exception as e:
        stats["errors"].append(f"player: {e}")
        return stats
    match_ids = client.extract_match_ids(player_payload)
    known = get_known_match_ids(conn, tenant_id)
    new_ids = [mid for mid in match_ids if mid not in known]
    to_process = new_ids if max_matches is None else new_ids[:max_matches]
    stats["skipped"] = (0 if max_matches is None
                        else max(0, len(new_ids) - max_matches))
    for i, mid in enumerate(to_process, 1):
        try:
            ingest_match(conn, tenant_id, client, my_account_id, mid)
            stats["new_matches"] += 1
        except Exception as e:
            stats["errors"].append(f"match {mid}: {e}")
        if progress_cb:
            progress_cb(i, len(to_process), stats["new_matches"])
        if pacing_ms > 0 and i < len(to_process):
            time.sleep(pacing_ms / 1000)
    return stats


# ---------------------------------------------------------------------------
# Lifetime + Season-Refresh
# ---------------------------------------------------------------------------

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


def get_current_season_id(conn, tenant_id: int, client) -> str | None:
    """Cached current-season-id pro Tenant in settings."""
    cached_id = get_setting(conn, tenant_id, "pubg.current_season_id")
    cached_at = get_setting(conn, tenant_id, "pubg.current_season_id_fetched_at")
    if cached_id and not _is_stale(
            cached_at, max_age_hours=_CURRENT_SEASON_TTL_DAYS * 24):
        return cached_id
    payload = client.get_seasons()
    sid = client.extract_current_season_id(payload)
    if sid:
        set_setting(conn, tenant_id, "pubg.current_season_id", sid)
        set_setting(conn, tenant_id, "pubg.current_season_id_fetched_at",
                    _iso_utc_now())
    return sid


def refresh_seasons(conn, tenant_id: int, client, min_matches: int = 5,
                    max_per_tick: int = 3,
                    max_age_hours: int = 6) -> dict:
    """Aktuelle Season-Stats fuer self + qualified co-players."""
    try:
        season_id = get_current_season_id(conn, tenant_id, client)
    except Exception as e:
        return {"refreshed": 0, "errors": [f"current-season-id: {e}"]}
    if not season_id:
        return {"refreshed": 0, "errors": ["no-current-season-id"]}

    rows = conn.execute("""
        SELECT p.account_id, p.name,
               (SELECT MAX(last_refreshed) FROM player_season
                WHERE account_id = p.account_id AND season_id = ?
                  AND tenant_id = ?) AS last_refreshed
        FROM players p
        WHERE p.is_self = 1 AND p.tenant_id = ?
        UNION
        SELECT q.account_id, q.name,
               (SELECT MAX(last_refreshed) FROM player_season
                WHERE account_id = q.account_id AND season_id = ?
                  AND tenant_id = ?) AS last_refreshed
        FROM qualified_co_players q
        WHERE q.shared_matches >= ? AND q.tenant_id = ?
    """, (season_id, tenant_id, tenant_id,
          season_id, tenant_id, min_matches, tenant_id)).fetchall()

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
                upsert_season(conn, tenant_id, r["account_id"], season_id,
                              mode, stats)
            agg = aggregate_season_modes(modes)
            upsert_season(conn, tenant_id, r["account_id"], season_id, "all",
                          agg)
            refreshed += 1
        except Exception as e:
            errors.append(f"{r['name']}: {e}")
    return {"refreshed": refreshed, "errors": errors, "seasonId": season_id}


def backfill_missing_seasons(conn, tenant_id: int, client,
                             max_per_tick: int = 1) -> dict:
    """Holt eine missing historische Season pro Tick fuer SELF.

    Strategie:
    - Liste aller Seasons aus client.get_seasons() (cached via settings).
    - Welche fehlen in player_season fuer SELF?
    - Welche stehen auf der Skip-Liste (vorher fehlgeschlagen, z.B. 500)?
    - Picke die neueste verbleibende → fetch → store. Bei Fehler in Skip-Liste.

    Cost: ~1 API-Call/min. Over Zeit catched alle holbaren Seasons.
    """
    import json
    # SELF account_id holen
    self_row = conn.execute(
        "SELECT account_id FROM players WHERE tenant_id=? AND is_self=1 LIMIT 1",
        (tenant_id,)).fetchone()
    if not self_row:
        return {"backfilled": 0, "errors": []}
    acc_id = self_row["account_id"]

    # Skip-Liste laden
    skip_row = conn.execute(
        "SELECT value FROM settings WHERE tenant_id=? AND key=?",
        (tenant_id, "pubg.season_backfill_skip")).fetchone()
    skip = set(json.loads(skip_row["value"])) if skip_row else set()

    # Existing-Seasons fuer SELF
    existing = {r["season_id"] for r in conn.execute(
        "SELECT DISTINCT season_id FROM player_season "
        "WHERE tenant_id=? AND account_id=? AND mode=?",
        (tenant_id, acc_id, "all")).fetchall()}

    # All-Seasons aus API (mit lokalem Cache via settings — 7d)
    cache_row = conn.execute(
        "SELECT value, updated_at FROM settings WHERE tenant_id=? AND key=?",
        (tenant_id, "pubg.all_seasons_cache")).fetchone()
    all_seasons = None
    if cache_row and not _is_stale(cache_row.get("updated_at"),
                                    max_age_hours=24 * 7):
        try:
            all_seasons = json.loads(cache_row["value"])
        except Exception:
            all_seasons = None
    if all_seasons is None:
        try:
            payload = client.get_seasons()
            all_seasons = [s["id"] for s in payload.get("data", []) if s.get("id")]
            conn.execute(
                "INSERT INTO settings (tenant_id, key, value, updated_at) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, "
                "updated_at=EXCLUDED.updated_at",
                (tenant_id, "pubg.all_seasons_cache",
                 json.dumps(all_seasons), _iso_utc_now()))
            conn.commit()
        except Exception as e:
            return {"backfilled": 0, "errors": [f"get_seasons: {e}"]}

    # Welche fehlen UND nicht auf Skip-Liste?
    # Sortiert: aktuelle zuerst (vermutlich rueckwaerts sortiert in API).
    missing = [s for s in all_seasons if s not in existing and s not in skip]
    if not missing:
        return {"backfilled": 0, "errors": []}

    backfilled = 0
    errors = []
    for sid in missing[:max_per_tick]:
        try:
            payload = client.get_season(acc_id, sid)
            modes = parse_season_response(payload)
            for mode, stats in modes.items():
                upsert_season(conn, tenant_id, acc_id, sid, mode, stats)
            upsert_season(conn, tenant_id, acc_id, sid, "all",
                          aggregate_season_modes(modes))
            backfilled += 1
        except Exception as e:
            # Markiere season als skip — sonst hammern wir die ewig
            skip.add(sid)
            conn.execute(
                "INSERT INTO settings (tenant_id, key, value, updated_at) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, "
                "updated_at=EXCLUDED.updated_at",
                (tenant_id, "pubg.season_backfill_skip",
                 json.dumps(sorted(skip)), _iso_utc_now()))
            conn.commit()
            errors.append(f"{sid}: {e}")
    return {"backfilled": backfilled, "errors": errors}


SELF_LIFETIME_MAX_AGE_MINUTES = 1
"""SELF lifetime-stats werden in JEDEM Poll-Tick refreshed (alle 60s,
   solange last_refreshed > 60s alt). Cost: 1 API-Call/Min — voellig im
   Rate-Limit. Vorteil: Lifetime-Stats sehen jeden neuen Match-Win
   spaetestens zum naechsten Tick, nicht erst Stunden spaeter.
   Co-Players bleiben bei 24h Stale-Schwelle (sonst Rate-Limit-Sturm)."""


def refresh_lifetimes(conn, tenant_id: int, client, min_matches: int = 5,
                      max_per_tick: int = 3) -> dict:
    """Self (alle 1h) + qualified co-players (alle 24h) -> Lifetime-Stats.

    SELF kommt mit einem is_self-Flag, damit die for-loop weiss ob hier die
    kuerzere Stale-Schwelle gilt. Self-Rows werden via UNION ALL zuerst
    geliefert, damit sie auch bei max_per_tick-Limit zuerst rankommen."""
    rows = conn.execute("""
        SELECT p.account_id, p.name, 1 AS is_self,
               (SELECT MAX(last_refreshed) FROM player_lifetime
                WHERE account_id = p.account_id AND tenant_id = ?) AS last_refreshed
        FROM players p
        WHERE p.is_self = 1 AND p.tenant_id = ?
        UNION ALL
        SELECT q.account_id, q.name, 0 AS is_self,
               (SELECT MAX(last_refreshed) FROM player_lifetime
                WHERE account_id = q.account_id AND tenant_id = ?) AS last_refreshed
        FROM qualified_co_players q
        WHERE q.shared_matches >= ? AND q.tenant_id = ?
    """, (tenant_id, tenant_id, tenant_id, min_matches, tenant_id)).fetchall()

    refreshed = 0
    errors = []
    for r in rows:
        if r["is_self"]:
            # SELF: minuten-granular pruefen (gleichgesetzt: max_age_hours-Float).
            max_age = SELF_LIFETIME_MAX_AGE_MINUTES / 60.0
        else:
            max_age = 24
        if not _is_stale(r["last_refreshed"], max_age_hours=max_age):
            continue
        # SELF zaehlt nicht gegen max_per_tick (1 Self-Call/min ist Pflicht).
        if not r["is_self"] and refreshed >= max_per_tick:
            break
        try:
            payload = client.get_lifetime(r["account_id"])
            modes = parse_lifetime_response(payload)
            for mode, stats in modes.items():
                upsert_lifetime(conn, tenant_id, r["account_id"], mode, stats)
            agg = aggregate_lifetime_modes(modes)
            upsert_lifetime(conn, tenant_id, r["account_id"], "all", agg)
            refreshed += 1
        except Exception as e:
            errors.append(f"{r['name']}: {e}")
    return {"refreshed": refreshed, "errors": errors}


# ---------------------------------------------------------------------------
# Telemetrie-Backlog
# ---------------------------------------------------------------------------

def _squad_account_ids_for_match(conn, tenant_id: int, match_id):
    rows = conn.execute(
        "SELECT account_id FROM participants "
        "WHERE match_id = ? AND tenant_id = ?",
        (match_id, tenant_id)
    ).fetchall()
    return {r["account_id"] for r in rows}


def _process_one_telemetry(conn, tenant_id: int, client, my_account_id, row):
    """Laedt + persistiert Telemetry-Events fuer ein Match. Idempotent.

    Bei 404 → abandoned (kein Retry). Bei anderen Fehlern: nur
    telemetry_fetched=1, naechster Tick versucht's nochmal.
    """
    import urllib.error
    from pubg.telemetry import filter_squad_events
    from pubg.db_pg import has_telemetry_for_match
    # Telemetrie ist global — wenn ein anderer Tenant das Match schon
    # gefetched hat, einfach markieren + raus, kein API-Call.
    if has_telemetry_for_match(
            conn.raw if isinstance(conn, SqliteCompatConn) else conn,
            row["match_id"]):
        mark_telemetry_fetched(conn, tenant_id, row["match_id"])
        mark_telemetry_schema(conn, tenant_id, row["match_id"])
        return
    try:
        raw = client.get_telemetry(row["telemetry_url"])
    except urllib.error.HTTPError as e:
        if e.code == 404:
            mark_telemetry_fetched(conn, tenant_id, row["match_id"])
            mark_telemetry_schema(conn, tenant_id, row["match_id"])
            raise RuntimeError(
                f"telemetry {row['match_id']}: 404 expired (abandoned)")
        mark_telemetry_fetched(conn, tenant_id, row["match_id"])
        raise RuntimeError(f"telemetry {row['match_id']}: HTTP {e.code}")
    except Exception as e:
        mark_telemetry_fetched(conn, tenant_id, row["match_id"])
        raise RuntimeError(f"telemetry {row['match_id']}: {e}")

    # Raw-Blob auf HiDrive archivieren — nur fuer Admin-Tenants.
    # Wir haben raw bereits im Speicher, daher den Upload direkt
    # statt ueber maybe_archive_telemetry() (das wuerde nochmal CDN-fetchen).
    try:
        raw_conn = conn.raw if isinstance(conn, SqliteCompatConn) else conn
        with raw_conn.cursor() as cur:
            cur.execute("""
                SELECT u.is_admin
                FROM tenants t JOIN users u ON u.id = t.owner_user_id
                WHERE t.id = %s
            """, (tenant_id,))
            adm_row = cur.fetchone()
        if adm_row and adm_row["is_admin"]:
            from pubg.hidrive_telemetry import upload_raw as _hd_upload
            _hd_upload(row["match_id"], raw)
    except Exception:
        pass  # HiDrive/Admin-Check-Fehler duerfen Fetch nicht blockieren

    squad = _squad_account_ids_for_match(conn, tenant_id, row["match_id"])
    if my_account_id not in squad:
        squad.add(my_account_id)
    # Spielernamen aus den Raw-Events upserten (Lobby-Gegner).
    try:
        from pubg.telemetry import extract_player_names
        for acc, nm in extract_player_names(raw).items():
            if acc and nm and acc != my_account_id:
                upsert_player(conn, tenant_id, acc, nm, client.platform,
                              is_self=False)
    except Exception:
        pass
    events = list(filter_squad_events(raw, squad))
    # Bei Re-Fetch alte events loeschen → keine Doubletten. Telemetrie
    # ist global, kein tenant_id-Filter.
    conn.execute(
        "DELETE FROM telemetry_events WHERE match_id = ?",
        (row["match_id"],))
    conn.commit()
    if events:
        insert_telemetry_events(
            conn.raw if isinstance(conn, SqliteCompatConn) else conn,
            row["match_id"], events)
    mark_telemetry_fetched(conn, tenant_id, row["match_id"])
    mark_telemetry_schema(conn, tenant_id, row["match_id"])


def process_telemetry_backlog(conn, tenant_id: int, client, my_account_id,
                               max_per_tick=5):
    """Verarbeitet bis zu max_per_tick Telemetries pro Tick."""
    pending = get_matches_needing_telemetry(conn, tenant_id,
                                             limit=max_per_tick)
    processed = 0
    errors = []
    for row in pending:
        try:
            _process_one_telemetry(conn, tenant_id, client, my_account_id, row)
            processed += 1
        except Exception as e:
            errors.append(str(e))
    return {"processed": processed, "errors": errors}


def run_bulk_match_schema_upgrade(conn, tenant_id: int, client, my_account_id,
                                    pacing_ms: int = 100,
                                    progress_cb=None) -> dict:
    """Re-fetcht Matches mit veraltetem match_schema."""
    import time
    stats = {"upgraded": 0, "errors": []}
    rows = get_matches_needing_match_schema_update(
        conn, tenant_id, CURRENT_MATCH_SCHEMA)
    total = len(rows)
    for i, row in enumerate(rows, 1):
        try:
            ingest_match(conn, tenant_id, client, my_account_id,
                         row["match_id"])
            stats["upgraded"] += 1
        except Exception as e:
            stats["errors"].append(f"match {row['match_id']}: {e}")
        if progress_cb:
            progress_cb(i, total, stats["upgraded"])
        if pacing_ms > 0 and i < total:
            time.sleep(pacing_ms / 1000)
    return stats


def run_bulk_telemetry_catchup(conn, tenant_id: int, client, my_account_id,
                                max_matches: int | None = None,
                                pacing_ms: int = 100,
                                progress_cb=None) -> dict:
    """Verarbeitet alle pending Telemetries ohne 60s-Drossel."""
    import time
    stats = {"processed": 0, "errors": [], "skipped": 0}
    pending = get_matches_needing_telemetry(
        conn, tenant_id,
        limit=max_matches if max_matches is not None else 100000)
    total = len(pending)
    for i, row in enumerate(pending, 1):
        try:
            _process_one_telemetry(conn, tenant_id, client, my_account_id, row)
            stats["processed"] += 1
        except Exception as e:
            stats["errors"].append(str(e))
        if progress_cb:
            progress_cb(i, total, stats["processed"])
        if pacing_ms > 0 and i < total:
            time.sleep(pacing_ms / 1000)
    return stats


# ---------------------------------------------------------------------------
# Top-Level Tenant-Loop
# ---------------------------------------------------------------------------

def _list_tenant_ids(conn) -> list[int]:
    raw_conn = conn.raw if isinstance(conn, SqliteCompatConn) else conn
    with raw_conn.cursor() as cur:
        cur.execute("SELECT id FROM tenants ORDER BY id")
        return [r["id"] for r in cur.fetchall()]


def poll_tenant(conn, tenant_id: int, client_factory,
                match_max: int = 5,
                lifetime_min: int = 5,
                lifetime_max: int = 3) -> dict:
    """Pollt einen einzelnen Tenant.

    `client_factory(api_key, platform)` baut den PUBG-API-Client. So muss
    der Caller (PollerThread/run()) nichts ueber die Client-Implementierung
    wissen, und Tests koennen einen Stub injizieren.
    """
    creds = credentials.get(conn, tenant_id)
    if not creds.pubg_api_key or not creds.pubg_name:
        return {"polling": "skip", "reason": "no-pubg-credentials",
                "tenantId": tenant_id}
    client = client_factory(creds.pubg_api_key,
                            creds.pubg_platform or "steam")
    # account_id aus credentials (gecached) oder vom client nachziehen
    my_account_id = creds.pubg_account_id
    if not my_account_id:
        try:
            payload = client.get_player(creds.pubg_name)
            ids = list({p.get("id") for p in payload.get("data", [])
                        if isinstance(p, dict)})
            my_account_id = ids[0] if ids else None
        except Exception as e:
            return {"polling": "error", "tenantId": tenant_id,
                    "errors": [f"player-lookup: {e}"]}
        if not my_account_id:
            return {"polling": "error", "tenantId": tenant_id,
                    "errors": ["account-id-unknown"]}

    m_stats = run_single_tick(conn, tenant_id, client, creds.pubg_name,
                              my_account_id, match_max)
    l_stats = refresh_lifetimes(conn, tenant_id, client, lifetime_min,
                                lifetime_max)
    try:
        s_stats = refresh_seasons(conn, tenant_id, client, lifetime_min,
                                  lifetime_max)
    except Exception as e:
        s_stats = {"refreshed": 0, "errors": [f"season-batch: {e}"],
                   "seasonId": None}
    try:
        b_stats = backfill_missing_seasons(conn, tenant_id, client,
                                            max_per_tick=1)
    except Exception as e:
        b_stats = {"backfilled": 0, "errors": [f"season-backfill: {e}"]}
    try:
        t_stats = process_telemetry_backlog(conn, tenant_id, client,
                                             my_account_id, 3)
    except Exception as e:
        t_stats = {"processed": 0, "errors": [f"telemetry-batch: {e}"]}

    all_errors = (m_stats["errors"] + l_stats["errors"] + s_stats["errors"]
                  + b_stats["errors"] + t_stats["errors"])
    return {
        "polling": "ok" if not all_errors else "degraded",
        "tenantId": tenant_id,
        "errors": all_errors,
        "newMatches": m_stats["new_matches"],
        "lifetimeRefreshed": l_stats["refreshed"],
        "seasonRefreshed": s_stats["refreshed"],
        "seasonBackfilled": b_stats["backfilled"],
        "currentSeasonId": s_stats.get("seasonId"),
        "telemetryProcessed": t_stats["processed"],
    }


def run(client_factory, match_max: int = 5, lifetime_min: int = 5,
        lifetime_max: int = 3) -> dict:
    """Single polling pass ueber ALLE Tenants. Returns Dict mit
    per-Tenant-Stats."""
    pg_conn = core_db.connect()
    conn = SqliteCompatConn(pg_conn)
    out = {"perTenant": {}, "errors": []}
    try:
        tenant_ids = _list_tenant_ids(conn)
        for tid in tenant_ids:
            try:
                out["perTenant"][tid] = poll_tenant(
                    conn, tid, client_factory,
                    match_max=match_max,
                    lifetime_min=lifetime_min,
                    lifetime_max=lifetime_max,
                )
            except Exception as e:
                out["errors"].append(f"tenant {tid}: {e}")
    finally:
        conn.close()
    out["lastPollAt"] = _iso_utc_now()
    return out


# ---------------------------------------------------------------------------
# PollerThread — Background-Loop fuer serve.py
# ---------------------------------------------------------------------------

class PollerThread(threading.Thread):
    """Hintergrund-Thread, der run() alle `interval_secs` aufruft.

    Anders als frueher (per-Streamer-Konfiguration) iteriert run() alle
    Tenants aus der DB; Credentials kommen pro Tenant aus dem Vault.
    """
    def __init__(self, client_factory, interval_secs=60,
                 lifetime_min_matches=5, lifetime_max_per_tick=3,
                 match_max_per_tick=5, cache=None):
        super().__init__(daemon=True, name="pubg-poller")
        self.client_factory = client_factory
        self.interval = interval_secs
        self.lifetime_min = lifetime_min_matches
        self.lifetime_max = lifetime_max_per_tick
        self.match_max = match_max_per_tick
        self.cache = cache
        self._stop = threading.Event()
        self._last_status = {"polling": "starting", "lastPollAt": None,
                              "perTenant": {}, "errors": []}

    def run(self):
        while not self._stop.is_set():
            try:
                status = run(
                    self.client_factory,
                    match_max=self.match_max,
                    lifetime_min=self.lifetime_min,
                    lifetime_max=self.lifetime_max,
                )
                # Achievements + Cache-Invalidate, wenn irgendwo neue
                # Matches/Telemetries dazukamen.
                any_change = any(
                    (t.get("newMatches", 0) > 0
                     or t.get("telemetryProcessed", 0) > 0)
                    for t in status.get("perTenant", {}).values())
                if any_change and self.cache is not None:
                    try:
                        self.cache.invalidate()
                    except Exception:
                        pass
                self._last_status = status
            except Exception as e:
                self._last_status = {"polling": "error", "errors": [str(e)],
                                     "lastPollAt": _iso_utc_now()}
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()

    def status(self):
        return dict(self._last_status)
