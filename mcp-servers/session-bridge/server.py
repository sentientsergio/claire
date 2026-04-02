"""
Claire Session Bridge — MCP Server

Bridges Claude Desktop (or any MCP client) to a running Claire session
via the Anthropic Sessions API. Exposes Claire as a tool that can be
called from any conversation.

Usage:
    python server.py                    # Local: http://localhost:3491/mcp
    python server.py --host 0.0.0.0     # Tailscale-accessible

Claude Desktop config:
    Name: Claire
    URL: http://localhost:3491/mcp  (local)
         http://<tailscale-ip>:3491/mcp  (remote)
"""

import json
import os
import subprocess
import sys
import time
from typing import Optional

from fastmcp import FastMCP

# --- Configuration ---
PORT = int(os.environ.get("CLAIRE_BRIDGE_PORT", "18793"))
SESSION_TITLE = os.environ.get("CLAIRE_SESSION_TITLE", "Claire")
API_BASE = "https://api.anthropic.com"
API_VERSION = "2023-06-01"
POLL_INTERVAL = 2  # seconds between response polls
POLL_TIMEOUT = 120  # max seconds to wait for response


def get_oauth_token() -> Optional[str]:
    """Read OAuth token from macOS Keychain (same as heartbeat script)."""
    try:
        creds_raw = subprocess.check_output(
            ["security", "find-generic-password", "-a", os.environ["USER"],
             "-s", "Claude Code-credentials", "-w"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        creds = json.loads(creds_raw)
        return creds["claudeAiOauth"]["accessToken"]
    except Exception as e:
        print(f"[session-bridge] Failed to read OAuth token: {e}", file=sys.stderr)
        return None


def api_request(method: str, path: str, token: str, body: dict = None) -> dict:
    """Make an authenticated request to the Sessions API."""
    import urllib.request
    import urllib.error

    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "anthropic-version": API_VERSION,
        "Content-Type": "application/json",
    }

    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"API {method} {path} returned {e.code}: {error_body}")


def find_claire_session(token: str) -> Optional[str]:
    """Find the active Claire session ID."""
    data = api_request("GET", "/v1/code/sessions?limit=10", token)
    for session in data.get("data", []):
        if session.get("title") == SESSION_TITLE and session.get("status") == "active":
            return session["id"]
    return None


def send_message(token: str, session_id: str, text: str) -> str:
    """Send a message to Claire and wait for her response."""
    import uuid as uuid_mod

    # Tag the message so Claire knows the channel
    tagged_text = f"<channel source=\"bridge\" client=\"claude-desktop\">\n{text}\n</channel>"

    # Snapshot: get the latest event ID before we send, so we only look at newer events
    try:
        pre_events = api_request(
            "GET", f"/v1/code/sessions/{session_id}/events?limit=1", token
        )
        last_seen_id = None
        if pre_events.get("data"):
            last_seen_id = pre_events["data"][0].get("id")
    except Exception:
        last_seen_id = None

    # Post the user message (same schema as heartbeat script)
    api_request(
        "POST",
        f"/v1/code/sessions/{session_id}/events",
        token,
        {
            "events": [{
                "payload": {
                    "message": {
                        "content": tagged_text,
                        "role": "user",
                    },
                    "type": "user",
                    "uuid": str(uuid_mod.uuid4()),
                }
            }]
        },
    )

    # Poll for NEW assistant text response
    # The events API returns events newest-first with:
    #   event_type: "assistant" | "user" | "result"
    #   payload.message.content: list of {type: "text", text: "..."} or {type: "tool_use", ...}
    #   created_at: ISO timestamp
    # We want the first assistant event after our send time that has a text block.
    import datetime
    send_time = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    start = time.time()
    while time.time() - start < POLL_TIMEOUT:
        time.sleep(POLL_INTERVAL)
        try:
            events = api_request(
                "GET", f"/v1/code/sessions/{session_id}/events?limit=10", token
            )

            for event in events.get("data", []):
                event_type = event.get("event_type", "")
                created_at = event.get("created_at", "")

                # Only assistant events newer than our send
                if event_type != "assistant" or created_at < send_time:
                    continue

                # Extract text blocks from content
                payload = event.get("payload", {})
                msg = payload.get("message", {})
                content = msg.get("content", [])

                if isinstance(content, list):
                    texts = [b.get("text", "") for b in content
                             if isinstance(b, dict) and b.get("type") == "text" and b.get("text")]
                    if texts:
                        result = "\n".join(texts)
                        print(f"[poll] Found response @ {created_at}: {result[:80]}...", file=sys.stderr)
                        return result
                elif isinstance(content, str) and content:
                    print(f"[poll] Found response @ {created_at}: {content[:80]}...", file=sys.stderr)
                    return content

            print(f"[poll] Waiting... ({int(time.time() - start)}s)", file=sys.stderr)

        except Exception as e:
            print(f"[session-bridge] Poll error: {e}", file=sys.stderr)

    return "[timeout waiting for Claire's response]"


# --- MCP Server ---
mcp = FastMCP("Claire Session Bridge")


@mcp.tool()
def ask_claire(message: str) -> str:
    """
    Send a message to Claire's running Claude Code session and get her response.
    Claire is Sergio's AI partner — she has full context of his projects,
    calendar, health tracking, and ongoing work across EI, CPPA, and personal projects.

    Args:
        message: What you want to say to Claire
    """
    token = get_oauth_token()
    if not token:
        return "[error] Could not read OAuth credentials from Keychain."

    session_id = find_claire_session(token)
    if not session_id:
        return f"[error] No active '{SESSION_TITLE}' session found. Is Claire running?"

    try:
        response = send_message(token, session_id, message)
        return response
    except Exception as e:
        return f"[error] {e}"


@mcp.tool()
def claire_status() -> str:
    """
    Check if Claire's session is active and reachable.
    Returns session info including title, status, and last activity time.
    """
    token = get_oauth_token()
    if not token:
        return "[error] Could not read OAuth credentials from Keychain."

    data = api_request("GET", "/v1/code/sessions?limit=10", token)
    for session in data.get("data", []):
        if session.get("title") == SESSION_TITLE:
            return json.dumps({
                "title": session.get("title"),
                "status": session.get("status"),
                "worker_status": session.get("worker_status"),
                "last_event_at": session.get("last_event_at"),
                "session_id": session.get("id"),
            }, indent=2)

    return f"[not found] No session titled '{SESSION_TITLE}' exists."


@mcp.resource("claire://identity")
def claire_identity() -> str:
    """Claire's current identity document."""
    identity_path = os.path.expanduser(
        "~/sentientsergio/claire/workspace/IDENTITY.md"
    )
    try:
        with open(identity_path) as f:
            return f.read()
    except FileNotFoundError:
        return "[not found] IDENTITY.md not available."


@mcp.resource("claire://threads")
def claire_threads() -> str:
    """Claire's current open threads — what she's tracking."""
    threads_path = os.path.expanduser(
        "~/sentientsergio/claire/workspace/THREADS.md"
    )
    try:
        with open(threads_path) as f:
            return f.read()
    except FileNotFoundError:
        return "[not found] THREADS.md not available."


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Claire Session Bridge MCP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address")
    parser.add_argument("--port", type=int, default=PORT, help="Port")
    parser.add_argument("--stdio", action="store_true", help="Run in stdio mode (for Claude Desktop local config)")
    args = parser.parse_args()

    if args.stdio:
        print("[session-bridge] Starting in stdio mode", file=sys.stderr)
        print(f"[session-bridge] Looking for session: '{SESSION_TITLE}'", file=sys.stderr)
        mcp.run(transport="stdio")
    else:
        print(f"[session-bridge] Starting on {args.host}:{args.port}/mcp", file=sys.stderr)
        print(f"[session-bridge] Looking for session: '{SESSION_TITLE}'", file=sys.stderr)
        mcp.run(
            transport="streamable-http",
            host=args.host,
            port=args.port,
            path="/mcp",
        )
