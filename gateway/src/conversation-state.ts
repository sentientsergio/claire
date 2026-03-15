/**
 * Conversation State Manager
 *
 * Maintains a single MessageParam[] array in process memory across all channels.
 * One Claire, one Sergio, one conversation.
 *
 * - Persists to disk after each turn for crash recovery
 * - Strips thinking blocks before persistence
 * - Serializes concurrent turns via a promise queue
 * - Concatenates rapid-fire messages into a single user turn
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

const PERSISTENCE_FILE = 'conversation-state.json';
const RAPID_FIRE_WINDOW_MS = 3000;

let messages: MessageParam[] = [];
let workspacePath: string = '';
let turnQueue: Promise<void> = Promise.resolve();
let pendingUserMessages: Array<{ content: string; timestamp: number }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Context utilization tracking — updated after each API call
let lastInputTokens: number = 0;
let compactionDetectedThisSession: boolean = false;
const COMPACTION_TRIGGER_TOKENS = 80_000;

/**
 * Initialize the conversation state, reloading from disk if available.
 */
export async function initConversationState(wsPath: string): Promise<void> {
  workspacePath = wsPath;

  const filePath = getStatePath();
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.messages)) {
      messages = parsed.messages;
      console.log(`[conversation-state] Restored ${messages.length} messages from disk`);
    }
  } catch {
    console.log('[conversation-state] No prior state on disk, starting fresh');
    messages = [];
  }
}

function getStatePath(): string {
  return join(workspacePath, 'conversations', PERSISTENCE_FILE);
}

/**
 * Get the current messages array (read-only reference).
 */
export function getMessages(): MessageParam[] {
  return messages;
}

/**
 * Get the count of messages.
 */
export function getMessageCount(): number {
  return messages.length;
}

/**
 * Append a user message to the conversation.
 */
export function appendUserMessage(content: string): void {
  messages.push({ role: 'user', content });
}

/**
 * Append a user message with structured content blocks (e.g. image + text).
 * Returns the index of the appended message for post-turn modification.
 */
export function appendUserContentBlocks(blocks: ContentBlockParam[]): number {
  const index = messages.length;
  messages.push({ role: 'user', content: blocks });
  return index;
}

/**
 * Replace image blocks in a specific user message with a text placeholder.
 * Used after a vision turn to avoid persisting large base64 data.
 */
export function replaceImageBlocks(messageIndex: number, placeholder: string): void {
  const msg = messages[messageIndex];
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return;

  msg.content = (msg.content as ContentBlockParam[]).map(block => {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const typed = block as { type: string };
      if (typed.type === 'image') {
        return { type: 'text' as const, text: placeholder };
      }
    }
    return block;
  });
}

/**
 * Append an assistant response (full content blocks) to the conversation.
 * Strips thinking blocks before storing.
 */
export function appendAssistantResponse(contentBlocks: ContentBlockParam[]): void {
  const stripped = stripThinkingBlocks(contentBlocks);
  messages.push({ role: 'assistant', content: stripped });
}

/**
 * Append a raw MessageParam (used for tool_result turns).
 */
export function appendRawMessage(msg: MessageParam): void {
  messages.push(msg);
}

/**
 * Roll back the last user message. Called when a turn fails mid-flight
 * to prevent stale messages from corrupting the conversation state.
 */
export function rollbackLastUserMessage(): void {
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    messages.pop();
    console.log('[conversation-state] Rolled back last user message after failed turn');
  }
}

/**
 * Truncate the messages array to a specific length.
 * Used by the heartbeat to roll back an entire turn (trigger + response)
 * when the decision is NO_NOTIFICATION.
 */
export function truncateMessages(length: number): void {
  if (length >= 0 && length < messages.length) {
    const removed = messages.length - length;
    messages.length = length;
    console.log(`[conversation-state] Truncated ${removed} message(s)`);
  }
}

/**
 * Rewrite the content of a message at a specific index.
 * Used to replace the heartbeat trigger with a minimal clock marker
 * after Claire decides to send a real message.
 */
export function rewriteMessageContent(index: number, content: string): void {
  if (index >= 0 && index < messages.length) {
    messages[index] = { ...messages[index], content };
  }
}

/**
 * Persist the current messages array to disk.
 * Called after each complete turn.
 */
export async function persistState(): Promise<void> {
  const filePath = getStatePath();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const data = JSON.stringify({ messages, lastPersisted: new Date().toISOString() }, null, 2);
    await writeFile(filePath, data, 'utf-8');
    console.log(`[conversation-state] Persisted ${messages.length} messages to disk`);
  } catch (err) {
    console.error('[conversation-state] Failed to persist:', err);
  }
}

/**
 * Strip thinking blocks from content. They're ephemeral reasoning
 * and don't survive to the next turn.
 */
function stripThinkingBlocks(blocks: ContentBlockParam[]): ContentBlockParam[] {
  return blocks.filter(block => {
    if (typeof block === 'string') return true;
    if (typeof block === 'object' && block !== null && 'type' in block) {
      return (block as { type: string }).type !== 'thinking';
    }
    return true;
  });
}

/**
 * Enqueue a turn. All incoming messages — regardless of channel — are serialized
 * through this queue. If an API call is in-flight, new messages wait.
 *
 * @param fn - The async function representing this turn's work
 * @returns The result of the turn function
 */
export function enqueueTurn<T>(fn: () => Promise<T>): Promise<T> {
  const result = turnQueue.then(fn, fn);
  turnQueue = result.then(() => {}, () => {});
  return result;
}

/**
 * Queue a rapid-fire user message. If multiple messages arrive within the
 * rapid-fire window, they're concatenated into a single user turn.
 *
 * @returns A promise that resolves when the message (or batch) is ready to process
 */
export function queueRapidFireMessage(
  content: string,
  onBatch: (combined: string) => Promise<void>
): void {
  pendingUserMessages.push({ content, timestamp: Date.now() });

  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(async () => {
    const batch = pendingUserMessages.splice(0);
    flushTimer = null;

    if (batch.length === 0) return;

    const combined = batch.length === 1
      ? batch[0].content
      : batch.map(m => m.content).join('\n\n');

    await onBatch(combined);
  }, RAPID_FIRE_WINDOW_MS);
}

/**
 * Get the last N messages from the conversation (for heartbeat context).
 */
export function getRecentMessagesFromState(limit: number = 10): MessageParam[] {
  return messages.slice(-limit);
}

/**
 * Prune the messages array, keeping only the most recent `keepCount` messages.
 * Called during nightly maintenance after daily files have captured older context.
 * Returns the number of messages removed.
 */
export function pruneMessages(keepCount: number): number {
  if (messages.length <= keepCount) return 0;
  const removed = messages.length - keepCount;
  messages = messages.slice(-keepCount);
  console.log(`[conversation-state] Pruned ${removed} messages, retained last ${keepCount}`);
  return removed;
}

/**
 * Update context utilization after an API call completes.
 * Called by chat() and chatStreaming() with the response's input_tokens.
 */
export function updateTokenUsage(inputTokens: number, compacted: boolean): void {
  lastInputTokens = inputTokens;
  if (compacted) {
    compactionDetectedThisSession = true;
  }
}

/**
 * Get current context utilization — how full the context window is.
 */
export function getTokenUsage(): {
  inputTokens: number;
  threshold: number;
  utilizationPct: number;
  compacted: boolean;
} {
  return {
    inputTokens: lastInputTokens,
    threshold: COMPACTION_TRIGGER_TOKENS,
    utilizationPct: lastInputTokens > 0
      ? Math.round((lastInputTokens / COMPACTION_TRIGGER_TOKENS) * 1000) / 10
      : 0,
    compacted: compactionDetectedThisSession,
  };
}

/**
 * Get the text content of the last assistant message (for logging).
 */
export function getLastAssistantText(): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null && 'type' in block) {
            const typed = block as { type: string; text?: string };
            if (typed.type === 'text' && typed.text) return typed.text;
          }
        }
      }
      return null;
    }
  }
  return null;
}
