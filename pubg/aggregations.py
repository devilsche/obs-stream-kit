import datetime
from pubg.db import get_setting


def _parse_iso(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _session_filter(conn):
    """Bestimmt den Session-Cutoff. Priorität:
    1. Wenn `sessionStartedAt` in settings explizit gesetzt → nimm den.
    2. Sonst auto-detect: gehe Match-Timestamps rückwärts durch.
       Erste Lücke > sessionGapHours (default 4h) zwischen zwei Matches
       → das ist der Session-Start.
    3. Wenn keine Lücke gefunden → alle Matches in DB sind eine Session."""
    started_at = get_setting(conn, "sessionStartedAt")
    if started_at and started_at > "1970-01-02":
        return started_at

    gap_hours = float(get_setting(conn, "sessionGapHours", "4"))
    rows = conn.execute(
        "SELECT played_at FROM matches ORDER BY played_at DESC LIMIT 200"
    ).fetchall()
    if not rows:
        return "1970-01-01T00:00:00Z"

    last_ts = None
    for r in rows:
        cur = _parse_iso(r["played_at"])
        if cur is None:
            continue
        if last_ts is not None:
            gap_secs = (last_ts - cur).total_seconds()
            if gap_secs > gap_hours * 3600:
                return last_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        last_ts = cur
    return rows[-1]["played_at"]


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


def compute_session_stats(conn, my_account_id: str,
                          range_key: str = "session") -> dict:
    if range_key == "session":
        started = _session_filter(conn)
        explicit = get_setting(conn, "sessionStartedAt")
        session_mode = "manual" if (explicit and explicit > "1970-01-02") else "auto"
    else:
        started = _range_filter(conn, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
        session_mode = range_key
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
        "sessionMode": session_mode,  # "manual" oder "auto"
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
    "avgPlace":          "avg_place ASC",
    "kd":                "kd DESC",                # meine K/D in gemeinsamen Matches
    "mateKd":            "mate_kd DESC",           # K/D des Mates
    "winRate":           "win_rate DESC",
    "mostPlayed":        "shared DESC",
    # Most Chicken: absolute Win-Anzahl primär, bei Gleichstand höhere
    # Win-Rate vor (mehr Effizienz pro Match besser als reine Match-Anzahl)
    "chickensTogether":  "wins DESC, win_rate DESC, shared DESC",
    # Composite — sortBy "synergy": KDA-Fokus, Win-Rate gewichtet, log(matches)
    # für Stabilität (1-Match-Glück bekommt nicht die Top-Position).
    # SQL macht das gleiche wie der Python-key in compute_top_mates Postprocess:
    "synergy":           "((kd + mate_kd)/2) * (1.0 + win_rate/100.0) DESC, shared DESC",
}


def compute_top_mates(conn, my_account_id: str,
                      sort_by: str = "avgPlace",
                      limit: int = 5,
                      min_matches: int = 10,
                      range_key: str = None) -> list:
    """range_key: None=alle DB-Matches; 'session'/'day'/'week' filtert."""
    order = SORT_KEYS.get(sort_by, SORT_KEYS["avgPlace"])
    if range_key:
        cutoff = _range_filter(conn, range_key)
        params = (my_account_id, cutoff, my_account_id, min_matches, limit)
        match_filter = "JOIN matches m ON m.match_id = mate.match_id AND m.played_at >= ?"
    else:
        params = (my_account_id, my_account_id, min_matches, limit)
        match_filter = ""
    rows = conn.execute(f"""
        WITH co AS (
            SELECT mate.account_id, mate.name, mate.match_id, mate.place,
                   me.kills AS my_kills, me.damage_dealt AS my_dmg,
                   mate.kills AS mate_kills, mate.damage_dealt AS mate_dmg
            FROM participants mate
            JOIN participants me ON me.match_id = mate.match_id AND me.account_id = ?
            {match_filter}
            WHERE mate.account_id != ?
        )
        SELECT account_id, name,
               COUNT(*) AS shared,
               AVG(place) AS avg_place,
               SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS wins,
               (CAST(SUM(my_kills) AS REAL) / MAX(COUNT(*) - SUM(CASE WHEN place=1 THEN 1 ELSE 0 END), 1)) AS kd,
               (CAST(SUM(mate_kills) AS REAL) / MAX(COUNT(*) - SUM(CASE WHEN place=1 THEN 1 ELSE 0 END), 1)) AS mate_kd,
               AVG(my_dmg) AS avg_dmg,
               AVG(mate_dmg) AS mate_avg_dmg,
               (CAST(SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS win_rate
        FROM co
        GROUP BY account_id, name
        HAVING shared >= ?
        ORDER BY {order}
        LIMIT ?
    """, params).fetchall()

    out = []
    for r in rows:
        my_kd = r["kd"] or 0
        mate_kd = r["mate_kd"] or 0
        win_rate = r["win_rate"] or 0
        # Synergy = Team-KDA × Win-Rate-Bonus.
        # KEIN Stability-Faktor — der minMatches-Filter kümmert sich um
        # Glücks-Stats. Konsistent mit SQL-Sort und anderen Widgets.
        synergy = ((my_kd + mate_kd) / 2.0) * (1.0 + win_rate / 100.0)
        out.append({
            "accountId":       r["account_id"],
            "name":            r["name"],
            "sharedMatches":   r["shared"],
            "winsTogether":    r["wins"],
            "avgPlace":        r["avg_place"],
            "kd":              my_kd,
            "mateKd":          mate_kd,
            "teamKd":          (my_kd + mate_kd) / 2.0,
            "avgDmg":          r["avg_dmg"],
            "mateAvgDmg":      r["mate_avg_dmg"],
            "winRate":         win_rate,
            "synergyScore":    synergy,
        })
    return out


def compute_co_player(conn, my_account_id: str, name_or_id: str) -> dict:
    p = conn.execute("""
        SELECT * FROM players WHERE name = ? OR account_id = ? LIMIT 1
    """, (name_or_id, name_or_id)).fetchone()
    if not p:
        return {"error": "player not found"}

    self_row = conn.execute(
        "SELECT name FROM players WHERE account_id = ? LIMIT 1", (my_account_id,)
    ).fetchone()
    my_name = self_row["name"] if self_row else "Self"

    if p["account_id"] == my_account_id:
        lifetime = conn.execute(
            "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = 'all'",
            (my_account_id,)
        ).fetchone()
        return {
            "name": p["name"],
            "myName": my_name,
            "accountId": p["account_id"],
            "isSelf": True,
            "sharedHistory": None,
            "careerLifetime": dict(lifetime) if lifetime else None,
        }

    shared = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at, mate.place,
               mate.kills AS mate_kills, mate.damage_dealt AS mate_damage,
               me.kills   AS my_kills,   me.damage_dealt   AS my_damage
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
        my_kills = sum(r["my_kills"] or 0 for r in shared)
        mate_kills = sum(r["mate_kills"] or 0 for r in shared)
        my_avg_dmg = sum(r["my_damage"] or 0.0 for r in shared) / n
        mate_avg_dmg = sum(r["mate_damage"] or 0.0 for r in shared) / n
        avg_place = sum(r["place"] for r in shared if r["place"]) / n
        deaths = max(n - wins, 1)
        map_dist = {}
        for r in shared:
            map_dist[r["map_name"]] = map_dist.get(r["map_name"], 0) + 1
        history = {
            "matches": n,
            "kd": my_kills / deaths,           # MEINE K/D in shared matches
            "mateKd": mate_kills / deaths,     # MATE-K/D in shared matches
            "avgDmg": my_avg_dmg,              # MEINER avg dmg
            "mateAvgDmg": mate_avg_dmg,        # MATE avg dmg
            "avgPlace": avg_place,
            "winRate": (wins / n) * 100,
            "wins": wins,
            "mapDistribution": [{"map": m, "count": c}
                                for m, c in sorted(map_dist.items(),
                                                    key=lambda x: -x[1])],
            "last5Matches": [{
                "matchId": r["match_id"], "map": r["map_name"],
                "playedAt": r["played_at"], "place": r["place"],
                "kills": r["mate_kills"],     # Mate kills im Match
                "damage": r["mate_damage"],
                "myKills": r["my_kills"],
                "myDamage": r["my_damage"],
            } for r in shared[:5]],
        }

    lifetime = conn.execute(
        "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = 'all'",
        (p["account_id"],)
    ).fetchone()

    return {
        "name": p["name"],
        "myName": my_name,
        "accountId": p["account_id"],
        "sharedHistory": history,
        "careerLifetime": dict(lifetime) if lifetime else None,
    }


def compute_mates(conn, my_account_id: str,
                        range_key: str = "session",
                        min_matches: int = 1,
                        min_total: int = 1) -> list:
    """Mates aktiv im range.
    - min_matches: Mindest-Anzahl Matches IN DER RANGE (z.B. ≥3 in der Woche)
    - min_total:   Mindest-Anzahl Matches LIFETIME (Random-Squad rausfiltern)
    """
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
        HAVING shared >= ? AND total_with_me >= ?
        ORDER BY shared DESC
    """, (my_account_id, my_account_id, my_account_id, cutoff,
          min_matches, min_total)).fetchall()

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


def compute_best_worst_map(conn, my_account_id, range_key="all", min_matches=3):
    """Liefert Best- und Worst-Map basierend auf K/D mit Mindest-Match-Schwelle."""
    cutoff = (_range_filter(conn, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")
    rows = conn.execute("""
        SELECT m.map_name,
               COUNT(*) AS n,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               SUM(pa.kills) AS kills,
               AVG(pa.damage_dealt) AS avg_dmg,
               AVG(pa.place) AS avg_place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        GROUP BY m.map_name
        HAVING n >= ?
    """, (my_account_id, cutoff, min_matches)).fetchall()
    if not rows:
        return {"best": None, "worst": None}

    def _kd(r):
        return (r["kills"] or 0) / max((r["n"] or 0) - (r["wins"] or 0), 1)

    enriched = [{
        "map": r["map_name"], "matches": r["n"], "wins": r["wins"],
        "kills": r["kills"], "kd": _kd(r),
        "avgDmg": r["avg_dmg"], "avgPlace": r["avg_place"],
    } for r in rows]
    best = max(enriched, key=lambda x: x["kd"])
    worst = min(enriched, key=lambda x: x["kd"])
    return {"best": best, "worst": worst}


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


def compute_session_matches(conn, my_account_id, range_key="session",
                             from_iso=None, to_iso=None):
    """Flache Liste der Matches in der Range — leichtgewichtig.
    Genutzt von Streak-Counter, Session-Goal, Achievements etc.
    from_iso/to_iso überschreiben range_key (für historische Sessions)."""
    if from_iso:
        cutoff = from_iso
        end_filter = " AND m.played_at <= ?" if to_iso else ""
        params = [my_account_id, cutoff]
        if to_iso:
            params.append(to_iso)
    else:
        cutoff = (_range_filter(conn, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        end_filter = ""
        params = [my_account_id, cutoff]
    rows = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.game_mode, m.played_at,
               m.duration_secs,
               pa.kills, pa.damage_dealt, pa.place, pa.time_survived,
               pa.longest_kill, pa.headshot_kills, pa.assists, pa.dbnos
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?{end_filter}
        ORDER BY m.played_at DESC
    """, params).fetchall()
    return [{
        "matchId":     r["match_id"],
        "map":         r["map_name"],
        "mode":        r["game_mode"],
        "playedAt":    r["played_at"],
        "durationSec": r["duration_secs"],
        "kills":       r["kills"] or 0,
        "damage":      r["damage_dealt"] or 0,
        "place":       r["place"],
        "survivedSec": r["time_survived"] or 0,
        "longestKill": r["longest_kill"] or 0,
        "headshots":   r["headshot_kills"] or 0,
        "assists":     r["assists"] or 0,
        "dbnos":       r["dbnos"] or 0,
    } for r in rows]


def compute_lobby_avg_kd(conn, my_account_id, range_key="session"):
    """Pro Match: Ø K/D aller ~60-100 Spieler in der Lobby.
    Plus Aggregat über Range. Idee: Lobby-Schwierigkeit messen.

    Lobby-K/D pro Match = SUM(kills) / max(SUM(deaths_proxy), 1)
    deaths_proxy: alle Teilnehmer minus Wins (#1) sind irgendwann gestorben,
    eine grobe Annäherung. Im Squad-Modus ist das nicht exakt, aber für
    Trend-Vergleiche zwischen Lobbys ausreichend.

    Liefert: {avg, my_kd, diff, perMatch: [{matchId, playedAt, lobbyKd, myKd}]}
    """
    cutoff = (_range_filter(conn, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")

    rows = conn.execute("""
        SELECT m.match_id, m.played_at,
               SUM(p.kills)  AS lobby_kills,
               COUNT(*)      AS lobby_n,
               SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS lobby_wins
        FROM matches m
        JOIN participants p ON p.match_id = m.match_id
        WHERE m.match_id IN (
          SELECT match_id FROM participants WHERE account_id = ?
        ) AND m.played_at >= ?
        GROUP BY m.match_id
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff)).fetchall()

    per_match = []
    sum_lobby_kd = 0.0
    n = 0
    for r in rows:
        kills = r["lobby_kills"] or 0
        ln = r["lobby_n"] or 0
        wins = r["lobby_wins"] or 0
        deaths_proxy = max(ln - wins, 1)
        lobby_kd = kills / deaths_proxy
        my = conn.execute(
            "SELECT kills, place FROM participants "
            "WHERE match_id = ? AND account_id = ?",
            (r["match_id"], my_account_id),
        ).fetchone()
        my_kills = my["kills"] if my else 0
        my_kd = my_kills if (my and my["place"] == 1) else my_kills
        # my_kd vereinfacht: kills im Match. Echte K/D pro Match ist undefiniert
        # (1 Death max), darum führen wir hier "my kills in match" als Proxy.
        per_match.append({
            "matchId": r["match_id"],
            "playedAt": r["played_at"],
            "lobbyKd": lobby_kd,
            "myKills": my_kills,
        })
        sum_lobby_kd += lobby_kd
        n += 1

    avg_lobby_kd = (sum_lobby_kd / n) if n else 0
    # Eigene Session-K/D aus existierender Aggregation berechnen
    my_session = conn.execute("""
        SELECT SUM(p.kills) AS k, COUNT(*) AS n,
               SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w
        FROM participants p JOIN matches m ON m.match_id = p.match_id
        WHERE p.account_id = ? AND m.played_at >= ?
    """, (my_account_id, cutoff)).fetchone()
    my_k = (my_session and my_session["k"]) or 0
    my_n = (my_session and my_session["n"]) or 0
    my_w = (my_session and my_session["w"]) or 0
    my_kd_session = my_k / max(my_n - my_w, 1)

    return {
        "avg": avg_lobby_kd,
        "myKd": my_kd_session,
        "diff": my_kd_session - avg_lobby_kd,
        "matches": n,
        "perMatch": per_match,
    }


def compute_trend_deltas(conn, my_account_id, from_iso=None, to_iso=None,
                          gap_hours=4):
    """Vergleich gewählte Session vs. die direkt davor liegende Session.
    Wenn from_iso/to_iso None: aktuelle (= jüngste) Session.
    Sonst: Session deren [from,to]-Range from_iso enthält.

    Liefert Deltas für K/D, Wins, Avg-DMG, Matches.
    """
    sessions = compute_sessions_index(conn, my_account_id, gap_hours=gap_hours)
    if not sessions:
        return {"current": None, "previous": None, "deltas": None}

    def _agg(start, end):
        sql = """
            SELECT SUM(p.kills) AS k, COUNT(*) AS n,
                   SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w,
                   AVG(p.damage_dealt) AS avg_dmg
            FROM participants p JOIN matches m ON m.match_id = p.match_id
            WHERE p.account_id = ? AND m.played_at >= ?
        """
        params = [my_account_id, start]
        if end:
            sql += " AND m.played_at <= ?"
            params.append(end)
        r = conn.execute(sql, params).fetchone()
        n = (r and r["n"]) or 0
        w = (r and r["w"]) or 0
        k = (r and r["k"]) or 0
        return {
            "matches": n,
            "wins": w,
            "kd": k / max(n - w, 1),
            "avgDmg": (r and r["avg_dmg"]) or 0,
        }

    # Index der aktuellen Session in der Liste (sortiert: jüngste zuerst)
    cur_idx = 0
    if from_iso:
        # finde Session deren Range from_iso enthält
        for i, s in enumerate(sessions):
            if s["from"] <= from_iso <= s["to"]:
                cur_idx = i
                break
            if s["from"] == from_iso:
                cur_idx = i
                break
        else:
            # exakte Übereinstimmung von from_iso mit s["from"]
            for i, s in enumerate(sessions):
                if s["from"].startswith(from_iso[:19]):
                    cur_idx = i
                    break

    cur_session = sessions[cur_idx]
    cur_to = cur_session["to"] if cur_idx > 0 else None
    cur = _agg(cur_session["from"], cur_to)

    prev = None
    if cur_idx + 1 < len(sessions):
        prev_session = sessions[cur_idx + 1]
        prev = _agg(prev_session["from"], prev_session["to"])

    deltas = None
    if prev:
        deltas = {
            "kd":      cur["kd"] - prev["kd"],
            "wins":    cur["wins"] - prev["wins"],
            "avgDmg":  cur["avgDmg"] - prev["avgDmg"],
            "matches": cur["matches"] - prev["matches"],
        }
    return {"current": cur, "previous": prev, "deltas": deltas}


def compute_map_performance(conn, my_account_id, range_key="all"):
    """Pro Map: Matches, Wins, K/D, Ø Kills/DMG/Place/Surv.
    range_key: 'session' | 'day' | 'week' | 'all'."""
    cutoff = _range_filter(conn, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    rows = conn.execute("""
        SELECT m.map_name,
               COUNT(*) AS matches,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               SUM(pa.kills) AS kills,
               SUM(pa.damage_dealt) AS damage,
               AVG(pa.place) AS avg_place,
               AVG(pa.time_survived) AS avg_surv,
               MAX(pa.longest_kill) AS longest_kill
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        GROUP BY m.map_name
        ORDER BY matches DESC
    """, (my_account_id, cutoff)).fetchall()
    out = []
    for r in rows:
        n = r["matches"] or 0
        wins = r["wins"] or 0
        kills = r["kills"] or 0
        damage = r["damage"] or 0
        out.append({
            "map": r["map_name"],
            "matches": n,
            "wins": wins,
            "kills": kills,
            "damage": damage,
            "avgKills": (kills / n) if n else 0,
            "avgDamage": (damage / n) if n else 0,
            "avgPlace": r["avg_place"] or 0,
            "avgSurvivedSec": r["avg_surv"] or 0,
            "kd": kills / max(n - wins, 1),
            "winRate": (wins / n * 100) if n else 0,
            "longestKill": r["longest_kill"] or 0,
        })
    return out


def _ms_to_iso(ms):
    """Epoch-ms (von Telemetry) → ISO-Z-String."""
    if not ms:
        return None
    return datetime.datetime.fromtimestamp(
        ms / 1000, datetime.timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


def _compute_top10_reached_at(conn, match_id, my_account_id):
    """Liefert ISO-Timestamp (UTC), wann das Match Top-10 erreicht hat
    (= 10. Squad eliminiert wurde, also nur noch 10 Squads im Spiel).
    Falls Telemetry fehlt oder Match < 11 Squads: None.
    """
    parts = conn.execute("""
        SELECT account_id, team_id FROM participants WHERE match_id = ?
    """, (match_id,)).fetchall()
    if not parts:
        return None
    acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
    teams_alive = {}
    for p in parts:
        teams_alive.setdefault(p["team_id"], set()).add(p["account_id"])
    n_teams = len(teams_alive)
    if n_teams <= 10:
        return None
    threshold = n_teams - 10  # so viele Squads müssen tot sein

    events = conn.execute("""
        SELECT timestamp_ms, target_account FROM telemetry_events
        WHERE match_id = ? AND event_type = 'Kill'
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    if not events:
        return None

    eliminated_teams = 0
    for e in events:
        victim = e["target_account"]
        team_id = acc_to_team.get(victim)
        if team_id is None:
            continue
        members = teams_alive.get(team_id)
        if not members:
            continue
        members.discard(victim)
        if not members:
            eliminated_teams += 1
            if eliminated_teams >= threshold:
                return _ms_to_iso(e["timestamp_ms"])
    return None


def compute_session_achievements(conn, my_account_id, from_iso=None, to_iso=None):
    """Detected Achievements der aktuellen oder einer historischen Session.
    from_iso/to_iso optional — sonst aktuelle Session.

    Achievements (in dieser Reihenfolge angewendet, max. 1 pro Typ
    außer 'Beast Chicken' und 'Top-DMG' die mehrfach kommen können):
      - first_chicken     : erste #1 in der Session
      - first_top10       : erstes Match mit place <= 10
      - longest_kill_400  : Longest Kill >= 400m in einem Match
      - five_kill_match   : Match mit >= 5 Kills
      - beast_chicken     : place == 1 UND kills >= 5
      - hot_drop_survivor : Hot-Drop überlebt (per compute_hot_drop)
      - top10_streak_3    : 3 Matches in Folge place <= 10

    Returns Liste { id, label, icon, matchId, playedAt } sortiert
    nach playedAt ASC (Reihenfolge des Erreichens).
    """
    matches_desc = compute_session_matches(
        conn, my_account_id, "session",
        from_iso=from_iso, to_iso=to_iso)
    matches = list(reversed(matches_desc))  # ASC für Achievement-Reihenfolge

    out = []
    seen = set()
    win_seen = False
    top10_seen = False
    top10_streak = 0
    for m in matches:
        place = m["place"] or 99
        kills = m["kills"] or 0
        longest = m["longestKill"] or 0
        played = m["playedAt"]

        # 100 Einheiten = 1 Meter (Telemetry/PUBG-Welt)
        longest_m = longest if longest < 50 else longest / 100  # Fallback

        # Icon-Regel: nur 🔥 für 'geile' Achievements, sonst kein Icon.
        if not win_seen and place == 1:
            out.append({
                "id": "first_chicken",
                "label": "First Chicken!",
                "icon": "🔥",
                "matchId": m["matchId"], "playedAt": played,
            })
            win_seen = True
            seen.add("first_chicken")

        if not top10_seen and place <= 10:
            # playedAt = Zeitpunkt wo das Team Top-10 erreicht hat (10.
            # Squad eliminiert), nicht Match-Ende. Fallback auf Match-
            # Ende wenn Telemetry fehlt.
            top10_ts = _compute_top10_reached_at(conn, m["matchId"], my_account_id)
            out.append({
                "id": "first_top10",
                "label": "First Top-10",
                "icon": "",
                "matchId": m["matchId"], "playedAt": top10_ts or played,
            })
            top10_seen = True
            seen.add("first_top10")

        if longest_m >= 400 and "longest_kill_400" not in seen:
            out.append({
                "id": "longest_kill_400",
                "label": f"Longest Kill {int(longest_m)}m",
                "icon": "🔥",
                "matchId": m["matchId"], "playedAt": played,
            })
            seen.add("longest_kill_400")

        if kills >= 5 and "five_kill_match" not in seen:
            out.append({
                "id": "five_kill_match",
                "label": f"{kills}-Kill Match",
                "icon": "🔥",
                "matchId": m["matchId"], "playedAt": played,
            })
            seen.add("five_kill_match")

        if place == 1 and kills >= 5:
            out.append({
                "id": "beast_chicken_" + (m["matchId"] or ""),
                "label": f"Beast Chicken · {kills} Kills",
                "icon": "🔥",
                "matchId": m["matchId"], "playedAt": played,
            })

        if place <= 10:
            top10_streak += 1
            if top10_streak == 3 and "top10_streak_3" not in seen:
                out.append({
                    "id": "top10_streak_3",
                    "label": "Top-10 Streak ×3",
                    "icon": "🔥",
                    "matchId": m["matchId"], "playedAt": played,
                })
                seen.add("top10_streak_3")
        else:
            top10_streak = 0

    # Hot-Drop-Survivor: aus compute_hot_drop perMatch in Session
    try:
        hd = compute_hot_drop(conn, my_account_id, "session")
        for pm in (hd.get("perMatch") or []):
            if (pm.get("hotDrop") and pm.get("soloSurvived")
                    and "hot_drop_survivor" not in seen):
                out.append({
                    "id": "hot_drop_survivor",
                    "label": "Hot-Drop Survivor",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
                seen.add("hot_drop_survivor")
                break
    except Exception:
        pass

    out.sort(key=lambda a: a.get("playedAt") or "")
    return out


def compute_hot_drop(conn, my_account_id, range_key="session",
                     window_secs=180):
    """Hot-Drop-Stats über die Range.

    Definition Hot-Drop = im Match gab es ein Kill/Knock-Event in den
    ersten window_secs (Default 180s = 3 min) zwischen verschiedenen Teams,
    wo mein Squad als Attacker oder Victim beteiligt war.

    Pro Match Markierung:
      - hotDrop: ja/nein (Fight in ersten 180s mit Squad-Beteiligung)
      - soloSurvived: ja, wenn ich bei t = window_secs noch lebe
        (proxy: time_survived >= window_secs)
      - teamSurvived: ja, wenn mindestens ein Squad-Member bei t = 180s
        noch lebt (max(squad time_survived) >= window_secs)

    Aggregat:
      - rate: % der Matches mit Hot-Drop
      - soloSurvivalRate: von Hot-Drops, % wo ich überlebt habe
      - teamSurvivalRate: von Hot-Drops, % wo Team überlebt hat
      - streak: aktuelle Streak überlebter Hot-Drops (von neuestem Match
        rückwärts; Solo-Survival als Kriterium)
      - perMatch: Liste mit Match-Markern für Sparklines
    """
    cutoff = (_range_filter(conn, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")
    window_ms = window_secs * 1000
    matches = conn.execute("""
        SELECT m.match_id, m.played_at FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at DESC
    """, (my_account_id, cutoff)).fetchall()

    per_match = []
    hot = 0
    solo_surv = 0
    team_surv = 0
    for m in matches:
        result = _detect_hot_drop(conn, m["match_id"], my_account_id,
                                  window_ms, window_secs)
        per_match.append({
            "matchId":      m["match_id"],
            "playedAt":     m["played_at"],
            "hotDrop":      result["hotDrop"],
            "soloSurvived": result["soloSurvived"],
            "teamSurvived": result["teamSurvived"],
        })
        if result["hotDrop"]:
            hot += 1
            if result["soloSurvived"]:
                solo_surv += 1
            if result["teamSurvived"]:
                team_surv += 1

    # Streak: vom neuesten Match rückwärts, nur Hot-Drop-Matches zählen
    streak = 0
    for pm in per_match:
        if not pm["hotDrop"]:
            continue
        if pm["soloSurvived"]:
            streak += 1
        else:
            break

    n = len(matches)
    return {
        "matches":          n,
        "hotDrops":         hot,
        "rate":             (hot / n * 100) if n else 0,
        "soloSurvived":     solo_surv,
        "teamSurvived":     team_surv,
        "soloSurvivalRate": (solo_surv / hot * 100) if hot else 0,
        "teamSurvivalRate": (team_surv / hot * 100) if hot else 0,
        "streak":           streak,
        "perMatch":         per_match[:20],
    }


def _detect_hot_drop(conn, match_id, my_account_id, window_ms, window_secs):
    """Pro Match: Hot-Drop ja/nein + Survival-Marker.

    Match-Start = played_at − duration_secs (played_at ist Match-Ende).
    Window = erste window_ms ab Match-Start. Vorher hatte ich
    fälschlicherweise events[0].timestamp_ms als Match-Start
    angenommen — das war der erste Kill, nicht der Match-Anfang.
    """
    parts = conn.execute("""
        SELECT account_id, team_id, time_survived
        FROM participants WHERE match_id = ?
    """, (match_id,)).fetchall()
    if not parts:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}
    acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
    my_team_id = acc_to_team.get(my_account_id)
    if my_team_id is None:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}

    squad_ids = {a for a, t in acc_to_team.items() if t == my_team_id}

    # Echter Match-Start aus matches-Tabelle (played_at − duration_secs)
    m_row = conn.execute(
        "SELECT played_at, duration_secs FROM matches WHERE match_id = ?",
        (match_id,)
    ).fetchone()
    if not m_row or not m_row["played_at"]:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}
    end_dt = _parse_iso(m_row["played_at"])
    if end_dt is None:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}
    duration_secs = m_row["duration_secs"] or 0
    match_start_ms = int((end_dt.timestamp() - duration_secs) * 1000)
    early_cutoff_ms = match_start_ms + window_ms

    # Kill/Knock-Events innerhalb des frühen Fensters
    events = conn.execute("""
        SELECT actor_account, target_account, timestamp_ms
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('Kill', 'Knock')
          AND timestamp_ms <= ?
        ORDER BY timestamp_ms ASC
    """, (match_id, early_cutoff_ms)).fetchall()

    hot_drop = False
    for e in events:
        a, v = e["actor_account"], e["target_account"]
        a_team = acc_to_team.get(a)
        v_team = acc_to_team.get(v)
        if a_team is None or v_team is None:
            continue
        if a_team == v_team:
            # Friendly fire — kein Squad-Fight
            continue
        if a in squad_ids or v in squad_ids:
            hot_drop = True
            break

    # Survival-Marker via time_survived (Sekunden ab Match-Start)
    my_part = next((p for p in parts if p["account_id"] == my_account_id), None)
    my_surv = (my_part and my_part["time_survived"]) or 0
    squad_surv = max((p["time_survived"] or 0)
                     for p in parts if p["account_id"] in squad_ids)
    return {
        "hotDrop":      hot_drop,
        "soloSurvived": my_surv >= window_secs,
        "teamSurvived": squad_surv >= window_secs,
    }


def compute_first_fight_rate(conn, my_account_id, range_key="session",
                              cluster_secs=30, cluster_radius_m=200):
    """First Fight Win Rate — DEFINITION (echtes Fight-Win, nicht First-Engage):
    Pro Match: das ERSTE Gefecht zwischen Squads.

    Fight-Cluster:
    - Start: erstes Kill/Knock-Event mit Squad-Beteiligung (Squad als Attacker
      oder Victim).
    - Erweiterung: alle weiteren Kill/Knock-Events innerhalb von `cluster_secs`
      Sekunden zum letzten Cluster-Event UND `cluster_radius_m` Meter Radius
      werden hinzugefügt — auch enemy-vs-enemy Events. Damit erfassen wir
      Multi-Team-Gefechte.
    - Ende: kein neues Kill/Knock-Event mehr passt → Cluster geschlossen.

    Beteiligte Teams: alle team_ids von attackern und victims im Cluster.
    Win/Loss:
    - WIN  = unser Team hat am Fight-Ende noch lebende Member (time_survived
      > Fight-End-Zeit oder besser).
    - LOSS = alle unsere Squad-Member wurden im/vor Fight-Ende ausgeschaltet.

    Returns: rate, survived, total, sparkline, avgTeams, maxTeams.
    """
    # PUBG-Welt: Distanzen in cm. 1 Meter = 100 Einheiten.
    cluster_radius_cm = cluster_radius_m * 100
    cluster_ms = cluster_secs * 1000
    cutoff = _range_filter(conn, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    matches = conn.execute("""
        SELECT m.match_id, m.duration_secs FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff)).fetchall()

    total = 0
    survived = 0
    sparkline = []
    teams_per_fight = []
    for m in matches:
        result = _detect_first_fight(conn, m["match_id"], my_account_id,
                                       cluster_ms, cluster_radius_cm)
        if result is None:
            continue
        total += 1
        teams_per_fight.append(result["teams_count"])
        if result["won"]:
            survived += 1
            sparkline.append(1)
        else:
            sparkline.append(0)

    avg_teams = (sum(teams_per_fight) / len(teams_per_fight)) if teams_per_fight else 0
    max_teams = max(teams_per_fight) if teams_per_fight else 0
    return {
        "rate": (survived / total * 100) if total else 0,
        "survived": survived,
        "total": total,
        "sparkline": sparkline[-20:],
        "avgTeams": round(avg_teams, 2),
        "maxTeams": max_teams,
    }


def _detect_first_fight(conn, match_id, my_account_id,
                         cluster_ms, cluster_radius_cm):
    """Findet den ersten Squad-Fight in einem Match und bewertet Win/Loss.
    Returns dict {won, teams_count, ...} oder None wenn kein Fight.
    """
    # Squad und Team-Mapping aus participants
    parts = conn.execute("""
        SELECT account_id, team_id, time_survived
        FROM participants WHERE match_id = ?
    """, (match_id,)).fetchall()
    if not parts:
        return None
    acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
    acc_to_survived = {p["account_id"]: p["time_survived"] for p in parts}
    # Mein Squad = mein team_id im Match
    my_team_id = acc_to_team.get(my_account_id)
    if my_team_id is None:
        return None
    squad_ids = {a for a, t in acc_to_team.items() if t == my_team_id}

    # Alle Kill/Knock-Events des Matches, sortiert nach Zeit.
    # Wir brauchen Position für räumliche Nähe.
    events = conn.execute("""
        SELECT event_type, actor_account, target_account, timestamp_ms,
               actor_x, actor_y, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ? AND event_type IN ('Kill', 'Knock')
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    if not events:
        return None

    # Erstes Squad-beteiligtes Event = Fight-Start
    first_idx = None
    for i, e in enumerate(events):
        if e["actor_account"] in squad_ids or e["target_account"] in squad_ids:
            first_idx = i
            break
    if first_idx is None:
        return None

    cluster = [events[first_idx]]
    cluster_acc_ids = set()
    for e in cluster:
        if e["actor_account"]: cluster_acc_ids.add(e["actor_account"])
        if e["target_account"]: cluster_acc_ids.add(e["target_account"])

    # Cluster erweitern: nachfolgende Events die zeitlich + räumlich nah sind
    last_event_ts = cluster[-1]["timestamp_ms"]
    for e in events[first_idx + 1:]:
        ts = e["timestamp_ms"]
        if ts is None or ts - last_event_ts > cluster_ms:
            break  # zu weit weg in Zeit
        # Räumlich: ist mind. eine der Event-Positions nahe genug an einem
        # bisherigen Cluster-Event?
        if not _event_near_cluster(e, cluster, cluster_radius_cm):
            continue
        cluster.append(e)
        last_event_ts = ts
        if e["actor_account"]: cluster_acc_ids.add(e["actor_account"])
        if e["target_account"]: cluster_acc_ids.add(e["target_account"])

    # Beteiligte Teams = alle team_ids der involvierten accounts
    teams = set()
    for acc in cluster_acc_ids:
        t = acc_to_team.get(acc)
        if t is not None:
            teams.add(t)

    # Win-Bedingung: Hat mein Squad noch lebende Member zum Fight-Ende?
    # time_survived ist in Sekunden ab Match-Start. Kill-Events haben
    # timestamp_ms (ms ab Match-Start oder absolut?).
    # Praktisch: wenn ein Squad-Member noch nach Fight-Ende lebt → WIN.
    # Match-Start aus erstem Kill/Knock geschätzt = nicht zuverlässig.
    # Wir nehmen einen pragmatischen Ansatz: Wenn mind. 1 Squad-Member
    # nicht im Fight-Cluster als victim auftaucht UND insgesamt länger
    # überlebt als der Fight dauert → WIN.
    fight_end_ts = last_event_ts
    fight_start_ts = cluster[0]["timestamp_ms"]
    fight_duration_s = (fight_end_ts - fight_start_ts) / 1000.0

    # Squad-Members die im Cluster als Victim auftauchen → tot/down
    squad_down_in_fight = {
        e["target_account"] for e in cluster
        if e["target_account"] in squad_ids and e["event_type"] == "Kill"
    }
    squad_alive_after = squad_ids - squad_down_in_fight

    # WIN = unser Squad hat am Fight-Ende noch lebende Members
    won = bool(squad_alive_after)

    return {
        "won": won,
        "teams_count": len(teams),
        "fight_duration_s": fight_duration_s,
        "events_count": len(cluster),
        "squad_killed_in_fight": len(squad_down_in_fight),
    }


def _event_near_cluster(event, cluster, radius_cm):
    """True wenn Event räumlich nahe an mind. einem Cluster-Event ist.
    Nahe = victim_xy oder actor_xy < radius_cm zu mind. einem
    Cluster-Event (egal welche Position dort)."""
    e_pts = []
    if event["actor_x"] is not None and event["actor_y"] is not None:
        e_pts.append((event["actor_x"], event["actor_y"]))
    if event["victim_x"] is not None and event["victim_y"] is not None:
        e_pts.append((event["victim_x"], event["victim_y"]))
    if not e_pts:
        return True   # ohne Position: konservativ inkludieren
    radius_sq = radius_cm * radius_cm
    for c in cluster:
        c_pts = []
        if c["actor_x"] is not None and c["actor_y"] is not None:
            c_pts.append((c["actor_x"], c["actor_y"]))
        if c["victim_x"] is not None and c["victim_y"] is not None:
            c_pts.append((c["victim_x"], c["victim_y"]))
        for ex, ey in e_pts:
            for cx, cy in c_pts:
                dx, dy = ex - cx, ey - cy
                if dx * dx + dy * dy <= radius_sq:
                    return True
    return False


def compute_sessions_index(conn, my_account_id, gap_hours=4):
    """Liste aller erkennbaren Sessions in der DB, basierend auf 4h-Lücken.
    Returns Sessions sortiert vom neuesten zum ältesten."""
    rows = conn.execute("""
        SELECT m.match_id, m.played_at, m.duration_secs, m.map_name,
               pa.kills, pa.damage_dealt, pa.place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ?
        ORDER BY m.played_at ASC
    """, (my_account_id,)).fetchall()

    if not rows:
        return []

    # Sessions identifizieren via Gap zwischen aufeinanderfolgenden played_at
    sessions = []
    cur = []
    prev_ts = None
    for r in rows:
        ts = _parse_iso(r["played_at"])
        if prev_ts is not None and (ts - prev_ts).total_seconds() / 3600 > gap_hours:
            sessions.append(cur)
            cur = []
        cur.append(r)
        prev_ts = ts
    if cur:
        sessions.append(cur)

    out = []
    for ms in sessions:
        n = len(ms)
        wins = sum(1 for x in ms if (x["place"] or 99) == 1)
        first_end = _parse_iso(ms[0]["played_at"])
        first_start = first_end - datetime.timedelta(
            seconds=ms[0]["duration_secs"] or 0)
        last_end = ms[-1]["played_at"]
        from_iso = first_start.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Top-Mate der Session (häufigster Squad-Member, nicht self)
        match_ids = [x["match_id"] for x in ms]
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            mate_rows = conn.execute(f"""
                SELECT name, COUNT(*) AS c FROM participants
                WHERE match_id IN ({placeholders}) AND account_id != ?
                GROUP BY name ORDER BY c DESC LIMIT 1
            """, list(match_ids) + [my_account_id]).fetchall()
            top_mate = mate_rows[0]["name"] if mate_rows else None
            top_mate_count = mate_rows[0]["c"] if mate_rows else 0
        else:
            top_mate, top_mate_count = None, 0

        out.append({
            "from": from_iso,
            "to": last_end,
            "matches": n,
            "wins": wins,
            "kills": sum(x["kills"] or 0 for x in ms),
            "damage": sum(x["damage_dealt"] or 0 for x in ms),
            "topMate": top_mate,
            "topMateCount": top_mate_count,
        })
    # Sortiert: jüngste Session zuerst
    return list(reversed(out))


def compute_session_report(conn, my_account_id, range_from=None, range_to=None):
    """Erzeugt einen After-Session-Report mit Phasen-Aufteilung.
    - Default: aktuelle Session via _session_filter
    - Mit range_from/range_to (ISO): genauer Zeitraum"""
    if range_from:
        started = range_from
    else:
        started = _session_filter(conn)

    end_filter = "AND m.played_at <= ?" if range_to else ""
    params = [my_account_id, started]
    if range_to:
        params.append(range_to)

    matches = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.game_mode, m.played_at,
               m.duration_secs,
               pa.kills, pa.headshot_kills, pa.assists, pa.dbnos,
               pa.damage_dealt, pa.place, pa.time_survived,
               pa.longest_kill
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ? {end_filter}
        ORDER BY m.played_at ASC
    """, params).fetchall()

    if not matches:
        return {"sessionStartedAt": started, "rangeTo": range_to,
                "totalMatches": 0,
                "phases": [], "totals": None, "highlights": []}

    # Squad-Members pro Match (ohne dich selbst, sortiert)
    def _squad(match_id):
        rows = conn.execute("""
            SELECT name, kills, headshot_kills, assists, dbnos,
                   damage_dealt, place, time_survived
            FROM participants WHERE match_id=? AND account_id != ?
            ORDER BY name
        """, (match_id, my_account_id)).fetchall()
        return [dict(r) for r in rows]

    self_name_row = conn.execute(
        "SELECT name FROM players WHERE account_id = ?", (my_account_id,)
    ).fetchone()
    my_name = self_name_row["name"] if self_name_row else "Self"

    # Längste time_survived im Squad (du + Mates) — wann der LETZTE Squadmember
    # raus war. Bei Win = Match-Dauer.
    def _squad_last_survived(match_id):
        row = conn.execute("""
            SELECT MAX(time_survived) AS max_surv FROM participants
            WHERE match_id=?
        """, (match_id,)).fetchone()
        return row["max_surv"] or 0

    enriched = []
    for m in matches:
        d = dict(m)
        d["squad"] = _squad(m["match_id"])
        d["squadSet"] = frozenset(s["name"] for s in d["squad"])
        d["squadTimeSurvived"] = _squad_last_survived(m["match_id"])
        enriched.append(d)

    # Phase = aufeinanderfolgende Matches deren Squad-Sets sich überlappen.
    # Der "Stamm" der Phase ist die Schnittmenge aller Squads in der Phase
    # (die Mates die in JEDEM Match dieser Phase dabei waren).
    # Random-Filler die nur in einzelnen Matches mitliefen werden separat geführt.
    phases = []
    cur_phase = None
    for m in enriched:
        cur_set = m["squadSet"]
        if cur_phase is None:
            cur_phase = {"core": set(cur_set),
                          "allMembers": set(cur_set),
                          "matches": []}
            phases.append(cur_phase)
        else:
            new_core = cur_phase["core"] & cur_set
            if not new_core and cur_set:
                # Stamm-Crew komplett weg → neue Phase
                cur_phase = {"core": set(cur_set),
                              "allMembers": set(cur_set),
                              "matches": []}
                phases.append(cur_phase)
            elif not cur_set:
                # Solo-Match — bricht Phase nur wenn vorher Squad da war
                if cur_phase["core"]:
                    cur_phase = {"core": set(),
                                  "allMembers": set(),
                                  "matches": []}
                    phases.append(cur_phase)
            else:
                cur_phase["core"] = new_core
                cur_phase["allMembers"] |= cur_set
        cur_phase["matches"].append(m)

    # Pro Phase Aggregate
    import datetime as _dt
    def _match_start(m):
        """Match-Start = played_at (Match-End) - duration."""
        end = _dt.datetime.fromisoformat(m["played_at"].replace("Z", "+00:00"))
        return (end - _dt.timedelta(seconds=m["duration_secs"] or 0)) \
            .strftime("%Y-%m-%dT%H:%M:%SZ")

    for ph in phases:
        ms = ph["matches"]
        n = len(ms)
        wins = sum(1 for x in ms if (x["place"] or 99) == 1)
        # Member-Counts: wie oft war jeder dabei in dieser Phase
        ph["memberCounts"] = {}
        for x in ms:
            for name in x["squadSet"]:
                ph["memberCounts"][name] = ph["memberCounts"].get(name, 0) + 1
        total_kills = sum(x["kills"] or 0 for x in ms)
        total_damage = sum(x["damage_dealt"] or 0 for x in ms)
        total_surv = sum(x["time_survived"] or 0 for x in ms)
        ph["stats"] = {
            "matches": n,
            "wins": wins,
            "kills": total_kills,
            "damage": total_damage,
            "avgKills": total_kills / n if n else 0,
            "avgDamage": total_damage / n if n else 0,
            "avgPlace": (sum(x["place"] or 0 for x in ms) / n) if n else 0,
            "avgSurvivedSec": total_surv / n if n else 0,
            "kd": total_kills / max(n - wins, 1),
            "totalSurvivedSec": total_surv,
            "startTime": _match_start(ms[0]),
            "endTime": ms[-1]["played_at"],
        }

    # Total-Aggregate
    n = len(enriched)
    wins = sum(1 for x in enriched if (x["place"] or 99) == 1)
    total_kills = sum(x["kills"] or 0 for x in enriched)
    total_damage = sum(x["damage_dealt"] or 0 for x in enriched)
    total_surv = sum(x["time_survived"] or 0 for x in enriched)
    totals = {
        "matches": n,
        "wins": wins,
        "kills": total_kills,
        "damage": total_damage,
        "avgKills": total_kills / n if n else 0,
        "avgDamage": total_damage / n if n else 0,
        "avgPlace": sum(x["place"] or 0 for x in enriched) / n if n else 0,
        "avgSurvivedSec": total_surv / n if n else 0,
        "kd": total_kills / max(n - wins, 1),
        "headshots": sum(x["headshot_kills"] or 0 for x in enriched),
        "assists": sum(x["assists"] or 0 for x in enriched),
        "dbnos": sum(x["dbnos"] or 0 for x in enriched),
        "totalSurvivedSec": total_surv,
        "longestKill": max((x["longest_kill"] or 0 for x in enriched), default=0),
        "startTime": _match_start(enriched[0]),
        "endTime": enriched[-1]["played_at"],
        "uniqueMaps": len({x["map_name"] for x in enriched}),
    }

    # Map-Performance: pro Map → Matches, Wins, K/D, Avg DMG, Avg Place
    map_stats = {}
    for x in enriched:
        mn = x["map_name"]
        if mn not in map_stats:
            map_stats[mn] = {"map": mn, "matches": 0, "wins": 0,
                              "kills": 0, "damage": 0.0,
                              "totalPlace": 0, "totalSurv": 0}
        ms_ = map_stats[mn]
        ms_["matches"] += 1
        if (x["place"] or 99) == 1:
            ms_["wins"] += 1
        ms_["kills"] += x["kills"] or 0
        ms_["damage"] += x["damage_dealt"] or 0
        ms_["totalPlace"] += x["place"] or 0
        ms_["totalSurv"] += x["time_survived"] or 0
    maps_perf = []
    for ms_ in map_stats.values():
        nm = ms_["matches"]
        maps_perf.append({
            "map": ms_["map"],
            "matches": nm,
            "wins": ms_["wins"],
            "kills": ms_["kills"],
            "damage": ms_["damage"],
            "avgKills": ms_["kills"] / nm if nm else 0,
            "avgDamage": ms_["damage"] / nm if nm else 0,
            "avgPlace": ms_["totalPlace"] / nm if nm else 0,
            "avgSurvivedSec": ms_["totalSurv"] / nm if nm else 0,
            "kd": ms_["kills"] / max(nm - ms_["wins"], 1),
        })
    maps_perf.sort(key=lambda m: -m["matches"])

    # Highlights — beste Matches nach DMG
    highlights = sorted(enriched, key=lambda x: -(x["damage_dealt"] or 0))[:3]
    # Lowlights — frühe Deaths (kurze time_survived)
    lowlights = sorted([x for x in enriched if (x["place"] or 99) > 20],
                       key=lambda x: x["time_survived"] or 0)[:3]

    def _to_payload(m):
        # Eigener Eintrag zusätzlich zu mates-Liste
        my_entry = {
            "name": my_name,
            "kills": m["kills"],
            "headshot_kills": m["headshot_kills"],
            "assists": m["assists"],
            "dbnos": m["dbnos"],
            "damage_dealt": m["damage_dealt"],
            "place": m["place"],
            "time_survived": m["time_survived"],
            "isSelf": True,
        }
        return {
            "matchId": m["match_id"],
            "map": m["map_name"],
            "mode": m["game_mode"],
            "matchEnd": m["played_at"],
            "durationSec": m["duration_secs"],
            "place": m["place"],
            "kills": m["kills"],
            "damage": m["damage_dealt"],
            "timeSurvived": m["time_survived"],
            "squadTimeSurvived": m["squadTimeSurvived"],
            "myStats": my_entry,
            "squad": m["squad"],
        }

    return {
        "sessionStartedAt": started,
        "rangeTo": range_to,
        "totalMatches": n,
        "totals": totals,
        "phases": [{
            "coreSquad": sorted(ph["core"]),
            "allMembers": sorted(ph["allMembers"]),
            # Filler mit Count (wie oft war jeder in der Phase dabei) — sortiert
            # nach Count absteigend, dann Name.
            "fillers": [
                {"name": n, "count": ph["memberCounts"].get(n, 0)}
                for n in sorted(
                    ph["allMembers"] - ph["core"],
                    key=lambda nm: (-ph["memberCounts"].get(nm, 0), nm),
                )
            ],
            "phaseMatchCount": len(ph["matches"]),
            "stats": ph["stats"],
            "matches": [_to_payload(m) for m in ph["matches"]],
        } for ph in phases],
        "highlights": [_to_payload(m) for m in highlights],
        "lowlights": [_to_payload(m) for m in lowlights],
        "mapsPerf": maps_perf,
    }


def compute_chickens_together(conn, my_account_id, min_wins=1, min_matches=1):
    """Pro Co-Player: gemeinsame Wins (place=1), Match-Anzahl, Win-Rate.
    Sortiert: absolute Wins primär, bei Gleichstand höhere Win-Rate vor."""
    rows = conn.execute("""
        SELECT mate.account_id, mate.name,
               SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) AS wins_together,
               COUNT(*) AS shared_matches,
               (CAST(SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) AS REAL)
                / COUNT(*)) * 100 AS win_rate
        FROM participants mate
        JOIN participants me ON me.match_id = mate.match_id AND me.account_id = ?
        WHERE mate.account_id != ?
        GROUP BY mate.account_id, mate.name
        HAVING wins_together >= ? AND shared_matches >= ?
        ORDER BY wins_together DESC, win_rate DESC, shared_matches DESC
    """, (my_account_id, my_account_id, min_wins, min_matches)).fetchall()
    return [{
        "accountId": r["account_id"],
        "name": r["name"],
        "winsTogether": r["wins_together"],
        "sharedMatches": r["shared_matches"],
        "winRate": r["win_rate"],
    } for r in rows]


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
