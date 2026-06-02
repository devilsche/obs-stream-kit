#!/usr/bin/env python3
"""obs-stream-kit API-Service Entry-Point (intern).

Bindet im Betrieb NUR 127.0.0.1 — von aussen ausschliesslich via nginx-Pfad
erreichbar. Haelt die Daten-/Auth-Schicht + die Hintergrund-Poller (PUBG/Steam).

systemd: /usr/bin/python3 /opt/obs-stream-kit/serve_api.py 9002
"""
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 9002
HOST = "127.0.0.1"

from api_app import create_app
from app.poller_startup import start_pollers

ROOT = os.path.dirname(os.path.abspath(__file__))
app = create_app()
start_pollers(ROOT)

if __name__ == "__main__":
    print(f"obs-stream-kit API serving on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
