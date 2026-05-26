import datetime
import json
import subprocess
import sys
import time
from urllib.parse import urlparse, parse_qs
from pubg.db import set_setting, get_setting

# ── Process-List-Check fuer PUBG (cross-platform) ─────────────────────────────
# PUBG-Prozessname: 'TslGame.exe' (Windows) bzw. 'TslGame' (Linux/Mac via
# Proton/Wine). Wird gecacht, damit ein hochfrequenter Endpoint-Aufruf
# nicht jedes Mal subprocess startet.
_PUBG_PROCESS_NAME = "TslGame"
_proc_cache = {"running": False, "ts": 0.0}
_PROC_CACHE_TTL_S = 5.0


def _is_pubg_running():
    """True wenn TslGame-Prozess laeuft. 5s-Cache (subprocess-call ~50-100ms,
    Cache vermeidet Last bei sekuendlichem Polling von Streamer.bot)."""
    now = time.monotonic()
    if now - _proc_cache["ts"] < _PROC_CACHE_TTL_S:
        return _proc_cache["running"]
    running = False
    try:
        if sys.platform.startswith("win"):
            out = subprocess.check_output(
                ["tasklist", "/FI", f"IMAGENAME eq {_PUBG_PROCESS_NAME}.exe"],
                text=True, errors="ignore", timeout=3,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            running = _PUBG_PROCESS_NAME.lower() in out.lower()
        else:
            r = subprocess.run(
                ["pgrep", "-f", _PUBG_PROCESS_NAME],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=3)
            running = (r.returncode == 0)
    except Exception:
        running = False
    _proc_cache["running"] = running
    _proc_cache["ts"] = now
    return running
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
                                compute_hot_drop, compute_session_achievements,
                                compute_vehicle_stats, compute_weapon_stats,
                                compute_match_detail, is_br_mode)


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
        self._replay_cache = {}  # match_id → fertiges Replay-Dict (Session-Memory)

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
        if route == ("GET", "/api/pubg/active"):
            return self._active(qs)
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
        if route == ("GET", "/api/pubg/vehicle-stats"):
            return self._vehicle_stats(qs)
        if route == ("GET", "/api/pubg/weapon-stats"):
            return self._weapon_stats(qs)
        if route == ("GET", "/api/pubg/match-detail"):
            return self._match_detail(qs)
        if route == ("GET", "/api/pubg/matches-list"):
            return self._matches_list(qs)
        if route == ("GET", "/api/pubg/match-replay"):
            return self._match_replay(qs)
        if route == ("GET", "/api/pubg/hot-drop"):
            return self._hot_drop(qs)
        if route == ("GET", "/api/pubg/payday-stats"):
            return self._payday_stats(qs)
        if route == ("GET", "/api/pubg/landings"):
            return self._landings(qs)
        if route == ("GET", "/api/pubg/pois"):
            return self._pois_get(qs)
        if route == ("POST", "/api/pubg/pois"):
            return self._pois_post(body)
        if route == ("GET", "/api/pubg/session-achievements"):
            return self._session_achievements(qs)
        if route == ("GET", "/api/pubg/recent-achievements"):
            return self._recent_achievements(qs)
        if route == ("GET", "/api/pubg/achievements-list"):
            return self._achievements_list(qs)
        if route == ("GET", "/api/pubg/replay-achievement"):
            return self._replay_achievement(qs)
        if route == ("GET", "/api/pubg/detect-achievements"):
            return self._detect_achievements(qs)
        if route == ("GET", "/api/pubg/backfill-achievements"):
            return self._backfill_achievements(qs)
        if route == ("GET", "/api/pubg/refetch-telemetry"):
            return self._refetch_telemetry(qs)
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
        if route == ("GET", "/api/pubg/debug-matches"):
            return self._debug_matches(qs)
        if route == ("GET", "/api/pubg/calibration-events"):
            return self._calibration_events(qs)
        if route == ("GET", "/api/pubg/calibration-corrections"):
            return self._calibration_corrections_get(qs)
        if route == ("POST", "/api/pubg/calibration-corrections"):
            return self._calibration_corrections_post(body)
        if route == ("DELETE", "/api/pubg/calibration-corrections"):
            return self._calibration_corrections_delete(body)
        return _err(404, f"unknown route {path}")

    def _active(self, qs):
        """Liefert {active: bool, ...} fuer Streamer.bot/IFTTT-style
        If-Then-Else.

        Detection (jede Bedingung allein reicht fuer active=true):
          - processRunning: TslGame.exe laeuft GRAD (instant, lokal)
          - matchRecent:    letzter Match juenger als thresholdMin
                            (Default 30) - faengt 'grad nach Match-Ende
                            mit OBS-Stats-Anzeige' ab

        Override per Query:
          ?thresholdMin=15  -> 15 Minuten Schwelle
          ?thresholdSec=300 -> 5 Minuten Schwelle (in Sekunden)
          ?noProcess=1      -> Process-Check ueberspringen (nur Match-Age)
        """
        threshold_min = float(qs.get("thresholdMin", 30))
        if "thresholdSec" in qs:
            threshold_min = float(qs["thresholdSec"]) / 60.0
        skip_process = qs.get("noProcess") == "1"

        process_running = False if skip_process else _is_pubg_running()

        conn = self.get_conn()
        row = conn.execute(
            "SELECT MAX(played_at) AS last FROM matches"
        ).fetchone()
        last_iso = row["last"] if row else None
        age_min = None
        match_recent = False
        if last_iso:
            try:
                last_dt = datetime.datetime.fromisoformat(
                    last_iso.replace("Z", "+00:00"))
                now = datetime.datetime.now(datetime.timezone.utc)
                age_min = round(
                    (now - last_dt).total_seconds() / 60.0, 1)
                match_recent = age_min < threshold_min
            except Exception:
                pass
        active = process_running or match_recent
        return _ok({
            "active": active,
            "processRunning": process_running,
            "matchRecent": match_recent,
            "lastMatchAt": last_iso,
            "lastMatchAgeMin": age_min,
            "thresholdMin": threshold_min,
        })

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

    def _landings(self, qs):
        """Liefert Squad-Landings auf einer Map (oder allen Maps).

        Heuristik fuer Touchdown-Detection (PUBG kann LogParachuteLanding
        beim Tod re-firen — Death-Re-Fire-Event mit hp=0):
          1. Pro (match, actor): fruehestes Landing mit health>0 UND
             z<80000cm (= z<800m) — schließt mid-plane-Events aus
             (Plane fliegt bei z~150000cm = 1500m)
          2. Falls keins: fruehestes Position-Event mit z<80000cm
             (Schema 4+ Continuous-Tracking)
          3. Falls auch das fehlt: irgendein Landing (auch mid-air)
        Z ist in cm wie x/y. Dach-Landings z~1000-2000cm (10-20m) sind
        normale Boden-Position auf einem Gebaeude — nicht mid-air.
        Mit ?all=1 wird der Filter komplett uebersprungen.
        """
        conn = self.get_conn()
        map_filter = (qs.get("map") or "").strip()
        all_landings = qs.get("all") == "1"
        params = [self.my_account_id]
        where = ""
        if map_filter:
            where = "AND m.map_name = ?"
            params.append(map_filter)
        if all_landings:
            # Alles ohne Filter
            rows = conn.execute(f"""
                SELECT te.match_id, m.played_at, m.map_name,
                       te.actor_account, te.actor_x, te.actor_y,
                       p.name AS player_name
                FROM telemetry_events te
                JOIN matches m ON m.match_id = te.match_id
                JOIN participants me ON me.match_id = te.match_id AND me.account_id = ?
                JOIN participants pa ON pa.match_id = te.match_id
                    AND pa.team_id = me.team_id AND pa.account_id = te.actor_account
                LEFT JOIN players p ON p.account_id = te.actor_account
                WHERE te.event_type = 'Landing'
                  AND te.actor_x IS NOT NULL AND te.actor_y IS NOT NULL
                  {where}
            """, params).fetchall()
        else:
            # Best-touchdown-Heuristik mit Z + Health Filter
            # Schritt 1: Landing-Events mit z<800 + health>0 = legit Touchdown
            # Schritt 2: falls keiner, Position-Event mit z<800 als Fallback
            # Schritt 3: falls auch keiner, MIN(timestamp_ms) Landing (alt)
            rows = conn.execute(f"""
                WITH best_landing AS (
                  SELECT match_id, actor_account, MIN(timestamp_ms) AS ts
                  FROM telemetry_events
                  WHERE event_type = 'Landing'
                    AND actor_x IS NOT NULL AND actor_y IS NOT NULL
                    AND (actor_z IS NULL OR actor_z < 80000)
                    AND (actor_health IS NULL OR actor_health > 0)
                  GROUP BY match_id, actor_account
                ),
                fallback_position AS (
                  SELECT te.match_id, te.actor_account, MIN(te.timestamp_ms) AS ts
                  FROM telemetry_events te
                  LEFT JOIN best_landing bl
                    ON bl.match_id = te.match_id
                   AND bl.actor_account = te.actor_account
                  WHERE te.event_type = 'Position'
                    AND te.actor_x IS NOT NULL AND te.actor_y IS NOT NULL
                    AND te.actor_z IS NOT NULL AND te.actor_z < 80000
                    AND bl.ts IS NULL
                  GROUP BY te.match_id, te.actor_account
                ),
                fallback_any_landing AS (
                  SELECT te.match_id, te.actor_account, MIN(te.timestamp_ms) AS ts
                  FROM telemetry_events te
                  LEFT JOIN best_landing bl
                    ON bl.match_id = te.match_id AND bl.actor_account = te.actor_account
                  LEFT JOIN fallback_position fp
                    ON fp.match_id = te.match_id AND fp.actor_account = te.actor_account
                  WHERE te.event_type = 'Landing'
                    AND te.actor_x IS NOT NULL AND te.actor_y IS NOT NULL
                    AND bl.ts IS NULL AND fp.ts IS NULL
                  GROUP BY te.match_id, te.actor_account
                ),
                picked AS (
                  SELECT match_id, actor_account, ts FROM best_landing
                  UNION ALL
                  SELECT match_id, actor_account, ts FROM fallback_position
                  UNION ALL
                  SELECT match_id, actor_account, ts FROM fallback_any_landing
                )
                SELECT te.match_id, m.played_at, m.map_name,
                       te.actor_account, te.actor_x, te.actor_y,
                       p.name AS player_name
                FROM picked pk
                JOIN telemetry_events te
                  ON te.match_id = pk.match_id
                 AND te.actor_account = pk.actor_account
                 AND te.timestamp_ms = pk.ts
                JOIN matches m ON m.match_id = te.match_id
                JOIN participants me ON me.match_id = te.match_id AND me.account_id = ?
                JOIN participants pa ON pa.match_id = te.match_id
                    AND pa.team_id = me.team_id AND pa.account_id = te.actor_account
                LEFT JOIN players p ON p.account_id = te.actor_account
                WHERE te.actor_x IS NOT NULL AND te.actor_y IS NOT NULL
                  {where}
            """, params).fetchall()
        landings = [{
            "matchId":    r["match_id"],
            "playedAt":   r["played_at"],
            "mapName":    r["map_name"],
            "accountId":  r["actor_account"],
            "name":       r["player_name"] or r["actor_account"][:8],
            "x":          r["actor_x"],
            "y":          r["actor_y"],
        } for r in rows]
        return _ok({"landings": landings, "count": len(landings),
                    "firstOnly": not all_landings})

    POIS_FILE = "data/pubg-pois.json"

    def _load_pois(self):
        import os, json
        here = os.path.dirname(os.path.abspath(__file__))
        root = os.path.dirname(here)
        path = os.path.join(root, self.POIS_FILE)
        if not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_pois(self, data):
        import os, json
        here = os.path.dirname(os.path.abspath(__file__))
        root = os.path.dirname(here)
        path = os.path.join(root, self.POIS_FILE)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _pois_get(self, qs):
        """Liefert POI-Regionen. Ohne ?map: ALLE Maps in einem Dict.
        Mit ?map=Baltic_Main: nur die Daten dieser Map."""
        data = self._load_pois()
        map_filter = (qs.get("map") or "").strip()
        if map_filter:
            return _ok(data.get(map_filter, {"mapKm": 8, "regions": []}))
        return _ok(data)

    def _pois_post(self, body):
        """Speichert/Updated POI-Regionen fuer EINE Map. Body:
        { "map": "Baltic_Main", "mapKm": 8, "regions":
          [ { "name": "Pochinki", "points": [[x,y],[x,y],...] }, ... ] }
        Komplettes Replace der Map-Daten (kein Merge).
        Andere Maps in der File bleiben unangetastet.
        Punkt-Coords sind in cm Welt-Units."""
        import json
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError as e:
            return _err(400, f"Invalid JSON: {e}")
        map_id = (payload.get("map") or "").strip()
        if not map_id:
            return _err(400, "missing 'map'")
        regions = payload.get("regions") or []
        if not isinstance(regions, list):
            return _err(400, "'regions' must be a list")
        clean = []
        for r in regions:
            pts = r.get("points") or []
            if not isinstance(pts, list) or len(pts) < 3:
                return _err(400, f"region needs >=3 points: {r}")
            try:
                clean_pts = [[int(p[0]), int(p[1])] for p in pts]
            except (KeyError, ValueError, TypeError, IndexError):
                return _err(400, f"invalid points in region: {r}")
            clean.append({
                "name": str(r.get("name") or ""),
                "points": clean_pts,
            })
        data = self._load_pois()
        cal = payload.get("pinCalibration") or {}
        grid = payload.get("gridCalibration") or {}
        data[map_id] = {
            "mapKm": float(payload.get("mapKm") or 8),
            "pinCalibration": {
                "offsetX": int(cal.get("offsetX") or 0),
                "offsetY": int(cal.get("offsetY") or 0),
                "scaleX":  float(cal.get("scaleX")  or 1.0),
                "scaleY":  float(cal.get("scaleY")  or 1.0),
                "flipX":   bool(cal.get("flipX")),
                "flipY":   bool(cal.get("flipY")),
                "rotate":  int(cal.get("rotate")  or 0),
            },
            "gridCalibration": {
                "offsetX": int(grid.get("offsetX") or 0),
                "offsetY": int(grid.get("offsetY") or 0),
                "scaleX":  float(grid.get("scaleX")  or 1.0),
                "scaleY":  float(grid.get("scaleY")  or 1.0),
            },
            "regions": clean,
        }
        self._save_pois(data)
        return _ok({"saved": True, "map": map_id, "count": len(clean)})

    def _payday_stats(self, qs):
        """PAYDAY/Event-Match-Stats aus Telemetry rekonstruiert (PUBG-
        Match-Summary liefert in Events 0/0/win, deshalb echte Kills/
        Damage + Loot-Counter aus den raw events).
        Range default 'session', auch 'day'/'week'/'all'. Auch ?from=ISO."""
        from pubg.aggregations import compute_payday_stats
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        cache_key = f"payday-stats:{range_key}:{from_iso or ''}:{to_iso or ''}"
        return _ok(self.cache.get_or_compute(
            cache_key,
            lambda: compute_payday_stats(conn, self.my_account_id,
                                         range_key,
                                         from_iso=from_iso, to_iso=to_iso),
        ))

    def _match_detail(self, qs):
        conn = self.get_conn()
        match_id = (qs.get("matchId") or "").strip()
        if not match_id:
            return _err(400, "matchId required")
        data = self.cache.get_or_compute(
            f"match-detail:{match_id}",
            lambda: compute_match_detail(conn, self.my_account_id, match_id))
        if not data:
            return _err(404, "match not found")
        return _ok(data)

    def _matches_list(self, qs):
        conn = self.get_conn()
        try:
            limit = int(qs.get("limit", "50"))
        except ValueError:
            limit = 50
        limit = max(1, min(200, limit))
        rows = conn.execute("""
            SELECT m.match_id, m.played_at, m.map_name,
                   pa.place, pa.kills
            FROM matches m
            LEFT JOIN participants pa
              ON pa.match_id = m.match_id AND pa.account_id = ?
            ORDER BY m.played_at DESC
            LIMIT ?
        """, (self.my_account_id, limit)).fetchall()
        return _ok([{
            "matchId":  r["match_id"],
            "playedAt": r["played_at"],
            "mapName":  r["map_name"],
            "place":    r["place"],
            "kills":    r["kills"],
        } for r in rows])

    def _match_replay(self, qs):
        import os
        from pubg import hidrive_telemetry
        from pubg.replay_builder import build_replay
        from pubg.telemetry import extract_player_names
        from pubg.db import get_team_mapping_for_match

        match_id = (qs.get("match") or "").strip()
        if not match_id:
            return _err(400, "match required")
        if match_id in self._replay_cache:
            return _ok(self._replay_cache[match_id])

        conn = self.get_conn()
        m_row = conn.execute(
            "SELECT map_name FROM matches WHERE match_id = ?",
            (match_id,)).fetchone()
        if not m_row:
            return _err(404, "match not found")
        map_name = m_row["map_name"]

        # Map-Groesse aus POIs (Fallback 8km)
        pois = self._load_pois()
        alias = "Baltic_Main" if map_name == "Erangel_Main" else map_name
        blob = pois.get(alias) or pois.get(map_name) or {}
        mapKm = float(blob.get("mapKm") or 8)

        # Raw-Telemetrie von HiDrive
        here = os.path.dirname(os.path.abspath(__file__))
        secrets = os.path.join(os.path.dirname(here), ".secrets")
        raw = hidrive_telemetry.download_raw(match_id, secrets)
        if not raw:
            return _err(404, "no telemetry available for this match")

        # Team-Mapping + Namen
        team_mapping = get_team_mapping_for_match(conn, match_id)
        names = {}
        rows = conn.execute(
            "SELECT account_id, name FROM players").fetchall()
        for r in rows:
            names[r["account_id"]] = r["name"]
        # Fehlende Namen aus dem Raw-Blob nachziehen
        for acc, nm in extract_player_names(raw).items():
            names.setdefault(acc, nm)

        result = build_replay(
            raw, match_id, map_name, mapKm, team_mapping, names)
        self._replay_cache[match_id] = result
        return _ok(result)

    def _weapon_stats(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "all")
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        player = (qs.get("player") or "").strip()
        actor_account = None
        actor_name    = None
        if player:
            row = conn.execute(
                "SELECT account_id, name FROM players "
                "WHERE name = ? OR account_id = ? LIMIT 1",
                (player, player)).fetchone()
            if row:
                actor_account = row["account_id"]
                actor_name    = row["name"]
            else:
                return _err(404, f"player not found: {player}")
        cache_key = (f"weapon-stats:{range_key}:{from_iso or ''}:"
                     f"{to_iso or ''}:{actor_account or 'self'}")
        rows = self.cache.get_or_compute(
            cache_key,
            lambda: compute_weapon_stats(
                conn, self.my_account_id, range_key,
                from_iso=from_iso, to_iso=to_iso,
                actor_account=actor_account),
        )
        return _ok({
            "weapons": rows, "count": len(rows),
            "playerName": actor_name,
        })

    def _vehicle_stats(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        from_iso = qs.get("from")
        to_iso = qs.get("to")
        # Debug-Mode: ?debug=1 listet pro Match die rohen Event-Counts
        # + Squad-Members. Hilft beim Diagnostizieren wenn members leer
        # ist obwohl man weiss dass was passiert ist.
        if qs.get("debug") == "1":
            return _ok(self._vehicle_stats_debug(
                conn, range_key, from_iso, to_iso))
        cache_key = f"vehicle-stats:{range_key}:{from_iso or ''}:{to_iso or ''}"
        rows = self.cache.get_or_compute(
            cache_key,
            lambda: compute_vehicle_stats(
                conn, self.my_account_id, range_key,
                from_iso=from_iso, to_iso=to_iso),
        )
        return _ok({"members": rows, "count": len(rows)})

    def _vehicle_stats_debug(self, conn, range_key, from_iso, to_iso):
        """Diagnose-Dump: pro Match im Range zeigen wir Squad-Mitglieder
        + Anzahl Vehicle/Kill/Knock-Events + ob die ENEMY-VehicleEnter
        Events nach dem Filter-Fix mitlaufen.
        """
        from pubg.aggregations import (
            BATTLE_ROYALE_MODES, _range_filter, _br_filter,
            compute_vehicle_stats)
        if from_iso:
            cutoff = from_iso
            end_filter = " AND m.played_at <= ?" if to_iso else ""
            params = [self.my_account_id, cutoff]
            if to_iso:
                params.append(to_iso)
        else:
            cutoff = (_range_filter(conn, range_key)
                      if range_key != "all" else "1970-01-01T00:00:00Z")
            end_filter = ""
            params = [self.my_account_id, cutoff]
        br_sql, br_params = _br_filter("m")
        params += br_params
        matches = conn.execute(f"""
            SELECT m.match_id, m.played_at, m.map_name, mtm.team_id
            FROM matches m
            JOIN match_team_mapping mtm ON mtm.match_id = m.match_id
            WHERE mtm.account_id = ? AND m.played_at >= ?{end_filter}
              AND {br_sql}
            ORDER BY m.played_at DESC
            LIMIT 30
        """, params).fetchall()
        out = []
        for m in matches:
            mid = m["match_id"]
            team = m["team_id"]
            squad = [r["account_id"] for r in conn.execute(
                "SELECT DISTINCT mtm.account_id, p.name "
                "FROM match_team_mapping mtm "
                "LEFT JOIN players p ON p.account_id = mtm.account_id "
                "WHERE mtm.match_id = ? AND mtm.team_id = ?",
                (mid, team)).fetchall()]
            squad_names = [r["name"] for r in conn.execute(
                "SELECT p.name FROM match_team_mapping mtm "
                "LEFT JOIN players p ON p.account_id = mtm.account_id "
                "WHERE mtm.match_id = ? AND mtm.team_id = ?",
                (mid, team)).fetchall() if r["name"]]
            qsph = ",".join("?" * len(squad)) if squad else "''"
            ev_squad = conn.execute(
                f"SELECT COUNT(*) FROM telemetry_events WHERE match_id=? "
                f"AND event_type='VehicleEnter' AND actor_account IN ({qsph})",
                [mid] + squad).fetchone()[0]
            ev_enemy = conn.execute(
                f"SELECT COUNT(*) FROM telemetry_events WHERE match_id=? "
                f"AND event_type='VehicleEnter' AND actor_account NOT IN ({qsph})",
                [mid] + squad).fetchone()[0]
            kills = conn.execute(
                f"SELECT COUNT(*) FROM telemetry_events WHERE match_id=? "
                f"AND event_type='Kill' AND actor_account IN ({qsph})",
                [mid] + squad).fetchone()[0]
            knocks = conn.execute(
                f"SELECT COUNT(*) FROM telemetry_events WHERE match_id=? "
                f"AND event_type='Knock' AND actor_account IN ({qsph})",
                [mid] + squad).fetchone()[0]
            out.append({
                "matchId":      mid,
                "playedAt":     m["played_at"],
                "map":          m["map_name"],
                "squad":        squad_names,
                "vehicleEnterSquad":  ev_squad,
                "vehicleEnterEnemy":  ev_enemy,
                "killsBySquad":  kills,
                "knocksBySquad": knocks,
            })
        # Plus: gesamtes compute-Ergebnis fuer den Range
        stats = compute_vehicle_stats(
            conn, self.my_account_id, range_key,
            from_iso=from_iso, to_iso=to_iso)
        return {
            "range": range_key, "from": from_iso, "to": to_iso,
            "matchesInRange": len(matches),
            "matches": out,
            "stats": stats,
            "_note": ("vehicleEnterEnemy=0 fuer historische Matches → "
                      "hidrive-refill noetig damit Eviction-Dealt funktioniert"),
        }

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
        items = self.cache.get_or_compute(
            cache_key,
            lambda: compute_session_achievements(
                conn, self.my_account_id,
                from_iso=from_iso, to_iso=to_iso),
        )
        # Enrich: PNG-Icon-URL, lokalisierter Canonical + Label fuer den Report.
        # Original-icon (Emoji) bleibt als Fallback drin.
        lang = self._current_lang()
        enriched = []
        for a in items:
            aid = a.get("id")
            enriched.append({
                **a,
                "label":     self._localize_label(a.get("label"), aid, lang),
                "iconUrl":   self.PUBG_ICON_URLS.get(aid),
                "canonical": self._localized_prefix(aid, lang),
            })
        return _ok(enriched)

    # Per-Lang Beschreibungs-Texte fuer PUBG-Session-Milestones.
    # Fallback-Sprache: english. Wird in den Responses mit-geliefert.
    # Beschreibung soll sprach-spezifisch sein und KEINE konkreten
    # Schwellenwerte (×2, ×5 etc.) enthalten — die kommen aus dem
    # Label (z.B. 'Top-10 Streak ×3'). Description erklaert nur was
    # die Bedingung ist.
    PUBG_ACH_DESCRIPTIONS = {
        "english": {
            "first_chicken":           "First Chicken Dinner of the session",
            "first_top10":             "First Top-10 finish of the session",
            "longest_kill_400":        "Longest Kill of 400m or more",
            "longest_kill_600":        "Longest Kill of 600m or more",
            "longest_kill_800":        "Longest Kill of 800m or more",
            "longest_kill_1000":       "Longest Kill of 1000m or more",
            "five_kill_match":         "Match with at least 5 kills",
            "kills_5":                 "Match with at least 5 kills",
            "kills_7":                 "Match with at least 7 kills",
            "kills_10":                "Match with at least 10 kills",
            "kills_15":                "Match with at least 15 kills",
            "kills_20":                "20-Bomb — match with 20+ kills",
            "damage_500":              "Match with at least 500 damage",
            "damage_1000":             "Match with at least 1000 damage",
            "damage_1500":             "Match with at least 1500 damage",
            "damage_2000":             "Match with at least 2000 damage",
            "damage_2500":             "Match with at least 2500 damage",
            "damage_3000":             "GODLIKE — 3000+ damage in a match",
            "beast_chicken":           "Chicken with 5+ kills — Beast Mode",
            "ultra_chicken":           "Chicken with 10+ kills — Ultra Mode",
            "god_mode_chicken":        "Chicken with 15+ kills — God Mode",
            "burning_hell":            "Hot drop with 5+ enemy teams within 300m",
            "phoenix_chicken":         "Chicken win straight out of a hot drop",
            "heist_kills_50":          "Heist match with 50+ kills",
            "heist_kills_75":          "Heist match with 75+ kills",
            "heist_kills_100":         "Heist match with 100+ kills",
            "heist_dmg_8k":            "Heist match with 8000+ damage",
            "heist_dmg_15k":           "Heist match with 15000+ damage",
            "heist_dmg_20k":           "Heist match with 20000+ damage",
            "heist_dmg_25k":           "Heist match with 25000+ damage",
            "heist_loot_25":           "Squad looted 25+ items in a heist",
            "heist_loot_60":           "Squad looted 60+ items in a heist",
            "heist_loot_120":          "Squad looted 120+ items in a heist",
            "gold_brick_grab":         "Squad grabbed gold bricks in a heist",
            "money_bag_run":           "Squad grabbed money bags in a heist",
            "silent_heist":            "Heist match completed with 0 kills",
            "ghost_operative":         "Heist with 0 kills, 0 damage, 10+ loot",
            "window_smasher":          "Smashed 30+ windows in a heist",
            "redzone_death":           "Killed by the red zone bomb",
            "vehicle_kill":            "Ran over and killed an enemy",
            "vehicle_death":           "Got run over by a vehicle",
            "vehicle_gunkill":         "Killed an enemy while driving",
            "first_hot_drop":          "First hot drop in the session",
            "hot_drop_match":          "Multiple hot drops in a row — no cold drop in between",
            "hot_drop_match_survived": "Multiple hot drops survived in a row",
            "first_hot_drop_survived": "First survived hot drop in the session",
            "top3_streak":             "Multiple Top-3 finishes in a row",
            "top10_streak":            "Multiple Top-10 finishes in a row",
            "chicken_streak":          "Multiple Chicken Dinners in a row",
            "session_opener_chicken":  "First match of the session was a Chicken Dinner",
            "session_opener_top10":    "First match of the session was a Top-10 finish",
        },
        "german": {
            "first_chicken":           "Erstes Chicken-Dinner der Session",
            "first_top10":             "Erster Top-10-Finish der Session",
            "longest_kill_400":        "Longest Kill ab 400m",
            "longest_kill_600":        "Longest Kill ab 600m",
            "longest_kill_800":        "Longest Kill ab 800m",
            "longest_kill_1000":       "Longest Kill ab 1000m",
            "five_kill_match":         "Match mit mindestens 5 Kills",
            "kills_5":                 "Match mit mindestens 5 Kills",
            "kills_7":                 "Match mit mindestens 7 Kills",
            "kills_10":                "Match mit mindestens 10 Kills",
            "kills_15":                "Match mit mindestens 15 Kills",
            "kills_20":                "20-Bomb — Match mit 20+ Kills",
            "damage_500":              "Match mit mindestens 500 Schaden",
            "damage_1000":             "Match mit mindestens 1000 Schaden",
            "damage_1500":             "Match mit mindestens 1500 Schaden",
            "damage_2000":             "Match mit mindestens 2000 Schaden",
            "damage_2500":             "Match mit mindestens 2500 Schaden",
            "damage_3000":             "GODLIKE — 3000+ Schaden in einem Match",
            "beast_chicken":           "Chicken mit 5+ Kills — Beast Mode",
            "ultra_chicken":           "Chicken mit 10+ Kills — Ultra Mode",
            "god_mode_chicken":        "Chicken mit 15+ Kills — God Mode",
            "burning_hell":            "Hot-Drop mit 5+ Gegner-Teams im 300m-Radius",
            "phoenix_chicken":         "Chicken-Win direkt aus dem Hot-Drop",
            "heist_kills_50":          "Heist-Match mit 50+ Kills",
            "heist_kills_75":          "Heist-Match mit 75+ Kills",
            "heist_kills_100":         "Heist-Match mit 100+ Kills",
            "heist_dmg_8k":            "Heist-Match mit 8000+ Schaden",
            "heist_dmg_15k":           "Heist-Match mit 15000+ Schaden",
            "heist_dmg_20k":           "Heist-Match mit 20000+ Schaden",
            "heist_dmg_25k":           "Heist-Match mit 25000+ Schaden",
            "heist_loot_25":           "Squad hat 25+ Items im Heist gelootet",
            "heist_loot_60":           "Squad hat 60+ Items im Heist gelootet",
            "heist_loot_120":          "Squad hat 120+ Items im Heist gelootet",
            "gold_brick_grab":         "Squad hat Goldbarren im Heist erbeutet",
            "money_bag_run":           "Squad hat Geldsack im Heist erbeutet",
            "silent_heist":            "Heist-Match ohne Kills abgeschlossen",
            "ghost_operative":         "Heist mit 0 Kills, 0 DMG, 10+ Loot",
            "window_smasher":          "30+ Fenster im Heist eingeschlagen",
            "redzone_death":           "Von der Roten Zone bombardiert",
            "vehicle_kill":            "Gegner überfahren",
            "vehicle_death":           "Von Fahrzeug überfahren worden",
            "vehicle_gunkill":         "Gegner beim Fahren erschossen",
            "first_hot_drop":          "Erstes Hot-Drop der Session",
            "hot_drop_match":          "Mehrere Hot-Drops in Folge — kein Cold-Drop dazwischen",
            "hot_drop_match_survived": "Mehrere Hot-Drops in Folge überlebt",
            "first_hot_drop_survived": "Erstes überlebtes Hot-Drop der Session",
            "top3_streak":             "Mehrere Top-3-Finishes in Folge",
            "top10_streak":            "Mehrere Top-10-Finishes in Folge",
            "chicken_streak":          "Mehrere Chicken-Dinners in Folge",
            "session_opener_chicken":  "Erster Match der Session war ein Chicken-Dinner",
            "session_opener_top10":    "Erster Match der Session war ein Top-10-Finish",
        },
        "french": {
            "first_chicken":           "Premier Chicken Dinner de la session",
            "first_top10":             "Premier top 10 de la session",
            "longest_kill_400":        "Longest Kill de 400m ou plus",
            "longest_kill_600":        "Longest Kill de 600m ou plus",
            "longest_kill_800":        "Longest Kill de 800m ou plus",
            "longest_kill_1000":       "Longest Kill de 1000m ou plus",
            "five_kill_match":         "Match avec 5 kills ou plus",
            "kills_5":                 "Match avec au moins 5 kills",
            "kills_7":                 "Match avec au moins 7 kills",
            "kills_10":                "Match avec au moins 10 kills",
            "kills_15":                "Match avec au moins 15 kills",
            "kills_20":                "20-Bomb — match avec 20+ kills",
            "damage_500":              "Match avec au moins 500 dégâts",
            "damage_1000":             "Match avec au moins 1000 dégâts",
            "damage_1500":             "Match avec au moins 1500 dégâts",
            "damage_2000":             "Match avec au moins 2000 dégâts",
            "damage_2500":             "Match avec au moins 2500 dégâts",
            "damage_3000":             "GODLIKE — 3000+ dégâts en un match",
            "beast_chicken":           "Chicken avec 5+ kills — Beast Mode",
            "ultra_chicken":           "Chicken avec 10+ kills — Ultra Mode",
            "god_mode_chicken":        "Chicken avec 15+ kills — God Mode",
            "burning_hell":            "Hot drop avec 5+ équipes ennemies dans 300m",
            "phoenix_chicken":         "Chicken win direct d'un hot drop",
            "first_hot_drop":          "Premier hot drop de la session",
            "hot_drop_match":          "Plusieurs hot drops d'affilée — aucun cold drop entre",
            "hot_drop_match_survived": "Plusieurs hot drops survécus d'affilée",
            "first_hot_drop_survived": "Premier hot drop survécu",
            "top3_streak":             "Plusieurs top 3 d'affilée",
            "top10_streak":            "Plusieurs top 10 d'affilée",
            "chicken_streak":          "Plusieurs Chicken d'affilée",
            "session_opener_chicken":  "Premier match de la session = Chicken Dinner",
            "session_opener_top10":    "Premier match de la session = top 10",
        },
        "spanish": {
            "first_chicken":           "Primer Chicken Dinner de la sesión",
            "first_top10":             "Primer Top 10 de la sesión",
            "longest_kill_400":        "Longest Kill de 400m o más",
            "longest_kill_600":        "Longest Kill de 600m o más",
            "longest_kill_800":        "Longest Kill de 800m o más",
            "longest_kill_1000":       "Longest Kill de 1000m o más",
            "five_kill_match":         "Partida con 5+ kills",
            "kills_5":                 "Partida con al menos 5 kills",
            "kills_7":                 "Partida con al menos 7 kills",
            "kills_10":                "Partida con al menos 10 kills",
            "kills_15":                "Partida con al menos 15 kills",
            "kills_20":                "20-Bomb — partida con 20+ kills",
            "damage_500":              "Partida con al menos 500 de daño",
            "damage_1000":             "Partida con al menos 1000 de daño",
            "damage_1500":             "Partida con al menos 1500 de daño",
            "damage_2000":             "Partida con al menos 2000 de daño",
            "damage_2500":             "Partida con al menos 2500 de daño",
            "damage_3000":             "GODLIKE — 3000+ de daño en una partida",
            "beast_chicken":           "Chicken con 5+ kills — Modo Bestia",
            "ultra_chicken":           "Chicken con 10+ kills — Modo Ultra",
            "god_mode_chicken":        "Chicken con 15+ kills — Modo Dios",
            "burning_hell":            "Hot drop con 5+ equipos enemigos en 300m",
            "phoenix_chicken":         "Chicken win directo de un hot drop",
            "first_hot_drop":          "Primer hot drop de la sesión",
            "hot_drop_match":          "Varios hot drops seguidos — sin cold drop entre medio",
            "hot_drop_match_survived": "Varios hot drops sobrevividos seguidos",
            "first_hot_drop_survived": "Primer hot drop sobrevivido",
            "top3_streak":             "Varios Top 3 seguidos",
            "top10_streak":            "Varios Top 10 seguidos",
            "chicken_streak":          "Varios Chickens seguidos",
            "session_opener_chicken":  "Primer partida de la sesión = Chicken Dinner",
            "session_opener_top10":    "Primer partida de la sesión = Top 10",
        },
        "dutch": {
            "first_chicken":           "Eerste Chicken Dinner van de sessie",
            "first_top10":             "Eerste Top-10 van de sessie",
            "longest_kill_400":        "Longest Kill van 400m of meer",
            "longest_kill_600":        "Longest Kill van 600m of meer",
            "longest_kill_800":        "Longest Kill van 800m of meer",
            "longest_kill_1000":       "Longest Kill van 1000m of meer",
            "five_kill_match":         "Match met 5+ kills",
            "kills_5":                 "Match met minstens 5 kills",
            "kills_7":                 "Match met minstens 7 kills",
            "kills_10":                "Match met minstens 10 kills",
            "kills_15":                "Match met minstens 15 kills",
            "kills_20":                "20-Bomb — match met 20+ kills",
            "damage_500":              "Match met minstens 500 schade",
            "damage_1000":             "Match met minstens 1000 schade",
            "damage_1500":             "Match met minstens 1500 schade",
            "damage_2000":             "Match met minstens 2000 schade",
            "damage_2500":             "Match met minstens 2500 schade",
            "damage_3000":             "GODLIKE — 3000+ schade in een match",
            "beast_chicken":           "Chicken met 5+ kills — Beast Mode",
            "ultra_chicken":           "Chicken met 10+ kills — Ultra Mode",
            "god_mode_chicken":        "Chicken met 15+ kills — God Mode",
            "burning_hell":            "Hot drop met 5+ vijandelijke teams binnen 300m",
            "phoenix_chicken":         "Chicken win recht uit een hot drop",
            "first_hot_drop":          "Eerste hot drop van de sessie",
            "hot_drop_match":          "Meerdere hot drops op rij — geen cold drop ertussen",
            "hot_drop_match_survived": "Meerdere hot drops op rij overleefd",
            "first_hot_drop_survived": "Eerste overleefde hot drop",
            "top3_streak":             "Meerdere Top-3 op rij",
            "top10_streak":            "Meerdere Top-10 op rij",
            "chicken_streak":          "Meerdere Chickens op rij",
            "session_opener_chicken":  "Eerste match van de sessie = Chicken Dinner",
            "session_opener_top10":    "Eerste match van de sessie = Top-10",
        },
        "italian": {
            "first_chicken":           "Primo Chicken Dinner della sessione",
            "first_top10":             "Primo Top-10 della sessione",
            "longest_kill_400":        "Longest Kill di 400m o più",
            "longest_kill_600":        "Longest Kill di 600m o più",
            "longest_kill_800":        "Longest Kill di 800m o più",
            "longest_kill_1000":       "Longest Kill di 1000m o più",
            "five_kill_match":         "Match con 5+ kill",
            "kills_5":                 "Match con almeno 5 kill",
            "kills_7":                 "Match con almeno 7 kill",
            "kills_10":                "Match con almeno 10 kill",
            "kills_15":                "Match con almeno 15 kill",
            "kills_20":                "20-Bomb — match con 20+ kill",
            "damage_500":              "Match con almeno 500 danni",
            "damage_1000":             "Match con almeno 1000 danni",
            "damage_1500":             "Match con almeno 1500 danni",
            "damage_2000":             "Match con almeno 2000 danni",
            "damage_2500":             "Match con almeno 2500 danni",
            "damage_3000":             "GODLIKE — 3000+ danni in un match",
            "beast_chicken":           "Chicken con 5+ kill — Modalità Bestia",
            "ultra_chicken":           "Chicken con 10+ kill — Modalità Ultra",
            "god_mode_chicken":        "Chicken con 15+ kill — Modalità Dio",
            "burning_hell":            "Hot drop con 5+ squadre nemiche entro 300m",
            "phoenix_chicken":         "Chicken win diretto da hot drop",
            "first_hot_drop":          "Primo hot drop della sessione",
            "hot_drop_match":          "Più hot drop di fila — nessun cold drop in mezzo",
            "hot_drop_match_survived": "Più hot drop sopravvissuti di fila",
            "first_hot_drop_survived": "Primo hot drop sopravvissuto",
            "top3_streak":             "Più Top-3 di fila",
            "top10_streak":            "Più Top-10 di fila",
            "chicken_streak":          "Più Chicken di fila",
            "session_opener_chicken":  "Primo match della sessione = Chicken Dinner",
            "session_opener_top10":    "Primo match della sessione = Top-10",
        },
    }

    # Popup-Reihenfolge bei mehreren Milestones aus demselben Match.
    # Idee: erst die Story-Hauptaussage (Chicken Win), dann Details
    # die das Ergebnis ausschmuecken — Spoiler-frei. '7-Kill Match'
    # darf nicht vor 'Beast Chicken' kommen sonst weiss der Viewer
    # 'oh gleich kommt der Beast Mode' bevor er den Win sieht.
    PUBG_POPUP_PRIORITY = {
        # Chicken-Family ganz oben — Hauptaussage immer zuerst.
        "first_chicken":           1,
        "phoenix_chicken":         2,
        "session_opener_chicken":  3,
        "chicken_streak":          4,
        "god_mode_chicken":        5,
        "ultra_chicken":           6,
        "beast_chicken":           7,
        # Kill-Tiers (low to high - low entry erscheint zuerst, aber
        # da nur der hoechste poppt ist die genaue Reihenfolge nur
        # bei Cross-Match-Spoilers relevant)
        "kills_20":                10,
        "kills_15":                11,
        "kills_10":                12,
        "kills_7":                 13,
        "kills_5":                 14,
        "five_kill_match":         14,  # legacy
        # Damage-Tiers
        "damage_3000":             20,
        "damage_2500":             21,
        "damage_2000":             22,
        "damage_1500":             23,
        "damage_1000":             24,
        "damage_500":              25,
        # Longest-Kill-Tiers
        "longest_kill_1000":       30,
        "longest_kill_800":        31,
        "longest_kill_600":        32,
        "longest_kill_400":        33,
        # Top-10/Top-3 Family
        "first_top10":             40,
        "session_opener_top10":    41,
        "top3_streak":             42,
        "top10_streak":            43,
        # Hot-Drop-Family (kommt am Ende, ergaenzt das Drop-Detail)
        "burning_hell":            49,
        "hot_drop_match":          50,
        "first_hot_drop":          50,  # legacy (DB-Rows von vor hot_drop_match)
        "hot_drop_match_survived": 51,
        "first_hot_drop_survived": 51,  # legacy
        # Sonder-Milestones (locker am Ende)
        "redzone_death":           60,
        "vehicle_kill":            61,
        "vehicle_death":           62,
        "vehicle_gunkill":         63,
    }

    # Kanonische Labels fuer aggregierte Darstellung. Die in der DB
    # gespeicherten labels sind kontext-spezifisch (z.B. '7-Kill Match',
    # 'Longest Kill 423m') — fuer den Gruppen-Tile brauchen wir eine
    # generische Bezeichnung.
    PUBG_CANONICAL_LABELS = {
        "first_chicken":           "Dinner Served",
        "phoenix_chicken":         "Phoenix Chicken",
        "first_top10":             "Endgame Initiate",
        "longest_kill_400":        "Long-Range Ranger",
        "longest_kill_600":        "Sniper Elite",
        "longest_kill_800":        "Cross-Map Connection",
        "longest_kill_1000":       "Kilometer Kill",
        "five_kill_match":         "Killing Survivor",
        "kills_5":                 "Killing Survivor",
        "kills_7":                 "Slaughterhouse",
        "kills_10":                "Massacre",
        "kills_15":                "Annihilation",
        "kills_20":                "20-Bomb",
        "damage_500":              "Heavy Hitter",
        "damage_1000":             "Damage Dealer",
        "damage_1500":             "Big Damage",
        "damage_2000":             "Damage Demon",
        "damage_2500":             "Damage Lord",
        "damage_3000":             "GODLIKE",
        "beast_chicken":           "Beast Chicken",
        "ultra_chicken":           "Ultra Chicken",
        "god_mode_chicken":        "God Mode Chicken",
        "burning_hell":            "Burning Hell",
        "hot_drop_match":          "Inferno Begins",
        "hot_drop_match_survived": "Inferno Survivor",
        "first_hot_drop":          "Into the Inferno",
        "first_hot_drop_survived": "Inferno Survivor",
        "top3_streak":             "Podium Streak",
        "top10_streak":            "Endgame Streak",
        "chicken_streak":          "Dinner Streak",
        "session_opener_chicken":  "Cold Start Chicken",
        "session_opener_top10":    "Pretty Good Start",
        "heist_kills_50":          "Heist Massacre",
        "heist_kills_75":          "Heist Annihilation",
        "heist_kills_100":         "Heist God",
        "heist_dmg_8k":            "Heist Heavy",
        "heist_dmg_15k":           "Heist Damage Demon",
        "heist_dmg_20k":           "Heist Damage Lord",
        "heist_dmg_25k":           "Heist GODLIKE",
        "heist_loot_25":           "Solid Heist",
        "heist_loot_60":           "Big Heist",
        "heist_loot_120":          "Mega Heist",
        "gold_brick_grab":         "Gold Brick Heist",
        "money_bag_run":           "Money Bag Run",
        "silent_heist":            "Silent Heist",
        "ghost_operative":         "Ghost Operative",
        "window_smasher":          "Window Smasher",
        # Sonder-Milestones
        "redzone_death":           "Red Zone Victim",
        "vehicle_kill":            "Road Rage",
        "vehicle_death":           "Speed Bump",
        "vehicle_gunkill":         "Drive-By",
    }

    # PUBG-Achievement-Icon-URLs. Komplettes Set fuer alle 44 Milestones
    # nach Sprite-Editor-Workflow generiert. Legacy-IDs (five_kill_match,
    # first_hot_drop, first_hot_drop_survived) zeigen auf die neuen
    # Tier-IDs.
    PUBG_ICON_URLS = {
        # BR Opener
        "first_chicken":           "/widgets/pubg/icons/first_chicken.png",
        "chicken":                 "/widgets/pubg/icons/first_chicken.png",
        "phoenix_chicken":         "/widgets/pubg/icons/phoenix_chicken.png",
        "first_top10":             "/widgets/pubg/icons/first_top10.png",
        "session_opener_chicken":  "/widgets/pubg/icons/session_opener_chicken.png",
        "session_opener_top10":    "/widgets/pubg/icons/session_opener_top10.png",
        # Kill tiers
        "five_kill_match":         "/widgets/pubg/icons/kills_5.png",
        "kills_5":                 "/widgets/pubg/icons/kills_5.png",
        "kills_7":                 "/widgets/pubg/icons/kills_7.png",
        "kills_10":                "/widgets/pubg/icons/kills_10.png",
        "kills_15":                "/widgets/pubg/icons/kills_15.png",
        "kills_20":                "/widgets/pubg/icons/kills_20.png",
        # DMG tiers
        "damage_500":              "/widgets/pubg/icons/damage_500.png",
        "damage_1000":             "/widgets/pubg/icons/damage_1000.png",
        "damage_1500":             "/widgets/pubg/icons/damage_1500.png",
        "damage_2000":             "/widgets/pubg/icons/damage_2000.png",
        "damage_2500":             "/widgets/pubg/icons/damage_2500.png",
        "damage_3000":             "/widgets/pubg/icons/damage_3000.png",
        # Long-range tiers
        "longest_kill_400":        "/widgets/pubg/icons/longest_kill_400.png",
        "longest_kill_600":        "/widgets/pubg/icons/longest_kill_600.png",
        "longest_kill_800":        "/widgets/pubg/icons/longest_kill_800.png",
        "longest_kill_1000":       "/widgets/pubg/icons/longest_kill_1000.png",
        # Beast chickens
        "beast_chicken":           "/widgets/pubg/icons/beast_chicken.png",
        "ultra_chicken":           "/widgets/pubg/icons/ultra_chicken.png",
        "god_mode_chicken":        "/widgets/pubg/icons/god_mode_chicken.png",
        # Hot-Drop / Inferno (Legacy-IDs point to new files)
        "burning_hell":            "/widgets/pubg/icons/burning_hell.png",
        "burning_hell_survivor":   "/widgets/pubg/icons/burning_hell_survivor.png",
        "hot_drop_match":          "/widgets/pubg/icons/hot_drop_match.png",
        "first_hot_drop":          "/widgets/pubg/icons/hot_drop_match.png",
        "hot_drop_match_survived": "/widgets/pubg/icons/hot_drop_match_survived.png",
        "first_hot_drop_survived": "/widgets/pubg/icons/hot_drop_match_survived.png",
        # Streaks
        "top3_streak":             "/widgets/pubg/icons/top3_streak.png",
        "top10_streak":            "/widgets/pubg/icons/top10_streak.png",
        "chicken_streak":          "/widgets/pubg/icons/chicken_streak.png",
        # Heist Kills
        "heist_kills_50":          "/widgets/pubg/icons/heist_kills_50.png",
        "heist_kills_75":          "/widgets/pubg/icons/heist_kills_75.png",
        "heist_kills_100":         "/widgets/pubg/icons/heist_kills_100.png",
        # Heist DMG
        "heist_dmg_8k":            "/widgets/pubg/icons/heist_dmg_8k.png",
        "heist_dmg_15k":           "/widgets/pubg/icons/heist_dmg_15k.png",
        "heist_dmg_20k":           "/widgets/pubg/icons/heist_dmg_20k.png",
        "heist_dmg_25k":           "/widgets/pubg/icons/heist_dmg_25k.png",
        # Heist Loot
        "heist_loot_25":           "/widgets/pubg/icons/heist_loot_25.png",
        "heist_loot_60":           "/widgets/pubg/icons/heist_loot_60.png",
        "heist_loot_120":          "/widgets/pubg/icons/heist_loot_120.png",
        # Heist Special
        "gold_brick_grab":         "/widgets/pubg/icons/gold_brick_grab.png",
        "money_bag_run":           "/widgets/pubg/icons/money_bag_run.png",
        "silent_heist":            "/widgets/pubg/icons/silent_heist.png",
        "ghost_operative":         "/widgets/pubg/icons/ghost_operative.png",
        "window_smasher":          "/widgets/pubg/icons/window_smasher.png",
        # Sonder-Milestones: Redzone, Fahrzeug
        "redzone_death":           None,   # kein eigenes Icon → Emoji 💥
        "vehicle_kill":            None,   # 🚗
        "vehicle_death":           None,   # 🚗
        "vehicle_gunkill":         None,   # 🔫
    }

    def _current_lang(self):
        """Holt die aktive Sprache aus den Steam-Prefs (data/steam-prefs.json)
        — der Steam-Endpoint persistiert die dort. Fallback english.
        Path absolut zum Repo-Root: pubg/endpoints.py -> ../data/."""
        import os, json
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            root = os.path.dirname(here)
            path = os.path.join(root, "data", "steam-prefs.json")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    prefs = json.load(f)
                lang = (prefs.get("language") or "").strip().lower()
                if lang:
                    return lang
        except (OSError, json.JSONDecodeError):
            pass
        return "english"

    def _ach_description(self, achievement_id, lang):
        """Liefert die Beschreibung fuer ein PUBG-Achievement in der
        gewuenschten Sprache. Fallback: english. Returns None wenn
        achievement_id unbekannt ist."""
        lang = (lang or "english").lower()
        d = (self.PUBG_ACH_DESCRIPTIONS.get(lang)
             or self.PUBG_ACH_DESCRIPTIONS.get("english")
             or {})
        if achievement_id in d:
            return d[achievement_id]
        # Fallback auf english wenn die gewuenschte Sprache zwar
        # gemapped ist aber den Key nicht hat
        return self.PUBG_ACH_DESCRIPTIONS.get("english", {}).get(achievement_id)

    # IDs deren Label einen ×N-Counter traegt (Streak-Peak oder
    # Session-Counter). Fuer diese rechnen wir die Snapshot-pct gegen
    # 'Sessions die >= N erreicht haben' — dadurch wird ×5 seltener
    # als ×2. Achievements ohne ×N (z.B. first_chicken, beast_chicken)
    # bleiben aggregiert auf achievement_id-Ebene.
    # Lokalisierte Praefixe pro achievement_id. Wird zur Response-Zeit
    # eingesetzt — die Labels in der DB bleiben Englisch (sprach-agnostisch).
    # Was hier NICHT drinsteht, fallback auf English aus PUBG_CANONICAL_LABELS.
    # Convention: typische Gamer-Begriffe (GODLIKE, 20-Bomb, Phoenix Chicken,
    # Beast Chicken, Sniper Elite usw.) bleiben universell Englisch.
    PUBG_LABEL_TRANSLATIONS = {
        "german": {
            "first_chicken":           "Dinner serviert",
            "first_top10":             "Heiße Phase eingeleitet",
            "kills_10":                "Massaker",
            "kills_15":                "Vernichtung",
            "damage_1500":             "Großer Schaden",
            "damage_2000":             "Schadens-Dämon",
            "hot_drop_match":          "Inferno beginnt",
            "hot_drop_match_survived": "Inferno-Überlebender",
            "first_hot_drop":          "Ins Inferno",
            "first_hot_drop_survived": "Inferno-Überlebender",
            "top3_streak":             "Podium-Serie",
            "top10_streak":            "Endgame-Serie",
            "chicken_streak":          "Dinner-Serie",
            "session_opener_top10":    "Starker Beginn",
            # Heist/PAYDAY (Coup = gaengiger dt. Begriff fuer 'Raub')
            "heist_kills_50":          "Coup-Massaker",
            "heist_kills_75":          "Coup-Vernichtung",
            "heist_kills_100":         "Coup-Gott",
            "heist_dmg_8k":            "Schwerer Coup",
            "heist_dmg_15k":           "Coup-Schadensdämon",
            "heist_dmg_20k":           "Coup-Schadenslord",
            "heist_dmg_25k":           "Coup-GODLIKE",
            "heist_loot_25":           "Solider Coup",
            "heist_loot_60":           "Großer Coup",
            "heist_loot_120":          "Mega-Coup",
            "gold_brick_grab":         "Goldbarren-Coup",
            "money_bag_run":           "Geldsack-Beute",
            "silent_heist":            "Stiller Coup",
            "ghost_operative":         "Phantom-Agent",
            "window_smasher":          "Fensterstürmer",
        },
        "french": {
            "first_chicken":           "Dîner servi",
            "first_top10":             "Initiation Endgame",
            "kills_10":                "Massacre",
            "kills_15":                "Annihilation",
            "damage_1500":             "Gros dégâts",
            "damage_2000":             "Démon des dégâts",
            "hot_drop_match":          "Inferno commence",
            "hot_drop_match_survived": "Survivant de l'Inferno",
            "first_hot_drop":          "Dans l'Inferno",
            "first_hot_drop_survived": "Survivant de l'Inferno",
            "top3_streak":             "Série Podium",
            "top10_streak":            "Série Endgame",
            "chicken_streak":          "Série Dinner",
            "session_opener_top10":    "Bon départ",
        },
        "spanish": {
            "first_chicken":           "Dinner servido",
            "first_top10":             "Iniciación Endgame",
            "kills_10":                "Masacre",
            "kills_15":                "Aniquilación",
            "damage_1500":             "Daño grande",
            "damage_2000":             "Demonio del daño",
            "hot_drop_match":          "Inferno comienza",
            "hot_drop_match_survived": "Superviviente del Inferno",
            "first_hot_drop":          "Al Inferno",
            "first_hot_drop_survived": "Superviviente del Inferno",
            "top3_streak":             "Racha Podio",
            "top10_streak":            "Racha Endgame",
            "chicken_streak":          "Racha Dinner",
            "session_opener_top10":    "Buen comienzo",
        },
        "dutch": {
            "first_chicken":           "Dinner geserveerd",
            "first_top10":             "Endgame-initiatie",
            "kills_10":                "Bloedbad",
            "kills_15":                "Vernietiging",
            "damage_1500":             "Grote schade",
            "damage_2000":             "Schade-demon",
            "hot_drop_match":          "Inferno begint",
            "hot_drop_match_survived": "Inferno-overlever",
            "first_hot_drop":          "In het Inferno",
            "first_hot_drop_survived": "Inferno-overlever",
            "top3_streak":             "Podium-reeks",
            "top10_streak":            "Endgame-reeks",
            "chicken_streak":          "Dinner-reeks",
            "session_opener_top10":    "Goede start",
        },
        "italian": {
            "first_chicken":           "Dinner servito",
            "first_top10":             "Iniziazione Endgame",
            "kills_10":                "Massacro",
            "kills_15":                "Annichilimento",
            "damage_1500":             "Grandi danni",
            "damage_2000":             "Demone dei danni",
            "hot_drop_match":          "Inferno inizia",
            "hot_drop_match_survived": "Sopravvissuto all'Inferno",
            "first_hot_drop":          "Nell'Inferno",
            "first_hot_drop_survived": "Sopravvissuto all'Inferno",
            "top3_streak":             "Serie Podio",
            "top10_streak":            "Serie Endgame",
            "chicken_streak":          "Serie Dinner",
            "session_opener_top10":    "Buon inizio",
        },
    }

    def _localized_prefix(self, achievement_id, lang):
        """Liefert den lokalisierten Praefix (ohne Suffix) fuer ein
        achievement_id. Fallback: English aus PUBG_CANONICAL_LABELS."""
        if not achievement_id:
            return None
        lang_map = self.PUBG_LABEL_TRANSLATIONS.get(lang or "english", {})
        if achievement_id in lang_map:
            return lang_map[achievement_id]
        return self.PUBG_CANONICAL_LABELS.get(achievement_id)

    def _localize_label(self, label, achievement_id, lang):
        """Tauscht den Praefix eines DB-Labels (Englisch) gegen die
        lokalisierte Version. Suffix (· N Kills / ×3 / · 423m) bleibt.
        Beispiel: 'Massacre · 12 Kills' + lang=german
              -> 'Massaker · 12 Kills'"""
        if not label or not achievement_id:
            return label
        new_prefix = self._localized_prefix(achievement_id, lang)
        if not new_prefix:
            return label
        import re as _re
        # Suffix beginnt beim ersten ' · ', ' ×' oder ' #'
        m = _re.search(r"\s+[·×#]", label)
        if m:
            return new_prefix + label[m.start():]
        return new_prefix

    PUBG_TIERED_ACHIEVEMENTS = {
        "top3_streak",
        "top10_streak",
        "chicken_streak",
        "hot_drop_match",
        "hot_drop_match_survived",
        # Event/Heist Tiers werden ueber ihre IDs (heist_kills_50 etc.)
        # geparst, nicht ueber Label-x-N — daher nicht in dieser Liste.
    }

    def _session_date_pools(self, conn):
        """Liefert (br_dates, event_dates) — distinct date-Strings auf
        denen BR bzw. Event-Modes gespielt wurden. Wird fuer sessionPct
        gebraucht: Event-Achievements duerfen nicht gegen 'alle Sessions'
        verrechnet werden (sonst zerquetscht der BR-Anteil die pct)."""
        from pubg.aggregations import BATTLE_ROYALE_MODES
        br_ph = ",".join("?" * len(BATTLE_ROYALE_MODES))
        br_dates = sorted({
            r[0] for r in conn.execute(
                f"SELECT DISTINCT date(played_at) FROM matches "
                f"WHERE played_at IS NOT NULL "
                f"  AND game_mode IN ({br_ph})",
                list(BATTLE_ROYALE_MODES)
            ).fetchall() if r[0]
        })
        event_dates = sorted({
            r[0] for r in conn.execute(
                f"SELECT DISTINCT date(played_at) FROM matches "
                f"WHERE played_at IS NOT NULL "
                f"  AND game_mode NOT IN ({br_ph})",
                list(BATTLE_ROYALE_MODES)
            ).fetchall() if r[0]
        })
        return br_dates, event_dates

    def _pool_for_aid(self, aid, br_dates, event_dates):
        if aid in self.PUBG_EVENT_ACHIEVEMENTS:
            return event_dates
        return br_dates

    def _session_match_pools(self, conn):
        """Wie _session_date_pools, aber pro Match (ISO-String).
        Fuer matchPct (= % der Matches die dieses Milestone hatten)."""
        from pubg.aggregations import BATTLE_ROYALE_MODES
        br_ph = ",".join("?" * len(BATTLE_ROYALE_MODES))
        br = sorted(
            r["p"] for r in conn.execute(
                f"SELECT played_at AS p FROM matches "
                f"WHERE played_at IS NOT NULL "
                f"  AND game_mode IN ({br_ph})",
                list(BATTLE_ROYALE_MODES)).fetchall() if r["p"])
        ev = sorted(
            r["p"] for r in conn.execute(
                f"SELECT played_at AS p FROM matches "
                f"WHERE played_at IS NOT NULL "
                f"  AND game_mode NOT IN ({br_ph})",
                list(BATTLE_ROYALE_MODES)).fetchall() if r["p"])
        return br, ev

    def _build_aid_match_tier_index(self, conn):
        """Pro achievement_id → sortierte Liste (played_at, tier).
        Anders als _build_aid_tier_index (das auf Tagen aggregiert),
        zaehlt das jede einzelne Match-Vorkommnis."""
        rows = conn.execute(
            "SELECT achievement_id, label, played_at "
            "FROM pubg_achievements_seen "
            "WHERE played_at IS NOT NULL"
        ).fetchall()
        per_aid = {}
        for r in rows:
            tier = self._parse_tier(r["label"]) or 0
            per_aid.setdefault(r["achievement_id"], []).append(
                (r["played_at"], tier))
        for aid in per_aid:
            per_aid[aid].sort()
        return per_aid

    def _count_aid_matches_tier(self, per_aid_index, aid, tier,
                                cutoff_played_at):
        entries = per_aid_index.get(aid, [])
        if not entries:
            return 0
        if tier is None or aid not in self.PUBG_TIERED_ACHIEVEMENTS:
            return sum(1 for p, _t in entries if p <= cutoff_played_at)
        return sum(1 for p, t in entries
                   if p <= cutoff_played_at and t >= tier)

    def _pool_matches_for_aid(self, aid, br_matches, event_matches):
        if aid in self.PUBG_EVENT_ACHIEVEMENTS:
            return event_matches
        return br_matches

    # Achievements die nur in Event/PAYDAY-Sessions ueberhaupt erreichbar
    # sind. Bei der sessionPct-Berechnung wird der Nenner auf 'Sessions
    # mit Event-Match' begrenzt — sonst zerquetscht ein User der 95%
    # seiner Zeit BR spielt jede Heist-pct (selbst 'jedes Heist-Match
    # ein Massacre' waere nur 5% global).
    PUBG_EVENT_ACHIEVEMENTS = {
        "heist_kills_50", "heist_kills_75", "heist_kills_100",
        "heist_dmg_8k", "heist_dmg_15k",
        "heist_dmg_20k", "heist_dmg_25k",
        "heist_loot_25", "heist_loot_60", "heist_loot_120",
        "silent_heist", "ghost_operative",
        "gold_brick_grab", "money_bag_run", "window_smasher",
    }

    @staticmethod
    def _parse_tier(label):
        """Extrahiert N aus einem Label wie 'Endgame Streak ×3' oder
        'Inferno Begins ×2'. Returns int oder None."""
        if not label:
            return None
        import re as _re
        m = _re.search(r"×\s*(\d+)", label)
        return int(m.group(1)) if m else None

    def _build_aid_tier_index(self, conn):
        """Baut pro achievement_id eine sortierte Liste von
        (date, max_tier_an_dem_tag) — fuer Snapshot-pct-Berechnung.
        Bei nicht-tiered Achievements ist max_tier immer 0."""
        rows = conn.execute(
            "SELECT achievement_id, label, played_at "
            "FROM pubg_achievements_seen "
            "WHERE played_at IS NOT NULL"
        ).fetchall()
        # (aid, date) -> max_tier
        per_pair = {}
        for r in rows:
            d = r["played_at"][:10]
            aid = r["achievement_id"]
            tier = self._parse_tier(r["label"]) or 0
            key = (aid, d)
            if key not in per_pair or per_pair[key] < tier:
                per_pair[key] = tier
        # aid -> sorted [(date, max_tier), ...]
        per_aid = {}
        for (aid, d), t in per_pair.items():
            per_aid.setdefault(aid, []).append((d, t))
        for aid in per_aid:
            per_aid[aid].sort()
        return per_aid

    def _count_aid_dates_tier(self, per_aid_index, aid, tier, cutoff_date):
        """Anzahl Session-Tage <= cutoff_date wo diese aid erreicht
        wurde. Bei tiered Achievement: nur Sessions wo max-Tier >= tier."""
        entries = per_aid_index.get(aid, [])
        if not entries:
            return 0
        if tier is None or aid not in self.PUBG_TIERED_ACHIEVEMENTS:
            # Nicht-tiered: jeder Eintrag <= cutoff zaehlt
            return sum(1 for d, _t in entries if d <= cutoff_date)
        return sum(1 for d, t in entries
                   if d <= cutoff_date and t >= tier)

    def _recent_achievements(self, qs):
        """Liefert noch nicht angezeigte Session-Milestones aus
        pubg_achievements_seen. ?markDisplayed=1 markiert sie nach
        Lieferung als shown — gleicher Mechanismus wie Steam.
        Antwort-Schema mappt auf das was achievement-popup.html
        erwartet (apiName/displayName/iconUrl/etc).
        Description kommt aus PUBG_ACH_DESCRIPTIONS in der Sprache
        die der Steam-Endpoint aktuell als Default fuehrt."""
        from bisect import bisect_right
        mark = qs.get("markDisplayed") == "1"
        lang = self._current_lang()
        conn = self.get_conn()
        rows = conn.execute("""
            SELECT achievement_id, match_id, label, icon,
                   played_at, detected_at, is_rare
            FROM pubg_achievements_seen
            WHERE displayed_at IS NULL
            ORDER BY played_at ASC
        """).fetchall()

        # Snapshot-in-time-Pct: pro Item berechnen wie haeufig dieses
        # Milestone bis zum Zeitpunkt 'played_at' in deinen Sessions
        # vorkam — gleiche Logik wie im Achievement-Browser, damit
        # Popup und Browser konsistent sind.
        # Zwei getrennte Date-Pools: BR-Achievements werden gegen
        # BR-Sessions verrechnet, Event-Achievements (Heist etc.) gegen
        # Event-Sessions — sonst zerstoert der BR-Anteil jede Event-pct.
        br_dates, event_dates = self._session_date_pools(conn)
        per_aid_dates_tier = self._build_aid_tier_index(conn)

        items = []
        for r in rows:
            # Unix-Epoch fuer played_at (achievement-popup erwartet das)
            unlocked_ts = 0
            played = r["played_at"]
            if played:
                try:
                    import datetime as _dt
                    unlocked_ts = int(_dt.datetime.fromisoformat(
                        played.replace("Z", "+00:00")).timestamp())
                except (TypeError, ValueError):
                    unlocked_ts = 0
            # Snapshot-pct: 'X% of your sessions got this' bis zum
            # Zeitpunkt dieses Vorkommens. Bei tier-Milestones wie
            # 'Endgame Streak ×3' wird nur gegen Sessions gezaehlt die
            # mindestens ×3 erreicht haben — dadurch wird ×5 seltener
            # als ×2 (sub-set Logik). Bei fehlendem Datum None.
            d = (played or "")[:10]
            pool = self._pool_for_aid(
                r["achievement_id"], br_dates, event_dates)
            if d and pool:
                total = bisect_right(pool, d)
                ach_n = self._count_aid_dates_tier(
                    per_aid_dates_tier, r["achievement_id"],
                    self._parse_tier(r["label"]), d)
                snap_pct = round((ach_n / max(total, 1)) * 100, 1)
            else:
                snap_pct = None
            items.append({
                "appId":       -2,  # PUBG-Marker (Steam-Side nutzt -1 fuer Test)
                "gameName":    "PUBG: Session Milestones",
                "apiName":     f"{r['achievement_id']}:{r['match_id']}",
                "displayName": self._localize_label(
                    r["label"], r["achievement_id"], lang),
                "description": self._ach_description(r["achievement_id"], lang),
                "iconUrl":     (self.PUBG_ICON_URLS.get(r["achievement_id"])
                                or r["icon"]),
                "unlockedAt":  unlocked_ts,
                "sessionPct":  snap_pct,
                "isRare":      bool(r["is_rare"]),
                "source":      "pubg",
                "_aid":        r["achievement_id"],
            })
        # Innerhalb gleicher played_at-Zeit per Priority sortieren, damit im
        # Popup-Stream nichts vorweggenommen wird (z.B. '7 Kills' vor
        # 'First Chicken' wuerde Beast Chicken spoilern).
        items.sort(key=lambda u: (
            u["unlockedAt"],
            self.PUBG_POPUP_PRIORITY.get(u["_aid"], 99),
        ))
        for it in items:
            it.pop("_aid", None)
        marked_n = 0
        if mark and items:
            conn.execute("""
                UPDATE pubg_achievements_seen
                SET displayed_at = strftime('%s','now')
                WHERE displayed_at IS NULL
            """)
            conn.commit()
            marked_n = len(items)
        return _ok({"unlocks": items, "marked": marked_n})

    def _achievements_list(self, qs):
        """Liste aller einzelnen PUBG-Session-Milestone-Vorkommen.
        Jeder Eintrag bekommt einen SNAPSHOT-IN-TIME-Pct:
          (distinct session-Tage mit diesem achievement_id bis hier)
          / (distinct session-Tage gesamt bis hier) * 100
        Das heisst der erste Chicken zeigt '100% deiner Sessions' (1/1
        zum Zeitpunkt), spaeter werden andere %s anders.

        Antwort sortiert nach played_at DESC (neueste zuerst).
        Label kommt instanzspezifisch aus pubg_achievements_seen.label
        (z.B. 'Beast Chicken · 7 Kills'), damit Detailinfo erhalten bleibt.
        Gecacht — wird bei neuen Matches/Achievements via cache.invalidate()
        automatisch geleert.
        """
        import datetime as _dt
        from bisect import bisect_right
        conn = self.get_conn()
        cached = self.cache.get("pubg-achievements-list")
        if cached is not None:
            return _ok(cached)

        # Pcts werden NICHT mehr live berechnet — sie sind beim Insert als
        # Snapshot gespeichert (session_pct / match_pct Spalten in DB).
        # Nur match_dates noch fuer totalSessions.
        try:
            br_dates, event_dates = self._session_date_pools(conn)
        except Exception:
            br_dates = event_dates = []
        match_dates = sorted(set(br_dates) | set(event_dates))

        # Achievement-Rows + Map-Name (LEFT JOIN matches).
        rows = conn.execute("""
            SELECT a.achievement_id, a.match_id, a.label, a.icon,
                   a.played_at, a.detected_at, a.is_rare, a.displayed_at,
                   a.session_pct, a.match_pct, a.suppress_popup,
                   m.map_name, m.game_mode, m.duration_secs
            FROM pubg_achievements_seen a
            LEFT JOIN matches m ON m.match_id = a.match_id
            ORDER BY a.played_at ASC
        """).fetchall()

        # Kein Index-Aufbau mehr — Pcts kommen direkt aus DB-Spalten.
        per_aid_dates_tier  = {}  # nicht mehr genutzt
        per_aid_matches_tier = {}  # nicht mehr genutzt

        def _iso_to_ts(iso):
            if not iso:
                return 0
            try:
                return int(_dt.datetime.fromisoformat(
                    iso.replace("Z", "+00:00")).timestamp())
            except (TypeError, ValueError):
                return 0

        lang = self._current_lang()
        items = []
        for r in rows:
            aid = r["achievement_id"]
            d = (r["played_at"] or "")[:10]
            # Pcts direkt aus DB-Spalten — historischer Snapshot,
            # unveraendert seit dem Zeitpunkt des Inserts.
            session_pct = r["session_pct"]
            match_pct   = r["match_pct"]
            items.append({
                "appId":         -2,
                "gameName":      "PUBG: Session Milestones",
                "apiName":       f"{aid}:{r['match_id']}",
                "displayName":   self._localize_label(r["label"], aid, lang),
                "description":   self._ach_description(aid, lang),
                "iconUrl":       (self.PUBG_ICON_URLS.get(aid) or r["icon"]),
                "unlockedAt":    _iso_to_ts(r["played_at"]),
                "sessionPct":    session_pct,
                "matchPct":      match_pct,
                "displayed":     r["displayed_at"] is not None,
                "source":        "pubg",
                "isRare":        bool(r["is_rare"]),
                "matchId":       r["match_id"],
                "achievementId": aid,
                "mapName":       r["map_name"],
                "gameMode":      r["game_mode"],
                "durationSec":   r["duration_secs"],
                "suppressed":    bool(r["suppress_popup"]),
            })
        # Juengste zuerst
        items.sort(key=lambda x: x["unlockedAt"], reverse=True)
        result = {
            "achievements":  items,
            "count":         len(items),
            "totalSessions": len(match_dates),
        }
        self.cache.set("pubg-achievements-list", result)
        return _ok(result)

    def _detect_achievements(self, qs):
        """Triggert die Session-Milestone-Detection manuell. Schreibt
        alles was compute_session_achievements jetzt zurueckliefert in
        pubg_achievements_seen — Duplikate (PK achievement_id+match_id)
        werden via INSERT OR IGNORE geskippt.

        Praktisch:
        - Nach erstem Server-Update wenn die Tabelle leer ist
        - Browser ruft's auto beim Initial-Load auf
        - Demo-Page Button 'Detect now'
        """
        from pubg.aggregations import detect_and_store_session_achievements
        conn = self.get_conn()
        try:
            new_count = detect_and_store_session_achievements(
                conn, self.my_account_id)
        except Exception as e:
            return _err(500, f"detect failed: {e}")
        # Cache invalidieren damit ein evtl. cached session-achievements
        # nicht stale ist
        self.cache.invalidate()
        return _ok({"newAchievements": new_count})

    def _backfill_achievements(self, qs):
        """Historischer Backfill — walkt durch ALLE Matches, splittet
        in Sessions per Time-Gap, detected pro Session, inserted in
        pubg_achievements_seen.

        Query:
          ?gapHours=N    Pause-Schwelle fuer Session-Boundary (Default 6)
          ?popup=1       neue Eintraege als undisplayed markieren (Popups
                         feuern; default 0 = silent Backfill)
        """
        try:
            gap_hours = max(1, int(qs.get("gapHours", "6")))
        except ValueError:
            gap_hours = 6
        suppress = qs.get("popup") != "1"
        from pubg.aggregations import backfill_session_achievements
        conn = self.get_conn()
        try:
            result = backfill_session_achievements(
                conn, self.my_account_id,
                gap_hours=gap_hours, suppress_popup=suppress)
        except Exception as e:
            return _err(500, f"backfill failed: {e}")
        self.cache.invalidate()
        return _ok(result)

    def _refetch_telemetry(self, qs):
        """Trigger Bulk-Telemetry-Catchup im Background. Holt alle Matches
        mit veraltetem telemetry_schema vom PUBG-CDN (14d Retention).
        ?onlyMatch=ID  optionale Einschraenkung auf einen einzigen Match.
        Returns sofort mit 'started' — Fortschritt via /api/pubg/status.
        """
        from pubg.poller import run_bulk_telemetry_catchup
        only_match = (qs.get("onlyMatch") or "").strip()
        import threading
        from pubg.db import connect
        # We have self.get_conn() but the bulk-catchup runs in background
        # thread → eigener Connection-Handle. db_path muessen wir uns aus
        # der bestehenden Connection erraten.
        try:
            cur = self.get_conn().execute("PRAGMA database_list").fetchall()
            db_path = next((r[2] for r in cur if r[1] == "main"), None)
        except Exception:
            db_path = None
        if not db_path:
            return _err(500, "could not determine db_path")
        if only_match:
            # Single-Match-Reset: schema zurueck, damit der Catchup ihn
            # nochmal anpackt
            self.get_conn().execute(
                "UPDATE matches SET telemetry_schema = 0 WHERE match_id = ?",
                (only_match,))
            self.get_conn().commit()

        def _run():
            try:
                conn_bg = connect(db_path)
                run_bulk_telemetry_catchup(
                    conn_bg, self.client, self.my_account_id,
                    max_matches=None, pacing_ms=150)
                conn_bg.close()
            except Exception as e:
                print(f"[refetch-telemetry] failed: {e}")
        threading.Thread(target=_run, daemon=True,
                          name="pubg-refetch-trigger").start()
        return _ok({"started": True, "onlyMatch": only_match or None,
                    "info": "running in background — watch DB for "
                            "telemetry_schema/telemetry_fetched updates"})

    def _replay_achievement(self, qs):
        """Markiert ein einzelnes PUBG-Session-Milestone als undisplayed
        damit das achievement-popup-Widget es beim naechsten Poll
        nochmal feuert. Identisch zum Steam-Replay-Klick.
        Query: ?achievementId=X&matchId=Y (beide required)
        """
        aid = qs.get("achievementId")
        mid = qs.get("matchId")
        if not aid or not mid:
            return _err(400, "achievementId und matchId benoetigt")
        conn = self.get_conn()
        cur = conn.execute("""
            UPDATE pubg_achievements_seen
            SET displayed_at = NULL
            WHERE achievement_id = ? AND match_id = ?
        """, (aid, mid))
        conn.commit()
        return _ok({
            "reset": cur.rowcount,
            "achievementId": aid,
            "matchId": mid,
        })

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
        worst = qs.get("worst") == "1"

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
        if worst:
            filtered.reverse()
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

    # ── Debug: letzte N Matches mit Damage + Achievement-Status ─────────
    def _debug_matches(self, qs):
        """Liefert die letzten N Matches mit damage_dealt, game_mode +
        welche Achievements pro Match in der DB landeten (mit
        suppress_popup-Flag). URL: /api/pubg/debug-matches?n=10"""
        conn = self.get_conn()
        n = int(qs.get("n", "10"))
        rows = conn.execute("""
            SELECT m.match_id, m.played_at, m.game_mode, m.map_name,
                   pa.damage_dealt, pa.kills, pa.place, pa.time_survived,
                   pa.longest_kill, pa.headshot_kills
            FROM participants pa
            JOIN matches m ON m.match_id = pa.match_id
            WHERE pa.account_id = ?
            ORDER BY m.played_at DESC
            LIMIT ?
        """, (self.my_account_id, n)).fetchall()
        out = []
        for r in rows:
            mid = r["match_id"]
            ach_rows = conn.execute("""
                SELECT achievement_id, suppress_popup
                FROM pubg_achievements_seen
                WHERE match_id = ?
                ORDER BY achievement_id
            """, (mid,)).fetchall()
            achievements = [
                {"id": a["achievement_id"],
                 "suppressed": bool(a["suppress_popup"])}
                for a in ach_rows
            ]
            # Heavy-Hitter-Diagnose
            dmg = r["damage_dealt"] or 0
            mode = r["game_mode"] or ""
            is_br = is_br_mode(mode)
            heavy_eligible = is_br and dmg >= 500
            heavy_emitted = any(a["id"] == "damage_500" for a in achievements)
            out.append({
                "matchId":      mid,
                "playedAt":     r["played_at"],
                "gameMode":     mode,
                "isBR":         is_br,
                "map":          r["map_name"],
                "damageDealt":  dmg,
                "kills":        r["kills"] or 0,
                "place":        r["place"],
                "headshots":    r["headshot_kills"] or 0,
                "longestKill":  r["longest_kill"] or 0,
                "achievements": achievements,
                "diag": {
                    "heavyHitterEligible": heavy_eligible,
                    "heavyHitterInDB":     heavy_emitted,
                    "reason": (
                        "OK — Heavy Hitter wurde emittiert" if heavy_emitted
                        else "DMG < 500" if dmg < 500
                        else "Match ist Event-Mode (kein BR)" if not is_br
                        else "DMG ≥ 500 + BR, aber NICHT emittiert "
                             "— rebuild-achievements noch nicht gelaufen?"
                    ),
                },
            })
        return _ok({"matches": out})

    # ── Calibration-Korrekturen — fuer Map-Cal-Fit via User-Death-Drag ──
    def _calibration_events(self, qs):
        """Kill/Knock-Events fuer eine Map mit Telemetrie-Coords (cm).
        Default: nur Events wo der Actor im Squad des Streamers (self)
        war — die Positionen sind dann verlaesslich, weil PUBG meine
        eigenen Squad-Position-Snapshots haeufiger schickt als von
        Gegnern. ?squadOnly=0 schaltet das ab."""
        conn = self.get_conn()
        map_name = (qs.get("map") or "").strip()
        if not map_name:
            return _err(400, "map required")
        squad_only = (qs.get("squadOnly", "1") != "0")
        match_filter = (qs.get("matchId") or "").strip()

        # Squad-IDs pro Match auf der Map ermitteln (= mein Team)
        squad_per_match = {}
        if squad_only and self.my_account_id:
            for r in conn.execute("""
                WITH my_teams AS (
                  SELECT mtm.match_id, mtm.team_id
                  FROM match_team_mapping mtm
                  JOIN matches m ON m.match_id = mtm.match_id
                  WHERE mtm.account_id = ? AND m.map_name = ?
                )
                SELECT mtm.match_id, mtm.account_id
                FROM match_team_mapping mtm
                JOIN my_teams mt ON mt.match_id = mtm.match_id
                                  AND mt.team_id = mtm.team_id
            """, (self.my_account_id, map_name)).fetchall():
                squad_per_match.setdefault(
                    r["match_id"], set()).add(r["account_id"])
            if not squad_per_match:
                return _ok({"map": map_name, "events": []})

        sql = """
            SELECT te.match_id, m.played_at, te.event_type, te.timestamp_ms,
                   te.actor_account, te.target_account,
                   te.victim_x, te.victim_y, te.weapon, te.distance
            FROM telemetry_events te
            JOIN matches m ON m.match_id = te.match_id
            WHERE m.map_name = ?
              AND te.event_type IN ('Kill','Knock')
              AND te.victim_x IS NOT NULL
        """
        params = [map_name]
        if match_filter:
            sql += " AND te.match_id = ?"
            params.append(match_filter)
        sql += " ORDER BY m.played_at DESC, te.timestamp_ms ASC LIMIT 5000"
        rows = conn.execute(sql, params).fetchall()
        if squad_only:
            rows = [r for r in rows
                    if r["actor_account"] in squad_per_match.get(r["match_id"], set())]
        # Name-Lookup
        accs = set()
        for r in rows:
            if r["actor_account"]:  accs.add(r["actor_account"])
            if r["target_account"]: accs.add(r["target_account"])
        names = {}
        if accs:
            ph = ",".join("?" * len(accs))
            for r in conn.execute(
                f"SELECT account_id, name FROM players "
                f"WHERE account_id IN ({ph})",
                list(accs)).fetchall():
                names[r["account_id"]] = r["name"]
        out = []
        for r in rows:
            out.append({
                "matchId":    r["match_id"],
                "playedAt":   r["played_at"],
                "type":       r["event_type"],   # Kill | Knock
                "tsMs":       r["timestamp_ms"],
                "actorAcc":   r["actor_account"],
                "actorName":  names.get(r["actor_account"]),
                "targetAcc":  r["target_account"],
                "targetName": names.get(r["target_account"]),
                "x":          r["victim_x"],
                "y":          r["victim_y"],
                "weapon":     r["weapon"],
            })
        return _ok({"map": map_name, "events": out})

    def _cal_corr_path(self, map_name):
        import os
        # Speichert pro Map in data/calibration/<map>.json
        base = os.path.join(os.path.dirname(self.cache.__class__.__module__)
                            if False else
                            os.path.dirname(os.path.abspath(__file__)),
                            "..", "data", "calibration")
        os.makedirs(base, exist_ok=True)
        # safe filename
        safe = "".join(c for c in map_name if c.isalnum() or c in "._-")
        return os.path.join(base, f"{safe}.json")

    def _calibration_corrections_get(self, qs):
        import os
        map_name = (qs.get("map") or "").strip()
        if not map_name:
            return _err(400, "map required")
        path = self._cal_corr_path(map_name)
        if not os.path.exists(path):
            return _ok({"map": map_name, "corrections": []})
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return _ok(data)
        except Exception as e:
            return _err(500, f"read error: {e}")

    def _calibration_corrections_post(self, body):
        """Body: {map, correction: {id, eventId, origX, origY, fixedX,
        fixedY, ...}}  — appended/updated by id."""
        try:
            payload = json.loads(body or b"{}")
            map_name = (payload.get("map") or "").strip()
            corr = payload.get("correction") or {}
            if not map_name or not corr.get("id"):
                return _err(400, "map + correction.id required")
            path = self._cal_corr_path(map_name)
            import os
            data = {"map": map_name, "corrections": []}
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            # Update-by-id (gleicher id ueberschreibt)
            lst = data.get("corrections") or []
            lst = [c for c in lst if c.get("id") != corr["id"]]
            lst.append(corr)
            data["corrections"] = lst
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return _ok({"ok": True, "count": len(lst)})
        except Exception as e:
            return _err(400, str(e))

    def _calibration_corrections_delete(self, body):
        """Body: {map, id} — entfernt eine einzelne Korrektur,
        oder {map, clearAll: true} — alles loeschen."""
        try:
            payload = json.loads(body or b"{}")
            map_name = (payload.get("map") or "").strip()
            if not map_name:
                return _err(400, "map required")
            path = self._cal_corr_path(map_name)
            import os
            if not os.path.exists(path):
                return _ok({"ok": True, "count": 0})
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            lst = data.get("corrections") or []
            if payload.get("clearAll"):
                lst = []
            else:
                cid = payload.get("id")
                if not cid:
                    return _err(400, "id or clearAll required")
                lst = [c for c in lst if c.get("id") != cid]
            data["corrections"] = lst
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return _ok({"ok": True, "count": len(lst)})
        except Exception as e:
            return _err(400, str(e))
