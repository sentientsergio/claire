/**
 * Checkpoint Writer
 *
 * Writes a mid-session snapshot of recent conversation to the daily memory file.
 * Protects against context compaction data loss by ensuring the daily log has
 * recent context before compaction fires.
 *
 * Shared between heartbeat.ts (called every heartbeat) and claude.ts (called
 * automatically when context utilization exceeds the high-water mark).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { loadConversationLog, getRecentMessages } from './conversation.js';

const HIGH_UTILIZATION_PCT = 70;
let lastAutoCheckpointUtilization = 0;

/**
 * Write a checkpoint of recent conversation to today's daily memory file.
 * Idempotent — skips if a checkpoint at the same minute already exists.
 */
export async function writeCheckpoint(workspacePath: string): Promise<void> {
  try {
    const absolutePath = resolve(workspacePath);
    const log = await loadConversationLog(absolutePath);
    const recentMessages = getRecentMessages(log, { withinHours: 4, limit: 20 });

    if (recentMessages.length === 0) return;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const memoryDir = join(absolutePath, 'memory');
    const filePath = join(memoryDir, `${today}.md`);

    await mkdir(memoryDir, { recursive: true });

    let existing = '';
    try {
      existing = await readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist yet
    }

    const checkpointMarker = `\n\n---\n_Checkpoint at ${time}_\n`;

    if (existing.includes(`Checkpoint at ${time}`)) return;

    const summaryLines: string[] = [];
    for (const msg of recentMessages.slice(-10)) {
      const msgTime = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const role = msg.role === 'user' ? 'Sergio' : 'Claire';
      const preview = msg.content.length > 120 ? msg.content.slice(0, 120) + '...' : msg.content;
      summaryLines.push(`- ${msgTime} ${role}: ${preview}`);
    }

    const checkpoint = checkpointMarker + summaryLines.join('\n') + '\n';
    await writeFile(filePath, existing + checkpoint, 'utf-8');
    console.log(`[checkpoint] Written to memory/${today}.md (${recentMessages.length} recent messages)`);
  } catch (err) {
    console.error('[checkpoint] Write failed:', err);
  }
}

/**
 * Auto-checkpoint if context utilization has crossed the high-water mark.
 * Called after each API turn in chat() / chatStreaming().
 * Only fires once per 10% utilization band to avoid redundant writes.
 */
export async function maybeAutoCheckpoint(
  utilizationPct: number,
  workspacePath: string
): Promise<void> {
  if (utilizationPct < HIGH_UTILIZATION_PCT) return;

  // Only fire once per 10% band so a long session doesn't write on every turn
  const band = Math.floor(utilizationPct / 10) * 10;
  if (band <= lastAutoCheckpointUtilization) return;

  lastAutoCheckpointUtilization = band;
  console.log(`[checkpoint] Auto-checkpoint triggered at ${utilizationPct}% context utilization`);
  await writeCheckpoint(workspacePath);
}
