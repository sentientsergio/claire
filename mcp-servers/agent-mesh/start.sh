#!/bin/bash
# agent-mesh MCP server (stdio).
# Per-session subprocess, loaded by every code-agent and root via .mcp.json.
#
# Identity is inferred from env vars (set by claire-restart / code-agent.sh):
#   MESH_TITLE       — --remote-control title (e.g. "Claire", "Code engineer")
#                       (legacy ACCORD_TITLE / CLAIRE_SESSION_TITLE also accepted)
#   MESH_ROLE        — "root" or "working" (optional; inferred from title)
#   MESH_LABEL       — short label for this agent (optional; inferred from title)
#   MESH_DATA_DIR    — root for inbox/archive/registry storage
#                       (optional; defaults to legacy workspace/projects/accord/)

MESH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use a co-located venv if present, else system python3.
if [ -x "$MESH_DIR/venv/bin/python3" ]; then
  PYTHON="$MESH_DIR/venv/bin/python3"
else
  PYTHON="python3"
fi

exec "$PYTHON" "$MESH_DIR/server.py"
