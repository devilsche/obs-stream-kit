"""K/D der laufenden Session als Stimmungsquelle für die Weather-Source.

Nur BR-Runden (Arcade wie Zombie/Heist verbiegt die K/D), über alle
verfolgten Accounts des Tenants zusammen, Formel wie der Session-Report:
kills / (Runden − Siege). Die Session gilt als laufend, solange die letzte
BR-Runde weniger als 4 h her ist.
"""
from datetime import datetime, timedelta, timezone

from pubg.aggregations import _br_filter, _session_filter
from pubg.db_pg import list_tracked_players

LIVE_HOURS = 4


def kd_snapshot(conn, tenant_id: int, now=None) -> dict:
    """→ {"kd", "matches", "live"}; conn ist SqliteCompatConn."""
    now = now or datetime.now(timezone.utc)
    accounts = [t["account_id"] for t in list_tracked_players(conn.raw, tenant_id)
                if t["account_id"]]
    empty = {"kd": 0.0, "matches": 0, "live": False}
    if not accounts:
        return empty
    started = _session_filter(conn, tenant_id)
    br_where, br_params = _br_filter("m")
    marks = ", ".join("?" for _ in accounts)
    rows = conn.execute(f"""
        SELECT m.played_at, pa.kills, pa.place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id IN ({marks}) AND m.played_at >= ?
          AND {br_where}
    """, (tenant_id, *accounts, started, *br_params)).fetchall()
    if not rows:
        return empty
    kills = sum(r["kills"] or 0 for r in rows)
    wins = sum(1 for r in rows if (r["place"] or 99) == 1)
    last = max(r["played_at"] for r in rows)
    cutoff = (now - timedelta(hours=LIVE_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"kd": round(kills / max(len(rows) - wins, 1), 2),
            "matches": len(rows),
            "live": last >= cutoff}
