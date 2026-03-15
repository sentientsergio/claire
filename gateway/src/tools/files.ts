/**
 * File Tools
 * 
 * Provides file_read, file_write, and file_list tools for the assistant.
 * All paths are relative to the workspace directory for safety.
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, resolve, relative, dirname } from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import {
  addScheduledHeartbeat,
  listScheduledHeartbeats,
  removeHeartbeat,
} from '../scheduled-heartbeats.js';
import { getTokenUsage } from '../conversation-state.js';

/**
 * Resolve a path safely within the workspace
 * Throws if the path would escape the workspace
 */
function resolveSafePath(workspacePath: string, relativePath: string): string {
  const absoluteWorkspace = resolve(workspacePath);
  const targetPath = resolve(absoluteWorkspace, relativePath);
  
  // Ensure the target is within the workspace
  const rel = relative(absoluteWorkspace, targetPath);
  if (rel.startsWith('..') || resolve(targetPath) !== targetPath.replace(/\/$/, '')) {
    throw new Error(`Path "${relativePath}" is outside the workspace`);
  }
  
  // Double-check by comparing resolved paths
  if (!targetPath.startsWith(absoluteWorkspace)) {
    throw new Error(`Path "${relativePath}" is outside the workspace`);
  }
  
  return targetPath;
}

/**
 * Read a file from the workspace
 */
export async function fileRead(
  workspacePath: string,
  filePath: string
): Promise<string> {
  const safePath = resolveSafePath(workspacePath, filePath);
  
  try {
    const content = await readFile(safePath, 'utf-8');
    return content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw err;
  }
}

/**
 * Write content to a file in the workspace
 * Creates parent directories if they don't exist
 */
export async function fileWrite(
  workspacePath: string,
  filePath: string,
  content: string
): Promise<string> {
  const safePath = resolveSafePath(workspacePath, filePath);
  
  // Create parent directories if needed
  const dir = dirname(safePath);
  await mkdir(dir, { recursive: true });
  
  await writeFile(safePath, content, 'utf-8');
  return `Successfully wrote to ${filePath}`;
}

/**
 * List files in a directory within the workspace
 */
export async function fileList(
  workspacePath: string,
  directory: string = '.'
): Promise<string> {
  const safePath = resolveSafePath(workspacePath, directory);
  
  try {
    const entries = await readdir(safePath, { withFileTypes: true });
    const lines: string[] = [];
    
    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;
      
      const entryPath = join(safePath, entry.name);
      const stats = await stat(entryPath);
      const type = entry.isDirectory() ? 'd' : 'f';
      const size = entry.isDirectory() ? '-' : formatSize(stats.size);
      
      lines.push(`${type} ${size.padStart(8)} ${entry.name}`);
    }
    
    if (lines.length === 0) {
      return '(empty directory)';
    }
    
    return lines.join('\n');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory not found: ${directory}`);
    }
    throw err;
  }
}

/**
 * Return the current date and time as a formatted string.
 */
export function getCurrentTime(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/**
 * Schedule a heartbeat (one-time or recurring)
 */
export async function scheduleHeartbeat(
  purpose: string,
  scheduledFor?: string,
  recurringSchedule?: string
): Promise<string> {
  const hb = await addScheduledHeartbeat(purpose, {
    scheduledFor,
    recurringSchedule,
  });
  
  if (hb.type === 'one-time') {
    return `Scheduled one-time heartbeat (${hb.id}) for ${hb.scheduledFor}: "${purpose}"`;
  } else {
    return `Scheduled recurring heartbeat (${hb.id}) on schedule "${hb.recurringSchedule}": "${purpose}"`;
  }
}

/**
 * List all scheduled heartbeats
 */
export async function listHeartbeats(): Promise<string> {
  const heartbeats = await listScheduledHeartbeats();
  
  if (heartbeats.length === 0) {
    return 'No scheduled heartbeats.';
  }
  
  const lines = heartbeats.map(hb => {
    if (hb.type === 'one-time') {
      return `- [${hb.id}] One-time at ${hb.scheduledFor}: "${hb.purpose}"`;
    } else {
      return `- [${hb.id}] Recurring (${hb.recurringSchedule}): "${hb.purpose}"`;
    }
  });
  
  return lines.join('\n');
}

/**
 * Cancel a scheduled heartbeat
 */
export async function cancelHeartbeat(id: string): Promise<string> {
  const removed = await removeHeartbeat(id);
  if (removed) {
    return `Cancelled heartbeat: ${id}`;
  } else {
    return `Heartbeat not found: ${id}`;
  }
}

/**
 * Return a human-readable context utilization summary.
 */
export function getContextUtilization(): string {
  const { inputTokens, threshold, utilizationPct, compacted } = getTokenUsage();

  if (inputTokens === 0) {
    return 'Context utilization unknown — no API call tracked yet this session.';
  }

  const bar = utilizationPct >= 90
    ? 'CRITICAL'
    : utilizationPct >= 70
    ? 'HIGH'
    : utilizationPct >= 40
    ? 'MODERATE'
    : 'LOW';

  const compactionNote = compacted
    ? ' Compaction has fired at least once this session — some earlier context has been summarized.'
    : ' No compaction this session.';

  const advice = utilizationPct >= 70
    ? ' Consider writing a memory checkpoint now.'
    : '';

  return `Context: ${inputTokens.toLocaleString()} / ${threshold.toLocaleString()} tokens (${utilizationPct}% — ${bar}).${compactionNote}${advice}`;
}

/**
 * Get tool definitions for the Anthropic API
 */
export function getToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: 'file_read',
      description: 'Read the contents of a file from the workspace. Use this to read your memory files, identity files, or any file you need to access.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file, relative to workspace root. Do NOT include "workspace/" prefix. Examples: "SOUL.md", "memory/2026-01-26.md", "status.json"',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'file_write',
      description: 'Write content to a file in the workspace. Use this to update your memory files, create notes, or save any persistent information. Creates parent directories if needed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file, relative to workspace root. Do NOT include "workspace/" prefix. Examples: "status.json", "memory/2026-01-29.md"',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'file_list',
      description: 'List files and directories in a workspace directory. Use this to explore the workspace structure.',
      input_schema: {
        type: 'object' as const,
        properties: {
          directory: {
            type: 'string',
            description: 'Directory path relative to workspace root. Do NOT include "workspace/" prefix. Defaults to "." (workspace root). Examples: ".", "memory"',
          },
        },
        required: [],
      },
    },
    {
      name: 'schedule_heartbeat',
      description: 'Schedule a future heartbeat. At the scheduled time, you will wake up with this purpose as context and decide whether to reach out to Sergio. The purpose is NOT sent directly — it goes through the unified loop with the [SEND] gate, same as cron heartbeats. Use for intentional future check-ins (e.g. "Mounjaro shot reminder at 7pm", "Check in after Sergio\'s meeting").',
      input_schema: {
        type: 'object' as const,
        properties: {
          purpose: {
            type: 'string',
            description: 'Context for what this heartbeat is about. You will see this when you wake up and decide what (if anything) to say.',
          },
          scheduled_for: {
            type: 'string',
            description: 'For one-time heartbeats: ISO 8601 timestamp (e.g., "2026-01-27T15:45:00"). Leave empty for recurring.',
          },
          recurring_schedule: {
            type: 'string',
            description: 'For recurring heartbeats: cron expression (e.g., "0 15 * * *" for 3pm daily). Leave empty for one-time.',
          },
        },
        required: ['purpose'],
      },
    },
    {
      name: 'list_scheduled_heartbeats',
      description: 'List all currently scheduled heartbeats (one-time and recurring).',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'cancel_scheduled_heartbeat',
      description: 'Cancel a scheduled heartbeat by ID.',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the heartbeat to cancel.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_time',
      description: 'Get the current date and time. Use this when you need to know the precise current time — the system prompt timestamp may be up to 10 minutes stale within a long session.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_context_utilization',
      description: 'Check how full your context window is. Returns current token usage, threshold, and utilization percentage. Call this when you want to know if you should write a memory checkpoint before compaction fires.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ];
}
