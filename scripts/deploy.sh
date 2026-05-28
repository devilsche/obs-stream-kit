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
  --exclude='widgets/pubg/maps/' \
  "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"

# .secrets + config/pubg.json mitschicken falls vorhanden (nie im Git)
if [ -f "$LOCAL_DIR/.secrets" ]; then
  echo "▶ .secrets hochladen"
  rsync -az -e "ssh -i $SSH_KEY" "$LOCAL_DIR/.secrets" "$SERVER:$REMOTE_DIR/.secrets"
fi
if [ -f "$LOCAL_DIR/config/pubg.json" ]; then
  echo "▶ config/pubg.json hochladen"
  rsync -az -e "ssh -i $SSH_KEY" "$LOCAL_DIR/config/pubg.json" "$SERVER:$REMOTE_DIR/config/pubg.json"
fi

echo "▶ Service neu starten"
ssh -i "$SSH_KEY" "$SERVER" "systemctl restart obs-stream-kit && systemctl status obs-stream-kit --no-pager -l | head -20"

echo "✓ Deploy fertig — https://king-edition.de"
