# Claire Gateway — Engineering Audit

_Prepared by Code (Claire.dev) — 2026-03-23_

---

## 1. Repository Overview

**Project**: claire — An always-on AI assistant running as a persistent Node.js daemon on macOS.

| Area | Path | Description |
|------|------|-------------|
| Gateway | `gateway/` | Core TypeScript daemon (~31 source files, ~8,750 LOC) |
| Workspace | `workspace/` | Claire's live identity & memory files |
| Workspace Template | `workspace-template/` | Template for new instances |
| Docs | `docs/` | Architecture documentation |
| CLI | `cli/` | WebSocket CLI client |
| Scripts | `scripts/` | Utilities (memory testing) |

**Stack**: TypeScript 5.7 (strict mode), ES2022 target, NodeNext modules.

---

## 2. Dependencies

| Package | Version | Role |
|---------|---------|------|
| `@anthropic-ai/sdk` | 0.78.0 | Claude API client |
| `@anthropic-ai/claude-agent-sdk` | 0.2.81 | Agent SDK (self_develop) |
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server |
| `lancedb` | 0.23.0 | Vector memory store |
| `discord.js` | 14.25.1 | Workshop channel adapter |
| `grammy` | 1.39.3 | Telegram bot adapter |
| `openai` | 6.17.0 | Embeddings, TTS/STT |
| `node-cron` | 3.0.3 | Heartbeat scheduling |
| `cheerio` | 1.2.0 | Web scraping |
| `ws` | 8.18.0 | WebSocket server |
| `dotenv` | 17.2.3 | Env config |
| `apache-arrow` | 18.1.0 | LanceDB dependency |

All pinned to specific versions. Build passes clean.

---

## 3. Architecture

### Startup Sequence (`index.ts`)

1. Load env config from `.env.prod`
2. Initialize conversation state from disk
3. Initialize image cache
4. Initialize LanceDB memory store + facts store
5. Start WebSocket server (port 18789)
6. Start MCP server (port 18793)
7. Start webhook HTTP server (port 18790)
8. Start Telegram bot (if configured)
9. Start Discord bot (if configured)
10. Initialize scheduled heartbeats
11. Start hourly heartbeat scheduler
12. Start health monitoring

### Core Design Principle

**Unified event loop**: All events — user messages, heartbeats, scheduled tasks — go through the same `chat()` function in `claude.ts`. Single messages array persists across all channels. Same mind, always.

### Key Modules

| Module | LOC | Responsibility |
|--------|-----|---------------|
| `claude.ts` | 545 | Chat loop, tool execution, model selection |
| `workspace.ts` | 368 | System prompt builder (10-min cache) |
| `conversation-state.ts` | ~200 | Persistent messages array |
| `mcp-server.ts` | 560 | MCP Channel Sense server, OAuth, workspace tools |
| `heartbeat.ts` | ~150 | Cron scheduler, maintenance tasks |
| `channel-registry.ts` | ~100 | Follow-the-sun channel selection |
| `health.ts` | ~100 | Credential health checks |

---

## 4. Code Quality

### Strengths
- **TypeScript strict mode** — `strict: true`, `forceConsistentCasingInFileNames`, declaration maps
- **Consistent error handling** — try-catch in all async paths, graceful degradation
- **Clean separation** — tools, channels, memory each in their own directories
- **Good typing** — proper Anthropic SDK types throughout

### Smells & Risks
- **No atomic writes** — `conversation-state.json` written after each turn; crash between append and persist could lose state
- **Rapid-fire concatenation** — 3-second window in conversation-state could reorder concurrent channel messages
- **Global state** — single messages array shared across Telegram, Discord, CLI, and MCP
- **One TODO** in `memory/store.ts:211` — chunk count tracking incomplete

---

## 5. Tools Inventory

| Tool | File | Purpose |
|------|------|---------|
| `file_read` | tools/files.ts | Read workspace file |
| `file_write` | tools/files.ts | Write workspace file |
| `file_list` | tools/files.ts | List workspace directory |
| `get_time` | tools/files.ts | Current time |
| `getContextUtilization` | tools/files.ts | Context window usage |
| `scheduleHeartbeat` | tools/files.ts | Schedule future heartbeat |
| `listHeartbeats` | tools/files.ts | List scheduled heartbeats |
| `cancelHeartbeat` | tools/files.ts | Cancel a heartbeat |
| `web_fetch` | tools/web.ts | HTTP fetch + HTML→markdown |
| `calendar_list_events` | tools/calendar.ts | Google Calendar read |
| `calendar_create_event` | tools/calendar.ts | Google Calendar write |
| `search_memory` | tools/memory-tools.ts | Vector memory search |
| `update_status` | tools/memory-tools.ts | Update status.json |
| `fetch_image` | tools/image-cache.ts | Cache image (24h TTL) |
| `remember_image` | tools/image-cache.ts | Save image permanently |
| `self_develop` | tools/self-develop.ts | Spawn Claude Code session |
| `send_message` | tools/send-message.ts | Send to Telegram/Discord |

**Registration**: `getAllTools()` in `claude.ts` returns all definitions; `executeTool()` dispatches via switch statement.

**Safety**: `resolveSafePath()` in files.ts prevents directory traversal outside workspace.

---

## 6. Channel Adapters

### Telegram (`channels/telegram.ts`)
- **Library**: grammY v1.39.3
- **Access**: Single owner ID only (private 1:1)
- **Voice**: Incoming OGG → Whisper STT; outgoing TTS via OpenAI (toggleable)
- **Thinking mode**: User commands `show/hide thinking`; preamble stripped before delivery (THINK-LEAK-001 fix)
- **Image handling**: Base64 bytes cached to disk with 24h TTL

### Discord (`channels/discord.ts`)
- **Library**: discord.js v14.25.1
- **Purpose**: Workshop channel — three-way dev room (Sergio + Claire + Code)
- **Routing**: ALL workshop messages go through `chat()` (no mention gate)
- **Self-filtering**: Claire decides whether to respond
- **Message chunking**: Handles Discord's 2000-char limit
- **Gaps**: No voice support, no image handling

### Channel Registry (`channel-registry.ts`)
- Tracks active channels with timestamps
- Follow-the-sun: heartbeat responses sent to most recently active channel

---

## 7. Memory System

**Architecture** (~1,064 LOC in `gateway/src/memory/`):

| Module | Responsibility |
|--------|---------------|
| `store.ts` | LanceDB vector store init, chunk insertion |
| `chunking.ts` | Break conversations into 3-5 turn chunks |
| `embeddings.ts` | OpenAI embeddings, batch processing |
| `retrieval.ts` | Query vector store, format results |
| `facts.ts` | Extract facts from exchanges, semantic search |

**Write path**: After each turn → `storeExchange()` → chunk creation → LanceDB insertion → async fact extraction

**Read path**: On-demand via `search_memory` tool. No automatic memory injection into system prompt.

**Fact categories**: People, Places, Preferences, Decisions, Learnings, Events

**Gaps**:
- Chunk counting incomplete (TODO in store.ts)
- No compaction strategy — vector store grows indefinitely
- Fact extraction is fire-and-forget; failures logged but not retried

---

## 8. MCP Server (Channel Sense)

**Port**: 18793 (prod) / 18794 (dev)
**Transport**: Streamable HTTP

**Auth** (three modes):
1. **Loopback** — Always allowed (checks IP + Host header)
2. **Legacy bearer token** — Static `MCP_AUTH_TOKEN`
3. **OAuth 2.0** — Pre-registered clients

**Exposed tools**:
- `converse(message, channel)` — Route message through Claire
- `converse_with_media(message, mediaBase64, mediaType)` — With image
- `read_workspace(path)` / `write_workspace(path, content)` / `list_workspace(dir)`
- `get_status()` — Read status.json

**Note**: Loopback detection is sophisticated but fragile — checks both socket address and Host header because Tailscale Funnel terminates TLS locally.

---

## 9. Build & Deployment

**Build**: `npm run build` → `tsc` → `dist/`

**launchd** (`claire.gateway.prod.plist`):
- Runs Node.js against `dist/index.js`
- Logs to `~/Library/Logs/claire/gateway.prod.log`
- `KeepAlive` with `SuccessfulExit: false` (auto-restart on crash)
- `ThrottleInterval: 10` (10s cooldown between restarts)
- `RunAtLoad: true`

**Restart**: `npm run restart` — unloads and reloads the plist

---

## 10. Configuration

### Environment Variables (`.env.prod`)

| Category | Variables |
|----------|-----------|
| AI APIs | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID` |
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_WORKSHOP_CHANNEL_ID` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| Ports | `GATEWAY_PORT` (18789), `WEBHOOK_PORT` (18790), `MCP_PORT` (18793) |
| MCP | `MCP_AUTH_TOKEN`, `MCP_PUBLIC_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` |
| Paths | `WORKSPACE_PATH` |

### Workspace Files (Claire's identity)

`SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `MEMORY.md`, `COMPACTION.md`, `THREADS.md`, `DEV-NOTES.md`, `SELF-AWARENESS.md`, `status.json`, `scheduled-heartbeats.json`, `memory/YYYY-MM-DD.md`, `images/`

---

## 11. Test Coverage & CI/CD

**Tests**: None. No `.test.ts` or `.spec.ts` files exist. One utility script (`scripts/test-memory.ts`) for manual memory testing.

**CI/CD**: None configured. No GitHub Actions, no pre-commit hooks. Build-before-commit enforced by convention only.

---

## 12. Security

### Strengths
- TypeScript strict mode
- Path traversal prevention (`resolveSafePath`)
- Single-owner Telegram access control
- Sophisticated OAuth + loopback detection on MCP
- API keys not logged

### Weaknesses
- Credentials in `.env.prod` (committed or at risk of commit)
- No rate limiting on any endpoint
- No encryption at rest for conversation state
- No request signing on MCP
- `self_develop` can execute arbitrary code

**Trust model**: Single-user (Sergio), trusted local network, trusted filesystem. Adequate for personal use; not production-ready for shared deployment.

---

## 13. Model & API Strategy

| Context | Model | Max Tokens |
|---------|-------|------------|
| Conversation | claude-sonnet-4-6 | 4,096 |
| Nightly maintenance | claude-opus-4-6 | 8,192 |
| Compaction | `compact-2026-01-12` beta | triggers at 80k input tokens |

- Tool loop with automatic retry
- Streaming for CLI (WebSocket), non-streaming for background
- Separate message array for maintenance tasks
- System prompt rebuilt every 10 minutes

---

## 14. Gaps & Opportunities

### High Impact
1. **Structured logging** — Replace console.log with pino/winston for observability
2. **Vector store compaction** — Age out chunks older than N days
3. **Input validation** — Enforce Zod schemas across all MCP handlers
4. **Atomic writes** — Write conversation-state.json to temp file, then rename
5. **Test suite** — jest/vitest for tools, memory, conversation state

### Medium Impact
6. **Request deduplication** — Prevent duplicate chunks from rapid retries
7. **Fact extraction retry** — Queue failed extractions for retry
8. **LanceDB health check** — Add to startup and periodic monitoring
9. **Graceful shutdown** — Drain in-flight requests on SIGTERM
10. **Credential management** — Move secrets to keychain or vault

### Nice-to-Have
11. **Metrics dashboard** — Token usage, latency, tool call distribution
12. **Feature flags** — Toggle channels/features without restart
13. **Workspace backup** — Daily snapshot to cloud storage
14. **Discord image handling** — Parity with Telegram
15. **Discord voice** — Voice support in workshop channel

---

## Summary

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Architecture | Strong | Clean unified loop, good separation of concerns |
| Build quality | Excellent | TypeScript strict, zero errors |
| Code quality | Good | Consistent patterns, some sharp edges |
| Deployment | Solid | launchd, auto-restart, log routing |
| Observability | Fair | Health checks exist; no metrics/tracing/structured logging |
| Security | Adequate | For personal single-user; needs hardening for anything shared |
| Testing | Absent | No automated tests |
| Documentation | Good | CLAUDE.md + AGENTS.md + docs/ cover architecture well |

**Maturity**: Pre-production MVP. Clean architecture, working system, good documentation. Needs testing, observability, and security hardening for production readiness.
