import json
import sqlite3
from urllib.parse import urlparse, parse_qs
from core.db_compat import SqliteCompatConn
from g1r.db import assign_run, insert_sample, insert_events, seq_seen, mark_seq
from g1r.aggregations import list_runs, career, live


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


def _compat(conn):
    """Gibt conn compat-gewrappt zurück — aber nur wenn es kein sqlite3-Conn ist
    (sqlite3 nutzt '?'-Platzhalter nativ; SqliteCompatConn konvertiert zu '%s',
    was sqlite3 bricht). Auf Postgres-Conns wird SqliteCompatConn aufgesetzt."""
    if isinstance(conn, (sqlite3.Connection, SqliteCompatConn)):
        return conn
    return SqliteCompatConn(conn)


class G1rEndpointRegistry:
    def __init__(self, get_conn, tenant_id: int):
        _raw = get_conn
        self.get_conn = lambda: _compat(_raw())
        self.tenant_id = tenant_id

    def dispatch(self, method, path, body, headers):
        parsed = urlparse(path)
        route = parsed.path
        if method == "POST" and route == "/api/g1r/ingest":
            return self._ingest(body)
        if method == "POST" and route == "/api/g1r/run/new":
            return self._run_new(body)
        if method == "GET" and route == "/api/g1r/runs":
            return self._runs()
        if method == "GET" and route == "/api/g1r/career":
            return self._career(parse_qs(parsed.query))
        if method == "GET" and route == "/api/g1r/live":
            return self._live()
        return _err(404, "unknown g1r route")

    def _ingest(self, body):
        try:
            d = json.loads(body or b"{}")
        except ValueError:
            return _err(400, "invalid json")
        seq = d.get("client_seq")
        conn = self.get_conn()
        try:
            if seq is not None and seq_seen(conn, self.tenant_id, seq):
                return _ok({"ok": True, "dedup": True})
            snap = d.get("snapshot") or {}
            rid = assign_run(conn, self.tenant_id, d.get("save_key"), snap)
            insert_sample(conn, self.tenant_id, rid, snap)
            insert_events(conn, self.tenant_id, rid, d.get("events") or [])
            if seq is not None:
                mark_seq(conn, self.tenant_id, seq)
            return _ok({"ok": True, "run_id": rid})
        finally:
            conn.close()

    def _run_new(self, body):
        try:
            d = json.loads(body or b"{}")
        except ValueError:
            d = {}
        conn = self.get_conn()
        try:
            rid = assign_run(conn, self.tenant_id, None, {}, force_new=True, label=d.get("label"))
            return _ok({"ok": True, "run_id": rid})
        finally:
            conn.close()

    def _runs(self):
        conn = self.get_conn()
        try:
            return _ok({"ok": True, "runs": list_runs(conn, self.tenant_id)})
        finally:
            conn.close()

    def _career(self, qs):
        # ?run=<id> → Scope dieser Run; fehlt/leer/ungültig → all-time.
        run_id = None
        raw = (qs.get("run") or [None])[0]
        if raw not in (None, "", "all"):
            try:
                run_id = int(raw)
            except (TypeError, ValueError):
                return _err(400, "run must be an integer")
        conn = self.get_conn()
        try:
            return _ok({"ok": True, **career(conn, self.tenant_id, run_id=run_id)})
        finally:
            conn.close()

    def _live(self):
        conn = self.get_conn()
        try:
            return _ok({"ok": True, **live(conn, self.tenant_id)})
        finally:
            conn.close()
