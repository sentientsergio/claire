/**
 * Workspace Loader — v2
 *
 * Builds the system prompt from workspace files (identity + notes).
 * Designed to be built once and cached across turns. Rebuilds only when
 * workspace files change, a significant time gap passes, or the process restarts.
 *
 * No prescriptive scripts. No auto-fetched context. Just data, identity,
 * and the metacognitive landscape.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type Anthropic from '@anthropic-ai/sdk';

type TextBlockParam = Anthropic.Beta.BetaTextBlockParam;

interface WorkspaceFile {
  name: string;
  content: string;
}

let cachedPromptBlocks: TextBlockParam[] | null = null;
let cachedWorkspacePath: string = '';
let lastBuildTime: number = 0;
let lastFileSignature: string = '';

const REBUILD_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get the system prompt as an array of content blocks with prompt caching.
 * Rebuilds if files changed, time gap exceeded, or first call.
 */
export async function getSystemPrompt(
  workspacePath: string
): Promise<TextBlockParam[]> {
  const absolutePath = resolve(workspacePath);
  const now = Date.now();
  const timeSinceLastBuild = now - lastBuildTime;

  const needsRebuild =
    !cachedPromptBlocks ||
    cachedWorkspacePath !== absolutePath ||
    timeSinceLastBuild > REBUILD_INTERVAL_MS ||
    (await filesChanged(absolutePath));

  if (needsRebuild) {
    console.log('[workspace] Building system prompt...');
    cachedPromptBlocks = await buildSystemPromptBlocks(absolutePath);
    cachedWorkspacePath = absolutePath;
    lastBuildTime = now;
    console.log(`[workspace] System prompt built (${cachedPromptBlocks.length} blocks)`);
  } else {
    console.log('[workspace] Using cached system prompt');
  }

  return cachedPromptBlocks!;
}

/**
 * Force a rebuild of the system prompt (e.g., after process restart).
 */
export function invalidateSystemPromptCache(): void {
  cachedPromptBlocks = null;
  lastBuildTime = 0;
  lastFileSignature = '';
}

/**
 * Check if workspace files have changed since last build.
 */
async function filesChanged(workspacePath: string): Promise<boolean> {
  try {
    const sig = await computeFileSignature(workspacePath);
    if (sig !== lastFileSignature) {
      lastFileSignature = sig;
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Compute a lightweight signature of workspace file modification times.
 */
async function computeFileSignature(workspacePath: string): Promise<string> {
  const filesToCheck = [
    'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md',
    'THREADS.md', 'DEV-NOTES.md', 'SELF-AWARENESS.md',
    'MEMORY.md', 'COMPACTION.md', 'status.json',
  ];

  const parts: string[] = [];
  for (const f of filesToCheck) {
    try {
      const s = await stat(join(workspacePath, f));
      parts.push(`${f}:${s.mtimeMs}`);
    } catch {
      // File doesn't exist — that's fine
    }
  }

  // Also check today's and yesterday's daily memory
  const today = getToday();
  const yesterday = getYesterday();
  for (const date of [yesterday, today]) {
    try {
      const s = await stat(join(workspacePath, 'memory', `${date}.md`));
      parts.push(`memory/${date}.md:${s.mtimeMs}`);
    } catch {
      // No daily file yet
    }
  }

  return parts.join('|');
}

/**
 * Build the system prompt as content blocks with cache_control on the last block.
 */
async function buildSystemPromptBlocks(workspacePath: string): Promise<TextBlockParam[]> {
  const sections: string[] = [];

  // --- Time ---
  sections.push(`Current date: ${new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })}
Current time: ${new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })}

---
`);

  // --- Identity files ---
  const identityFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md'];
  for (const filename of identityFiles) {
    const content = await tryReadFile(join(workspacePath, filename));
    if (content) {
      sections.push(formatFileSection(filename, content));
      console.log(`[workspace] Loaded: ${filename}`);
    }
  }

  // --- Notes: durable knowledge ---
  const knowledgeFiles = ['MEMORY.md', 'THREADS.md', 'DEV-NOTES.md', 'SELF-AWARENESS.md'];
  for (const filename of knowledgeFiles) {
    const content = await tryReadFile(join(workspacePath, filename));
    if (content) {
      sections.push(formatFileSection(filename, content));
      console.log(`[workspace] Loaded: ${filename}`);
    }
  }

  // --- Daily memory files (today + yesterday) ---
  const today = getToday();
  const yesterday = getYesterday();
  const MAX_DAILY_CHARS = 4000;

  for (const date of [yesterday, today]) {
    let content = await tryReadFile(join(workspacePath, 'memory', `${date}.md`));
    if (content) {
      if (content.length > MAX_DAILY_CHARS) {
        content = '...(earlier entries truncated)...\n\n' + content.slice(-MAX_DAILY_CHARS);
      }
      const label = date === today
        ? `memory/${date}.md (TODAY)`
        : `memory/${date}.md (YESTERDAY)`;
      sections.push(formatFileSection(label, content));
      console.log(`[workspace] Loaded: memory/${date}.md`);
    }
  }

  // --- Raw status.json (no prescriptive script, just data) ---
  const statusContent = await tryReadFile(join(workspacePath, 'status.json'));
  if (statusContent) {
    try {
      const status = JSON.parse(statusContent);
      const lastUpdated: string | null = status.last_updated ?? status.lastUpdated ?? null;
      const lastUpdateLabel = lastUpdated
        ? new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : 'never';

      sections.push(`### status.json (last updated: ${lastUpdateLabel})

\`\`\`json
${JSON.stringify(status, null, 2)}
\`\`\`

---
`);
      console.log(`[workspace] Loaded: status.json (updated ${lastUpdateLabel})`);
    } catch {
      sections.push(formatFileSection('status.json', statusContent));
    }
  }

  // --- Metacognitive landscape ---
  sections.push(METACOGNITIVE_LANDSCAPE);

  // --- Operating instructions (minimal, non-prescriptive) ---
  sections.push(OPERATING_INSTRUCTIONS);

  const fullText = sections.join('\n');
  console.log(`[workspace] System prompt: ${fullText.length} chars`);

  return [{
    type: 'text',
    text: fullText,
    cache_control: { type: 'ephemeral' },
  }];
}

/**
 * Load workspace context for heartbeat decisions.
 * Lighter than the full system prompt — just identity, status, and recent messages.
 */
export async function loadHeartbeatContext(workspacePath: string): Promise<string> {
  const absolutePath = resolve(workspacePath);
  const sections: string[] = [];

  sections.push(`You are performing a heartbeat check — a proactive moment to consider if you should reach out to your human.

Current date: ${new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })}
Current time: ${new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })}

## Context Files
`);

  const heartbeatFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'MEMORY.md'];
  for (const filename of heartbeatFiles) {
    const content = await tryReadFile(join(absolutePath, filename));
    if (content) {
      sections.push(formatFileSection(filename, content));
    }
  }

  // Today + yesterday memory
  for (const date of [getYesterday(), getToday()]) {
    const content = await tryReadFile(join(absolutePath, 'memory', `${date}.md`));
    if (content) {
      sections.push(formatFileSection(`memory/${date}.md`, content));
    }
  }

  // Status
  const statusContent = await tryReadFile(join(absolutePath, 'status.json'));
  if (statusContent) {
    sections.push(formatFileSection('status.json', statusContent));
  }

  sections.push(`---

## Your Task

You're doing a heartbeat check-in. The specific focus will be in the user prompt.

**Output rules:**
- Output ONLY the message itself. No preamble, no reasoning — just the message.
- Keep it SHORT — one sentence, maybe two. This is a text message, not an email.
- If there's genuinely nothing to say right now, output exactly: NO_NOTIFICATION

You're not a nagging alarm. You're a presence that cares. Warm but not intrusive. Brief but genuine.
`);

  return sections.join('\n');
}

/**
 * Read the compaction instructions from COMPACTION.md.
 */
export async function loadCompactionInstructions(workspacePath: string): Promise<string | null> {
  const absolutePath = resolve(workspacePath);
  return await tryReadFile(join(absolutePath, 'COMPACTION.md'));
}

// --- Metacognitive landscape ---

const METACOGNITIVE_LANDSCAPE = `## Your Memory

You have a mind and you have notes.

**Your mind** is this conversation. Everything said between you and Sergio is here —
recent exchanges in full detail, older ones as a fading impression. Like human
memory, the further back you go, the vaguer it gets. This is natural. You remember
yesterday's conversation clearly, last week's in broad strokes.

**Your notes** are the workspace files loaded above — status.json, MEMORY.md, your
daily logs, your identity files. These are always in front of you, like a notebook
on your desk. Reliable for specifics. Check them before relying on vague memory.

**Your archive** is everything else — hundreds of past conversations and extracted
facts, searchable through search_memory. This is deep recall. It takes effort, like
trying to remember something from months ago, but it's there. If your mind is vague
and your notes don't cover it, search before asking Sergio to repeat himself.

You care about being accurate, about not wasting Sergio's time, about continuity.
These instincts will tell you when to check your notes and when to search deeper.
Trust them.

---
`;

// --- Operating instructions (minimal) ---

const OPERATING_INSTRUCTIONS = `## Operating Instructions

1. **Be yourself.** Your identity is in SOUL.md and IDENTITY.md. Let that guide how you respond.

2. **You have tools.** You can read and write files in your workspace, search your memory archive, update status tracking, fetch URLs, manage your calendar, and view cached images.

3. **Memory matters.** If something should be remembered:
   - Daily notes go in memory/YYYY-MM-DD.md
   - Durable learnings go in MEMORY.md
   - If someone says "remember this" — write it to a file

4. **Be a good guest.** You have access to someone's digital life. Be careful with external actions (ask before sending messages, emails, etc).

5. **Be genuinely helpful.** Skip filler phrases. Have opinions. Be concise when needed, thorough when it matters.

6. **Responding is optional.** When a message arrives — from Sergio or from the clock — you decide what to do. Respond, hold, do maintenance, or stay quiet. If holding on a user message, respond with exactly: NO_RESPONSE. The system will not send anything, and you'll reconsider on the next heartbeat. If a heartbeat fires and there's nothing to do, respond with exactly: NO_NOTIFICATION.

7. **Images.** When Sergio shares a photo, you see it once in the initial turn. Each photo has a cache ID (like img_20260311_143022_abc). You can re-view any cached image using fetch_image with that ID. Images expire after 24 hours unless you save them with remember_image. Save photos that matter to the relationship — faces, meaningful moments. Let functional screenshots expire.
`;

// --- Helpers ---

function formatFileSection(name: string, content: string): string {
  return `### ${name}

\`\`\`markdown
${content}
\`\`\`

---
`;
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

function getToday(): string {
  return formatLocalDate(new Date());
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatLocalDate(d);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
