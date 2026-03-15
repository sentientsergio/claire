/**
 * Telegram Channel — v2
 *
 * Connects the gateway to Telegram via grammY.
 * Only responds to messages from the configured owner user ID.
 *
 * Uses the unified conversation state — one messages array across all channels.
 * Registered with ChannelRegistry as a persistent channel for heartbeat delivery.
 *
 * Voice support:
 *   Incoming: .ogg voice messages → Whisper STT → converse as text
 *   Outgoing: Optional TTS via OpenAI (toggle via status.json preferences.voice_responses)
 */

import { Bot, Context, InputFile } from 'grammy';
import { chat } from '../claude.js';
import {
  appendUserMessage,
  appendUserContentBlocks,
  replaceImageBlocks,
  rollbackLastUserMessage,
  enqueueTurn,
  persistState,
} from '../conversation-state.js';
import {
  storeExchange,
  isInitialized as isMemoryInitialized,
} from '../memory/index.js';
import { addMessage } from '../conversation.js';
import { cacheImage, updateImageSummary } from '../tools/image-cache.js';
import { channelRegistry } from '../channel-registry.js';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';

let bot: Bot | null = null;
let ownerChatId: number | null = null;
let openaiClient: OpenAI | null = null;

interface TelegramConfig {
  token: string;
  ownerId: number;
  workspacePath: string;
}

async function getShowThinking(workspacePath: string): Promise<boolean> {
  try {
    const statusPath = path.join(workspacePath, 'status.json');
    const content = await fs.readFile(statusPath, 'utf-8');
    const status = JSON.parse(content);
    return status.preferences?.show_thinking ?? false;
  } catch {
    return false;
  }
}

async function setShowThinking(workspacePath: string, value: boolean): Promise<void> {
  const statusPath = path.join(workspacePath, 'status.json');
  const content = await fs.readFile(statusPath, 'utf-8');
  const status = JSON.parse(content);

  if (!status.preferences) {
    status.preferences = {};
  }
  status.preferences.show_thinking = value;

  await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
  console.log(`[telegram] Set show_thinking to ${value}`);
}

function parseThinkingCommand(message: string): 'show' | 'hide' | null {
  const lower = message.toLowerCase().trim();
  if (lower.match(/\b(show|enable|turn on)\b.*thinking/i)) return 'show';
  if (lower.match(/\b(hide|disable|turn off)\b.*thinking/i)) return 'hide';
  return null;
}

async function getVoiceResponsesEnabled(workspacePath: string): Promise<boolean> {
  try {
    const statusPath = path.join(workspacePath, 'status.json');
    const content = await fs.readFile(statusPath, 'utf-8');
    const status = JSON.parse(content);
    return status.preferences?.voice_responses ?? false;
  } catch {
    return false;
  }
}

/**
 * Transcribe a Telegram voice message (.ogg) using OpenAI Whisper.
 * Returns the transcription text, or null if transcription fails.
 */
async function transcribeVoice(
  fileUrl: string,
  token: string
): Promise<string | null> {
  if (!openaiClient) return null;

  try {
    const audioRes = await fetch(fileUrl);
    if (!audioRes.ok) {
      console.error(`[telegram] Failed to download voice file: ${audioRes.status}`);
      return null;
    }

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // Whisper API requires a File-like object — wrap buffer as a readable stream
    const audioFile = new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' });

    const result = await openaiClient.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
    });

    return result.text || null;
  } catch (err) {
    console.error('[telegram] Whisper transcription error:', err);
    return null;
  }
}

/**
 * Synthesize text to speech using OpenAI TTS and send as a Telegram voice message.
 */
async function sendVoiceResponse(
  ctx: Context,
  text: string,
  ownerChatId: number
): Promise<void> {
  if (!openaiClient || !bot) return;

  try {
    // Truncate long responses — TTS has a 4096 char limit
    const ttsText = text.length > 4000 ? text.slice(0, 4000) + '...' : text;

    const mp3 = await openaiClient.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: ttsText,
    });

    const audioBuffer = Buffer.from(await mp3.arrayBuffer());

    await bot.api.sendVoice(ownerChatId, new InputFile(audioBuffer, 'response.mp3'));
    console.log('[telegram] Sent TTS voice response');
  } catch (err) {
    console.error('[telegram] TTS error, falling back to text:', err);
    await sendLongMessage(ctx, text);
  }
}

export async function startTelegram(config: TelegramConfig): Promise<Bot> {
  const { token, ownerId, workspacePath } = config;

  bot = new Bot(token);
  ownerChatId = ownerId;

  // Initialize OpenAI client for Whisper STT and optional TTS
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    openaiClient = new OpenAI({ apiKey: openaiKey });
    console.log('[telegram] OpenAI client initialized (voice support enabled)');
  } else {
    console.log('[telegram] No OPENAI_API_KEY — voice support disabled');
  }

  // Register with ChannelRegistry as a persistent channel
  channelRegistry.register({
    name: 'telegram',
    type: 'persistent',
    deliver: async (message: string) => {
      return await sendToOwner(message);
    },
  });

  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== ownerId) {
      console.log(`[telegram] Ignoring message from non-owner: ${ctx.from?.id}`);
      return;
    }
    await next();
  });

  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    console.log(`[telegram] Received: "${userMessage.substring(0, 50)}..."`);

    channelRegistry.updateActivity('telegram');

    const thinkingCommand = parseThinkingCommand(userMessage);
    if (thinkingCommand) {
      const newValue = thinkingCommand === 'show';
      await setShowThinking(workspacePath, newValue);
      await ctx.reply(
        newValue
          ? "🧠 Thinking mode enabled. I'll show you my reasoning process."
          : "🧠 Thinking mode disabled. I'll just show you my responses."
      );
      return;
    }

    await ctx.replyWithChatAction('typing');

    try {
      const result = await enqueueTurn(async () => {
        appendUserMessage(userMessage);
        try {
          return await chat(workspacePath);
        } catch (err) {
          rollbackLastUserMessage();
          throw err;
        }
      });

      // Log the user message regardless of whether Claire responds
      await addMessage(workspacePath, 'telegram', 'user', userMessage);

      const isHold = result.text.trim() === 'NO_RESPONSE' || result.text.includes('NO_RESPONSE');
      if (isHold) {
        console.log('[telegram] Claire is holding — no response sent');
        return;
      }

      // Strip any accidental [SEND] / [SEND:channel] prefix that leaked from heartbeat conventions
      const sendArtifact = result.text.match(/^\[SEND(?::[^\]]+)?\]\s*/);
      const cleanText = sendArtifact ? result.text.slice(sendArtifact[0].length) : result.text;
      if (sendArtifact) {
        console.warn('[telegram] Stripped accidental [SEND] artifact from conversational response');
      }

      const showThinking = await getShowThinking(workspacePath);
      let fullResponse: string;
      if (showThinking && result.thinking) {
        fullResponse = `<thinking>\n${result.thinking}\n</thinking>\n\n${cleanText}`;
      } else {
        fullResponse = cleanText;
      }

      await addMessage(workspacePath, 'telegram', 'assistant', cleanText);

      if (isMemoryInitialized()) {
        storeExchange(userMessage, cleanText, 'telegram').catch(err => {
          console.error('[telegram] Failed to store exchange in memory:', err);
        });
      }

      await sendLongMessage(ctx, fullResponse);
      console.log(`[telegram] Sent response (${fullResponse.length} chars)`);

    } catch (err) {
      console.error('[telegram] Error:', err);
      const isOverloaded = err instanceof Error && err.message.includes('529');
      const errMsg = isOverloaded
        ? "I'm temporarily overwhelmed (Anthropic is overloaded). Give it a moment and try again."
        : 'Sorry, I encountered an error. Please try again.';
      await ctx.reply(errMsg);
    }
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      "Hey! I'm your assistant. Just send me a message and I'll respond.\n\n" +
      "I have access to my workspace files, so I know who I am and who you are."
    );
  });

  bot.command('status', async (ctx) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    await ctx.reply(
      `🟢 Online\n` +
      `⏱ Uptime: ${hours}h ${minutes}m\n` +
      `📁 Workspace: connected`
    );
  });

  bot.on('message:voice', async (ctx) => {
    const voice = ctx.message.voice;
    console.log(`[telegram] Received voice message (${voice.duration}s, ${voice.mime_type})`);
    await ctx.replyWithChatAction('typing');

    try {
      let userMessage: string;

      if (openaiClient) {
        const file = await ctx.api.getFile(voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const transcription = await transcribeVoice(fileUrl, token);

        if (transcription) {
          console.log(`[telegram] Transcribed: "${transcription.substring(0, 60)}..."`);
          userMessage = `[Voice message transcription]: ${transcription}`;
        } else {
          userMessage = '[Voice message received — transcription failed. Acknowledge and ask the user to resend as text.]';
        }
      } else {
        userMessage = '[Voice message received — no STT configured. Let the user know you received their voice message but cannot transcribe it without an OpenAI API key.]';
      }

      channelRegistry.updateActivity('telegram');

      const result = await enqueueTurn(async () => {
        appendUserMessage(userMessage);
        try {
          const chatResult = await chat(workspacePath);
          await persistState();
          return chatResult;
        } catch (err) {
          rollbackLastUserMessage();
          throw err;
        }
      });

      const isHold = result.text.trim() === 'NO_RESPONSE' || result.text.includes('NO_RESPONSE');
      if (isHold) {
        console.log('[telegram] Claire is holding — no voice response sent');
        return;
      }

      await addMessage(workspacePath, 'telegram', 'user', userMessage);
      await addMessage(workspacePath, 'telegram', 'assistant', result.text);

      if (isMemoryInitialized()) {
        storeExchange(userMessage, result.text, 'telegram').catch(err => {
          console.error('[telegram] Failed to store voice exchange in memory:', err);
        });
      }

      const voiceEnabled = await getVoiceResponsesEnabled(workspacePath);
      if (voiceEnabled && openaiClient) {
        await sendVoiceResponse(ctx, result.text, ownerId);
      } else {
        await sendLongMessage(ctx, result.text);
      }

      console.log(`[telegram] Responded to voice message (${result.text.length} chars)`);

    } catch (err) {
      console.error('[telegram] Error handling voice message:', err);
      await ctx.reply('Sorry, I encountered an error processing your voice message. Please try again.');
    }
  });

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const caption = ctx.message.caption || '';

    console.log(`[telegram] Received document: ${doc.file_name} (${doc.mime_type})`);
    channelRegistry.updateActivity('telegram');
    await ctx.replyWithChatAction('typing');

    try {
      const userMessage = caption
        ? `[Attached document: ${doc.file_name} (${doc.mime_type})]\n\n${caption}`
        : `[Attached document: ${doc.file_name} (${doc.mime_type})]\n\n(User shared this document without additional text. Acknowledge receipt and ask if they want to discuss it, or note that you cannot yet read document contents directly.)`;

      const result = await enqueueTurn(async () => {
        appendUserMessage(userMessage);
        return await chat(workspacePath);
      });

      await addMessage(workspacePath, 'telegram', 'user', userMessage);
      await addMessage(workspacePath, 'telegram', 'assistant', result.text);

      const showThinking = await getShowThinking(workspacePath);
      const fullResponse = showThinking && result.thinking
        ? `<thinking>\n${result.thinking}\n</thinking>\n\n${result.text}`
        : result.text;

      await sendLongMessage(ctx, fullResponse);
      console.log(`[telegram] Responded to document (${fullResponse.length} chars)`);

    } catch (err) {
      console.error('[telegram] Error handling document:', err);
      await ctx.reply('Sorry, I encountered an error processing that document. Please try again.');
    }
  });

  bot.on('message:photo', async (ctx) => {
    const caption = ctx.message.caption || '';
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    console.log(`[telegram] Received photo (${largest.width}x${largest.height})`);
    channelRegistry.updateActivity('telegram');
    await ctx.replyWithChatAction('typing');

    try {
      const file = await ctx.api.getFile(largest.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const imageRes = await fetch(fileUrl);

      if (!imageRes.ok) {
        throw new Error(`Failed to download photo: ${imageRes.status}`);
      }

      const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
      const mimeType: string =
        file.file_path?.endsWith('.png') ? 'image/png' : 'image/jpeg';

      const { entry, base64 } = await cacheImage(imageBuffer, mimeType, caption);

      const contentBlocks = [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64,
          },
        },
        {
          type: 'text' as const,
          text: `[Photo: ${entry.id}] ${caption || '(Photo shared without caption)'}`,
        },
      ];

      const result = await enqueueTurn(async () => {
        const msgIndex = appendUserContentBlocks(contentBlocks);
        try {
          const chatResult = await chat(workspacePath);
          replaceImageBlocks(
            msgIndex,
            `[Photo: ${entry.id} — ${caption || 'no caption'} (${largest.width}x${largest.height})]`
          );
          return chatResult;
        } catch (err) {
          rollbackLastUserMessage();
          throw err;
        }
      });

      updateImageSummary(entry.id, result.text.slice(0, 500)).catch(() => {});

      const logMessage = caption ? `[Photo: ${entry.id}] ${caption}` : `[Photo: ${entry.id}]`;
      await addMessage(workspacePath, 'telegram', 'user', logMessage);
      await addMessage(workspacePath, 'telegram', 'assistant', result.text);

      if (isMemoryInitialized()) {
        storeExchange(logMessage, result.text, 'telegram').catch(err => {
          console.error('[telegram] Failed to store photo exchange in memory:', err);
        });
      }

      const showThinking = await getShowThinking(workspacePath);
      const fullResponse = showThinking && result.thinking
        ? `<thinking>\n${result.thinking}\n</thinking>\n\n${result.text}`
        : result.text;

      await sendLongMessage(ctx, fullResponse);
      console.log(`[telegram] Responded to photo (${fullResponse.length} chars)`);

    } catch (err) {
      console.error('[telegram] Error handling photo:', err);
      await ctx.reply('Sorry, I encountered an error processing that photo. Please try again.');
    }
  });

  console.log('[telegram] Starting bot...');

  bot.start({
    onStart: (botInfo) => {
      console.log(`[telegram] Bot started: @${botInfo.username}`);
    },
  });

  return bot;
}

async function sendLongMessage(ctx: Context, text: string): Promise<void> {
  const MAX_LENGTH = 4000;

  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n\n', MAX_LENGTH);
    if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
    }
    if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(' ', MAX_LENGTH);
    }
    if (splitAt === -1) {
      splitAt = MAX_LENGTH;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

export async function sendToOwner(message: string): Promise<boolean> {
  if (!bot || !ownerChatId) {
    console.error('[telegram] Bot not initialized or owner ID not set');
    return false;
  }

  try {
    await bot.api.sendMessage(ownerChatId, message);
    console.log(`[telegram] Sent proactive message to owner`);
    return true;
  } catch (err) {
    console.error('[telegram] Failed to send to owner:', err);
    return false;
  }
}

export function getTelegramBot(): Bot | null {
  return bot;
}

export function stopTelegram(): void {
  if (bot) {
    bot.stop();
    bot = null;
    console.log('[telegram] Bot stopped');
  }
}

export function isTelegramRunning(): boolean {
  return bot !== null;
}
