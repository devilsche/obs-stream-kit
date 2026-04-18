#!/usr/bin/env python3
"""
Lokaler Server für obs-stream-kit.
Liest .secrets und injiziert Twitch-Credentials automatisch in HTML-Seiten.
Keine URL-Parameter nötig.

Usage:
  python serve.py          # Port 8080
  python serve.py 9000     # eigener Port

Robust gegen:
  - Broken Pipes wenn Browser Video/Audio-Streams abbricht
  - Parallele Requests (ThreadingHTTPServer statt single-threaded)
  - "Address already in use" nach Restart (allow_reuse_address)
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HOST = "0.0.0.0"
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

# Script-Tag der in HTML-Seiten injiziert wird
inject_script = ""
if secrets.get("client_id") and secrets.get("client_secret"):
    inject_script = (
        '<script>'
        'window.__TWITCH_CLIENT_ID__="' + secrets["client_id"] + '";'
        'window.__TWITCH_CLIENT_SECRET__="' + secrets["client_secret"] + '";'
        '</script>'
    )

os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    # ── Robustheit ──────────────────────────────────────────────────
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError,
                TimeoutError):
            # Browser hat Verbindung mitten im Download abgebrochen.
            # Typisch bei Video-Streams / Reloads. Leise ignorieren.
            pass
        except OSError:
            pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError,
                OSError):
            pass

    def send_error(self, code, message=None, explain=None):
        try:
            super().send_error(code, message, explain)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError,
                OSError):
            pass

    # ── HTML-Injection für Credentials ──────────────────────────────
    def do_GET(self):
        try:
            # Nur HTML-Dateien modifizieren
            path = self.translate_path(self.path.split("?")[0])
            if path.endswith(".html") and inject_script and os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                # Script direkt nach <head> injizieren
                content = content.replace("<head>", "<head>" + inject_script, 1)
                data = content.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                super().do_GET()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError,
                OSError):
            pass

    def log_message(self, format, *args):
        try:
            sys.stderr.write(f"  {args[0]}\n")
        except Exception:
            pass


# ── Threading-Server mit Address-Reuse ──────────────────────────────
class StreamServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


print()
print("=" * 60)
print("  obs-stream-kit Server")
print("=" * 60)

if inject_script:
    print()
    print("  .secrets geladen - Credentials werden automatisch injiziert!")
    print()
    print("  Szenen:")
    print(f"  BRB:           http://localhost:{PORT}/scenes/brb-pause.html")
    print(f"  Starting Soon: http://localhost:{PORT}/scenes/starting-soon.html")
    print(f"  Stream Ending: http://localhost:{PORT}/scenes/stream-ending.html")
else:
    print()
    print("  WARNUNG: .secrets nicht gefunden oder unvollstaendig!")
    print("  Kopiere .secrets.example nach .secrets und trage deine Twitch-Daten ein.")

print(f"  Gameplay:      http://localhost:{PORT}/scenes/gameplay.html")
print(f"  Just Chatting: http://localhost:{PORT}/scenes/just-chatting.html")
print()
print("  Widgets:")
print(f"  Logo:          http://localhost:{PORT}/widgets/logo.html")
print(f"  Webcam-Frame:  http://localhost:{PORT}/widgets/webcam-frame.html")
print()
print("  Stinger-Preview:")
print(f"  http://localhost:{PORT}/docs/preview-stingers.html")
print()
print(f"  Server: http://localhost:{PORT}")
print(f"  Beenden mit Ctrl+C")
print("=" * 60)
print()

httpd = StreamServer((HOST, PORT), Handler)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer gestoppt.")
