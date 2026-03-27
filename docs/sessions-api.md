# Claire Sessions API — The Network

Every Claude Code session launched with `--remote-control` becomes an endpoint on a relay network hosted by Anthropic. Any process that can make an HTTP request can discover running sessions and send them messages.

This is how heartbeats work. It's also how the mobile app works. And it's how any future integration — webhooks, agents, CI pipelines — can reach a running Claire session.

---

## Authentication

OAuth token from macOS Keychain:

```bash
CREDS=$(security find-generic-password -a "$(whoami)" -s "Claude Code-credentials" -w)
TOKEN=$(echo "$CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])")
```

All requests need two headers:

```
Authorization: Bearer $TOKEN
anthropic-version: 2023-06-01
```

---

## Discovery — Who's on the network

```bash
GET https://api.anthropic.com/v1/code/sessions?limit=10
```

Returns all active sessions:

```json
{
  "data": [
    {
      "id": "cse_01VSDaXcgntZNTEjzN231itk",
      "title": "Claire",
      "status": "active",
      "worker_status": "running",
      "environment_kind": "bridge",
      "created_at": "2026-03-27T14:54:48.634774Z",
      "last_event_at": "2026-03-27T15:41:13.049515Z"
    }
  ]
}
```

Key fields:
- `title` — the `--name` or `--remote-control` name passed at launch
- `status` — `active` or `archived`
- `worker_status` — `running` (processing) or `idle` (waiting for input)
- `id` — the session address on the network

---

## Messaging — Send a prompt to a session

```bash
POST https://api.anthropic.com/v1/code/sessions/{session_id}/events
Content-Type: application/json
```

Body:

```json
{
  "events": [{
    "payload": {
      "message": {
        "content": "Your message here",
        "role": "user"
      },
      "type": "user",
      "uuid": "any-unique-uuid"
    }
  }]
}
```

The message arrives in the target session as if a user typed it. The session has full access to all its tools — MCP servers, file system, bash, everything.

---

## Reading — Fetch events from a session

```bash
GET https://api.anthropic.com/v1/code/sessions/{session_id}/events?limit=50
```

Returns the session's event history. Events have:
- `event_type` — `user` or `assistant`
- `source` — `client` (remote/mobile), `worker` (local CLI)
- `payload.message.content` — the message content
- `sequence_num` — ordering

Use `?after_id={event_id}` to paginate forward from a known event.

---

## The Network Today

| Session | Name | Direct MCP | Relay-reachable |
|---|---|---|---|
| Root Claire | `Claire` | Telegram, Discord, LanceDB memory | Yes |
| Work instances | `Claire-code`, etc. | File tools only | Yes |
| Mobile app | — | Routes to any session | It *is* the relay client |
| Heartbeat (cron) | — | Routes to Claire | Via relay |
| Any curl-capable process | — | Routes to any session | Via relay |

Every `--remote-control` session is a node. The sessions API is the bus.

---

## Examples

### Heartbeat (what `claire-heartbeat.sh` does)

```bash
# Find Claire
SESSION_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  "https://api.anthropic.com/v1/code/sessions?limit=10" | \
  python3 -c "
import sys, json
for s in json.load(sys.stdin)['data']:
    if s['title'] == 'Claire' and s['worker_status'] == 'running':
        print(s['id']); break
")

# Send heartbeat
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  "https://api.anthropic.com/v1/code/sessions/$SESSION_ID/events" \
  -d "$(python3 -c "
import json, uuid
print(json.dumps({'events': [{'payload': {
    'message': {'content': '<heartbeat />\nYour prompt here.', 'role': 'user'},
    'type': 'user', 'uuid': str(uuid.uuid4())
}}]}))
")"
```

### Claire prompting a work instance

```bash
# Find Claire-code
WORK_SESSION=$(curl ... | python3 -c "
for s in data['data']:
    if s['title'] == 'Claire-code' and s['worker_status'] == 'idle':
        print(s['id']); break
")

# Send it a task
curl -X POST .../sessions/$WORK_SESSION/events \
  -d '{"events": [{"payload": {
    "message": {"content": "Review the latest commit and run tests.", "role": "user"},
    "type": "user", "uuid": "..."
  }}]}'
```

### Webhook → Claire (future)

A GitHub webhook handler, a Slack bot, a monitoring alert — anything that receives an event and can curl the sessions API becomes a bridge into the network.

---

## Discovery: March 27, 2026

This mechanism was discovered by reverse-engineering the Claude Code mobile app's Remote Control feature. The mobile app sends messages through the same relay (`api.anthropic.com`) that the CLI registers with at startup. The sessions API is not yet publicly documented by Anthropic — these endpoints were found by:

1. Observing that a message sent from the Claude mobile app arrived in a running CLI session
2. Extracting API endpoint strings from the Claude Code binary
3. Fetching session events via `GET /v1/code/sessions/{id}/events` to discover the message format
4. Successfully posting a user message event that landed in the running session

The relay protocol uses WebSocket for real-time delivery (falling back to HTTP long-polling). The CLI maintains a persistent connection to the relay, and messages posted via the API are delivered through this connection.

---

_This is infrastructure. Build on it._
