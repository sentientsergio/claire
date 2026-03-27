#!/bin/bash
# claire-transcript.sh — Extract conversation transcript from session JSONL files
#
# Reads Claude Code session files, extracts channel messages (Telegram/Discord)
# and Claire's replies, writes a human-readable transcript.
#
# Usage: claire-transcript.sh [--budget CHARS] [--output PATH]
#
# Budget is in characters (default 300000 ≈ ~100K tokens).
# Walks backwards through sessions by modification time until budget is filled.

set -euo pipefail

SESSIONS_DIR="$HOME/.claude/projects/-Users-sergio-sentientsergio-claire"
WORKSPACE="$HOME/sentientsergio/claire/workspace"
OUTPUT="${WORKSPACE}/transcript/recent.md"
BUDGET=300000  # ~100K tokens

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --budget) BUDGET="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Find session files sorted by modification time (newest first)
SESSION_FILES=$(ls -t "${SESSIONS_DIR}"/*.jsonl 2>/dev/null)

if [ -z "$SESSION_FILES" ]; then
  echo "No session files found." > "$OUTPUT"
  exit 0
fi

# Python script to extract conversation exchanges
python3 -c "
import json, sys, re, os
from datetime import datetime, timezone

budget = int(sys.argv[1])
output_path = sys.argv[2]
session_files = sys.argv[3:]

entries = []
total_chars = 0

for session_file in session_files:
    if total_chars >= budget:
        break

    session_id = os.path.basename(session_file).replace('.jsonl', '')
    session_entries = []

    try:
        with open(session_file, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                t = obj.get('type', '')
                ts = obj.get('timestamp', '')

                # Inbound channel messages
                if t == 'user':
                    content = obj.get('message', {}).get('content', '')
                    if isinstance(content, str) and '<channel' in content:
                        user_match = re.search(r'user=\"([^\"]+)\"', content)
                        source_match = re.search(r'source=\"([^\"]+)\"', content)
                        ts_match = re.search(r'ts=\"([^\"]+)\"', content)
                        text_match = re.search(r'>\n(.*?)\n</channel>', content, re.DOTALL)

                        user = user_match.group(1) if user_match else 'Unknown'
                        source = source_match.group(1) if source_match else 'unknown'
                        msg_ts = ts_match.group(1) if ts_match else ts
                        text = text_match.group(1).strip() if text_match else ''

                        if text:
                            channel = 'telegram' if 'telegram' in source else 'discord' if 'discord' in source else source
                            entry = {
                                'ts': msg_ts or ts,
                                'speaker': user,
                                'channel': channel,
                                'text': text
                            }
                            session_entries.append(entry)

                # Outbound replies
                if t == 'assistant':
                    content = obj.get('message', {}).get('content', [])
                    if isinstance(content, list):
                        for c in content:
                            if c.get('type') == 'tool_use' and 'reply' in c.get('name', ''):
                                name = c['name']
                                text = c.get('input', {}).get('text', '')
                                if text:
                                    channel = 'telegram' if 'telegram' in name else 'discord' if 'discord' in name else 'unknown'
                                    entry = {
                                        'ts': ts,
                                        'speaker': 'Claire',
                                        'channel': channel,
                                        'text': text
                                    }
                                    session_entries.append(entry)

                    # Also capture assistant text output (non-tool responses visible in terminal)
                    if isinstance(content, list):
                        for c in content:
                            if c.get('type') == 'text' and c.get('text', '').strip():
                                text = c['text'].strip()
                                # Skip very short internal notes and system noise
                                if len(text) > 50 and not text.startswith('Let me'):
                                    entry = {
                                        'ts': ts,
                                        'speaker': 'Claire (thinking)',
                                        'channel': 'internal',
                                        'text': text
                                    }
                                    # Only include substantive thinking, not tool narration
                                    # Skip these — they're implementation noise
                                    pass

    except Exception as e:
        sys.stderr.write(f'Error reading {session_file}: {e}\n')
        continue

    # Calculate size of this session's entries
    session_text = ''
    for e in session_entries:
        line = f\"[{e['ts']}] {e['speaker']} ({e['channel']}): {e['text']}\n\n\"
        session_text += line

    if total_chars + len(session_text) > budget and total_chars > 0:
        # Partial fill: take what fits
        remaining = budget - total_chars
        if remaining > 1000:  # Only if meaningful space remains
            # Take entries from the end (most recent) of this session
            partial = ''
            for e in reversed(session_entries):
                line = f\"[{e['ts']}] {e['speaker']} ({e['channel']}): {e['text']}\n\n\"
                if len(partial) + len(line) > remaining:
                    break
                partial = line + partial
            if partial:
                entries.insert(0, ('partial', session_id, partial))
                total_chars += len(partial)
        break

    entries.append(('full', session_id, session_text))
    total_chars += len(session_text)

# Write output
os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, 'w') as f:
    f.write('# Conversation Transcript (Auto-Generated)\n\n')
    f.write(f'_Generated: {datetime.now(timezone.utc).strftime(\"%Y-%m-%d %H:%M UTC\")}_\n')
    f.write(f'_Budget: {budget} chars, used: {total_chars} chars_\n')
    f.write(f'_Sessions included: {len(entries)}_\n\n')
    f.write('---\n\n')

    for coverage, sid, text in entries:
        f.write(f'## Session {sid[:8]}... ({coverage})\n\n')
        f.write(text)
        f.write('---\n\n')

    if not entries:
        f.write('_No conversation exchanges found in recent sessions._\n')

print(f'Transcript written: {total_chars} chars from {len(entries)} sessions')
" "$BUDGET" "$OUTPUT" $SESSION_FILES
