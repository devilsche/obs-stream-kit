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

# Sentinel-Wert in player_clans.updated_at fuer "noch nicht verarbeitet"
# (= im Queue). Schema-Constraint NOT NULL → echtes NULL geht nicht.
QUEUE_SENTINEL = "1970-01-01T00:00:00Z"

#: Ab wie vielen gesehenen Matches ein fremder Lobby-Spieler es wert ist,
#: aufgeloest zu werden. Gemessen an den Prod-Daten: 76.416 Spieler wurden
#: genau EINMAL gesehen, 15.972 mindestens dreimal, 4.186 mindestens fuenfmal.
#: Jeder davon kostet einen API-Call aus einem Budget von 10 pro Minute, das
#: sich der Match-Poller teilt — die Warteschlange stand bei 50.730 Accounts
#: und damit auf Wochen Dauerlast. Wer fuenfmal in unserer Lobby war, ist ein
#: Stammgast; der Rest bringt ein Clan-Tag, das nie jemand sieht.
MIN_SEEN_MATCHES = 5

#: Spieler, die wir aufloesen: eigener Squad (steht in participants) oder oft
#: genug gesehen. Als Sub-Query formuliert, damit Aufrufer sie in ihr eigenes
#: Statement einsetzen koennen.
_RELEVANT_SQL = """
    EXISTS (SELECT 1 FROM participants p
            WHERE p.account_id = {col})
    OR EXISTS (SELECT 1 FROM match_team_mapping mtm
               WHERE mtm.account_id = {col}
               GROUP BY mtm.account_id
               HAVING COUNT(DISTINCT mtm.match_id) >= ?)
"""


def _now_iso() -> str:
    return _dt.datetime.now(_dt.UTC).isoformat().replace("+00:00", "Z")


def is_bot(account_id) -> bool:
    """Bot-Accounts (`ai.`-Praefix) kennt die PUBG-API nicht: jede Abfrage
    darauf kostet ein Rate-Limit-Budget und kommt als 400 zurueck."""
    return isinstance(account_id, str) and account_id.startswith("ai.")


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
    if is_bot(account_id):
        return None
    cur_clan, updated_at = get_cached_player_clan(conn, account_id)
    if not force_refresh and not _is_stale(updated_at):
        return cur_clan
    if client is None:
        return cur_clan  # kein Client → stale Wert lieber als nichts
    try:
        data = client.get_player_by_id(account_id)
    except Exception as e:
        # 4xx heisst: den Account gibt es so nicht (geloescht, Bot, falsche
        # Plattform). Ohne Vermerk bliebe er in der Warteschlange und wuerde
        # in JEDEM Tick erneut abgefragt — das frisst das Budget, das der
        # Match-Poller braucht. 429 und 5xx sind voruebergehend und bleiben
        # in der Schlange.
        status = getattr(e, "status", None)
        if isinstance(status, int) and 400 <= status < 500 and status != 429:
            _mark_unresolvable(conn, account_id)
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


def _mark_unresolvable(conn, account_id: str) -> None:
    """Account als "kein Clan, heute geprueft" ablegen — er faellt damit aus
    der Warteschlange und wird erst nach der Cache-Frist wieder angefasst."""
    conn.execute(
        "INSERT INTO player_clans (account_id, clan_id, updated_at) "
        "VALUES (?, NULL, ?) "
        "ON CONFLICT (account_id) DO UPDATE SET updated_at = EXCLUDED.updated_at",
        (account_id, _now_iso()))
    try:
        conn.commit()
    except Exception:
        pass


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


def enqueue_unknown(conn, account_ids, min_seen: int = MIN_SEEN_MATCHES) -> int:
    """Reiht Accounts zur Clan-Aufloesung ein — aber nur die, die es wert sind.

    Frueher landete die komplette Lobby (93 Spieler je Match) in der Schlange;
    die meisten davon sieht man nie wieder. Jetzt kommt rein, wer im eigenen
    Squad war oder mindestens `min_seen` Matches lang aufgetaucht ist.

    Idempotent via ON CONFLICT DO NOTHING — vorhandene Mappings bleiben.
    Returns Anzahl neu eingereihter Accounts.
    """
    n = 0
    for acc in account_ids:
        if not acc or is_bot(acc):
            continue
        if not _is_relevant(conn, acc, min_seen):
            continue
        conn.execute(
            "INSERT INTO player_clans (account_id, clan_id, updated_at) "
            "VALUES (?, NULL, ?) "
            "ON CONFLICT (account_id) DO NOTHING",
            (acc, QUEUE_SENTINEL))
        n += 1
    try:
        conn.commit()
    except Exception:
        pass
    return n


def _is_relevant(conn, account_id: str, min_seen: int) -> bool:
    row = conn.execute(
        "SELECT 1 AS ok WHERE " + _RELEVANT_SQL.format(col="?"),
        (account_id, account_id, min_seen)).fetchone()
    return bool(row)


def prune_queue(conn, min_seen: int = MIN_SEEN_MATCHES) -> int:
    """Raeumt die OFFENE Warteschlange: alles raus, was weder Squad noch
    Stammgast ist. Schon aufgeloeste Eintraege bleiben — die sind bezahlte
    API-Calls und werden nicht weggeworfen.

    Returns Anzahl geloeschter Zeilen.
    """
    before = conn.execute(
        "SELECT COUNT(*) AS n FROM player_clans WHERE updated_at = ?",
        (QUEUE_SENTINEL,)).fetchone()
    conn.execute(
        "DELETE FROM player_clans pc WHERE pc.updated_at = ? AND NOT ("
        + _RELEVANT_SQL.format(col="pc.account_id") + ")",
        (QUEUE_SENTINEL, min_seen))
    after = conn.execute(
        "SELECT COUNT(*) AS n FROM player_clans WHERE updated_at = ?",
        (QUEUE_SENTINEL,)).fetchone()
    try:
        conn.commit()
    except Exception:
        pass
    return int((before or {"n": 0})["n"]) - int((after or {"n": 0})["n"])


def process_queue(conn, client, max_count: int = 3,
                  min_seen: int = MIN_SEEN_MATCHES) -> int:
    """Drip-feed Worker: pickt max_count noch-nie-aufgeloeste Accounts
    aus player_clans (updated_at IS NULL) und fetched player+clan-Info.

    Rate-Limit-konform: pro Call = 1-2 API-Requests, also max ~6/Tick.
    Wird vom PollerThread pro Tenant pro Tick aufgerufen → spreads
    workload ueber mehrere Tenants und Ticks."""
    if client is None:
        return 0
    # Order: neueste Matches zuerst. Spieler die im letzten Spiel
    # auftauchten kriegen ihre Clan-Tags als erstes — dort liegt
    # die UI-Aufmerksamkeit. Alte Backlog-Accounts spaeter.
    # NULLS LAST: Accounts ohne Match-Reference ans Ende.
    rows = conn.execute(
        "SELECT pc.account_id FROM player_clans pc "
        "JOIN ("
        "  SELECT mtm.account_id, MAX(m.played_at) AS last_seen, "
        "         COUNT(DISTINCT mtm.match_id) AS seen "
        "  FROM match_team_mapping mtm "
        "  JOIN matches m ON m.match_id = mtm.match_id "
        "    AND m.tenant_id = mtm.tenant_id "
        "  GROUP BY mtm.account_id"
        ") lp ON lp.account_id = pc.account_id "
        "WHERE pc.updated_at = ? AND pc.account_id NOT LIKE 'ai.%' "
        "  AND (lp.seen >= ? OR EXISTS (SELECT 1 FROM participants p "
        "                               WHERE p.account_id = pc.account_id)) "
        "ORDER BY lp.last_seen DESC "
        "LIMIT ?",
        (QUEUE_SENTINEL, min_seen, max_count)).fetchall()
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
