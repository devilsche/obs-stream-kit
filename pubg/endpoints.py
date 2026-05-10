import datetime
import json
from urllib.parse import urlparse, parse_qs
from pubg.db import set_setting, get_setting
from pubg.aggregations import (compute_session_stats, compute_last_match,
                                compute_top_mates, compute_co_player,
                                compute_mates, compute_map_distribution,
                                compute_first_fight_rate, compute_squad_compare,
                                compute_chickens_together, compute_session_report,
                                compute_sessions_index, compute_best_worst_map,
                                compute_map_performance, compute_lobby_avg_kd,
                                compute_squad_kd, compute_lobby_top3_kd,
                                compute_streaks,
                                compute_trend_deltas, compute_session_matches,
                                compute_hot_drop, compute_session_achievements)


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class EndpointRegistry:
    def __init__(self, get_conn, my_account_id, platform, cache,
                 client, poller_status):
        self.get_conn = get_conn
        self.my_account_id = my_account_id
        self.platform = platform
        self.cache = cache
        self.client = client
        self.poller_status = poller_status

    def dispatch(self, method: str, path: str, body: bytes, headers: dict):
        u = urlparse(path)
        route = (method, u.path)
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}

        if route == ("GET", "/api/pubg/session"):
            return self._session(qs)
        if route == ("GET", "/api/pubg/last-match"):
            return self._last_match()
        if route == ("GET", "/api/pubg/status"):
            return _ok(self.poller_status())
        if route == ("GET", "/api/pubg/db-info"):
            return self._db_info()
        if route == ("GET", "/api/pubg/lobby-avg-kd"):
            return self._lobby_avg_kd(qs)
        if route == ("GET", "/api/pubg/squad-kd"):
            return self._squad_kd(qs)
        if route == ("GET", "/api/pubg/lobby-top3-kd"):
            return self._lobby_top3_kd(qs)
        if route == ("GET", "/api/pubg/streaks"):
            return self._streaks(qs)
        if route == ("GET", "/api/pubg/trend-deltas"):
            return self._trend_deltas(qs)
        if route == ("GET", "/api/pubg/session-matches"):
            return self._session_matches(qs)
        if route == ("GET", "/api/pubg/hot-drop"):
            return self._hot_drop(qs)
        if route == ("GET", "/api/pubg/session-achievements"):
            return self._session_achievements(qs)
        if route == ("POST", "/api/pubg/session/reset"):
            return self._session_reset()
        if route == ("GET", "/api/pubg/top-mates"):
            return self._top_mates(qs)
        if u.path.startswith("/api/pubg/co-player/"):
            name = u.path[len("/api/pubg/co-player/"):]
            return self._co_player(name)
        if route == ("GET", "/api/pubg/career-lifetime"):
            return self._career_lifetime(qs)
        if route == ("GET", "/api/pubg/season-stats"):
            return self._season_stats(qs)
        if route == ("GET", "/api/pubg/season-history"):
            return self._season_history(qs)
        if route == ("GET", "/api/pubg/mates"):
            return self._mates(qs)
        if route == ("GET", "/api/pubg/map-distribution"):
            return self._map_dist(qs)
        if route == ("GET", "/api/pubg/first-fight-rate"):
            return self._first_fight(qs)
        if route == ("GET", "/api/pubg/first-fight-debug"):
            return self._first_fight_debug(qs)
        if route == ("GET", "/api/pubg/squad-compare"):
            return self._squad_compare(qs)
        if route == ("GET", "/api/pubg/chickens-together"):
            return self._chickens_together(qs)
        if route == ("GET", "/api/pubg/session-report"):
            return self._session_report(qs)
        if route == ("GET", "/api/pubg/sessions"):
            return self._sessions_index()
        if route == ("GET", "/api/pubg/best-worst-map"):
            return self._best_worst_map(qs)
        if route == ("GET", "/api/pubg/map-performance"):
            return self._map_perf(qs)
        if route == ("GET", "/api/pubg/lookup-mate"):
            return self._lookup_mate(qs)
        if route == ("GET", "/api/pubg/settings"):
            return self._settings_get()
        if route == ("POST", "/api/pubg/settings"):
            return self._settings_set(body)
        if route == ("GET", "/api/pubg/stamm-crew"):
            return self._stamm_get()
        if route == ("POST", "/api/pubg/stamm-crew"):
            return self._stamm_add(body)
        if route == ("DELETE", "/api/pubg/stamm-crew"):
            return self._stamm_del(body)
        return _err(404, f"unknown route {path}")

    def _session(self, qs=None):
        conn = self.get_conn()
        range_key = (qs or {}).get("range", "session")
        return _ok(self.cache.get_or_compute(
            f"session:{range_key}",
            lambda: compute_session_stats(conn, self.my_account_id, range_key),
        ))

    def _last_match(self):
        conn = self.get_conn()
        result = self.cache.get_or_compute(
            "last-match",
            lambda: compute_last_match(conn, self.my_account_id),
        )
        return _ok(result or {})

    def _db_info(self):
        conn = self.get_conn()
        def _compute():
            first = (conn.execute(
                "SELECT MIN(played_at) AS first FROM matches"
            ).fetchone() or {})["first"]
            name_row = conn.execute(
                "SELECT name FROM players WHERE account_id = ?",
                (self.my_account_id,)
            ).fetchone()
            return {
                "firstMatchAt": first,
                "myName": (name_row and name_row["name"]) or None,
            }
        return _ok(self.cache.get_or_compute("db-info", _compute))

    def _lobby_avg_kd(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        return _ok(self.cache.get_or_compute(
            f"lobby-avg-kd:{range_key}",
            lambda: compute_lobby_avg_kd(conn, self.my_account_id, range_key),
        ))

    def _squad_kd(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        return _ok(self.cache.get_or_compute(
            f"squad-kd:{range_key}",
            lambda: compute_squad_kd(conn, self.my_account_id, range_key),
        ))

    def _lobby_top3_kd(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        return _ok(self.cache.get_or_compute(
            f"lobby-top3-kd:{range_key}",
            lambda: compute_lobby_top3_kd(conn, self.my_account_id, range_key),
        ))

    def _streaks(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        return _ok(self.cache.get_or_compute(
            f"streaks:{range_key}",
            lambda: compute_streaks(conn, self.my_account_id, range_key),
        ))

    def _trend_deltas(self, qs):
        conn = self.get_conn()
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        cache_key = f"trend-deltas:{from_iso or ''}:{to_iso or ''}"
        return _ok(self.cache.get_or_compute(
            cache_key,
            lambda: compute_trend_deltas(conn, self.my_account_id,
                                          from_iso=from_iso, to_iso=to_iso),
        ))

    def _session_matches(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        cache_key = f"session-matches:{range_key}:{from_iso or ''}:{to_iso or ''}"
        return _ok(self.cache.get_or_compute(
            cache_key,
            lambda: compute_session_matches(
                conn, self.my_account_id, range_key,
                from_iso=from_iso, to_iso=to_iso),
        ))

    def _hot_drop(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        cache_key = f"hot-drop:{range_key}:{from_iso or ''}:{to_iso or ''}"
        return _ok(self.cache.get_or_compute(
            cache_key,
            lambda: compute_hot_drop(conn, self.my_account_id, range_key,
                                      from_iso=from_iso, to_iso=to_iso),
        ))

    def _session_achievements(self, qs):
        conn = self.get_conn()
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        cache_key = f"session-achievements:{from_iso or ''}:{to_iso or ''}"
        return _ok(self.cache.get_or_compute(
            cache_key,
            lambda: compute_session_achievements(
                conn, self.my_account_id,
                from_iso=from_iso, to_iso=to_iso),
        ))

    def _session_reset(self):
        conn = self.get_conn()
        now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        set_setting(conn, "sessionStartedAt", now)
        self.cache.invalidate()
        return _ok({"sessionStartedAt": now})

    def _top_mates(self, qs):
        conn = self.get_conn()
        default_sort = get_setting(conn, "topMatesSortBy", "mostPlayed")
        default_min = int(get_setting(conn, "minMatchesForTopMates", "10"))
        sort_by = qs.get("sortBy", default_sort)
        limit = int(qs.get("limit", 5))
        min_matches = int(qs.get("minMatches", default_min))
        range_key = qs.get("range")  # None = alle DB

        cache_key = f"top-mates:raw:{range_key or 'all'}"
        all_mates = self.cache.get_or_compute(
            cache_key,
            lambda: compute_top_mates(conn, self.my_account_id,
                                       sort_by="mostPlayed",
                                       limit=10000, min_matches=1,
                                       range_key=range_key))
        filtered = [m for m in all_mates if m["sharedMatches"] >= min_matches]
        sort_fns = {
            "avgPlace":          lambda m: m["avgPlace"] or 99,
            "kd":                lambda m: -(m["kd"] or 0),
            "mateKd":            lambda m: -(m["mateKd"] or 0),
            "winRate":           lambda m: -(m["winRate"] or 0),
            "mostPlayed":        lambda m: -m["sharedMatches"],
            "chickensTogether":  lambda m: (-m["winsTogether"], -(m["winRate"] or 0), -m["sharedMatches"]),
            "synergy":           lambda m: -(m.get("synergyScore") or 0),
        }
        filtered.sort(key=sort_fns.get(sort_by, sort_fns["mostPlayed"]))
        return _ok(filtered[:limit])

    def _co_player(self, name):
        conn = self.get_conn()
        result = self.cache.get_or_compute(
            f"co-player:{name}",
            lambda: compute_co_player(conn, self.my_account_id, name),
        )
        return _ok(result)

    def _career_lifetime(self, qs):
        player = qs.get("player")
        mode = qs.get("mode", "all")
        conn = self.get_conn()
        if not player:
            row = conn.execute(
                "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = ?",
                (self.my_account_id, mode)).fetchone()
        else:
            row = conn.execute("""
                SELECT pl.* FROM player_lifetime pl
                JOIN players p ON p.account_id = pl.account_id
                WHERE (p.name = ? OR p.account_id = ?) AND pl.mode = ?
            """, (player, player, mode)).fetchone()
        return _ok(dict(row) if row else {})

    def _season_stats(self, qs):
        """Aktuelle Season-Stats. ?season=<id> wählt eine konkrete Season,
        sonst die aktuelle (laut settings.pubg.current_season_id).
        ?mode=all|squad-fpp|... default 'all'."""
        player = qs.get("player")
        mode = qs.get("mode", "all")
        season = qs.get("season")
        conn = self.get_conn()
        if not season:
            r = conn.execute(
                "SELECT value FROM settings WHERE key='pubg.current_season_id'"
            ).fetchone()
            season = r["value"] if r else None
        if not season:
            return _ok({})
        if not player:
            row = conn.execute(
                "SELECT * FROM player_season "
                "WHERE account_id=? AND season_id=? AND mode=?",
                (self.my_account_id, season, mode)).fetchone()
        else:
            row = conn.execute("""
                SELECT ps.* FROM player_season ps
                JOIN players p ON p.account_id = ps.account_id
                WHERE (p.name = ? OR p.account_id = ?)
                  AND ps.season_id = ? AND ps.mode = ?
            """, (player, player, season, mode)).fetchone()
        result = dict(row) if row else {}
        if result:
            result["seasonId"] = season
        return _ok(result)

    def _season_history(self, qs):
        """Liste aller gespeicherten Seasons für einen Spieler — chronologisch
        älteste zuerst. Fürs Verlaufs-Chart (K/D, Win-Rate, DMG über alle
        Seasons). ?mode default 'all'."""
        player = qs.get("player")
        mode = qs.get("mode", "all")
        conn = self.get_conn()
        if not player:
            account_id = self.my_account_id
        else:
            r = conn.execute(
                "SELECT account_id FROM players WHERE name=? OR account_id=?",
                (player, player)).fetchone()
            if not r:
                return _ok({"seasons": []})
            account_id = r["account_id"]
        rows = conn.execute("""
            SELECT * FROM player_season
            WHERE account_id=? AND mode=?
            ORDER BY season_id ASC
        """, (account_id, mode)).fetchall()
        return _ok({"seasons": [dict(r) for r in rows]})

    def _mates(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        min_matches = int(qs.get("minMatches", 1))   # Range-Filter
        min_total = int(qs.get("minTotal", 1))       # Lifetime-Filter (optional)
        key = f"mates:{range_key}:{min_matches}:{min_total}"
        return _ok(self.cache.get_or_compute(
            key,
            lambda: compute_mates(conn, self.my_account_id,
                                         range_key, min_matches, min_total)))

    def _map_dist(self, qs):
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"map:{range_key}",
            lambda: compute_map_distribution(conn, self.my_account_id, range_key)))

    def _first_fight(self, qs):
        range_key = qs.get("range", "session")
        # ?excludeHotDrop=1 → 'silent drop & loot then fight' Variante:
        # nur Matches OHNE Hot-Drop, dann First-Fight-Rate berechnen.
        exclude_hot = qs.get("excludeHotDrop") == "1"
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"ff:{range_key}:eh{int(exclude_hot)}",
            lambda: compute_first_fight_rate(
                conn, self.my_account_id, range_key,
                exclude_hot_drop=exclude_hot)))

    def _first_fight_debug(self, qs):
        """Diagnose: pro Match in Range zeigen, warum die Detection
        ggf. None liefert. Output:
          - match_id, played_at, place, telemetry_fetched
          - participants_count, my_team_id, squad_size
          - kill_events, knock_events
          - squad_involved (Anzahl Events mit Squad als Attacker/Target)
          - detection_result (das was _detect_first_fight liefert)
        """
        from pubg.aggregations import _detect_first_fight, _range_filter
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        cutoff = (_range_filter(conn, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        matches = conn.execute("""
            SELECT m.match_id, m.played_at, m.duration_secs, m.telemetry_fetched,
                   m.map_name, pa.place
            FROM matches m
            JOIN participants pa ON pa.match_id = m.match_id
            WHERE pa.account_id = ? AND m.played_at >= ?
            ORDER BY m.played_at DESC
        """, (self.my_account_id, cutoff)).fetchall()
        out = []
        for m in matches:
            mid = m["match_id"]
            parts = conn.execute(
                "SELECT account_id, team_id FROM participants WHERE match_id = ?",
                (mid,)).fetchall()
            acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
            my_team = acc_to_team.get(self.my_account_id)
            squad_ids = [a for a, t in acc_to_team.items() if t == my_team] if my_team else []
            kill_n = conn.execute(
                "SELECT COUNT(*) FROM telemetry_events WHERE match_id = ? AND event_type = 'Kill'",
                (mid,)).fetchone()[0]
            knock_n = conn.execute(
                "SELECT COUNT(*) FROM telemetry_events WHERE match_id = ? AND event_type = 'Knock'",
                (mid,)).fetchone()[0]
            squad_involved = 0
            if squad_ids:
                placeholders = ",".join("?" * len(squad_ids))
                squad_involved = conn.execute(
                    f"""SELECT COUNT(*) FROM telemetry_events
                        WHERE match_id = ? AND event_type IN ('Kill','Knock')
                          AND (actor_account IN ({placeholders})
                               OR target_account IN ({placeholders}))""",
                    (mid, *squad_ids, *squad_ids)).fetchone()[0]
            try:
                result = _detect_first_fight(conn, mid, self.my_account_id,
                                              30 * 1000, 200 * 100)
            except Exception as e:
                result = {"error": str(e)}
            # Bei verdaechtigen 1-Event-Clustern (events_count == 1)
            # das erste Squad-beteiligte Event direkt mitgeben - dann
            # sieht man, ob's ein Knock oder Kill war und wer Actor/Target
            # war. Damit laesst sich 'wir sind abgehauen'-Faelle
            # identifizieren.
            first_event = None
            if result and isinstance(result, dict) and result.get("events_count") == 1 and squad_ids:
                placeholders = ",".join("?" * len(squad_ids))
                row = conn.execute(
                    f"""SELECT event_type, actor_account, target_account, timestamp_ms
                        FROM telemetry_events
                        WHERE match_id = ? AND event_type IN ('Kill','Knock')
                          AND (actor_account IN ({placeholders})
                               OR target_account IN ({placeholders}))
                        ORDER BY timestamp_ms ASC LIMIT 1""",
                    (mid, *squad_ids, *squad_ids)).fetchone()
                if row:
                    first_event = {
                        "type": row["event_type"],
                        "actorIsSquad": row["actor_account"] in squad_ids,
                        "targetIsSquad": row["target_account"] in squad_ids,
                        "actorIsMe": row["actor_account"] == self.my_account_id,
                        "targetIsMe": row["target_account"] == self.my_account_id,
                    }
            # Squad-Landing-Position (= meine eigene Landung) und Match-
            # Start fuer relative Zeitstempel.
            my_landing_row = conn.execute("""
                SELECT actor_x, actor_y, timestamp_ms
                FROM telemetry_events
                WHERE match_id = ? AND event_type = 'Landing'
                  AND actor_account = ?
                ORDER BY timestamp_ms ASC LIMIT 1
            """, (mid, self.my_account_id)).fetchone()
            my_landing = None
            match_start_ms = None
            if my_landing_row and my_landing_row["actor_x"] is not None:
                my_landing = {
                    "x": round(my_landing_row["actor_x"], 1),
                    "y": round(my_landing_row["actor_y"], 1),
                }
                # Match-Start = Landung-Zeitstempel minus
                # time_survived ist relativ Match-Start; Landings
                # liegen nach Match-Start. Wir nehmen Landing-Zeit
                # als Anker fuer "tSinceLanding".
                match_start_ms = my_landing_row["timestamp_ms"]

            # Erstes Squad-Event aus _detect_first_fight (events_count==1
            # haben wir schon, sonst zusaetzlich abrufen). Plus First-Fight
            # cluster-Start (erstes Squad-Combat-Event egal Typ).
            first_fight_start_secs = None
            if squad_ids and result and isinstance(result, dict) and not result.get("error"):
                placeholders = ",".join("?" * len(squad_ids))
                ff_row = conn.execute(f"""
                    SELECT timestamp_ms FROM telemetry_events
                    WHERE match_id = ?
                      AND event_type IN ('Kill','Knock','TakeDamage')
                      AND actor_account IS NOT NULL
                      AND (actor_account IN ({placeholders})
                           OR target_account IN ({placeholders}))
                    ORDER BY timestamp_ms ASC LIMIT 1
                """, (mid, *squad_ids, *squad_ids)).fetchone()
                if ff_row and match_start_ms:
                    first_fight_start_secs = round(
                        (ff_row["timestamp_ms"] - match_start_ms) / 1000.0, 1)

            # Squad-Member-Deaths: pro Death wer war Killer, wo war
            # seine Landung relativ zur Squad-Landung, wo war Death.
            squad_deaths = []
            if squad_ids:
                placeholders = ",".join("?" * len(squad_ids))
                # Squad-Landung-Position (eine pro Squad-Member)
                squad_landings = conn.execute(f"""
                    SELECT actor_account, actor_x, actor_y
                    FROM telemetry_events
                    WHERE match_id = ?
                      AND event_type = 'Landing'
                      AND actor_account IN ({placeholders})
                """, (mid, *squad_ids)).fetchall()
                squad_landing_map = {r["actor_account"]: (r["actor_x"], r["actor_y"])
                                       for r in squad_landings
                                       if r["actor_x"] is not None}
                # Squad-Member-Kills (mit Killer-Name)
                kill_rows = conn.execute(f"""
                    SELECT k.actor_account AS killer, k.target_account AS victim,
                           k.timestamp_ms, k.victim_x, k.victim_y, k.distance,
                           k.weapon, p.name AS killer_name
                    FROM telemetry_events k
                    LEFT JOIN participants p ON p.match_id = k.match_id
                                              AND p.account_id = k.actor_account
                    WHERE k.match_id = ?
                      AND k.event_type = 'Kill'
                      AND k.target_account IN ({placeholders})
                    ORDER BY k.timestamp_ms ASC
                """, (mid, *squad_ids)).fetchall()
                # Killer-Landung-Position holen (alle distinct killer)
                killer_ids = list({r["killer"] for r in kill_rows if r["killer"]})
                killer_landing_map = {}
                if killer_ids:
                    kphs = ",".join("?" * len(killer_ids))
                    kls = conn.execute(f"""
                        SELECT actor_account, actor_x, actor_y
                        FROM telemetry_events
                        WHERE match_id = ?
                          AND event_type = 'Landing'
                          AND actor_account IN ({kphs})
                    """, (mid, *killer_ids)).fetchall()
                    killer_landing_map = {r["actor_account"]: (r["actor_x"], r["actor_y"])
                                            for r in kls
                                            if r["actor_x"] is not None}
                # Victim-Name-Map
                victim_names = {p["account_id"]: None for p in parts}
                victim_name_rows = conn.execute(f"""
                    SELECT account_id, name FROM participants
                    WHERE match_id = ? AND account_id IN ({placeholders})
                """, (mid, *squad_ids)).fetchall()
                victim_name_map = {r["account_id"]: r["name"] for r in victim_name_rows}
                # Distanzen berechnen
                for r in kill_rows:
                    landing_dist_m = None
                    klp = killer_landing_map.get(r["killer"])
                    # Squad-Landing nehmen: erstes Squad-Landing (oder
                    # spezifisch das des Victims)
                    slp = squad_landing_map.get(r["victim"])
                    if slp is None and squad_landing_map:
                        slp = next(iter(squad_landing_map.values()))
                    if klp and slp:
                        dx = klp[0] - slp[0]
                        dy = klp[1] - slp[1]
                        landing_dist_m = round(((dx*dx + dy*dy) ** 0.5) / 100, 1)
                    death_dist_m = None
                    if slp and r["victim_x"] is not None:
                        dx = r["victim_x"] - slp[0]
                        dy = r["victim_y"] - slp[1]
                        death_dist_m = round(((dx*dx + dy*dy) ** 0.5) / 100, 1)
                    # PUBG-Telemetry liefert 'distance' in cm (Welt-Units).
                    # 100 cm = 1 m -> /100 fuer Meter.
                    shot_m = (r["distance"] / 100.0) if r["distance"] else None
                    t_since_landing = None
                    if match_start_ms:
                        t_since_landing = round(
                            (r["timestamp_ms"] - match_start_ms) / 1000.0, 1)
                    squad_deaths.append({
                        "victim": victim_name_map.get(r["victim"]) or r["victim"],
                        "killer": r["killer_name"] or r["killer"],
                        "killerIsSelf": r["killer"] in squad_ids,  # friendly fire?
                        "weapon": r["weapon"],
                        "shotDistanceM": round(shot_m, 1) if shot_m is not None else None,
                        "killerLandingDistM": landing_dist_m,
                        "deathToSquadLandingM": death_dist_m,
                        "tSinceLandingSecs": t_since_landing,
                    })
            out.append({
                "matchId": mid,
                "playedAt": m["played_at"],
                "map": m["map_name"],
                "place": m["place"],
                "durationSecs": m["duration_secs"],
                "telemetryFetched": bool(m["telemetry_fetched"]),
                "participantsCount": len(parts),
                "myTeamId": my_team,
                "squadSize": len(squad_ids),
                "myLandingPos": my_landing,
                "firstFightStartSecs": first_fight_start_secs,
                "killEvents": kill_n,
                "knockEvents": knock_n,
                "squadInvolvedEvents": squad_involved,
                "detectionResult": result,
                "firstSquadEvent": first_event,
                "squadDeaths": squad_deaths,
            })
        return _ok({"matches": out})

    def _chickens_together(self, qs):
        min_wins = int(qs.get("minWins", 1))
        min_matches = int(qs.get("minMatches", 1))
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"chickens-together:{min_wins}:{min_matches}",
            lambda: compute_chickens_together(conn, self.my_account_id,
                                               min_wins, min_matches)))

    def _session_report(self, qs):
        conn = self.get_conn()
        rf = qs.get("from")
        rt = qs.get("to")
        key = f"session-report:{rf or 'auto'}:{rt or 'now'}"
        return _ok(self.cache.get_or_compute(
            key,
            lambda: compute_session_report(conn, self.my_account_id, rf, rt)))

    def _sessions_index(self):
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            "sessions-index",
            lambda: compute_sessions_index(conn, self.my_account_id)))

    def _best_worst_map(self, qs):
        range_key = qs.get("range", "all")
        min_m = int(qs.get("minMatches", 3))
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"best-worst-map:{range_key}:{min_m}",
            lambda: compute_best_worst_map(conn, self.my_account_id,
                                            range_key, min_m)))

    def _map_perf(self, qs):
        range_key = qs.get("range", "all")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"map-perf:{range_key}",
            lambda: compute_map_performance(conn, self.my_account_id,
                                              range_key)))

    def _lookup_mate(self, qs):
        """Live-Lookup eines Players via PUBG-API: account_id + Lifetime
        + Recent-Match-Count. Cached 5 Min."""
        name = qs.get("player", "").strip()
        if not name:
            return _err(400, "missing ?player=NAME")
        return _ok(self.cache.get_or_compute(
            f"lookup-mate:{name}",
            lambda: self._lookup_mate_live(name)))

    def _lookup_mate_live(self, name):
        try:
            player_resp = self.client.get_player(name)
        except Exception as e:
            return {"error": f"player not found: {e}", "name": name}
        data = player_resp.get("data") or []
        if not data:
            return {"error": "player not found", "name": name}
        p = data[0]
        account_id = p["id"]
        match_ids = self.client.extract_match_ids(player_resp)
        try:
            life_resp = self.client.get_lifetime(account_id)
            from pubg.match_parser import (parse_lifetime_response,
                                            aggregate_lifetime_modes)
            modes = parse_lifetime_response(life_resp)
            agg = aggregate_lifetime_modes(modes)
        except Exception as e:
            agg = None
        return {
            "name": p["attributes"].get("name") or name,
            "accountId": account_id,
            "shardId": p["attributes"].get("shardId"),
            "recentMatchCount": len(match_ids),
            "careerLifetime": agg,
            "modesLifetime": modes if agg else {},
        }

    def _squad_compare(self, qs):
        names = (qs.get("players") or "").split(",")
        n = int(qs.get("matches", 5))
        conn = self.get_conn()
        return _ok(compute_squad_compare(conn, self.my_account_id, names, n))

    def _settings_get(self):
        conn = self.get_conn()
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return _ok({r["key"]: r["value"] for r in rows})

    def _settings_set(self, body):
        try:
            payload = json.loads(body or b"{}")
            set_setting(self.get_conn(), payload["key"], str(payload["value"]))
            self.cache.invalidate()
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    def _stamm_get(self):
        conn = self.get_conn()
        rows = conn.execute("SELECT * FROM stamm_crew").fetchall()
        return _ok([{"name": r["name"], "accountId": r["account_id"]}
                    for r in rows])

    def _stamm_add(self, body):
        try:
            payload = json.loads(body or b"{}")
            name = payload["add"]
            conn = self.get_conn()
            p = conn.execute("SELECT * FROM players WHERE name = ?", (name,)).fetchone()
            if not p:
                return _err(404, f"Player {name} unbekannt — spiele erst mal mit ihm")
            conn.execute("""
                INSERT OR IGNORE INTO stamm_crew(account_id, name, added_at)
                VALUES (?, ?, datetime('now'))
            """, (p["account_id"], name))
            conn.commit()
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    def _stamm_del(self, body):
        try:
            payload = json.loads(body or b"{}")
            name = payload["remove"]
            conn = self.get_conn()
            conn.execute("DELETE FROM stamm_crew WHERE name = ?", (name,))
            conn.commit()
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))
