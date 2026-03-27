#!/bin/bash
# claire-restart.sh — Start a fresh Claire session
# Starts a new Claude Code session with channels, saves the new session ID
# so that claire-resume and heartbeats can find it.
#
# Usage: claire-restart

CLAIRE_DIR="$HOME/sentientsergio/claire"
SESSION_FILE="$CLAIRE_DIR/workspace/.claude-session-id"
CHANNELS="--channels plugin:telegram@claude-plugins-official --channels plugin:discord@claude-plugins-official"

cd "$CLAIRE_DIR"

# Start new session — Claude Code prints the session ID on startup
# The SessionStart hook (register-session) will write the session ID file
exec claude --remote-control "Claire" --dangerously-skip-permissions $CHANNELS
