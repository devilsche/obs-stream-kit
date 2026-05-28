"""SQLite-Style-Compat-Wrapper fuer psycopg2-Connections.

WARUM:
- Der bestehende `pubg/endpoints.py` und `pubg/aggregations.py` Code wurde
  fuer sqlite3 geschrieben, das eine API hat wie:
      row = conn.execute(sql, params).fetchone()
      rows = conn.execute(sql, params).fetchall()
  psycopg2 will dagegen `with conn.cursor() as cur: cur.execute(...)` plus
  ein separater `fetch*()` Call auf dem Cursor.
- Beim grossen Multi-Tenant-Refactor (Task 11b) haben wir entschieden,
  Connection-Style NICHT in jeder einzelnen Query umzuschreiben, sondern
  hier ein duenner Adapter. Damit kann der Aufwand auf die wirklich
  semantische Aenderung (tenant_id in jeder WHERE-Clause) konzentriert
  werden.

WAS DAS WRAPPER MACHT:
- `conn.execute(sql, params)` -> oeffnet einen psycopg2-Cursor, ersetzt
  `?` -> `%s` (sqlite-Style auf psycopg-Style), fuehrt aus, liefert ein
  Result-Objekt das `.fetchone()`, `.fetchall()` und `rowcount` kann.
- `conn.commit()` / `conn.rollback()` / `conn.close()` weiterhin direkt
  ueber den unterlagenen psycopg2-Connection.
- `RealDictCursor` (in core.db gesetzt) liefert dict-aehnliche Rows,
  damit `row["match_id"]` weiterhin tut.

EINSCHRAENKUNG:
- Nicht thread-safe ueber dieselbe Wrapper-Instanz; aber psycopg2-Connections
  sind sowieso nicht thread-safe.
- `?` in String-Literalen wird mit-rewritten — Workaround: doppel-escapen.
  In unserem Codebase kommt das nicht vor.
- `PRAGMA`/SQLite-only-Syntax laeuft hier NICHT durch — solche Calls werden
  als TODO markiert.
"""
from typing import Iterable, Optional, Sequence


def _to_pg_sql(sql: str) -> str:
    """Ersetzt sqlite-Style `?` mit psycopg-Style `%s`.
    Achtung: literale `%` (z.B. `LIKE 'ai.%'`) werden zu `%%` escaped,
    sonst interpretiert psycopg2 sie als param-Marker."""
    return sql.replace("%", "%%").replace("?", "%s")


class _Result:
    """Cursor-Wrapper der nach execute() noch fetch* + rowcount erlaubt.
    Cursor wird beim Verlassen geschlossen (via close() oder GC)."""

    __slots__ = ("_cur",)

    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        try:
            return self._cur.fetchone()
        finally:
            self._cur.close()

    def fetchall(self):
        try:
            return self._cur.fetchall()
        finally:
            self._cur.close()

    @property
    def rowcount(self):
        return self._cur.rowcount

    def __iter__(self):
        # Selten gebraucht, aber `for r in conn.execute(...)` faellt nicht
        # auf die Schnauze.
        try:
            for row in self._cur:
                yield row
        finally:
            self._cur.close()


class SqliteCompatConn:
    """Wrapped psycopg2-Connection, die sqlite-Style `conn.execute(...)`
    + `.commit()` / `.close()` / `.rollback()` anbietet."""

    def __init__(self, pg_conn):
        self._conn = pg_conn

    def execute(self, sql: str, params: Optional[Sequence] = None) -> _Result:
        cur = self._conn.cursor()
        cur.execute(_to_pg_sql(sql), params or ())
        return _Result(cur)

    def executemany(self, sql: str, seq_of_params: Iterable[Sequence]):
        cur = self._conn.cursor()
        try:
            cur.executemany(_to_pg_sql(sql), list(seq_of_params))
        finally:
            cur.close()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def cursor(self):
        return self._conn.cursor()

    @property
    def raw(self):
        """Direktzugriff aufs unterliegende psycopg2-Connection."""
        return self._conn


def wrap(pg_conn) -> SqliteCompatConn:
    """Wickelt eine bestehende psycopg2-Connection in den Compat-Wrapper."""
    return SqliteCompatConn(pg_conn)
