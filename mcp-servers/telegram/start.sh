#!/bin/bash
# Start the Claire Telegram channel MCP server.
# Loads secrets from .env in this directory. See .env.example for required vars.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAIRE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load env vars (TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
else
  echo "[telegram-mcp] Warning: no .env file found at $SCRIPT_DIR/.env" >&2
fi

# Activate venv if present, otherwise use system python
if [ -d "$SCRIPT_DIR/venv" ]; then
  source "$SCRIPT_DIR/venv/bin/activate"
fi

export CLAIRE_WORKSPACE="$CLAIRE_DIR/workspace"
export CLAIRE_SCRIPTS="$CLAIRE_DIR/scripts"

exec python3 "$SCRIPT_DIR/server.py" "$@"
