#!/usr/bin/env python3
"""obs-stream-kit Overlay-Service (Service 2) Entry-Point.

systemd: /usr/bin/python3 /opt/obs-stream-kit/serve_overlays.py 9001
"""
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 9001
HOST = "0.0.0.0"

from overlay_app import create_app

app = create_app()

if __name__ == "__main__":
    print(f"obs-stream-kit overlays serving on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
