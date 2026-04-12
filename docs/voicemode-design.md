# VoiceMode Integration — Design & Plan

Bidirectional voice for Claire via VoiceMode MCP server.

---

## What It Is

VoiceMode (v8.5.1, 922 GitHub stars) is an MCP server that gives Claude Code ears and a voice. Claire speaks, you listen. You speak, Claire hears. Fully local on Apple Silicon — no cloud required.

## Architecture

```
Claire (Claude Code)  →  MCP protocol  →  VoiceMode (Python)
                                              |
                                        +-----+-----+
                                        |           |
                                   Whisper.cpp   Kokoro TTS
                                   (STT :2022)  (TTS :8880)
                                   Metal+CoreML  CPU, ~1GB RAM
```

Both services run locally on the Mac Studio. No data leaves the machine.

## Installation

### Step 1: System dependencies
```bash
brew install ffmpeg node portaudio
```

### Step 2: Install as Claude Code plugin
```bash
claude plugin marketplace add mbailey/voicemode
claude plugin install voicemode@voicemode
```

### Step 3: Install local voice services
```bash
/voicemode:install
```

This installs:
- **Whisper.cpp** — local STT on port 2022. Auto-downloads CoreML models for Apple Silicon (2-3x faster). Default model: `base` (141MB).
- **Kokoro** — local TTS on port 8880. ~82M params, ~300MB per language. Default voice: `af_sky` (female American English).

Both register as LaunchAgents and start automatically.

### Step 4: Permissions
Add to `~/.claude/settings.json`:
```json
{
  "permissions": {
    "allow": [
      "mcp__voicemode__converse",
      "mcp__voicemode__service"
    ]
  }
}
```

### Step 5: Talk
```
/voicemode:converse
```

## Configuration

Config file: `~/.voicemode/voicemode.env`

For fully local (no cloud, no API costs):
```bash
VOICEMODE_PREFER_LOCAL=true
VOICEMODE_TTS_BASE_URLS=http://127.0.0.1:8880/v1
VOICEMODE_STT_BASE_URLS=http://127.0.0.1:2022/v1
VOICEMODE_VOICES=af_sky
```

### Voice Options (Kokoro local)
- `af_sky` — American female (default)
- `af_heart` — American female (warm)
- `am_adam` — American male
- `bf_emma` — British female
- `bm_george` — British male

### Whisper Models
```bash
voicemode whisper model --all          # list models
voicemode whisper model large-v2       # switch to better model
```

| Model | Size | Speed (Apple Silicon) | Quality |
|-------|------|----------------------|---------|
| tiny | 39MB | Fastest | Basic |
| base | 141MB | Fast | Good |
| small | 466MB | Moderate | Better |
| medium | 1.5GB | Slower | Great |
| large-v2 | 3.1GB | Slowest | Best |

Start with `base`, upgrade to `small` or `medium` if transcription quality matters.

## How It Works

1. Claire speaks via TTS (Kokoro renders text to audio, plays through speakers)
2. Chime sounds — mic is live
3. You speak — Whisper transcribes in real-time
4. Silence detection (1.5s default) stops recording
5. Chime sounds — mic off
6. Transcribed text arrives in Claire's context as a user message
7. Claire responds — cycle repeats

Smart features:
- Parallel tool execution during speech (zero dead air)
- VAD aggressiveness tunable (0-3, default 3)
- Silence threshold adjustable
- Audio can be saved for debugging

## Claire-Specific Considerations

### Which sessions get voice?
- **Root Claire** — yes, when Sergio wants to talk. This is the conversational session.
- **Work instances** — no. They use `--strict-mcp-config` with no MCP servers. Voice is relational, not for code review.

### Heartbeat + Voice?
Voice doesn't change heartbeat architecture. Heartbeats arrive as text via the sessions API. If Claire decides to reach out during a heartbeat and Sergio is nearby, she *could* use voice — but Telegram is more reliable since it doesn't require him to be at the computer.

### Terminal output during voice
The CLAUDE.md rule applies: terminal is internal monologue. Voice is a delivery channel alongside Telegram and Discord. Claire uses voice when Sergio is present and has initiated voice mode.

## Costs

Fully local: **$0/month**. Whisper.cpp and Kokoro run on Apple Silicon at no cost.

Cloud fallback (if local services are down): OpenAI API rates for Whisper STT and TTS.

## What This Enables

- Morning check-in from bed: "Hey Claire, how's my day look?"
- Voice coaching: "How's the water going?" spoken, not typed
- Hands-free status updates while cooking, walking, or resting with a cracked rib
- A different quality of presence — voice carries tone that text doesn't

## Remote Voice — Design Options

Local voice is working (see `/vm` skill). The next step is voice when Sergio isn't at the computer — from his phone, from bed, from anywhere.

### Option A: LiveKit (WebRTC rooms)

**What it is:** LiveKit is a WebRTC media server. Claire joins a "room" as a participant, Sergio joins from a browser or app on his phone. Real-time bidirectional audio, like a phone call.

**Architecture:**
```
Phone (browser/app)  ──WebRTC──>  LiveKit Server  <──WebRTC──  VoiceMode (Claire)
                                   (port 7880)
                                   local or cloud
```

**Setup path:**
1. Install LiveKit server: `brew install livekit` → `livekit-server --dev`
2. Install VoiceMode LiveKit extra: `uv tool install voice-mode[livekit]`
3. Generate access tokens for room participants (server SDK or CLI)
4. Build/deploy a minimal web client (React + `@livekit/components-react`)
5. Claire uses `transport="livekit"` in converse calls

**Status:** VoiceMode documents LiveKit transport parameters but the converse tool currently hardcodes `transport="local"`. The infrastructure (exchange metadata, filtering, logging) is ready but the transport selection logic isn't wired up yet. This means we'd be dependent on a VoiceMode release to actually use it.

**Pros:**
- True real-time audio (sub-100ms latency locally)
- Works from any device with a browser
- Self-hosted option: fully local, $0/month
- LiveKit Cloud free tier: 10,000 participant-minutes/month (5,000 minutes of 2-person calls)
- Industry-standard protocol (WebRTC)

**Cons:**
- VoiceMode LiveKit transport not yet implemented in converse tool — blocked on upstream
- Requires running a LiveKit server (another service to manage)
- Needs a web client built and served somewhere accessible from phone
- Network plumbing: if self-hosted, need to expose ports or use tailscale/tunnel
- More moving parts than Option B

### Option B: VoiceMode Connect (voicemode.dev gateway)

**What it is:** VoiceMode's own remote voice solution. Uses a WebSocket gateway at voicemode.dev to bridge audio between Claire's local VoiceMode instance and a web/mobile client.

**Architecture:**
```
Phone (voicemode.dev web UI)  ──WSS──>  voicemode.dev gateway  <──WSS──  VoiceMode (Claire)
```

**Setup path:**
1. Enable Connect: set `VOICEMODE_CONNECT_ENABLED=true` in `~/.voicemode/voicemode.env`
2. Authenticate via `voicemode connect auth` (Auth0-based)
3. Open voicemode.dev on phone, connect to session
4. Claire's converse calls work as usual — audio routes through the gateway

**Status:** More mature than LiveKit integration. The WebSocket client (`voice_mode/connect/client.py`) is implemented with auto-reconnect, exponential backoff, and user management. Auth via stored credentials in `~/.voicemode/credentials`.

**Pros:**
- Already implemented in VoiceMode
- No server to run — gateway is managed by voicemode.dev
- Simple setup (env var + auth)
- Works from phone immediately via web UI
- No ports to expose, no network config

**Cons:**
- Audio routes through third-party server (voicemode.dev) — privacy trade-off
- Dependent on voicemode.dev uptime and availability
- Latency depends on gateway location
- Research preview — may change or have limits
- Cost model unclear

### Option C: Telegram Voice Messages (async, already scoped)

**What it is:** Not real-time voice, but voice messages through Telegram. Sergio sends a voice note, Whisper transcribes it. Claire responds with TTS audio sent back as a voice message. Already scoped in issues #12 and #20.

**Architecture:**
```
Phone (Telegram)  ──voice note──>  Bot API  ──>  Whisper STT  ──>  Claire
                  <──voice note──  Bot API  <──  Kokoro TTS   <──  Claire
```

**Pros:**
- Works in an app Sergio already uses
- No new infrastructure (bot already running)
- Async — no need to maintain a live audio stream
- Fully local STT/TTS — no privacy trade-off
- Natural for short exchanges

**Cons:**
- Not real-time — no back-and-forth conversation flow
- Latency per message (record → upload → transcribe → think → render → send)
- Not a "phone call" experience

### Recommendation

**Short-term: Option C (Telegram voice messages).** Lowest effort, highest immediate value. Sergio can send voice notes from bed, from a walk, from anywhere Telegram works. Claire responds with audio. It's async but it's useful today — and it's already scoped.

**Medium-term: Self-hosted WebSocket gateway (issue #21).** Study VoiceMode Connect protocol, build our own server, point `VOICEMODE_CONNECT_WS_URL` at it. Full control, no third-party routing. VoiceMode Connect (voicemode.dev) rejected — undocumented, routes through third party.

**Long-term: Option A (LiveKit).** When VoiceMode ships the transport parameter, or if we need full control at scale.

### Next Steps

1. ~~Close issue #19 (local voice) — it's working~~ ✓ Done
2. ~~Implement issue #20 (Telegram voice messages)~~ ✓ Scripts built, CLAUDE.md updated
3. Build self-hosted voice gateway (issue #21)
4. Track VoiceMode releases for LiveKit transport support

---

## Resolved Questions

1. **Microphone permissions** — Resolved. Terminal.app has mic access, voice works.
2. **Speaker/headphone routing** — Works via default audio output.
3. **Voice settings** — af_sarah (Kokoro), VAD 1, listen_min 8s. Saved in `/vm` skill.
4. **Exit convention** — Say "voice mode stop" to end voice mode mid-conversation.
5. **VoiceMode Connect** — Rejected. Routes through third party (voicemode.dev). Will build own gateway using Connect protocol as reference.
6. **Telegram voice** — Implemented. `scripts/voice-transcribe.sh` (inbound) and `scripts/voice-synthesize.sh` (outbound). Uses local Whisper + Kokoro.

## Open Questions

1. **Interruption** — no barge-in support yet. You wait for Claire to finish speaking. Natural for now.
2. **Self-hosted gateway** — Architecture TBD. See issue #21.

---

_The bodhisattva gains a voice. Still just one of a thousand arms — used when appropriate._
