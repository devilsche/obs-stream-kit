#!/usr/bin/env python3
"""
Lokaler Server für obs-stream-kit.
Liest .secrets und zeigt die fertigen URLs mit Credentials.

Usage:
  python serve.py          # Port 8080
  python serve.py 9000     # eigener Port
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HOST = "127.0.0.1"
ROOT = os.path.dirname(os.path.abspath(__file__))

# .secrets lesen
secrets = {}
secrets_path = os.path.join(ROOT, ".secrets")
if os.path.exists(secrets_path):
    with open(secrets_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("Client-ID:"):
                secrets["client_id"] = line.split(":", 1)[1].strip()
            elif line.startswith("Client-Secret:"):
                secrets["client_secret"] = line.split(":", 1)[1].strip()

os.chdir(ROOT)

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Kompakteres Log
        sys.stderr.write(f"  {args[0]}\n")

print()
print("=" * 60)
print("  obs-stream-kit Server")
print("=" * 60)

if secrets.get("client_id") and secrets.get("client_secret"):
    qs = f"client_id={secrets['client_id']}&client_secret={secrets['client_secret']}"
    print()
    print("  Szenen (mit Twitch Clips):")
    print(f"  BRB:           http://{HOST}:{PORT}/scenes/brb-pause.html?{qs}")
    print(f"  Starting Soon: http://{HOST}:{PORT}/scenes/starting-soon.html?{qs}")
    print(f"  Stream Ending: http://{HOST}:{PORT}/scenes/stream-ending.html?{qs}")
else:
    print()
    print("  WARNUNG: .secrets nicht gefunden oder unvollstaendig!")
    print("  Kopiere .secrets.example nach .secrets und trage deine Twitch-Daten ein.")

print()
print("  Szenen (ohne Clips):")
print(f"  BRB:           http://{HOST}:{PORT}/scenes/brb-pause.html")
print(f"  Starting Soon: http://{HOST}:{PORT}/scenes/starting-soon.html")
print(f"  Stream Ending: http://{HOST}:{PORT}/scenes/stream-ending.html")
print(f"  Gameplay:      http://{HOST}:{PORT}/scenes/gameplay.html")
print(f"  Just Chatting: http://{HOST}:{PORT}/scenes/just-chatting.html")
print()
print("  Widgets:")
print(f"  Logo:          http://{HOST}:{PORT}/widgets/logo.html")
print(f"  Webcam-Frame:  http://{HOST}:{PORT}/widgets/webcam-frame.html")
print()
print(f"  Server laeuft auf http://{HOST}:{PORT}")
print(f"  Beenden mit Ctrl+C")
print("=" * 60)
print()

httpd = http.server.HTTPServer((HOST, PORT), Handler)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer gestoppt.")
