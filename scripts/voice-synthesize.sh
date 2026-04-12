#!/usr/bin/env bash
# voice-synthesize.sh — Convert text to OGG voice note via Kokoro TTS
# Usage: voice-synthesize.sh "text to speak" [output.ogg]
# If no output path, writes to /tmp/voice-reply-{timestamp}.ogg
set -euo pipefail

TEXT="$1"
KOKORO_URL="${KOKORO_URL:-http://localhost:8880/v1/audio/speech}"
VOICE="${VOICE:-af_sarah}"
OUTPUT="${2:-/tmp/voice-reply-$(date +%s).ogg}"

WAV=$(mktemp /tmp/tts-XXXXXX.wav)
trap 'rm -f "$WAV"' EXIT

# Generate speech
curl -s "$KOKORO_URL" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'input': sys.argv[1], 'voice': '$VOICE'}))" "$TEXT")" \
  -o "$WAV"

# Convert WAV to OGG Opus (Telegram voice note format)
ffmpeg -i "$WAV" -c:a libopus -b:a 48k -ar 48000 -ac 1 "$OUTPUT" -y -loglevel error

echo "$OUTPUT"
