"""Clan-Enrichment fuer PUBG-Player.

PUBG-Telemetrie enthaelt keinen Clan. Die Info kommt via separater API:
  /players/{accountId}  → liefert clanId in attributes
  /clans/{clanId}       → tag, name, level, member_count

Globaler 7-Tage-Cache in obs.player_clans + obs.clans (tenant-uebergreifend
identisch, weil clanId universell ist). Reduziert API-Calls massiv: ein
neuer Player wird einmal global aufgeloest, danach reuse fuer alle Tenants.

Usage:
    from pubg.clan_enrichment import ensure_player_clan, ensure_clan
    clan_id = ensure_player_clan(conn, client, account_id)
    clan = ensure_clan(conn, client, clan_id)  # → dict mit tag/name/...
"""
import datetime as _dt


CACHE_TTL_DAYS = 7


def _now_iso() -> str:
    return _dt.datetime.now(_dt.UTC).isoformat().replace("+00:00", "Z")


def _is_stale(updated_at: str | None) -> bool:
    if not updated_at:
        return True
    try:
        ts = _dt.datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    age = _dt.datetime.now(_dt.UTC) - ts
    return age.days >= CACHE_TTL_DAYS


def get_cached_player_clan(conn, account_id: str) -> tuple[str | None, str | None]:
    """Liest player_clans-Row. Returns (clan_id, updated_at) oder (None, None)."""
    row = conn.execute(
        "SELECT clan_id, updated_at FROM player_clans WHERE account_id = ?",
        (account_id,)).fetchone()
    if not row:
        return None, None
    return row["clan_id"], row["updated_at"]


def get_cached_clan(conn, clan_id: str) -> dict | None:
    """Liest clans-Row. Returns dict mit allen Feldern oder None."""
    row = conn.execute(
        "SELECT clan_id, clan_tag, clan_name, clan_level, member_count, "
        "updated_at FROM clans WHERE clan_id = ?",
        (clan_id,)).fetchone()
    if not row:
        return None
    return dict(row)


def ensure_player_clan(conn, client, account_id: str,
                        force_refresh: bool = False) -> str | None:
    """Liefert die clan_id fuer einen Player. Cached 7d. Returns None wenn
    der Spieler in keinem Clan ist."""
    cur_clan, updated_at = get_cached_player_clan(conn, account_id)
    if not force_refresh and not _is_stale(updated_at):
        return cur_clan
    if client is None:
        return cur_clan  # kein Client → stale Wert lieber als nichts
    try:
        data = client.get_player_by_id(account_id)
    except Exception:
        return cur_clan
    attrs = ((data.get("data") or {}).get("attributes")) or {}
    new_clan_id = attrs.get("clanId") or None
    now = _now_iso()
    conn.execute(
        "INSERT INTO player_clans (account_id, clan_id, updated_at) "
        "VALUES (?, ?, ?) "
        "ON CONFLICT (account_id) DO UPDATE SET "
        "clan_id = EXCLUDED.clan_id, updated_at = EXCLUDED.updated_at",
        (account_id, new_clan_id, now))
    try:
        conn.commit()
    except Exception:
        pass
    return new_clan_id


def ensure_clan(conn, client, clan_id: str,
                 force_refresh: bool = False) -> dict | None:
    """Liefert das Clan-Dict (tag, name, level, member_count) fuer clan_id.
    Cached 7d. Returns None bei API-Fehler ohne Cache-Eintrag."""
    if not clan_id:
        return None
    cached = get_cached_clan(conn, clan_id)
    if cached and not force_refresh and not _is_stale(cached.get("updated_at")):
        return cached
    if client is None:
        return cached
    try:
        data = client.get_clan(clan_id)
    except Exception:
        return cached
    attrs = ((data.get("data") or {}).get("attributes")) or {}
    row = {
        "clan_id":      clan_id,
        "clan_tag":     attrs.get("clanTag"),
        "clan_name":    attrs.get("clanName"),
        "clan_level":   attrs.get("clanLevel"),
        "member_count": attrs.get("clanMemberCount"),
        "updated_at":   _now_iso(),
    }
    conn.execute(
        "INSERT INTO clans (clan_id, clan_tag, clan_name, clan_level, "
        "member_count, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (clan_id) DO UPDATE SET "
        "clan_tag = EXCLUDED.clan_tag, clan_name = EXCLUDED.clan_name, "
        "clan_level = EXCLUDED.clan_level, "
        "member_count = EXCLUDED.member_count, "
        "updated_at = EXCLUDED.updated_at",
        (row["clan_id"], row["clan_tag"], row["clan_name"],
         row["clan_level"], row["member_count"], row["updated_at"]))
    try:
        conn.commit()
    except Exception:
        pass
    return row


def enqueue_unknown(conn, account_ids) -> int:
    """Schreibt NULL-Rows in player_clans fuer noch unbekannte Accounts.
    Diese werden vom Background-Worker (process_queue) abgearbeitet.
    Idempotent via ON CONFLICT DO NOTHING — vorhandene Mappings bleiben.
    Returns Anzahl neu enqueued."""
    n = 0
    for acc in account_ids:
        if not acc:
            continue
        cur = conn.execute(
            "INSERT INTO player_clans (account_id, clan_id, updated_at) "
            "VALUES (?, NULL, NULL) "
            "ON CONFLICT (account_id) DO NOTHING",
            (acc, ))
        # psycopg2 cursor.rowcount nicht ueber alle Treiber zuverlaessig;
        # fuer simple Statistik genuegt es zu zaehlen wir versucht haben.
        n += 1
    try:
        conn.commit()
    except Exception:
        pass
    return n


def process_queue(conn, client, max_count: int = 3) -> int:
    """Drip-feed Worker: pickt max_count noch-nie-aufgeloeste Accounts
    aus player_clans (updated_at IS NULL) und fetched player+clan-Info.

    Rate-Limit-konform: pro Call = 1-2 API-Requests, also max ~6/Tick.
    Wird vom PollerThread pro Tenant pro Tick aufgerufen → spreads
    workload ueber mehrere Tenants und Ticks."""
    if client is None:
        return 0
    rows = conn.execute(
        "SELECT account_id FROM player_clans "
        "WHERE updated_at IS NULL "
        "ORDER BY RANDOM() LIMIT ?", (max_count,)).fetchall()
    accs = [r["account_id"] for r in rows]
    if not accs:
        return 0
    enrich_account_ids(conn, client, accs)
    return len(accs)


def enrich_account_ids(conn, client, account_ids: list) -> dict:
    """Bulk-Enrichment: fuer eine Liste account_ids beide Lookups
    durchziehen. Returns {account_id: clan_dict_or_None} — clan_dict enthaelt
    tag/name/etc. (None wenn Spieler keinen Clan hat).

    Rate-Limit-aware: pro Account max 2 API-Calls (player + clan), aber
    nur wenn Cache stale. Bei warmem Cache 0 Calls."""
    out = {}
    for acc in account_ids:
        if not acc:
            continue
        clan_id = ensure_player_clan(conn, client, acc)
        if not clan_id:
            out[acc] = None
            continue
        clan = ensure_clan(conn, client, clan_id)
        out[acc] = clan
    return out
