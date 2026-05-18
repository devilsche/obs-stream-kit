"""TS3-Live-State: aktuell sichtbarer Channel + Mitglieder + Talking-Set.

Wird vom ClientQuery-Background-Thread aktualisiert. Read-Path
(Endpoints) liest snapshot-aehnlich (Lock).

Talking-Tail (Hysterese): wenn ein Notify "stopped talking" kommt,
verzoegern wir den Zustandswechsel um `talkingTailMs` damit Mikro-
Pausen nicht hin-und-her-flackern.
"""
import threading
import time


class TsState:
    def __init__(self, talking_tail_ms=400):
        self._lock = threading.Lock()
        self.connected = False
        self.status_msg = "starting"
        self.streamer_uid = None      # eigene TS3-Client-UID (whoami)
        self.streamer_clid = None     # numeric clid des Streamers
        self.channel_id = None
        self.channel_name = None
        self.server_uid = None
        # client_id -> {clid, uid, nick, channelId}
        self.clients = {}
        # client_id -> wann zuletzt als "stopped talking" markiert
        self._talking = {}            # client_id -> True (currently)
        self._talking_until = {}      # client_id -> ts (until, tail)
        self._talk_start_ts = {}      # client_id -> echter Start (ohne Tail)
        self.talking_tail_ms = talking_tail_ms
        # Encounter-Tracking: pro Channel-Wechsel des Streamers neue
        # Encounter-Markierung. Hier nur Marker, DB-Insert macht der
        # Aggregator wenn er den Stand sieht.
        self.last_channel_change_at = None

    # ── Public read-API ───────────────────────────────────────────────
    def snapshot(self):
        with self._lock:
            now = time.time()
            members = []
            # Wenn Connection weg ist, melden wir KEINE Member —
            # State.clients ist evtl. noch stale aus Vor-Disconnect.
            if not self.connected:
                return {
                    "connected":    False,
                    "status":       self.status_msg,
                    "channelId":    None,
                    "channelName":  None,
                    "serverUid":    None,
                    "members":      [],
                }
            for clid, c in self.clients.items():
                if c.get("channelId") != self.channel_id:
                    continue
                # Nur input-mute (Mic aus) blockiert talking — output_muted
                # bedeutet 'ich hoere nichts' und hindert nicht am Sprechen.
                is_self = (clid == self.streamer_clid)
                # KEIN Mute-Filter — wenn TS3 'talking=1' meldet, vertrauen
                # wir dem. Push-to-talk feuert nur bei gehaltener Taste,
                # VAD nur bei tatsaechlichem Mikro-Input. Filter
                # blockierte den User wenn TS3 input_hardware=0 meldete
                # (bei manchen PTT-Setups normaler Default).
                talking = self._is_talking_now(clid, now)
                muted = (c.get("input_muted") == "1"
                          or c.get("input_hardware") == "0")
                members.append({
                    "clid":      clid,
                    "tsUid":     c.get("uid"),
                    "tsName":    c.get("nick"),
                    "isSelf":    (clid == self.streamer_clid),
                    "isTalking": talking,
                    "isMuted":   muted,
                })
            return {
                "connected":    self.connected,
                "status":       self.status_msg,
                "channelId":    self.channel_id,
                "channelName":  self.channel_name,
                "serverUid":    self.server_uid,
                "members":      members,
            }

    def _is_talking_now(self, clid, now):
        if self._talking.get(clid):
            return True
        # Tail
        until = self._talking_until.get(clid)
        if until and until > now:
            return True
        return False

    # ── State-Mutations vom Client-Thread ─────────────────────────────
    def set_connected(self, ok, msg):
        with self._lock:
            self.connected = ok
            self.status_msg = msg
            if not ok:
                # Bei Disconnect kompletten State leeren — alles veraltet.
                self._talking = {}
                self._talking_until = {}
                self._talk_start_ts = {}
                self.clients = {}
                self.channel_id = None
                self.channel_name = None
                self.server_uid = None
                self.streamer_clid = None
                self.streamer_uid = None

    def set_streamer(self, clid, uid):
        with self._lock:
            self.streamer_clid = clid
            self.streamer_uid = uid

    def set_channel(self, cid, name):
        with self._lock:
            changed = (cid != self.channel_id)
            self.channel_id = cid
            self.channel_name = name
            if changed:
                self.last_channel_change_at = time.time()

    def upsert_client(self, clid, **fields):
        with self._lock:
            c = self.clients.setdefault(clid, {})
            for k, v in fields.items():
                if v is not None:
                    c[k] = v

    def remove_client(self, clid):
        with self._lock:
            self.clients.pop(clid, None)
            self._talking.pop(clid, None)
            self._talking_until.pop(clid, None)

    def set_talking(self, clid, talking, on_transition=None):
        """on_transition(clid, started: bool, started_ts: float|None,
        stopped_ts: float|None) — Callback bei echtem Wechsel."""
        with self._lock:
            now = time.time()
            was_talking = bool(self._talking.get(clid))
            if talking:
                self._talking[clid] = True
                if not was_talking:
                    self._talk_start_ts[clid] = now
                self._talking_until[clid] = (
                    now + self.talking_tail_ms / 1000.0)
            else:
                self._talking.pop(clid, None)
                self._talking_until[clid] = (
                    now + self.talking_tail_ms / 1000.0)
        # Callback ausserhalb des Locks aufrufen (kein Deadlock-Risiko)
        if on_transition:
            if talking and not was_talking:
                on_transition(clid, True, now, None)
            elif not talking and was_talking:
                started = self._talk_start_ts.pop(clid, None)
                on_transition(clid, False, started, now)
