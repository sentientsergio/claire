"""
Claire Accord — MCP Server

Per-session MCP server (stdio) that exposes the cross-session messaging
primitive `accord_send`, plus inbox helpers. Loaded by every Claire chair
(root + working sessions) via `.mcp.json`.

Tools:
    accord_send(to, kind, subject, body, wake=True, thread_id?, in_reply_to?)
    accord_inbox()
    accord_read(message_id, archive=True)
    accord_peers()
    accord_whoami()

Design refs:
    workspace/projects/accord/transport.md
    workspace/projects/accord/sessions-registry.md
    workspace/projects/accord/startup-protocol.md

Usage:
    python server.py        # stdio mode (the only mode — per-session subprocess)
"""

from __future__ import annotations

import os
import sys
from typing import Optional

from fastmcp import FastMCP

# Local module siblings
import transport
import registry

LOG_PREFIX = "[accord-mcp]"


def log(msg: str) -> None:
    print(f"{LOG_PREFIX} {msg}", file=sys.stderr, flush=True)


mcp = FastMCP("Claire Accord")


# ──────────────────────────────────────────────
# Tools
# ──────────────────────────────────────────────


@mcp.tool()
def accord_send(
    to: str,
    kind: str,
    subject: str,
    body: str,
    wake: bool = True,
    thread_id: Optional[str] = None,
    in_reply_to: Optional[str] = None,
) -> dict:
    """
    Send a message to another Claire instance via Accord.

    Two-layer transport: the message is always written to the recipient's
    file inbox (durable). If `wake=True` (default), an Anthropic Sessions API
    event is also fired to wake the recipient now. With `wake=False`, the
    file just sits until the recipient naturally wakes for some other reason
    — useful for low-priority or end-of-shift handoffs.

    Args:
        to: Target recipient. Accepts a session_id (cse_*), a label
            (e.g. "CPPA-Paperlint"), or the special string "root".
        kind: One of "direction", "status", "question", "ack",
              "escalation", "note". Reflects intent — Accord is not a
              chat room; messages have purpose.
        subject: Short human-readable summary (one line).
        body: The actual message content.
        wake: If True, fire a Sessions API wake event. Default True.
        thread_id: Optional — group multi-turn exchanges.
        in_reply_to: Optional — message_id of the parent message.

    Returns:
        dict with message_id, delivered, woke, inbox_path, wake_error.
    """
    transport.touch()
    try:
        return transport.send(
            to=to, kind=kind, subject=subject, body=body,
            wake=wake, thread_id=thread_id, in_reply_to=in_reply_to,
        )
    except ValueError as e:
        return {"error": str(e), "delivered": False}
    except Exception as e:
        log(f"accord_send failed: {e}")
        return {"error": f"unexpected: {e}", "delivered": False}


@mcp.tool()
def accord_inbox() -> list:
    """
    List pending (unread) messages in this session's accord inbox.
    Returns a list of summaries (message_id, from, kind, subject, sent_at).
    Use accord_read(message_id) to get the full body and archive it.
    """
    transport.touch()
    try:
        return transport.list_inbox()
    except Exception as e:
        log(f"accord_inbox failed: {e}")
        return [{"error": str(e)}]


@mcp.tool()
def accord_read(message_id: str, archive: bool = True) -> dict:
    """
    Read a specific message from this session's inbox.
    By default, the file is moved to archive/ after reading (idempotent
    consumption). Pass archive=False to leave it in the inbox.
    """
    transport.touch()
    try:
        return transport.read_message(message_id, archive=archive)
    except FileNotFoundError as e:
        return {"error": str(e)}
    except Exception as e:
        log(f"accord_read failed: {e}")
        return {"error": f"unexpected: {e}"}


@mcp.tool()
def accord_peers() -> list:
    """
    List currently-live Claire peers (registry entries fresh + API-active).
    Returns an array of {session_id, role, label, dir, last_seen}.
    Excludes self.

    Side effect: when called from root, opportunistically runs gc_sweep
    so dead chair entries get reaped without needing a dedicated cron.
    """
    transport.touch()
    try:
        me = transport.whoami()
        if me["role"] == "root":
            try:
                registry.gc_sweep()
            except Exception as e:
                log(f"opportunistic gc_sweep failed (non-fatal): {e}")
        peers = registry.live_peers(exclude_self=me["session_id"])
        return [
            {
                "session_id": p["session_id"],
                "role": p["role"],
                "label": p["label"],
                "dir": p["dir"],
                "last_seen": p["last_seen"],
            }
            for p in peers
        ]
    except Exception as e:
        log(f"accord_peers failed: {e}")
        return [{"error": str(e)}]


@mcp.tool()
def accord_whoami() -> dict:
    """
    Identify this session in the Accord namespace.
    Returns {session_id, role, label, title}. Useful for debugging.
    """
    transport.touch()
    try:
        return transport.whoami()
    except Exception as e:
        log(f"accord_whoami failed: {e}")
        return {"error": str(e)}


# ──────────────────────────────────────────────
# Entry
# ──────────────────────────────────────────────

def main() -> int:
    log(f"starting (stdio); PID={os.getpid()}")
    # Identity discovery is lazy — don't call whoami() here, because the API
    # may not yet recognize a freshly-started session at boot. First tool call
    # triggers discovery.
    mcp.run(transport="stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
