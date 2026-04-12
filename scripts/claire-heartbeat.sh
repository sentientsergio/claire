#!/bin/bash
# claire-heartbeat.sh — Hourly heartbeat for Claire on Claude Code
# Called by LaunchAgent: com.claire.heartbeat
#
# Sends a heartbeat prompt directly into Claire's running session via the
# Claude Code sessions API (the same relay the mobile app uses).
# The prompt lands in the root session with full MCP tool access.

CLAIRE_DIR="/Users/sergio/sentientsergio/claire"
LOG="$HOME/Library/Logs/claire/cron.log"
API_BASE="https://api.anthropic.com"
API_VERSION="2023-06-01"

mkdir -p "$(dirname "$LOG")"

# --- Auth ---
CREDS=$(security find-generic-password -a "$(whoami)" -s "Claude Code-credentials" -w 2>/dev/null)
if [ -z "$CREDS" ]; then
  echo "$(date -Iseconds) [heartbeat] No credentials in Keychain. Skipping." >> "$LOG"
  exit 0
fi
TOKEN=$(echo "$CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "$(date -Iseconds) [heartbeat] Failed to parse OAuth token. Skipping." >> "$LOG"
  exit 0
fi

# --- Find active Claire session ---
SESSION_ID=$(curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-version: $API_VERSION" \
  "$API_BASE/v1/code/sessions?limit=10" 2>/dev/null | \
  python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for s in data.get('data', []):
        if s.get('title') == 'Claire' and s.get('status') == 'active':
            print(s['id'])
            break
except: pass
" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  # Debug: log what the API returned
  DEBUG=$(curl -s \
    -H "Authorization: Bearer $TOKEN" \
    -H "anthropic-version: $API_VERSION" \
    "$API_BASE/v1/code/sessions?limit=5" 2>/dev/null | \
    python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for s in data.get('data', []):
        print(f'{s.get(\"title\",\"?\")}:{s.get(\"status\",\"?\")}:{s.get(\"worker_status\",\"?\")}')
except Exception as e:
    print(f'parse error: {e}')
" 2>/dev/null)
  echo "$(date -Iseconds) [heartbeat] No active Claire session found. Sessions: $DEBUG" >> "$LOG"
  exit 0
fi

# --- Fetch context usage ---
CONTEXT_INFO=$(HEARTBEAT_TOKEN="$TOKEN" HEARTBEAT_SESSION="$SESSION_ID" HEARTBEAT_API_BASE="$API_BASE" python3 << 'PYEOF'
import json, urllib.request, os

token = os.environ["HEARTBEAT_TOKEN"]
session_id = os.environ["HEARTBEAT_SESSION"]
api_base = os.environ["HEARTBEAT_API_BASE"]

req = urllib.request.Request(
    f"{api_base}/v1/code/sessions/{session_id}/events?limit=20",
    headers={
        "Authorization": f"Bearer {token}",
        "anthropic-version": "2023-06-01"
    }
)

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())

    # Find latest assistant event with usage data
    for event in data.get("data", []):
        usage = (event.get("payload", {}).get("message", {}).get("usage")
                 or event.get("message", {}).get("usage"))
        model = (event.get("payload", {}).get("message", {}).get("model")
                 or event.get("message", {}).get("model", ""))
        if usage:
            input_tok = usage.get("input_tokens", 0)
            cache_read = usage.get("cache_read_input_tokens", 0)
            cache_create = usage.get("cache_creation_input_tokens", 0)
            total = input_tok + cache_read + cache_create

            # Determine window size from model
            if "opus-4" in model or "sonnet-4" in model:
                window = 1_000_000
            else:
                window = 200_000

            pct = round(total / window * 100, 1)
            print(f"{pct}%|{total}|{window}")
            break
    else:
        print("unknown")
except Exception as e:
    print("unknown")
PYEOF
)

CONTEXT_PCT=$(echo "$CONTEXT_INFO" | cut -d'|' -f1)
CONTEXT_TOKENS=$(echo "$CONTEXT_INFO" | cut -d'|' -f2)

# --- Send heartbeat (python handles JSON safely) ---
echo "$(date -Iseconds) [heartbeat] Firing into session ${SESSION_ID:0:20}... (context: ${CONTEXT_PCT:-unknown})" >> "$LOG"

RESULT=$(HEARTBEAT_TOKEN="$TOKEN" HEARTBEAT_SESSION="$SESSION_ID" HEARTBEAT_API_BASE="$API_BASE" HEARTBEAT_CONTEXT_PCT="$CONTEXT_PCT" HEARTBEAT_CONTEXT_TOKENS="$CONTEXT_TOKENS" python3 << 'PYEOF'
import json, uuid, urllib.request, os
from datetime import datetime

token = os.environ["HEARTBEAT_TOKEN"]
session_id = os.environ["HEARTBEAT_SESSION"]
api_base = os.environ["HEARTBEAT_API_BASE"]
context_pct = os.environ.get("HEARTBEAT_CONTEXT_PCT", "")
context_tokens = os.environ.get("HEARTBEAT_CONTEXT_TOKENS", "")

timestamp = datetime.now().astimezone().isoformat()

# Build heartbeat tag with context info if available
attrs = f'time="{timestamp}"'
if context_pct and context_pct != "unknown":
    attrs += f' context_pct="{context_pct}" context_tokens="{context_tokens}"'
prompt = f'<heartbeat {attrs} />'

payload = json.dumps({
    "events": [{
        "payload": {
            "message": {
                "content": prompt,
                "role": "user"
            },
            "type": "user",
            "uuid": str(uuid.uuid4())
        }
    }]
})

req = urllib.request.Request(
    f"{api_base}/v1/code/sessions/{session_id}/events",
    data=payload.encode("utf-8"),
    headers={
        "Authorization": f"Bearer {token}",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        print(f"OK:{resp.status}")
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", errors="replace")[:200]
    print(f"ERR:{e.code}:{body}")
except Exception as e:
    print(f"ERR:0:{e}")
PYEOF
)

if [[ "$RESULT" == OK:* ]]; then
  echo "$(date -Iseconds) [heartbeat] Delivered. (${SESSION_ID:0:20}...)" >> "$LOG"
else
  echo "$(date -Iseconds) [heartbeat] Failed: $RESULT" >> "$LOG"
fi

echo "$(date -Iseconds) [heartbeat] Complete." >> "$LOG"
