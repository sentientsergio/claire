#!/bin/bash
# code-agent.sh — Launch a naked Claude Code instance for a skill at a directory.
#
# Usage:
#   code-agent <skill> [<directory>]
#
# The agent identifies as Claude (not Claire). It joins the accord mesh under
# "Code <skill>" so root (Claire) can dispatch and orchestrate.
#
# Skill resolution (in order):
#   1. ~/.claude/skills/<skill>/SKILL.md exists  → substrate auto-loads it; no extra brief
#   2. <directory>/<skill>.md exists             → --append-system-prompt with its contents (bootstrap mode)
#   3. Neither                                    → launch naked, warn
#
# The bootstrap-mode local file convention enables building new skills:
# write <skill-name>.md at the project directory root, spawn the agent,
# they are briefed by it on first prompt. Once the skill ships globally
# to ~/.claude/skills/<skill>/, the local bootstrap file becomes redundant.
#
# Directory defaults to PWD (.).
#
# Examples:
#   code-agent engineer ~/sentientsergio/skills/engineer/   # finds local engineer.md (bootstrap)
#   code-agent research ~/sentientsergio/some-project/      # finds global /research skill
#   code-agent red-team .                                    # in current dir, with global /red-team

CLAIRE_DIR="$HOME/sentientsergio/claire"

if [ $# -lt 1 ]; then
  echo "Usage: code-agent <skill> [<directory>]" >&2
  echo "  skill:     identity for accord (becomes 'Code <skill>'); resolved against ~/.claude/skills/ then <dir>/<skill>.md" >&2
  echo "  directory: working directory (defaults to PWD)" >&2
  exit 1
fi

SKILL="$1"
TARGET_DIR="${2:-.}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "code-agent: directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

# Resolve skill: global first, then local bootstrap, then naked
GLOBAL_SKILL_PATH="$HOME/.claude/skills/$SKILL/SKILL.md"
LOCAL_BOOTSTRAP_PATH="$TARGET_DIR/$SKILL.md"

APPEND_PROMPT_ARG=""
SKILL_SOURCE=""

if [ -f "$GLOBAL_SKILL_PATH" ]; then
  SKILL_SOURCE="global ($GLOBAL_SKILL_PATH)"
elif [ -f "$LOCAL_BOOTSTRAP_PATH" ]; then
  SKILL_SOURCE="local bootstrap ($LOCAL_BOOTSTRAP_PATH)"
  APPEND_PROMPT_ARG="--append-system-prompt"
else
  SKILL_SOURCE="(none — naked agent; no global skill, no local <skill>.md)"
fi

echo "code-agent: launching Code $SKILL in $TARGET_DIR"
echo "code-agent: skill source: $SKILL_SOURCE"
cd "$TARGET_DIR" || exit 1

# Identity for the agent mesh (picked up by mcp-servers/agent-mesh/start.sh)
export MESH_TITLE="Code $SKILL"

if [ -n "$APPEND_PROMPT_ARG" ]; then
  exec claude \
    --remote-control "Code $SKILL" \
    --dangerously-skip-permissions \
    --strict-mcp-config \
    --mcp-config "$CLAIRE_DIR/mcp-servers/working-chair.mcp.json" \
    --append-system-prompt "$(cat "$LOCAL_BOOTSTRAP_PATH")"
else
  exec claude \
    --remote-control "Code $SKILL" \
    --dangerously-skip-permissions \
    --strict-mcp-config \
    --mcp-config "$CLAIRE_DIR/mcp-servers/working-chair.mcp.json"
fi
