#!/bin/bash
# claire-work.sh — Launch a Claire-identity working session for a project directory
#
# Usage:
#   claire-work [<directory-or-name>] [--label <label>]
#
# The first positional argument is interpreted as:
#   1. A directory path (absolute, relative, or `.`) — preferred
#   2. A registry entry name (looked up in workspace/projects/registry.json) — legacy fallback
#   3. If neither: error
#
# If no positional argument is given: use the current directory.
# The label defaults to the directory's basename. Use --label to override.
#
# Examples:
#   claire-work                              → cwd, label = basename(cwd)
#   claire-work .                            → cwd, label = basename(cwd)
#   claire-work ~/sentientsergio/agora21     → cd there, label = "agora21"
#   claire-work paperlint-public             → if ./paperlint-public exists, cd; else registry lookup
#   claire-work CPPA                         → registry entry "CPPA" → cd to cppa-home, label = "CPPA"
#   claire-work . --label cppa-invoicing     → cwd, label = "cppa-invoicing"
#
# The Claire identity, the project orientation lookup at workspace/projects/<label>.md,
# and the working_session_boundary contract are unchanged from previous behavior.
# A directory IS the unit of a chair; the registry is annotation, not gating.

CLAIRE_DIR="$HOME/sentientsergio/claire"
REGISTRY="$CLAIRE_DIR/workspace/projects/registry.json"

LABEL=""
POSITIONAL=""

# --- Parse args ---
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      LABEL="$2"
      shift 2
      ;;
    --label=*)
      LABEL="${1#--label=}"
      shift
      ;;
    -h|--help)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *)
      if [ -z "$POSITIONAL" ]; then
        POSITIONAL="$1"
      else
        echo "claire-work: unexpected extra argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

# --- Resolve target directory ---
TARGET_DIR=""

if [ -z "$POSITIONAL" ]; then
  TARGET_DIR="$PWD"
elif [ -d "$POSITIONAL" ]; then
  # Absolute or relative directory path
  TARGET_DIR="$(cd "$POSITIONAL" && pwd)"
else
  # Try registry lookup (legacy named-entry behavior)
  if [ -f "$REGISTRY" ] && command -v python3 >/dev/null 2>&1; then
    REGISTRY_DIR=$(python3 -c "
import json, os
try:
    with open('$REGISTRY') as f:
        data = json.load(f)
    entry = data.get('projects', {}).get('$POSITIONAL')
    if entry and 'dir' in entry:
        path = entry['dir']
        if not path.startswith('/'):
            path = os.path.join(os.environ.get('HOME', ''), path)
        if os.path.isdir(path):
            print(path)
except Exception:
    pass
" 2>/dev/null)
    if [ -n "$REGISTRY_DIR" ]; then
      TARGET_DIR="$REGISTRY_DIR"
      # If --label was not explicitly set, use the registry name as the label
      [ -z "$LABEL" ] && LABEL="$POSITIONAL"
    fi
  fi

  if [ -z "$TARGET_DIR" ]; then
    echo "claire-work: '$POSITIONAL' is neither a directory nor a registry entry" >&2
    echo "  registry: $REGISTRY" >&2
    exit 1
  fi
fi

# Default label to basename of target directory
[ -z "$LABEL" ] && LABEL="$(basename "$TARGET_DIR")"

echo "claire-work: launching Claire $LABEL in $TARGET_DIR"
cd "$TARGET_DIR" || exit 1

exec claude --remote-control "Claire $LABEL" --dangerously-skip-permissions --strict-mcp-config --mcp-config '{"mcpServers":{}}'
