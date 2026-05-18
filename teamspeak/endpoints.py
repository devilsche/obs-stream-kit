"""TeamSpeak-Endpoints — folgt dem pubg/endpoints.py-Pattern.

Routes (Commit 1+2):
  GET   /api/teamspeak/state                — live channel + members
  GET   /api/teamspeak/users                — alle bekannten Mappings
  POST  /api/teamspeak/users                — Mapping setzen
  GET   /api/teamspeak/discover             — online aber unmappt
  GET   /api/teamspeak/encounters           — Begegnungszaehler
  GET   /api/teamspeak/afk-channels         — Liste (opt ?server=)
  POST  /api/teamspeak/afk-channels         — Channel als AFK markieren
  DELETE/api/teamspeak/afk-channels         — Channel raus
"""

import json
import os


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class TeamSpeakRegistry:
    def __init__(self, service, db_conn=None, root_dir=None,
                  steam_api_key=None):
        self.service = service
        self.db = db_conn
        self.root_dir = root_dir
        self.steam_api_key = steam_api_key

    def handle(self, method, path, qs, body):
        route = (method, path)
        if route == ("GET", "/api/teamspeak/state"):
            return self._state()
        if route == ("GET", "/api/teamspeak/users"):
            return self._users_get()
        if route == ("POST", "/api/teamspeak/users"):
            return self._users_post(body)
        if route == ("GET", "/api/teamspeak/discover"):
            return self._discover()
        if route == ("GET", "/api/teamspeak/encounters"):
            return self._encounters()
        if route == ("GET", "/api/teamspeak/afk-channels"):
            return self._afk_get(qs)
        if route == ("POST", "/api/teamspeak/afk-channels"):
            return self._afk_post(body)
        if route == ("DELETE", "/api/teamspeak/afk-channels"):
            return self._afk_delete(body)
        if route == ("POST", "/api/teamspeak/mute"):
            return self._mute(body)
        if route == ("GET", "/api/teamspeak/channels"):
            return self._channels()
        return None

    # ── State ──────────────────────────────────────────────────────────
    def _state(self):
        if not self.service:
            return _ok({
                "connected": False,
                "status":    "no api-key configured",
                "members":   [],
            })
        snap = self.service.state.snapshot()
        # Mappings ergaenzen pro Member
        if self.db:
            from teamspeak.db import get_user
            from teamspeak.avatars import url_for as avatar_url
            for m in snap["members"]:
                u = get_user(self.db, m.get("tsUid")) if m.get("tsUid") else None
                if u:
                    src = u.get("display_source") or "ts"
                    custom = u.get("custom_name")
                    if src == "custom" and custom:
                        m["displayName"] = custom
                    else:
                        m["displayName"] = m.get("tsName")
                    m["steamId"]       = u.get("steam_id")
                    m["speakingIcon"]  = u.get("speaking_icon")
                    m["silentIcon"]    = u.get("silent_icon")
                    m["showInWidget"]  = bool(u.get("show_in_widget", 1))
                    m["isFriend"]      = bool(u.get("is_friend", 0))
                    m["isBlocked"]     = bool(u.get("is_blocked", 0))
                    # Blocked → showInWidget=false damit das Display-
                    # Widget sie automatisch ausblendet.
                    if m["isBlocked"]:
                        m["showInWidget"] = False
                    if self.root_dir and u.get("steam_id"):
                        m["avatarUrl"] = avatar_url(
                            self.root_dir, u["steam_id"])
                else:
                    m["displayName"]  = m.get("tsName")
                    m["showInWidget"] = True
                    m["isFriend"]     = False
                    m["isBlocked"]    = False
        return _ok(snap)

    # ── User-Mappings ──────────────────────────────────────────────────
    def _users_get(self):
        if not self.db:
            return _ok({"users": []})
        from teamspeak.db import get_all_users
        return _ok({"users": get_all_users(self.db)})

    def _users_post(self, body):
        if not self.db:
            return _err(503, "db not available")
        try:
            payload = json.loads(body or b"{}")
            ts_uid = (payload.get("tsUid") or "").strip()
            if not ts_uid:
                return _err(400, "tsUid required")
            from teamspeak.db import save_user_mapping
            from teamspeak.avatars import fetch_and_cache
            # Whitelist + Mapping camelCase -> snake_case
            fields = {}
            for src_key, db_key in [
                ("steamId",        "steam_id"),
                ("customName",     "custom_name"),
                ("displaySource",  "display_source"),
                ("speakingIcon",   "speaking_icon"),
                ("silentIcon",     "silent_icon"),
                ("showInWidget",   "show_in_widget"),
                ("lastNick",       "last_nick"),
                ("isFriend",       "is_friend"),
                ("isBlocked",      "is_blocked"),
                ("notes",          "notes"),
            ]:
                if src_key in payload:
                    v = payload[src_key]
                    if db_key in ("show_in_widget", "is_friend", "is_blocked"):
                        v = 1 if v else 0
                    fields[db_key] = v
            save_user_mapping(self.db, ts_uid, **fields)
            # Wenn eine Steam-ID neu gesetzt wurde → Avatar nachziehen
            if fields.get("steam_id") and self.root_dir and self.steam_api_key:
                fetch_and_cache(self.root_dir, fields["steam_id"],
                                 self.steam_api_key)
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    # ── Discover: online aber noch nicht gemappt ───────────────────────
    def _discover(self):
        if not self.service:
            return _ok({"members": []})
        snap = self.service.state.snapshot()
        unmapped = []
        if self.db:
            from teamspeak.db import get_user
            for m in snap["members"]:
                if not m.get("tsUid"): continue
                u = get_user(self.db, m["tsUid"])
                # 'unmappt' = noch kein steam_id UND kein custom_name
                if not u or (not u.get("steam_id") and not u.get("custom_name")):
                    unmapped.append({
                        "tsUid": m["tsUid"],
                        "tsName": m.get("tsName"),
                        "isSelf": m.get("isSelf"),
                    })
        return _ok({"members": unmapped})

    # ── Encounters ─────────────────────────────────────────────────────
    def _encounters(self):
        if not self.service or not self.db:
            return _ok({"encounters": []})
        sid = self.service.state.streamer_uid
        if not sid:
            return _ok({"encounters": []})
        from teamspeak.db import get_encounters, get_user
        rows = get_encounters(self.db, sid)
        # Namen ergaenzen
        for r in rows:
            u = get_user(self.db, r["mate_uid"])
            r["name"] = (u or {}).get("custom_name") \
                or (u or {}).get("last_nick") \
                or r["mate_uid"][:12]
        return _ok({"encounters": rows})

    # ── AFK-Channels ───────────────────────────────────────────────────
    def _afk_get(self, qs):
        if not self.db:
            return _ok({"afkChannels": []})
        from teamspeak.db import get_afk_channels
        return _ok({"afkChannels": get_afk_channels(
            self.db, qs.get("server"))})

    def _afk_post(self, body):
        if not self.db:
            return _err(503, "db not available")
        try:
            payload = json.loads(body or b"{}")
            from teamspeak.db import set_afk_channel
            set_afk_channel(self.db,
                payload["serverUid"], payload["channelId"],
                payload.get("channelName"))
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    def _afk_delete(self, body):
        if not self.db:
            return _err(503, "db not available")
        try:
            payload = json.loads(body or b"{}")
            from teamspeak.db import remove_afk_channel
            remove_afk_channel(self.db,
                payload["serverUid"], payload["channelId"])
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    # ── Channels (fuer AFK-Auswahl im Tool) ────────────────────────────
    _channels_cache = (0.0, [])  # (timestamp, channels)

    def _channels(self):
        if not self.service:
            return _ok({"channels": [], "error": "no service"})
        import time
        cache_age = time.time() - TeamSpeakRegistry._channels_cache[0]
        if cache_age < 30.0:
            return _ok({"channels": TeamSpeakRegistry._channels_cache[1]})
        try:
            rows = self.service.client.send_command("channellist") or []
        except Exception as e:
            return _err(500, f"channellist failed: {e}")
        import re
        spacer_re = re.compile(r"\[[*clr]spacer\d*\]", re.IGNORECASE)
        # Vollstaendige cid->name Map (auch Spacer) fuer Parent-Path
        name_by_cid = {r.get("cid"): (r.get("channel_name") or "")
                       for r in rows if r.get("cid")}
        pid_by_cid  = {r.get("cid"): r.get("pid") for r in rows if r.get("cid")}

        def _path(cid):
            """Eltern-Pfad als 'Top / Sub / Channel' (ohne Spacer)."""
            parts = []
            seen = set()
            cur = cid
            while cur and cur not in seen:
                seen.add(cur)
                nm = name_by_cid.get(cur) or ""
                if nm and not spacer_re.search(nm):
                    parts.append(nm)
                cur = pid_by_cid.get(cur)
                if cur in (None, "0", ""):
                    break
            return " / ".join(reversed(parts))

        out = []
        for r in rows:
            name = r.get("channel_name") or ""
            if spacer_re.search(name):
                continue
            if not name.strip():
                continue
            out.append({
                "cid":         r.get("cid"),
                "pid":         r.get("pid"),
                "name":        name,
                "path":        _path(r.get("cid")),
                "order":       r.get("channel_order"),
                "totalClients": r.get("total_clients"),
            })
        out.sort(key=lambda c: (c.get("path") or "").lower())
        TeamSpeakRegistry._channels_cache = (time.time(), out)
        return _ok({"channels": out})

    # ── Mute via ClientQuery (lokaler TS3-Mute) ────────────────────────
    def _mute(self, body):
        """Body: {clid, mute: true|false}. Lokaler Mute im TS3-Client
        des Streamers — du hoerst die Person nicht mehr, andere im
        Channel schon. Wird via clientmute/clientunmute clid=X gesetzt."""
        if not self.service:
            return _err(503, "ts service not running")
        try:
            payload = json.loads(body or b"{}")
            clid = str(payload.get("clid") or "").strip()
            mute = bool(payload.get("mute"))
            if not clid:
                return _err(400, "clid required")
            cmd = "clientmute" if mute else "clientunmute"
            self.service.client.send_command(f"{cmd} clid={clid}")
            return _ok({"ok": True, "clid": clid, "mute": mute})
        except Exception as e:
            return _err(400, str(e))
