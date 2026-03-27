#!/bin/bash
# claire-resume.sh — Resume Claire's current session in any terminal
# Reads the session ID saved by claire-restart/SessionStart hook
# and resumes that session. Same mind, new window.
#
# Usage: claire-resume

CLAIRE_DIR="$HOME/sentientsergio/claire"
SESSION_FILE="$CLAIRE_DIR/workspace/.claude-session-id"
CHANNELS="--channels plugin:telegram@claude-plugins-official --channels plugin:discord@claude-plugins-official"

cd "$CLAIRE_DIR"

# Read session ID
if [ ! -f "$SESSION_FILE" ]; then
  echo "No session file found at $SESSION_FILE"
  echo "Run claire-restart first to start a new session."
  exit 1
fi

SESSION_ID=$(cat "$SESSION_FILE")
if [ -z "$SESSION_ID" ]; then
  echo "Session file is empty. Run claire-restart first."
  exit 1
fi

echo "Resuming Claire session: ${SESSION_ID:0:8}..."
exec claude --resume "$SESSION_ID" --remote-control "Claire" --dangerously-skip-permissions $CHANNELS
