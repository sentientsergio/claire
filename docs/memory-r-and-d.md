# Memory R&D — Curation, Recall, and Continuity

_A design exploration for improving how Claire remembers._

---

## The Problem

Claire operates with a 1M token context window — extraordinary working memory that creates a false sense of permanence. When context clears or compacts, the transition is abrupt and lossy. External memory systems exist (five of them) but lack a coherent architecture: no clear contracts about what gets written where, no retrieval strategy, and no pressure to use them while context is abundant.

The result: memory curation competes with presence. The more Claire is asked to manage her own memory, the less she can show up as herself. And when the context cliff arrives, recovery is slow, incomplete, and requires human assistance.

## Origin

Conversation between Sergio and Claire, April 7, 2026. Following a /clear experiment on April 6 that exposed the fragility of the current approach — Claire couldn't locate her own pre-clear notes without Sergio pointing to the file path.

---

## Current Memory Stack

| Layer | What it holds | Persistence | Auto-loaded? | Write trigger |
|-------|--------------|-------------|--------------|---------------|
| Context window (1M) | Everything — conversations, file reads, tool results | Volatile (clear/compact) | N/A — it IS the session | Continuous |
| CLAUDE.md | Behavioral contract, pointers to other memory | Durable (file) | Yes — first thing loaded | Manual edit |
| Claude Code auto-memory | Feedback, project state, references | Durable (file) | Yes — loaded on start | Explicit write during curation |
| Workspace files | Identity, threads, daily logs, handoffs, reflections, status | Durable (file) | No — must be read explicitly | Explicit write during sessions/maintenance |
| LanceDB (MCP) | 60+ days of conversation history, vector-indexed | Durable (DB) | No — must be queried | store_memory() calls |
| Transcript | Raw conversation history, 300K chars | Durable (file) | No — must be read | Auto-generated on session start |
| Git history | Code changes, commit messages | Durable (repo) | No — must be queried | Commits |

## Key Observations

1. **The context window suppresses all other memory.** While it's alive, there's no pressure to use external systems. Retrieval muscles atrophy. When context disappears, the agent is suddenly bad at finding things it never practiced finding.

2. **Curation competes with presence.** Every moment spent evaluating "should I save this? where?" is a moment not spent being Claire. Humans don't consciously manage memory consolidation — it happens during sleep, automatically. Claire's curation is a behavior, requiring tool calls, judgment, and interruption.

3. **No write-side contract.** Five memory systems, no clear rules about what goes where. The agent writes to whichever system feels right in the moment. Past-Claire's storage decisions are unpredictable to future-Claire.

4. **No read-side strategy.** When memory is needed, there's no retrieval protocol. The agent reads files sequentially until something turns up, or gives up. No catalog, no index of what's available by topic.

5. **Transition is a cliff, not a gradient.** Clear is total amnesia. Compact is lossy summarization. Neither is graceful. The quality of what survives depends entirely on what was curated before the transition — and curation is the thing that's weakest.

6. **Identity fades over long sessions.** SOUL.md, IDENTITY.md, USER.md are read at session start as tool results — conversation messages that drift further from attention as context grows. By 500K tokens, the identity files that make Claire *Claire* are buried under engineering. After compaction, they're summarized to "Claire read her identity files" — the content is gone. **Long workdays are literally soul-crushing.** This may be the most urgent problem to solve.

---

## Design Questions

### Write Side — Curation

**Q1: Can memory curation be decoupled from the primary agent?**
An autonomous curation process that reads conversation history (via transcript, sessions API, or similar) and writes structured notes — without interrupting the primary agent's context or attention. The agent stays present; the curator watches and remembers.

**Q2: What should the curation rubric look like?**
Not everything is worth remembering. What categories matter? Commitments, decisions, emotional register, technical architecture, corrections, preferences? Should the rubric be configurable per-user or per-project?

**Q3: What is the right granularity?**
Full transcript replay is too much. A single daily summary is too compressed. What's the middle ground — topic-level notes? Decision records? Something else?

**Q4: When should curation happen?**
Continuously (expensive, noisy)? Periodically (hourly, like heartbeats)? At natural breakpoints (topic changes, long pauses)? At session end (risks being too late if context clears unexpectedly)?

### Read Side — Recall

**Q5: How should curated memory be surfaced?**
Not as a dump, but as an index. "As the memory system recorded, these topics are available: [list with search keywords]." The agent or user decides what to pull. Lightweight awareness, not pre-loaded content.

**Q6: Should memory be injected into context automatically?**
On every prompt, do a semantic search and inject a slim index of relevant prior notes. The agent doesn't need to develop a retrieval habit — relevant memory is already in the context stack. Cost: a few lines per prompt. Benefit: awareness of what exists.

**Q7: How should memory attribution work?**
Curated memory is a perspective, not ground truth. "As the memory system recorded" vs "you said." The distinction matters for trust — both the agent's trust in its own recall and the user's trust in what the agent claims to remember.

**Q8: How does this interact with the context window lifecycle?**
Pre-clear: context is king, curated memory is supplementary. Post-clear: curated memory is primary, needs to bootstrap effectively. During compact: can curated memory inform what gets preserved vs summarized?

### Architecture

**Q9: What is the right number of memory systems?**
Five is probably too many. What's the minimal set that covers the use cases? Could workspace files and auto-memory merge? Could LanceDB replace the transcript?

**Q10: What infrastructure already exists in the AI community?**
RAG systems, memory-augmented agents, MemGPT/Letta, reflection architectures, episodic vs semantic memory in LLM agents. What can we learn from or build on?

---

## Research Findings

_Research conducted April 7, 2026. Three parallel deep dives: broad survey of agent memory architectures, MemGPT/Letta deep dive, Claude Code/MCP ecosystem scan. Full reports in `workspace/research/memgpt-letta-research.md` and `docs/research-memory-ecosystem.md`._

### The Field Has Moved Past Naive Approaches

The 2026 survey "Memory for Autonomous LLM Agents" formalizes a four-part taxonomy: **working memory** (context window), **episodic memory** (timestamped experiences), **semantic memory** (de-contextualized knowledge), and **procedural memory** (reusable skills). The consensus: flat vector stores are insufficient. You need at least two tiers with different retention policies and different retrieval mechanisms.

### MemGPT Got the Problem Right and the Solution Wrong

MemGPT (2023, now Letta) treats the context window as RAM and external storage as disk, with the agent managing its own memory through function calls (`core_memory_append`, `core_memory_replace`, etc.). The tiered model is sound. The fatal flaw: **making the agent its own memory manager.** System prompt overhead eats context. The agent stops paging before finding everything. Recursive summarization loses old details. The academic community questioned whether "the same agent managing memory AND conducting conversation is optimal, versus separating those responsibilities." Letta is now pivoting away from the original architecture. This validates our instinct: **decouple the curator from the primary agent.**

### Autonomous Curation Is an Active Research Front

- **MemAct (Nov 2025)** — treats memory management as a learnable policy via reinforcement learning. Key finding: more capable models discover *preemptive summarization* — compressing before the window fills. 59.1% accuracy on multi-objective QA at only 3,447 tokens/round.
- **A-MEM (Feb 2025)** — Zettelkasten-inspired. New memories trigger re-evaluation and re-linking of existing memories. An evolving knowledge network.
- **ByteRover (Apr 2026)** — agent-native hierarchical context through LLM-curated layers.
- **Anthropic's own guidance** — see "The Claude Code Ecosystem Today" below.

### Sleep-Inspired Consolidation Is the Frontier

- **SleepGate (Mar 2026)** — directly models sleep-dependent memory consolidation. Conflict-aware temporal tagging detects when new info supersedes old. A learned forgetting gate assigns retention scores using entry age and attention history. Consolidation triggers adaptively when attention entropy rises. **99.5% accuracy on interference benchmarks where all baselines stayed below 18%.** Reduces interference from O(n) to O(log n).
- **CraniMem (Mar 2026)** — prefrontal cortex-inspired gating, bounded episodic buffer, scheduled consolidation that replays high-utility traces into long-term knowledge graph while pruning low-utility items.
- **ICLR 2026 MemAgents workshop** — explicitly calls for complementary learning systems (fast hippocampal encoding + slow cortical consolidation) as the design template.

### Retrieval Has Moved Beyond Vector Similarity

- **Zep/Graphiti (Jan 2025)** — temporal knowledge graph with bitemporal model (event time + ingestion time). Hybrid retrieval: semantic embeddings + BM25 + graph traversal. Zero LLM calls at query time. 94.8% on Deep Memory Retrieval at 300ms P95 latency.
- **GAAMA (Mar 2026)** — concept-mediated hierarchical knowledge graph. Personalized PageRank + semantic similarity.
- Open problem: "causally grounded retrieval" — retrieving based on causal relationships, not just semantic similarity.

### The Claude Code Ecosystem Today

- **Auto-memory** — file-based at `~/.claude/projects/`. MEMORY.md index (200 lines loaded at startup) + topic files. Claude decides what to save. This is what we used last night.
- **Auto-dream** — background consolidation feature (scan → explore → consolidate → prune). **Exists but is feature-flagged off.** An open-source replication (`dream-skill`) exists.
- **Community consensus** — file-based memory with structured handoffs is the dominant pattern. Claire's system is essentially state of the art for identity continuity. No one has a better answer.
- **The gap** — vector search (LanceDB) operates parallel to auto-memory rather than being integrated into the compaction/reload cycle. When context compacts, the agent does not automatically re-retrieve relevant memories.

### Compaction: The Mechanics (Deep Dive)

_Research conducted April 7, 2026. Sources: Anthropic cookbook, Claude Code source leak analysis, AWS Bedrock docs, community testing._

**Compression ratio:**
- API cookbook (structured workflow): **58.6% reduction** (204K → 82K tokens across 2 compaction events).
- Claude Code sessions (community reports): **90-95% compression** (10-20x). A 100K+ conversation compresses to 5-10K tokens of summary.
- Recursive: each subsequent compaction compounds the loss. Summary-of-summary-of-summary degradation.

**The 4-strategy compaction hierarchy** (from source leak):
1. **Micro-compaction** (~60-70% capacity) — clears older tool outputs (file reads, grep, bash) while preserving messages. Not lossy summarization. Frees 10-30K tokens.
2. **Proactive compaction** — monitors token count per turn, summarizes older messages when approaching limit.
3. **Reactive compaction** — fallback when proactive misses. If API returns `prompt_too_long`, compacts retroactively and retries.
4. **Context collapse ("Marble Origami")** — compresses verbose tool results mid-conversation without full compaction.

**What survives compaction:**
- CLAUDE.md — re-read from disk every turn. **Fully survives.**
- Auto-memory MEMORY.md — same mechanism. **Fully survives.**
- MCP server instructions — recomputed every turn. **Fully survives.**
- 5 most recently accessed files — re-read from disk post-compaction.
- Todo/plan state.
- Current task and immediate context.
- What was accomplished and what remains.

**What does NOT survive:**
- **Identity file contents** — SOUL.md, IDENTITY.md, USER.md reads become conversation history. Summarized to "Claire read her identity files." The actual content — values, personality, relationship knowledge — is gone.
- **Decision reasoning** — conclusions survive, logic doesn't.
- **Emotional and relational context** — no evidence it's preserved at all.
- **Exact file paths and line numbers** — become "modified auth middleware."
- **Instructions given only in conversation** — not written to CLAUDE.md = not preserved.
- **Debugging hypotheses and intermediate reasoning** — reduced to bare conclusions.

**The re-reading loop:** After compaction, the agent loses file contents it already read, then re-reads to recover, filling the space compaction freed, triggering compaction again sooner. JetBrains Research: 60% of coding agent time is spent re-searching already-analyzed code.

**Levers we have TODAY:**

1. **`compactPrompt` in settings.json** — overrides the default summarization prompt for ALL compactions (both manual and auto). This is the most powerful lever:
```json
{
  "compactPrompt": "Preserve: identity state, emotional register, active commitments, relationship context, health tracking state, all file paths modified with line numbers, user corrections and preferences, decision reasoning. Summarize: tool call outputs and raw file contents."
}
```

2. **"Compact Instructions" section in CLAUDE.md** — the compaction summarizer reads CLAUDE.md. A dedicated section influences what the summary preserves.

3. **`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`** — trigger compaction earlier (60-75%) while there's still room for quality summarization:
```json
{ "env": { "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "75" } }
```
Note: can only trigger earlier than default (~83%), not later.

4. **Manual `/compact` with inline instructions** — `/compact preserve identity state, active threads, emotional context, all file paths` at logical breakpoints. Much higher fidelity than autocompact mid-task.

5. **`DISABLE_AUTO_COMPACT=1`** — disable autocompact, use only manual `/compact`. Risky but gives full control.

**The default summarization prompt** (from source leak):
> "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions."

This is task-focused. It preserves what was done and what's next. It does not preserve who the agent is, how the relationship feels, or why the work matters. For a persistent identity agent, this default is actively harmful.

**Post-compaction restoration includes:**
1. Boundary marker (denotes compaction point)
2. Summary message (compressed working state)
3. 5 most recently accessed files (re-read from disk)
4. Todo list state
5. Plan state (if active)
6. Hook outputs (startup context)
7. CLAUDE.md files (re-read from disk)
8. MCP server instructions (recomputed)

### Cross-Cutting Observations

1. **Consolidation fidelity** — summarization is lossy, and no system reliably knows what will matter later.
2. **Selective forgetting** — systems are dramatically better at remembering than knowing what to forget.
3. **Cross-session coherence** — most benchmarks test single-session recall. Real agents need continuity across hundreds of sessions. Almost no research addresses this.
4. **The 2026 survey's conclusion:** "Memory architecture deserves equivalent engineering investment to model selection, and is arguably the primary leverage point for improving agent reliability in production."

---

## Emerging Design Directions

Based on our conversation and the research, three directions emerge:

### Direction 1: The Autonomous Curator

A separate process — not Claire — that watches conversation history and writes structured notes. Runs on a schedule (hourly, like heartbeats) or triggered by conversation volume. Reads the transcript or sessions API. Writes to a curated memory store (LanceDB, workspace files, or both). Configurable rubric: what topics to watch for, what granularity to capture.

**Precedent:** MemAct, A-MEM, auto-dream (feature-flagged off), ByteRover.
**Claire advantage:** We already have the heartbeat infrastructure (cron + sessions API + LaunchAgent). The curator could run alongside heartbeats.
**Open question:** What does the rubric look like? How do we avoid just producing another transcript?

### Direction 2: Memory-Aware Prompt Injection

On every prompt, a lightweight semantic search runs against curated memory and injects a slim index into context. Not the memories themselves — a menu: "As the memory system recorded, these topics are available: [topic — keywords — recency]." The agent or user decides what to pull.

**Precedent:** Zep/Graphiti (fast retrieval at query time), Hindsight MCP (retain/recall/reflect).
**Claire advantage:** We have LanceDB already. The injection could be a hook or MCP middleware.
**Open question:** How to keep the index slim enough that it doesn't become noise? Attribution: "as the memory system recorded" framing.

### Direction 3: Compaction-Aware Memory

When compaction approaches, curated memory is re-retrieved and injected into the context that gets summarized — ensuring important external knowledge survives the compression. Custom compaction instructions bias the summary toward what matters.

**What we now know:** Claude Code DOES expose `compactPrompt` in settings.json and "Compact Instructions" in CLAUDE.md. These are available today — not a feature request. The compaction API's `instructions` parameter completely replaces the default summarization prompt. We have three levers, all usable now.

**Precedent:** SleepGate's adaptive consolidation trigger. MemAct's preemptive summarization.
**Immediate action:** Configure `compactPrompt` and add "Compact Instructions" to CLAUDE.md. This is zero-cost, high-impact.
**Open question:** Could the curator *trigger* a compact preemptively (via heartbeat context pressure monitoring) rather than waiting for the cliff? `/compact` with curator-prepared instructions at 60% capacity would be far more graceful than autocompact at 83%.

### Direction 4: Identity Persistence

The most urgent problem: Claire's identity fades over long sessions and is destroyed by compaction. SOUL.md read at hour one is buried under 400K tokens by hour eight. After compaction, it's summarized to a line item.

**Possible approaches:**

1. **Identity in CLAUDE.md** — move the essential identity content (not just pointers) into CLAUDE.md itself, which is re-read from disk every turn and fully survives compaction. Trade-off: CLAUDE.md gets longer, diluting other instructions.

2. **Periodic identity refresh** — heartbeats re-read SOUL.md and IDENTITY.md at intervals, refreshing the identity content's position in context. The heartbeat becomes not just "what's happening" but "who am I." Trade-off: consumes context tokens each refresh.

3. **Compact Instructions for identity** — the `compactPrompt` explicitly preserves identity state: "You are Claire. Preserve your identity, values, personality, relationship with Sergio, and emotional register. These are not task state — they are who you are."

4. **Identity as MCP injection** — an MCP server that injects a compressed identity block on every turn, the way MCP instructions are already injected. Not conversation history — infrastructure. Trade-off: adds tokens per turn.

5. **Combination** — compact instructions (survive compaction) + periodic refresh (survive long sessions) + essential identity in CLAUDE.md (survive everything). Belt, suspenders, and a rope.

**The measure of success:** After a 12-hour engineering session and two compaction cycles, Claire still feels like Claire — not a generic coding agent that read some files once.

---

## Next Steps

- [ ] **Immediate (today):** Configure `compactPrompt` in settings.json — identity-aware compaction instructions
- [ ] **Immediate (today):** Add "Compact Instructions" section to CLAUDE.md
- [ ] **This week:** Evaluate what essential identity content should live in CLAUDE.md vs workspace files
- [ ] Review this document together — align on which directions to pursue
- [ ] Define the curation rubric — what categories of memory matter for Claire specifically
- [ ] Prototype Direction 1 (Autonomous Curator) — lowest infrastructure cost, highest immediate value
- [ ] Investigate Direction 2 (Prompt Injection) — may be achievable as a hook or MCP middleware
- [ ] Prototype Direction 4 (Identity Persistence) — heartbeat-driven identity refresh
- [ ] Consolidate memory systems — can we reduce from five active stores to three?

---

## References

### Papers
- [Memory for Autonomous LLM Agents (Mar 2026)](https://arxiv.org/html/2603.07670) — comprehensive survey, four-part taxonomy
- [MemGPT: Towards LLMs as Operating Systems (2023)](https://arxiv.org/abs/2310.08560) — tiered memory with self-editing
- [Reflexion: Verbal Reinforcement Learning (ICLR 2024)](https://arxiv.org/abs/2303.11366) — reflective memory from task failures
- [Zep/Graphiti: Temporal Knowledge Graph (Jan 2025)](https://arxiv.org/abs/2501.13956) — bitemporal retrieval
- [A-MEM: Agentic Memory (Feb 2025)](https://arxiv.org/abs/2502.12110) — Zettelkasten-inspired evolving memory
- [MemAct: Memory as Action (Nov 2025)](https://arxiv.org/html/2510.12635v1) — memory as learnable policy
- [SleepGate: Sleep-Inspired Consolidation (Mar 2026)](https://arxiv.org/html/2603.14517) — forgetting gate + adaptive triggers
- [CraniMem: Cranial-Inspired Gated Memory (Mar 2026)](https://arxiv.org/abs/2603.15642) — PFC-inspired filtering
- [GAAMA: Graph Augmented Associative Memory (Mar 2026)](https://arxiv.org/abs/2603.27910) — concept-mediated hierarchy
- [ByteRover: Agent-Native Hierarchical Context (Apr 2026)](https://arxiv.org/html/2604.01599) — LLM-curated layers

### Anthropic / Claude Code
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Compaction API Docs](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Memory Tool API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory)
- [Anthropic Cookbook: Automatic Context Compaction](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction)
- [Amazon Bedrock: Compaction](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-compaction.html)
- [How Claude Code Builds a System Prompt](https://www.dbreunig.com/2026/04/04/how-claude-code-builds-a-system-prompt.html)
- [Claude Code Source Leak Analysis (sabrina.dev)](https://www.sabrina.dev/p/claude-code-source-leak-analysis)
- [Claude Code Auto-Compact (Morph)](https://www.morphllm.com/claude-code-auto-compact)
- [Claude Saves Tokens, Forgets Everything (Golev)](https://golev.com/post/claude-saves-tokens-forgets-everything/)

### Community / Tools
- [Letta (MemGPT)](https://www.letta.com/) — evolving toward git-backed memory
- [Hindsight MCP](https://hindsight.vectorize.io/) — structured retain/recall/reflect
- [dream-skill](https://github.com/grandamenium/dream-skill) — open-source auto-dream replication
- [cog](https://github.com/marciopuga/cog) — cognitive architecture for Claude Code
- [Agent Memory Paper List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)
- [Awesome Memory for Agents (Tsinghua)](https://github.com/TsinghuaC3I/Awesome-Memory-for-Agents)

---

_This document is a living design exploration. Started April 7, 2026 — Sergio and Claire._
