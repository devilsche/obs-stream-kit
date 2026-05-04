import datetime
from pubg.db import get_setting


def _session_filter(conn):
    started_at = get_setting(conn, "sessionStartedAt")
    return started_at or "1970-01-01T00:00:00Z"


def _range_filter(conn, range_key):
    if range_key == "session":
        return _session_filter(conn)
    if range_key == "day":
        d = datetime.datetime.utcnow().strftime("%Y-%m-%dT00:00:00Z")
        return d
    if range_key == "week":
        d = (datetime.datetime.utcnow() - datetime.timedelta(days=7)) \
              .strftime("%Y-%m-%dT00:00:00Z")
        return d
    return "1970-01-01T00:00:00Z"


def compute_session_stats(conn, my_account_id: str) -> dict:
    started = _session_filter(conn)
    rows = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at,
               pa.kills, pa.damage_dealt, pa.place, pa.headshot_kills,
               pa.longest_kill, pa.boosts, pa.heals, pa.revives,
               pa.weapons_acquired, pa.walk_distance, pa.ride_distance,
               pa.swim_distance, pa.assists, pa.dbnos, pa.time_survived
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, started)).fetchall()

    kills = sum(r["kills"] or 0 for r in rows)
    headshots = sum(r["headshot_kills"] or 0 for r in rows)
    damage = sum(r["damage_dealt"] or 0.0 for r in rows)
    wins = sum(1 for r in rows if (r["place"] or 99) == 1)
    top10s = sum(1 for r in rows if (r["place"] or 99) <= 10)
    best_place = min((r["place"] for r in rows if r["place"]), default=None)
    longest = max((r["longest_kill"] or 0.0 for r in rows), default=0.0)
    boosts = sum(r["boosts"] or 0 for r in rows)
    heals = sum(r["heals"] or 0 for r in rows)
    revives = sum(r["revives"] or 0 for r in rows)
    weapons = sum(r["weapons_acquired"] or 0 for r in rows)
    walk_m = sum(r["walk_distance"] or 0.0 for r in rows)
    ride_m = sum(r["ride_distance"] or 0.0 for r in rows)
    swim_m = sum(r["swim_distance"] or 0.0 for r in rows)
    assists = sum(r["assists"] or 0 for r in rows)
    dbnos = sum(r["dbnos"] or 0 for r in rows)
    survived_sec = sum(r["time_survived"] or 0 for r in rows)

    map_breakdown = {}
    for r in rows:
        m = r["map_name"]
        map_breakdown[m] = map_breakdown.get(m, 0) + 1

    return {
        "matches": len(rows),
        "kills": kills,
        "damage": damage,
        "wins": wins,
        "top10s": top10s,
        "kd": kills / max(len(rows) - wins, 1),
        "kpm": kills / max(len(rows), 1),
        "headshotPct": (headshots / kills * 100) if kills else 0,
        "bestPlace": best_place,
        "longestKill": longest,
        "totalBoosts": boosts,
        "totalHeals": heals,
        "totalRevives": revives,
        "totalWeaponsAcquired": weapons,
        "totalAssists": assists,
        "totalDbnos": dbnos,
        "totalSurvivedSec": survived_sec,
        "walkKm": walk_m / 1000.0,
        "rideKm": ride_m / 1000.0,
        "swimKm": swim_m / 1000.0,
        "sessionStartedAt": started,
        "mapBreakdown": [{"map": m, "count": c}
                         for m, c in sorted(map_breakdown.items(),
                                            key=lambda x: -x[1])],
    }


def compute_last_match(conn, my_account_id: str):
    row = conn.execute("""
        SELECT m.* FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ?
        ORDER BY m.played_at DESC LIMIT 1
    """, (my_account_id,)).fetchone()
    if not row:
        return None
    parts = conn.execute(
        "SELECT * FROM participants WHERE match_id = ?", (row["match_id"],)
    ).fetchall()
    me = next((p for p in parts if p["account_id"] == my_account_id), None)
    mates = [p for p in parts if p["account_id"] != my_account_id]
    return {
        "matchId": row["match_id"],
        "map": row["map_name"],
        "mode": row["game_mode"],
        "place": me["place"] if me else None,
        "durationSec": row["duration_secs"],
        "playedAt": row["played_at"],
        "myStats": dict(me) if me else None,
        "mates": [{"name": p["name"], "accountId": p["account_id"],
                   "stats": dict(p)} for p in mates],
    }


SORT_KEYS = {
    "avgPlace": "avg_place ASC",
    "kd": "kd DESC",
    "winRate": "win_rate DESC",
    "mostPlayed": "shared DESC",
}


def compute_top_mates(conn, my_account_id: str,
                      sort_by: str = "avgPlace",
                      limit: int = 5,
                      min_matches: int = 10) -> list:
    order = SORT_KEYS.get(sort_by, SORT_KEYS["avgPlace"])
    rows = conn.execute(f"""
        WITH co AS (
            SELECT mate.account_id, mate.name, mate.match_id, mate.place,
                   me.kills AS my_kills, me.damage_dealt AS my_dmg
            FROM participants mate
            JOIN participants me ON me.match_id = mate.match_id AND me.account_id = ?
            WHERE mate.account_id != ?
        )
        SELECT account_id, name,
               COUNT(*) AS shared,
               AVG(place) AS avg_place,
               (CAST(SUM(my_kills) AS REAL) / MAX(COUNT(*) - SUM(CASE WHEN place=1 THEN 1 ELSE 0 END), 1)) AS kd,
               AVG(my_dmg) AS avg_dmg,
               (CAST(SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS win_rate
        FROM co
        GROUP BY account_id, name
        HAVING shared >= ?
        ORDER BY {order}
        LIMIT ?
    """, (my_account_id, my_account_id, min_matches, limit)).fetchall()

    return [{
        "accountId": r["account_id"],
        "name": r["name"],
        "sharedMatches": r["shared"],
        "avgPlace": r["avg_place"],
        "kd": r["kd"],
        "avgDmg": r["avg_dmg"],
        "winRate": r["win_rate"],
    } for r in rows]


def compute_co_player(conn, my_account_id: str, name_or_id: str) -> dict:
    p = conn.execute("""
        SELECT * FROM players WHERE name = ? OR account_id = ? LIMIT 1
    """, (name_or_id, name_or_id)).fetchone()
    if not p:
        return {"error": "player not found"}

    shared = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at, mate.place,
               mate.kills, mate.damage_dealt
        FROM matches m
        JOIN participants mate ON mate.match_id = m.match_id
        JOIN participants me ON me.match_id = m.match_id AND me.account_id = ?
        WHERE mate.account_id = ?
        ORDER BY m.played_at DESC
    """, (my_account_id, p["account_id"])).fetchall()

    if not shared:
        history = {"matches": 0}
    else:
        n = len(shared)
        wins = sum(1 for r in shared if (r["place"] or 99) == 1)
        kills = sum(r["kills"] or 0 for r in shared)
        avg_dmg = sum(r["damage_dealt"] or 0.0 for r in shared) / n
        avg_place = sum(r["place"] for r in shared if r["place"]) / n
        deaths = max(n - wins, 1)
        map_dist = {}
        for r in shared:
            map_dist[r["map_name"]] = map_dist.get(r["map_name"], 0) + 1
        history = {
            "matches": n,
            "kd": kills / deaths,
            "avgDmg": avg_dmg,
            "avgPlace": avg_place,
            "winRate": (wins / n) * 100,
            "wins": wins,
            "mapDistribution": [{"map": m, "count": c}
                                for m, c in sorted(map_dist.items(),
                                                    key=lambda x: -x[1])],
            "last5Matches": [{
                "matchId": r["match_id"], "map": r["map_name"],
                "playedAt": r["played_at"], "place": r["place"],
                "kills": r["kills"], "damage": r["damage_dealt"],
            } for r in shared[:5]],
        }

    lifetime = conn.execute(
        "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = 'all'",
        (p["account_id"],)
    ).fetchone()

    return {
        "name": p["name"],
        "accountId": p["account_id"],
        "sharedHistory": history,
        "careerLifetime": dict(lifetime) if lifetime else None,
    }


def compute_mates_today(conn, my_account_id: str,
                        range_key: str = "session",
                        min_total_matches: int = 1) -> list:
    """Mates aktiv im range. Optional Filter: nur Mates mit >= min_total_matches
    Total-Historie mit dir (Random-Squad-Filler raus)."""
    cutoff = _range_filter(conn, range_key)
    rows = conn.execute("""
        SELECT mate.account_id, mate.name,
               COUNT(*) AS shared,
               AVG(mate.kills) AS kills_avg,
               SUM(mate.kills) AS kills_total,
               AVG(mate.damage_dealt) AS dmg_avg,
               (SELECT COUNT(*) FROM participants p2
                JOIN participants me2 ON me2.match_id = p2.match_id
                WHERE p2.account_id = mate.account_id AND me2.account_id = ?) AS total_with_me
        FROM participants mate
        JOIN participants me ON me.match_id = mate.match_id AND me.account_id = ?
        JOIN matches m ON m.match_id = mate.match_id
        WHERE mate.account_id != ? AND m.played_at >= ?
        GROUP BY mate.account_id, mate.name
        HAVING total_with_me >= ?
        ORDER BY shared DESC
    """, (my_account_id, my_account_id, my_account_id, cutoff,
          min_total_matches)).fetchall()

    out = []
    for r in rows:
        lt = conn.execute(
            "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = 'all'",
            (r["account_id"],)).fetchone()
        out.append({
            "accountId": r["account_id"],
            "name": r["name"],
            "sharedMatchesToday": r["shared"],
            "totalWithMe": r["total_with_me"],
            "kdToday": (r["kills_total"] / max(r["shared"], 1)),
            "dmgToday": r["dmg_avg"],
            "careerLifetime": dict(lt) if lt else None,
        })
    return out


def compute_map_distribution(conn, my_account_id, range_key="session"):
    cutoff = _range_filter(conn, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    rows = conn.execute("""
        SELECT m.map_name,
               COUNT(*) AS cnt,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               AVG(pa.place) AS avg_place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        GROUP BY m.map_name
        ORDER BY cnt DESC
    """, (my_account_id, cutoff)).fetchall()
    return [{"map": r["map_name"], "count": r["cnt"],
             "wins": r["wins"], "avgPlace": r["avg_place"]} for r in rows]


def compute_first_fight_rate(conn, my_account_id, range_key="session"):
    cutoff = _range_filter(conn, range_key)
    matches = conn.execute("""
        SELECT m.match_id FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff)).fetchall()

    total = 0
    survived = 0
    sparkline = []
    for m in matches:
        events = conn.execute("""
            SELECT event_type, timestamp_ms, actor_account, target_account
            FROM telemetry_events
            WHERE match_id = ? ORDER BY timestamp_ms ASC
        """, (m["match_id"],)).fetchall()
        if not events:
            continue
        landing = next((e for e in events if e["event_type"] == "Landing"
                        and e["actor_account"] == my_account_id), None)
        if not landing:
            continue
        window_end = (landing["timestamp_ms"] or 0) + 120 * 1000
        engagements = [e for e in events
                       if e["event_type"] in ("Kill", "TakeDamage")
                       and (e["timestamp_ms"] or 0) >= (landing["timestamp_ms"] or 0)
                       and (e["timestamp_ms"] or 0) <= window_end
                       and (e["actor_account"] == my_account_id
                            or e["target_account"] == my_account_id)]
        if not engagements:
            continue
        first = engagements[0]
        died = any(e["event_type"] == "Kill"
                   and e["target_account"] == my_account_id
                   and (e["timestamp_ms"] or 0) <= (first["timestamp_ms"] or 0) + 60000
                   for e in events)
        total += 1
        if not died:
            survived += 1
            sparkline.append(1)
        else:
            sparkline.append(0)
    return {
        "rate": (survived / total * 100) if total else 0,
        "survived": survived,
        "total": total,
        "sparkline": sparkline[-20:],
    }


def compute_squad_compare(conn, my_account_id, player_names, last_n=5):
    targets = [n.strip() for n in player_names if n.strip()]
    if not targets:
        return {"players": [], "matchTable": []}

    rows = conn.execute(f"""
        SELECT p.account_id, p.name FROM players p
        WHERE p.name IN ({",".join(["?"]*len(targets))})
    """, targets).fetchall()
    name_to_acc = {r["name"]: r["account_id"] for r in rows}

    cutoff_q = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ?
        ORDER BY m.played_at DESC LIMIT ?
    """, (my_account_id, last_n)).fetchall()

    table = []
    for mid_row in cutoff_q:
        cells = {}
        for name in targets:
            acc = name_to_acc.get(name)
            if not acc:
                cells[name] = None
                continue
            p = conn.execute("""
                SELECT kills, damage_dealt, place
                FROM participants WHERE match_id = ? AND account_id = ?
            """, (mid_row["match_id"], acc)).fetchone()
            cells[name] = dict(p) if p else None
        table.append({"matchId": mid_row["match_id"],
                      "map": mid_row["map_name"],
                      "playedAt": mid_row["played_at"],
                      "cells": cells})
    return {"players": targets, "matchTable": table}
