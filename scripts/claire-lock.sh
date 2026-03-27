#!/bin/bash
# claire-lock.sh — File lock wrapper for Claire sessions
# Ensures only one Claude Code process touches the session at a time.
# Usage: ./claire-lock.sh <command> [args...]
# Uses mkdir as an atomic lock — portable across macOS and Linux.

LOCK_DIR="/tmp/claire-session.lock"
LOG="$HOME/Library/Logs/claire/cron.log"

# Attempt to acquire lock (mkdir is atomic)
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Check if the lock is stale (older than 10 minutes)
  if [ -d "$LOCK_DIR" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR") ))
    if [ "$LOCK_AGE" -gt 600 ]; then
      echo "$(date -Iseconds) [lock] Stale lock detected (${LOCK_AGE}s old). Removing." >> "$LOG"
      rmdir "$LOCK_DIR" 2>/dev/null
      mkdir "$LOCK_DIR" 2>/dev/null || { echo "$(date -Iseconds) [lock] Failed to reacquire lock. Skipping." >> "$LOG"; exit 0; }
    else
      echo "$(date -Iseconds) [lock] Another Claire session is running (${LOCK_AGE}s). Skipping." >> "$LOG"
      exit 0
    fi
  fi
fi

# Lock acquired — ensure cleanup on exit
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

# Run the command
"$@"
exit $?
