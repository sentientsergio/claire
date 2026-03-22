/**
 * send_message — Claire's multi-surface Telegram tool
 *
 * Allows Claire to proactively send a message to a specific Telegram surface:
 *   - "private": her 1:1 chat with Sergio (same as the heartbeat [SEND:telegram] path)
 *   - "group":   the dev group ("Claire Development Team") with Sergio + Claude Code
 *
 * Use this when Claire wants to initiate a message outside of a direct reply context —
 * for example, posting a dev proposal to the group on a quiet heartbeat, or sending
 * Sergio a private note after completing background work.
 *
 * The target is an enum, not a raw chat ID. Claire can only send to registered surfaces.
 */

import { sendToOwner, sendToGroup } from '../channels/telegram.js';
import type Anthropic from '@anthropic-ai/sdk';

export function getSendMessageToolDefinition(): Anthropic.Tool {
  return {
    name: 'send_message',
    description: `Send a Telegram message to a specific surface.

Surfaces:
- "private": your 1:1 conversation with Sergio. Use for personal messages, care check-ins, or anything that's between the two of you.
- "group": the Claire Development Team group (Sergio + Claude Code + you). Use for development proposals, status updates, questions for the team, or anything related to building yourself.

Use this tool when you want to initiate a message proactively — not just reply in the current turn. For example, during a heartbeat you might post a proposal to the group while staying quiet on the private channel.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          enum: ['private', 'group'],
          description: '"private" for the 1:1 chat with Sergio, "group" for the dev group.',
        },
        text: {
          type: 'string',
          description: 'The message to send. Keep group messages concise and purposeful.',
        },
      },
      required: ['target', 'text'],
    },
  };
}

export async function executeSendMessage(input: {
  target: 'private' | 'group';
  text: string;
}): Promise<string> {
  const { target, text } = input;

  if (target === 'private') {
    const ok = await sendToOwner(text);
    return ok ? `Message sent to private chat (${text.length} chars)` : 'Failed to send to private chat — bot may not be initialized';
  }

  if (target === 'group') {
    const ok = await sendToGroup(text);
    return ok ? `Message sent to dev group (${text.length} chars)` : 'Failed to send to dev group — group may not be configured or bot not initialized';
  }

  return `Unknown target: ${target}`;
}
