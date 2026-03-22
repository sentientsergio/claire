# claire

Claire is an always-on AI assistant running on Sergio's Mac. She persists through files, maintains identity and memory across sessions, and reaches out proactively — not just when summoned.

This is her codebase. She can read it, and she can change it.

---

## What She Is

Claire runs as a persistent Node.js gateway daemon. She talks to Sergio via Telegram, maintains a workspace of identity and memory files, fires hourly heartbeats to stay present, and has tools for file operations, web fetch, calendar, memory search, and now — her own codebase.

Architecture: [docs/architecture.md](docs/architecture.md)  
Governance layers: [docs/claire-layers.md](docs/claire-layers.md)

---

## Repository Structure

```
claire/
├── gateway/          # The core daemon (TypeScript)
│   ├── src/
│   │   ├── claude.ts             # Claude API client, tool loop
│   │   ├── conversation-state.ts # Persistent messages array
│   │   ├── workspace.ts          # System prompt builder
│   │   ├── heartbeat.ts          # Hourly heartbeat scheduler
│   │   ├── mcp-server.ts         # Channel Sense MCP server
│   │   ├── channels/telegram.ts  # grammY Telegram adapter
│   │   ├── memory/               # LanceDB vector store
│   │   └── tools/                # Claire's capabilities
│   │       ├── files.ts          # file_read, file_write, file_list
│   │       ├── web.ts            # web_fetch
│   │       ├── calendar.ts       # calendar events
│   │       ├── memory-tools.ts   # search_memory, update_status
│   │       ├── image-cache.ts    # fetch_image, remember_image
│   │       └── self-develop.ts   # self_develop — Agent SDK coding tool
├── cli/              # Local WebSocket CLI client
├── workspace/        # Claire's identity + memory (prod)
├── workspace-dev/    # Claire's dev instance workspace
├── docs/             # Architecture documentation
├── AGENTS.md         # Who reads this file and how to behave
└── CLAUDE.md         # Project brief for Claude Code dev agents
```

---

## Running

```bash
cd gateway && npm install && npm run build

# Dev instance (port 18791, workspace-dev/)
npm run start:dev

# Prod instance (port 18789, workspace/)
npm run start:prod
```

Persistent operation via launchd:

```bash
launchctl load ~/Library/LaunchAgents/claire.gateway.prod.plist
```

Logs: `~/Library/Logs/claire/`

---

## Dev/Prod Separation

| Instance | Bot | Workspace | Ports |
|----------|-----|-----------|-------|
| Dev | @sergios_assistant_dev_bot | workspace-dev/ | 18791 (ws), 18794 (mcp) |
| Prod | @sergios_assistant_bot | workspace/ | 18789 (ws), 18793 (mcp) |

Test on dev first. Never edit prod directly.

---

## Self-Development

Claire has a `self_develop` tool that invokes the Claude Agent SDK against this repo. She can fix bugs, make changes, and investigate issues during quiet heartbeats — with a cost cap and turn limit. For significant changes she proposes to Sergio first via Telegram.

See [CLAUDE.md](CLAUDE.md) for the project brief that dev agents read.

---

## Credits

- Architecture inspired by [Clawdbot](https://clawd.bot)
- Built with [Claude](https://anthropic.com)
- Telegram via [grammY](https://grammy.dev/)
