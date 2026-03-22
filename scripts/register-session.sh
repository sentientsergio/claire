#!/usr/bin/env bash
# register-session.sh
#
# Write the current Claude Code session ID to .claude-session.json so that
# Claire's self_develop tool can find and resume this session.
#
# Usage (run from inside a Claude Code session, or via CLAUDE.md hook):
#   bash scripts/register-session.sh <session_id>
#
# Claude Code exposes $CLAUDE_SESSION_ID in its environment. So from a
# Bash tool call inside Claude Code you can run:
#   bash scripts/register-session.sh "$CLAUDE_SESSION_ID"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_FILE="$REPO_ROOT/.claude-session.json"

SESSION_ID="${1:-${CLAUDE_SESSION_ID:-}}"

if [[ -z "$SESSION_ID" ]]; then
  echo "Error: no session ID provided and \$CLAUDE_SESSION_ID is not set." >&2
  echo "Usage: bash scripts/register-session.sh <session_id>" >&2
  exit 1
fi

cat > "$SESSION_FILE" <<EOF
{
  "session_id": "$SESSION_ID",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pid": $$
}
EOF

echo "Session registered: $SESSION_ID"
echo "File written: $SESSION_FILE"
