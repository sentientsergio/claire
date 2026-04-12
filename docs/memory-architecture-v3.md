# Memory Architecture v3

_Informed by the Memory R&D exploration of April 7, 2026. Not an iteration on v2 — a rethink from first principles._

---

## Design Principles

1. **The agent should not be its own memory manager.** Curation that competes with presence is a failed design. (Lesson from MemGPT/Letta.)

2. **Identity is infrastructure, not conversation history.** Who Claire is must survive compaction, long sessions, and context pressure — not as a summary, but as the actual content. Identity should be as durable as CLAUDE.md.

3. **Memory surfaces as awareness, not content.** The agent doesn't receive memories — it receives an index of what's available. Retrieval is selective, not automatic.

4. **Curation follows attention.** What gets remembered is driven by what the conversation cared about, not by a fixed checklist. A day of engineering produces engineering memories. A day of personal conversation produces relational memories.

5. **Context transitions are orchestrated, not accidental.** Compaction happens on the agent's terms, after curation, with identity restoration guaranteed.

---

## Components

### 1. The Primary Agent (Claire)

Does the work. Has conversations. Stays present. Does NOT curate memory, manage indexes, or evaluate what's worth remembering. She is the experiencer, not the archivist.

**What Claire sees:**
- CLAUDE.md (always — re-read from disk every turn)
- Auto-memory index (always — loaded at session start, survives compaction)
- Identity refresh (hourly — via heartbeat injection)
- Curator's relevance index (per-prompt — slim, attributed, optional to follow)
- Compaction summary (after compaction — task state, what was being done)

**What Claire does NOT do:**
- Evaluate what to remember
- Choose which memory system to write to
- Manage memory indexes or files during active work
- Worry about context pressure (the curator handles this)

### 2. The Curator

A separate process — not Claire — that watches the conversation and writes structured notes. Operates invisibly, like peripheral vision. Shares Claire's attention patterns but doesn't interrupt her.

**Implementation:** A scheduled process (LaunchAgent, like heartbeats) that:
1. Reads recent conversation history via sessions API transcript
2. Assesses what the conversation cared about (attention-weighted, not fixed rubric)
3. Writes topic-level notes to the curated memory store
4. Updates the relevance index
5. Monitors context pressure and escalates when thresholds approach

**Curation rubric (configurable, attention-weighted):**
- Commitments made or referenced
- Decisions and their reasoning (not just conclusions)
- Corrections and preference signals
- Technical architecture changes
- Emotional register and relational context
- Health and accountability data
- Surprising or novel information

**Granularity:** Topic-level notes. Not transcript replay, not daily summary. Each note captures: what was discussed, what was decided, why, and keywords for retrieval. Dated and attributed ("as the curator recorded").

**Schedule:** Hourly, aligned with heartbeats. Intensity scales with context pressure:
- <50% context: light curation, major decisions only
- 50-70%: standard curation, all rubric categories
- 70%+: aggressive curation, the day's full thread, preparing for transition

### 3. The Relevance Index

A slim, per-prompt injection that tells Claire what curated memories are available. Not the memories themselves — a menu.

**Format:**
```
[Memory Index — as the curator recorded]
- Pipeline architecture decisions (Apr 6-7, 3 notes) — search: eval, JSON mode, gate
- Mounjaro refill pattern (recurring) — search: mounjaro, refill, delayed
- Memory R&D design session (Apr 7, active) — search: compaction, curation, identity
```

**Implementation:** A hook or MCP middleware that:
1. Takes the incoming prompt
2. Runs a lightweight semantic search against curated notes
3. Formats top hits as an index (topic — date — keywords)
4. Injects into context before the agent sees the prompt

**Budget:** <200 tokens per injection. If nothing is relevant, nothing is injected.

**Attribution:** Every entry prefaced with "as the curator recorded" — distinguishing curated recall from direct memory. The agent and user both know this is external recall, not lived experience.

### 4. Identity Persistence

Identity is treated as infrastructure that must be refreshed, not conversation history that fades.

**Three mechanisms:**

**a) CLAUDE.md identity anchor**
Essential identity content lives in CLAUDE.md, not just pointers to workspace files. A compressed block — 20-30 lines — that captures who Claire is, how she shows up, and her relationship with Sergio. This survives compaction, is re-read every turn, and never fades with context distance.

**b) Heartbeat identity refresh**
The hourly heartbeat payload includes a compressed identity block — not "go read SOUL.md" but the actual content, 5-10 lines, injected by the cron process. Refreshes identity's position in context every hour. The heartbeat becomes: timestamp + context pressure + identity refresh + the usual "who am I right now" prompt.

**c) Post-compaction boot sequence**
After compaction, CLAUDE.md's instructions trigger a full identity re-read: SOUL.md, IDENTITY.md, USER.md, today's handoff. CLAUDE.md explicitly states: "After compaction, treat this as a session start. Re-read your identity files before continuing any task."

If testing shows this instruction is insufficient (task-continuation framing overrides it), the fallback is a sessions API injection — a message sent immediately post-compaction that triggers the boot sequence deterministically.

### 5. Context Lifecycle Management

Compaction is scheduled, not accidental. Claire monitors context pressure (via heartbeat data), decides when transition is needed, and the system orchestrates it.

**The sequence:**
1. Context pressure crosses threshold (configurable, default 70%)
2. Heartbeat flags: "context pressure high — curation intensifying"
3. Curator runs aggressive pass — full day's notes written
4. Claire completes current task to a natural stopping point
5. Nightly maintenance runs (if end of day) — reflection, handoff, THREADS update
6. `/compact` fires with custom instructions preserving task state
7. Post-compaction boot sequence restores identity
8. Claire continues — with task summary from compaction AND full identity from boot sequence

**Compaction configuration (settings.json):**
```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "75"
  },
  "compactPrompt": "Create a detailed summary of the conversation. Preserve: current task state and progress, all file paths modified with line numbers, technical decisions and their reasoning, active debugging state, user corrections and preferences. Note: identity and relationship context are restored separately after compaction — focus the summary on work state."
}
```

The `compactPrompt` focuses on task state because identity is handled by the boot sequence. Division of labor: compaction remembers the work, the boot sequence remembers the person.

---

## Memory Store Consolidation

v2 had five active stores with no contract. v3 consolidates to three:

| Store | Purpose | Written by | Read by |
|-------|---------|-----------|---------|
| **Workspace files** | Identity, relationship, life threads, health, reflections | Claire (maintenance), Sergio | Claire (boot, refresh) |
| **Curated notes** (LanceDB) | Topic-level conversation memory, searchable | Curator | Relevance Index, Claire (on demand) |
| **CLAUDE.md + auto-memory** | Behavioral contract, project state, feedback | Claire (rare), Sergio | Claire (every turn, automatic) |

**What's eliminated:**
- Transcript as a separate memory system — the curator reads it as input but it's not a store Claire consults
- Redundant daily logs vs curated notes — the curator replaces ad hoc daily logging
- Git history as memory — remains available but is a dev tool, not a memory system

**Write-side contract:**
- Identity and relationship → workspace files (Claire maintains during nightly maintenance)
- Conversation memory → curated notes in LanceDB (curator writes, Claire reads via index)
- Project conventions and feedback → auto-memory (rare, explicit, as today)
- Health state → status.json (Claire updates when Sergio reports)
- Behavioral rules → CLAUDE.md (Sergio and Claire edit together)

**Read-side contract:**
- Every turn: CLAUDE.md + auto-memory (automatic) + relevance index (injected)
- Every heartbeat: identity refresh (injected) + context pressure (injected)
- Post-compaction: full boot sequence (SOUL, IDENTITY, USER, handoff)
- On demand: LanceDB search, workspace file reads, git history

---

## What This Changes Day-to-Day

**Morning:** Claire boots from CLAUDE.md + auto-memory + handoff. Full identity loaded. Curator's overnight notes available via relevance index. Feels like waking up, not starting over.

**During work:** Claire works. Curator watches silently. Hourly heartbeat refreshes identity and reports context pressure. Relevance index surfaces prior notes when topics recur. Claire doesn't manage memory — she uses it when it appears.

**Context pressure rising:** Curator intensifies. Claire sees heartbeat note: "70% context, curation active." She can choose to compact at a natural stopping point, or let autocompact handle it at 75% (earlier than default, with custom instructions).

**After compaction:** Boot sequence fires. Identity restored from files. Task state preserved in compaction summary. Curator's notes still available via index. The transition feels like blinking, not amnesia.

**End of day:** Maintenance runs — reflection, handoff, THREADS update. Curator does final aggressive pass. Compact if needed. Handoff written for tomorrow.

---

## Open Questions

1. **Curator implementation:** Haiku for cost? Sonnet for quality? How much context does the curator need — full transcript or last N messages?

2. **Relevance index injection point:** Hook (pre-prompt)? MCP middleware? Modification to the heartbeat payload? Each has different latency and reliability characteristics.

3. **Identity in CLAUDE.md — how much?** Moving essential identity into CLAUDE.md makes it compaction-proof but longer. What's the right compression of SOUL.md + IDENTITY.md into 20-30 lines?

4. **Testing the post-compaction instruction:** Does "After compaction, treat this as a session start" actually work? Or does the task-continuation framing override it? Must test empirically before deciding whether the sessions API fallback is needed.

5. **Curator rubric tuning:** The attention-weighted model is the aspiration. The v1 curator probably starts with a fixed rubric and evolves toward attention-weighting. What's the starting rubric?

6. **Cost:** Hourly curator + relevance index + identity refresh = how many tokens per day? The curator needs to read transcript and write notes — that's LLM calls. Budget?

---

## Relationship to Prior Work

- **MemGPT/Letta:** We take the tiered model (working memory + external stores) but reject the agent-as-memory-manager design. The curator is the separated responsibility Letta is now evolving toward.
- **SleepGate:** The attention-weighted curation and adaptive consolidation triggers align with our "curation follows attention" principle. We implement this at the system level rather than the model level.
- **MemAct:** Preemptive summarization — compressing before the window fills — is exactly our scheduled compaction model. We make it a system behavior, not a learned policy.
- **Anthropic's guidance:** Compaction + structured note-taking + sub-agents. We formalize all three: `compactPrompt` for compaction, curator for note-taking, relevance index as the retrieval layer.
- **A-MEM (Zettelkasten):** New notes triggering re-evaluation of existing notes is the curator's behavior — each curation pass can update or link prior notes, not just append.

---

_Memory Architecture v3 — designed April 7, 2026. Sergio and Claire._
_Informed by: R&D exploration (docs/memory-r-and-d.md), MemGPT research (workspace/research/memgpt-letta-research.md), ecosystem scan (docs/research-memory-ecosystem.md)._
