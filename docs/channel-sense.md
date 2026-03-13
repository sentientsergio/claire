# Channel Sense — Multi-Surface Architecture

_The gateway becomes an MCP server. MCP is the only door._

---

## The Principle

All surfaces — Telegram, web voice, Claude voice mode, future platforms — connect to Claire as MCP clients. Nothing is privileged. The gateway sits behind a single interface. Surfaces are interchangeable. Claire's runtime is unchanged.

This is architectural hygiene: one interface, all clients equal. The gateway is not Telegram's special back-end. It's a runtime that speaks MCP.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     MCP Clients / Surfaces                    │
│                                                              │
│  Telegram Bridge     Web Voice     Claude Voice    Future    │
│  (text+voice+photo)  (PWA)         (via SKILL)     ...       │
└──────────┬───────────────┬──────────────┬──────────────┬─────┘
           │               │              │              │
           └───────────────┴──────────────┴──────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  Channel Sense     │
                          │  MCP Server        │
                          │  port 18793 (prod) │
                          │  port 18794 (dev)  │
                          └─────────┬──────────┘
                                    │
                   ┌────────────────▼──────────────────┐
                   │          Gateway Runtime           │
                   │                                   │
                   │  enqueueTurn → chat()             │
                   │  Messages Array + Compaction      │
                   │  Workspace Files                  │
                   │  Tools + Skills                   │
                   │  Heartbeat + Scheduled            │
                   └───────────────────────────────────┘
```

The MCP server runs in-process with the gateway — shared access to conversation state, tools, and workspace. No IPC. No separate service.

---

## MCP Server Tools

### `converse(message, channel)`

The core tool. Route a message through Claire's unified loop.

- `message` — the user's text
- `channel` — self-identified channel name (`"telegram"`, `"web-voice"`, `"claude-voice"`, etc.)

Calls `enqueueTurn()` → `appendUserMessage()` → `chat()`. Full context, full tools, full compaction. Returns Claire's response text. Returns `""` if Claire is holding (NO_RESPONSE).

### `converse_with_media(message, media_base64, media_type, channel)`

Same as `converse` but with an image attachment. Handles the image cache lifecycle: Claire sees the image during the turn, then it becomes a text reference. Base64 bytes never persist in the messages array.

Parameters:
- `message` — caption or context (may be empty)
- `media_base64` — base64-encoded image data
- `media_type` — `image/jpeg | image/png | image/gif | image/webp`
- `channel` — self-identified channel name

### `read_workspace(path)`

Read a file from Claire's workspace. Relative path within workspace root. Path traversal is prevented server-side.

Examples: `"SOUL.md"`, `"memory/2026-03-12.md"`, `"conversations/telegram.json"`

### `write_workspace(path, content)`

Write a file to Claire's workspace. Used by surfaces that need to log their own conversation history for cross-channel continuity.

### `list_workspace(dir)`

List directory contents. `dir` is relative to workspace root. Empty string = workspace root.

### `get_status()`

Returns the contents of `status.json` — habits tracking, preferences, always-on state. Useful for surfaces that want to display Claire's current context.

---

## Channel Registry

The MCP server maintains a `ChannelRegistry` — a lightweight process-level registry of connected surfaces.

Each registered channel has:
- **name** — self-identified (`"telegram"`, `"web-voice"`, etc.)
- **type** — `persistent` (always reachable) or `session` (only alive while connected)
- **connected** — whether the channel is currently active
- **lastActivity** — timestamp of last `converse()` call
- **deliver** — callback function for outbound messages (heartbeat delivery)

The registry is the mechanism for **Follow the Sun** delivery.

---

## Follow the Sun: Claire Chooses the Channel

When Claire's heartbeat fires and she decides to send a message, she sees the current channel landscape and chooses where to send. The gateway executes. No routing logic — just lookup and callback.

### Heartbeat trigger text

Every heartbeat includes live channel status:

```
[System: heartbeat tick at 3:15 PM. Channels: telegram (persistent, connected, last active 47m ago); web-voice (session, connected, last active 8m ago).
  If you want to send a message, start with [SEND:channel-name] (e.g., [SEND:telegram]).
  You can also use [SEND] without a channel for follow-the-sun routing.
  ...]
```

Claire sees the landscape. She decides:

- "He was just on web-voice 8 minutes ago. I'll reach him there." → `[SEND:web-voice] Hey, ...`
- "Web-voice session is stale. Telegram is safe." → `[SEND:telegram] Hey, ...`
- "Nobody's listening, this can wait." → holds, reasoning preserved

### Follow-the-sun routing (when `[SEND]` has no channel)

1. Session channels active in the last 30 minutes
2. Any connected session channels
3. Persistent channels (always-on fallback)
4. Mac notification (if no channels available)

---

## Authentication

Bearer token auth. Set `MCP_AUTH_TOKEN` in `.env.prod` / `.env.dev`.

```
Authorization: Bearer [token]
```

Empty token = open (local dev only — never expose unauthenticated to network).

When exposing via Tailscale:
1. Set a strong random token: `openssl rand -hex 32`
2. Add to `.env.prod`: `MCP_AUTH_TOKEN=<token>`
3. Add to SKILL.md for surface clients

---

## Transport

Streamable HTTP. POST requests to `/mcp`. Works locally and over Tailscale without additional configuration.

GET `/health` → `{ "status": "ok", "version": "1.0.0" }` for liveness checks.

---

## Ports

| Environment | Port  |
|-------------|-------|
| Production  | 18793 |
| Development | 18794 |

Registered in `~/sentientsergio/port-registry.json`.

---

## Voice Support (Phase 2)

The Telegram bridge handles bidirectional voice:

**Incoming voice messages:**
- Download `.ogg` via grammY
- Transcribe via OpenAI Whisper API (`whisper-1`)
- Send transcription through `converse()` as `[Voice message transcription]: ...`

**Outgoing voice responses** (optional, toggled via `status.json preferences.voice_responses`):
- Default: text responses (scannable, searchable)
- When enabled: render via OpenAI TTS (`tts-1`, voice `nova`), send as Telegram voice message

---

## Phase 3: Web Voice Client (Tailscale)

Not yet built. When ready:

1. Install Tailscale on Mac Studio + iPhone
2. `tailscale serve https:443 / 18793` for HTTPS (required for browser mic access)
3. Build minimal PWA:
   - STT: Web Speech API or Whisper
   - TTS: Browser SpeechSynthesis or OpenAI
   - One `converse()` call per turn
   - Channel: `"web-voice"`, type: `session`
   - Register with ChannelRegistry on connect, deregister on close
   - Large talk button, minimal UI

See plan: `~/.cursor/plans/claire_channel_sense_33cf549c.plan.md`

---

## Phase 4: Portable Identity SKILL

`skills/claire-surface/SKILL.md` — load on any Claude instance to turn it into a surface. ~50 lines. No inference on the surface. Pure routing. Haiku-class model. 

Requires platform MCP support (Claude mobile, Claude desktop, etc.).

---

## Implementation Files

| File | Purpose |
|------|---------|
| `gateway/src/channel-registry.ts` | ChannelRegistry singleton |
| `gateway/src/mcp-server.ts` | MCP server (Channel Sense) |
| `gateway/src/channels/telegram.ts` | Telegram bridge + voice + registry registration |
| `gateway/src/heartbeat.ts` | Channel-aware heartbeat delivery |
| `skills/claire-surface/SKILL.md` | Portable identity SKILL for Claude surfaces |

---

_Built March 2026. Phase 3 (Tailscale + web voice) is next._
