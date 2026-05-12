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
import re
import sys
import datetime
import urllib.parse
import json

ROOT = os.path.dirname(os.path.abspath(__file__))

# ── PUBG-CLI-Modes (vor Server-Start abfangen) ────────────────────────────────
if len(sys.argv) > 1 and sys.argv[1] == "--init-pubg-db":
    from pubg.cli import init_db
    init_db(ROOT)
    sys.exit(0)
if len(sys.argv) > 1 and sys.argv[1] == "--pubg-cold-start":
    from pubg.cli import cold_start
    sys.exit(cold_start(ROOT))

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HOST = "0.0.0.0"

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
            elif line.startswith("Twitch-Channel:"):
                secrets["twitch_channel"] = line.split(":", 1)[1].strip()
            elif line.startswith("Steam API Key:"):
                secrets["steam_api_key"] = line.split(":", 1)[1].strip()
            elif line.startswith("Steam ID:"):
                secrets["steam_id"] = line.split(":", 1)[1].strip()

# ── PUBG-Backend-Bootstrap ─────────────────────────────────────────────────────
PUBG_ENABLED = False
pubg_registry = None
pubg_poller = None
try:
    from pubg.config import load_config, load_api_key
    from pubg.db import connect as _pubg_connect, init_schema as _pubg_init_schema
    from pubg.api_client import PubgClient
    from pubg.cache import TTLCache
    from pubg.poller import PollerThread
    from pubg.endpoints import EndpointRegistry
    from pubg.db import get_player_by_name, upsert_player
    from pubg.backup import load_ftp_config

    pubg_cfg = load_config(os.path.join(ROOT, "config", "pubg.json"))
    pubg_key = load_api_key(secrets_path)
    if pubg_key:
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        pubg_db_path = os.path.join(ROOT, "data", "pubg-history.db")
        _conn = _pubg_connect(pubg_db_path)
        _pubg_init_schema(_conn)
        _self = get_player_by_name(_conn, pubg_cfg["playerName"])
        my_account_id = _self["account_id"] if _self else None
        _conn.close()

        pubg_client = PubgClient(api_key=pubg_key, platform=pubg_cfg["platform"])

        if my_account_id is None:
            try:
                resp = pubg_client.get_player(pubg_cfg["playerName"])
                if resp.get("data"):
                    my_account_id = resp["data"][0]["id"]
                    _conn = _pubg_connect(pubg_db_path)
                    upsert_player(_conn, my_account_id, pubg_cfg["playerName"],
                                  pubg_cfg["platform"], is_self=True)
                    _conn.close()
            except Exception as e:
                print(f"  PUBG setup: failed to load account-id: {e}")

        if my_account_id:
            pubg_cache = TTLCache(ttl_secs=30)
            ftp_cfg = load_ftp_config(secrets_path)
            if ftp_cfg:
                print(f"  PUBG backup: FTP upload active → {ftp_cfg['host']}{ftp_cfg.get('path','')}")

            # Auto-Catch-Up: every server start, fetch any matches the
            # PUBG-API still exposes that aren't yet in the DB.
            # Cold-Start is idempotent (INSERT OR IGNORE + filters known
            # IDs), so a fully synced DB just costs 1 player call (~1s).
            # Empty DB gets the full backlog. Runs in a background
            # thread, server stays responsive.
            print("  PUBG: auto-catchup running in background "
                  "(fetching missing matches from API)…")
            import threading as _t
            from pubg.cli import cold_start as _cold_start
            def _run_cold_start():
                try:
                    _cold_start(ROOT)
                    print("  PUBG: auto-catchup done.")
                except Exception as e:
                    print(f"  PUBG: auto-catchup error: {e}")
            _t.Thread(target=_run_cold_start, daemon=True).start()

            pubg_poller = PollerThread(
                db_path=pubg_db_path, client=pubg_client,
                my_player_name=pubg_cfg["playerName"],
                my_account_id=my_account_id,
                interval_secs=pubg_cfg["pollIntervalSec"],
                lifetime_min_matches=pubg_cfg["minMatchesForLifetime"],
                ftp_backup_cfg=ftp_cfg,
            )
            pubg_poller.start()
            pubg_registry = EndpointRegistry(
                get_conn=lambda: _pubg_connect(pubg_db_path),
                my_account_id=my_account_id,
                platform=pubg_cfg["platform"],
                cache=pubg_cache,
                client=pubg_client,
                poller_status=pubg_poller.status,
            )
            PUBG_ENABLED = True
            print("  PUBG backend active  ✓")
        else:
            print("  PUBG backend: account-id unknown, polling not started")
    else:
        print("  PUBG backend: no PUBG-API key in .secrets — backend disabled")
except Exception as e:
    print(f"  PUBG-Backend init error: {e}")


# ── Steam-Backend-Bootstrap ────────────────────────────────────────────────────
STEAM_ENABLED = False
steam_registry = None
steam_poller = None
try:
    from steam.api_client import SteamClient
    from steam.db import connect as _steam_connect, init_schema as _steam_init_schema
    from steam.endpoints import SteamEndpointRegistry
    from steam.poller import SteamPoller

    if secrets.get("steam_api_key") and secrets.get("steam_id"):
        steam_client = SteamClient(
            api_key=secrets["steam_api_key"],
            steam_id=secrets["steam_id"])
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        steam_db_path = os.path.join(ROOT, "data", "steam-history.db")

        def _steam_db_connect():
            c = _steam_connect(steam_db_path)
            return c

        # Schema einmalig initialisieren
        _conn = _steam_db_connect()
        _steam_init_schema(_conn)
        _conn.close()

        steam_poller = SteamPoller(steam_client, _steam_db_connect,
                                     root_dir=ROOT)
        steam_poller.start()

        steam_registry = SteamEndpointRegistry(
            client=steam_client,
            db_connect_fn=_steam_db_connect,
            poller=steam_poller)
        STEAM_ENABLED = True
        print("  Steam backend active  ✓")
    else:
        print("  Steam backend: no Steam API Key / Steam ID in .secrets — backend disabled")
except Exception as e:
    print(f"  Steam-Backend init error: {e}")


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

# ── Twitch-Credentials + Channel (nur wenn .secrets vorhanden) ────────────────
creds_js = ""
parts = []
if secrets.get("client_id") and secrets.get("client_secret"):
    parts.append('window.__TWITCH_CLIENT_ID__="' + secrets["client_id"] + '";')
    parts.append('window.__TWITCH_CLIENT_SECRET__="' + secrets["client_secret"] + '";')
if secrets.get("twitch_channel"):
    parts.append('window.__TWITCH_CHANNEL__="' + secrets["twitch_channel"] + '";')
if parts:
    creds_js = '<script>' + ''.join(parts) + '</script>'

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
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST, DELETE")
        self.send_header("Access-Control-Allow-Headers", "*")
        path_lower = (self.path or "").split("?")[0].lower()
        if path_lower.endswith((".html", ".js", ".css", ".json")):
            # Kein Cache für Code-Dateien — no-store verhindert 304/Revalidierung
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        elif path_lower.endswith((".mp3", ".ogg", ".wav")):
            # no-store für kleine Audio-Dateien — kein 304, immer frischer Download
            self.send_header("Cache-Control", "no-store, no-cache, max-age=0")
            self.send_header("Pragma", "no-cache")
        elif path_lower.endswith((".mp4", ".webm")):
            # no-store: immer frischer Download, OBS soll nie gecachte Version nutzen
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
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
        if PUBG_ENABLED and self.path.startswith("/api/pubg/"):
            try:
                body, code, ctype = pubg_registry.dispatch(
                    "GET", self.path, b"", dict(self.headers))
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
        if STEAM_ENABLED and self.path.startswith("/api/steam/"):
            try:
                # WICHTIG: self.path inkl. Query an dispatch geben —
                # SteamEndpointRegistry.dispatch parst die Query selbst
                # via urlparse(). Vorher wurde split("?")[0] uebergeben,
                # was alle Query-Params verschluckt hat (Bug:
                # sort=recent&limit=20 wurde ignoriert).
                result = steam_registry.dispatch(
                    "GET", self.path, b"", dict(self.headers))
                if result is not None:
                    body, code, ctype = result
                    self.send_response(code)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            except Exception as e:
                self.send_error(500, str(e))
                return
        # Steam Image Cache: /steam/img/<app_id>/<kind>.jpg
        # → falls lokal gecached liefer direkt aus, sonst 404 (Widget
        # faellt via Fallback-Chain auf CDN zurueck).
        # On-Miss-Warming: bei 404 wird im Hintergrund vom Store-CDN
        # nachgezogen, sodass der NAECHSTE Request einen Cache-Hit hat.
        if STEAM_ENABLED and self.path.startswith("/steam/img/"):
            try:
                parts = self.path.split("?")[0].split("/")
                # parts = ['', 'steam', 'img', '<app_id>', '<kind>.jpg']
                if len(parts) >= 5 and parts[4].endswith(".jpg"):
                    app_id = parts[3]
                    kind = parts[4][:-4]
                    from steam.image_cache import cached_path
                    p = cached_path(ROOT, app_id, kind)
                    if os.path.isfile(p) and os.path.getsize(p) > 0:
                        with open(p, "rb") as f:
                            data = f.read()
                        self.send_response(200)
                        self.send_header("Content-Type", "image/jpeg")
                        self.send_header("Content-Length", str(len(data)))
                        self.send_header("Cache-Control", "public, max-age=86400")
                        self.end_headers()
                        self.wfile.write(data)
                        return
                    # Cache-Miss: 404 zuruecksenden + Hintergrund-DL anstossen.
                    # Funktioniert nur fuer header (CDN-Pfad ist
                    # vorhersagbar pro appid). Icon/Logo sind hash-
                    # basiert, da kann der Widget direkt das remote URL
                    # aus der API-Antwort nutzen.
                    if kind == "header" and app_id.isdigit():
                        cdn_url = (f"https://cdn.cloudflare.steamstatic.com"
                                   f"/steam/apps/{app_id}/header.jpg")
                        def _bg_dl():
                            try:
                                from steam.image_cache import download_image
                                download_image(cdn_url, p)
                            except Exception:
                                pass
                        import threading
                        threading.Thread(target=_bg_dl, daemon=True).start()
                self.send_error(404, "image not cached")
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
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
        if PUBG_ENABLED and self.path.startswith("/api/pubg/"):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body_in = self.rfile.read(length) if length else b""
                body, code, ctype = pubg_registry.dispatch(
                    "POST", self.path, body_in, dict(self.headers))
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
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

    def do_DELETE(self):
        if PUBG_ENABLED and self.path.startswith("/api/pubg/"):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body_in = self.rfile.read(length) if length else b""
                body, code, ctype = pubg_registry.dispatch(
                    "DELETE", self.path, body_in, dict(self.headers))
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
        self.send_error(405)

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

            # /steam/img/* 404s sind by-design Teil der Fallback-Chain
            # (Widget probiert lokalen Cache, faellt sonst auf CDN
            # zurueck). Nicht loggen — wuerde sonst das Log mit
            # erwartetem Rauschen fluten.
            if code_int == 404 and path_clean.startswith('/steam/img/'):
                return
            # Chrome-DevTools probet diese Datei beim Oeffnen jeder Seite,
            # gibt's nicht und das ist normal.
            if (code_int == 404 and path_clean ==
                    '/.well-known/appspecific/com.chrome.devtools.json'):
                return

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
            # Pfad-abhaengige Mute-Liste: gleiche Filter wie log_message.
            # send_error() ruft log_error() PARALLEL zu log_request(),
            # daher muss hier auch gefiltert werden.
            path = getattr(self, "path", "") or ""
            path_clean = path.split("?")[0]
            if path_clean.startswith("/steam/img/"):
                return
            if path_clean == "/.well-known/appspecific/com.chrome.devtools.json":
                return
            msg = format % args
            sys.stderr.write(f"{DIM}{_now()}{R}  {RED}{B}SERVER ERROR:{R} {msg}\n")
        except Exception:
            pass


# ── Threading-Server mit Address-Reuse ────────────────────────────────────────
class StreamServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def _check_assets():
    """Scannt alle HTML-Dateien und meldet fehlende lokale Assets."""
    missing = []
    seen = set()
    src_pattern = re.compile(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
    ext_pattern  = re.compile(r'\.\w{1,5}$')
    for dirpath, _, files in os.walk(ROOT):
        if any(p in dirpath for p in ('__pycache__', '.git', 'node_modules')):
            continue
        for fname in files:
            if not fname.endswith('.html'):
                continue
            html_path = os.path.join(dirpath, fname)
            try:
                with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except OSError:
                continue
            for m in src_pattern.finditer(content):
                ref = m.group(1).split('?')[0]   # Query-String abschneiden
                if ref.startswith(('http', '//', 'data:', '#', 'javascript:', 'about:')):
                    continue
                if not ext_pattern.search(ref):   # kein Datei-Extension → dynamisch, überspringen
                    continue
                # URL-absolute Pfade (ab Server-Root) relativ zu ROOT auflösen,
                # nicht relativ zum HTML-Verzeichnis (sonst wird "/widgets/..."
                # als Filesystem-Pfad ab / interpretiert).
                if ref.startswith('/'):
                    abs_ref = os.path.normpath(os.path.join(ROOT, ref.lstrip('/')))
                else:
                    abs_ref = os.path.normpath(os.path.join(os.path.dirname(html_path), ref))
                if not os.path.exists(abs_ref):
                    rel_html  = os.path.relpath(html_path, ROOT).replace('\\', '/')
                    rel_asset = os.path.relpath(abs_ref, ROOT).replace('\\', '/')
                    key = rel_asset
                    if key not in seen:
                        seen.add(key)
                        missing.append((rel_html, rel_asset))
    return missing


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

missing_assets = _check_assets()
if missing_assets:
    print()
    print(f"  \033[91m\033[1m⚠  {len(missing_assets)} fehlende Asset(s) gefunden:\033[0m")
    for html, asset in missing_assets:
        print(f"  \033[91m  {asset}\033[0m")
        print(f"  \033[2m    ← {html}\033[0m")
    print()

print()

httpd = StreamServer((HOST, PORT), Handler)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer gestoppt.")
