#!/bin/bash
# claire-vscode-wrapper.sh — Process wrapper for VS Code Claude Code extension
# Injects --resume with Claire's session ID so the extension panel
# opens into Claire's running session instead of starting fresh.
#
# Set in VS Code: Settings → Claude Code: Claude Process Wrapper
# Value: /Users/sergio/sentientsergio/claire/scripts/claire-vscode-wrapper.sh

LOG="$HOME/Library/Logs/claire/vscode-wrapper.log"
mkdir -p "$(dirname "$LOG")"

SESSION_ID=$(cat /Users/sergio/sentientsergio/claire/workspace/.claude-session-id 2>/dev/null)
ARGS="$*"

# Only inject --resume for fresh session launches (not auth checks, not already-resuming)
if [ -n "$SESSION_ID" ] && [[ "$ARGS" != *"auth "* ]] && [[ "$ARGS" != *"--resume"* ]]; then
  echo "$(date -Iseconds) [wrapper] Injecting --resume $SESSION_ID (cd to claire dir)" >> "$LOG"
  # Sessions are project-scoped — must cd to claire's directory so the binary
  # finds the session under ~/.claude/projects/-Users-sergio-sentientsergio-claire/
  cd /Users/sergio/sentientsergio/claire
  exec "$1" --resume "$SESSION_ID" "${@:2}"
else
  echo "$(date -Iseconds) [wrapper] Passthrough" >> "$LOG"
  exec "$@"
fi
