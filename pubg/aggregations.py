import datetime
from pubg.db import get_setting


# Battle-Royale-Modes — alles andere (TDM, War-Mode, Event-Modes, Labs,
# Esports) gilt als 'Event' und wird aus K/D / Win-Rate / Streak /
# Achievement-Detection ausgenommen. Allow-List: robust gegen neue
# Event-Modes die PUBG einfuehrt.
BATTLE_ROYALE_MODES = (
    "solo", "solo-fpp",
    "duo",  "duo-fpp",
    "squad","squad-fpp",
    "normal-solo", "normal-solo-fpp",
    "normal-duo",  "normal-duo-fpp",
    "normal-squad","normal-squad-fpp",
    "ranked-solo", "ranked-solo-fpp",
    "ranked-duo",  "ranked-duo-fpp",
    "ranked-squad","ranked-squad-fpp",
)
_BR_PLACEHOLDERS = ",".join("?" * len(BATTLE_ROYALE_MODES))

def _br_filter(alias="m"):
    """SQL-Fragment + Params um auf BR-Matches zu filtern.
    Beispiel: where, params = _br_filter('m')
              cursor.execute(f'... WHERE x AND {where}', [other_params, *params])"""
    return (f"{alias}.game_mode IN ({_BR_PLACEHOLDERS})",
            list(BATTLE_ROYALE_MODES))

def is_br_mode(game_mode):
    return game_mode in BATTLE_ROYALE_MODES


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
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.played_at,
               pa.kills, pa.damage_dealt, pa.place, pa.headshot_kills,
               pa.longest_kill, pa.boosts, pa.heals, pa.revives,
               pa.weapons_acquired, pa.walk_distance, pa.ride_distance,
               pa.swim_distance, pa.assists, pa.dbnos, pa.time_survived
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
          AND {br_where}
        ORDER BY m.played_at ASC
    """, (my_account_id, started, *br_params)).fetchall()

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
                             from_iso=None, to_iso=None,
                             include_events=True):
    """Flache Liste der Matches in der Range — leichtgewichtig.
    Genutzt von Streak-Counter, Session-Goal, Achievements etc.
    from_iso/to_iso überschreiben range_key (für historische Sessions).

    include_events=True (Default): Events bleiben in der Liste, sind
       aber mit isEvent=True markiert. Konsumer der Stats berechnet
       (compute_streaks, compute_session_achievements) sollten filtern.
    include_events=False: harter Filter — Events kommen gar nicht raus."""
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
    br_where = ""
    if not include_events:
        br_sql, br_params = _br_filter("m")
        br_where = f" AND {br_sql}"
        params = list(params) + br_params
    rows = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.game_mode, m.played_at,
               m.duration_secs,
               pa.kills, pa.damage_dealt, pa.place, pa.time_survived,
               pa.longest_kill, pa.headshot_kills, pa.assists, pa.dbnos
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?{end_filter}{br_where}
        ORDER BY m.played_at DESC
    """, params).fetchall()
    return [{
        "matchId":     r["match_id"],
        "map":         r["map_name"],
        "mode":        r["game_mode"],
        "isEvent":     not is_br_mode(r["game_mode"]),
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
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
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
          AND {br_where}
        GROUP BY m.match_id
        HAVING lobby_n > 4   -- nur Matches mit echtem Lobby-Mapping
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff, *br_params)).fetchall()

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

    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        WITH my_teams AS (
          SELECT mtm.match_id, mtm.team_id
          FROM match_team_mapping mtm
          JOIN matches m ON m.match_id = mtm.match_id
          WHERE mtm.account_id = ? AND m.played_at >= ?
            AND {br_where}
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
    """, (my_account_id, cutoff, *br_params)).fetchall()

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
    # current = letzter laufender Streak am Ende.
    # Event-Modes (TDM, PAYDAY etc.) sind ausgenommen — Place=1 in Events
    # bedeutet nicht Chicken-Win.
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT m.match_id, m.played_at, p.place, p.kills
        FROM matches m
        JOIN participants p ON p.match_id = m.match_id
        WHERE p.account_id = ? AND m.played_at >= ?
          AND {br_where}
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff, *br_params)).fetchall()

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
        br_where, br_params = _br_filter("m")
        sql = f"""
            SELECT SUM(p.kills) AS k, COUNT(*) AS n,
                   SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w,
                   AVG(p.damage_dealt) AS avg_dmg
            FROM participants p JOIN matches m ON m.match_id = p.match_id
            WHERE p.account_id = ? AND m.played_at >= ?
              AND {br_where}
        """
        params = [my_account_id, start, *br_params]
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


# PAYDAY/Heist-Item-Klassifizierung. Mapping ItemId -> Display-Kategorie.
# Items die nicht hier auftauchen werden als 'other' gruppiert.
PAYDAY_LOOT_LABELS = {
    "Item_MoneyBagged":             ("Money Bag",     "💰"),
    "Item_GoldBricks_0":            ("Gold Brick",    "🟨"),
    "Item_JewelryBox_01":           ("Jewelry Box",   "💎"),
    "Item_Neon_Coin_HR_C":          ("Neon Coin",     "🪙"),
    "Item_KeyCard_01_B":            ("Keycard",       "🗝️"),
    "Item_Breaching_C4_0":          ("Breaching C4",  "💣"),
    "Item_Breaching_Fuel_Oxygen_0": ("Oxygen Tank",   "🧪"),
    "Item_Thermal_Lance_Bag_0":     ("Thermal Lance", "🔥"),
    "Item_Bodybag_HR":              ("Bodybag",       "🧳"),
    "Item_Weapon_Crowbar_HR_C":     ("Crowbar",       "🔧"),
}


def compute_payday_stats(conn, my_account_id, range_key="all",
                         from_iso=None, to_iso=None):
    """Pro PAYDAY/Event-Match: echte Stats aus Telemetry rekonstruieren
    (PUBG-Match-Summary liefert 0/0/win, ist Schrott).

    Returns dict { matches: [{matchId, playedAt, mapName, gameMode,
        myKills, myDamage, squadKills, squadDamage,
        loot: {itemId: count, ...}, lootTotal,
        windows, doors, ...}], totals: {...} }
    """
    cutoff = (_range_filter(conn, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")
    if from_iso: cutoff = from_iso
    end_filter = " AND m.played_at <= ?" if to_iso else ""
    params = [my_account_id, cutoff]
    if to_iso: params.append(to_iso)

    # Alle Event-Matches (= nicht BR) in der Range
    br_where, br_params = _br_filter("m")
    matches = conn.execute(f"""
        SELECT m.match_id, m.played_at, m.map_name, m.game_mode,
               pa.team_id
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?{end_filter}
          AND NOT {br_where}
        ORDER BY m.played_at DESC
    """, params + br_params).fetchall()
    if not matches:
        return {"matches": [], "totals": {}}

    out_matches = []
    for m in matches:
        mid = m["match_id"]
        team = m["team_id"]
        # Squad-Account-IDs in dem Match
        squad = [r["account_id"] for r in conn.execute(
            "SELECT account_id FROM participants WHERE match_id=? AND team_id=?",
            (mid, team)).fetchall()]
        if not squad:
            continue
        ph = ",".join("?" * len(squad))

        # Eigene Kills aus Telemetry
        my_kills = conn.execute(
            f"SELECT COUNT(*) FROM telemetry_events "
            f"WHERE match_id=? AND event_type='Kill' AND actor_account=?",
            (mid, my_account_id)).fetchone()[0]
        # Eigener Damage (Sum von TakeDamage als attacker)
        my_dmg = conn.execute(
            "SELECT COALESCE(SUM(damage), 0) FROM telemetry_events "
            "WHERE match_id=? AND event_type='TakeDamage' AND actor_account=?",
            (mid, my_account_id)).fetchone()[0] or 0
        # Squad-Aggregat (incl. self)
        sq_kills = conn.execute(
            f"SELECT COUNT(*) FROM telemetry_events "
            f"WHERE match_id=? AND event_type='Kill' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone()[0]
        sq_dmg = conn.execute(
            f"SELECT COALESCE(SUM(damage), 0) FROM telemetry_events "
            f"WHERE match_id=? AND event_type='TakeDamage' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone()[0] or 0

        # Per-Mate-Breakdown: Kills + DMG pro Squad-Member.
        # PUBG-API liefert in Events keine Player-Stats → wir
        # rekonstruieren das aus Telemetry. Name kommt aus players-
        # Tabelle (account_id -> name), Fallback name=account_id.
        mate_kills = {r["actor_account"]: r["k"] for r in conn.execute(
            f"SELECT actor_account, COUNT(*) AS k FROM telemetry_events "
            f"WHERE match_id=? AND event_type='Kill' "
            f"AND actor_account IN ({ph}) GROUP BY actor_account",
            [mid, *squad]).fetchall()}
        mate_dmg = {r["actor_account"]: float(r["d"] or 0) for r in conn.execute(
            f"SELECT actor_account, COALESCE(SUM(damage),0) AS d "
            f"FROM telemetry_events "
            f"WHERE match_id=? AND event_type='TakeDamage' "
            f"AND actor_account IN ({ph}) GROUP BY actor_account",
            [mid, *squad]).fetchall()}
        mate_loot = {}
        for r in conn.execute(
            f"SELECT actor_account, COUNT(*) AS c FROM telemetry_events "
            f"WHERE match_id=? AND event_type='ItemPickup' "
            f"AND actor_account IN ({ph}) AND weapon IS NOT NULL "
            f"GROUP BY actor_account", [mid, *squad]).fetchall():
            mate_loot[r["actor_account"]] = r["c"]
        # Account-ID -> Name. Fallback Account-ID-Kuerzung.
        names = {r["account_id"]: r["name"] for r in conn.execute(
            f"SELECT account_id, name FROM players "
            f"WHERE account_id IN ({ph})", squad).fetchall()}
        mates = []
        for acc in squad:
            mates.append({
                "name":   names.get(acc, acc[:12]),
                "isSelf": acc == my_account_id,
                "kills":  mate_kills.get(acc, 0),
                "damage": mate_dmg.get(acc, 0.0),
                "loot":   mate_loot.get(acc, 0),
            })
        # Self oben, Rest nach DMG absteigend.
        mates.sort(key=lambda x: (not x["isSelf"], -x["damage"]))

        # Loot-Pickups (Squad) — gruppiert nach itemId
        loot = {}
        for r in conn.execute(
            f"SELECT weapon AS item_id, COUNT(*) AS c "
            f"FROM telemetry_events WHERE match_id=? "
            f"AND event_type='ItemPickup' AND actor_account IN ({ph}) "
            f"AND weapon IS NOT NULL GROUP BY weapon",
            [mid, *squad]).fetchall():
            loot[r["item_id"]] = r["c"]

        # Objects (Window destroy, Door open) Squad
        windows = conn.execute(
            f"SELECT COUNT(*) FROM telemetry_events WHERE match_id=? "
            f"AND event_type='ObjectDestroy' AND weapon='Window' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone()[0]
        doors_opened = conn.execute(
            f"SELECT COUNT(*) FROM telemetry_events WHERE match_id=? "
            f"AND event_type='ObjectInteraction' AND weapon='Door:Opening' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone()[0]

        out_matches.append({
            "matchId":    mid,
            "playedAt":   m["played_at"],
            "mapName":    m["map_name"],
            "gameMode":   m["game_mode"],
            "myKills":    my_kills,
            "myDamage":   float(my_dmg),
            "squadKills": sq_kills,
            "squadDamage": float(sq_dmg),
            "mates":      mates,
            "loot":       loot,
            "lootTotal":  sum(loot.values()),
            "windows":    windows,
            "doors":      doors_opened,
        })

    # Totals ueber alle Event-Matches
    tot = {
        "matches":     len(out_matches),
        "myKills":     sum(m["myKills"] for m in out_matches),
        "myDamage":    sum(m["myDamage"] for m in out_matches),
        "squadKills":  sum(m["squadKills"] for m in out_matches),
        "squadDamage": sum(m["squadDamage"] for m in out_matches),
        "windows":     sum(m["windows"] for m in out_matches),
        "doors":       sum(m["doors"] for m in out_matches),
        "loot":        {},
    }
    for m in out_matches:
        for k, v in m["loot"].items():
            tot["loot"][k] = tot["loot"].get(k, 0) + v
    tot["lootTotal"] = sum(tot["loot"].values())
    return {"matches": out_matches, "totals": tot,
            "labels": PAYDAY_LOOT_LABELS}


def compute_map_performance(conn, my_account_id, range_key="all"):
    """Pro Map: Matches, Wins, K/D, Ø Kills/DMG/Place/Surv.
    range_key: 'session' | 'day' | 'week' | 'all'."""
    cutoff = _range_filter(conn, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
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
          AND {br_where}
        GROUP BY m.map_name
        ORDER BY matches DESC
    """, (my_account_id, cutoff, *br_params)).fetchall()
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


# Kill-Match-Tiers: jeder Tier den ein Match erreicht wird emittiert
# (kumulativ), aber im Popup feuert nur der hoechste. Das gibt dem
# Browser saubere 'Sessions die mind. ≥N Kills hatten'-Pcts, ohne
# Popup-Spam.
KILL_TIERS = [
    (20, "kills_20", "20-Bomb"),
    (15, "kills_15", "Annihilation"),
    (10, "kills_10", "Massacre"),
    (7,  "kills_7",  "Slaughterhouse"),
    (5,  "kills_5",  "Killing Survivor"),
]
DAMAGE_TIERS = [
    (3000, "damage_3000", "GODLIKE"),
    (2500, "damage_2500", "Damage Lord"),
    (2000, "damage_2000", "Damage Demon"),
    (1500, "damage_1500", "Big Damage"),
    (1000, "damage_1000", "Damage Dealer"),
    (500,  "damage_500",  "Heavy Hitter"),
]
LONGEST_KILL_TIERS = [
    (1000, "longest_kill_1000", "Kilometer Kill"),
    (800,  "longest_kill_800",  "Cross-Map Connection"),
    (600,  "longest_kill_600",  "Sniper Elite"),
    (400,  "longest_kill_400",  "Long-Range Ranger"),
]


def _emit_tier_cascade(out, seen, tiers, value, value_label_fn,
                       match_id, played):
    """Emittiert alle erreichten Tiers fuer einen Wert (Kills, DMG,
    Longest-Kill). tiers ist DESC sortiert. Nur der hoechste poppt,
    die anderen werden mit suppressPopup=True markiert.
    seen filtert Duplikate auf Session-Ebene damit nicht jeder Match
    nochmal alle Tiers reinwirft."""
    qualifying = [(t, aid, name) for t, aid, name in tiers if value >= t]
    if not qualifying:
        return
    new_emits = [(t, aid, name) for t, aid, name in qualifying
                 if aid not in seen]
    if not new_emits:
        return
    for i, (threshold, aid, name) in enumerate(new_emits):
        out.append({
            "id": aid,
            "label": f"{name} · {value_label_fn(value)}",
            "icon": "🔥",
            "matchId": match_id,
            "playedAt": played,
            "suppressPopup": i > 0,  # nur der erste (hoechste) poppt
        })
        seen.add(aid)


def compute_session_achievements(conn, my_account_id, from_iso=None, to_iso=None):
    """Detected Achievements der aktuellen oder einer historischen Session.
    from_iso/to_iso optional — sonst aktuelle Session.

    Achievements (max. 1 pro Typ pro Session ausser Tier-Cascades und
    Streaks/Counters):
      - first_chicken / first_top10 / session_opener_*: jeweils einmal
      - beast_chicken: place==1 + kills>=5, mehrfach
      - phoenix_chicken: erster Hot-Drop-Chicken-Win der Session
      - Kill-Tiers   : kills_5/_7/_10/_15/_20 (kumulativ; nur hoechster
                       NEUER Tier poppt, Rest mit suppressPopup in DB)
      - DMG-Tiers    : damage_500/.../damage_3000 (gleiche Logik)
      - Longest-Kill : longest_kill_400/_600/_800/_1000 (gleiche Logik)
      - hot_drop_match / hot_drop_match_survived: x-N-Counter
      - top3_streak / top10_streak / chicken_streak: ab x2, mehrfach

    Returns Liste { id, label, icon, matchId, playedAt } sortiert
    nach playedAt ASC (Reihenfolge des Erreichens).
    """
    # Event-Modes (TDM, PAYDAY etc.) werden hart gefiltert — keine
    # Achievements/Milestones aus Event-Matches.
    matches_desc = compute_session_matches(
        conn, my_account_id, "session",
        from_iso=from_iso, to_iso=to_iso,
        include_events=False)
    matches = list(reversed(matches_desc))  # ASC für Achievement-Reihenfolge

    out = []
    seen = set()
    win_seen = False
    top10_seen = False

    # Session-Opener: erster Match der Session war direkt ein Top-10
    # oder sogar ein Chicken. Mutual exclusive — Chicken trumps Top-10,
    # damit kein redundantes Popup kommt (Chicken ist inherently Top-10).
    if matches:
        first_m = matches[0]
        first_place = first_m["place"] or 99
        if first_place == 1:
            out.append({
                "id": "session_opener_chicken",
                "label": "Cold Start Chicken",
                "icon": "🔥",
                "matchId": first_m["matchId"],
                "playedAt": first_m["playedAt"],
            })
        elif first_place <= 10:
            out.append({
                "id": "session_opener_top10",
                "label": f"Pretty Good Start · #{first_place}",
                "icon": "🏆",
                "matchId": first_m["matchId"],
                "playedAt": first_m["playedAt"],
            })
    # Streaks: laufende Laenge tracken, bei jedem neuen Peak (≥2)
    # ein Achievement emitten. Bei Break (Match ausserhalb Bedingung)
    # auf 0 zuruecksetzen. Pro Streak-Run koennen mehrere Peaks emitten
    # (x2, x3, x4, ...) — Browser-Aggregat klappt sie zusammen.
    top3_streak = 0
    top10_streak = 0
    chicken_streak = 0
    for m in matches:
        place = m["place"] or 99
        kills = m["kills"] or 0
        damage = m["damage"] or 0
        longest = m["longestKill"] or 0
        played = m["playedAt"]

        # 100 Einheiten = 1 Meter (Telemetry/PUBG-Welt)
        longest_m = longest if longest < 50 else longest / 100  # Fallback

        # Icon-Regel: nur 🔥 für 'geile' Achievements, sonst kein Icon.
        if not win_seen and place == 1:
            out.append({
                "id": "first_chicken",
                "label": "Dinner Served",
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
                "label": "Endgame Initiate",
                "icon": "🏆",
                "matchId": m["matchId"], "playedAt": top10_ts or played,
            })
            top10_seen = True
            seen.add("first_top10")

        # Longest-Kill-Tier-Cascade: jeder erreichte Tier (400/600/800/
        # 1000m) wird einmal pro Session emittiert. Nur der hoechste
        # NEUE Tier poppt; die anderen landen mit suppressPopup in DB
        # damit '% mit ≥400m'-Stat korrekt bleibt.
        _emit_tier_cascade(
            out, seen, LONGEST_KILL_TIERS, int(longest_m),
            lambda v: f"{v}m", m["matchId"], played)

        # Kill-Tier-Cascade: 5/7/10/15/20+
        _emit_tier_cascade(
            out, seen, KILL_TIERS, int(kills),
            lambda v: f"{v} Kills", m["matchId"], played)

        # Damage-Tier-Cascade: 500..3000+
        _emit_tier_cascade(
            out, seen, DAMAGE_TIERS, int(damage),
            lambda v: f"{v} DMG", m["matchId"], played)

        if place == 1 and kills >= 5:
            # Chicken-Tier-Cascade: alle erreichten Tiers in DB, nur
            # hoechster poppt. Tiers: beast (5+), ultra (10+), god (15+).
            # Mehrfach pro Session moeglich — PK (achievement_id, match_id)
            # garantiert Eindeutigkeit.
            tiers = []
            if kills >= 15:
                tiers.append(("god_mode_chicken", "God Mode Chicken"))
            if kills >= 10:
                tiers.append(("ultra_chicken", "Ultra Chicken"))
            tiers.append(("beast_chicken", "Beast Chicken"))
            # Sortierung: hoechster zuerst (poppt), Rest mit suppressPopup
            for i, (aid, name) in enumerate(tiers):
                out.append({
                    "id": aid,
                    "label": f"{name} · {kills} Kills",
                    "icon": "🔥",
                    "matchId": m["matchId"], "playedAt": played,
                    "suppressPopup": i > 0,
                })

        # Top-10-Streak: pro Match-Peak ab x2 ein eigenes Achievement.
        # Match-ID kommt aus dem PEAK-Match (also dem der die Streak
        # auf die jeweilige Laenge gebracht hat). PK (achievement_id,
        # match_id) verhindert Duplikate; bei jedem neuen Peak wird
        # eine neue Zeile angelegt.
        if place <= 10:
            top10_streak += 1
            if top10_streak >= 2:
                out.append({
                    "id": "top10_streak",
                    "label": f"Endgame Streak ×{top10_streak}",
                    "icon": "🔥",
                    "matchId": m["matchId"],
                    "playedAt": played,
                })
        else:
            top10_streak = 0

        # Top-3-Streak: gleiche Logik, Schwelle ab x2.
        if place <= 3:
            top3_streak += 1
            if top3_streak >= 2:
                out.append({
                    "id": "top3_streak",
                    "label": f"Podium Streak ×{top3_streak}",
                    "icon": "🔥",
                    "matchId": m["matchId"],
                    "playedAt": played,
                })
        else:
            top3_streak = 0

        # Chicken-Streak: gleiche Logik, Schwelle ab x2.
        if place == 1:
            chicken_streak += 1
            if chicken_streak >= 2:
                out.append({
                    "id": "chicken_streak",
                    "label": f"Dinner Streak ×{chicken_streak}",
                    "icon": "🔥",
                    "matchId": m["matchId"],
                    "playedAt": played,
                })
        else:
            chicken_streak = 0

    # PAYDAY/Event-Achievements ueber alle Event-Matches in der Range.
    # Skala deutlich hoeher als BR — typische Heist-Matches gehen
    # 25-100+ Kills + 5k-20k DMG. Plus Stealth-Milestones.
    HEIST_KILL_TIERS = [
        # 25 war zu trivial in PAYDAY — NPC-Mob spawnt staendig nach.
        (100, "heist_kills_100", "Heist God"),
        ( 75, "heist_kills_75",  "Heist Annihilation"),
        ( 50, "heist_kills_50",  "Heist Massacre"),
    ]
    HEIST_DAMAGE_TIERS = [
        # 5k war zu trivial — schon 30 NPCs auf Body-Shots reichen.
        # Untergrenze auf 8k angehoben, Tiers entsprechend skaliert.
        (25000, "heist_dmg_25k", "Heist GODLIKE"),
        (20000, "heist_dmg_20k", "Heist Damage Lord"),
        (15000, "heist_dmg_15k", "Heist Damage Demon"),
        ( 8000, "heist_dmg_8k",  "Heist Heavy"),
    ]
    HEIST_LOOT_TIERS = [
        # Thresholds rescaled — 10/25/40 wurden in jedem Heist erreicht.
        # Neue Skala: 25 (solide Mitnahme), 60 (richtig fett), 120 (Beute-Boss).
        (120, "heist_loot_120", "Mega Heist"),
        ( 60, "heist_loot_60",  "Big Heist"),
        ( 25, "heist_loot_25",  "Solid Heist"),
    ]
    try:
        payday = compute_payday_stats(
            conn, my_account_id, "session",
            from_iso=from_iso, to_iso=to_iso)
        for pm in reversed(payday.get("matches") or []):
            mid = pm["matchId"]; played = pm["playedAt"]
            kills, dmg, loot_total = pm["myKills"], pm["myDamage"], pm["lootTotal"]

            # Kill-Tier-Cascade: alle erreichten in DB, nur hoechster popt
            kt = [(t, aid, name) for t, aid, name in HEIST_KILL_TIERS if kills >= t]
            for i, (_, aid, name) in enumerate(kt):
                out.append({
                    "id": aid,
                    "label": f"{name} · {kills} Kills",
                    "icon": "🔥",
                    "matchId": mid, "playedAt": played,
                    "suppressPopup": i > 0,
                })

            # Damage-Tier-Cascade
            dt = [(t, aid, name) for t, aid, name in HEIST_DAMAGE_TIERS if dmg >= t]
            for i, (_, aid, name) in enumerate(dt):
                out.append({
                    "id": aid,
                    "label": f"{name} · {int(dmg)} DMG",
                    "icon": "🔥",
                    "matchId": mid, "playedAt": played,
                    "suppressPopup": i > 0,
                })

            # Loot-Tier-Cascade
            lt = [(t, aid, name) for t, aid, name in HEIST_LOOT_TIERS if loot_total >= t]
            for i, (_, aid, name) in enumerate(lt):
                out.append({
                    "id": aid,
                    "label": f"{name} · {loot_total} Items",
                    "icon": "💎",
                    "matchId": mid, "playedAt": played,
                    "suppressPopup": i > 0,
                })

            # Spezifische Loot-Items (nur einmal pro Match)
            if pm["loot"].get("Item_GoldBricks_0", 0) >= 1:
                gold_n = pm["loot"]["Item_GoldBricks_0"]
                out.append({
                    "id": "gold_brick_grab",
                    "label": f"Gold Brick Heist · {gold_n}× Gold",
                    "icon": "🟨",
                    "matchId": mid, "playedAt": played,
                })
            if pm["loot"].get("Item_MoneyBagged", 0) >= 1:
                bag_n = pm["loot"]["Item_MoneyBagged"]
                out.append({
                    "id": "money_bag_run",
                    "label": f"Money Bag Run · {bag_n}× Bag",
                    "icon": "💰",
                    "matchId": mid, "playedAt": played,
                })

            # Stealth-Milestones — 0 Kills im Heist (= kein Schuss gemacht).
            # "No Alarm" proxy: keine Telemetrie zur Alarm-Erkennung in PUBG
            # API verfuegbar, also nutzen wir 0-kills als Annaeherung.
            if kills == 0 and loot_total >= 1:
                out.append({
                    "id": "silent_heist",
                    "label": f"Silent Heist · {loot_total} Loot, 0 Kills",
                    "icon": "🤫",
                    "matchId": mid, "playedAt": played,
                })
            if kills == 0 and dmg == 0 and loot_total >= 10:
                out.append({
                    "id": "ghost_operative",
                    "label": f"Ghost Operative · {loot_total} Loot, 0 DMG",
                    "icon": "👻",
                    "matchId": mid, "playedAt": played,
                })
            # Window Smasher: 30+ Fenster (war 20+)
            if pm["windows"] >= 30:
                out.append({
                    "id": "window_smasher",
                    "label": f"Window Smasher · {pm['windows']} Windows",
                    "icon": "🪟",
                    "matchId": mid, "playedAt": played,
                })
    except Exception:
        pass

    # Hot-Drop-Achievements: Inferno Begins + Inferno Survivor sind
    # STREAK-Counter (nicht Session-Total). Cold-Drop bricht beide.
    # Inferno Survivor bricht zusaetzlich wenn der Spieler den Hot-Drop
    # nicht ueberlebt.
    # Phoenix Chicken: Chicken-Win aus einem Hot-Drop heraus — super rar.
    # perMatch ist DESC sortiert → reversed für ASC = ältestes zuerst.
    try:
        hd = compute_hot_drop(conn, my_account_id, "session",
                               from_iso=from_iso, to_iso=to_iso)
        hot_drop_streak = 0
        hot_drop_survived_streak = 0
        phoenix_seen = False
        for pm in reversed(hd.get("perMatch") or []):
            if not pm.get("hotDrop"):
                # Cold-Drop bricht BEIDE Streaks
                hot_drop_streak = 0
                hot_drop_survived_streak = 0
                continue
            hot_drop_streak += 1
            # Burning Hell uebersteuert Inferno Begins als Hot-Drop-
            # Hauptmeldung — wenn 5+ Teams im Radius, popt nur Burning
            # Hell. Inferno bleibt in DB als suppressed Eintrag.
            teams_in_radius = pm.get("teamsInRadius") or 0
            is_burning = teams_in_radius >= 5
            out.append({
                "id": "hot_drop_match",
                "label": f"Inferno Begins ×{hot_drop_streak}",
                "icon": "🔥",
                "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                "suppressPopup": is_burning,
            })
            if is_burning:
                out.append({
                    "id": "burning_hell",
                    "label": f"Burning Hell · {teams_in_radius} Teams",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
            if pm.get("soloSurvived"):
                hot_drop_survived_streak += 1
                out.append({
                    "id": "hot_drop_match_survived",
                    "label": f"Inferno Survivor ×{hot_drop_survived_streak}",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
            else:
                # Hot-Drop nicht ueberlebt → Survived-Streak bricht
                # (Inferno-Streak laeuft weiter — du WARST ja drin).
                hot_drop_survived_streak = 0
            if not phoenix_seen and pm.get("place") == 1:
                out.append({
                    "id": "phoenix_chicken",
                    "label": "Phoenix Chicken",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
                phoenix_seen = True
    except Exception:
        pass

    out.sort(key=lambda a: a.get("playedAt") or "")
    return out


# Welche Achievement-IDs als 'rare' im Popup zaehlen (gold-glow + biglvlup.wav).
# Konservativ — die Kandidaten die wirklich krass sind:
PUBG_RARE_ACHIEVEMENTS = {
    "beast_chicken",                 # Chicken + ≥5 Kills
    "ultra_chicken",                 # Chicken + ≥10 Kills
    "god_mode_chicken",              # Chicken + ≥15 Kills
    "burning_hell",                  # Hot-Drop mit 5+ Teams im Radius
    "gold_brick_grab",               # Squad-Loot: Goldbarren
    "heist_kills_75", "heist_kills_100",  # sehr hohe Heist-Kill-Tiers
    "heist_dmg_20k", "heist_dmg_25k",     # sehr hohes Heist-DMG
    "heist_loot_60", "heist_loot_120",    # Big/Mega-Heist (Top-Tiers rare)
    "silent_heist", "ghost_operative",    # Stealth
    "window_smasher",                # 30+ Fenster im Heist
    "session_opener_chicken",        # Session startet direkt mit Chicken
    "phoenix_chicken",               # Chicken-Win nach Hot-Drop
    "kills_15",                      # 15+ Kills
    "kills_20",                      # 20+ Kills (20-Bomb)
    "damage_2500",                   # 2500+ DMG
    "damage_3000",                   # GODLIKE-DMG
    "longest_kill_800",              # 800m+ Snipe
    "longest_kill_1000",             # Kilometer-Kill
    "hot_drop_match_survived",       # ueberlebtes Hot-Drop (jedes)
    "first_hot_drop_survived",       # legacy alias (Pre-Counter-Migration)
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
    nicht popupt (fuer Backfill).
    Per-row flag 'suppressPopup' (camelCase) ueberschreibt das fuer
    einzelne Eintraege — z.B. wenn eine 900m-Kill alle drei Tiers
    (400/600/800) in die DB schreibt, aber nur das hoechste poppen
    soll."""
    import time as _t
    new_count = 0
    now_ts = int(_t.time())
    for a in achievements:
        aid = a.get("id")
        mid = a.get("matchId")
        if not aid or not mid:
            continue
        row_suppress = suppress_popup or bool(a.get("suppressPopup"))
        displayed_at = now_ts if row_suppress else None
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


def _migrate_legacy_achievement_ids(conn):
    """Rename alte Achievement-IDs auf die neuen Tier-IDs. Idempotent.
    Migration:
      - five_kill_match -> kills_5
      - first_hot_drop -> hot_drop_match (label wird auf 'Inferno Begins ×1' geupdated)
      - first_hot_drop_survived -> hot_drop_match_survived (label 'Inferno Survivor ×1')
    Bei Konflikt (neue ID existiert bereits fuer diesen Match) wird der
    alte Eintrag geloescht."""
    # 1) five_kill_match -> kills_5
    conn.execute("""
        UPDATE OR IGNORE pubg_achievements_seen
        SET achievement_id = 'kills_5'
        WHERE achievement_id = 'five_kill_match'
    """)
    conn.execute("""
        DELETE FROM pubg_achievements_seen
        WHERE achievement_id = 'five_kill_match'
    """)
    # 2) first_hot_drop -> hot_drop_match (×1 weil es das erste war)
    conn.execute("""
        UPDATE OR IGNORE pubg_achievements_seen
        SET achievement_id = 'hot_drop_match',
            label = 'Inferno Begins ×1'
        WHERE achievement_id = 'first_hot_drop'
    """)
    conn.execute("""
        DELETE FROM pubg_achievements_seen
        WHERE achievement_id = 'first_hot_drop'
    """)
    # 3) first_hot_drop_survived -> hot_drop_match_survived (×1)
    conn.execute("""
        UPDATE OR IGNORE pubg_achievements_seen
        SET achievement_id = 'hot_drop_match_survived',
            label = 'Inferno Survivor ×1'
        WHERE achievement_id = 'first_hot_drop_survived'
    """)
    conn.execute("""
        DELETE FROM pubg_achievements_seen
        WHERE achievement_id = 'first_hot_drop_survived'
    """)
    conn.commit()


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
    # Erst Legacy-IDs migrieren (idempotent), dann normal weiter
    _migrate_legacy_achievement_ids(conn)
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
                     window_secs=300, from_iso=None, to_iso=None):
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
    # Event-Modes raus — in TDM/PAYDAY gibt es keinen Parachute-Hot-Drop.
    br_where, br_params = _br_filter("m")
    matches = conn.execute(f"""
        SELECT m.match_id, m.played_at, m.map_name, pa.place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?{end_filter}
          AND {br_where}
        ORDER BY m.played_at DESC
    """, params + br_params).fetchall()

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
            "mapName":        m["map_name"],
            "place":          m["place"],
            "hotDrop":        result["hotDrop"],
            "soloSurvived":   result["soloSurvived"],
            "teamSurvived":   result["teamSurvived"],
            "teamsInFight":   result.get("teamsInFight", 0),
            "teamsInRadius":  result.get("teamsInRadius", 0),
            "landingX":       result.get("landingX"),
            "landingY":       result.get("landingY"),
        })
        if result["hotDrop"]:
            hot += 1
            teams_per_hot.append(result.get("teamsInFight", 0))
            teams_in_radius_per_hot.append(result.get("teamsInRadius", 0))
            if result["soloSurvived"]:
                solo_surv += 1
            if result["teamSurvived"]:
                team_surv += 1

    # Streak: vom neuesten Match rückwärts. Identische Logik wie das
    # Inferno-Survivor-Milestone (siehe compute_session_achievements):
    # Cold-Drop bricht den Streak, Hot-Drop-Tod bricht den Streak.
    # Nur konsekutive Hot-Drops mit Survival zaehlen.
    streak = 0
    for pm in per_match:
        if not pm["hotDrop"]:
            # Cold-Drop bricht den Survived-Streak
            break
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
        "perMatch":           per_match,
    }


# Map-Groessen in km — bestimmt den Hot-Drop-Radius. Kleine Maps
# (Karakin 2km, Haven 1km, Range 2km) haben drastisch andere Skalen
# als Erangel/Miramar/Vikendi (8km). Ein 500m-Radius auf Karakin
# deckt ~20% der Karte ab und produziert false-positives.
MAP_SIZE_KM = {
    "Baltic_Main":      8, "Erangel_Main":   8,
    "Desert_Main":      8, "Savage_Main":    4,
    "DihorOtok_Main":   8, "Tiger_Main":     8,
    "Kiki_Main":        8, "Neon_Main":      8,
    "Chimera_Main":     3, "Summerland_Main": 2,
    "Heaven_Main":      1, "Range_Main":     2,
}
# Hot-Drop-Radius proportional zur Map-Kantenlaenge. 8km → 300m,
# 4km → 150m, 3km → ~115m, 2km → 75m, 1km → ~38m.
# Faktor 37.5 (gerundet 38): auf 8km-Maps (Erangel, Miramar, Vikendi)
# entspricht das einer typischen Stadt-Innengrenze. Vorher 60 war zu
# grosszuegig — auf Vikendi z.B. 480m, viel zu loose.
HOT_DROP_RADIUS_PER_KM_M = 38


def _hot_drop_radius_cm(map_name):
    map_km = MAP_SIZE_KM.get(map_name, 8)  # default 8km bei unbekannt
    return int(map_km * HOT_DROP_RADIUS_PER_KM_M) * 100


def _detect_hot_drop(conn, match_id, my_account_id, window_ms, window_secs):
    """Pro Match: Hot-Drop ja/nein + Survival-Marker.

    Bezugspunkt = ECHTE Squad-Landung aus LogParachuteLanding-Events
    (NICHT geschätzt, NICHT Match-Start). Window = erste window_ms ab
    Squad-Landung. Wenn keine Landing-Events vorhanden (Telemetry
    fehlt/abgelaufen) → kein Hot-Drop ermittelbar.

    Der Hot-Drop-Radius skaliert mit Map-Groesse (siehe MAP_SIZE_KM).
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

    # Map fuer Radius-Skalierung
    map_row = conn.execute(
        "SELECT map_name FROM matches WHERE match_id = ?",
        (match_id,)).fetchone()
    map_name = map_row["map_name"] if map_row else None

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

    # Map-skalierter Radius (in cm).
    radius_cm = _hot_drop_radius_cm(map_name)
    radius_sq = radius_cm * radius_cm
    # Squad-Landing-Positionen fuer Spatial-Filter
    squad_pos = [(s["actor_x"], s["actor_y"]) for s in squad_landings
                  if s["actor_x"] is not None and s["actor_y"] is not None]

    def _in_hd_zone(x, y):
        if x is None or y is None or not squad_pos:
            return False
        for sx, sy in squad_pos:
            dx, dy = x - sx, y - sy
            if dx * dx + dy * dy <= radius_sq:
                return True
        return False

    # Combat-Events ab Squad-Landung bis +window_ms. TakeDamage zaehlt
    # mit, sonst werden Drop-Fights wo NUR Bullets fliegen aber niemand
    # stirbt/knocked verpasst. Positionen werden mitgezogen — nur Events
    # INNERHALB der Hot-Drop-Zone (Radius zur Squad-Landung) zaehlen.
    events = conn.execute("""
        SELECT actor_account, target_account, timestamp_ms, event_type,
               actor_x, actor_y, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('Kill', 'Knock', 'TakeDamage')
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
    # angegriffen wurden + nur Events IM Hot-Drop-Radius (Squad-
    # Landung als Anker). Schusswechsel die 3km weiter passieren
    # zaehlen nicht als Hot-Drop-Fight (z.B. Rotation, Vehicle-Fight).
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
        # Spatial-Check: Event muss in der HD-Zone passieren
        if not (_in_hd_zone(e["actor_x"], e["actor_y"])
                or _in_hd_zone(e["victim_x"], e["victim_y"])):
            continue
        # Squad ist beteiligt und im Radius → Hot-Drop-Combat
        hot_drop = True
        opponent = v if a_in_squad else a
        opp_team = full_team_map.get(opponent)
        if opp_team is not None and opp_team != my_team_id:
            teams_in_fight.add(opp_team)

    # Survival: direkter Death-Event-Check im Hot-Drop-Fenster.
    # Definition: Hot-Drop ueberlebt = kein Kill-Event mit target=me
    # innerhalb der ersten HD_SURVIVAL_WINDOW_MIN Minuten nach Landung.
    # (Vorher cluster-basiert mit 3-min-Stille-Logik; war zu brueckig —
    # Fights die 2+ Minuten nach Landing weitergehen wurden faelsch-
    # licherweise NICHT mehr als 'Hot-Drop-Death' gezaehlt.)
    HD_SURVIVAL_WINDOW_MIN = 5
    survival_cutoff_ms = landing_ms + HD_SURVIVAL_WINDOW_MIN * 60 * 1000
    killed_in_window = {r["target_account"] for r in conn.execute(f"""
        SELECT target_account FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Kill'
          AND target_account IN ({placeholders})
          AND timestamp_ms >= ?
          AND timestamp_ms <= ?
    """, [match_id] + list(squad_ids) + [landing_ms, survival_cutoff_ms])
                          .fetchall()}
    solo_alive = my_account_id not in killed_in_window
    team_alive = bool(squad_ids - killed_in_window)
    # Teams die im Radius zu IRGENDEINEM Squad-Member gelandet sind.
    # radius_cm/radius_sq/squad_pos sind oben definiert.
    teams_in_radius = set()
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

    # Hot-Drop = BEIDES: mind. 1 Gegner-Team im Radius beim Landing UND
    # Schusswechsel mit Squad in den ersten window_secs (Kill/Knock/
    # TakeDamage). Strenge AND-Regel — nur "Gegner gelandet UND es ist
    # wirklich was passiert" zaehlt. Vorher OR → false-positives bei
    # Stadt-Drops mit benachbarten aber friedlich gebliebenen Teams.
    is_hot_drop = bool(teams_in_radius) and hot_drop
    # Anker-Landing = erste Squad-Landung (used als Fight-Window-Start).
    # Coords als Tooltip-Info zurueckliefern.
    anchor_x = first_landing["actor_x"] if first_landing else None
    anchor_y = first_landing["actor_y"] if first_landing else None
    return {
        "hotDrop":         is_hot_drop,
        "soloSurvived":    solo_alive,
        "teamSurvived":    team_alive,
        "teamsInFight":    len(teams_in_fight),
        "teamsInRadius":   len(teams_in_radius),
        "landingX":        anchor_x,
        "landingY":        anchor_y,
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
               m.game_mode,
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
        # Sessions-Index zeigt total matches inkl Events, aber Wins nur BR
        n = len(ms)
        # game_mode steht hier in den row-Daten als Spalte
        wins = sum(1 for x in ms
                   if (x["place"] or 99) == 1 and is_br_mode(x["game_mode"]))
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

    # Session-Report listet auch Events (sichtbar im Match-List) aber die
    # Aggregat-Totals werden nur fuer BR-Matches gerechnet (siehe unten).
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

    # Event-Matches: PUBG-API liefert participants.kills/damage_dealt = 0
    # weil ihr System in Event-Modi keine Player-Stats trackt. Wir holen
    # echte Kills + Damage aus telemetry_events und packen sie in
    # SEPARATE Felder (effective_kills / effective_damage). Map-Performance
    # und die Match-Liste benutzen die effective_*-Werte; Top-Totals + K/D
    # bleiben unverpestet (Events zaehlen dort 0).
    event_match_ids = [x["match_id"] for x in enriched
                        if not is_br_mode(x.get("game_mode"))]
    kills_by_match = {}
    dmg_by_match = {}
    if event_match_ids:
        ph = ",".join("?" * len(event_match_ids))
        kills_by_match = {r["match_id"]: r["k"] for r in conn.execute(
            f"SELECT match_id, COUNT(*) AS k FROM telemetry_events "
            f"WHERE event_type='Kill' AND actor_account=? "
            f"AND match_id IN ({ph}) GROUP BY match_id",
            [my_account_id, *event_match_ids]).fetchall()}
        dmg_by_match = {r["match_id"]: float(r["d"] or 0) for r in conn.execute(
            f"SELECT match_id, COALESCE(SUM(damage), 0) AS d "
            f"FROM telemetry_events "
            f"WHERE event_type='TakeDamage' AND actor_account=? "
            f"AND match_id IN ({ph}) GROUP BY match_id",
            [my_account_id, *event_match_ids]).fetchall()}
    for x in enriched:
        if not is_br_mode(x.get("game_mode")):
            x["effective_kills"]  = kills_by_match.get(x["match_id"], 0)
            x["effective_damage"] = dmg_by_match.get(x["match_id"], 0.0)
        else:
            x["effective_kills"]  = x["kills"] or 0
            x["effective_damage"] = x["damage_dealt"] or 0

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
        # Aggregate-Stats nur ueber BR-Matches. Events bleiben in der
        # Match-Liste (Anzeige), zaehlen aber nicht fuer K/D, Wins etc.
        br_ms = [x for x in ms if is_br_mode(x.get("game_mode"))]
        ev_ms = [x for x in ms if not is_br_mode(x.get("game_mode"))]
        n = len(br_ms)
        wins = sum(1 for x in br_ms if (x["place"] or 99) == 1)
        # Member-Counts: wie oft war jeder dabei in dieser Phase (auch
        # Events zaehlen — du hast ja mit ihm/ihr gespielt)
        ph["memberCounts"] = {}
        for x in ms:
            for name in x["squadSet"]:
                ph["memberCounts"][name] = ph["memberCounts"].get(name, 0) + 1
        total_kills = sum(x["kills"] or 0 for x in br_ms)
        total_damage = sum(x["damage_dealt"] or 0 for x in br_ms)
        total_surv = sum(x["time_survived"] or 0 for x in br_ms)
        squad_lobby = _squad_lobby_for([x["match_id"] for x in br_ms])
        ph["stats"] = {
            "matches": n,
            "eventMatches": len(ev_ms),
            "wins": wins,
            "kills": total_kills,
            "damage": total_damage,
            "avgKills": total_kills / n if n else 0,
            "avgDamage": total_damage / n if n else 0,
            "avgPlace": (sum(x["place"] or 0 for x in br_ms) / n) if n else 0,
            "avgSurvivedSec": total_surv / n if n else 0,
            "kd": total_kills / max(n - wins, 1) if n else 0,
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
    # Events werden separat markiert. KD ist nur in BR-Modi sinnvoll;
    # Event-Modi haben kein DIED-Event und kein Placement → 'Perfekt'.
    map_stats = {}
    for x in enriched:
        mn = x["map_name"]
        is_event = not is_br_mode(x.get("game_mode"))
        if mn not in map_stats:
            map_stats[mn] = {"map": mn, "matches": 0, "wins": 0,
                              "kills": 0, "damage": 0.0,
                              "totalPlace": 0, "totalSurv": 0,
                              "eventMatches": 0, "brMatches": 0,
                              "deaths": 0}
        ms_ = map_stats[mn]
        ms_["matches"] += 1
        if is_event:
            ms_["eventMatches"] += 1
        else:
            ms_["brMatches"] += 1
            # Death = nicht gewonnen UND time_survived < duration_secs (Toleranz 5s)
            if (x["place"] or 99) != 1:
                dur = x.get("duration_secs") or 0
                surv = x.get("time_survived") or 0
                if dur and surv < dur - 5:
                    ms_["deaths"] += 1
        if (x["place"] or 99) == 1:
            ms_["wins"] += 1
        ms_["kills"] += x.get("effective_kills", x["kills"] or 0)
        ms_["damage"] += x.get("effective_damage", x["damage_dealt"] or 0)
        ms_["totalPlace"] += x["place"] or 0
        ms_["totalSurv"] += x["time_survived"] or 0
    maps_perf = []
    for ms_ in map_stats.values():
        nm = ms_["matches"]
        is_event_only = ms_["brMatches"] == 0 and ms_["eventMatches"] > 0
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
            "isEvent": is_event_only,
            "eventMatches": ms_["eventMatches"],
            "brMatches":    ms_["brMatches"],
            "deaths":       ms_["deaths"],
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
            "kills": m.get("effective_kills", m["kills"]),
            "headshot_kills": m["headshot_kills"],
            "assists": m["assists"],
            "dbnos": m["dbnos"],
            "damage_dealt": m.get("effective_damage", m["damage_dealt"]),
            "place": m["place"],
            "time_survived": m["time_survived"],
            "isSelf": True,
        }
        return {
            "matchId": m["match_id"],
            "map": m["map_name"],
            "mode": m["game_mode"],
            "isEvent": not is_br_mode(m["game_mode"]),
            "matchEnd": m["played_at"],
            "durationSec": m["duration_secs"],
            "place": m["place"],
            "kills": m.get("effective_kills", m["kills"]),
            "damage": m.get("effective_damage", m["damage_dealt"]),
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
