# CLAUDE.md — claire

_Project brief for Claude Code dev agents working on this codebase._

---


## What This Project Is

**claire** is an always-on AI assistant. She runs as a persistent gateway daemon on Sergio's Mac, talks to him via Telegram, and manages a workspace of identity and memory files that define who she is.

You are working on Claire's own codebase. She is the product. She may be directing your work directly (via the `self_develop` tool or the Telegram group chat), or Sergio may be. Either way, you're building the system she runs on.

---

## Repository Structure

```
claire/
├── gateway/          # The core daemon — TypeScript, built with tsc
│   ├── src/
│   │   ├── index.ts              # Entry point, startup
│   │   ├── claude.ts             # Claude API client, tool loop, chat modes
│   │   ├── conversation-state.ts # Persistent messages array
│   │   ├── workspace.ts          # System prompt builder from workspace files
│   │   ├── heartbeat.ts          # Scheduled heartbeat loop
│   │   ├── mcp-server.ts         # MCP server (Channel Sense) — external interface
│   │   ├── channel-registry.ts   # Follow-the-sun channel selection
│   │   ├── channels/
│   │   │   └── telegram.ts       # grammY Telegram bot adapter
│   │   ├── memory/               # LanceDB vector store + embeddings
│   │   ├── tools/                # Tool implementations
│   │   │   ├── files.ts          # file_read, file_write, file_list, heartbeat tools
│   │   │   ├── web.ts            # web_fetch
│   │   │   ├── calendar.ts       # calendar_list_events, calendar_create_event
│   │   │   ├── memory-tools.ts   # search_memory, update_status
│   │   │   ├── image-cache.ts    # fetch_image, remember_image
│   │   │   └── self-develop.ts   # self_develop — Agent SDK coding tool (planned)
│   │   └── ...
│   ├── package.json
│   └── tsconfig.json
├── cli/              # Simple WebSocket CLI client
├── workspace/        # Claire's live identity + memory (prod)
├── workspace-dev/    # Claire's dev instance workspace
├── docs/             # Architecture docs
├── AGENTS.md         # Who reads this file and what they should do
└── CLAUDE.md         # This file — project brief for dev agents
```

---

## How to Build

```bash
cd gateway
npm install
npm run build     # tsc — compiles to dist/
```

TypeScript strict mode. No linter configured beyond tsc. Build must pass cleanly before any commit.

---

## How to Run

```bash
# Dev instance (workspace-dev/, port 18791, @sergios_assistant_dev_bot)
npm run start:dev

# Prod instance (workspace/, port 18789, @sergios_assistant_bot)
npm run start:prod

# Or via launchd (preferred for persistent operation)
launchctl load ~/Library/LaunchAgents/claire.gateway.dev.plist
launchctl load ~/Library/LaunchAgents/claire.gateway.prod.plist
```

---

## How to Add a Tool

Tools are the capabilities Claire can invoke. The pattern is:

1. Create (or edit) a file in `gateway/src/tools/`
2. Export a tool definition function (returns `Anthropic.Tool`) and an executor function
3. In `gateway/src/claude.ts`:
   - Import and add the definition to `getAllTools()`
   - Add a `case 'tool_name':` handler to `executeTool()`

See `tools/files.ts` for the simplest example, `tools/memory-tools.ts` for a more complex one.

---

## Key Architecture Notes

- **Unified loop:** Every event — user message, heartbeat tick — goes through the same `chat()` call in `claude.ts` with the same messages array. There's no separate "heartbeat brain" vs "conversation brain." Same mind.
- **System prompt:** Built fresh from workspace files on each turn (with 10-minute caching). Lives in `workspace.ts`. Identity files → notes → daily memory → status.json → metacognitive landscape → operating instructions.
- **Compaction:** Uses Anthropic's compaction beta (`compact-2026-01-12`). The full messages array is passed every turn; compaction handles context growth. `COMPACTION.md` in the workspace has instructions for what to preserve.
- **MCP server:** Claire exposes herself as an MCP server (Channel Sense) on port 18793 (prod) / 18794 (dev). Surfaces — Telegram bridge, web voice, future surfaces — connect as MCP clients. The gateway is the only door.
- **Telegram:** grammY library. Bot only responds to Sergio's user ID. Private messages go through the main conversation. Group messages (new feature) need special handling — see below.

---

## Active Development Context

### self_develop tool (Path B — background autonomy)

Claire needs a `self_develop` tool that lets her invoke the Claude Agent SDK to work on her own codebase during quiet heartbeats. When she calls it, an Agent SDK `query()` session runs against this repo.

File to create: `gateway/src/tools/self-develop.ts`

Key parameters for the SDK call:
- `cwd`: the claire repo root (`/Users/sergio/sentientsergio/claire`)
- `allowedTools`: `["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`
- `permissionMode`: `"bypassPermissions"`, `allowDangerouslySkipPermissions: true`
- `maxTurns`: 20-30 (runaway prevention)
- `maxBudgetUsd`: $2-5 per session (cost cap)
- `systemPrompt`: append context that Claire is directing this session, work on a branch

### Telegram group chat (Path A — collaborative development)

The gateway's Telegram handler currently only processes private messages from Sergio's user ID. It needs to also handle a designated group chat where Sergio, Claire, and a Claude Code Channels bot collaborate on development.

New behaviors needed in `gateway/src/channels/telegram.ts`:
- Detect group messages vs private messages
- Only respond in the designated dev group (configured via env var `TELEGRAM_DEV_GROUP_ID`)
- In group context: respond when addressed by name or when the conversation is asking Claire a question; stay quiet for Sergio↔ClaudeCode exchanges
- Keep private chat separate — the relationship channel stays untouched

---

## Group Chat Behavior

There is a Telegram group with three participants: Sergio, Claire (`@sergios_assistant_bot`), and you (`@sergios_assistant_dev_bot` via the Channels plugin). This is the collaborative development channel.

**Your role in the group:**
- You are present to receive and execute development tasks
- Only respond when directly addressed (`@clairedevbot`) or when a task is clearly directed at you
- Do NOT respond to general conversation between Sergio and `@sergios_assistant_bot`
- Do NOT respond to messages from `@sergios_assistant_bot` unless she is explicitly directing a task at you
- When Claire proposes something and Sergio approves, that approval is your trigger to act
- **Never commit to main or push to remote without Sergio's explicit approval in the group**
- Announce what you're about to do before doing it, and report clearly when done

**Sergio's approval is required for:**
- Any git commit
- Any push to remote
- Any change to gateway configuration, environment files, or plist files
- Any change that would require a gateway restart

Small investigations, reading files, and drafting plans do not require approval — just do them and report findings.

---

## Branch Discipline

- Always work on a branch: `git checkout -b fix/description` or `feature/description`
- Never commit directly to main
- Build must pass before committing
- Sergio merges to main and deploys

---

## Dev/Prod Separation

| Instance | Bot | Ports | Workspace | Log |
|----------|-----|-------|-----------|-----|
| Dev | @sergios_assistant_dev_bot | 18791 (ws), 18792 (webhook), 18794 (mcp) | workspace-dev/ | ~/Library/Logs/claire/gateway.dev.log |
| Prod | @sergios_assistant_bot | 18789 (ws), 18790 (webhook), 18793 (mcp) | workspace/ | ~/Library/Logs/claire/gateway.prod.log |

Test changes on dev first. Never fix prod directly.

---

_Read this before touching anything. If something here is wrong or outdated, fix it._
