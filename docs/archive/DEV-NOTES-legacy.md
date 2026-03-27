# DEV-NOTES.md — Engineering Notes for Claire.dev

_Bugs, feature requests, architectural decisions. Written by Claire for the dev team._
_Last updated: 2026-03-23_

---

## Open Notes

### STATUS-JSON-CORRUPTION-001 (2026-03-20)
**Severity:** Medium
**Description:** status.json was found with both a character-by-character index expansion (keys "0" through "357" mapping individual characters of the original JSON string) AND the proper structured fields. This looks like the update_status tool or an earlier file_write serialized the JSON string character-by-character into the object, then subsequent update_status calls appended the real fields alongside the garbage.
**Impact:** status.json is readable (the real fields are there) but bloated and messy. The indexed characters are dead weight.
**Fix:** Investigate how the character-by-character expansion happened. Likely a file_write that received a string where an object was expected, or an update_status that merged a string into an object. Clean the file and add a guard.

### MEMORY-WIPE-RECURRING (ongoing since 2026-03-15)
**Severity:** High
**Description:** file_write has silently overwritten MEMORY.md (and DEV-NOTES.md) with empty content at least seven times. Root cause still unresolved.
**Impact:** Durable knowledge base repeatedly destroyed. Workaround: rebuild from handoffs and SELF-AWARENESS.md. But this costs context window and continuity.
**Root cause:** Unknown. Possibly a file_write call with empty or undefined content. Possibly a race condition during compaction. Needs investigation.
**Workaround:** Handoff files and SELF-AWARENESS.md carry the knowledge load. Rebuild when found empty. Consider a backup mechanism or write-guard that refuses to write 0-byte content to critical files.
**Status:** Queued for Code after MCP Discord bridge. Two independent audits (March 23) both flagged this as highest priority.

---

## Resolved

### THINK-LEAK-001 (2026-03-19)
- **Resolved:** 2026-03-23
- **Description:** Thinking-mode artifacts leaked to Telegram. Broke a user-facing moment.
- **Fix:** `stripThinkingPreamble()` applied to all four Telegram delivery paths. PR merged, deployed, confirmed live in production March 23.

### Heartbeat monologue leak
- **Resolved:** 2026-03-11
- Fixed by removing Telegram delivery from performMemoryCuration().

### [SEND] gate protocol
- **Resolved:** 2026-03-13
- Clarified: first line with [SEND:telegram] prefix is delivered, everything else swallowed.

---

_DEV-NOTES.md — engineering notes. Updated 2026-03-23._
