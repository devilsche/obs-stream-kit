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
        self._talking_until = {}      # client_id -> ts (until)
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
            for clid, c in self.clients.items():
                if c.get("channelId") != self.channel_id:
                    continue
                muted = (c.get("input_muted") == "1"
                          or c.get("output_muted") == "1"
                          or c.get("input_hardware") == "0")
                talking = self._is_talking_now(clid, now) and not muted
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
                # Bei Disconnect alles als nicht-sprechend markieren
                self._talking = {}
                self._talking_until = {}

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

    def set_talking(self, clid, talking):
        with self._lock:
            if talking:
                self._talking[clid] = True
                self._talking_until[clid] = (
                    time.time() + self.talking_tail_ms / 1000.0)
            else:
                self._talking.pop(clid, None)
                # tail bleibt — wenn die Zeit abgelaufen ist, schaltet
                # is_talking_now() automatisch auf False.
                self._talking_until[clid] = (
                    time.time() + self.talking_tail_ms / 1000.0)
