"""
Claire Telegram Channel — MCP Server

Lightweight Telegram channel plugin for Claire's Claude Code session.

Inbound:  Telegram Bot API → Sessions API injection (same pattern as heartbeat)
Outbound: MCP tools (telegram_reply, telegram_send_voice, telegram_send_photo)

Usage:
    python server.py                    # http://localhost:18794/mcp
    python server.py --host 0.0.0.0     # Tailscale-accessible
    python server.py --stdio            # stdio mode for .mcp.json command transport
"""

import json
import os
import subprocess
import sys
import threading
import time
import uuid as uuid_mod
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import telebot
from fastmcp import FastMCP

# --- Configuration ---
PORT = int(os.environ.get("TELEGRAM_MCP_PORT", "18794"))
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
OWNER_ID = int(os.environ.get("TELEGRAM_OWNER_ID", "0"))
SESSION_TITLE = os.environ.get("CLAIRE_SESSION_TITLE", "Claire")
WORKSPACE_PATH = os.environ.get(
    "CLAIRE_WORKSPACE",
    os.path.expanduser("~/sentientsergio/claire/workspace"),
)
SCRIPTS_PATH = os.environ.get(
    "CLAIRE_SCRIPTS",
    os.path.expanduser("~/sentientsergio/claire/scripts"),
)

API_BASE = "https://api.anthropic.com"
API_VERSION = "2023-06-01"
TELEGRAM_MAX_LENGTH = 4096

LOG_PREFIX = "[telegram-mcp]"


def log(msg: str) -> None:
    print(f"{LOG_PREFIX} {msg}", file=sys.stderr, flush=True)


# ──────────────────────────────────────────────
# Sessions API helpers (same pattern as session-bridge and heartbeat)
# ──────────────────────────────────────────────

def get_oauth_token() -> Optional[str]:
    """Read OAuth token from macOS Keychain."""
    try:
        creds_raw = subprocess.check_output(
            ["security", "find-generic-password", "-a", os.environ["USER"],
             "-s", "Claude Code-credentials", "-w"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        return json.loads(creds_raw)["claudeAiOauth"]["accessToken"]
    except Exception as e:
        log(f"Failed to read OAuth token: {e}")
        return None


def api_request(method: str, path: str, token: str, body: dict = None) -> dict:
    """Authenticated request to the Anthropic Sessions API."""
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
        raise RuntimeError(f"API {method} {path} → {e.code}: {error_body}")


def find_claire_session(token: str) -> Optional[str]:
    """Find the active Claire session by title."""
    data = api_request("GET", "/v1/code/sessions?limit=10", token)
    for session in data.get("data", []):
        if session.get("title") == SESSION_TITLE and session.get("status") == "active":
            return session["id"]
    return None


def inject_message(text: str) -> bool:
    """Inject a user message into Claire's Claude Code session. Returns True on success."""
    token = get_oauth_token()
    if not token:
        log("Cannot inject — no OAuth token")
        return False

    session_id = find_claire_session(token)
    if not session_id:
        log(f"Cannot inject — no active '{SESSION_TITLE}' session")
        return False

    try:
        api_request(
            "POST",
            f"/v1/code/sessions/{session_id}/events",
            token,
            {
                "events": [{
                    "payload": {
                        "message": {
                            "content": text,
                            "role": "user",
                        },
                        "type": "user",
                        "uuid": str(uuid_mod.uuid4()),
                    }
                }]
            },
        )
        log(f"Injected message ({len(text)} chars) into session {session_id[:20]}...")
        return True
    except Exception as e:
        log(f"Injection failed: {e}")
        return False


# ──────────────────────────────────────────────
# Telegram bot (inbound: Telegram → Claire session)
# ──────────────────────────────────────────────

bot = telebot.TeleBot(TELEGRAM_TOKEN, threaded=True) if TELEGRAM_TOKEN else None


def is_owner(message) -> bool:
    return message.from_user and message.from_user.id == OWNER_ID


def send_to_owner(text: str) -> bool:
    """Send a text message to the owner, splitting if needed."""
    if not bot:
        log("Bot not initialized")
        return False
    try:
        for chunk in split_message(text):
            bot.send_message(OWNER_ID, chunk)
        return True
    except Exception as e:
        log(f"Failed to send to owner: {e}")
        return False


def send_voice_to_owner(ogg_path: str) -> bool:
    """Send an OGG voice note to the owner."""
    if not bot:
        return False
    try:
        with open(ogg_path, "rb") as f:
            bot.send_voice(OWNER_ID, f)
        return True
    except Exception as e:
        log(f"Failed to send voice: {e}")
        return False


def send_photo_to_owner(photo_path: str, caption: str = "") -> bool:
    """Send a photo to the owner."""
    if not bot:
        return False
    try:
        with open(photo_path, "rb") as f:
            bot.send_photo(OWNER_ID, f, caption=caption[:1024] if caption else None)
        return True
    except Exception as e:
        log(f"Failed to send photo: {e}")
        return False


def split_message(text: str) -> list[str]:
    """Split text into Telegram-safe chunks."""
    if len(text) <= TELEGRAM_MAX_LENGTH:
        return [text]

    chunks = []
    remaining = text
    while remaining:
        if len(remaining) <= TELEGRAM_MAX_LENGTH:
            chunks.append(remaining)
            break

        split_at = remaining.rfind("\n\n", 0, TELEGRAM_MAX_LENGTH)
        if split_at == -1 or split_at < TELEGRAM_MAX_LENGTH // 2:
            split_at = remaining.rfind("\n", 0, TELEGRAM_MAX_LENGTH)
        if split_at == -1 or split_at < TELEGRAM_MAX_LENGTH // 2:
            split_at = remaining.rfind(" ", 0, TELEGRAM_MAX_LENGTH)
        if split_at == -1:
            split_at = TELEGRAM_MAX_LENGTH

        chunks.append(remaining[:split_at])
        remaining = remaining[split_at:].lstrip()

    return chunks


if bot:
    @bot.message_handler(func=lambda m: not is_owner(m))
    def drop_non_owner(message):
        pass

    @bot.message_handler(content_types=["text"])
    def handle_text(message):
        text = message.text
        log(f"Received text: \"{text[:60]}...\"" if len(text) > 60 else f"Received text: \"{text}\"")

        tagged = f"[via telegram] {text}"
        if not inject_message(tagged):
            bot.reply_to(message, "I couldn't reach Claire's session right now. Is she running?")

    @bot.message_handler(content_types=["voice"])
    def handle_voice(message):
        log(f"Received voice ({message.voice.duration}s)")

        try:
            file_info = bot.get_file(message.voice.file_id)
            downloaded = bot.download_file(file_info.file_path)

            ogg_path = f"/tmp/telegram-voice-{int(time.time())}.ogg"
            with open(ogg_path, "wb") as f:
                f.write(downloaded)

            transcribe_script = os.path.join(SCRIPTS_PATH, "voice-transcribe.sh")
            result = subprocess.run(
                ["bash", transcribe_script, ogg_path],
                capture_output=True, text=True, timeout=30,
            )

            if result.returncode == 0 and result.stdout.strip():
                transcription = result.stdout.strip()
                log(f"Transcribed: \"{transcription[:60]}...\"" if len(transcription) > 60 else f"Transcribed: \"{transcription}\"")
                tagged = f"[via telegram] [Voice message transcription]: {transcription}"
            else:
                log(f"Transcription failed: {result.stderr}")
                tagged = "[via telegram] [Voice message received — transcription failed. Ask the user to resend as text.]"

            if not inject_message(tagged):
                bot.reply_to(message, "I couldn't reach Claire's session right now.")

        except Exception as e:
            log(f"Voice handling error: {e}")
            bot.reply_to(message, "Sorry, I had trouble processing that voice message.")
        finally:
            try:
                os.unlink(ogg_path)
            except Exception:
                pass

    @bot.message_handler(content_types=["photo"])
    def handle_photo(message):
        caption = message.caption or ""
        photos = message.photo
        largest = photos[-1]
        log(f"Received photo ({largest.width}x{largest.height})")

        try:
            file_info = bot.get_file(largest.file_id)
            downloaded = bot.download_file(file_info.file_path)

            ext = ".jpg"
            if file_info.file_path and file_info.file_path.endswith(".png"):
                ext = ".png"

            ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            images_dir = Path(WORKSPACE_PATH) / "images"
            images_dir.mkdir(parents=True, exist_ok=True)
            save_path = images_dir / f"telegram-{ts}{ext}"

            with open(save_path, "wb") as f:
                f.write(downloaded)

            log(f"Saved photo to {save_path}")

            caption_part = f" {caption}" if caption else " (Photo shared without caption)"
            tagged = f"[via telegram] [Photo saved to {save_path}]{caption_part}"

            if not inject_message(tagged):
                bot.reply_to(message, "I couldn't reach Claire's session right now.")

        except Exception as e:
            log(f"Photo handling error: {e}")
            bot.reply_to(message, "Sorry, I had trouble processing that photo.")

    @bot.message_handler(content_types=["document"])
    def handle_document(message):
        doc = message.document
        caption = message.caption or ""
        log(f"Received document: {doc.file_name} ({doc.mime_type})")

        caption_part = f"\n\n{caption}" if caption else "\n\n(Document shared without additional text.)"
        tagged = f"[via telegram] [Attached document: {doc.file_name} ({doc.mime_type})]{caption_part}"

        if not inject_message(tagged):
            bot.reply_to(message, "I couldn't reach Claire's session right now.")


# ──────────────────────────────────────────────
# MCP tools (outbound: Claire session → Telegram)
# ──────────────────────────────────────────────

mcp = FastMCP("Claire Telegram Channel")


@mcp.tool()
def telegram_reply(text: str) -> str:
    """
    Send a text message to Sergio on Telegram. Use this to respond to
    Telegram messages or send proactive messages. Long messages are
    automatically split to fit Telegram's limits.

    Args:
        text: The message text to send
    """
    if not bot:
        return "[error] Telegram bot not configured."
    if send_to_owner(text):
        log(f"Sent reply ({len(text)} chars)")
        return f"[sent] Message delivered ({len(text)} chars)"
    return "[error] Failed to send message to Telegram."


@mcp.tool()
def telegram_send_voice(text: str) -> str:
    """
    Synthesize text to speech and send it as a Telegram voice note.
    Use when you want to reply with voice instead of text — for example,
    when Sergio sent a voice message and a voice reply feels natural.

    Args:
        text: The text to speak
    """
    if not bot:
        return "[error] Telegram bot not configured."

    synth_script = os.path.join(SCRIPTS_PATH, "voice-synthesize.sh")
    if not os.path.exists(synth_script):
        return f"[error] voice-synthesize.sh not found at {synth_script}"

    try:
        result = subprocess.run(
            ["bash", synth_script, text],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return f"[error] TTS failed: {result.stderr}"

        ogg_path = result.stdout.strip()
        if not ogg_path or not os.path.exists(ogg_path):
            return "[error] TTS produced no output file."

        if send_voice_to_owner(ogg_path):
            log(f"Sent voice note ({len(text)} chars of text)")
            return "[sent] Voice note delivered."

        return "[error] Failed to send voice note."

    except subprocess.TimeoutExpired:
        return "[error] TTS timed out."
    except Exception as e:
        return f"[error] {e}"
    finally:
        try:
            if ogg_path and os.path.exists(ogg_path):
                os.unlink(ogg_path)
        except Exception:
            pass


@mcp.tool()
def telegram_send_photo(file_path: str, caption: str = "") -> str:
    """
    Send a photo to Sergio on Telegram from a workspace file path.

    Args:
        file_path: Absolute path to the image file to send
        caption: Optional caption for the photo (max 1024 chars)
    """
    if not bot:
        return "[error] Telegram bot not configured."
    if not os.path.exists(file_path):
        return f"[error] File not found: {file_path}"

    if send_photo_to_owner(file_path, caption):
        log(f"Sent photo: {file_path}")
        return f"[sent] Photo delivered: {os.path.basename(file_path)}"
    return "[error] Failed to send photo."


# ──────────────────────────────────────────────
# Startup
# ──────────────────────────────────────────────

def start_bot_polling():
    """Run Telegram bot polling in a background thread."""
    if not bot:
        log("No TELEGRAM_BOT_TOKEN — bot polling disabled")
        return
    if not OWNER_ID:
        log("No TELEGRAM_OWNER_ID — bot polling disabled")
        return

    def poll():
        log(f"Bot polling started (owner: {OWNER_ID})")
        try:
            bot.infinity_polling(timeout=30, long_polling_timeout=30)
        except Exception as e:
            log(f"Bot polling crashed: {e}")

    thread = threading.Thread(target=poll, daemon=True, name="telegram-bot")
    thread.start()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Claire Telegram Channel MCP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address")
    parser.add_argument("--port", type=int, default=PORT, help="Port")
    parser.add_argument("--stdio", action="store_true",
                        help="Run in stdio mode (for .mcp.json command transport)")
    args = parser.parse_args()

    start_bot_polling()

    if args.stdio:
        log("Starting MCP in stdio mode")
        mcp.run(transport="stdio")
    else:
        log(f"Starting MCP on {args.host}:{args.port}/mcp")
        mcp.run(
            transport="streamable-http",
            host=args.host,
            port=args.port,
            path="/mcp",
        )
