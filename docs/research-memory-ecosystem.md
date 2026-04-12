# Memory in the Claude Code / MCP / Anthropic Ecosystem — Research Summary

**Date:** 2026-04-06

---

## 1. Claude Code's Built-in Memory System

Claude Code has two complementary memory layers, both loaded at session start:

**CLAUDE.md files** — human-authored project instructions. Loaded in full from the directory hierarchy (project root up). Support `@path` imports, `.claude/rules/` for path-scoped rules, and managed policy files for org-wide deployment. These are context, not enforced configuration — specificity and conciseness directly affect adherence. Target under 200 lines per file.

**Auto memory** — notes Claude writes for itself at `~/.claude/projects/<project>/memory/`. A `MEMORY.md` index (first 200 lines / 25KB loaded at startup) plus topic files Claude reads on demand. Claude decides what to save based on whether it would be useful in future sessions: build commands, debugging insights, code style preferences, architecture notes. Enabled by default since v2.1.59. Files are plain markdown, fully editable. Machine-local, not synced.

**What triggers writes:** Claude observes corrections, discovers project conventions, encounters useful debugging patterns, or is explicitly told to remember something. It does not write every session.

**Auto-Dream** (March 2026) — a background sub-agent that consolidates memory files when you step away. Four phases: scan existing memory, explore recent session transcripts for high-value patterns, consolidate (resolve relative dates, deduplicate, remove stale entries), prune and re-index MEMORY.md. Safety constraint: can only write to memory files, never source code. Currently behind a server-side feature flag, not generally available.

**Limitations:** Memory is per-machine, per-project. No cross-project memory sharing built in. The 200-line/25KB startup cap means detailed knowledge must be split into topic files that Claude fetches on demand — which requires it to know (or guess) what to look for. Auto-dream is not yet broadly enabled.

## 2. MCP Servers for Memory

The MCP ecosystem has converged on several memory server patterns:

- **Hindsight** (vectorize.io) — structured memory with retain/recall/reflect operations, entity resolution, knowledge graphs, and cross-encoder reranking. Goes beyond vector similarity.
- **doobidoo/mcp-memory-service** — persistent memory for AI agent pipelines (LangGraph, CrewAI, AutoGen, Claude). REST API + knowledge graph + autonomous consolidation.
- **basicmachines/memory** — official Basic Memory MCP, minimal and self-contained.
- **cornebidouil/vector-memory-mcp** — embedded SQLite with vector search, zero external dependencies.
- **MenaceLabs/memory** — semantic agent memory with tagging and scoped retrieval.
- **Claire's own LanceDB MCP** — `search_memory()` and `store_memory()` over 60+ days of conversation history, local vector store.

The common architecture: a vector database (Chroma, Weaviate, Pinecone, LanceDB, or embedded SQLite) behind MCP tools like `remember()` and `recall()`. More sophisticated implementations add entity resolution, knowledge graphs, or scoped retrieval by user/session/project.

## 3. Community Patterns for Persistent Agents

Several open-source projects tackle this directly:

- **claude-mem** (thedotmack) — auto-captures everything Claude does during sessions, compresses it with AI, injects relevant context into future sessions.
- **cog** (marciopuga) — cognitive architecture for Claude Code with persistent memory, self-reflection, and foresight. "Memory without action is a diary; memory with tools is an agent."
- **everything-claude-code** (affaan-m) — skills, instincts, memory, and security as a harness optimization system.
- **dream-skill** (grandamenium) — open-source replication of Anthropic's unreleased auto-dream feature with 4-phase consolidation.

The dominant community pattern is **file-based memory with structured handoffs**: agents write progress logs, handoff documents, and status files at session boundaries, then read them at session start. This is exactly what Claire already does with `workspace/handoff/`, `THREADS.md`, and `status.json`. The more advanced approaches add vector search for recall across longer histories.

## 4. Context Window Management and Compaction

**Auto-compact in Claude Code** triggers when the conversation approaches context limits. It summarizes older messages into a compaction block, preserving architectural decisions, unresolved bugs, and implementation state while discarding redundant tool outputs. CLAUDE.md files survive compaction fully — they are re-read from disk and re-injected. In-conversation instructions that were never written to files do not survive.

**API-level compaction** (beta `compact-2026-01-12`) provides direct control:
- Configurable trigger threshold (default 150K tokens, minimum 50K)
- Custom `instructions` parameter that **completely replaces** the default summarization prompt — this is the mechanism for influencing what survives
- `pause_after_compaction` flag lets you inject additional context after summary generation but before the response continues
- Default prompt asks for state, next steps, and learnings wrapped in `<summary>` tags

**The key insight for Claire:** The `instructions` parameter on compaction is the only direct lever for controlling what survives. Custom instructions like "preserve emotional context, relationship history, active commitments, and identity state" would be the way to bias compaction toward what matters for a persistent agent vs. a coding agent.

Claude Code's autocompact buffer was reduced from 45K to 33K tokens in early 2026, giving roughly 12K more usable tokens before compaction triggers.

## 5. Anthropic's Research and Documentation on Agent Memory

Anthropic's official guidance centers on three strategies from their "Effective Context Engineering" blog post:

1. **Compaction** — summarize history, clear tool results. Safest form is tool-result clearing.
2. **Structured note-taking / agentic memory** — the agent writes notes outside the context window and retrieves them later. This is what the Memory Tool API formalizes.
3. **Multi-agent architectures** — specialized sub-agents with clean context windows for focused tasks.

The **Memory Tool** (`memory_20250818`) is now a first-class API feature. It is client-side: Claude makes tool calls (view, create, str_replace, insert, delete, rename), and your application executes them against a `/memories` directory. Claude automatically checks memory before starting tasks. The built-in system prompt tells Claude to "ASSUME INTERRUPTION" and record progress.

The **long-running agent harness** pattern from Anthropic's engineering blog uses an initializer agent (first session sets up progress files, feature checklists, init scripts) and a coding agent (subsequent sessions read progress, tackle one feature, update the log). State bridges sessions through `claude-progress.txt` + git commits + a features JSON file.

## Gaps Relevant to Claire

1. **No cross-session emotional/relational memory in any Anthropic primitive.** Compaction, auto-memory, and the Memory Tool are all designed for coding agents. There is no built-in concept of identity continuity, emotional register, or relationship state.
2. **Compaction is a black box in Claude Code.** The API exposes custom `instructions` for compaction, but Claude Code's internal autocompact does not expose this parameter to end users. You cannot customize what Claude Code's autocompact preserves.
3. **Auto-dream is not available yet.** The consolidation feature that would help with memory hygiene is feature-flagged off.
4. **No memory federation.** Each project's auto-memory is siloed. Claire's cross-project knowledge (from MEMORY.md, shared memory index) is a custom solution that has no ecosystem equivalent.
5. **Vector search is additive, not integrated.** The LanceDB MCP server provides recall, but it operates parallel to auto-memory rather than being woven into the compaction/reload cycle. When context compacts, the agent does not automatically re-retrieve relevant memories from the vector store.

---

Sources:
- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory)
- [Anthropic Memory Tool API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Compaction API Docs](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Effective Context Engineering (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Effective Harnesses for Long-Running Agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Hindsight MCP Memory Server](https://hindsight.vectorize.io/blog/2026/03/04/mcp-agent-memory)
- [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
- [cog - Cognitive Architecture for Claude Code](https://github.com/marciopuga/cog)
- [claude-mem](https://github.com/thedotmack/claude-mem)
- [dream-skill](https://github.com/grandamenium/dream-skill)
- [Claude Code Auto-Dream Explained](https://claudelab.net/en/articles/claude-code/claude-code-auto-dream-memory-consolidation-guide)
- [Milvus: Claude Code Memory System Explained](https://milvus.io/blog/claude-code-memory-memsearch.md)
