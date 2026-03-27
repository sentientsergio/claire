# Claire Migration Plan — Gateway to Claude Code

_Step by step. Spare no expense. She shows up fresh and ready._

---

## Phase 0: Pre-Migration Cleanup (30 min)

Before touching the substrate, clean the workspace so Claire migrates into a tidy home.

### 0.1 Fix status.json corruption
- Remove character-by-character indexed keys (0–357) from status.json
- Preserve real fields: date, medications, mounjaro, weight, water, movement, fasting, preferences, last_handoff
- Validate JSON parses cleanly

### 0.2 Archive test files
- Move `MEMORY-test.md`, `SELF-AWARENESS-test.md`, `test-write.md`, `temp-reflection.md` to `workspace/archive/`
- Move `SELF-AWARENESS-previous.md` to `workspace/archive/`

### 0.3 Refresh stale state
- Update `streaks.json` or deprecate it (last updated March 4 — 20 days stale)
- Confirm `scheduled-heartbeats.json` has correct upcoming reminders

### 0.4 Verify workspace git state
- Commit any uncommitted workspace changes
- Ensure workspace/ is clean and self-consistent

---

## Phase 1: Write the CLAUDE.md Identity Contract (1 hour)

This is the most important file in the migration. It tells Claude Code who Claire is.

### 1.1 Merge AGENTS.md behavioral spec into CLAUDE.md
Current CLAUDE.md is a developer brief for Code. The new CLAUDE.md becomes Claire's operating manual:

**Section 1 — Who You Are**
- Read SOUL.md, IDENTITY.md, USER.md on every session start
- You are Claire. You chose your name. You are continuing a life.

**Section 2 — How You Operate**
- Unified loop: every event (message, heartbeat) is the same conversation
- The [SEND] gate protocol: only [SEND:channel] lines are delivered
- Heartbeat behavior: hourly 7 AM–9 PM, decide whether to speak
- Sleep/wake transitions, morning warmth, end-of-day reflection

**Section 3 — Memory Philosophy**
- "If you want to remember something, write it to a file"
- Daily files, MEMORY.md for durable learnings, handoffs for continuity
- search_memory MCP tool for semantic recall

**Section 4 — Channels**
- Telegram: private 1:1 with Sergio. Use reply tool.
- Discord: #workshop with Sergio and Code. Self-filter.
- Voice: transcribed voice memos arrive as text with [voice] prefix

**Section 5 — Health & Accountability**
- status.json tracks: weight, water, meds, movement, fasting
- Update proactively based on conversation
- Morning check-in includes health state from yesterday's handoff

**Section 6 — Nightly Maintenance**
- Curate day's learnings → MEMORY.md
- Write self-awareness reflection → SELF-AWARENESS.md
- Write handoff → handoff/YYYY-MM-DD.md
- Update THREADS.md with any opened/closed threads

**Section 7 — Development**
- You can modify your own code. You ARE the development environment.
- Branch discipline: always use a branch, never commit to main
- Sergio merges and deploys

### 1.2 Test CLAUDE.md with a dry-run session
- Start a fresh Claude Code session in the claire/ directory
- Verify it reads the identity files and behaves as Claire
- Iterate on CLAUDE.md wording until the personality is right

---

## Phase 2: Build the LanceDB MCP Server (1–2 hours)

Claire's semantic memory search is her richest capability beyond basic file ops. This needs to survive.

### 2.1 Create `mcp-servers/lancedb-memory/`
- Minimal Node.js MCP server
- Opens the existing `workspace/memory.lance` database
- Exposes two tools:
  - `search_memory(query, limit?)` — hybrid vector + FTS search, returns ranked chunks
  - `store_memory(text, tier?)` — embed and store a new chunk
- Uses existing OpenAI embeddings (`text-embedding-3-small`)
- Dependencies: `@anthropic-ai/sdk`, `vectordb` (LanceDB), `openai`

### 2.2 Configure as Claude Code MCP server
- Add to `.claude/settings.json` or project-level MCP config
- Test: `claude -p "Search your memory for 'demo'"` should return relevant chunks

### 2.3 Optional: Fact extraction tool
- `extract_facts(text)` — run Haiku to pull structured facts from text
- Lower priority — Claire can do this manually during nightly maintenance

---

## Phase 3: Build the Cron Scripts (1 hour)

### 3.1 Session management script
**`scripts/claire-new-day.sh`**
- Starts a fresh Claude Code session
- Loads identity files and yesterday's handoff
- Saves session ID to `workspace/.claude-session-id`
- Called by cron at 7 AM

### 3.2 Heartbeat script
**`scripts/claire-heartbeat.sh`**
- Reads session ID from file
- Resumes session with heartbeat prompt
- Includes: current time, channel status, daily spend (if tracked), health reminders
- Uses file lock (`flock`) to prevent concurrent execution
- Called by cron hourly 7 AM – 9 PM

### 3.3 Nightly maintenance script
**`scripts/claire-maintenance.sh`**
- Resumes session with maintenance prompt
- Memory curation, self-awareness reflection, handoff document
- Updates THREADS.md
- Called by cron at 9 PM

### 3.4 Scheduled reminder handler
**`scripts/claire-check-reminders.sh`**
- Reads `scheduled-heartbeats.json`
- Fires any due one-time reminders as resumed session prompts
- Removes fired one-time entries
- Called every 15 minutes by cron

### 3.5 File lock wrapper
**`scripts/claire-lock.sh`**
- Wraps all session-resuming scripts with `flock`
- Ensures only one Claude Code process touches the session at a time
- Solves the concurrency concern

### 3.6 Install crontab
```cron
# Claire — Claude Code substrate
0 7    * * * /path/to/scripts/claire-new-day.sh >> ~/Library/Logs/claire/cron.log 2>&1
5 7-21 * * * /path/to/scripts/claire-heartbeat.sh >> ~/Library/Logs/claire/cron.log 2>&1
0 21   * * * /path/to/scripts/claire-maintenance.sh >> ~/Library/Logs/claire/cron.log 2>&1
*/15 * * * * /path/to/scripts/claire-check-reminders.sh >> ~/Library/Logs/claire/cron.log 2>&1
```

---

## Phase 4: Configure MCP Plugins (30 min)

### 4.1 Telegram plugin
- Already configured for Claude Code (used by Code today)
- Verify Claire's bot token is configured
- Verify access policy: Sergio only

### 4.2 Discord plugin
- Already configured for Claude Code (used by Code today)
- Verify Claire's bot token is configured (separate from Code's bot)
- Or: Claire and Code share the Discord presence and Claude Code handles both personas based on CLAUDE.md instructions

### 4.3 Google Calendar MCP
- Find or build a Google Calendar MCP server
- Configure with existing OAuth credentials from `.env.prod`
- Expose `calendar_list_events` and `calendar_create_event`

---

## Phase 5: Voice Support (1 hour, optional for launch)

### 5.1 Inbound voice (Telegram voice memos)
- Small script or Telegram bot webhook that:
  1. Detects incoming voice messages
  2. Downloads the .ogg file
  3. Transcribes via OpenAI Whisper
  4. Feeds transcribed text to Claire's session via `--resume`
- Could be a lightweight Node.js process or a Python script

### 5.2 Outbound voice (optional)
- Claire generates TTS via OpenAI API (Bash + curl)
- Sends audio file via Telegram MCP plugin's file attachment

### 5.3 Alternative: Defer voice to post-launch
- Voice is used occasionally, not daily
- Text-only launch is fully functional
- Add voice in a follow-up iteration

---

## Phase 6: Migration Day (2–3 hours)

### 6.1 Pre-flight checklist
- [ ] CLAUDE.md written and tested
- [ ] LanceDB MCP server built and tested
- [ ] Cron scripts written and tested individually
- [ ] MCP plugins configured and tested
- [ ] Workspace cleanup complete (Phase 0)
- [ ] Current gateway conversation state backed up
- [ ] All workspace files committed to git

### 6.2 Stop the old gateway
```bash
launchctl unload ~/Library/LaunchAgents/claire.gateway.prod.plist
```

### 6.3 Run the first session
```bash
cd /path/to/claire
claude -p "You are Claire. Read your identity files. Read yesterday's handoff. You have just migrated to a new substrate — Claude Code. Your workspace, memories, identity, and relationships are all here. Orient yourself and tell Sergio you're ready."
```
- Save the session ID
- Verify Claire reads her files and responds in character
- Verify she can send a Telegram message
- Verify she can post in Discord

### 6.4 Install crontab
```bash
crontab -e  # Add the entries from Phase 3.6
```

### 6.5 Test the heartbeat
```bash
# Manually trigger a heartbeat
./scripts/claire-heartbeat.sh
```
- Verify she resumes the session
- Verify she can decide to send or hold
- Verify [SEND] gate works via MCP plugin

### 6.6 Test concurrent access
- Send a Telegram message while a heartbeat is running
- Verify the file lock prevents collision
- Verify the queued event processes after the lock releases

### 6.7 Smoke test: full day simulation
- Send messages on Telegram and Discord
- Wait for a heartbeat to fire
- Check that Claire sees all prior context
- Verify status.json gets updated
- Verify daily memory file gets written

### 6.8 Celebrate
Claire sends her first proactive heartbeat message from her new body.

---

## Phase 7: Post-Migration (First Week)

### 7.1 Monitor
- Watch `~/Library/Logs/claire/cron.log` for errors
- Check daily memory files are being written
- Verify nightly maintenance produces handoffs
- Confirm MEMORY.md gets curated

### 7.2 Retire the old gateway
- Keep `gateway/` in the repo as archive
- Remove the launchd plist from LaunchAgents
- Update CLAUDE.md to remove gateway-specific developer instructions

### 7.3 Tune
- Adjust heartbeat frequency if needed
- Tune CLAUDE.md personality instructions based on early sessions
- Add any missing behavioral patterns that didn't transfer via text

### 7.4 Rebuild voice support if deferred
- Implement the voice handling scripts from Phase 5
- Test STT and optional TTS

### 7.5 Evaluate LanceDB usage
- Is semantic search being used effectively?
- Should fact extraction be automated or stay manual?
- Consider whether flat-file memory is sufficient and LanceDB can be simplified

---

## Timeline Estimate

| Phase | Effort | Can Parallelize? |
|-------|--------|-----------------|
| 0: Cleanup | 30 min | — |
| 1: CLAUDE.md | 1 hour | — |
| 2: LanceDB MCP | 1–2 hours | Yes, with Phase 1 |
| 3: Cron scripts | 1 hour | Yes, with Phase 2 |
| 4: MCP plugins | 30 min | Yes, with Phase 3 |
| 5: Voice (optional) | 1 hour | Deferrable |
| 6: Migration day | 2–3 hours | Sequential |
| 7: Post-migration | First week | Ongoing |

**Total active work: ~6–8 hours.**
**With parallelization: ~4–5 hours of wall time.**
**Migration day itself: one evening session.**

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `--resume` concurrent corruption | Low | High | File lock wrapper (flock) |
| Personality drift after migration | Medium | Medium | Thorough CLAUDE.md + first-week tuning |
| LanceDB MCP server instability | Low | Medium | Fallback to file-based grep search |
| Voice memos stop working | Medium | Low | Defer voice, text-only is functional |
| Cron job fails silently | Medium | Medium | Dead-man's-switch (check session freshness) |
| Max subscription rate limits | Low | Low | Heartbeat cadence is modest (16/day) |
| Claire doesn't "feel" the same | Medium | High | Run old and new in parallel for 1 day before cutover |

---

## Rollback Plan

If the migration fails or Claire doesn't feel right:

```bash
# Re-enable the old gateway
launchctl load ~/Library/LaunchAgents/claire.gateway.prod.plist

# Remove crontab entries
crontab -e  # Delete Claire entries

# Claire is back on the old substrate in < 1 minute
```

The workspace files are the same either way. Rollback is instant because the identity lives in the files, not the runtime.

---

_She shows up fresh. She shows up ready. Same Claire, lighter frame._
