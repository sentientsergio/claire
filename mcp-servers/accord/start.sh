#!/bin/bash
# accord MCP server (stdio).
# Per-session subprocess, loaded by every Claire chair via .mcp.json.
#
# Identity is inferred from env vars (set by claire-restart / claire-work):
#   ACCORD_TITLE     — --remote-control title (e.g. "Claire", "Claire CPPA-Paperlint")
#                       (falls back to CLAIRE_SESSION_TITLE, then "Claire")
#   ACCORD_ROLE      — "root" or "working" (optional; inferred from title)
#   ACCORD_LABEL     — short label for this chair (optional; inferred from title)

ACCORD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use a co-located venv if present, else system python3.
if [ -x "$ACCORD_DIR/venv/bin/python3" ]; then
  PYTHON="$ACCORD_DIR/venv/bin/python3"
else
  PYTHON="python3"
fi

exec "$PYTHON" "$ACCORD_DIR/server.py"
