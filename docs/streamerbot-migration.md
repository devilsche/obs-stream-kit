# Streamer.bot Migration (Spec 2 Cutover)

Spec 2 entfernt die globale Basic-Auth in nginx. Streamer.bot kann sich nicht
mehr per `.htpasswd`-Header authentifizieren — es nutzt ab jetzt URL-Tokens.

## Schritte

1. Admin loggt sich auf https://king-edition.de/app/ ein.
2. Navigiert zu `/app/urls`.
3. Kopiert sein **Default-Token** (Format `tok_xxxxxxxx...`).
4. In Streamer.bot: jeden API-Aufruf von:
   - **Alt:** `https://king-edition.de/api/pubg/last-match`
   - **Neu:** `https://king-edition.de/s/tok_xxxxxxxx.../api/pubg/last-match`
5. Auth-Header in Streamer.bot entfernen (kein `Authorization: Basic ...` mehr).

## Validierung

```bash
curl -s "https://king-edition.de/s/<token>/api/pubg/last-match" | jq .matchId
```

Sollte 200 + die last-match-ID liefern, ohne Header.
