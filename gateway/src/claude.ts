/**
 * Claude API Client — v2
 *
 * Uses the Anthropic Compaction beta to maintain a persistent conversation.
 * The full messages array is passed to every API call. Compaction handles
 * context growth automatically.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  fileRead,
  fileWrite,
  fileList,
  getCurrentTime,
  getContextUtilization,
  getToolDefinitions,
  scheduleHeartbeat,
  listHeartbeats,
  cancelHeartbeat,
} from './tools/files.js';
import { webFetch, getWebToolDefinitions } from './tools/web.js';
import {
  listEvents,
  createEvent,
  getCalendarToolDefinitions,
  isCalendarConfigured,
} from './tools/calendar.js';
import {
  getSearchMemoryToolDefinition,
  executeSearchMemory,
  getUpdateStatusToolDefinition,
  executeUpdateStatus,
} from './tools/memory-tools.js';
import {
  fetchImage,
  rememberImage,
  getImageToolDefinitions,
} from './tools/image-cache.js';
import {
  getSelfDevelopToolDefinition,
  executeSelfDevelop,
} from './tools/self-develop.js';
import {
  getSendMessageToolDefinition,
  executeSendMessage,
} from './tools/send-message.js';
import {
  getMessages,
  appendAssistantResponse,
  appendRawMessage,
  persistState,
  updateTokenUsage,
  getTokenUsage,
} from './conversation-state.js';
import { maybeAutoCheckpoint } from './checkpoint.js';
import { getSystemPrompt, loadCompactionInstructions } from './workspace.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

const SONNET_MODEL = 'claude-sonnet-4-6';
const OPUS_MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 4096;
const OPUS_MAX_TOKENS = 8192;
const COMPACTION_TRIGGER_TOKENS = 80_000;
const COMPACTION_BETA = 'compact-2026-01-12';

export interface ChatResult {
  thinking: string;
  text: string;
}

type StreamCallback = (delta: string) => void;

interface ToolInput {
  path?: string;
  directory?: string;
  content?: string;
  purpose?: string;
  scheduled_for?: string;
  recurring_schedule?: string;
  id?: string;
  url?: string;
  max_results?: number;
  summary?: string;
  start_time?: string;
  end_time?: string;
  description?: string;
  location?: string;
  query?: string;
  search_type?: string;
  updates?: Record<string, unknown>;
}

type ToolResult = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

async function executeTool(name: string, toolInput: ToolInput, workspacePath: string): Promise<ToolResult> {
  switch (name) {
    case 'file_read':
      return await fileRead(workspacePath, toolInput.path || '');
    case 'file_write':
      return await fileWrite(workspacePath, toolInput.path || '', toolInput.content || '');
    case 'file_list':
      return await fileList(workspacePath, toolInput.directory || '.');
    case 'schedule_heartbeat':
      return await scheduleHeartbeat(toolInput.purpose || '', toolInput.scheduled_for, toolInput.recurring_schedule);
    case 'list_scheduled_heartbeats':
      return await listHeartbeats();
    case 'cancel_scheduled_heartbeat':
      return await cancelHeartbeat(toolInput.id || '');
    case 'web_fetch':
      return await webFetch(toolInput.url || '');
    case 'calendar_list_events':
      return await listEvents(toolInput.max_results || 10);
    case 'calendar_create_event':
      return await createEvent(
        toolInput.summary || '', toolInput.start_time || '', toolInput.end_time || '',
        toolInput.description, toolInput.location
      );
    case 'search_memory':
      return await executeSearchMemory(toolInput.query || '', toolInput.search_type);
    case 'update_status':
      return await executeUpdateStatus(workspacePath, toolInput.updates || {});
    case 'get_time':
      return getCurrentTime();
    case 'get_context_utilization':
      return getContextUtilization();
    case 'fetch_image': {
      const result = await fetchImage(toolInput.id || '');
      if (result.available) {
        return [
          result.contentBlock,
          { type: 'text', text: `Image ${result.entry.id} — ${result.entry.caption || 'no caption'}` },
        ];
      }
      return `${result.reason} Last known description: ${result.summary}`;
    }
    case 'remember_image':
      return await rememberImage(toolInput.id || '');
    case 'self_develop':
      return await executeSelfDevelop({
        task: (toolInput as { task?: string; max_budget_usd?: number; max_turns?: number }).task || '',
        max_budget_usd: (toolInput as { max_budget_usd?: number }).max_budget_usd,
        max_turns: (toolInput as { max_turns?: number }).max_turns,
      });
    case 'send_message':
      return await executeSendMessage({
        target: (toolInput as { target?: 'private' | 'group' }).target ?? 'private',
        text: (toolInput as { text?: string }).text ?? '',
      });
    default:
      return `Unknown tool: ${name}`;
  }
}

function getAllTools(): Anthropic.Tool[] {
  return [
    ...getToolDefinitions(),
    ...getWebToolDefinitions(),
    ...(isCalendarConfigured() ? getCalendarToolDefinitions() : []),
    getSearchMemoryToolDefinition(),
    getUpdateStatusToolDefinition(),
    ...getImageToolDefinitions(),
    getSelfDevelopToolDefinition(),
    getSendMessageToolDefinition(),
  ];
}

function getReadOnlyTools(): Anthropic.Tool[] {
  return [
    ...getToolDefinitions().filter(t =>
      t.name === 'file_read' || t.name === 'file_list'
    ),
    getSearchMemoryToolDefinition(),
  ];
}

/**
 * Build the compaction configuration object.
 */
async function getCompactionConfig(workspacePath: string) {
  const instructions = await loadCompactionInstructions(workspacePath);
  return {
    edits: [{
      type: 'compact_20260112' as const,
      trigger: { type: 'input_tokens' as const, value: COMPACTION_TRIGGER_TOKENS },
      ...(instructions ? { instructions } : {}),
    }],
  };
}

/**
 * Main chat function — non-streaming, uses the persistent messages array
 * with Compaction.
 *
 * The user message should already be appended to conversation state before calling.
 * This function handles tool loops, appends the final assistant response, and persists.
 */
export async function chat(
  workspacePath: string,
): Promise<ChatResult> {
  console.log(`[chat] Using ${SONNET_MODEL} with compaction`);

  const systemPrompt = await getSystemPrompt(workspacePath);
  const contextManagement = await getCompactionConfig(workspacePath);

  let lastNonEmptyText = '';

  while (true) {
    const response = await getClient().beta.messages.create({
      betas: [COMPACTION_BETA],
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: getMessages(),
      tools: getAllTools() as Anthropic.Beta.BetaTool[],
      context_management: contextManagement,
    });

    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    const assistantContent = response.content;
    let turnText = '';
    let compactionThisTurn = false;

    for (const block of assistantContent) {
      if (block.type === 'text') {
        turnText += block.text;
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      } else if ((block as { type: string }).type === 'compaction') {
        console.log('[chat] Compaction triggered this turn');
        compactionThisTurn = true;
      }
    }

    updateTokenUsage(response.usage.input_tokens, compactionThisTurn);
    await maybeAutoCheckpoint(getTokenUsage().utilizationPct, workspacePath);

    if (turnText.trim()) {
      lastNonEmptyText = turnText;
    }

    if (toolUses.length === 0) {
      appendAssistantResponse(assistantContent as Anthropic.Beta.BetaContentBlockParam[]);
      await persistState();
      return { thinking: '', text: turnText.trim() ? turnText : lastNonEmptyText };
    }

    // Append assistant turn (with tool_use blocks)
    appendAssistantResponse(assistantContent as Anthropic.Beta.BetaContentBlockParam[]);

    // Execute tools and append results
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: ToolResult }> = [];
    for (const toolUse of toolUses) {
      const toolInput = toolUse.input as ToolInput;
      let toolResult: ToolResult;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult });
      console.log(`[chat] Tool ${toolUse.name} executed`);
    }

    appendRawMessage({ role: 'user', content: toolResults });
  }
}

/**
 * Streaming chat — same as chat() but streams text deltas via callback.
 * Used by the WebSocket server for CLI.
 */
export async function chatStreaming(
  workspacePath: string,
  onDelta: StreamCallback,
): Promise<ChatResult> {
  console.log(`[chat] Using ${SONNET_MODEL} with compaction (streaming)`);

  const systemPrompt = await getSystemPrompt(workspacePath);
  const contextManagement = await getCompactionConfig(workspacePath);

  let lastNonEmptyText = '';

  while (true) {
    const stream = getClient().beta.messages.stream({
      betas: [COMPACTION_BETA],
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: getMessages(),
      tools: getAllTools() as Anthropic.Beta.BetaTool[],
      context_management: contextManagement,
    });

    let currentText = '';
    let hasToolUse = false;

    stream.on('text', (text) => {
      currentText += text;
      if (!hasToolUse) {
        onDelta(text);
      }
    });

    const finalMessage = await stream.finalMessage();

    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    let compactionThisTurn = false;

    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      } else if ((block as { type: string }).type === 'compaction') {
        console.log('[chat] Compaction triggered this turn');
        compactionThisTurn = true;
      }
    }

    updateTokenUsage(finalMessage.usage.input_tokens, compactionThisTurn);
    await maybeAutoCheckpoint(getTokenUsage().utilizationPct, workspacePath);

    if (currentText.trim()) {
      lastNonEmptyText = currentText;
    }

    if (toolUses.length === 0) {
      appendAssistantResponse(finalMessage.content as unknown as Anthropic.Beta.BetaContentBlockParam[]);
      await persistState();
      return { thinking: '', text: currentText.trim() ? currentText : lastNonEmptyText };
    }

    // Append assistant turn
    appendAssistantResponse(finalMessage.content as unknown as Anthropic.Beta.BetaContentBlockParam[]);

    // Execute tools
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: ToolResult }> = [];
    for (const toolUse of toolUses) {
      const toolInput = toolUse.input as ToolInput;
      let toolResult: ToolResult;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult });
      console.log(`[chat] Tool ${toolUse.name} executed`);
    }

    appendRawMessage({ role: 'user', content: toolResults });
  }
}

/**
 * Non-streaming chat for heartbeat decisions.
 * Uses a SEPARATE messages array (not the main conversation).
 */
export async function simpleChat(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const response = await getClient().messages.create({
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

/**
 * Non-streaming Sonnet chat with tool access for nightly maintenance tasks
 * (memory curation, handoff). Uses a SEPARATE messages array.
 * Same interface as opusChat but uses the cheaper Sonnet model — appropriate
 * for mechanical read-distill-write tasks that don't require deep reasoning.
 */
export async function sonnetMaintenanceChat(
  userMessage: string,
  systemPrompt: string,
  workspacePath: string,
  options: { readOnly?: boolean } = {}
): Promise<string> {
  console.log(`[chat] Using sonnet-maintenance (${SONNET_MODEL})`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let lastNonEmptyText = '';

  while (true) {
    const response = await getClient().messages.create({
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools: options.readOnly ? getReadOnlyTools() : getAllTools(),
    });

    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    const assistantContent: Anthropic.ContentBlock[] = [];
    let turnText = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        turnText += block.text;
        assistantContent.push(block);
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
        assistantContent.push(block);
      }
    }

    if (turnText.trim()) {
      lastNonEmptyText = turnText;
    }

    if (toolUses.length === 0) {
      return turnText.trim() ? turnText : lastNonEmptyText;
    }

    const toolResults: Array<{ tool_use_id: string; content: ToolResult }> = [];
    for (const toolUse of toolUses) {
      const toolInput = toolUse.input as ToolInput;
      let toolResult: ToolResult;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      toolResults.push({ tool_use_id: toolUse.id, content: toolResult });
      console.log(`[sonnet-maintenance] Tool ${toolUse.name} executed`);
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result' as const, tool_use_id: r.tool_use_id, content: r.content,
      })),
    });
  }
}

/**
 * Non-streaming Opus chat with tool access for nightly reflective tasks.
 * Uses a SEPARATE messages array (not the main conversation).
 */
export async function opusChat(
  userMessage: string,
  systemPrompt: string,
  workspacePath: string,
  options: { readOnly?: boolean } = {}
): Promise<string> {
  const mode = options.readOnly ? 'opus/read-only' : 'opus';
  console.log(`[chat] Using ${mode} (${OPUS_MODEL})`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let lastNonEmptyText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turns = 0;
  const startTime = Date.now();

  const OPUS_INPUT_COST_PER_M = 5.0;
  const OPUS_OUTPUT_COST_PER_M = 25.0;

  while (true) {
    const response = await getClient().messages.create({
      model: OPUS_MODEL,
      max_tokens: OPUS_MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools: options.readOnly ? getReadOnlyTools() : getAllTools(),
    });

    turns++;
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    const assistantContent: Anthropic.ContentBlock[] = [];
    let turnText = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        turnText += block.text;
        assistantContent.push(block);
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
        assistantContent.push(block);
      }
    }

    if (turnText.trim()) {
      lastNonEmptyText = turnText;
    }

    if (toolUses.length === 0) {
      const elapsedMs = Date.now() - startTime;
      const inputCost = (totalInputTokens / 1_000_000) * OPUS_INPUT_COST_PER_M;
      const outputCost = (totalOutputTokens / 1_000_000) * OPUS_OUTPUT_COST_PER_M;
      const totalCost = inputCost + outputCost;
      console.log(
        `[opus] Complete — ${turns} turn(s), ` +
        `${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out tokens, ` +
        `$${totalCost.toFixed(4)} (${(elapsedMs / 1000).toFixed(1)}s)`
      );
      return turnText.trim() ? turnText : lastNonEmptyText;
    }

    const toolResults: Array<{ tool_use_id: string; content: ToolResult }> = [];
    for (const toolUse of toolUses) {
      const toolInput = toolUse.input as ToolInput;
      let toolResult: ToolResult;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      toolResults.push({ tool_use_id: toolUse.id, content: toolResult });
      console.log(`[opus] Tool ${toolUse.name} executed (turn ${turns})`);
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result' as const, tool_use_id: r.tool_use_id, content: r.content,
      })),
    });
  }
}
