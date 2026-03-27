#!/bin/bash
# claire-maintenance.sh — Nightly maintenance for Claire
# Called by cron: 0 21 * * *

CLAIRE_DIR="/Users/sergio/sentientsergio/claire"
SESSION_FILE="$CLAIRE_DIR/workspace/.claude-session-id"
LOG="$HOME/Library/Logs/claire/cron.log"
CLAUDE_BIN="$HOME/.local/bin/claude"

mkdir -p "$(dirname "$LOG")"

# Read session ID
if [ ! -f "$SESSION_FILE" ]; then
  echo "$(date -Iseconds) [maintenance] No session file. Skipping." >> "$LOG"
  exit 0
fi

SESSION_ID=$(cat "$SESSION_FILE")
if [ -z "$SESSION_ID" ]; then
  echo "$(date -Iseconds) [maintenance] Empty session ID. Skipping." >> "$LOG"
  exit 0
fi

echo "$(date -Iseconds) [maintenance] Starting nightly maintenance." >> "$LOG"

cd "$CLAIRE_DIR"
"$CLAIRE_DIR/scripts/claire-lock.sh" \
  "$CLAUDE_BIN" --resume "$SESSION_ID" \
  -p "Nightly maintenance." \
  --dangerously-skip-permissions \
  2>> "$LOG"

echo "$(date -Iseconds) [maintenance] Complete." >> "$LOG"
