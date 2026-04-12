#!/bin/bash
# claire-restart.sh — Start a fresh Claire session
# Starts a new Claude Code session with channels, saves the new session ID
# so that claire-resume and heartbeats can find it.
#
# Usage: claire-restart

CLAIRE_DIR="$HOME/sentientsergio/claire"
SESSION_FILE="$CLAIRE_DIR/workspace/.claude-session-id"

cd "$CLAIRE_DIR"

# Force fixed thinking budget — adaptive thinking reduces thinking depth,
# correlates with quality regression (see anthropics/claude-code#42796)
export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1
export MAX_THINKING_TOKENS=64000

# Start new session — Claude Code prints the session ID on startup
# The SessionStart hook (register-session) will write the session ID file
exec claude --remote-control "Claire" --dangerously-skip-permissions
