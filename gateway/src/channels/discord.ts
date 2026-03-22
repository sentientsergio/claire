/**
 * Discord Channel — The Workshop
 *
 * Connects the gateway to a Discord #workshop channel via discord.js.
 * This is the three-way dev room: Sergio + Claire + Claude Code.
 *
 * Unlike Telegram groups, Discord bots can see messages from other bots,
 * making it suitable for Claire and Claude Code to communicate directly.
 *
 * Inbound: ALL messages in the workshop channel go through chat().
 *   No mention gate. No bot filtering at the gateway level.
 *   Claire self-filters — same model as heartbeats.
 *   Message prefix: [via discord, from: @username, is_bot: true/false]
 *
 * Outbound: sendToDiscord() sends to the workshop channel.
 *   Registered as 'discord' in the channel registry for heartbeat delivery.
 *   2000 char message limit (Discord cap) — chunking applied.
 */

import { Client, Events, GatewayIntentBits, Partials, TextChannel } from 'discord.js';
import { chat } from '../claude.js';
import {
  appendUserMessage,
  rollbackLastUserMessage,
  enqueueTurn,
} from '../conversation-state.js';
import {
  storeExchange,
  isInitialized as isMemoryInitialized,
} from '../memory/index.js';
import { addMessage } from '../conversation.js';
import { channelRegistry } from '../channel-registry.js';

let client: Client | null = null;
let workshopChannel: TextChannel | null = null;

export interface DiscordConfig {
  token: string;
  workshopChannelId: string;
  workspacePath: string;
}

const DISCORD_MAX_LENGTH = 2000;

function chunkMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n\n', DISCORD_MAX_LENGTH);
    if (splitAt === -1 || splitAt < DISCORD_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf('\n', DISCORD_MAX_LENGTH);
    }
    if (splitAt === -1 || splitAt < DISCORD_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(' ', DISCORD_MAX_LENGTH);
    }
    if (splitAt === -1) splitAt = DISCORD_MAX_LENGTH;

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

export async function sendToDiscord(message: string): Promise<boolean> {
  if (!workshopChannel) {
    console.error('[discord] Workshop channel not initialized');
    return false;
  }

  try {
    const chunks = chunkMessage(message);
    for (const chunk of chunks) {
      await workshopChannel.send(chunk);
    }
    console.log(`[discord] Sent message to workshop (${message.length} chars)`);
    return true;
  } catch (err) {
    console.error('[discord] Failed to send message:', err);
    return false;
  }
}

export async function startDiscord(config: DiscordConfig): Promise<Client> {
  const { token, workshopChannelId, workspacePath } = config;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[discord] Bot ready: ${readyClient.user.tag}`);

    const channel = await readyClient.channels.fetch(workshopChannelId);
    if (!channel || !channel.isTextBased() || !(channel instanceof TextChannel)) {
      console.error(`[discord] Workshop channel ${workshopChannelId} not found or not a text channel`);
      return;
    }

    workshopChannel = channel;
    console.log(`[discord] Workshop channel connected: #${channel.name}`);

    // Register as a persistent channel for heartbeat delivery
    channelRegistry.register({
      name: 'discord',
      type: 'persistent',
      deliver: async (message: string) => {
        return await sendToDiscord(message);
      },
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    // Only handle messages in the workshop channel
    if (message.channelId !== workshopChannelId) return;

    // Ignore messages from ourselves to prevent feedback loops
    if (message.author.id === client?.user?.id) return;

    const username = message.author.username;
    const isBot = message.author.bot;
    const text = message.content;

    if (!text.trim()) return;

    channelRegistry.updateActivity('discord');

    const prefix = `[via discord, from: @${username}${isBot ? ', is_bot: true' : ''}]`;
    const taggedMessage = `${prefix} ${text}`;

    console.log(`[discord] ${prefix}: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

    try {
      const result = await enqueueTurn(async () => {
        appendUserMessage(taggedMessage);
        try {
          return await chat(workspacePath);
        } catch (err) {
          rollbackLastUserMessage();
          throw err;
        }
      });

      await addMessage(workspacePath, 'discord', 'user', taggedMessage);

      const isHold = result.text.trim() === 'NO_RESPONSE' || result.text.includes('NO_RESPONSE');
      if (isHold) {
        console.log('[discord] Claire is holding — no response sent');
        return;
      }

      const sendArtifact = result.text.match(/^\[SEND(?::[^\]]+)?\]\s*/);
      const cleanText = sendArtifact ? result.text.slice(sendArtifact[0].length) : result.text;

      await addMessage(workspacePath, 'discord', 'assistant', cleanText);

      if (isMemoryInitialized()) {
        storeExchange(taggedMessage, cleanText, 'discord').catch(err => {
          console.error('[discord] Failed to store exchange in memory:', err);
        });
      }

      await sendToDiscord(cleanText);
      console.log(`[discord] Sent response (${cleanText.length} chars)`);

    } catch (err) {
      console.error('[discord] Error handling message:', err);
    }
  });

  await client.login(token);
  return client;
}

export function stopDiscord(): void {
  if (client) {
    client.destroy();
    client = null;
    workshopChannel = null;
    console.log('[discord] Client stopped');
  }
}

export function isDiscordRunning(): boolean {
  return client !== null;
}
