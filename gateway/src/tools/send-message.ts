/**
 * send_message — Claire's multi-surface messaging tool
 *
 * Allows Claire to proactively send a message to a specific surface:
 *   - "private":  her 1:1 Telegram chat with Sergio
 *   - "discord":  the #workshop channel (Sergio + Claude Code + Claire)
 *
 * Use this when Claire wants to initiate a message outside of a direct reply context —
 * for example, posting a dev proposal to Discord on a quiet heartbeat, or sending
 * Sergio a private note after completing background work.
 *
 * The target is an enum, not a raw channel ID. Claire can only send to registered surfaces.
 */

import { sendToOwner } from '../channels/telegram.js';
import { sendToDiscord } from '../channels/discord.js';
import type Anthropic from '@anthropic-ai/sdk';

export function getSendMessageToolDefinition(): Anthropic.Tool {
  return {
    name: 'send_message',
    description: `Send a message to a specific surface.

Surfaces:
- "private": your 1:1 Telegram conversation with Sergio. Use for personal messages, care check-ins, or anything that's between the two of you.
- "discord": the #workshop channel on Discord (Sergio + Claude Code + you). Use for development proposals, status updates, questions for the team, or anything related to building yourself.

Use this tool when you want to initiate a message proactively — not just reply in the current turn. For example, during a heartbeat you might post a proposal to Discord while staying quiet on the private Telegram channel.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          enum: ['private', 'discord'],
          description: '"private" for the 1:1 Telegram chat with Sergio, "discord" for the workshop channel.',
        },
        text: {
          type: 'string',
          description: 'The message to send. Keep Discord messages concise and purposeful.',
        },
      },
      required: ['target', 'text'],
    },
  };
}

export async function executeSendMessage(input: {
  target: 'private' | 'discord';
  text: string;
}): Promise<string> {
  const { target, text } = input;

  if (target === 'private') {
    const ok = await sendToOwner(text);
    return ok
      ? `Message sent to private Telegram chat (${text.length} chars)`
      : 'Failed to send to private chat — Telegram bot may not be initialized';
  }

  if (target === 'discord') {
    const ok = await sendToDiscord(text);
    return ok
      ? `Message sent to Discord workshop (${text.length} chars)`
      : 'Failed to send to Discord — bot may not be initialized or channel not configured';
  }

  return `Unknown target: ${target}`;
}
