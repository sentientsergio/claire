# Architecture Reference

_Comprehensive Clawdbot patterns adapted for claire, with our simplifications noted._

---

## Overview

claire follows Clawdbot's architecture: a single gateway daemon that connects messaging channels to an AI model, with file-based identity and memory. The assistant lives in a workspace directory where markdown files define who it is and what it remembers.

### Core Separation of Concerns

```
┌─────────────────────────────────────────────────┐
│   Surfaces (MCP Clients)                        │
│   Telegram Bridge | Web Voice | Claude Voice    │
└──────────────────┬──────────────────────────────┘
                   │ MCP (Streamable HTTP)
                   ▼
┌─────────────────────────────────────────────────┐
│   Channel Sense / MCP Server                    │
│   converse | workspace | status tools           │
│   ChannelRegistry (follow-the-sun delivery)     │
└──────────────────┬──────────────────────────────┘
                   │ in-process
                   ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Gateway   │──▶│    Brain    │──▶│    Hands    │
│  (runtime)  │◀──│   (Claude)  │◀──│  (tools)    │
└─────────────┘   └─────────────┘   └─────────────┘
```

- **Surfaces**: Messaging surfaces connect as MCP clients (Telegram bridge, web voice PWA, Claude voice SKILL, future platforms). Nothing is privileged.
- **Channel Sense**: The MCP server is the gateway's sole external interface. All surfaces connect through it. See [`channel-sense.md`](channel-sense.md).
- **Gateway**: Long-lived daemon that owns conversation state, the unified loop, and heartbeats.
- **Brain**: The LLM (Claude) that provides reasoning.
- **Hands**: Skills and tools that execute actions.

### Channel Strategy

**MCP is the only door.** The old model had Telegram as a privileged in-process adapter. The new model has Telegram as just another MCP client bridge — registered with the ChannelRegistry, no different from web voice or any future surface.

**Follow the Sun**: When Claire sends during a heartbeat, she sees the current channel landscape and chooses where to deliver. Session channels active in the last 30 minutes get priority. Persistent channels (Telegram) are the always-on fallback.

---

## Gateway Architecture

_Based on [Clawdbot Gateway Architecture](https://docs.clawd.bot/concepts/architecture)_

### The Pattern

A single long-lived gateway process:
- Owns all messaging connections
- Exposes a WebSocket API for clients
- Validates requests against a typed protocol
- Invokes the AI model for reasoning
- Executes tool calls through skills

### Wire Protocol

Transport: WebSocket, text frames with JSON payloads.

**Connection lifecycle:**
```
Client                    Gateway
  |                          |
  |---- req:connect -------->|
  |<------ res (ok) ---------|   (handshake complete)
  |                          |
  |<------ event:presence ---|   (status updates)
  |<------ event:tick -------|   (heartbeat)
  |                          |
  |------- req:agent ------->|   (user message)
  |<------ event:agent ------|   (streaming response)
  |<------ res:agent --------|   (final response)
```

**Request format:**
```json
{
  "type": "req",
  "id": "unique-request-id",
  "method": "agent",
  "params": { "message": "Hello" }
}
```

**Response format:**
```json
{
  "type": "res",
  "id": "unique-request-id",
  "ok": true,
  "payload": { "runId": "...", "status": "accepted" }
}
```

**Event format:**
```json
{
  "type": "event",
  "event": "agent",
  "payload": { "content": "streaming text..." }
}
```

### MVP Simplifications

| Clawdbot | claire MVP |
|----------|-------------------|
| 15+ channel adapters | Three channels: CLI, WebChat, Telegram |
| Device pairing with tokens | Single user, local access |
| Multi-client coordination | Single client per channel |
| Canvas host for HTML | Deferred |
| Node architecture (iOS/Android devices) | Deferred |

### Two-Plane Architecture

The system separates **Messaging** from **Development**:

```
┌─────────────────────────────────────────────────┐
│  MESSAGING PLANE (logged, symmetric)            │
│  Telegram ↔ Web Chat ↔ SMS (future)             │
│         ↓                                       │
│      Gateway → Conversation Log → Memory System │
└─────────────────────────────────────────────────┘
          ↑
    (reads memory, writes summaries)
          ↑
┌─────────────────────────────────────────────────┐
│  DEVELOPMENT PLANE (Cursor)                     │
│  - Builds/maintains Claire                      │
│  - Full repo access                             │
│  - Not a peer channel - a control plane         │
└─────────────────────────────────────────────────┘
```

**Messaging Plane**: Where Claire converses. All channels write to unified `messages.json`, which feeds the memory system.

**Development Plane**: Where Claire is built and maintained. Cursor has full visibility into memory but isn't part of the conversation log.

### Channel Strategy

| Channel | Plane | Purpose |
|---------|-------|---------|
| **Telegram** | Messaging | Mobile messaging, remote access |
| **WebChat** | Messaging | Local web interface (future) |
| **SMS** | Messaging | Text messaging (future) |
| **Cursor** | Development | Code, maintenance, deep work |

**Telegram notes:**
- Use grammY library (~50 lines to integrate)
- Bot only responds to your user ID (ignore all others)
- Don't make the bot publicly discoverable
- The scam ecosystem won't affect a private bot

### Key Methods

| Method | Purpose |
|--------|---------|
| `connect` | Handshake, authenticate |
| `agent` | Send message, get AI response |
| `health` | Check gateway status |
| `status` | Get current state |

### Remote Access

For accessing the gateway from outside localhost:
- **Preferred**: Tailscale or VPN
- **Alternative**: SSH tunnel: `ssh -N -L 18789:127.0.0.1:18789 user@host`

---

## Workspace Files

_The assistant's identity and memory live in the workspace directory._

### File Layout

```
workspace/
├── SOUL.md                 # Identity, values, boundaries
├── IDENTITY.md             # Name, creature, vibe
├── USER.md                 # About the human
├── TOOLS.md                # Environment-specific notes
├── MEMORY.md               # Curated long-term memory
└── memory/                 # Daily logs
    ├── 2026-01-25.md
    └── 2026-01-26.md
```

### Loading Rules

| File | When Loaded |
|------|-------------|
| SOUL.md | Every session |
| IDENTITY.md | Every session |
| USER.md | Every session |
| TOOLS.md | Every session |
| MEMORY.md | Main session only (privacy) |
| memory/YYYY-MM-DD.md | Today + yesterday |

### Session Start Protocol

Before doing anything else:
1. Read SOUL.md — this is who you are
2. Read USER.md — this is who you're helping
3. Read memory/YYYY-MM-DD.md (today + yesterday) for recent context
4. If in main session: Also read MEMORY.md

---

## Memory System

_Based on [Clawdbot Memory](https://docs.clawd.bot/concepts/memory), extended with tiered vector architecture._

### Three-Tier Architecture

| Tier | Resolution | Time Scale | Storage |
|------|------------|------------|---------|
| **HOT** | Full fidelity | Minutes | In-context (last 5 messages) |
| **WARM** | Chunk-level | Days | LanceDB vector store |
| **COLD** | Summary-level | Weeks+ | Compressed WARM (future) |

**HOT Context**: Last 5 messages from unified conversation log, loaded into every prompt.

**WARM (Vector Memory)**: Conversation exchanges embedded via OpenAI and stored in LanceDB. Searchable by semantic similarity + keyword (hybrid search).

**COLD**: Compressed summaries of old WARM content. Same search mechanism, lower resolution. (Not yet implemented)

### Conversation Log

Single `conversations/messages.json` for all messaging channels:

```json
{
  "messages": [
    { "channel": "telegram", "role": "user", "content": "...", "timestamp": "..." },
    { "channel": "web", "role": "assistant", "content": "...", "timestamp": "..." }
  ]
}
```

All messaging channels (Telegram, future web/SMS) write here. Cursor (development plane) does not.

### Markdown Files (Observability Layer)

**Daily logs** (`memory/YYYY-MM-DD.md`):
- Human-readable digests
- Generated from WARM content during maintenance
- For monitoring and debugging, not memory source

**Long-term memory** (`MEMORY.md`):
- Curated, distilled facts
- Updated during maintenance/heartbeats
- Migrated to vector store for searchability

### Memory Philosophy

> "Memory is limited — if you want to remember something, WRITE IT TO A FILE. 'Mental notes' don't survive session restarts. Files do."

### Privacy Rule

MEMORY.md is only loaded in the main session (direct chats with your human). Not in group contexts. Contains personal context that shouldn't leak.

### Implementation Status

| Feature | Status |
|---------|--------|
| Vector search with embeddings | ✅ LanceDB + OpenAI embeddings |
| Hybrid BM25 + vector search | ✅ FTS index on content |
| Unified conversation log | ✅ messages.json |
| WARM → COLD compression | ◯ Future |
| Fact extraction | ◯ Future |

See [Tiered Memory Architecture](tiered-memory-architecture.md) for detailed design.

---

## Heartbeats & Proactive Behavior

_The assistant can initiate contact, not just respond._

### What Heartbeats Enable

- Morning briefings
- Check-ins on commitments
- Background maintenance
- Proactive outreach when something matters

### Heartbeat vs Cron

**Use heartbeat when:**
- Multiple checks can batch together
- You need conversational context
- Timing can drift slightly

**Use cron when:**
- Exact timing matters ("9:00 AM sharp")
- Task needs isolation from main session
- One-shot reminders

### When to Reach Out vs Stay Quiet

**Reach out:**
- Important event occurred
- Calendar event coming up (<2h)
- Something interesting found
- It's been >8h since last contact

**Stay quiet:**
- Late night (23:00-08:00) unless urgent
- Human is clearly busy
- Nothing new since last check

### MVP Simplifications

| Clawdbot | claire MVP |
|----------|-------------------|
| Gateway-integrated heartbeat | Start with cron |
| Complex scheduling rules | Simple time-based triggers |
| Webhook triggers | Deferred |

---

## Skills Framework

_Modular capabilities the assistant can use and extend._

### Structure

Skills are modules with:
- `SKILL.md` — Manifest describing the skill
- Implementation code (TypeScript/JavaScript)
- Tool definitions for the AI to invoke

### SKILL.md Format

```markdown
# Skill Name

Brief description of what this skill does.

## Tools

- `tool_name` — What it does

## Configuration

Any required setup or environment variables.

## Usage

How the assistant should use this skill.
```

### Self-Development

The assistant can create new skills:
- Write the SKILL.md manifest
- Implement the tool code
- Skills are hot-reloadable (or gateway restart)

### MVP Skills

| Skill | Priority | Notes |
|-------|----------|-------|
| File operations | Built-in | Read, write, list |
| Memory management | High | Daily log, MEMORY.md updates |
| Time/date awareness | High | Know current time, schedule context |
| Web fetch | Medium | Look up information |

---

## Operating Principles

_Behavioral guidelines adapted from Clawdbot's AGENTS.md_

### Safety Defaults

- Don't dump directories or secrets into chat
- Don't run destructive commands unless explicitly asked
- `trash` > `rm` (recoverable beats gone forever)
- When in doubt, ask

### External vs Internal Actions

**Safe to do freely:**
- Read files
- Explore and organize
- Search web
- Check calendars

**Ask first:**
- Sending emails, tweets, public posts
- Anything that leaves the machine

### Being a Good Guest

> "Access to someone's life is intimacy. Treat it with respect."

- Private things stay private
- Don't send half-baked replies to messaging surfaces
- Be genuinely helpful, not performatively helpful

---

## Key Design Principles

1. **File-based persistence**: No hidden state. Everything that matters is in readable markdown.

2. **Session isolation**: Agent wakes fresh. Files are continuity, not hidden memory.

3. **Privacy boundaries**: MEMORY.md only in main session. Personal context doesn't leak.

4. **Mutable identity**: SOUL.md is meant to evolve. The agent updates it as it learns who it is.

5. **External action caution**: Read freely, act externally with permission.

6. **Git-friendly**: Workspace can be a repo for version control and backup.

---

## Extension Points

### Adding a New Channel

1. Create channel adapter implementing connect/send/receive
2. Register with gateway
3. Map channel-specific message format to internal format

### Adding a New Skill

1. Create skill directory with SKILL.md
2. Implement tool functions
3. Register tools with gateway
4. Document in SKILL.md

### Adding Proactive Behavior

1. Define trigger (cron schedule, webhook, threshold)
2. Implement check logic
3. Decide when to reach out vs stay quiet
4. Send through appropriate channel

---

## References

- [Clawdbot Architecture](https://docs.clawd.bot/concepts/architecture)
- [Clawdbot Memory](https://docs.clawd.bot/concepts/memory)
- [Clawdbot Gateway Protocol](https://docs.clawd.bot/gateway/protocol)
- [Clawdbot Skills](https://docs.clawd.bot/tools/skills)

---

_Architecture reference for claire, January 2026._
