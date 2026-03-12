/**
 * Scheduled Heartbeats
 * 
 * Allows scheduling one-time or recurring heartbeats outside the regular cadence.
 * Heartbeats are persisted to survive gateway restarts.
 */

import { readFile, writeFile, watch } from 'fs/promises';
import { join } from 'path';
import cron, { ScheduledTask } from 'node-cron';
import { sendToOwner, isTelegramRunning } from './channels/telegram.js';
import { addMessage } from './conversation.js';
import { chat } from './claude.js';
import {
  appendUserMessage,
  getMessageCount,
  truncateMessages,
  rewriteMessageContent,
  enqueueTurn,
  persistState,
} from './conversation-state.js';

export interface ScheduledHeartbeat {
  id: string;
  purpose: string;           // What to say/check on
  scheduledFor?: string;     // ISO timestamp for one-time
  recurringSchedule?: string; // Cron expression for recurring
  type: 'one-time' | 'recurring';
  created: string;           // ISO timestamp
}

interface ScheduledHeartbeatsStore {
  heartbeats: ScheduledHeartbeat[];
}

// Active timers/tasks (for cleanup)
const activeTimers: Map<string, NodeJS.Timeout> = new Map();
const activeCronJobs: Map<string, ScheduledTask> = new Map();

let workspacePath: string;
let storePath: string;

// Flag to ignore self-triggered file changes
let ignoreNextChange = false;
let reloadDebounce: NodeJS.Timeout | null = null;

/**
 * Initialize the scheduled heartbeats system
 */
export async function initScheduledHeartbeats(wsPath: string): Promise<void> {
  workspacePath = wsPath;
  storePath = join(wsPath, 'scheduled-heartbeats.json');
  
  // Ensure the file exists (for watching)
  const store = await loadStore();
  await saveStore(store); // Creates file if missing
  
  console.log(`[scheduled] Loaded ${store.heartbeats.length} scheduled heartbeats`);
  
  // Schedule all loaded heartbeats
  for (const hb of store.heartbeats) {
    scheduleHeartbeat(hb);
  }
  
  // Watch for external changes to the file
  watchStoreFile();
}

/**
 * Watch the store file for external changes and reload
 */
async function watchStoreFile(): Promise<void> {
  try {
    const watcher = watch(storePath);
    console.log(`[scheduled] Watching ${storePath} for changes`);
    
    for await (const event of watcher) {
      if (event.eventType === 'change') {
        // Ignore self-triggered changes
        if (ignoreNextChange) {
          ignoreNextChange = false;
          continue;
        }
        
        // Debounce rapid changes
        if (reloadDebounce) {
          clearTimeout(reloadDebounce);
        }
        
        reloadDebounce = setTimeout(async () => {
          console.log(`[scheduled] Store file changed externally, reloading...`);
          await reloadFromFile();
          reloadDebounce = null;
        }, 200);
      }
    }
  } catch (err) {
    // File might not exist yet, or watch failed
    console.log(`[scheduled] Could not watch store file (will create on first schedule)`);
  }
}

/**
 * Reload scheduled heartbeats from file (for external changes)
 */
async function reloadFromFile(): Promise<void> {
  // Clear all existing timers and cron jobs
  for (const [id, timer] of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  
  for (const [id, task] of activeCronJobs) {
    task.stop();
  }
  activeCronJobs.clear();
  
  // Reload and reschedule
  const store = await loadStore();
  console.log(`[scheduled] Reloaded ${store.heartbeats.length} scheduled heartbeats`);
  
  for (const hb of store.heartbeats) {
    scheduleHeartbeat(hb);
  }
}

/**
 * Load the store from disk
 */
async function loadStore(): Promise<ScheduledHeartbeatsStore> {
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { heartbeats: [] };
  }
}

/**
 * Save the store to disk
 */
async function saveStore(store: ScheduledHeartbeatsStore): Promise<void> {
  ignoreNextChange = true;
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8');
  // Reset flag after a short delay
  setTimeout(() => { ignoreNextChange = false; }, 100);
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Schedule a heartbeat (set up timer or cron)
 */
function scheduleHeartbeat(hb: ScheduledHeartbeat): void {
  if (hb.type === 'one-time' && hb.scheduledFor) {
    const targetTime = new Date(hb.scheduledFor).getTime();
    const now = Date.now();
    const delay = targetTime - now;
    
    if (delay <= 0) {
      // Already past, fire immediately then clean up
      console.log(`[scheduled] ${hb.id} is past due, firing now`);
      fireHeartbeat(hb);
      removeHeartbeat(hb.id);
      return;
    }
    
    console.log(`[scheduled] ${hb.id} scheduled for ${hb.scheduledFor} (in ${Math.round(delay / 60000)}m)`);
    
    const timer = setTimeout(() => {
      fireHeartbeat(hb);
      removeHeartbeat(hb.id);
    }, delay);
    
    activeTimers.set(hb.id, timer);
    
  } else if (hb.type === 'recurring' && hb.recurringSchedule) {
    if (!cron.validate(hb.recurringSchedule)) {
      console.error(`[scheduled] Invalid cron expression for ${hb.id}: ${hb.recurringSchedule}`);
      return;
    }
    
    console.log(`[scheduled] ${hb.id} recurring on schedule: ${hb.recurringSchedule}`);
    
    const task = cron.schedule(hb.recurringSchedule, () => {
      fireHeartbeat(hb);
    });
    
    activeCronJobs.set(hb.id, task);
  }
}

/**
 * Fire a scheduled heartbeat through the unified loop.
 *
 * The purpose is passed as context to chat(). Claire decides whether to send
 * anything and what to say. The [SEND] gate applies — only responses that start
 * with [SEND] are delivered. Internal reasoning is swallowed.
 */
async function fireHeartbeat(hb: ScheduledHeartbeat): Promise<void> {
  console.log(`[scheduled] Firing heartbeat: ${hb.id} - "${hb.purpose}"`);

  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const triggerText = `[System: scheduled heartbeat at ${time}. Context: "${hb.purpose}".`
    + ' If you want to send Sergio a message, start your response with [SEND] followed by the message text.'
    + ' If nothing needs to be said right now, respond with anything else — nothing will be delivered.]';

  try {
    const result = await enqueueTurn(async () => {
      const triggerIndex = getMessageCount();
      appendUserMessage(triggerText);

      try {
        const chatResult = await chat(workspacePath);
        const text = chatResult.text.trim();

        if (!text.startsWith('[SEND]')) {
          truncateMessages(triggerIndex);
          await persistState();
          console.log(`[scheduled] ${hb.id}: hold (no [SEND] prefix)`);
          return null;
        }

        chatResult.text = text.slice('[SEND]'.length).trim();
        rewriteMessageContent(triggerIndex, `[Scheduled heartbeat: ${time}]`);
        await persistState();
        return chatResult;
      } catch (err) {
        truncateMessages(triggerIndex);
        await persistState();
        throw err;
      }
    });

    if (!result) return;

    const responseText = result.text;
    if (isTelegramRunning()) {
      const sent = await sendToOwner(responseText);
      if (sent) {
        await addMessage(workspacePath, 'telegram', 'assistant', responseText);
        console.log(`[scheduled] ${hb.id}: delivered "${responseText.substring(0, 60)}..."`);
      }
    }
  } catch (err) {
    console.error(`[scheduled] ${hb.id}: error`, err);
  }
}

/**
 * Add a new scheduled heartbeat
 */
export async function addScheduledHeartbeat(
  purpose: string,
  options: {
    scheduledFor?: string;      // ISO timestamp for one-time
    recurringSchedule?: string; // Cron expression for recurring
  }
): Promise<ScheduledHeartbeat> {
  const store = await loadStore();
  
  const type = options.recurringSchedule ? 'recurring' : 'one-time';
  
  const hb: ScheduledHeartbeat = {
    id: generateId(),
    purpose,
    type,
    scheduledFor: options.scheduledFor,
    recurringSchedule: options.recurringSchedule,
    created: new Date().toISOString(),
  };
  
  store.heartbeats.push(hb);
  await saveStore(store);
  
  scheduleHeartbeat(hb);
  
  return hb;
}

/**
 * Remove a scheduled heartbeat
 */
export async function removeHeartbeat(id: string): Promise<boolean> {
  const store = await loadStore();
  const index = store.heartbeats.findIndex(hb => hb.id === id);
  
  if (index === -1) return false;
  
  store.heartbeats.splice(index, 1);
  await saveStore(store);
  
  // Clean up active timer/cron
  const timer = activeTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(id);
  }
  
  const cronJob = activeCronJobs.get(id);
  if (cronJob) {
    cronJob.stop();
    activeCronJobs.delete(id);
  }
  
  console.log(`[scheduled] Removed heartbeat: ${id}`);
  return true;
}

/**
 * List all scheduled heartbeats
 */
export async function listScheduledHeartbeats(): Promise<ScheduledHeartbeat[]> {
  const store = await loadStore();
  return store.heartbeats;
}

/**
 * Get tool definitions for Claude to use
 */
export function getSchedulingToolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: object;
}> {
  return [
    {
      name: 'schedule_heartbeat',
      description: 'Schedule a future heartbeat/reminder. Use for one-time check-ins (before meetings, end of day) or recurring reminders. The message will be sent to Telegram at the specified time.',
      input_schema: {
        type: 'object',
        properties: {
          purpose: {
            type: 'string',
            description: 'The message to send when the heartbeat fires. Keep it brief.',
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
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'cancel_scheduled_heartbeat',
      description: 'Cancel a scheduled heartbeat by ID.',
      input_schema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the heartbeat to cancel.',
          },
        },
        required: ['id'],
      },
    },
  ];
}
