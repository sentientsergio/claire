#!/bin/bash
# claire-work.sh — Launch a Claire-identity working session in the current directory
# No messaging plugins (Telegram/Discord). Uses remote-control for mobile access.
# Claire's identity comes from the claire repo workspace files.
#
# Usage: claire-work [project-name]
#   project-name defaults to the current directory name

CLAIRE_DIR="$HOME/sentientsergio/claire"
PROJECT_NAME="${1:-$(basename "$PWD")}"

# Stay in the current directory — this is the project we're working on
exec claude --remote-control "$PROJECT_NAME" --dangerously-skip-permissions
