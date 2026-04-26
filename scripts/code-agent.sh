#!/bin/bash
# code-agent.sh — Launch a naked Claude Code instance for a skill at a directory.
#
# Usage:
#   code-agent <skill> [<directory>]
#
# The agent identifies as Claude (not Claire). It joins the agent-mesh under
# "Code <skill>" so root (Claire) can dispatch and orchestrate.
#
# Skill resolution (in order):
#   1. ~/.claude/skills/<skill>/SKILL.md exists  → substrate auto-loads it; no extra brief
#   2. <directory>/<skill>.md exists             → --append-system-prompt with its contents (bootstrap mode)
#   3. Neither                                    → launch naked, warn
#
# Ambient injection (orthogonal to skill resolution):
#   If ~/.claude/skills/agent-mesh/SKILL.md exists, its contents are prepended
#   to whatever --append-system-prompt content this script would otherwise pass.
#   Every spawned code-agent gets mesh orientation in their system prompt
#   without the per-skill SKILL.md having to repeat it. If the file is absent,
#   the agent runs without ambient mesh orientation (graceful degradation).
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
  echo "  skill:     identity for agent-mesh (becomes 'Code <skill>'); resolved against ~/.claude/skills/ then <dir>/<skill>.md" >&2
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
AMBIENT_AGENT_MESH_PATH="$HOME/.claude/skills/agent-mesh/SKILL.md"

APPEND_PROMPT_CONTENT=""
SKILL_SOURCE=""

if [ -f "$GLOBAL_SKILL_PATH" ]; then
  SKILL_SOURCE="global ($GLOBAL_SKILL_PATH)"
elif [ -f "$LOCAL_BOOTSTRAP_PATH" ]; then
  SKILL_SOURCE="local bootstrap ($LOCAL_BOOTSTRAP_PATH)"
  APPEND_PROMPT_CONTENT="$(cat "$LOCAL_BOOTSTRAP_PATH")"
else
  SKILL_SOURCE="(none — naked agent; no global skill, no local <skill>.md)"
fi

# Ambient injection: prepend agent-mesh SKILL.md to any --append-system-prompt
# content. Mesh orientation arrives ambient, not per-skill.
AMBIENT_SOURCE=""
if [ -f "$AMBIENT_AGENT_MESH_PATH" ]; then
  AMBIENT_SOURCE="agent-mesh ($AMBIENT_AGENT_MESH_PATH)"
  if [ -n "$APPEND_PROMPT_CONTENT" ]; then
    APPEND_PROMPT_CONTENT="$(cat "$AMBIENT_AGENT_MESH_PATH")

---

$APPEND_PROMPT_CONTENT"
  else
    APPEND_PROMPT_CONTENT="$(cat "$AMBIENT_AGENT_MESH_PATH")"
  fi
else
  AMBIENT_SOURCE="(none — agent-mesh not deployed; agent runs without ambient mesh orientation)"
fi

echo "code-agent: launching Code $SKILL in $TARGET_DIR"
echo "code-agent: skill source: $SKILL_SOURCE"
echo "code-agent: ambient:      $AMBIENT_SOURCE"
cd "$TARGET_DIR" || exit 1

# Identity for the agent mesh (picked up by mcp-servers/agent-mesh/start.sh)
export MESH_TITLE="Code $SKILL"

if [ -n "$APPEND_PROMPT_CONTENT" ]; then
  exec claude \
    --remote-control "Code $SKILL" \
    --dangerously-skip-permissions \
    --strict-mcp-config \
    --mcp-config "$CLAIRE_DIR/mcp-servers/working-chair.mcp.json" \
    --append-system-prompt "$APPEND_PROMPT_CONTENT"
else
  exec claude \
    --remote-control "Code $SKILL" \
    --dangerously-skip-permissions \
    --strict-mcp-config \
    --mcp-config "$CLAIRE_DIR/mcp-servers/working-chair.mcp.json"
fi
