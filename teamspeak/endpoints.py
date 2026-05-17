"""TeamSpeak-Endpoints — folgt dem pubg/endpoints.py-Pattern.

Aktuelle Routes (Commit 1):
  GET /api/teamspeak/state
"""

import json


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class TeamSpeakRegistry:
    """Routet TS3-Requests. service kann None sein wenn kein API-Key
    konfiguriert war — dann liefern wir 'connected=false'."""
    def __init__(self, service):
        self.service = service

    def handle(self, method, path, qs, body):
        route = (method, path)
        if route == ("GET", "/api/teamspeak/state"):
            return self._state()
        return None  # not handled → server.py macht den 404

    def _state(self):
        if not self.service:
            return _ok({
                "connected": False,
                "status":    "no api-key configured (TS3-ClientQuery-Key in .secrets)",
                "members":   [],
            })
        return _ok(self.service.state.snapshot())
