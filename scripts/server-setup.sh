#!/usr/bin/env bash
# server-setup.sh — Einmalig auf dem Server ausführen (als root) nach dem ersten Deploy.
# Legt .secrets und config/pubg.json an wenn noch nicht vorhanden.
set -euo pipefail

REMOTE_DIR="/opt/obs-stream-kit"

if [ ! -f "$REMOTE_DIR/.secrets" ]; then
  echo "Lege leere .secrets an — bitte ausfüllen!"
  cat > "$REMOTE_DIR/.secrets" << 'SECRETS'
Twitch-Channel: DEIN_TWITCH_CHANNEL
PUBG API Key: DEIN_PUBG_API_KEY
SECRETS
  chown entry:entry "$REMOTE_DIR/.secrets"
  chmod 600 "$REMOTE_DIR/.secrets"
fi

if [ ! -f "$REMOTE_DIR/config/pubg.json" ]; then
  echo "Lege leere config/pubg.json an — bitte ausfüllen!"
  cp "$REMOTE_DIR/config/pubg.example.json" "$REMOTE_DIR/config/pubg.json" 2>/dev/null || \
  cat > "$REMOTE_DIR/config/pubg.json" << 'JSON'
{
  "nickname": "DEIN_PUBG_NICKNAME",
  "platform": "steam"
}
JSON
  chown entry:entry "$REMOTE_DIR/config/pubg.json"
fi

systemctl enable obs-stream-kit
systemctl start obs-stream-kit
systemctl status obs-stream-kit --no-pager

echo ""
echo "✓ Setup fertig"
echo "  .secrets und config/pubg.json ggf. noch ausfüllen!"
echo "  Passwort für /tools/ setzen:"
echo "    htpasswd /etc/nginx/.htpasswd-obs luckr"
