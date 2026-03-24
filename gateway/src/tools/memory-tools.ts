/**
 * Memory Tools — search_memory and update_status
 *
 * These tools give Claire agency over her own memory and notes:
 * - search_memory: deep recall into the vector store and facts table
 * - update_status: write to status.json when Sergio reports status
 *
 * The search infrastructure already exists (retrieval.ts, facts.ts).
 * These tools just expose it as Claire-invoked rather than system-invoked.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, rename, mkdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import {
  retrieveMemories,
  formatMemoriesForPrompt,
} from '../memory/retrieval.js';
import {
  findSimilarFacts,
  isFactsInitialized,
} from '../memory/facts.js';
import { isInitialized as isMemoryInitialized } from '../memory/store.js';

/**
 * Execute search_memory tool
 */
export async function executeSearchMemory(
  query: string,
  searchType?: string,
): Promise<string> {
  if (!query.trim()) {
    return 'Error: query is required';
  }

  const type = searchType || 'both';
  const results: string[] = [];

  if ((type === 'conversations' || type === 'both') && isMemoryInitialized()) {
    try {
      const memories = await retrieveMemories(query, { topK: 5 });
      const formatted = formatMemoriesForPrompt(memories);
      if (formatted) {
        results.push(formatted);
      } else {
        results.push('No matching conversations found.');
      }
    } catch (err) {
      results.push(`Conversation search error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else if (type === 'conversations' || type === 'both') {
    results.push('Conversation memory store not available.');
  }

  if ((type === 'facts' || type === 'both') && isFactsInitialized()) {
    try {
      const facts = await findSimilarFacts(query, 10);
      if (facts.length > 0) {
        const factLines = facts.map(f =>
          `- [${f.category}] ${f.content} (confidence: ${f.confidence.toFixed(2)})`
        );
        results.push(`## Relevant Facts\n\n${factLines.join('\n')}`);
      } else {
        results.push('No matching facts found.');
      }
    } catch (err) {
      results.push(`Facts search error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else if (type === 'facts' || type === 'both') {
    results.push('Facts store not available.');
  }

  return results.join('\n\n');
}

/**
 * Execute update_status tool
 */
export async function executeUpdateStatus(
  workspacePath: string,
  updates: Record<string, unknown>,
): Promise<string> {
  const statusPath = join(workspacePath, 'status.json');

  try {
    // Guard: updates must be a plain object. If Claude passes a JSON string
    // instead of a parsed object, spreading it produces character-indexed keys
    // (keys "0" through "N") — the known STATUS-JSON-CORRUPTION-001 pattern.
    if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
      const msg = `[update_status] Rejected: updates must be a plain object, got ${Array.isArray(updates) ? 'array' : typeof updates}. Pass an object like {"field": "value"}, not a JSON string.`;
      console.error(msg);
      return `Error: ${msg}`;
    }

    // Additional guard: detect if the updates object itself looks like a spread
    // string (all keys are numeric indices). Reject rather than merge garbage.
    const keys = Object.keys(updates);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      const msg = `[update_status] Rejected: updates object has only numeric keys ("0", "1", ...) — this looks like a string was spread into an object (STATUS-JSON-CORRUPTION-001). Pass a real object.`;
      console.error(msg);
      return `Error: ${msg}`;
    }

    let current: Record<string, unknown> = {};
    try {
      const raw = await readFile(statusPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      // Guard: only use the existing file if it's a real object, not corrupted
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>;
        // Strip any numeric-indexed corruption keys from the existing file
        const corrupted = Object.keys(current).filter(k => /^\d+$/.test(k));
        if (corrupted.length > 0) {
          console.warn(`[update_status] Stripping ${corrupted.length} corrupted numeric keys from status.json before merge`);
          for (const k of corrupted) delete current[k];
        }
      }
    } catch {
      // No existing status or unparseable — start fresh
    }

    const merged = { ...current, ...updates, last_updated: new Date().toISOString() };

    // Atomic write: temp file + rename to prevent partial writes on crash
    const dir = dirname(statusPath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.tmp_status_${randomBytes(8).toString('hex')}`);
    try {
      await writeFile(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
      await rename(tmpPath, statusPath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    const updatedFields = Object.keys(updates).join(', ');
    console.log(`[tools] Updated status.json: ${updatedFields}`);
    return `Updated status.json: ${updatedFields}`;
  } catch (err) {
    return `Error updating status: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

/**
 * Tool definition for search_memory
 */
export function getSearchMemoryToolDefinition(): Anthropic.Tool {
  return {
    name: 'search_memory',
    description: "Search your past conversations and extracted knowledge. Use when your conversation history and notes don't have what you need — like trying to remember something from weeks ago.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What you\'re trying to remember. Be specific.',
        },
        search_type: {
          type: 'string',
          enum: ['conversations', 'facts', 'both'],
          description: 'What to search. Defaults to both.',
        },
      },
      required: ['query'],
    },
  };
}

/**
 * Tool definition for update_status
 */
export function getUpdateStatusToolDefinition(): Anthropic.Tool {
  return {
    name: 'update_status',
    description: 'Update the habits/status tracking file. Use when Sergio reports health or habit information you should record.',
    input_schema: {
      type: 'object' as const,
      properties: {
        updates: {
          type: 'object',
          description: 'Fields to update in status.json. Examples: {"water_oz": 64, "medications_taken": true, "movement_notes": "30 min walk", "fasting_since": "18:00"}',
        },
      },
      required: ['updates'],
    },
  };
}
