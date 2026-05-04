import datetime
import json
from urllib.parse import urlparse, parse_qs
from pubg.db import set_setting, get_setting
from pubg.aggregations import (compute_session_stats, compute_last_match,
                                compute_top_mates, compute_co_player,
                                compute_mates_today, compute_map_distribution,
                                compute_first_fight_rate, compute_squad_compare,
                                compute_chickens_together)


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
            return self._session()
        if route == ("GET", "/api/pubg/last-match"):
            return self._last_match()
        if route == ("GET", "/api/pubg/status"):
            return _ok(self.poller_status())
        if route == ("POST", "/api/pubg/session/reset"):
            return self._session_reset()
        if route == ("GET", "/api/pubg/top-mates"):
            return self._top_mates(qs)
        if u.path.startswith("/api/pubg/co-player/"):
            name = u.path[len("/api/pubg/co-player/"):]
            return self._co_player(name)
        if route == ("GET", "/api/pubg/career-lifetime"):
            return self._career_lifetime(qs)
        if route == ("GET", "/api/pubg/mates-today"):
            return self._mates_today(qs)
        if route == ("GET", "/api/pubg/map-distribution"):
            return self._map_dist(qs)
        if route == ("GET", "/api/pubg/first-fight-rate"):
            return self._first_fight(qs)
        if route == ("GET", "/api/pubg/squad-compare"):
            return self._squad_compare(qs)
        if route == ("GET", "/api/pubg/chickens-together"):
            return self._chickens_together(qs)
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

    def _session(self):
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            "session",
            lambda: compute_session_stats(conn, self.my_account_id),
        ))

    def _last_match(self):
        conn = self.get_conn()
        result = self.cache.get_or_compute(
            "last-match",
            lambda: compute_last_match(conn, self.my_account_id),
        )
        return _ok(result or {})

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

        # Cache: nur die Roh-Aggregation (alle Mates, alle Stats), ohne Sort/Filter.
        # Damit liefern alle min_matches/sortBy-Varianten konsistente Zahlen
        # innerhalb desselben TTL-Fensters.
        all_mates = self.cache.get_or_compute(
            "top-mates:raw",
            lambda: compute_top_mates(conn, self.my_account_id,
                                       sort_by="mostPlayed",
                                       limit=10000, min_matches=1))
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

    def _mates_today(self, qs):
        conn = self.get_conn()
        range_key = qs.get("range", "session")
        # Gleicher Default wie top-mates: globaler Slider via flyout-full
        default_min = int(get_setting(conn, "minMatchesForTopMates", "10"))
        min_total = int(qs.get("minMatches", default_min))
        return _ok(self.cache.get_or_compute(
            f"mates-today:{range_key}:{min_total}",
            lambda: compute_mates_today(conn, self.my_account_id,
                                         range_key, min_total)))

    def _map_dist(self, qs):
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"map:{range_key}",
            lambda: compute_map_distribution(conn, self.my_account_id, range_key)))

    def _first_fight(self, qs):
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"ff:{range_key}",
            lambda: compute_first_fight_rate(conn, self.my_account_id, range_key)))

    def _chickens_together(self, qs):
        min_wins = int(qs.get("minWins", 1))
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"chickens-together:{min_wins}",
            lambda: compute_chickens_together(conn, self.my_account_id, min_wins)))

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
