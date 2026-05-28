"""CLI: laedt core/schema.sql in die PG-DB. Idempotent (CREATE TABLE IF NOT EXISTS).

Verwendung:
    python -m core.init_schema
"""
import os
import sys

from core import db


def main() -> int:
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, "r", encoding="utf-8") as f:
        sql = f.read()
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    finally:
        conn.close()
    print("Schema geladen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
