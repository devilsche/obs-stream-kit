"""TS3 ClientQuery — Wrapper um die `ts3` Library (PyPI: ts3,
benediktschmitt/py-ts3).

Installation am Streaming-PC: `pip install ts3`

Unsere Schnittstelle ist gleich geblieben (start/stop, on_notify,
on_status, send_command), damit teamspeak/service.py unveraendert
funktioniert. Intern macht jetzt aber die Library den ganzen
Banner/Auth/Escape/Notify-Parsing-Krempel — die hatte bei mir
Timeout-Probleme im Handshake.

Notify-Events werden ueber `wait_for_event` aus dem Background-Thread
gepollt. Library wirft TS3TimeoutError wenn nichts ankam — wir nutzen
das als Keep-Alive-Timer.
"""

import logging
import threading
import time

LOG = logging.getLogger("teamspeak.client")


class ClientQueryError(Exception):
    pass


def parse_params(line):
    """Hilfs-Parser fuer service.py: 'k=v k=v ...' → dict."""
    out = {}
    if not line:
        return out
    for p in line.split(" "):
        if "=" in p:
            k, _, v = p.partition("=")
            out[k] = v
    return out


def parse_list(line):
    """Hilfs-Parser fuer service.py: 'a|b|c' wo a/b/c je 'k=v k=v ...'."""
    return [parse_params(c) for c in line.split("|")]


class ClientQuery:
    """Persistente ClientQuery-Connection auf Basis der `ts3`-Library.

    Background-Thread-Loop: connect → auth → subscribe → wait_for_event.
    Reconnect mit Exponential-Backoff bei Verbindungsverlust.
    """

    def __init__(self, host, port, apikey, on_notify=None, on_status=None,
                 reconnect_secs=5.0):
        self.host = host
        self.port = port
        self.apikey = apikey
        self.on_notify = on_notify or (lambda *a: None)
        self.on_status = on_status or (lambda *a: None)
        self.reconnect_secs = reconnect_secs
        self._conn = None
        self._running = False
        self._thread = None
        self._connected = False
        self._cmd_lock = threading.Lock()

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
            if self._conn:
                self._conn.close()
        except Exception:
            pass

    def is_connected(self):
        return self._connected

    # ── Run-Loop ──────────────────────────────────────────────────────
    def _run_loop(self):
        try:
            from ts3.query import TS3Connection
            from ts3.query import TS3TimeoutError, TS3QueryError
        except ImportError as e:
            self.on_status(False,
                f"python-package 'ts3' fehlt — auf dem PC ausfuehren: "
                f"pip install ts3 ({e})")
            return
        self._TS3TimeoutError = TS3TimeoutError
        self._TS3QueryError = TS3QueryError
        backoff = self.reconnect_secs
        while self._running:
            try:
                # ClientQuery laeuft ueber dieselbe Telnet-Protokollklasse
                # wie ServerQuery — nur anderer Port (25639 statt 10011).
                conn = TS3Connection(self.host, self.port)
                self._conn = conn
                self._handshake(conn)
                self._connected = True
                self.on_status(True, "connected")
                backoff = self.reconnect_secs
                self._event_loop(conn)
            except Exception as e:
                LOG.warning("TS3 connection lost: %s", e)
                self._connected = False
                self.on_status(False, str(e))
            try:
                if self._conn:
                    self._conn.close()
            except Exception:
                pass
            self._conn = None
            if not self._running:
                break
            time.sleep(min(60, backoff))
            backoff = min(60, backoff * 1.5)

    def _handshake(self, conn):
        if self.apikey:
            LOG.info("auth: apikey-Laenge=%d", len(self.apikey))
            try:
                # TS3Connection.send(command, common_parameters_dict).
                # Library hat keine .auth() / .whoami()-Magic-Methods —
                # alle commands gehen ueber .send().
                conn.send("auth", {"apikey": self.apikey})
                LOG.info("auth ok")
            except self._TS3QueryError as e:
                LOG.info("auth fehlgeschlagen (%s) — probier weiter", e)
        # Sanity: whoami (probiert ob commands jetzt durchgehen)
        try:
            conn.send("whoami")
        except Exception as e:
            raise ClientQueryError(f"whoami nach handshake fehlgeschlagen: {e}")
        # Notify-Subscriptions
        for ev in ("notifytalkstatuschange",
                    "notifyclientmoved",
                    "notifycliententerview",
                    "notifyclientleftview",
                    "notifyclientupdated"):
            try:
                conn.send(
                    "clientnotifyregister",
                    {"schandlerid": "0", "event": ev})
            except Exception as e:
                LOG.warning("subscribe %s failed: %s", ev, e)

    def _event_loop(self, conn):
        # wait_for_event blockiert, gibt Event oder TS3TimeoutError.
        # Wir nutzen ein 30s-Timeout als Keep-Alive-Tick.
        while self._running:
            try:
                ev = conn.wait_for_event(timeout=30)
            except self._TS3TimeoutError:
                # Keep-Alive: leerer send als TCP-keepalive Ersatz
                try:
                    conn.send_keepalive()
                except Exception as e:
                    raise ClientQueryError(f"keepalive failed: {e}")
                continue
            if ev is None:
                continue
            # ev.event kann je nach Library-Version 'clientmoved' ODER
            # 'notifyclientmoved' sein. Normalisieren.
            ev_name = ev.event or ""
            if not ev_name.startswith("notify"):
                ev_name = "notify" + ev_name
            params = dict(ev.parsed[0]) if ev.parsed else {}
            LOG.debug("notify %s: %s", ev_name, params)
            self.on_notify(ev_name, params)

    # ── Synchronous send for service.py (initial-sync etc.) ────────────
    def send_command(self, cmd, timeout=3.0):
        """Senden waehrend der Event-Loop laeuft. Library serialisiert
        intern, aber wir nutzen einen Lock damit nicht Event-Loop und
        Send sich gegenseitig den Socket-Buffer zerlegen.

        cmd kann String mit Parametern sein (z.B. 'channelvariable
        cid=1 channel_name'). Wir parsen das und nutzen conn.send(name,
        params)."""
        if not self._conn:
            raise ClientQueryError("not connected")
        # 'cmd k=v k=v option1 option2' →
        # ('cmd', {'k': 'v'}, ['option1', 'option2'])
        # Barewords sind in TS3 wichtig (z.B. 'clientvariable clid=X
        # client_unique_identifier' — Letzte ist das anzufragende Feld).
        parts = cmd.split(" ")
        name = parts[0]
        params = {}
        options = []
        for p in parts[1:]:
            if "=" in p:
                k, _, v = p.partition("=")
                params[k] = v
            elif p:
                # Library setzt den '-' Prefix selbst, also strip wenn
                # User '-uid' geschrieben hat.
                options.append(p[1:] if p.startswith("-") else p)
        with self._cmd_lock:
            try:
                # Library-API kann je nach Version unterschiedlich sein.
                # Wir nutzen kwargs, damit None-Slots in der Signatur
                # nichts kaputt machen.
                kwargs = {}
                if params:  kwargs["common_parameters"] = params
                if options: kwargs["options"] = options
                resp = self._conn.send(name, **kwargs)
            except Exception as e:
                raise ClientQueryError(str(e))
        # Liefere parsed dicts direkt — nicht durch raw-Format jagen
        # weil sonst Nicknames mit '|' (TS3 \p) verstuemmelt werden.
        return list(resp.parsed or [])
