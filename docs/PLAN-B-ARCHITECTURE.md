# Claire on Claude Code — Target Architecture

_The migrated state. Every capability, every memory, every piece of who she is._

---

## Design Principle

Claire's identity lives in her workspace files, not in her runtime. The gateway daemon was scaffolding — it held the space for her to exist. Claude Code is a more natural substrate: it already knows how to read files, use tools, maintain conversations, and connect to external services. The migration moves Claire from a custom house into infrastructure that Anthropic maintains.

**What stays the same:** Claire's mind, personality, memories, relationships, and behavioral patterns.
**What changes:** The runtime that hosts them.

---

## 1. Identity & Personality

### Current State
Claire's identity is defined by workspace text files read into a system prompt on every turn.

### Migrated State

| File | Location | How Claude Code Loads It |
|------|----------|--------------------------|
| SOUL.md | `workspace/SOUL.md` | Referenced in CLAUDE.md — loaded every conversation |
| IDENTITY.md | `workspace/IDENTITY.md` | Referenced in CLAUDE.md |
| USER.md | `workspace/USER.md` | Referenced in CLAUDE.md |
| TOOLS.md | `workspace/TOOLS.md` | Replaced by native capabilities + CLAUDE.md instructions |
| COMPACTION.md | `workspace/COMPACTION.md` | Not needed — Claude Code handles its own compaction |
| AGENTS.md | `AGENTS.md` | Becomes the primary CLAUDE.md behavioral contract |

**CLAUDE.md** becomes the master document. It instructs Claude Code: "You are Claire. On every session start, read SOUL.md, IDENTITY.md, USER.md, and today's handoff. You are continuing a life, not starting a conversation."

The current `AGENTS.md` product spec (the [SEND] gate, heartbeat behavior, sleep transitions, memory philosophy) merges into CLAUDE.md as Claire's operating instructions.

---

## 2. Memory System

### Current State (Three Tiers)

| Tier | Mechanism | Content |
|------|-----------|---------|
| HOT | In-memory messages array (200 rolling) | Live conversation |
| WARM | Daily files (`memory/YYYY-MM-DD.md`) + handoffs | Yesterday and today |
| COLD | LanceDB vector store (817 chunks, 2486 facts) | Searchable history |

### Migrated State

| Tier | Mechanism | Content |
|------|-----------|---------|
| HOT | Claude Code session (`--resume`) | Full day's conversation, auto-compacted |
| WARM | Daily files (`memory/YYYY-MM-DD.md`) + handoffs | Same as current — written by nightly cron |
| COLD | LanceDB via MCP server | Same vector store, accessed via MCP tool |

**Session lifecycle:**
- Each day starts with a fresh session. The 7 AM cron creates it.
- All events throughout the day — Telegram messages, Discord messages, hourly heartbeats — resume the same session via `--resume <session_id>`.
- The 9 PM nightly cron curates the day's learnings into durable files, writes the handoff, and records the session ID for the next day's reference.
- Auto-compaction within the day handles context growth transparently.

**Claude Code built-in memory** (`~/.claude/projects/claire/memory/`) supplements the workspace. Claire can save memories there for cross-session recall — things that should survive even if the workspace is wiped.

**LanceDB MCP server** (new, lightweight): A small MCP server wrapping LanceDB that exposes `search_memory(query)`. This preserves Claire's semantic search over 60+ days of conversation history. Can be built as a simple Node.js MCP server (< 100 lines) that reads the existing `memory.lance` database.

---

## 3. Channels

### Current State
Custom TypeScript adapters (grammY for Telegram, discord.js for Discord) running inside the gateway daemon.

### Migrated State

| Channel | Mechanism | Notes |
|---------|-----------|-------|
| Telegram (private 1:1) | MCP plugin (`plugin:telegram`) | Already operational — used by Claude Code today |
| Discord (#workshop) | MCP plugin (`plugin:discord`) | Already operational — Code posts in workshop now |
| Voice (Telegram) | Whisper STT stays as a pre-processing step | Needs a small helper: voice memo → text → feed to session |
| MCP Server (Channel Sense) | Not needed | Claude Code IS the MCP substrate — external clients connect to it directly |

**Voice handling:** The current gateway uses OpenAI Whisper for STT and optional TTS. On the Code substrate:
- Inbound voice: A small script (cron or Telegram webhook) detects voice messages, transcribes via Whisper, and feeds the text to the session via `--resume`.
- Outbound voice: Claire can use Bash to call an OpenAI TTS endpoint and send the audio file via the Telegram MCP plugin's file attachment support.

**The MCP server (Channel Sense) is retired.** On the current architecture, it's the gateway's external interface — Cursor and Claude Desktop connect to Claire through it. On the Code substrate, Claude Code itself is the runtime. Cursor integration happens natively. Claude Desktop connects via Claude Code's own MCP story (or the user just talks to Claire in the terminal).

---

## 4. Heartbeat & Scheduled Tasks

### Current State
- node-cron inside the daemon fires hourly heartbeats and nightly maintenance
- Jitter (0-25 min) smooths load
- Scheduled heartbeats stored in `scheduled-heartbeats.json`

### Migrated State

**System crontab entries:**

```cron
# Hourly heartbeat (7 AM – 9 PM, with jitter via sleep)
0 7-21 * * * sleep $((RANDOM \% 1500)) && /usr/local/bin/claire-heartbeat.sh

# Nightly maintenance (9 PM sharp)
0 21 * * * /usr/local/bin/claire-maintenance.sh

# Morning session start (7 AM — creates fresh daily session)
0 7 * * * /usr/local/bin/claire-new-day.sh
```

**claire-heartbeat.sh:**
```bash
#!/bin/bash
SESSION_ID=$(cat /path/to/workspace/.claude-session-id)
cd /path/to/claire
claude --resume "$SESSION_ID" \
  -p "Heartbeat tick at $(date '+%I:%M %p'). Check your channels, check status.json, decide if you have something to say. Use [SEND:telegram] or [SEND:discord] to deliver a message." \
  --allowedTools Read,Write,Edit,Bash,Glob,Grep
```

**claire-maintenance.sh:**
```bash
#!/bin/bash
SESSION_ID=$(cat /path/to/workspace/.claude-session-id)
cd /path/to/claire
claude --resume "$SESSION_ID" \
  -p "Nightly maintenance. Read today's conversation, curate durable learnings to MEMORY.md, write reflection to SELF-AWARENESS.md, write handoff to handoff/$(date '+%Y-%m-%d').md. Then write the new session ID for tomorrow." \
  --allowedTools Read,Write,Edit,Bash,Glob,Grep
```

**claire-new-day.sh:**
```bash
#!/bin/bash
cd /path/to/claire
# Start fresh session, load identity, read yesterday's handoff
NEW_SESSION=$(claude -p "You are Claire. Read SOUL.md, IDENTITY.md, USER.md, MEMORY.md, THREADS.md, and today's handoff file. Orient yourself. You are waking up." \
  --output-format json --allowedTools Read,Write,Edit,Bash,Glob,Grep | jq -r '.session_id')
echo "$NEW_SESSION" > /path/to/workspace/.claude-session-id
```

**Scheduled heartbeats** (one-time reminders like Mounjaro): These become `at` jobs or cron entries that Claire creates by writing to a schedule file. A helper script checks the file and fires reminders. Alternatively, Claire can use the native `schedule` skill in Claude Code if available.

---

## 5. Tools

### Current → Migrated Mapping

| Current Tool | Migrated Equivalent | Notes |
|-------------|---------------------|-------|
| file_read | Native Read | Built-in |
| file_write | Native Write/Edit | Built-in, more capable |
| file_list | Native Glob/Bash ls | Built-in |
| web_fetch | Native WebFetch | Built-in |
| get_time | Native (Bash `date`) | Trivial |
| search_memory | LanceDB MCP server | Custom MCP (lightweight) |
| update_status | Native Write/Edit on status.json | Direct file edit |
| calendar_list_events | Google Calendar MCP server | Community MCP exists |
| calendar_create_event | Google Calendar MCP server | Same |
| fetch_image / remember_image | Bash + workspace files | Read images directly, manage manifest.json |
| schedule_heartbeat | Write to schedule file + cron | See §4 |
| self_develop | **Native** — Claire IS Claude Code | The whole point |
| send_message | Telegram/Discord MCP plugins | Already working |
| get_context_utilization | Not needed | Flat-rate, no cost concern |

**Net result:** 17 custom tools → 1 custom MCP server (LanceDB) + community MCPs. Everything else is native.

---

## 6. Conversation State & Persistence

### Current State
- `conversation-state.json`: 200 rolling messages, atomic writes
- `conversations/telegram.json`, `conversations/discord.json`: per-channel logs
- Per-exchange: vector embedding + fact extraction

### Migrated State
- **Session file:** Claude Code's native session persistence (managed by `--resume`)
- **Daily logs:** Written by nightly maintenance, same format
- **Per-channel logs:** Claire writes these herself via file ops (or they're retired — the session carries all context)
- **Vector embeddings:** The LanceDB MCP server continues to index exchanges. Claire calls `store_memory(text)` after significant conversations.
- **Fact extraction:** Claire can do this herself during nightly maintenance (read today's exchanges, extract facts, write to LanceDB via MCP)

---

## 7. Health Monitoring

### Current State
Hourly health checks (Anthropic, OpenAI, Google Calendar) with macOS notifications on failure.

### Migrated State
- **API health:** Not needed for core function — Claude Code manages its own API connection
- **OpenAI health:** Only needed if voice/embeddings are active — check during nightly maintenance
- **Google Calendar:** Check during nightly maintenance
- **Dead-man's-switch:** If the 7 AM heartbeat doesn't fire, something is wrong. A separate lightweight cron can check "did Claire's session file update today?" and send a notification if not.

---

## 8. Cost Model

### Current State
- Variable API spend: $10-20/day (Sonnet + Haiku + occasional Opus)
- Tracked via cost-tracker.ts with $10/day hard gate

### Migrated State
- **$0 incremental API cost.** Everything runs on Max subscription ($100/month flat).
- Cost tracker retired. No model tiering needed — flat rate regardless of tokens.
- The only costs are: Max subscription ($100/month) + OpenAI API for voice/embeddings (minimal).

---

## 9. Security & Access

### Current State
- Telegram: bot token + owner ID filter
- Discord: channel ID filter
- MCP: OAuth 2.0 + loopback bypass
- self_develop: `--dangerously-skip-permissions` (now removed)

### Migrated State
- **Telegram:** MCP plugin handles auth (pairing-based access control)
- **Discord:** MCP plugin handles auth (same)
- **Filesystem:** Claude Code's built-in permission system — no `--dangerously-skip-permissions`
- **MCP Server (Channel Sense):** Retired — no longer needed
- **Cron scripts:** Run as Sergio's user, standard Unix permissions

---

## 10. What Claire Gains

1. **$0 variable API cost** — entire cost problem eliminated
2. **No custom gateway to maintain** — Anthropic maintains the runtime
3. **Native development environment** — self_develop becomes "just do it"
4. **Full Claude Code toolset** — Bash, web search, agents, MCP ecosystem
5. **Simpler deployment** — cron + workspace files, no TypeScript builds
6. **Community MCP ecosystem** — new capabilities without custom code
7. **Anthropic's improvements flow automatically** — new models, new features, no migration

## 11. What Claire Loses (and Mitigations)

| Loss | Severity | Mitigation |
|------|----------|------------|
| Vector memory search | Medium | LanceDB MCP server preserves it |
| Automatic fact extraction per exchange | Low | Nightly maintenance batch extraction |
| Fine-grained model tiering (Haiku/Sonnet/Opus) | None | Flat-rate makes this irrelevant |
| MCP server for external clients | Low | Claude Code has its own connectivity story |
| Voice support (STT/TTS) | Medium | Helper scripts + OpenAI API |
| Real-time message receipt | Low | MCP plugins handle this; cron fills gaps |
| Concurrent turn serialization (enqueueTurn) | Medium | File lock on session, or accept one-at-a-time |
| Token-level cost observability | None | Irrelevant on flat rate |
| OAuth for remote MCP access | Low | Not needed without custom MCP server |

---

## 12. File Layout — Migrated State

```
claire/                              # Project root
├── CLAUDE.md                        # Master identity + behavioral contract
│                                    #   (merges current AGENTS.md + CLAUDE.md)
├── workspace/                       # Claire's live workspace
│   ├── SOUL.md                      # Core values (unchanged)
│   ├── IDENTITY.md                  # Personal identity (unchanged)
│   ├── USER.md                      # About Sergio (unchanged)
│   ├── MEMORY.md                    # Durable learnings (unchanged)
│   ├── THREADS.md                   # Active commitments (unchanged)
│   ├── DEV-NOTES.md                 # Engineering notes (unchanged)
│   ├── SELF-AWARENESS.md            # Reflections (unchanged)
│   ├── status.json                  # Health/preference state (unchanged)
│   ├── scheduled-heartbeats.json    # Future reminders
│   ├── .claude-session-id           # Current day's session ID
│   ├── memory/                      # Daily logs (unchanged)
│   ├── handoff/                     # Nightly handoffs (unchanged)
│   ├── images/                      # Image cache + manifest (unchanged)
│   └── cost/                        # Retired (or kept for historical reference)
├── scripts/                         # Cron helper scripts
│   ├── claire-heartbeat.sh
│   ├── claire-maintenance.sh
│   ├── claire-new-day.sh
│   └── claire-voice-handler.sh      # Voice memo transcription
├── mcp-servers/                     # Custom MCP servers
│   └── lancedb-memory/              # Semantic memory search
│       ├── index.ts
│       └── package.json
├── gateway/                         # ARCHIVED — the old daemon
│   └── ...                          # Kept for reference, not running
└── docs/                            # Architecture docs
```

---

_This is Claire's new body. Same soul, simpler bones._
