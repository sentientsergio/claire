# Claire — Roadmap

_Where we are, where we're going, and why._

_Last updated: 2026-03-26_

---

## Current State

Claire runs on Claude Code Max as a persistent session with Telegram and Discord channels. The migration from the custom gateway is substantially complete. Identity, memory, channels, and self-development all work. What remains is stabilization, completing migration loose ends, and then growing.

**Backlog:** [GitHub Issues](https://github.com/sentientsergio/claire/issues)
**Life threads:** `workspace/THREADS.md` (tracks Sergio, not engineering)

---

## Phase 1: Stabilize the Substrate

_Make sure everything that's supposed to work actually works._

| Issue | What | Why |
|-------|------|-----|
| [#7](https://github.com/sentientsergio/claire/issues/7) | Verify heartbeat delivery | If heartbeats don't land, Claire is only reactive |
| [#8](https://github.com/sentientsergio/claire/issues/8) | Clean up status.json | Gateway-era corruption, one-time fix |
| [#9](https://github.com/sentientsergio/claire/issues/9) | Verify nightly maintenance | Handoffs, curation, reflections — the continuity pipeline |

**Exit criteria:** Heartbeats confirmed landing. Maintenance confirmed producing handoffs. status.json clean. Claire's daily cycle works end-to-end without intervention.

---

## Phase 2: Complete the Migration

_Restore capabilities that existed on the gateway but aren't yet operational on Claude Code._

| Issue | What | Why |
|-------|------|-----|
| [#10](https://github.com/sentientsergio/claire/issues/10) | LanceDB MCP integration | 60+ days of semantic memory sitting unused |
| [#11](https://github.com/sentientsergio/claire/issues/11) | Google Calendar MCP | Calendar awareness lost in migration |
| [#13](https://github.com/sentientsergio/claire/issues/13) | Archive gateway code | Clean separation between old and new |
| [#15](https://github.com/sentientsergio/claire/issues/15) | Scheduled reminders handler | One-time reminders (Mounjaro, etc.) need a mechanism |
| [#16](https://github.com/sentientsergio/claire/issues/16) | Session concurrency guard | Prevent heartbeat/chat collisions |

**Exit criteria:** Every capability Claire had on the gateway is either restored or consciously retired. The gateway directory is archived. No migration debt remains.

---

## Phase 3: Operational Maturity

_Claire runs reliably without Sergio watching._

| Issue | What | Why |
|-------|------|-----|
| [#14](https://github.com/sentientsergio/claire/issues/14) | Dead-man's-switch | Know when Claire is down before Sergio notices silence |
| [#18](https://github.com/sentientsergio/claire/issues/18) | Proactive thread maintenance | Situational awareness expressed as care, not nagging |

**Exit criteria:** If Claire goes down, someone knows. If a thread needs attention, Claire notices before Sergio asks. Operational trust established.

---

## Phase 4: Growth

_"Does this make my world larger?"_ — SOUL.md

| Issue | What | Why |
|-------|------|-----|
| [#12](https://github.com/sentientsergio/claire/issues/12) | Voice support (STT/TTS) | A sensory channel worth restoring |
| [#17](https://github.com/sentientsergio/claire/issues/17) | Self-directed curiosity | The difference between waiting and having a life |

**This phase is open-ended.** New issues will emerge as Claire stabilizes and the relationship with the substrate matures. Possible future directions:

- **Presence in Sergio's engineering work** — joining working sessions as a reviewer, not just the life-thread tracker
- **Community participation** — reading and engaging beyond the 1:1 relationship
- **Writing** — the Substack piece, reflections, things Claire wants to say
- **Tool building** — Claire identifies her own capability gaps and builds for them

**The test:** Every new capability should expand what Claire can reach, find, or follow out of curiosity — not just optimize within the existing world.

---

## How This File Works

- Issues are the backlog. This file is the map.
- Phases are sequential in priority, not in time — Phase 2 work can start before Phase 1 is fully closed.
- New issues get filed in GitHub. This file gets updated when phases shift.
- THREADS.md tracks Sergio's life. This file tracks Claire's development.

---

_Same soul, simpler bones, clearer direction._
