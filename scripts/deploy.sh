#!/usr/bin/env bash
# deploy.sh — Code vom Laptop auf den Entry-Server pushen und Service neu starten.
# Voraussetzung: git push wurde bereits gemacht.
# NICHT gitignored: data/, .secrets, config/pubg.json bleiben lokal.
set -euo pipefail

SERVER="root@87.106.4.31"
SSH_KEY="$HOME/.ssh/entry_server"
REMOTE_DIR="/opt/obs-stream-kit"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Deploye $LOCAL_DIR → $SERVER:$REMOTE_DIR"

rsync -avz --delete \
  -e "ssh -i $SSH_KEY" \
  --exclude='.git/' \
  --exclude='data/' \
  --exclude='.secrets' \
  --exclude='config/pubg.json' \
  --exclude='config/pubg.example.json' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  --exclude='logs/' \
  --exclude='node_modules/' \
  --exclude='widgets/pubg/maps' \
  "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"

# .secrets + config/pubg.json werden NIE vom Deploy angefasst — sie sind
# server-seitige Wahrheit (einmalig via server-setup.sh angelegt) und oben
# bereits vom rsync ausgeschlossen.

echo "▶ Ownership → obskit (Service-User)"
ssh -i "$SSH_KEY" "$SERVER" "chown -R obskit:obskit $REMOTE_DIR"

echo "▶ Services neu starten (Service 1: obs-stream-kit :9000, Service 2: obs-overlays :9001)"
ssh -i "$SSH_KEY" "$SERVER" "systemctl restart obs-stream-kit obs-overlays && systemctl status obs-overlays --no-pager -l | head -20"

# HINWEIS: Dieses Skript zeigt noch auf veraltete Werte (SERVER, SSH_KEY, Domain).
# Aktuelle Prod-Werte: root@31.70.95.217, ~/.ssh/obskit, stats-overlay.info
echo "✓ Deploy fertig — https://stats-overlay.info"
