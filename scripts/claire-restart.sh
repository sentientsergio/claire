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

# Kill orphaned bun plugin processes from any previous session
# These are Telegram/Discord plugin servers that survive after Claude exits
echo "Cleaning up orphaned plugin processes..."
pkill -f "bun.*plugins.*(telegram|discord)" 2>/dev/null && sleep 1
# Force kill any that ignored SIGTERM
pkill -9 -f "bun.*plugins.*(telegram|discord)" 2>/dev/null

# Start new session — Claude Code prints the session ID on startup
# The SessionStart hook (register-session) will write the session ID file
exec claude --remote-control "Claire" --dangerously-skip-permissions $CHANNELS
