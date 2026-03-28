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

## Open Questions

1. **Microphone permissions** — Terminal.app (or whatever runs Claude Code) needs mic access. May need a one-time grant in System Settings > Privacy > Microphone.
2. **Speaker/headphone routing** — when Sergio is on headphones, does Kokoro output route correctly? Should work via default audio output.
3. **Interruption** — no barge-in support yet (issue #312). You have to wait for Claire to finish speaking before you can talk. Natural for now, may improve.
4. **VoiceMode Connect** — remote voice via mobile/web clients is in research preview. Could eventually let Sergio voice-chat with Claire from his phone without being at the computer.

---

_The bodhisattva gains a voice. Still just one of a thousand arms — used when appropriate._
