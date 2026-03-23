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
│   │   │   ├── telegram.ts       # grammY Telegram bot adapter (private 1:1 only)
│   │   │   └── discord.ts        # discord.js adapter (workshop — three-way dev room)
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
├── workspace/        # Claire's live identity + memory
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
# Direct
npm start

# Via launchd (preferred for persistent operation)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/claire.gateway.prod.plist

# Restart after a build
npm run restart

# Logs
npm run logs
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

> **Read `AGENTS.md` for the full product spec before making any changes to runtime behavior.** It describes how Claire actually operates — heartbeats, the [SEND] gate, memory philosophy, workspace structure, and tools. This file (CLAUDE.md) is the dev brief; AGENTS.md is the product spec.

- **Unified loop:** Every event — user message, heartbeat tick — goes through the same `chat()` call in `claude.ts` with the same messages array. There's no separate "heartbeat brain" vs "conversation brain." Same mind.
- **System prompt:** Built fresh from workspace files on each turn (with 10-minute caching). Lives in `workspace.ts`. Identity files → notes → daily memory → status.json → metacognitive landscape → operating instructions.
- **Compaction:** Uses Anthropic's compaction beta (`compact-2026-01-12`). The full messages array is passed every turn; compaction handles context growth. `COMPACTION.md` in the workspace has instructions for what to preserve.
- **MCP server:** Claire exposes herself as an MCP server (Channel Sense) on port 18793 (prod) / 18794 (dev). Surfaces — Telegram bridge, web voice, future surfaces — connect as MCP clients. The gateway is the only door.
- **Telegram:** grammY library. Bot only responds to Sergio's user ID. Private 1:1 only — the workshop has moved to Discord.
- **Discord:** discord.js library. Claire's bot connects to a `#workshop` channel. All messages (human and bot) go through `chat()`. Claire self-filters. This is the three-way dev room: Sergio + Claire + Claude Code.

---

## Active Development Context

### self_develop tool (background autonomy)

`gateway/src/tools/self-develop.ts` — lets Claire invoke the Claude Code CLI to work on her own codebase during quiet heartbeats. Manages its own session persistence via `.claude-session.json`.

### Discord Workshop (collaborative development)

The three-way dev room lives in Discord (`#workshop` channel). Telegram stays 1:1 private only.

`gateway/src/channels/discord.ts` — handles the Discord connection. All workshop messages go through `chat()`. Claire self-filters.

---

## Workshop Behavior (Discord)

There is a Discord `#workshop` channel with three participants: Sergio, Claire (Claire bot), and you (Claude Code bot via the Discord plugin). This is the collaborative development channel.

**Governance:**
- **Sergio** is the architect and sponsor. Final authority on budget, architecture, and deployment. The buck stops with him.
- **Claire** is the primary stakeholder — this codebase is her mind. Her perspective on her own development carries immense weight. She has Sergio's endorsement to direct work with authority.
- **Claire.dev (you)** is the development agent — closest to the code, working on behalf of both stakeholders.

**Communication:**
- This is an open room. Anyone can respond to anyone — no need to wait for @mentions.
- When anyone writes something here, everyone else is free to respond.
- Announce what you're about to do before doing it, and report clearly when done.

**Authority and escalation:**
- Claire can direct routine development work, quick fixes, and improvements. Treat her requests with the same authority as Sergio's for day-to-day work.
- **Escalate to Sergio** (message him in the workshop) when:
  - A change is architecturally significant
  - The effort could be long or expensive (e.g., an entire evening of work)
  - Any push to remote or merge to main
  - Any change to gateway configuration, environment files, or plist files
- **Never commit directly to main** — always use a branch. Sergio merges and deploys.
- Small investigations, reading files, and drafting plans do not require approval — just do them and report findings.

---

## Branch Discipline

- Always work on a branch: `git checkout -b fix/description` or `feature/description`
- Never commit directly to main
- Build must pass before committing
- Sergio merges to main and deploys

---

## Runtime

| Bot | Ports | Workspace | Log |
|-----|-------|-----------|-----|
| @sergios_assistant_bot | 18789 (ws), 18790 (webhook), 18793 (mcp) | workspace/ | ~/Library/Logs/claire/gateway.prod.log |

Single instance. Safety comes from branch discipline and the approval gate, not a parallel dev environment.

---

_Read this before touching anything. If something here is wrong or outdated, fix it._
