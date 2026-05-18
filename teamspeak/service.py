"""Service-Orchestrator: ClientQuery -> TsState.

Beim Connect:
  1. whoami → eigenes clid + uid (streamer)
  2. channelconnectinfo → server_uid
  3. clientlist → alle aktuell sichtbaren Clients (clid, nick, channel)
  4. clientvariable fuer jeden Client (uid)
  5. Notify-Events updaten State danach inkrementell

Notify-Events:
  - notifytalkstatuschange: status (0/1) + clid
  - notifyclientmoved: ctid (Ziel-Channel) + clid
  - notifycliententerview: clid + cid + client_unique_identifier + client_nickname
  - notifyclientleftview: clid

Encoding der Argumente: TS3 escaped Strings. parse_params/parse_list
in client.py uebernimmt das.
"""

import logging
from teamspeak.client import ClientQuery, ClientQueryError
from teamspeak.state import TsState

LOG = logging.getLogger("teamspeak.service")


class TeamSpeakService:
    def __init__(self, host, port, apikey, talking_tail_ms=400,
                  db_conn=None, root_dir=None, steam_api_key=None):
        self.state = TsState(talking_tail_ms=talking_tail_ms)
        self.client = ClientQuery(
            host=host, port=port, apikey=apikey,
            on_notify=self._on_notify,
            on_status=self._on_status)
        self._connect_seq = 0
        self.db = db_conn
        self.root_dir = root_dir
        self.steam_api_key = steam_api_key
        # Encounter-Tracking: vorheriger Streamer-Channel + Member-Set,
        # damit wir pro Channel-Wechsel die Mates des verlassenen
        # Channels NICHT mehr zaehlen, sondern die des neuen.
        self._last_streamer_channel = None
        self._counted_in_current_channel = set()

    def start(self):
        self.client.start()
        # Talk-Tick: alle 1s pro talking Mate im aktuellen Channel (nicht
        # AFK) eine Sekunde talk_seconds buchen.
        import threading
        self._talk_tick_thread = threading.Thread(
            target=self._talk_tick_loop, name="ts-talk-tick", daemon=True)
        self._talk_tick_thread.start()

    def stop(self):
        self.client.stop()

    TALK_TICK_SECS = 5

    def _talk_tick_loop(self):
        import time
        while True:
            try:
                self._tick_once()
            except Exception:
                pass
            time.sleep(self.TALK_TICK_SECS)

    def _tick_once(self):
        if not self.db: return
        s = self.state
        if not s.connected: return
        if not s.streamer_uid or not s.channel_id or not s.server_uid: return
        # AFK-Channel ueberspringen
        try:
            from teamspeak.db import is_afk_channel, bump_talk_seconds
            if is_afk_channel(self.db, s.server_uid, s.channel_id):
                return
        except Exception:
            return
        import time
        now = time.time()
        # snapshot der talking mates im current channel
        with s._lock:
            mates = []
            for clid, c in s.clients.items():
                if clid == s.streamer_clid: continue
                if c.get("channelId") != s.channel_id: continue
                uid = c.get("uid")
                if not uid: continue
                # talking-state per state.is_talking_now
                if s._is_talking_now(clid, now):
                    muted = (c.get("input_muted") == "1"
                              or c.get("input_hardware") == "0")
                    if not muted:
                        mates.append(uid)
        for uid in mates:
            try:
                bump_talk_seconds(self.db, s.streamer_uid, uid,
                                   s.server_uid, self.TALK_TICK_SECS)
            except Exception:
                continue

    # ── Hooks ──────────────────────────────────────────────────────────
    def _on_status(self, connected, msg):
        self.state.set_connected(connected, msg)
        if connected:
            self._connect_seq += 1
            try:
                self._initial_sync()
            except Exception as e:
                LOG.warning("initial sync failed: %s", e)
                # Fehler im Status sichtbar machen — sonst wundert sich der
                # User dass connected=true aber channelName=null ist.
                self.state.set_connected(True, f"sync failed: {e}")

    def _on_notify(self, event, params):
        try:
            if event == "notifytalkstatuschange":
                clid = params.get("clid")
                if not clid: return
                self.state.set_talking(clid, params.get("status") == "1")
            elif event == "notifycliententerview":
                clid = params.get("clid")
                if not clid: return
                self.state.upsert_client(
                    clid,
                    uid=params.get("client_unique_identifier"),
                    nick=params.get("client_nickname"),
                    channelId=params.get("ctid"))
                if self.db and params.get("client_unique_identifier"):
                    try:
                        from teamspeak.db import upsert_user_nick
                        upsert_user_nick(self.db,
                            params.get("client_unique_identifier"),
                            params.get("client_nickname"))
                    except Exception:
                        pass
                self._maybe_count_encounters()
            elif event == "notifyclientleftview":
                clid = params.get("clid")
                if not clid: return
                self.state.remove_client(clid)
            elif event == "notifyclientupdated":
                # Mute/Hardware-Status-Aenderungen + Nick-Aenderung
                clid = params.get("clid")
                if not clid: return
                fields = {}
                if "client_input_muted"  in params:
                    fields["input_muted"]  = params["client_input_muted"]
                if "client_output_muted" in params:
                    fields["output_muted"] = params["client_output_muted"]
                if "client_input_hardware" in params:
                    fields["input_hardware"] = params["client_input_hardware"]
                if "client_nickname" in params:
                    fields["nick"] = params["client_nickname"]
                if fields:
                    self.state.upsert_client(clid, **fields)
            elif event == "notifyclientmoved":
                clid = params.get("clid")
                ctid = params.get("ctid")
                if not clid or not ctid: return
                self.state.upsert_client(clid, channelId=ctid)
                # Wenn der Streamer selbst gemoved wurde → neuer Channel
                # + clientlist neu (andere Member waren bereits drin,
                # haben also kein cliententerview gefeuert).
                if clid == self.state.streamer_clid:
                    # Channel-ID SOFORT setzen damit snapshot ab jetzt den
                    # neuen Channel filtert. Name kommt asynchron nach.
                    self.state.set_channel(ctid, self.state.channel_name)
                    # Worker-Thread — send_command darf nicht aus dem
                    # notify/read-thread laufen (deadlock).
                    import threading
                    def _post_move():
                        try:
                            self._refresh_channel_name(ctid)
                            self._refresh_clientlist()
                        except Exception as e:
                            LOG.warning("post-move refresh: %s", e)
                    threading.Thread(
                        target=_post_move, name="ts-post-move",
                        daemon=True).start()
                else:
                    # Mate ist in unseren Channel gewechselt → ggf zaehlen
                    self._maybe_count_encounters()
        except Exception as e:
            LOG.warning("notify-handler error %s: %s", event, e)

    def _dbg(self, *parts):
        msg = "[teamspeak] " + " ".join(str(p) for p in parts)
        import sys
        print(msg, flush=True)
        print(msg, file=sys.stderr, flush=True)

    # ── Initial Sync ───────────────────────────────────────────────────
    def _initial_sync(self):
        rows = self.client.send_command("whoami")
        if not rows:
            LOG.warning("whoami: empty reply")
            return
        # whoami liefert je nach TS3-Version 1+ rows — alle Felder mergen
        w = {}
        for r in rows:
            w.update(r)
        my_clid = w.get("client_id") or w.get("clid")
        my_cid  = w.get("client_channel_id") or w.get("cid")
        # ServerUid: kann unter unterschiedlichen Keys auftauchen
        server_uid = (
            w.get("virtualserver_unique_identifier")
            or w.get("vsid")
            or w.get("server_unique_identifier"))
        # ClientQuery hat keinen sauberen Weg zur kryptografischen
        # virtualserver_unique_identifier (servervariable braucht
        # bareword-Syntax die py-ts3 nicht unterstuetzt). Wir nutzen
        # 'ip:port' aus serverconnectinfo als Server-Identifier — fuer
        # unseren Zweck (AFK-Channels pro Server scopen, User-Mapping)
        # reicht das vollkommen.
        if not server_uid:
            try:
                sc = self.client.send_command("serverconnectinfo") or []
                self._dbg(f" serverconnectinfo parsed: {sc}")
                if sc:
                    r = sc[0]
                    ip = r.get("ip") or r.get("host") or ""
                    port = r.get("port") or ""
                    if ip and port:
                        server_uid = f"{ip}:{port}"
                    elif ip:
                        server_uid = str(ip)
            except ClientQueryError as e:
                LOG.info("serverconnectinfo: %s", e)
        self._dbg(f" -> server_uid={server_uid}")
        LOG.info("whoami: clid=%s cid=%s server_uid=%s",
                 my_clid, my_cid, server_uid)
        self.state.server_uid = server_uid
        # Channel-ID SOFORT setzen damit snapshot ab jetzt funktioniert,
        # auch wenn channellist (Name-Lookup) gleich noch hakt.
        if my_cid:
            self.state.set_channel(my_cid, self.state.channel_name)
        # Streamer-UID via clientlist -uid (per-Client-clientvariable
        # vermeiden — bareword-Syntax frisst die Library nicht).
        self._refresh_channel_name(my_cid)
        self._refresh_clientlist(streamer_clid=my_clid)

    def _refresh_clientlist(self, streamer_clid=None):
        """Holt clientlist mit -uid + -voice (UIDs + Mute/Talking-Flags
        fuer alle Clients) und merged in den State."""
        try:
            items = self.client.send_command("clientlist -uid -voice") or []
        except ClientQueryError as e:
            LOG.warning("clientlist failed: %s", e)
            return
        for it in items:
            clid = it.get("clid")
            if not clid: continue
            self.state.upsert_client(
                clid,
                nick=it.get("client_nickname"),
                channelId=it.get("cid"),
                uid=it.get("client_unique_identifier"),
                input_muted=it.get("client_input_muted"),
                output_muted=it.get("client_output_muted"),
                input_hardware=it.get("client_input_hardware"))
            if streamer_clid and clid == streamer_clid:
                self.state.set_streamer(
                    clid, it.get("client_unique_identifier"))
            # last_nick in DB persistieren
            if self.db and it.get("client_unique_identifier"):
                try:
                    from teamspeak.db import upsert_user_nick
                    upsert_user_nick(self.db,
                        it.get("client_unique_identifier"),
                        it.get("client_nickname"))
                except Exception:
                    pass
        self._maybe_count_encounters()

    def _maybe_count_encounters(self):
        """Pro Channel-Wechsel: fuer jeden Mate im aktuellen Channel
        (= nicht-AFK) +1 Begegnung — aber nur EINMAL pro Aufenthalt
        in diesem Channel."""
        if not self.db: return
        s = self.state
        if not s.streamer_uid or not s.channel_id or not s.server_uid:
            return
        # AFK-Channel ueberspringen
        try:
            from teamspeak.db import is_afk_channel, bump_encounter
            if is_afk_channel(self.db, s.server_uid, s.channel_id):
                return
        except Exception:
            return
        # Channel-Wechsel?
        if self._last_streamer_channel != s.channel_id:
            self._last_streamer_channel = s.channel_id
            self._counted_in_current_channel = set()
        # Alle Mates im selben Channel (nicht self), die noch nicht
        # gezaehlt wurden
        for clid, c in list(s.clients.items()):
            if clid == s.streamer_clid: continue
            if c.get("channelId") != s.channel_id: continue
            mate_uid = c.get("uid")
            if not mate_uid: continue
            if mate_uid in self._counted_in_current_channel: continue
            try:
                bump_encounter(self.db, s.streamer_uid, mate_uid, s.server_uid)
            except Exception:
                continue
            self._counted_in_current_channel.add(mate_uid)

    def _refresh_channel_name(self, cid):
        """Channel-Name aus channellist (statt channelvariable mit
        bareword)."""
        if not cid: return
        try:
            rows = self.client.send_command("channellist") or []
        except ClientQueryError as e:
            LOG.info("channellist: %s", e)
            return
        for r in rows:
            if r.get("cid") == cid:
                self.state.set_channel(cid, r.get("channel_name"))
                return
