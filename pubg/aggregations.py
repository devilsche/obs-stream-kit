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


def _invert_order(order: str) -> str:
    """Invertiert ASC/DESC in einer ORDER BY-Klausel (Komma-getrennt).
    Wird fuer 'anti-mates' verwendet — dieselbe Sort-Logik, aber
    schlechteste zuerst."""
    out = []
    for term in order.split(","):
        t = term.strip()
        if t.upper().endswith(" DESC"):
            out.append(t[:-5] + " ASC")
        elif t.upper().endswith(" ASC"):
            out.append(t[:-4] + " DESC")
        else:
            out.append(t + " DESC")
    return ", ".join(out)


def compute_top_mates(conn, my_account_id: str,
                      sort_by: str = "avgPlace",
                      limit: int = 5,
                      min_matches: int = 10,
                      range_key: str = None,
                      worst: bool = False) -> list:
    """range_key: None=alle DB-Matches; 'session'/'day'/'week' filtert.
    worst=True kehrt die Sort-Reihenfolge um (= Anti-Mates: schlechteste
    zuerst)."""
    order = SORT_KEYS.get(sort_by, SORT_KEYS["avgPlace"])
    if worst:
        order = _invert_order(order)
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

    # Same-Lobby-Different-Team-Stat: Matches in denen wir BEIDE in der
    # Lobby waren (laut match_team_mapping), aber NICHT im selben Squad.
    # Setzt voraus dass match_team_mapping befüllt ist (match_schema=2).
    same_lobby = conn.execute("""
        SELECT COUNT(DISTINCT mtm_them.match_id) AS lobby_matches
        FROM match_team_mapping mtm_me
        JOIN match_team_mapping mtm_them
          ON mtm_them.match_id = mtm_me.match_id
        WHERE mtm_me.account_id = ?
          AND mtm_them.account_id = ?
          AND mtm_me.team_id != mtm_them.team_id
    """, (my_account_id, p["account_id"])).fetchone()
    lobby_only = (same_lobby["lobby_matches"] or 0) if same_lobby else 0

    return {
        "name": p["name"],
        "myName": my_name,
        "accountId": p["account_id"],
        "sharedHistory": history,
        "careerLifetime": dict(lifetime) if lifetime else None,
        "lobbyOnlyMatches": lobby_only,  # gleiche Lobby, anderes Team
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
               SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) AS wins_total,
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
        # K/D = kills / deaths, mit deaths = matches - wins (in BR stirbt
        # man immer ausser bei place=1). Frueher war hier kills/matches,
        # was K/M ist - daher die Abweichung zum chat-stats-popup, das
        # in compute_co_player mit deaths-basierter K/D rechnet.
        deaths = max((r["shared"] or 0) - (r["wins_total"] or 0), 1)
        out.append({
            "accountId": r["account_id"],
            "name": r["name"],
            "sharedMatchesToday": r["shared"],
            "totalWithMe": r["total_with_me"],
            "kdToday": (r["kills_total"] or 0) / deaths,
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

    # Lobby-weite Aggregation aus match_team_mapping (alle ~96 Lobby-
    # Members + 4 Squad). Fallback: participants (squad-only) für Matches
    # vor match_schema=3, deren Lobby-Mapping noch keine kills+place hat.
    rows = conn.execute("""
        SELECT m.match_id, m.played_at,
               SUM(COALESCE(mtm.kills, 0)) AS lobby_kills,
               COUNT(mtm.account_id)        AS lobby_n,
               SUM(CASE WHEN mtm.place=1 THEN 1 ELSE 0 END) AS lobby_wins
        FROM matches m
        JOIN match_team_mapping mtm ON mtm.match_id = m.match_id
        WHERE m.match_id IN (
          SELECT match_id FROM participants WHERE account_id = ?
        ) AND m.played_at >= ?
          AND mtm.kills IS NOT NULL
        GROUP BY m.match_id
        HAVING lobby_n > 4   -- nur Matches mit echtem Lobby-Mapping
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


def compute_squad_kd(conn, my_account_id, range_key="session"):
    """Squad-K/D über einen Zeitraum (session/week/all).
    Squad = pro Match alle match_team_mapping-Einträge mit my_team_id.
    K/D = SUM(squad_kills) / max(matches - squad_wins, 1).

    Liefert: {squadKd, myKd, diff, matches, kills, wins, kpm, perMatch}
    """
    cutoff = (_range_filter(conn, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")

    rows = conn.execute("""
        WITH my_teams AS (
          SELECT mtm.match_id, mtm.team_id
          FROM match_team_mapping mtm
          JOIN matches m ON m.match_id = mtm.match_id
          WHERE mtm.account_id = ? AND m.played_at >= ?
        )
        SELECT m.match_id, m.played_at, m.duration_secs,
               SUM(COALESCE(mtm.kills, 0)) AS sq_kills,
               COUNT(*)                     AS team_size,
               SUM(CASE WHEN mtm.time_survived IS NOT NULL
                          AND mtm.time_survived < m.duration_secs - 5
                        THEN 1 ELSE 0 END)  AS sq_deaths_real,
               SUM(CASE WHEN mtm.time_survived IS NULL THEN 1 ELSE 0 END)
                                            AS sq_no_surv,
               MAX(CASE WHEN mtm.place=1 THEN 1 ELSE 0 END) AS sq_won
        FROM matches m
        JOIN my_teams mt ON mt.match_id = m.match_id
        JOIN match_team_mapping mtm ON mtm.match_id = m.match_id
                                    AND mtm.team_id = mt.team_id
        WHERE mtm.kills IS NOT NULL
        GROUP BY m.match_id
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff)).fetchall()

    per_match = []
    total_kills = 0
    total_wins = 0
    total_deaths = 0
    for r in rows:
        kills = r["sq_kills"] or 0
        team_size = r["team_size"] or 0
        won = r["sq_won"] or 0
        # Death pro Mate via time_survived. Fallback (Schema 3): alle
        # team_size tot wenn Match verloren.
        if r["sq_no_surv"]:
            deaths = 0 if won else team_size
        else:
            deaths = r["sq_deaths_real"] or 0
        per_match.append({
            "matchId": r["match_id"],
            "playedAt": r["played_at"],
            "squadKills": kills,
            "teamSize": team_size,
            "deaths": deaths,
            "won": bool(won),
        })
        total_kills += kills
        total_wins += won
        total_deaths += deaths

    n = len(per_match)
    squad_kd = (total_kills / max(total_deaths, 1)) if n else 0
    kpm = (total_kills / n) if n else 0

    # Eigene K/D aus participants über denselben Zeitraum als Vergleich
    my = conn.execute("""
        SELECT SUM(p.kills) AS k, COUNT(*) AS n,
               SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w
        FROM participants p JOIN matches m ON m.match_id = p.match_id
        WHERE p.account_id = ? AND m.played_at >= ?
    """, (my_account_id, cutoff)).fetchone()
    my_k = (my and my["k"]) or 0
    my_n = (my and my["n"]) or 0
    my_w = (my and my["w"]) or 0
    my_kd = my_k / max(my_n - my_w, 1) if my_n else 0

    return {
        "squadKd": squad_kd,
        "myKd": my_kd,
        "diff": squad_kd - my_kd,
        "matches": n,
        "kills": total_kills,
        "wins": total_wins,
        "kpm": kpm,
        "perMatch": per_match,
    }


def compute_streaks(conn, my_account_id, range_key="session"):
    """Streaks pro Typ (chicken/top10/kd1) über einen Range.
    Liefert pro Typ: current (am Ende laufender Streak), best (höchster
    Streak im Range), bestEndedAt (wann der best-Streak endete).

    Liefert: {chicken: {...}, top10: {...}, kd1: {...}, range, matches}
    """
    cutoff = (_range_filter(conn, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")

    # Matches chronologisch (ASC) damit wir die best-Streaks korrekt finden,
    # current = letzter laufender Streak am Ende
    rows = conn.execute("""
        SELECT m.match_id, m.played_at, p.place, p.kills
        FROM matches m
        JOIN participants p ON p.match_id = m.match_id
        WHERE p.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff)).fetchall()

    tests = {
        "chicken": lambda r: (r["place"] or 99) == 1,
        "top10":   lambda r: (r["place"] or 99) <= 10,
        "kd1":     lambda r: (r["kills"] or 0) >= 1,
        "kd2":     lambda r: (r["kills"] or 0) >= 2,
    }

    out = {}
    for key, test in tests.items():
        run = 0
        best = 0
        best_ended_at = None
        last_ended_at = None
        for r in rows:
            if test(r):
                run += 1
                last_ended_at = r["played_at"]
                if run > best:
                    best = run
                    best_ended_at = r["played_at"]
            else:
                run = 0
                last_ended_at = None
        out[key] = {
            "current": run,
            "best": best,
            "bestEndedAt": best_ended_at,
        }

    return {
        "range": range_key,
        "matches": len(rows),
        **out,
    }


def compute_lobby_top3_kd(conn, my_account_id, range_key="session",
                            match_ids=None):
    """Lobby-Skill-Indikator via Top-3-Fragger pro Match.
    Pro Match: Top-3 nach Kills in der Lobby, ihre Round-K/D nehmen
    (kills/max(deaths,1)) und mitteln. Über alle Matches der Range
    nochmal mitteln. Plus Top-3-Avg-Kills als Vergleichswert.

    Hohe Zahl = harte Lobby (Top-Fragger schreddern). Braucht nur
    match_team_mapping (kein Career-Fetch).

    `match_ids` optional: wenn gesetzt, range_key wird ignoriert.

    Liefert: {top3Kd, top3Kills, matches, perMatch}
    """
    if match_ids is None:
        cutoff = (_range_filter(conn, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        matches = conn.execute("""
            SELECT m.match_id, m.played_at, m.duration_secs
            FROM matches m
            WHERE m.match_id IN (
                SELECT match_id FROM participants WHERE account_id = ?
            ) AND m.played_at >= ?
            ORDER BY m.played_at ASC
        """, (my_account_id, cutoff)).fetchall()
    else:
        if not match_ids:
            return {"top3Kd": 0, "top3Kills": 0, "matches": 0, "perMatch": []}
        ph = ",".join("?" * len(match_ids))
        matches = conn.execute(
            f"SELECT match_id, played_at, duration_secs FROM matches "
            f"WHERE match_id IN ({ph}) ORDER BY played_at ASC",
            match_ids,
        ).fetchall()

    per_match = []
    sum_kd = 0.0
    sum_kills = 0.0
    n = 0
    for m in matches:
        top3 = conn.execute("""
            SELECT kills, place, time_survived
            FROM match_team_mapping
            WHERE match_id = ? AND kills IS NOT NULL
            ORDER BY kills DESC
            LIMIT 3
        """, (m["match_id"],)).fetchall()
        if len(top3) < 3:
            continue
        dur = m["duration_secs"] or 0
        kds = []
        for r in top3:
            k = r["kills"] or 0
            if r["time_survived"] is not None and dur:
                died = r["time_survived"] < dur - 5
            else:
                died = (r["place"] or 99) != 1
            # K/D = kills/deaths. Tot=1 Death, lebt=keine Deaths → K/D = k
            # (in beiden Fällen mathematisch k, aber als K/D-Semantik klar)
            kds.append(k / max(1 if died else 0, 1) if died else k)
        match_kd = sum(kds) / 3
        match_kills = sum(r["kills"] or 0 for r in top3) / 3
        per_match.append({
            "matchId": m["match_id"],
            "playedAt": m["played_at"],
            "top3Kd": match_kd,
            "top3Kills": match_kills,
        })
        sum_kd += match_kd
        sum_kills += match_kills
        n += 1

    return {
        "top3Kd": (sum_kd / n) if n else 0,
        "top3Kills": (sum_kills / n) if n else 0,
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
      - first_chicken      : erste #1 in der Session
      - first_top10        : erstes Match mit place <= 10
      - longest_kill_400   : Longest Kill >= 400m in einem Match
      - five_kill_match    : Match mit >= 5 Kills
      - beast_chicken      : place == 1 UND kills >= 5 (mehrfach möglich)
      - first_hot_drop          : ERSTES Hot-Drop in der Range (egal ob überlebt)
      - first_hot_drop_survived : ERSTES überlebtes Hot-Drop in der Range
      - top10_streak       : längste Top-10-Streak in Session (>= 3)
      - chicken_streak     : längste Chicken-Streak in Session (>= 2)

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
    # Streaks: tatsächliche Längen tracken, nicht nur Threshold-Trigger
    top10_streak = 0
    longest_top10_streak = 0
    longest_top10_streak_match = None
    chicken_streak = 0
    longest_chicken_streak = 0
    longest_chicken_streak_match = None
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

        # Top-10-Streak (≥3 in Folge wird Achievement)
        if place <= 10:
            top10_streak += 1
            if top10_streak > longest_top10_streak:
                longest_top10_streak = top10_streak
                longest_top10_streak_match = m
        else:
            top10_streak = 0

        # Chicken-Streak (≥2 in Folge wird Achievement)
        if place == 1:
            chicken_streak += 1
            if chicken_streak > longest_chicken_streak:
                longest_chicken_streak = chicken_streak
                longest_chicken_streak_match = m
        else:
            chicken_streak = 0

    # Streak-Achievements (post-loop, mit echter Längen-Anzeige)
    if longest_top10_streak >= 3 and longest_top10_streak_match:
        out.append({
            "id": "top10_streak",
            "label": f"Top-10 Streak ×{longest_top10_streak}",
            "icon": "🔥",
            "matchId": longest_top10_streak_match["matchId"],
            "playedAt": longest_top10_streak_match["playedAt"],
        })
    if longest_chicken_streak >= 2 and longest_chicken_streak_match:
        out.append({
            "id": "chicken_streak",
            "label": f"Chicken Streak ×{longest_chicken_streak}",
            "icon": "🔥",
            "matchId": longest_chicken_streak_match["matchId"],
            "playedAt": longest_chicken_streak_match["playedAt"],
        })

    # Hot-Drop-Achievements: ERSTES Hot-Drop überhaupt + ERSTES
    # überlebtes Hot-Drop in der Range. perMatch ist DESC sortiert →
    # reversed für ASC = ältestes zuerst. Beide Achievements können
    # zusammen auftreten (wenn das erste Hot-Drop direkt überlebt wurde).
    try:
        hd = compute_hot_drop(conn, my_account_id, "session",
                               from_iso=from_iso, to_iso=to_iso)
        first_hot_seen = False
        first_hot_survived_seen = False
        for pm in reversed(hd.get("perMatch") or []):
            if not pm.get("hotDrop"):
                continue
            if not first_hot_seen:
                out.append({
                    "id": "first_hot_drop",
                    "label": "First Hot Drop",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
                first_hot_seen = True
            if not first_hot_survived_seen and pm.get("soloSurvived"):
                out.append({
                    "id": "first_hot_drop_survived",
                    "label": "First Hot Drop Survived",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
                first_hot_survived_seen = True
            if first_hot_seen and first_hot_survived_seen:
                break
    except Exception:
        pass

    out.sort(key=lambda a: a.get("playedAt") or "")
    return out


# Welche Achievement-IDs als 'rare' im Popup zaehlen (gold-glow + biglvlup.wav).
# Konservativ — die Kandidaten die wirklich krass sind:
PUBG_RARE_ACHIEVEMENTS = {
    "beast_chicken",                 # Chicken + ≥5 Kills
    "first_hot_drop_survived",       # erstes ueberlebtes Hot-Drop
    "longest_kill_400",              # ≥400m
    "chicken_streak",                # ≥2 Chickens in Folge
}


def detect_and_store_session_achievements(conn, my_account_id):
    """Nach jedem neuen Match aufrufen. Berechnet die aktuellen Session-
    Achievements und schreibt neue (achievement_id, match_id)-Kombis in
    pubg_achievements_seen mit displayed_at=NULL. Returns Anzahl neu
    eingefuegter."""
    achievements = compute_session_achievements(conn, my_account_id)
    n = _insert_achievements(conn, achievements, suppress_popup=False)
    conn.commit()
    return n


def _insert_achievements(conn, achievements, suppress_popup=False):
    """Helper: inserted Liste von compute_session_achievements-Resultaten
    in pubg_achievements_seen. INSERT OR IGNORE filtert Duplikate.
    suppress_popup=True markiert direkt als displayed_at=NOW damit's
    nicht popupt (fuer Backfill)."""
    import time as _t
    new_count = 0
    displayed_at = int(_t.time()) if suppress_popup else None
    for a in achievements:
        aid = a.get("id")
        mid = a.get("matchId")
        if not aid or not mid:
            continue
        cur = conn.execute("""
            INSERT INTO pubg_achievements_seen
              (achievement_id, match_id, label, icon, played_at,
               detected_at, is_rare, displayed_at)
            VALUES (?, ?, ?, ?, ?, strftime('%s','now'), ?, ?)
            ON CONFLICT(achievement_id, match_id) DO NOTHING
        """, (aid, mid, a.get("label"), a.get("icon"),
              a.get("playedAt"),
              1 if aid in PUBG_RARE_ACHIEVEMENTS else 0,
              displayed_at))
        if cur.rowcount > 0:
            new_count += 1
    return new_count


def backfill_session_achievements(conn, my_account_id,
                                    gap_hours=6, suppress_popup=True):
    """Historischer Backfill: walkt durch ALLE Matches in der DB
    chronologisch, splittet in Sessions per Time-Gap, laeuft
    compute_session_achievements pro Session, inserted Milestones
    in pubg_achievements_seen.

    gap_hours: Lueckenzeit zwischen Matches die als 'neue Session'
               zaehlt (Default 6h — Stream-Pause).
    suppress_popup: True (Default) markiert direkt als displayed_at=NOW
                    damit der Backfill nicht 100+ Popups feuert.

    Returns dict { sessions, inserted, errors }.
    """
    import datetime as _dt
    # Alle Matches chronologisch (ASC)
    matches = compute_session_matches(conn, my_account_id, "all")
    matches = list(reversed(matches))  # ASC
    if not matches:
        return {"sessions": 0, "inserted": 0, "errors": []}

    def _parse(iso):
        try:
            return _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        except (TypeError, ValueError, AttributeError):
            return None

    # Sessions per Gap detecten
    gap_secs = gap_hours * 3600
    sessions = []
    cur_start = matches[0]["playedAt"]
    cur_last  = matches[0]["playedAt"]
    last_t    = _parse(matches[0]["playedAt"])
    for m in matches[1:]:
        t = _parse(m["playedAt"])
        if t and last_t and (t - last_t).total_seconds() > gap_secs:
            sessions.append((cur_start, cur_last))
            cur_start = m["playedAt"]
        cur_last = m["playedAt"]
        if t:
            last_t = t
    sessions.append((cur_start, cur_last))

    # Detection pro Session
    total_new = 0
    errors = []
    for from_iso, to_iso in sessions:
        try:
            achievements = compute_session_achievements(
                conn, my_account_id, from_iso=from_iso, to_iso=to_iso)
            total_new += _insert_achievements(
                conn, achievements, suppress_popup=suppress_popup)
        except Exception as e:
            errors.append(f"{from_iso}: {type(e).__name__}: {e}")
    # SQLite ist nicht autocommit hier — ohne explizites commit gehen
    # die INSERTs verloren wenn der Connection geschlossen wird.
    conn.commit()
    return {
        "sessions": len(sessions),
        "inserted": total_new,
        "errors": errors,
    }


def compute_hot_drop(conn, my_account_id, range_key="session",
                     window_secs=120, from_iso=None, to_iso=None):
    """Hot-Drop-Stats über die Range.

    Definition Hot-Drop = im Match gab es ein Kill/Knock-Event innerhalb
    der ersten window_secs (Default 120s = 2 Min) NACH der Landung des
    Squads, zwischen verschiedenen Teams, wo das Squad als Attacker oder
    Victim beteiligt war. Landung = echte LogParachuteLanding-Events aus
    Telemetry, NICHT geschätzt.

    Pro Match Markierung:
      - hotDrop: ja/nein (Fight in window_secs nach Landung mit Squad-
        Beteiligung)
      - soloSurvived: ja, wenn ich window_secs nach der Squad-Landung
        noch lebe (time_survived >= squad_landing_offset + window_secs)
      - teamSurvived: ja, wenn mindestens ein Squad-Member window_secs
        nach Landung noch lebt

    Aggregat:
      - rate: % der Matches mit Hot-Drop
      - soloSurvivalRate: von Hot-Drops, % wo ich überlebt habe
      - teamSurvivalRate: von Hot-Drops, % wo Team überlebt hat
      - streak: aktuelle Streak überlebter Hot-Drops (von neuestem Match
        rückwärts; Solo-Survival als Kriterium)
      - perMatch: Liste mit Match-Markern für Sparklines
    """
    # from_iso/to_iso überschreiben range_key (für historische Sessions
    # via session-report). Sonst range_key auflösen.
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
    window_ms = window_secs * 1000
    matches = conn.execute(f"""
        SELECT m.match_id, m.played_at FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?{end_filter}
        ORDER BY m.played_at DESC
    """, params).fetchall()

    per_match = []
    hot = 0
    solo_surv = 0
    team_surv = 0
    teams_per_hot = []
    teams_in_radius_per_hot = []
    for m in matches:
        result = _detect_hot_drop(conn, m["match_id"], my_account_id,
                                  window_ms, window_secs)
        per_match.append({
            "matchId":        m["match_id"],
            "playedAt":       m["played_at"],
            "hotDrop":        result["hotDrop"],
            "soloSurvived":   result["soloSurvived"],
            "teamSurvived":   result["teamSurvived"],
            "teamsInFight":   result.get("teamsInFight", 0),
            "teamsInRadius":  result.get("teamsInRadius", 0),
        })
        if result["hotDrop"]:
            hot += 1
            teams_per_hot.append(result.get("teamsInFight", 0))
            teams_in_radius_per_hot.append(result.get("teamsInRadius", 0))
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
    avg_teams = (sum(teams_per_hot) / len(teams_per_hot)) if teams_per_hot else 0
    max_teams = max(teams_per_hot) if teams_per_hot else 0
    avg_radius_teams = (sum(teams_in_radius_per_hot) / len(teams_in_radius_per_hot)
                         if teams_in_radius_per_hot else 0)
    max_radius_teams = max(teams_in_radius_per_hot) if teams_in_radius_per_hot else 0
    return {
        "matches":            n,
        "hotDrops":           hot,
        "rate":               (hot / n * 100) if n else 0,
        "soloSurvived":       solo_surv,
        "teamSurvived":       team_surv,
        "soloSurvivalRate":   (solo_surv / hot * 100) if hot else 0,
        "teamSurvivalRate":   (team_surv / hot * 100) if hot else 0,
        "streak":             streak,
        "avgTeamsInFight":    round(avg_teams, 2),
        "maxTeamsInFight":    max_teams,
        "avgTeamsInRadius":   round(avg_radius_teams, 2),
        "maxTeamsInRadius":   max_radius_teams,
        "radiusMeters":       300,
        "perMatch":           per_match[:20],
    }


def _detect_hot_drop(conn, match_id, my_account_id, window_ms, window_secs):
    """Pro Match: Hot-Drop ja/nein + Survival-Marker.

    Bezugspunkt = ECHTE Squad-Landung aus LogParachuteLanding-Events
    (NICHT geschätzt, NICHT Match-Start). Window = erste window_ms ab
    Squad-Landung. Wenn keine Landing-Events vorhanden (Telemetry
    fehlt/abgelaufen) → kein Hot-Drop ermittelbar.
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

    # ALLE Squad-Landungen mit Position holen — für Radius-Detection
    # vergleichen wir jedes Lobby-Landing gegen jede Squad-Landung,
    # nicht nur gegen den ersten Lander. Dadurch gelten Teams als
    # "in der Drop-Area" wenn sie nahe IRGENDEINEM Squad-Member gelandet
    # sind (z.B. bei split-Drops über zwei Compounds).
    placeholders = ",".join("?" * len(squad_ids))
    squad_landings = conn.execute(f"""
        SELECT actor_account, actor_x, actor_y, timestamp_ms
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Landing'
          AND actor_account IN ({placeholders})
        ORDER BY timestamp_ms ASC
    """, [match_id] + list(squad_ids)).fetchall()
    if not squad_landings:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}

    # Erste Squad-Landung = Anker für Fight-Window (= "Boots on ground")
    first_landing = squad_landings[0]
    landing_ms = first_landing["timestamp_ms"]
    fight_cutoff_ms = landing_ms + window_ms

    # Kill/Knock-Events ab Squad-Landung bis +window_ms
    events = conn.execute("""
        SELECT actor_account, target_account, timestamp_ms
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('Kill', 'Knock')
          AND timestamp_ms >= ?
          AND timestamp_ms <= ?
        ORDER BY timestamp_ms ASC
    """, (match_id, landing_ms, fight_cutoff_ms)).fetchall()

    # Lobby-weites team_id-Mapping (falls match_schema >= 2)
    lobby_team_map = dict(conn.execute("""
        SELECT account_id, team_id FROM match_team_mapping
        WHERE match_id = ?
    """, (match_id,)).fetchall())
    # Falls leer (alte Matches ohne re-ingest): fallback auf acc_to_team
    # (squad-only) — Team-Count wird dann underestimiert.
    full_team_map = lobby_team_map if lobby_team_map else acc_to_team

    # teams_in_fight = nur Teams die UNS angegriffen oder von uns
    # angegriffen wurden (= fought with squad). Teams die untereinander
    # kämpfen aber uns nicht touchen → nicht gezählt. Sonst würde die
    # Zahl bei chaotischen Lobbies absurd hoch werden.
    hot_drop = False
    teams_in_fight = set()
    for e in events:
        a, v = e["actor_account"], e["target_account"]
        a_in_squad = a in squad_ids
        v_in_squad = v in squad_ids
        if a_in_squad and v_in_squad:
            continue  # Friendly fire innerhalb Squad — nicht zählen
        if not (a_in_squad or v_in_squad):
            continue  # Fight zwischen anderen Teams — uns egal
        # Squad ist beteiligt → Hot-Drop, Gegner-Team mitzählen
        hot_drop = True
        opponent = v if a_in_squad else a
        opp_team = full_team_map.get(opponent)
        if opp_team is not None and opp_team != my_team_id:
            teams_in_fight.add(opp_team)

    # Survival: cluster-basiert. Hot-Drop-Cluster ist der zusammen-
    # haengende initiale Combat:
    #   - Trigger: erstes Squad-Combat-Event (Kill/Knock/Damage) in
    #     den ersten window_ms nach Squad-Landung
    #   - Expansion: 3 min Stille beendet Cluster. 60s war zu kurz
    #     fuer Lauer-Phasen ('5 min Kampf, 2 min im Haus warten,
    #     dann weiter'). 3 min faengt typische Hot-Drop-Pausen ein,
    #     ohne zu lang fuer zufaellige Late-Re-Engages zu sein.
    #   - 300m-Radius zur initialen Position
    #   - Nur Squad-beteiligte Events zaehlen fuer Cluster-Erweiterung
    # Wenn ein Hot-Drop-Team disengaged und 5 min spaeter zurueck-
    # kommt, ist das ein NEUES Cluster (nicht mehr Hot-Drop).
    cluster_window_ms = 180 * 1000  # 3 min Stille = Cluster zu
    # 500m statt 300m — typische PUBG-Stadt (Pochinki, Mylta etc.)
    # ist 400-500m breit. Ein Gegner am anderen Stadt-Ende ist immer
    # noch derselbe Hot-Drop, nicht ein 'fremdes' Team.
    cluster_radius_cm = 500 * 100
    squad_pos_for_kills = [(s["actor_x"], s["actor_y"]) for s in squad_landings
                            if s["actor_x"] is not None and s["actor_y"] is not None]

    killed_in_hot_cluster = set()
    used_cluster = False
    if squad_pos_for_kills:
        all_combat = conn.execute(f"""
            SELECT event_type, actor_account, target_account, timestamp_ms,
                   actor_x, actor_y, victim_x, victim_y
            FROM telemetry_events
            WHERE match_id = ?
              AND event_type IN ('Kill', 'Knock', 'TakeDamage')
              AND actor_account IS NOT NULL
              AND timestamp_ms >= ?
            ORDER BY timestamp_ms ASC
        """, (match_id, landing_ms)).fetchall()
        # Trigger: erstes Squad-Event in den ersten window_ms
        initial_cutoff = landing_ms + window_ms
        trigger_idx = None
        for i, e in enumerate(all_combat):
            if e["timestamp_ms"] is None or e["timestamp_ms"] > initial_cutoff:
                break
            if e["actor_account"] in squad_ids or e["target_account"] in squad_ids:
                trigger_idx = i
                break
        if trigger_idx is not None:
            used_cluster = True
            cluster = [all_combat[trigger_idx]]
            last_ts = cluster[0]["timestamp_ms"]
            for e in all_combat[trigger_idx + 1:]:
                ts = e["timestamp_ms"]
                if ts is None or ts - last_ts > cluster_window_ms:
                    break  # 60s Stille -> Cluster zu (Disengage)
                # nur Squad-beteiligte Events erweitern den Cluster
                if not (e["actor_account"] in squad_ids
                        or e["target_account"] in squad_ids):
                    continue
                if not _event_near_cluster(e, cluster, cluster_radius_cm):
                    continue
                cluster.append(e)
                last_ts = ts
            # Squad-Member-Kills IM Cluster = im Hot-Drop gestorben
            for e in cluster:
                if (e["event_type"] == "Kill"
                        and e["target_account"] in squad_ids):
                    killed_in_hot_cluster.add(e["target_account"])

    if used_cluster:
        solo_alive = my_account_id not in killed_in_hot_cluster
        team_alive = bool(squad_ids - killed_in_hot_cluster)
    else:
        # Fallback: zeitliches window_secs-Window als 'Drop-Phase'
        # (alte Telemetry ohne Position, oder kein Squad-Combat in
        # den ersten 2 min -> stiller Hot-Drop).
        m_row = conn.execute(
            "SELECT played_at FROM matches WHERE match_id = ?",
            (match_id,)
        ).fetchone()
        survival_threshold_s = window_secs
        if m_row and m_row["played_at"]:
            start_dt = _parse_iso(m_row["played_at"])
            if start_dt:
                match_start_ms = int(start_dt.timestamp() * 1000)
                landing_offset_s = max(0, (landing_ms - match_start_ms) / 1000.0)
                survival_threshold_s = landing_offset_s + window_secs
        my_part = next((p for p in parts if p["account_id"] == my_account_id), None)
        my_surv = (my_part and my_part["time_survived"]) or 0
        squad_surv = max((p["time_survived"] or 0)
                         for p in parts if p["account_id"] in squad_ids)
        solo_alive = my_surv >= survival_threshold_s
        team_alive = squad_surv >= survival_threshold_s
    # Teams die im Radius (Default 300m) zu IRGENDEINEM Squad-Member
    # gelandet sind. Braucht alle Lobby-Landings (telemetry_schema >= 3)
    # + Position. Eigene Squad-Members werden ausgeschlossen.
    teams_in_radius = set()
    radius_cm = 500 * 100  # 1 Meter = 100 PUBG-Welt-Units; 500m =
                            # typische PUBG-Stadt-Breite (Pochinki etc.)
    radius_sq = radius_cm * radius_cm
    squad_pos = [(s["actor_x"], s["actor_y"]) for s in squad_landings
                  if s["actor_x"] is not None and s["actor_y"] is not None]
    if squad_pos:
        all_landings = conn.execute("""
            SELECT actor_account, actor_x, actor_y
            FROM telemetry_events
            WHERE match_id = ?
              AND event_type = 'Landing'
              AND actor_x IS NOT NULL AND actor_y IS NOT NULL
        """, (match_id,)).fetchall()
        for ld in all_landings:
            if ld["actor_account"] in squad_ids:
                continue  # eigenes Squad-Member, nicht zählen
            for sx, sy in squad_pos:
                dx = ld["actor_x"] - sx
                dy = ld["actor_y"] - sy
                if dx * dx + dy * dy <= radius_sq:
                    t = full_team_map.get(ld["actor_account"])
                    if t is not None and t != my_team_id:
                        teams_in_radius.add(t)
                    break  # in Radius, weitere Squad-Pos nicht prüfen

    # Hot-Drop = raeumlich (Teams im Radius beim Landing) ODER zeitlich
    # (Schusswechsel mit Squad in window_secs). Vorher nur zeitlich -
    # dadurch wurden 'Stadt-Drops mit Lauer-Phase >2min' faelschlich
    # als 'cold' gewertet.
    is_hot_drop = bool(teams_in_radius) or hot_drop
    return {
        "hotDrop":         is_hot_drop,
        "soloSurvived":    solo_alive,
        "teamSurvived":    team_alive,
        "teamsInFight":    len(teams_in_fight),
        "teamsInRadius":   len(teams_in_radius),
    }


def compute_first_fight_rate(conn, my_account_id, range_key="session",
                              cluster_secs=30, cluster_radius_m=200,
                              exclude_hot_drop=False,
                              hot_drop_window_secs=120):
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
    engaged_total = 0      # Matches mit events_count >= 2 (echter Fight)
    fled_total = 0         # Matches mit events_count == 1 (Disengage)
    solo_survived_n = 0    # ueber ALLE detected matches (inkl. fled)
    team_survived_n = 0    # ueber ALLE detected matches (inkl. fled)
    excluded_hot = 0
    sparkline = []
    per_match = []
    teams_per_fight = []
    hot_drop_window_ms = hot_drop_window_secs * 1000
    for m in matches:
        # Hot-Drop-Matches überspringen wenn excluded
        if exclude_hot_drop:
            hd = _detect_hot_drop(conn, m["match_id"], my_account_id,
                                   hot_drop_window_ms, hot_drop_window_secs)
            if hd["hotDrop"]:
                excluded_hot += 1
                continue
        result = _detect_first_fight(conn, m["match_id"], my_account_id,
                                       cluster_ms, cluster_radius_cm)
        if result is None:
            # Backend findet keine Squad-Combat-Events. Praktisch nie —
            # falls doch, als 'fled' (nicht detektierbar) behandeln.
            total += 1
            fled_total += 1
            sparkline.append(0)
            per_match.append({
                "matchId": m["match_id"],
                "hadFight": False,
                "engaged": False,
                "soloSurvived": False,
                "teamSurvived": False,
            })
            continue
        total += 1
        # 'engaged' = im Cluster ist mindestens 1 Kill passiert
        # (egal welche Seite). Damit gilt:
        #   - Squad hat enemy gekillt -> Win
        #   - Enemy hat Squad-Member gekillt -> Loss / team-saved
        #   - Schiesserei mit Damage/Knocks aber niemand stirbt -> fled
        #     (Stalemate / Disengage, kein definitiver Outcome)
        engaged = bool(result.get("has_kill"))
        if engaged:
            engaged_total += 1
            teams_per_fight.append(result["teams_count"])
        else:
            fled_total += 1
        # Solo/Team counts ueber ALLE detected matches — wenn Squad
        # nach Disengage uebellebt, zaehlt das als Win (User-Sicht).
        if result["soloSurvived"]:
            solo_survived_n += 1
        if result["teamSurvived"]:
            team_survived_n += 1
        sparkline.append(1 if result["teamSurvived"] else 0)
        per_match.append({
            "matchId": m["match_id"],
            "hadFight": True,
            "engaged": engaged,
            "soloSurvived": result["soloSurvived"],
            "teamSurvived": result["teamSurvived"],
        })

    avg_teams = (sum(teams_per_fight) / len(teams_per_fight)) if teams_per_fight else 0
    max_teams = max(teams_per_fight) if teams_per_fight else 0
    # Headline-Rate ist Team-Sicht (User wollte 'Won X of Y' team).
    team_rate = (team_survived_n / total * 100) if total else 0
    solo_rate = (solo_survived_n / total * 100) if total else 0
    return {
        # Legacy-Felder — 'rate'/'survived' jetzt Team-basiert.
        "rate": team_rate,
        "survived": team_survived_n,
        "total": total,
        "sparkline": sparkline[-20:],
        # Getrennte Solo/Team-Sicht
        "soloSurvived": solo_survived_n,
        "teamSurvived": team_survived_n,
        "soloSurvivalRate": solo_rate,
        "teamSurvivalRate": team_rate,
        "engagedTotal": engaged_total,
        "fledTotal": fled_total,
        "perMatch": per_match[-20:],
        "avgTeams": round(avg_teams, 2),
        "maxTeams": max_teams,
        "excludedHotDrop": excluded_hot,
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

    # Alle Combat-Events des Matches, sortiert nach Zeit. Damage zaehlt
    # auch als Engagement (Long-Range-Schiesserei ohne Knock ist genau
    # so 'erster Squad-Combat' wie ein Knock). actor_account muss != NULL
    # sein - filtert Storm/Vehicle/Fall-Damage raus, die haben keinen
    # Attacker.
    events = conn.execute("""
        SELECT event_type, actor_account, target_account, timestamp_ms,
               actor_x, actor_y, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ? AND event_type IN ('Kill', 'Knock', 'TakeDamage')
          AND actor_account IS NOT NULL
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

    # Beteiligte Teams: nur Teams die DIREKT mit dem Squad gekämpft
    # haben (= Squad ist Attacker oder Victim im Event). Vorher zählten
    # auch 3rd-party-Teams die zufällig im Cluster-Radius kämpften ohne
    # uns zu touchen — das hat avgTeams künstlich aufgebläht (Max 15).
    lobby_team_map = dict(conn.execute("""
        SELECT account_id, team_id FROM match_team_mapping
        WHERE match_id = ?
    """, (match_id,)).fetchall())
    full_team_map = lobby_team_map if lobby_team_map else acc_to_team
    teams = set()
    for e in cluster:
        a, v = e["actor_account"], e["target_account"]
        a_in_squad = a in squad_ids
        v_in_squad = v in squad_ids
        if a_in_squad and v_in_squad:
            continue  # Friendly fire intern — kein Gegner-Team
        if not (a_in_squad or v_in_squad):
            continue  # 3rd-party-Fight ohne uns
        opponent = v if a_in_squad else a
        opp_team = full_team_map.get(opponent)
        if opp_team is not None and opp_team != my_team_id:
            teams.add(opp_team)

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
    # Solo: bin ICH (my_account_id) im Cluster als Kill-Victim?
    solo_survived = my_account_id not in squad_down_in_fight
    first_event = cluster[0]
    # 'has_kill' = irgendein Kill im Cluster (egal welche Seite). Ohne
    # Kill ist der Fight nicht entschieden -> Disengage/Stalemate.
    has_kill = any(e["event_type"] == "Kill" for e in cluster)
    return {
        "won": won,
        "soloSurvived": solo_survived,
        "teamSurvived": won,
        "teams_count": len(teams),
        "fight_duration_s": fight_duration_s,
        "events_count": len(cluster),
        "has_kill": has_kill,
        "squad_killed_in_fight": len(squad_down_in_fight),
        "first_event_type": first_event["event_type"],
        "first_actor_is_squad": first_event["actor_account"] in squad_ids,
        "first_target_is_squad": first_event["target_account"] in squad_ids,
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

    def _squad_lobby_for(match_ids):
        """Squad-K/D + Lobby-K/D für eine Match-ID-Liste.
        Squad = my_team_id pro Match. Squad-K/D = SUM(team_kills) /
        SUM(team_deaths). Death pro Mate = time_survived < duration-5
        (Toleranz für Rundungs-Unschärfe). Wenn time_survived fehlt
        (Schema 3): Fallback team_size_if_lost.
        Beispiel Duo, beide tot, 9 kills: 9/2 = 4.5. Win mit 1 toten
        Mate: kills/1 statt kills/0."""
        out = {"squadKills": 0, "squadKd": 0, "squadKillsPerMatch": 0,
               "squadMatchesWithMapping": 0,
               "lobbyKd": 0, "lobbyMatchesWithMapping": 0,
               "lobbyTop3Kd": 0, "lobbyTop3Kills": 0,
               "lobbyTop3Matches": 0}
        if not match_ids:
            return out
        # Top-3-Lobby-Indikator (separat vom Squad-Aggregat)
        top3 = compute_lobby_top3_kd(conn, my_account_id, match_ids=match_ids)
        out["lobbyTop3Kd"] = top3["top3Kd"]
        out["lobbyTop3Kills"] = top3["top3Kills"]
        out["lobbyTop3Matches"] = top3["matches"]
        ph_id = ",".join("?" * len(match_ids))
        # Squad-Aggregate (mit time_survived basiertem Death-Count)
        sq_rows = conn.execute(f"""
            WITH my_teams AS (
              SELECT match_id, team_id FROM match_team_mapping
              WHERE account_id = ? AND match_id IN ({ph_id})
            )
            SELECT mtm.match_id, m.duration_secs,
                   SUM(COALESCE(mtm.kills, 0)) AS sq_kills,
                   COUNT(*)                     AS team_size,
                   SUM(CASE WHEN mtm.time_survived IS NOT NULL
                              AND mtm.time_survived < m.duration_secs - 5
                            THEN 1 ELSE 0 END)  AS sq_deaths_real,
                   SUM(CASE WHEN mtm.time_survived IS NULL THEN 1 ELSE 0 END)
                                                AS sq_no_surv,
                   MAX(CASE WHEN mtm.place=1 THEN 1 ELSE 0 END) AS sq_won
            FROM match_team_mapping mtm
            JOIN my_teams mt ON mt.match_id = mtm.match_id
                              AND mt.team_id = mtm.team_id
            JOIN matches m   ON m.match_id  = mtm.match_id
            WHERE mtm.kills IS NOT NULL
            GROUP BY mtm.match_id
        """, [my_account_id] + match_ids).fetchall()
        sq_kills = 0
        sq_deaths = 0
        for r in sq_rows:
            sq_kills += r["sq_kills"] or 0
            if r["sq_no_surv"]:
                # Fallback (Schema 3): alle tot wenn nicht gewonnen
                sq_deaths += 0 if r["sq_won"] else (r["team_size"] or 0)
            else:
                sq_deaths += r["sq_deaths_real"] or 0
        sq_n = len(sq_rows)
        out["squadKills"] = sq_kills
        out["squadMatchesWithMapping"] = sq_n
        out["squadKd"] = (sq_kills / max(sq_deaths, 1)) if sq_n else 0
        out["squadKillsPerMatch"] = (sq_kills / sq_n) if sq_n else 0
        # Lobby-Aggregate (wie compute_lobby_avg_kd: Ø lobbyKd pro Match)
        lo_rows = conn.execute(f"""
            SELECT match_id,
                   SUM(COALESCE(kills, 0)) AS l_kills,
                   COUNT(*)                AS l_n,
                   SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS l_wins
            FROM match_team_mapping
            WHERE match_id IN ({ph_id}) AND kills IS NOT NULL
            GROUP BY match_id
            HAVING l_n > 4
        """, match_ids).fetchall()
        if lo_rows:
            kds = [(r["l_kills"] or 0) / max((r["l_n"] or 0) - (r["l_wins"] or 0), 1)
                   for r in lo_rows]
            out["lobbyKd"] = sum(kds) / len(kds)
            out["lobbyMatchesWithMapping"] = len(kds)
        return out

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
        squad_lobby = _squad_lobby_for([x["match_id"] for x in ms])
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
            **squad_lobby,
        }

    # Total-Aggregate
    n = len(enriched)
    wins = sum(1 for x in enriched if (x["place"] or 99) == 1)
    total_kills = sum(x["kills"] or 0 for x in enriched)
    total_damage = sum(x["damage_dealt"] or 0 for x in enriched)
    total_surv = sum(x["time_survived"] or 0 for x in enriched)
    # Squad+Lobby-Aggregate über alle Matches der Range
    totals_squad_lobby = _squad_lobby_for([x["match_id"] for x in enriched])

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
        # Squad+Lobby-Aggregate (basiert auf match_team_mapping)
        **totals_squad_lobby,
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
