"""
Agent-mesh sessions registry — reference implementation.

Helpers:
    - read_oauth_token()         : OAuth token from macOS Keychain
    - api_request()              : authenticated call to Sessions API
    - discover_self_cse(title)   : find this process's Sessions API ID (cse_*)
    - with_registry_lock()       : flock-protected read-modify-write
    - register_self(...)         : add/replace this chair's entry
    - unregister_self(...)       : remove this chair's entry on graceful exit
    - bump_last_seen(...)        : refresh liveness timestamp
    - live_peers(...)            : enumerate currently-live peers
    - gc_sweep()                 : reap stale entries (root only)

Stdlib only. Python 3.9+. No third-party dependencies — this is the substrate
every code-agent session uses on startup, so it must not require a venv.

Addressable session IDs are **Sessions API IDs** (cse_*), not the local CLI
session UUIDs. The registry file is shared with transport.py via MESH_DATA_DIR.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, List, Optional

# --- Paths ---

CLAIRE_DIR = Path(os.environ.get("CLAIRE_DIR", Path.home() / "sentientsergio" / "claire"))

# MESH_DATA_DIR is the shared data root for inbox/archive (transport.py) and
# the sessions registry (this file). Default is the legacy path so existing
# data continues to be read in place.
MESH_DATA_DIR = Path(os.environ.get(
    "MESH_DATA_DIR",
    str(CLAIRE_DIR / "workspace" / "projects" / "accord")
))
REGISTRY = MESH_DATA_DIR / "sessions-registry.json"
REGISTRY_LOCK = REGISTRY.with_suffix(".json.lock")

# --- API ---
# Override Anthropic API base for testing/sandboxes. Both env var names work
# during the agent-mesh transition.
API_BASE = (os.environ.get("MESH_API_BASE")
            or os.environ.get("ACCORD_API_BASE")
            or "https://api.anthropic.com")
API_VERSION = "2023-06-01"

# --- Thresholds ---

STALE_THRESHOLD_SECONDS = 15 * 60   # 15 min — per sessions-registry.md
LOCK_TIMEOUT_SECONDS = 2
DEFAULT_BUMP_DEBOUNCE_SECONDS = 5 * 60  # don't rewrite if last_seen bumped <5 min ago


# --- Time helpers ---

def utc_now_iso() -> str:
    """ISO-8601 UTC with trailing Z — matches API convention."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        # Accept either "...Z" or "...+00:00"
        s = ts.replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _age_seconds(ts: str, now: Optional[datetime] = None) -> float:
    parsed = _parse_iso(ts)
    if not parsed:
        return float("inf")
    now = now or datetime.now(timezone.utc)
    return (now - parsed).total_seconds()


# --- Auth ---

def read_oauth_token() -> str:
    """Read Claude Code OAuth access token from macOS Keychain."""
    try:
        raw = subprocess.check_output(
            ["security", "find-generic-password",
             "-a", os.environ.get("USER", ""),
             "-s", "Claude Code-credentials", "-w"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"keychain read failed: {e}")
    try:
        return json.loads(raw)["claudeAiOauth"]["accessToken"]
    except (KeyError, json.JSONDecodeError) as e:
        raise RuntimeError(f"could not parse Keychain credential blob: {e}")


# --- API helper ---

def api_request(method: str, path: str, *, token: Optional[str] = None,
                body: Optional[dict] = None, timeout: float = 10.0) -> dict:
    """Authenticated call to the Sessions API. Returns parsed JSON, or {} for 204."""
    token = token or read_oauth_token()
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "anthropic-version": API_VERSION,
    }
    data_bytes: Optional[bytes] = None
    if body is not None:
        data_bytes = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body_preview = e.read().decode("utf-8", errors="replace")[:300] if e.fp else ""
        raise RuntimeError(f"API {method} {path} -> {e.code}: {body_preview}")


# --- Self-discovery ---

def discover_self_cse(title: str, *, max_attempts: int = 5,
                      sleep_s: float = 1.0, token: Optional[str] = None) -> str:
    """
    Find this process's cse_* by matching --remote-control title.
    Among sessions with the matching title and status=active, pick the
    most recent last_event_at — that's the one a CLI is attached to.
    """
    token = token or read_oauth_token()
    last_err: Optional[Exception] = None
    for _ in range(max_attempts):
        try:
            data = api_request("GET", "/v1/code/sessions?limit=20", token=token)
        except Exception as e:
            last_err = e
            time.sleep(sleep_s)
            continue
        candidates = [
            s for s in data.get("data", [])
            if s.get("title") == title and s.get("status") == "active"
        ]
        if candidates:
            best = max(candidates, key=lambda s: s.get("last_event_at") or "")
            return best["id"]
        time.sleep(sleep_s)
    raise RuntimeError(
        f"could not find own cse_* for title={title!r} "
        f"(last error: {last_err})"
    )


# --- Registry file handling ---

_EMPTY_REGISTRY = {"schema_version": "1", "updated_at": "", "sessions": []}


def _ensure_registry_exists() -> None:
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    if not REGISTRY.exists():
        REGISTRY.write_text(json.dumps(_EMPTY_REGISTRY, indent=2))


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def read_registry() -> dict:
    """Read registry without taking a lock. For read-only callers."""
    _ensure_registry_exists()
    try:
        return json.loads(REGISTRY.read_text())
    except json.JSONDecodeError:
        # Corrupt file — return empty so callers can continue.
        sys.stderr.write(
            f"[agent-mesh.registry] WARN: registry file corrupt at {REGISTRY}, "
            f"treating as empty\n"
        )
        return dict(_EMPTY_REGISTRY, sessions=[])


@contextlib.contextmanager
def with_registry_lock(timeout: float = LOCK_TIMEOUT_SECONDS) -> Iterator[dict]:
    """
    Acquire advisory file lock, yield the parsed registry, write it back on
    successful exit. On lock timeout: raises TimeoutError so caller can degrade.

    Usage:
        with with_registry_lock() as data:
            data["sessions"].append(...)
            data["updated_at"] = utc_now_iso()
    """
    _ensure_registry_exists()
    REGISTRY_LOCK.touch(exist_ok=True)
    lock_fd = os.open(str(REGISTRY_LOCK), os.O_RDWR)
    deadline = time.monotonic() + timeout
    acquired = False
    try:
        while True:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"could not acquire registry lock within {timeout}s"
                    )
                time.sleep(0.05)

        try:
            data = json.loads(REGISTRY.read_text())
        except json.JSONDecodeError:
            data = dict(_EMPTY_REGISTRY, sessions=[])

        yield data

        _atomic_write(REGISTRY, json.dumps(data, indent=2))
    finally:
        if acquired:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


# --- Public operations ---

def register_self(session_id: str, role: str, dir_: str, label: str,
                  pid: Optional[int] = None, notes: Optional[str] = None) -> None:
    """
    Add or update self in the registry. Because cse_* changes on --resume,
    the lookup key is (dir, role): re-registering a chair replaces any prior
    entry with a stale cse_*.
    """
    if role not in ("root", "working"):
        raise ValueError(f"invalid role {role!r}")
    with with_registry_lock() as data:
        now = utc_now_iso()
        data["sessions"] = [
            s for s in data.get("sessions", [])
            if not (s.get("dir") == dir_ and s.get("role") == role)
        ]
        entry = {
            "session_id": session_id,
            "role": role,
            "dir": dir_,
            "label": label,
            "started_at": now,
            "last_seen": now,
        }
        if pid is not None:
            entry["host_pid_hint"] = pid
        if notes:
            entry["notes"] = notes
        data["sessions"].append(entry)
        data["updated_at"] = now


def unregister_self(session_id: str) -> None:
    """Remove own entry. Called on graceful shutdown."""
    with with_registry_lock() as data:
        before = len(data.get("sessions", []))
        data["sessions"] = [
            s for s in data.get("sessions", [])
            if s.get("session_id") != session_id
        ]
        if len(data["sessions"]) != before:
            data["updated_at"] = utc_now_iso()


def bump_last_seen(session_id: str, debounce_seconds: float = DEFAULT_BUMP_DEBOUNCE_SECONDS) -> bool:
    """
    Refresh last_seen on the given entry.
    Returns True if the file was updated, False if debounced (recent bump).
    """
    # Cheap read-only check first — avoid taking the lock if we'd be a no-op.
    current = read_registry()
    for s in current.get("sessions", []):
        if s.get("session_id") == session_id:
            age = _age_seconds(s.get("last_seen", ""))
            if age < debounce_seconds:
                return False
            break
    with with_registry_lock() as data:
        now = utc_now_iso()
        found = False
        for s in data.get("sessions", []):
            if s.get("session_id") == session_id:
                s["last_seen"] = now
                found = True
                break
        if found:
            data["updated_at"] = now
        return found


def _fetch_api_statuses(session_ids: List[str],
                       token: Optional[str] = None) -> dict:
    """
    Look up API status for each cse_*. Returns {session_id: status_string}.
    Missing or failed lookups yield "unknown" — callers decide how to handle.
    """
    if not session_ids:
        return {}
    token = token or read_oauth_token()
    # The list endpoint is paged & title-filtered by the client; safer to
    # fetch enough pages to cover recent sessions. For V1, request a generous
    # limit and filter client-side.
    try:
        data = api_request("GET", "/v1/code/sessions?limit=50", token=token)
    except Exception:
        return {sid: "unknown" for sid in session_ids}
    by_id = {s.get("id"): s.get("status", "unknown") for s in data.get("data", [])}
    return {sid: by_id.get(sid, "unknown") for sid in session_ids}


def live_peers(exclude_self: Optional[str] = None,
               role: Optional[str] = None) -> List[dict]:
    """
    Return registry entries that are (a) fresh in the registry and
    (b) reported active by the Sessions API. Pass `exclude_self=MY_CSE` to
    drop your own row; pass `role="working"` or `role="root"` to filter.
    """
    data = read_registry()
    entries = data.get("sessions", [])
    if role is not None:
        entries = [s for s in entries if s.get("role") == role]
    ids = [s["session_id"] for s in entries]
    statuses = _fetch_api_statuses(ids)
    out = []
    for s in entries:
        if _age_seconds(s.get("last_seen", "")) >= STALE_THRESHOLD_SECONDS:
            continue
        if statuses.get(s["session_id"]) != "active":
            continue
        if exclude_self and s["session_id"] == exclude_self:
            continue
        out.append(s)
    return out


def root_peer(exclude_self: Optional[str] = None) -> Optional[dict]:
    peers = live_peers(exclude_self=exclude_self, role="root")
    return peers[0] if peers else None


def working_peers(exclude_self: Optional[str] = None) -> List[dict]:
    return live_peers(exclude_self=exclude_self, role="working")


def gc_sweep() -> dict:
    """
    Reap stale entries. Called from root's hourly heartbeat.

    For each entry with last_seen older than STALE_THRESHOLD_SECONDS, consult
    the API:
        - status == "active"  → refresh last_seen (alive but missed a bump)
        - status != "active"  → remove the entry
        - unknown             → leave alone for this pass
    Returns a summary {"refreshed": n, "removed": n, "kept": n}.
    """
    summary = {"refreshed": 0, "removed": 0, "kept": 0}
    try:
        with with_registry_lock() as data:
            sessions = data.get("sessions", [])
            stale_ids = [
                s["session_id"] for s in sessions
                if _age_seconds(s.get("last_seen", "")) >= STALE_THRESHOLD_SECONDS
            ]
            if not stale_ids:
                summary["kept"] = len(sessions)
                return summary
            statuses = _fetch_api_statuses(stale_ids)
            now = utc_now_iso()
            kept = []
            for s in sessions:
                sid = s["session_id"]
                if _age_seconds(s.get("last_seen", "")) < STALE_THRESHOLD_SECONDS:
                    kept.append(s)
                    continue
                status = statuses.get(sid, "unknown")
                if status == "active":
                    s["last_seen"] = now
                    kept.append(s)
                    summary["refreshed"] += 1
                elif status == "unknown":
                    # API didn't answer; keep for another pass.
                    kept.append(s)
                else:
                    summary["removed"] += 1
            data["sessions"] = kept
            data["updated_at"] = now
            summary["kept"] = len(kept)
    except TimeoutError:
        sys.stderr.write("[agent-mesh.registry] gc_sweep: lock timeout, skipping\n")
    return summary


# --- CLI entry for ad-hoc exercise ---

def _cli() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Agent-mesh registry admin tool")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("show", help="Print registry contents")
    sub.add_parser("peers", help="Print live peers (registry + API cross-check)")
    sub.add_parser("gc", help="Run GC sweep and print summary")

    dsc = sub.add_parser("discover", help="Discover own cse_* by title")
    dsc.add_argument("title", help='--remote-control title, e.g. "Claire"')

    reg = sub.add_parser("register", help="Register a session (normally done internally)")
    reg.add_argument("--session-id", required=True)
    reg.add_argument("--role", choices=["root", "working"], required=True)
    reg.add_argument("--dir", required=True)
    reg.add_argument("--label", required=True)
    reg.add_argument("--pid", type=int, default=None)

    unreg = sub.add_parser("unregister", help="Remove a session from the registry")
    unreg.add_argument("--session-id", required=True)

    args = ap.parse_args()

    if args.cmd == "show":
        print(json.dumps(read_registry(), indent=2))
        return 0
    if args.cmd == "peers":
        for p in live_peers():
            print(f"{p['session_id']}  role={p['role']:<7}  label={p['label']:<24}  last_seen={p['last_seen']}  dir={p['dir']}")
        return 0
    if args.cmd == "gc":
        print(json.dumps(gc_sweep(), indent=2))
        return 0
    if args.cmd == "discover":
        cse = discover_self_cse(args.title)
        print(cse)
        return 0
    if args.cmd == "register":
        register_self(args.session_id, args.role, args.dir, args.label, pid=args.pid)
        return 0
    if args.cmd == "unregister":
        unregister_self(args.session_id)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(_cli())
