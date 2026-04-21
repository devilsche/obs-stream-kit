#!/usr/bin/env python3
"""
Lokaler Server für obs-stream-kit.
Liest .secrets und injiziert Twitch-Credentials automatisch in HTML-Seiten.
Keine URL-Parameter nötig.

Usage:
  python serve.py          # Port 8080
  python serve.py 9000     # eigener Port
"""
import http.server
import os
import sys
import datetime
import urllib.parse
import json

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HOST = "0.0.0.0"
ROOT = os.path.dirname(os.path.abspath(__file__))

# ── ANSI-Farben ────────────────────────────────────────────────────────────────
R     = '\033[0m'
B     = '\033[1m'
DIM   = '\033[2m'
RED   = '\033[91m'
REDBG = '\033[41m\033[97m'
ORG   = '\033[33m'
YEL   = '\033[93m'
GRN   = '\033[92m'
CYAN  = '\033[96m'
BLUE  = '\033[94m'
MAG   = '\033[95m'
WHT   = '\033[97m'

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

# ── Frontend-Error-Logger (immer injiziert) ────────────────────────────────────
DEV_LOG_JS = """<script>
(function(){
  function _send(level,msg){
    try{fetch('/dev-log',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({level:level,msg:msg,url:location.pathname,ts:Date.now()})
    }).catch(function(){});}catch(e){}
  }
  window.addEventListener('error',function(e){
    _send('error',(e.message||'?')+' @ '+(e.filename||'?')+':'+(e.lineno||'?'));
  });
  window.addEventListener('unhandledrejection',function(e){
    _send('promise',String(e.reason));
  });
  var _ce=console.error.bind(console);
  console.error=function(){_ce.apply(console,arguments);_send('console.error',Array.prototype.join.call(arguments,' '));};
  var _cw=console.warn.bind(console);
  console.warn=function(){_cw.apply(console,arguments);_send('console.warn',Array.prototype.join.call(arguments,' '));};
})();
</script>"""

# ── Twitch-Credentials (nur wenn .secrets vorhanden) ──────────────────────────
creds_js = ""
if secrets.get("client_id") and secrets.get("client_secret"):
    creds_js = (
        '<script>'
        'window.__TWITCH_CLIENT_ID__="' + secrets["client_id"] + '";'
        'window.__TWITCH_CLIENT_SECRET__="' + secrets["client_secret"] + '";'
        '</script>'
    )

inject_head = DEV_LOG_JS + creds_js

os.chdir(ROOT)

LOCAL_HOSTS = {'localhost', '127.0.0.1', '0.0.0.0', ''}


def _now():
    return datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]


def _fmt_size(size_str):
    if not str(size_str).isdigit():
        return '-'
    n = int(size_str)
    if n >= 1024 * 1024:
        return f"{n/1024/1024:.1f}MB"
    if n >= 1024:
        return f"{n/1024:.1f}kB"
    return f"{n}B"


def _type_tag(path_clean):
    ext = path_clean.rsplit('.', 1)[-1].lower() if '.' in path_clean else ''
    return {
        'html': f"{CYAN}{B}HTML{R}",
        'js':   f"{YEL}{B}JS  {R}",
        'css':  f"{BLUE}{B}CSS {R}",
        'mp3':  f"{MAG}{B}MP3 {R}",
        'ogg':  f"{MAG}{B}OGG {R}",
        'wav':  f"{MAG}{B}WAV {R}",
        'mp4':  f"{MAG}{B}MP4 {R}",
        'webm': f"{MAG}{B}WEBM{R}",
        'woff': f"{DIM}FONT{R}",
        'woff2':f"{DIM}FONT{R}",
        'ttf':  f"{DIM}FONT{R}",
        'png':  f"{DIM}IMG {R}",
        'jpg':  f"{DIM}IMG {R}",
        'jpeg': f"{DIM}IMG {R}",
        'svg':  f"{DIM}SVG {R}",
        'webp': f"{DIM}IMG {R}",
        'json': f"{CYAN}JSON{R}",
    }.get(ext, f"{DIM}    {R}")


class Handler(http.server.SimpleHTTPRequestHandler):

    # ── CORS-Header ────────────────────────────────────────────────────
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST")
        self.send_header("Access-Control-Allow-Headers", "*")
        path_lower = (self.path or "").split("?")[0].lower()
        if path_lower.endswith((".html", ".js", ".css", ".json")):
            self.send_header("Cache-Control", "no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ── Robustheit ─────────────────────────────────────────────────────
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError,
                TimeoutError, OSError):
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

    # ── HTML-Injection ─────────────────────────────────────────────────
    def do_GET(self):
        try:
            path = self.translate_path(self.path.split("?")[0])
            if path.endswith(".html") and os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                content = content.replace("<head>", "<head>" + inject_head, 1)
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

    # ── Frontend-Error-Endpunkt ────────────────────────────────────────
    def do_POST(self):
        if self.path != '/dev-log':
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = self.rfile.read(length).decode('utf-8', errors='replace')
            data   = json.loads(body)
            level  = data.get('level', '?')
            msg    = data.get('msg', '')
            url    = data.get('url', '')

            if level in ('error', 'promise'):
                col = f"{REDBG}{B}"
                icon = '✖'
            elif level == 'console.error':
                col = f"{RED}{B}"
                icon = '✖'
            else:
                col = f"{YEL}{B}"
                icon = '⚠'

            sys.stderr.write(
                f"{DIM}{_now()}{R}  "
                f"{col} {icon} FRONTEND [{level}] {R}\n"
                f"           {col}{msg}{R}\n"
                f"           {DIM}{url}{R}\n"
            )
            self.send_response(204)
            self.end_headers()
        except Exception as e:
            self.send_response(400)
            self.end_headers()

    # ── Request-Logging ────────────────────────────────────────────────
    def log_message(self, format, *args):
        try:
            if len(args) < 3:
                sys.stderr.write(f"{DIM}{_now()}{R}  " + (format % args) + "\n")
                return

            req        = str(args[0]).strip('"')
            code       = str(args[1])
            size       = str(args[2])
            parts      = req.split(' ', 2)
            method     = parts[0] if parts else '?'
            path       = parts[1] if len(parts) > 1 else '?'
            path_clean = path.split('?')[0]

            # /dev-log Posts nicht doppelt loggen
            if path_clean == '/dev-log':
                return

            code_int = int(code) if code.isdigit() else 0

            if code_int >= 500:
                code_col = f"{REDBG}{B} {code} {R}"
            elif code_int == 404:
                code_col = f"{RED}{B} 404 {R}"
            elif code_int >= 400:
                code_col = f"{RED}{B} {code} {R}"
            elif code_int >= 300:
                code_col = f"{YEL}{B} {code} {R}"
            elif code_int in (200, 204, 206):
                code_col = f"{GRN} {code} {R}"
            else:
                code_col = f"{WHT} {code} {R}"

            # Cross-Origin prüfen
            origin  = (self.headers.get('Origin', '')  if self.headers else '')
            referer = (self.headers.get('Referer', '') if self.headers else '')
            cross_warn = ''
            if origin:
                oh = urllib.parse.urlparse(origin).hostname or ''
                if oh not in LOCAL_HOSTS:
                    cross_warn = (
                        f"\n  {REDBG}{B}⚠  CROSS-ORIGIN REQUEST  {R}"
                        f"\n  {RED}{B}   Origin: {origin}{R}"
                    )
            elif referer:
                rh = urllib.parse.urlparse(referer).hostname or ''
                if rh not in LOCAL_HOSTS:
                    cross_warn = (
                        f"\n  {YEL}{B}⚠  Externer Referer: {referer}{R}"
                    )

            not_found = f"\n  {RED}   → {path_clean}{R}" if code_int == 404 else ''

            raw_ip    = self.client_address[0] if self.client_address else '?'
            client_ip = 'localhost' if raw_ip in ('127.0.0.1', '::1') else raw_ip

            sys.stderr.write(
                f"{DIM}{_now()}{R}  "
                f"{code_col}  "
                f"{_type_tag(path_clean)}  "
                f"{B}{method:<7}{R}"
                f"{path_clean}"
                f"  {DIM}{_fmt_size(size)}{R}"
                f"  {DIM}{client_ip}{R}"
                f"{not_found}"
                f"{cross_warn}"
                "\n"
            )
        except Exception:
            pass

    def log_error(self, format, *args):
        try:
            msg = format % args
            sys.stderr.write(f"{DIM}{_now()}{R}  {RED}{B}SERVER ERROR:{R} {msg}\n")
        except Exception:
            pass


# ── Threading-Server mit Address-Reuse ────────────────────────────────────────
class StreamServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


print()
print("=" * 60)
print("  obs-stream-kit Server")
print("=" * 60)

if creds_js:
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
