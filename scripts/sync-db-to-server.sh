#!/usr/bin/env bash
# sync-db-to-server.sh — SQLite-Datenbank vom Streaming-PC auf den Server rsync'en.
# Läuft auf dem Streaming-PC. Idempotent: nur Änderungen werden übertragen.
set -euo pipefail

SERVER="root@87.106.4.31"
SSH_KEY="$HOME/.ssh/entry_server"
LOCAL_DB="$(cd "$(dirname "$0")/.." && pwd)/data/pubg-history.db"
REMOTE_DB="/opt/obs-stream-kit/data/pubg-history.db"

if [ ! -f "$LOCAL_DB" ]; then
  echo "Fehler: $LOCAL_DB nicht gefunden"
  exit 1
fi

SIZE=$(du -sh "$LOCAL_DB" | cut -f1)
echo "▶ Sync DB ($SIZE) → $SERVER:$REMOTE_DB"

# --checksum statt timestamp: nur wirklich geänderte Bytes übertragen
rsync -avz --checksum \
  -e "ssh -i $SSH_KEY" \
  "$LOCAL_DB" "$SERVER:$REMOTE_DB"

echo "✓ DB sync fertig"
