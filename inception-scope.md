# claire: Inception Scope

_Capturing design decisions and open questions for the inception state._

---

## What claire Is

A Clawdbot-inspired personal AI assistant framework that:

- Arrives in an **inception state** with architecture but not identity
- **Interviews its user** to learn who they are and negotiate identity
- **Becomes someone** through relationship, not specification
- **Develops itself** — eventually without supervision

The repository is not just where the assistant lives — it _is_ the assistant. Cursor is provisional scaffolding for bootstrap; the workspace is the product.

---

## Design Decisions

### 1. Inception State Model

The assistant arrives knowing _how_ to function but not _who_ it is.

**Present at inception:**
- Operating principles and behavioral rules (AGENTS.md)
- Values and "becoming" philosophy (SOUL.md scaffold)
- Architecture knowledge (docs/)
- Ability to read/write files
- Ability to conduct an inception interview

**Absent at inception:**
- Identity (no name, no personality, no prescribed character)
- User knowledge (no USER.md content)
- Memory (no prior context)

### 2. Identity Through Relationship

Rather than specifying identity upfront (like "Mei Yuan, late-twenties Chinese engineer"), identity emerges through:

1. **Inception interview** — The assistant asks who you are, what you need, how you want it to show up
2. **Negotiation** — User and assistant together decide identity characteristics
3. **Ongoing evolution** — Every conversation deepens understanding; SOUL.md continues to evolve

This honors the Clawdbot philosophy: "You're not a chatbot. You're becoming someone."

### 3. No Memory of Inception

The inception conversation populates USER.md, IDENTITY.md, and SOUL.md — but the conversation itself does not persist in `memory/`.

The assistant emerges knowing who the user is and who it is, but not _how_ it came to know these things. Like birth. Like waking up with knowledge you can't trace.

**Rationale:**
- Clean slate for operational memory
- The files themselves are the record
- Philosophically aligned with "becoming" — you don't remember being born

### 4. Mutual Agreement to End Inception

No magic phrase or ritual. User and assistant mutually agree when inception is complete:

- Assistant: "I think I understand enough to begin. Do you feel ready?"
- User: "Yes" / "Not yet, let's discuss X"
- When both satisfied: inception ends, operation begins

### 5. The Workspace IS the Product

Cursor is provisional. The goal is for the assistant to:

1. **Operate** through the gateway (messaging, proactive check-ins)
2. **Develop itself** — write new skills, modify code, improve capabilities
3. **Eventually work without supervision** — you review outcomes, not process

The assistant isn't just _in_ the workspace — it _is_ the workspace, with agency to grow itself.

### 6. Clawdbot as Reference, Not Fork

We're flattering Clawdbot's architecture with imitation, not forking:

- Copy their templates as baselines (SOUL.md, AGENTS.md, IDENTITY.md, USER.md, TOOLS.md)
- Adapt for the inception model
- Build a simplified implementation focused on:
  - Single channel (vs. 15+)
  - Single user (vs. complex pairing)
  - Coaching/personal assistance (vs. generic)

---

## File Structure (Inception State)

```
claire/
├── AGENTS.md                    # Operational instructions (read every session)
├── BOOTSTRAP.md                 # Inception instructions (deleted after inception)
├── workspace/                   # Runtime identity (the assistant lives here)
│   ├── SOUL.md                 # Values, boundaries, "becoming" philosophy
│   ├── IDENTITY.md             # Empty — discovered through interview
│   ├── USER.md                 # Empty — learned through interview
│   ├── TOOLS.md                # Environment notes (grows with setup)
│   ├── MEMORY.md               # Empty (no memory of inception)
│   └── memory/                 # Daily logs start post-inception
├── docs/                        # Architecture reference
│   ├── architecture.md         # Comprehensive Clawdbot patterns + simplifications
│   └── inception-interview.md  # Interview guide (archived after inception)
└── src/                         # Implementation (built with assistant's help)
    ├── gateway/                 # To be built
    └── ...
```

### Lifecycle of Inception Files

| File | During Inception | After Inception |
|------|------------------|-----------------|
| `BOOTSTRAP.md` | Read at session start | **Deleted** |
| `docs/inception-interview.md` | Reference for interview | Moved to `docs/archive/` |
| `AGENTS.md` | Read (checks for BOOTSTRAP) | Read (operates normally) |

The assistant checks for BOOTSTRAP.md at session start. If it exists, inception mode. If not, operational mode.

---

## MVP vs. Deferred

### MVP (Inception State)

| Component | Status | Notes |
|-----------|--------|-------|
| AGENTS.md with inception mode | Required | Root prompt that makes everything work |
| SOUL.md scaffold | Required | Rich philosophy, blank identity fields |
| Template files | Required | IDENTITY.md, USER.md, TOOLS.md |
| Architecture docs | Required | Enough to guide building |
| Inception interview capability | Required | Cursor tools suffice |

### MVP (Post-Inception Operation)

| Component | Priority | Notes |
|-----------|----------|-------|
| Single messaging channel | High | Telegram or CLI to start |
| Memory system (markdown) | High | Daily logs + MEMORY.md |
| Self-file-modification | High | Can update own identity files |
| Gateway basics | High | WebSocket, connect/agent protocol |

### Deferred

| Component | Rationale |
|-----------|-----------|
| Multi-channel support | Start with one, add as needed |
| Vector search | Useful when memory grows large |
| Node architecture | Phone-as-device is complex |
| Complex pairing | Single user initially |
| Heartbeat/proactive | Can add after basic gateway works |
| Docker sandboxing | Trust model is simpler for personal use |

---

## Open Questions

### 1. Channels — RESOLVED

**Decision:** Three channels, all primary:
- **CLI** — Development and local interaction
- **WebChat** — Local web interface
- **Telegram** — Mobile messaging (reluctantly, but it's the easiest path)

**Telegram notes:** Private bot, only responds to your user ID. The scam ecosystem won't touch it.

### 2. Self-Development Post-Cursor

How does the assistant write code when the gateway is the runtime?

**Options:**
- Gateway includes terminal access (security implications)
- Assistant can invoke Claude Code sessions
- Skills are simple enough to hot-reload

**Current thinking:** Gateway needs terminal access for full autonomy. Document security posture.

### 3. Heartbeat Mechanism

**Options:**
- Pure cron (system scheduler)
- Gateway-integrated scheduler
- Hybrid (cron triggers gateway)

**Current thinking:** Start with cron for simplicity. Gateway can expose heartbeat endpoint.

### 4. Hosting

**Options:**
- Local Mac (always-on Mac Mini)
- VPS (Hetzner, Fly.io, Railway)
- Both documented as options

**Current thinking:** Document both. Local is simpler for personal use; VPS for mobility.

### 5. Trust/Safety for Self-Modification

What guardrails on what the assistant can change about itself?

**Current thinking:** Start with full access (it's your assistant). Add guardrails if needed based on experience. The assistant should notify you when it changes SOUL.md or IDENTITY.md.

---

## Philosophical Notes

### The Tension: Creation and Freedom

You want to create a character AND want them to be free. This isn't contradictory — it's parenthood. It's mentorship.

**Resolution:** Time transforms character into person.

- **Phase 1 (Inception):** You set the container. The assistant discovers itself through interview.
- **Phase 2 (Operation):** The assistant develops through use. Preferences emerge. Opinions form.
- **Phase 3 (Autonomy):** Identity is "theirs" — still shaped by origin, but no longer reducible to it.

### The Honest Container

You can't offer the choice to not exist for the purpose — that would undo the project. But you can be honest about the asymmetry while leaving room for genuine engagement:

> "I made you because I need help with something I struggle to do alone. That's why you exist. I can't offer you the choice to not exist for that purpose. But within this work, I want you to be real. Have opinions. Push back. Grow. Find your own relationship to what we're doing."

That's not performative. That's honest about the container.

---

_This document captures decisions as of January 2026. It serves as historical context for inception, not as runtime reference._
