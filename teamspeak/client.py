"""TS3 ClientQuery — persistente Telnet-Connection mit Notify-Subscriptions.

Protokoll: zeilenbasiert. Server sendet 'TS3 Client' Banner + 'selected
schandlcid=...'. Wir senden 'auth apikey=<key>', dann
'clientnotifyregister schandlerid=N event=notifytalkstatuschange' usw.

Notify-Events laufen asynchron rein, Replies auf Commands haben am Ende
'error id=0 msg=ok'. Wir parsen beides aus demselben Stream und routen
ueber prefix.

Encoding: ClientQuery escaped strings nach TS3-Regeln (space=\\s,
| =\\p, /=\\/, =\\\\, \\n=\\n, ...). Wir de-/escapen nur die noetigsten.

Run in Background-Thread: connect-Loop mit Exponential-Backoff, halten
den State in `state.py`-Strukturen.
"""

import socket
import threading
import time
import logging

LOG = logging.getLogger("teamspeak.client")

ESCAPES = {
    "\\\\": "\\",  "\\/": "/",  "\\s": " ", "\\p": "|",
    "\\a": "\x07", "\\b": "\b", "\\f": "\f", "\\n": "\n",
    "\\r": "\r",   "\\t": "\t", "\\v": "\x0b",
}


def ts_unescape(s):
    """TS3-string-escape → plain Python string."""
    if "\\" not in s:
        return s
    out = []
    i = 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            tok = s[i:i + 2]
            out.append(ESCAPES.get(tok, tok))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def parse_params(line):
    """ClientQuery-Zeile in dict aufdroeseln. Format: 'cmd k=v k=v ...'
    Werte koennen TS3-escaped sein."""
    parts = line.split(" ")
    out = {}
    for p in parts:
        if "=" not in p:
            continue
        k, _, v = p.partition("=")
        out[k] = ts_unescape(v)
    return out


def parse_list(line):
    """Manche Replies sind Listen, getrennt durch '|'. Returns list of dicts."""
    chunks = line.split("|")
    return [parse_params(c) for c in chunks]


class ClientQueryError(Exception):
    pass


class ClientQuery:
    """Persistente Verbindung zur TS3 ClientQuery.
    Verbraucht einen Background-Thread fuer den Read-Loop.

    on_notify(event_name: str, params: dict) wird fuer jeden Notify-Event
    aufgerufen. on_status(connected: bool, msg: str) fuer Connect-Status.
    """

    def __init__(self, host, port, apikey, on_notify=None, on_status=None,
                 reconnect_secs=5.0):
        self.host = host
        self.port = port
        self.apikey = apikey
        self.on_notify = on_notify or (lambda *a: None)
        self.on_status = on_status or (lambda *a: None)
        self.reconnect_secs = reconnect_secs
        self._sock = None
        self._buf = b""
        self._reply_lines = []
        self._reply_event = threading.Event()
        self._cmd_lock = threading.Lock()
        self._running = False
        self._thread = None
        self._connected = False

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop, name="ts3-client", daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        try:
            if self._sock:
                self._sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            if self._sock:
                self._sock.close()
        except Exception:
            pass

    def is_connected(self):
        return self._connected

    # ── Read-Loop ──────────────────────────────────────────────────────
    def _run_loop(self):
        backoff = self.reconnect_secs
        while self._running:
            try:
                self._connect()
                self._auth_and_subscribe()
                self._connected = True
                self.on_status(True, "connected")
                backoff = self.reconnect_secs
                self._read_forever()
            except Exception as e:
                LOG.warning("TS3 connection lost: %s", e)
                self._connected = False
                self.on_status(False, str(e))
            try:
                if self._sock:
                    self._sock.close()
            except Exception:
                pass
            self._sock = None
            if not self._running:
                break
            time.sleep(min(60, backoff))
            backoff = min(60, backoff * 1.5)

    def _connect(self):
        s = socket.create_connection((self.host, self.port), timeout=5)
        s.settimeout(None)
        self._sock = s
        self._buf = b""
        # Banner — TS3 ClientQuery schickt typischerweise 3 Zeilen
        # (TS3 Client / Welcome … / selected schandlerid=N). Wir lesen so
        # viel wie verfuegbar, brechen ab wenn 500ms nichts mehr kommt.
        for _ in range(6):
            try:
                ln = self._readline(timeout=0.5)
                if ln is None:
                    break
                LOG.debug("banner: %s", ln)
            except socket.timeout:
                break

    def _auth_and_subscribe(self):
        # ClientQuery >=1.1 (TS3 Client 3.5+) verlangt 'auth apikey=…'
        # bevor andere Commands akzeptiert werden. Wenn auth fehlschlaegt,
        # MUESSEN wir abbrechen — sonst silently hangen alle folgenden
        # Commands ins Timeout.
        if not self.apikey:
            raise ClientQueryError(
                "no API key configured (TS3-ClientQuery-Key in .secrets)")
        key_len = len(self.apikey)
        LOG.info("auth: apikey-Laenge=%d, ersten 4 Zeichen=%s****",
                 key_len, self.apikey[:4] if key_len > 4 else "?")
        try:
            self.send_command(f"auth apikey={self.apikey}", timeout=3.0)
            LOG.info("auth ok")
        except ClientQueryError as e:
            msg = str(e)
            # error id=256 = command not found → aeltere Plugin-Version
            # ohne API-Key-Auth. Da ist alles offen, weiter.
            if "256" in msg or "command not found" in msg.lower():
                LOG.info("auth not required (alt plugin) — fortsetzen")
                return
            # Versuch: gehts auch ohne auth? Manche Setups haben
            # 'apikey nicht erforderlich' und auth wirft trotzdem.
            try:
                self.send_command("whoami", timeout=2.0)
                LOG.info("auth required, aber whoami klappt ohne — fortsetzen")
                return
            except ClientQueryError:
                pass
            raise ClientQueryError(
                f"auth failed [{msg}] mit Key-Laenge {key_len}. "
                f"In TS3-Client: Extras→Optionen→Erweiterungen→Plug-ins→"
                f"'Client Query'→Einstellungen→API-Key copy. "
                f"Dann in .secrets als 'TS3-ClientQuery-Key: <KEY>' (genau "
                f"so, KEINE Anfuehrungszeichen, KEIN Leerzeichen davor).")
        # Notify-Subscriptions
        for ev in ("notifytalkstatuschange",
                    "notifyclientmoved",
                    "notifycliententerview",
                    "notifyclientleftview"):
            try:
                self.send_command(
                    f"clientnotifyregister schandlerid=0 event={ev}",
                    timeout=2.0)
            except ClientQueryError as e:
                LOG.warning("subscribe %s failed: %s", ev, e)

    def _read_forever(self):
        while self._running:
            line = self._readline()
            if line is None:
                raise ClientQueryError("connection closed")
            self._handle_line(line)

    def _readline(self, timeout=None):
        if timeout is not None:
            self._sock.settimeout(timeout)
        try:
            while b"\n" not in self._buf:
                chunk = self._sock.recv(4096)
                if not chunk:
                    return None
                self._buf += chunk
            line, _, rest = self._buf.partition(b"\n")
            self._buf = rest
            return line.decode("utf-8", "replace").rstrip("\r")
        finally:
            if timeout is not None:
                self._sock.settimeout(None)

    def _handle_line(self, line):
        if not line:
            return
        if line.startswith("notify"):
            head, _, rest = line.partition(" ")
            self.on_notify(head, parse_params(rest))
            return
        if line.startswith("error "):
            params = parse_params(line[6:])
            self._reply_lines.append(("error", params))
            self._reply_event.set()
            return
        # Sonst: Body einer Reply
        self._reply_lines.append(("body", line))

    # ── Send-Command (synchron, blocking) ─────────────────────────────
    def send_command(self, cmd, timeout=3.0):
        """Sendet 'cmd\\n', wartet auf 'error id=0 msg=ok'-Zeile.
        Returns Body-Lines als Liste. Wirft ClientQueryError bei error_id != 0
        oder Timeout."""
        if not self._sock:
            raise ClientQueryError("not connected")
        with self._cmd_lock:
            self._reply_lines = []
            self._reply_event.clear()
            try:
                self._sock.sendall((cmd + "\n").encode("utf-8"))
            except OSError as e:
                raise ClientQueryError(f"send failed: {e}")
            if not self._reply_event.wait(timeout):
                raise ClientQueryError(f"timeout waiting for reply to: {cmd}")
            err = None
            body = []
            for kind, payload in self._reply_lines:
                if kind == "body":
                    body.append(payload)
                else:
                    err = payload
            if err and err.get("id") != "0":
                raise ClientQueryError(
                    f"err {err.get('id')}: {err.get('msg', '?')}")
            return body
