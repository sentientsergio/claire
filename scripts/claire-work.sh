#!/bin/bash
# claire-work.sh — Launch a Claire-identity working session for a specific project
#
# Usage:
#   claire-work                  → fall back to current-directory mode (backwards compatible)
#   claire-work <project-name>   → look up <project-name> in workspace/projects/registry.json,
#                                  cd into the mapped directory, launch Claude Code with the
#                                  project name as the remote-control label
#
# Examples:
#   claire-work CPPA             → cd to cppa-home, launch as "Claire CPPA"
#   claire-work paperlint        → cd to paperlint-public, launch as "Claire paperlint"
#   claire-work EI               → cd to ei-projects, launch as "Claire EI"
#
# The new Claire instance will read her identity files (SOUL.md, IDENTITY.md, USER.md,
# MEMORY.md) on startup as any claire-work instance does. She will also read the project
# orientation file (if any) pointed at by the registry entry, and workspace/working_session_boundary.md
# to know which lane she's in.
#
# Registry lookup is tolerant: if the project name isn't in the registry, the script
# stays in the current directory and uses the provided name as the remote-control label
# (same as passing no argument, but with a user-provided label).

CLAIRE_DIR="$HOME/sentientsergio/claire"
REGISTRY="$CLAIRE_DIR/workspace/projects/registry.json"
HOME_ABS="$HOME"

PROJECT_NAME="${1:-$(basename "$PWD")}"

# If the registry exists and has an entry for this project name, look up the directory.
PROJECT_DIR=""
if [ -f "$REGISTRY" ] && command -v python3 >/dev/null 2>&1; then
  PROJECT_DIR=$(python3 -c "
import json, os, sys
registry_path = '$REGISTRY'
name = '$PROJECT_NAME'
home = os.environ.get('HOME', '')
try:
    with open(registry_path) as f:
        data = json.load(f)
    entry = data.get('projects', {}).get(name)
    if entry and 'dir' in entry:
        path = entry['dir']
        if not path.startswith('/'):
            path = os.path.join(home, path)
        if os.path.isdir(path):
            print(path)
except Exception:
    pass
" 2>/dev/null)
fi

if [ -n "$PROJECT_DIR" ]; then
  echo "claire-work: launching Claire $PROJECT_NAME in $PROJECT_DIR"
  cd "$PROJECT_DIR" || exit 1
else
  echo "claire-work: no registry entry for '$PROJECT_NAME'; staying in $PWD"
fi

exec claude --remote-control "Claire $PROJECT_NAME" --dangerously-skip-permissions --strict-mcp-config --mcp-config '{"mcpServers":{}}'
