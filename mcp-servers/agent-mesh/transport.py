"""
Agent-mesh transport — file-mailbox + Sessions API wake.

Two-layer design:

    1. Mailbox  — JSON envelope written to inbox/<recipient_session_id>/
    2. Wake     — optional Sessions API event poking the recipient

The MCP tool layer (server.py) is a thin wrapper around `send()` here.

Data location: configurable via MESH_DATA_DIR env var. Defaults to the
legacy path ${HOME}/sentientsergio/claire/workspace/projects/accord/ for
backward compatibility — existing inboxes and archives are read in place.
"""

from __future__ import annotations

import json
import os
import secrets
import uuid as uuid_mod
from pathlib import Path
from typing import List, Optional

from registry import (
    CLAIRE_DIR,
    api_request,
    read_registry,
    utc_now_iso,
)

# --- Paths ---

# MESH_DATA_DIR is the configurable root for inbox/archive storage. Default
# is the legacy path so existing data continues to be read in place.
MESH_DATA_DIR = Path(os.environ.get(
    "MESH_DATA_DIR",
    str(CLAIRE_DIR / "workspace" / "projects" / "accord")
))
INBOX_ROOT = MESH_DATA_DIR / "inbox"
ARCHIVE_ROOT = MESH_DATA_DIR / "archive"

VALID_KINDS = {"direction", "status", "question", "ack", "escalation", "note"}


# --- Identity (lazy + cached) ---

_self_identity: Optional[dict] = None


def _infer_role_label(title: str) -> tuple[str, str]:
    """
    Default mapping from --remote-control title:
        'Claire'                 → ('root',    'Claire')
        'Claire CPPA-Paperlint'  → ('working', 'CPPA-Paperlint')
        'Code engineer'          → ('working', 'Code engineer')
        anything else            → ('working', title)
    Overridable via MESH_ROLE / MESH_LABEL (or legacy ACCORD_ROLE / ACCORD_LABEL).
    """
    if title == "Claire":
        return "root", "Claire"
    if title.startswith("Claire "):
        return "working", title[len("Claire "):]
    return "working", title


def whoami() -> dict:
    """
    Discover (and cache) own identity. Returns:
        {"session_id": "cse_...", "role": "root"|"working",
         "title": "...", "label": "..."}
    """
    global _self_identity
    if _self_identity is not None:
        return _self_identity

    # Title comes from launcher env var. MESH_TITLE is the new explicit name;
    # ACCORD_TITLE is supported for backward compatibility during the transition;
    # CLAIRE_SESSION_TITLE is the legacy convention from the telegram MCP.
    title = (os.environ.get("MESH_TITLE")
             or os.environ.get("ACCORD_TITLE")
             or os.environ.get("CLAIRE_SESSION_TITLE")
             or "Claire")

    # Role and label can be set explicitly; otherwise derive from title.
    inferred_role, inferred_label = _infer_role_label(title)
    role = (os.environ.get("MESH_ROLE")
            or os.environ.get("ACCORD_ROLE")
            or inferred_role)
    label = (os.environ.get("MESH_LABEL")
             or os.environ.get("ACCORD_LABEL")
             or inferred_label)

    # Late import to avoid circulars and to keep the module fast at boot.
    from registry import discover_self_cse
    cse = discover_self_cse(title)

    _self_identity = {
        "session_id": cse,
        "role": role,
        "title": title,
        "label": label,
    }

    # Auto-register self in the sessions registry, and arm graceful-shutdown
    # deregister. Identity discovery is the natural moment for both — by the
    # time we have a cse_*, we know enough to publish ourselves to peers.
    _publish_identity(_self_identity)

    return _self_identity


def _publish_identity(identity: dict) -> None:
    """Register self in the sessions registry and install atexit deregister.

    Failures here are non-fatal — better a working tool with no registry
    presence than a broken tool because publishing failed. Logged to stderr.
    """
    import atexit
    import sys
    from registry import register_self, unregister_self

    sid = identity["session_id"]
    try:
        register_self(
            session_id=sid,
            role=identity["role"],
            dir_=os.getcwd(),
            label=identity["label"],
            pid=os.getpid(),
            notes="auto-registered on identity discovery",
        )
    except Exception as e:
        sys.stderr.write(f"[agent-mesh.transport] auto-register failed: {e}\n")
        return

    def _deregister_on_exit() -> None:
        try:
            unregister_self(sid)
        except Exception:
            pass  # best-effort during shutdown
    atexit.register(_deregister_on_exit)


def touch() -> None:
    """Bump own last_seen in the registry. Debounced inside bump_last_seen
    (default 5min), so cheap to call from every tool entry. Silent on
    failure — liveness is best-effort and must not break tool calls."""
    import sys
    from registry import bump_last_seen
    try:
        identity = whoami()
        bump_last_seen(identity["session_id"])
    except Exception as e:
        sys.stderr.write(f"[agent-mesh.transport] touch failed: {e}\n")


# --- Target resolution ---

def resolve_target(to: str) -> dict:
    """
    Accept a session_id, label, or the special string "root".
    Returns a registry entry dict for the resolved target, or raises ValueError.
    """
    if not to:
        raise ValueError("'to' is required")
    data = read_registry()
    sessions = data.get("sessions", [])

    # Exact session_id match
    for s in sessions:
        if s["session_id"] == to:
            return s

    # Special "root"
    if to == "root":
        for s in sessions:
            if s["role"] == "root":
                return s
        raise ValueError("no root in registry")

    # Label match (case-sensitive; could relax later)
    matches = [s for s in sessions if s.get("label") == to]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        ids = ", ".join(s["session_id"] for s in matches)
        raise ValueError(f"label {to!r} matches multiple sessions: {ids}")

    raise ValueError(f"could not resolve target: {to!r}")


# --- Message envelope ---

def _new_message_id() -> str:
    return "msg_" + secrets.token_urlsafe(16)


def build_envelope(*, sender: dict, target: dict, kind: str, subject: str,
                   body: str, wake: bool, thread_id: Optional[str],
                   in_reply_to: Optional[str]) -> dict:
    if kind not in VALID_KINDS:
        raise ValueError(f"invalid kind {kind!r} (must be one of {sorted(VALID_KINDS)})")
    return {
        "accord_version": "1",
        "message_id": _new_message_id(),
        "from": {
            "session_id": sender["session_id"],
            "role": sender["role"],
            "label": sender["label"],
        },
        "to": {
            "session_id": target["session_id"],
            "label": target.get("label"),
        },
        "sent_at": utc_now_iso(),
        "kind": kind,
        "subject": subject,
        "body": body,
        "thread_id": thread_id,
        "in_reply_to": in_reply_to,
        "wake_requested": wake,
    }


def _wake_text(envelope: dict) -> str:
    """
    The thin notification injected into the recipient's session via the
    Sessions API. Tagged so the recipient never confuses it with Sergio.
    """
    msg_id = envelope["message_id"]
    sender = envelope["from"]
    recipient_id = envelope["to"]["session_id"]
    inbox_path = str(INBOX_ROOT / recipient_id / f"{msg_id}.json")
    return (
        f'<accord from="{sender["role"]}" '
        f'session="{sender["session_id"]}" '
        f'label="{sender["label"]}" '
        f'message_id="{msg_id}">\n'
        f"New accord message. kind={envelope['kind']}, "
        f"subject={json.dumps(envelope['subject'])}.\n"
        f"Read: {inbox_path}\n"
        f"</accord>"
    )


def _write_to_inbox(envelope: dict) -> Path:
    inbox = INBOX_ROOT / envelope["to"]["session_id"]
    inbox.mkdir(parents=True, exist_ok=True)
    out = inbox / f"{envelope['message_id']}.json"
    out.write_text(json.dumps(envelope, indent=2))
    return out


def _fire_wake(envelope: dict) -> None:
    """POST a tagged user message into the recipient's Sessions API session."""
    api_request(
        "POST",
        f"/v1/code/sessions/{envelope['to']['session_id']}/events",
        body={
            "events": [{
                "payload": {
                    "message": {
                        "content": _wake_text(envelope),
                        "role": "user",
                    },
                    "type": "user",
                    "uuid": str(uuid_mod.uuid4()),
                }
            }]
        },
    )


# --- Public API ---

def send(*, to: str, kind: str, subject: str, body: str,
         wake: bool = True, thread_id: Optional[str] = None,
         in_reply_to: Optional[str] = None) -> dict:
    """
    Drop a message in the recipient's inbox; optionally fire an API wake.

    Returns a result dict:
        {"message_id": str, "delivered": bool, "woke": bool,
         "inbox_path": str, "wake_error": str | None}

    File write is the commit. Wake is a separate, optional step — if it
    fails, the message is still delivered; the recipient picks it up on
    natural wake.
    """
    sender = whoami()
    target = resolve_target(to)

    envelope = build_envelope(
        sender=sender, target=target,
        kind=kind, subject=subject, body=body,
        wake=wake, thread_id=thread_id, in_reply_to=in_reply_to,
    )

    try:
        path = _write_to_inbox(envelope)
    except OSError as e:
        return {
            "message_id": envelope["message_id"],
            "delivered": False,
            "woke": False,
            "inbox_path": None,
            "wake_error": None,
            "error": f"inbox write failed: {e}",
        }

    woke = False
    wake_error: Optional[str] = None
    if wake:
        try:
            _fire_wake(envelope)
            woke = True
        except Exception as e:
            wake_error = str(e)

    return {
        "message_id": envelope["message_id"],
        "delivered": True,
        "woke": woke,
        "inbox_path": str(path),
        "wake_error": wake_error,
    }


# --- Inbox processing ---

def list_inbox() -> List[dict]:
    """Return summaries of pending (un-archived) messages in own inbox."""
    me = whoami()
    inbox = INBOX_ROOT / me["session_id"]
    if not inbox.exists():
        return []
    out = []
    for path in sorted(inbox.glob("*.json")):
        try:
            env = json.loads(path.read_text())
        except Exception:
            continue
        out.append({
            "message_id": env.get("message_id"),
            "from": env.get("from"),
            "kind": env.get("kind"),
            "subject": env.get("subject"),
            "sent_at": env.get("sent_at"),
            "in_reply_to": env.get("in_reply_to"),
            "path": str(path),
        })
    return out


def read_message(message_id: str, *, archive: bool = True) -> dict:
    """Read a message from own inbox, optionally moving it to archive."""
    me = whoami()
    inbox = INBOX_ROOT / me["session_id"]
    src = inbox / f"{message_id}.json"
    if not src.exists():
        raise FileNotFoundError(f"no such message {message_id} in own inbox")
    env = json.loads(src.read_text())
    if archive:
        ym = env.get("sent_at", "0000-00")[:7]   # YYYY-MM
        dst_dir = ARCHIVE_ROOT / me["session_id"] / ym
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / src.name
        src.rename(dst)
    return env
