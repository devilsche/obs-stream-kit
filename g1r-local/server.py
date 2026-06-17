#!/usr/bin/env python3
"""G1R Local Proxy — schlanker Mini-Server für den Prototyp.

Liest die vom UE4SS-Mod (G1RExport) geschriebene g1r-state.json und serviert
sie unter http://localhost:<PORT>/state. CORS + Private-Network-Access-Header
sind gesetzt, damit das OBS-Overlay (von stream-overlay.com, HTTPS) per fetch
auf http://localhost zugreifen darf.

Start:  python3 server.py
Stop:   Strg+C

Läuft komplett lokal — es verlässt nichts den PC.
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Konfiguration ──────────────────────────────────────────────────────────
PORT = 9210
# MUSS mit OUTPUT_PATH im Lua-Mod (G1RExport/scripts/main.lua) übereinstimmen.
STATE_FILE = os.environ.get("G1R_STATE_FILE", r"C:\obs-g1r\g1r-state.json")
# Älter als das → als "offline" behandeln (Spiel zu / Mod pausiert).
STALE_AFTER_S = 10
# Welche Origin darf zugreifen? "*" ist am einfachsten (rein lokal, kein Risiko).
ALLOW_ORIGIN = "*"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/state":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        payload = {"ok": False, "reason": "no-data"}
        try:
            age = time.time() - os.path.getmtime(STATE_FILE)
            if age <= STALE_AFTER_S:
                with open(STATE_FILE, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                data["ageSec"] = round(age, 1)
                payload = data
            else:
                payload = {"ok": False, "reason": "stale", "ageSec": round(age, 1)}
        except FileNotFoundError:
            payload = {"ok": False, "reason": "no-file"}
        except Exception as exc:  # JSON halb geschrieben o.ä. → kurz später ok
            payload = {"ok": False, "reason": f"read-error: {exc}"}

        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # leise


if __name__ == "__main__":
    print(f"[g1r-local] liest {STATE_FILE}")
    print(f"[g1r-local] serviert http://localhost:{PORT}/state  (Strg+C zum Beenden)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
