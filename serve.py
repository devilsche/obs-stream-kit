#!/usr/bin/env python3
"""obs-stream-kit Entry-Point.

Startet die Flask-App. Wird ueber systemd als
`/usr/bin/python3 /opt/obs-stream-kit/serve.py 9000` aufgerufen.
"""
import os
import sys

# PUBG-CLI-Modi (vor App-Init, damit serve nicht startet)
if len(sys.argv) > 1 and sys.argv[1] == "--init-pubg-db":
    from pubg.cli import init_db
    ROOT = os.path.dirname(os.path.abspath(__file__))
    init_db(ROOT)
    sys.exit(0)
if len(sys.argv) > 1 and sys.argv[1] == "--pubg-cold-start":
    from pubg.cli import cold_start
    ROOT = os.path.dirname(os.path.abspath(__file__))
    sys.exit(cold_start(ROOT))

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 9000
HOST = "0.0.0.0"

from app import create_app

app = create_app()

if __name__ == "__main__":
    print(f"obs-stream-kit serving on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
