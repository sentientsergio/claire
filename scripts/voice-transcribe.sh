#!/usr/bin/env bash
# voice-transcribe.sh — Convert OGG voice message to text via Whisper
# Usage: voice-transcribe.sh <input.ogg>
# Outputs: transcribed text to stdout
set -euo pipefail

INPUT="$1"
WHISPER_URL="${WHISPER_URL:-http://localhost:2022/v1/audio/transcriptions}"

# Convert OGG to WAV (16kHz mono, what Whisper expects)
WAV=$(mktemp /tmp/voice-XXXXXX.wav)
trap 'rm -f "$WAV"' EXIT

ffmpeg -i "$INPUT" -ar 16000 -ac 1 -f wav "$WAV" -y -loglevel error

# Transcribe
curl -s "$WHISPER_URL" \
  -X POST \
  -F "file=@${WAV}" \
  -F "model=whisper-1" \
  -F "language=en" | python3 -c "import sys,json; print(json.load(sys.stdin)['text'].strip())"
