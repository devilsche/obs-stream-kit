"""PostgreSQL-Connection-Helper fuer obs-stream-kit.

DSN-Quellen (in dieser Reihenfolge):
  1. Env-Variable OBS_KIT_PG_DSN
  2. .secrets-Datei, Zeile 'OBS Kit PG DSN: <dsn>'
"""
import os
from typing import Optional

try:
    import psycopg2
    import psycopg2.extras
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


def load_dsn(secrets_path: str = ".secrets") -> Optional[str]:
    env = os.environ.get("OBS_KIT_PG_DSN")
    if env:
        return env
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if ":" not in line:
                continue
            key, _, val = line.partition(":")
            if key.strip().lower().replace("-", " ") == "obs kit pg dsn":
                return val.strip()
    return None


def connect(dsn: Optional[str] = None):
    if not HAS_PSYCOPG2:
        raise ImportError("psycopg2 nicht installiert: pip install psycopg2-binary")
    if dsn is None:
        dsn = load_dsn()
    if not dsn:
        raise RuntimeError("OBS Kit PG DSN nicht gefunden (Env oder .secrets)")
    conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn
