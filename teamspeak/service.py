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
from teamspeak.client import ClientQuery, ClientQueryError, parse_list, parse_params
from teamspeak.state import TsState

LOG = logging.getLogger("teamspeak.service")


class TeamSpeakService:
    def __init__(self, host, port, apikey, talking_tail_ms=400):
        self.state = TsState(talking_tail_ms=talking_tail_ms)
        self.client = ClientQuery(
            host=host, port=port, apikey=apikey,
            on_notify=self._on_notify,
            on_status=self._on_status)
        self._connect_seq = 0

    def start(self):
        self.client.start()

    def stop(self):
        self.client.stop()

    # ── Hooks ──────────────────────────────────────────────────────────
    def _on_status(self, connected, msg):
        self.state.set_connected(connected, msg)
        if connected:
            self._connect_seq += 1
            try:
                self._initial_sync()
            except Exception as e:
                LOG.warning("initial sync failed: %s", e)

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
            elif event == "notifyclientleftview":
                clid = params.get("clid")
                if not clid: return
                self.state.remove_client(clid)
            elif event == "notifyclientmoved":
                clid = params.get("clid")
                ctid = params.get("ctid")
                if not clid or not ctid: return
                self.state.upsert_client(clid, channelId=ctid)
                # Wenn der Streamer selbst gemoved wurde → neuer Channel
                if clid == self.state.streamer_clid:
                    self._refresh_channel_name(ctid)
        except Exception as e:
            LOG.warning("notify-handler error %s: %s", event, e)

    # ── Initial Sync ───────────────────────────────────────────────────
    def _initial_sync(self):
        # whoami → clid + cid
        rows = self.client.send_command("whoami")
        if not rows: return
        w = parse_params(rows[0])
        my_clid = w.get("clid")
        my_cid  = w.get("cid")
        # eigene UID + Server-UID
        sv = self.client.send_command("servervariable virtualserver_unique_identifier")
        server_uid = None
        if sv:
            server_uid = parse_params(sv[0]).get("virtualserver_unique_identifier")
        self.state.server_uid = server_uid
        if my_clid:
            try:
                cv = self.client.send_command(
                    f"clientvariable clid={my_clid} client_unique_identifier")
                if cv:
                    uid = parse_params(cv[0]).get("client_unique_identifier")
                    self.state.set_streamer(my_clid, uid)
            except ClientQueryError:
                pass
        self._refresh_channel_name(my_cid)
        # clientlist mit Channel-Info
        try:
            rows = self.client.send_command("clientlist")
            if rows:
                items = parse_list(rows[0])
                for it in items:
                    clid = it.get("clid")
                    if not clid: continue
                    self.state.upsert_client(
                        clid,
                        nick=it.get("client_nickname"),
                        channelId=it.get("cid"))
                # UIDs der Channel-Member nachladen
                for it in items:
                    if it.get("cid") != my_cid: continue
                    clid = it.get("clid")
                    try:
                        cv = self.client.send_command(
                            f"clientvariable clid={clid} client_unique_identifier")
                        if cv:
                            uid = parse_params(cv[0]).get("client_unique_identifier")
                            self.state.upsert_client(clid, uid=uid)
                    except ClientQueryError:
                        pass
        except ClientQueryError as e:
            LOG.warning("clientlist failed: %s", e)

    def _refresh_channel_name(self, cid):
        if not cid: return
        try:
            rows = self.client.send_command(
                f"channelvariable cid={cid} channel_name")
            if rows:
                name = parse_params(rows[0]).get("channel_name")
                self.state.set_channel(cid, name)
        except ClientQueryError as e:
            LOG.info("channelvariable cid=%s: %s", cid, e)
