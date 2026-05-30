# Spec 2 Deploy-Plan

## Vor-Deploy-Schritte

### 1. Admin-Twitch-User-ID besorgen

Über die Twitch-API `/helix/users` (mit irgendeinem Access-Token) oder via Web-Tools wie streamweasels.com/twitch-tools/convert-username-to-user-id.

Speichern als Variable, z.B. `ADMIN_TWITCH_ID=123456789`.

### 2. Twitch-OAuth-App anlegen

Unter https://dev.twitch.tv/console/apps:
- Name: "OBS Stream Kit (stats-overlay.info)"
- OAuth Redirect URLs: `https://stats-overlay.info/app/oauth/callback`
- Category: Application Integration

Speichern → Client-ID + Client-Secret notieren.

### 3. `.secrets` auf Server erweitern

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "cat >> /opt/obs-stream-kit/.secrets <<EOF
Twitch App Client-ID: <client-id>
Twitch App Client-Secret: <client-secret>
Flask Secret-Key: $(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
EOF"
```

### 4. Admin-Twitch-ID pre-seed

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sudo -u postgres psql obs_stream_kit \
     -c \"UPDATE obs.users SET twitch_user_id = '$ADMIN_TWITCH_ID' WHERE id = 1\""
```

## Deploy

```bash
# 1. Schema-Migration ausfuehren (wenn noch nicht geschehen)
scp -i ~/.ssh/entry_server core/schema_v2.sql root@87.106.4.31:/tmp/
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sudo -u postgres psql obs_stream_kit -f /tmp/schema_v2.sql"

# 2. Server-Deps: Flask + authlib via apt
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "DEBIAN_FRONTEND=noninteractive apt-get install -y python3-flask python3-authlib"

# 3. Code deployen
bash scripts/deploy.sh

# 4. nginx Basic-Auth entfernen
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sed -i.bak '/auth_basic/d' /etc/nginx/sites-enabled/obs-stream-kit.conf && nginx -t && systemctl reload nginx"

# 5. Service-Status verifizieren
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  'systemctl status obs-stream-kit --no-pager -l | head -10'
```

## Post-Deploy Smoke-Tests

```bash
# Landing
curl -s -o /dev/null -w "%{http_code}\n" https://stats-overlay.info/
# Expected: 200

# Login Start
curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" \
  https://stats-overlay.info/app/login
# Expected: 302 → https://id.twitch.tv/oauth2/authorize?...

# Healthz
curl -s https://stats-overlay.info/healthz
# Expected: {"status":"ok"}
```

Admin loggt sich danach manuell im Browser ein:
- https://stats-overlay.info/ → "Mit Twitch einloggen"
- Nach Login: Dashboard sichtbar
- /app/urls → Token kopieren
- OBS Browser-Sources umstellen auf `https://stats-overlay.info/s/<token>/widgets/...`

## Rollback (Notfall)

```bash
# 1. Code zurueck (Vorausgesetzt vorheriger Stand ist in git):
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "cd /opt/obs-stream-kit && systemctl stop obs-stream-kit"
# Auf der lokalen Maschine:
git checkout <prev-commit>
bash scripts/deploy.sh
# (anschliessend Branch wieder zurueck auf master)

# 2. nginx Basic-Auth wieder rein
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "cp /etc/nginx/sites-enabled/obs-stream-kit.conf.bak /etc/nginx/sites-enabled/obs-stream-kit.conf && systemctl reload nginx"

# 3. PG-Schema NICHT zurueck rollen (additive only — alte Code-Version ignoriert die neuen Spalten).
```

## Fallbacks

- **Token wird vergessen / Browser-History bereinigt:** Admin sieht den Token jederzeit unter `/app/urls`.
- **OBS-Source-URLs falsch:** kein Token → 404. Korrekter Token aber falscher Pfad → 404. Korrekter Token + korrekter Pfad aber Tenant hat keine Daten → leere Response.
- **Streamer.bot funktioniert nicht mehr:** siehe `docs/streamerbot-migration.md`.
