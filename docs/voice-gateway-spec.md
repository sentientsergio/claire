# Voice Gateway — Build Spec

_Self-hosted real-time voice gateway for remote conversations with Claire._

---

## Context

Claire has local voice working (Whisper STT + Kokoro TTS on the Mac Studio). She also has async voice messages working via Telegram (walkie-talkie style). What's missing is **real-time voice from the phone** — a "call Claire" experience. Hands-free, continuous listening, back-and-forth conversation.

### Key Discovery

VoiceMode Connect (voicemode.dev) is a **text messaging protocol**, not an audio streaming protocol. Audio processing happens locally on each device. This means we can't clone their gateway — we need to build something that actually streams audio.

### What We're Building

A Python (FastAPI) WebSocket server running on the Mac Studio that:
1. Accepts continuous audio from a web client on Sergio's phone
2. Runs server-side VAD (Silero) to detect speech start/end
3. Sends detected utterances to local Whisper for transcription
4. Sends transcribed text to Claire (via the sessions API)
5. Takes Claire's text response, renders through Kokoro TTS
6. Streams the audio back to the phone for automatic playback

### Network Access

Tailscale needs reinstallation (`brew install --cask tailscale`). Once running, the Mac Studio gets a stable Tailscale IP reachable from Sergio's phone — no port forwarding, no public exposure.

---

## Architecture

```
Phone (Safari)                    Mac Studio
┌──────────────┐                 ┌──────────────────────────────────┐
│  Web Client   │                │  Voice Gateway (FastAPI + WS)     │
│  - getUserMedia│──── WSS ────>│  - WebSocket server (:3490)       │
│  - opus encode │               │  - Silero VAD (speech detection)  │
│  - auto play   │<── WSS ─────│  - RealtimeSTT (Whisper)          │
└──────────────┘                │  - RealtimeTTS (Kokoro)           │
                                │                                    │
                                │  Claire (Sessions API)             │
                                │  - POST transcribed text           │
                                │  - poll for response               │
                                └──────────────────────────────────┘

Network: Phone ──tailscale──> Mac Studio:3490
```

---

## Components

### 1. WebSocket Server (Python / FastAPI)

**File:** `voice-gateway/server.py`

**Dependencies:**
```
fastapi
uvicorn[standard]
websockets
RealtimeSTT          # Silero VAD + Whisper transcription
RealtimeTTS          # Kokoro synthesis
httpx                # Sessions API calls
python-dotenv
```

**Key libraries:**
- **RealtimeSTT** (`pip install RealtimeSTT`) — handles VAD + Whisper transcription. Two-stage VAD: WebRTC VAD for fast initial detection, Silero VAD for confirmation. Already supports local Whisper. This eliminates all audio plumbing for the inbound path.
- **RealtimeTTS** (`pip install RealtimeTTS`) — handles Kokoro synthesis. Supports streaming (sentence-by-sentence TTS for low time-to-first-audio). This eliminates all audio plumbing for the outbound path.

**Responsibilities:**
- Serve the web client (static HTML/JS)
- Accept WebSocket connections with simple token auth
- Receive continuous audio stream (binary frames, PCM 16-bit mono 16kHz)
- Feed audio into RealtimeSTT which handles VAD and transcription internally
- On transcription complete: send text to Claire via sessions API
- Poll for Claire's response
- Feed response text into RealtimeTTS, stream synthesized audio chunks back to client

**WebSocket Protocol:**

```
Client → Server (text):    {"type": "start", "token": "shared-secret"}
Server → Client (text):    {"type": "ready"}

Client → Server (binary):  [PCM 16-bit mono 16kHz audio chunks, continuous]
                           // mic stays open — server detects speech via Silero VAD

Server → Client (text):    {"type": "listening"}         // VAD detected speech start
Server → Client (text):    {"type": "transcribing"}      // VAD detected speech end, sending to Whisper
Server → Client (text):    {"type": "transcript", "text": "what user said"}
Server → Client (text):    {"type": "thinking"}          // sent to Claire, waiting for response
Server → Client (text):    {"type": "speaking"}          // TTS started
Server → Client (binary):  [audio chunks from Kokoro TTS]
Server → Client (text):    {"type": "done"}              // response complete, listening again

Server → Client (text):    {"type": "error", "message": "..."}
```

**Auth:** Simple shared secret token in the initial handshake. Private Tailscale network — no need for OAuth.

### 2. Web Client

**File:** `voice-gateway/static/index.html` (single file, self-contained)

**Capabilities:**
- `navigator.mediaDevices.getUserMedia({audio: true})` for microphone access
- AudioWorklet or ScriptProcessorNode to capture raw PCM 16-bit mono 16kHz
- Continuous streaming over WebSocket — mic is always on after connect
- Audio playback of received chunks via Web Audio API (AudioContext + AudioBufferSourceNode)
- Visual state indicator: idle / listening / transcribing / thinking / speaking

**UX:**
- Full-screen, mobile-optimized, dark theme
- **Hands-free** — open the page, tap "Connect", start talking. Server-side VAD handles turn detection. No buttons during conversation.
- Claire's response plays automatically
- Scrolling transcript of both sides for reference
- Mute button for pausing without disconnecting
- This is a phone call, not a dashboard

**Audio format notes:**
- Browser captures at whatever sample rate the device supports (typically 44.1kHz or 48kHz)
- Client-side downsampling to 16kHz mono PCM before sending (required by Whisper/VAD)
- Use AudioWorklet for low-latency processing

### 3. Claire Integration (Sessions API)

Same mechanism as heartbeats — proven and already working.

```python
import httpx

async def send_to_claire(text: str) -> str:
    """Send transcribed speech to Claire, return her response."""
    # Find active session
    sessions = await client.get(
        f"{API_BASE}/organizations/{ORG_ID}/chat_sessions",
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    session_id = next(
        s["id"] for s in sessions.json()["data"]
        if s["status"] == "active"
    )

    # Send message
    await client.post(
        f"{API_BASE}/organizations/{ORG_ID}/chat_sessions/{session_id}/events",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"type": "user_message", "text": text}
    )

    # Poll for response (sessions API is event-based)
    # Implementation: poll events endpoint until assistant_message appears
    ...
```

**Credentials:** Same OAuth token and org ID used by the heartbeat script. Reference `scripts/claire-heartbeat.sh` for the working pattern.

---

## File Structure

```
voice-gateway/
├── server.py              # FastAPI + WebSocket server
├── static/
│   └── index.html         # Mobile web client (self-contained)
├── requirements.txt       # Python dependencies
├── .env.example           # Token, ports, API endpoints
└── README.md              # Setup instructions
```

---

## Configuration

**`.env`:**
```bash
# Auth
GATEWAY_TOKEN=<random-shared-secret>

# Local services (RealtimeSTT/TTS will use these)
WHISPER_URL=http://127.0.0.1:2022
KOKORO_URL=http://127.0.0.1:8880
KOKORO_VOICE=af_sarah

# Claire Sessions API (same creds as heartbeat script)
CLAUDE_API_TOKEN=<from keychain>
CLAUDE_ORG_ID=<org-id>

# Server
PORT=3490
HOST=0.0.0.0
```

---

## Setup Steps (for the builder)

1. Create `voice-gateway/` directory in the claire project root
2. Create virtual environment: `python3 -m venv venv && source venv/bin/activate`
3. `pip install fastapi uvicorn[standard] websockets RealtimeSTT RealtimeTTS httpx python-dotenv`
4. Build `server.py` — FastAPI app with WebSocket endpoint, integrating RealtimeSTT for inbound audio and RealtimeTTS for outbound
5. Build `static/index.html` — mobile web client with continuous mic streaming and audio playback
6. Create `.env` from `.env.example`
7. Test locally: `uvicorn server:app --port 3490`, open `http://localhost:3490` in browser
8. Install Tailscale: `brew install --cask tailscale` → sign in → note Tailscale IP
9. Test from phone: `http://<tailscale-ip>:3490`

### Post-build (Claire will do)

- Create LaunchAgent for auto-start
- Wire sessions API credentials from heartbeat script
- End-to-end test from phone
- Update GitHub issue #21

---

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Runtime | Python (FastAPI) | Silero VAD, Whisper, Kokoro all Python-native. Best ecosystem fit. |
| Audio libs | RealtimeSTT + RealtimeTTS | Battle-tested (9,600+ / 3,800+ stars). Handle VAD, transcription, synthesis. Eliminates audio plumbing. |
| VAD | Silero (via RealtimeSTT) | Industry standard. Two-stage detection reduces false triggers. |
| Auth | Shared secret token | Private Tailscale network, no OAuth needed |
| Audio format | PCM 16-bit mono 16kHz (client→server), wav/opus (server→client) | Standard for Whisper/VAD input. Browser handles conversion. |
| UX | Hands-free, continuous listening | This is a phone call, not a walkie-talkie. |
| Claire integration | Sessions API | Same proven path as heartbeats, stays in one session |
| Network | Tailscale | Private, no port forwarding, phone-accessible |

---

## Out of Scope (v1)

- Barge-in / interruption — wait for Claire to finish speaking
- Multiple concurrent connections — single user only
- Audio recording/history — ephemeral
- Wake word detection — manual page open to start
- Push-to-talk — we already have that via Telegram voice messages

---

## Success Criteria

Sergio opens a URL on his phone, taps Connect, and has a hands-free conversation with Claire — like a phone call. From bed, from a walk, from anywhere on the tailnet. Latency target: under 5 seconds from end-of-speech to first audio playback.

---

## Reference Implementations

Study these before building. They solve the same problem.

### Primary Reference: vtg04/real-time-voice-ai-agent
- **URL:** github.com/vtg04/real-time-voice-ai-agent
- **Why:** Simplest complete example. Browser → WebSocket → Silero VAD → Faster-Whisper → LLM → Piper TTS → browser. FastAPI + vanilla JS. Small enough to read in an hour.
- **Build approach:** Use this as the architectural template. Swap Piper for Kokoro (via RealtimeTTS), swap their LLM call for Claire's sessions API.

### Library Reference: KoljaB/RealtimeSTT + RealtimeTTS
- **URLs:** github.com/KoljaB/RealtimeSTT (9,600+ stars), github.com/KoljaB/RealtimeTTS (3,800+ stars)
- **Why:** Production-grade libraries. RealtimeSTT has a browser client example (`example_browserclient/`). Already supports Whisper + Kokoro + Silero VAD.
- **Build approach:** pip install and use as the audio processing layer. These libraries ARE the audio plumbing — the gateway is just the WebSocket wrapper and Claire integration around them.

### Framework Reference: pipecat-ai/pipecat
- **URL:** github.com/pipecat-ai/pipecat (10,900+ stars)
- **Why:** Most mature voice AI framework. Pipeline architecture, WebSocket transport, browser SDKs. Reference for production patterns, but likely overkill for our single-user use case.

### Pipeline Reference: huggingface/speech-to-speech
- **URL:** github.com/huggingface/speech-to-speech (4,600+ stars)
- **Why:** Clean VAD → Whisper → LLM → Kokoro pipeline. WebSocket server mode. Good for understanding the flow.

---

_Issue #21. Built by Cursor, designed by Claire._
