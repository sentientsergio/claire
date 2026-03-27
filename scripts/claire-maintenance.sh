#!/bin/bash
# claire-maintenance.sh — 9 PM maintenance for Claire
# Called by LaunchAgent: com.claire.maintenance
#
# 1. Runs batch memory indexer (infrastructure — happens before Claire wakes)
# 2. Sends a heartbeat into Claire's session (she knows what 9 PM means)

CLAIRE_DIR="/Users/sergio/sentientsergio/claire"
LOG="$HOME/Library/Logs/claire/cron.log"

mkdir -p "$(dirname "$LOG")"

echo "$(date -Iseconds) [maintenance] Starting nightly maintenance." >> "$LOG"

# --- Batch-index memories into LanceDB (infrastructure, not Claire) ---
echo "$(date -Iseconds) [maintenance] Running batch memory indexer..." >> "$LOG"
OPENAI_API_KEY=$(grep '^OPENAI_API_KEY=' "$CLAIRE_DIR/gateway/.env.prod" | cut -d= -f2) \
  CLAIRE_WORKSPACE="$CLAIRE_DIR/workspace" \
  node "$CLAIRE_DIR/mcp-servers/lancedb-memory/dist/batch-index.js" >> "$LOG" 2>&1 || \
  echo "$(date -Iseconds) [maintenance] Batch indexer failed (non-fatal)" >> "$LOG"

# --- Send heartbeat (Claire decides what to do with it) ---
"$CLAIRE_DIR/scripts/claire-heartbeat.sh"

echo "$(date -Iseconds) [maintenance] Complete." >> "$LOG"
