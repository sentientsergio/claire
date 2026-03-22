/**
 * Gateway entry point — v2
 *
 * Starts the WebSocket server, Telegram bot, heartbeat scheduler,
 * and initializes the unified conversation state.
 *
 * Environment:
 *   NODE_ENV=development  → loads .env.dev (Claire.dev)
 *   NODE_ENV=production   → loads .env.prod (Claire.prod)
 *   (unset)               → loads .env (legacy, defaults to prod-like)
 */

import { NODE_ENV, ENV_LABEL } from './env.js';

import { createServer } from './server.js';
import { startHeartbeat } from './heartbeat.js';
import { startTelegram, stopTelegram } from './channels/telegram.js';
import { startDiscord, stopDiscord } from './channels/discord.js';
import { initScheduledHeartbeats } from './scheduled-heartbeats.js';
import { startWebhookServer, registerDefaultHandler } from './webhook.js';
import { initMemoryStore, initFactsStore } from './memory/index.js';
import { initConversationState, getMessageCount, pruneMessages, persistState } from './conversation-state.js';
import { startHealthMonitoring } from './health.js';
import { initImageCache } from './tools/image-cache.js';
import { startMcpServer, stopMcpServer } from './mcp-server.js';
import { resolve } from 'path';

const PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const MCP_PORT = parseInt(process.env.MCP_PORT || '18793', 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';
const MCP_PUBLIC_URL = process.env.MCP_PUBLIC_URL || '';
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || '';
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || '';
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_WORKSHOP_CHANNEL_ID = process.env.DISCORD_WORKSHOP_CHANNEL_ID;

async function main() {
  console.log(`Starting claire gateway [${ENV_LABEL}] — v2 architecture`);
  console.log(`  Environment: ${NODE_ENV}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Workspace: ${WORKSPACE_PATH}`);

  // Initialize unified conversation state (reload from disk)
  try {
    await initConversationState(resolve(WORKSPACE_PATH));
    const msgCount = getMessageCount();
    console.log(`  Conversation state: initialized (${msgCount} messages)`);

    // Prune HOT tier on startup if it exceeds the rolling window.
    // Older messages are already in daily files (WARM) and LanceDB (COLD).
    const STARTUP_PRUNE_THRESHOLD = 200;
    if (msgCount > STARTUP_PRUNE_THRESHOLD) {
      const removed = pruneMessages(STARTUP_PRUNE_THRESHOLD);
      await persistState();
      console.log(`  Conversation state: pruned ${removed} stale messages on startup, retained last ${STARTUP_PRUNE_THRESHOLD}`);
    }
  } catch (err) {
    console.error('  Conversation state: failed to initialize', err);
  }

  // Initialize image cache
  initImageCache(resolve(WORKSPACE_PATH));
  console.log('  Image cache: initialized');

  // Initialize memory store (vector chunks — write pipeline only)
  try {
    await initMemoryStore(WORKSPACE_PATH);
    console.log('  Memory: initialized');
  } catch (err) {
    console.error('  Memory: failed to initialize', err);
  }

  // Initialize facts store (search_memory reads from this)
  try {
    await initFactsStore(WORKSPACE_PATH);
    console.log('  Facts: initialized');
  } catch (err) {
    console.error('  Facts: failed to initialize', err);
  }

  // Start WebSocket server
  const server = createServer(PORT, WORKSPACE_PATH);

  // Start MCP server (Channel Sense — the sole external interface)
  try {
    await startMcpServer(
      MCP_PORT,
      WORKSPACE_PATH,
      MCP_AUTH_TOKEN,
      MCP_PUBLIC_URL || undefined,
      OAUTH_CLIENT_ID || undefined,
      OAUTH_CLIENT_SECRET || undefined,
    );
    console.log(`  MCP server: enabled (port: ${MCP_PORT})${MCP_PUBLIC_URL ? ` public: ${MCP_PUBLIC_URL}` : ''}`);
  } catch (err) {
    console.error('  MCP server: failed to start', err);
  }

  // Start webhook HTTP server
  startWebhookServer();
  registerDefaultHandler();

  // Start Telegram bot if configured (private 1:1 only — workshop is on Discord)
  if (TELEGRAM_TOKEN && TELEGRAM_OWNER_ID) {
    console.log(`  Telegram: enabled (owner: ${TELEGRAM_OWNER_ID})`);
    await startTelegram({
      token: TELEGRAM_TOKEN,
      ownerId: parseInt(TELEGRAM_OWNER_ID, 10),
      workspacePath: WORKSPACE_PATH,
    });
  } else {
    console.log('  Telegram: disabled (no token or owner ID)');
  }

  // Start Discord bot if configured (workshop channel — three-way with Claude Code)
  if (DISCORD_BOT_TOKEN && DISCORD_WORKSHOP_CHANNEL_ID) {
    console.log(`  Discord: enabled (workshop channel: ${DISCORD_WORKSHOP_CHANNEL_ID})`);
    await startDiscord({
      token: DISCORD_BOT_TOKEN,
      workshopChannelId: DISCORD_WORKSHOP_CHANNEL_ID,
      workspacePath: WORKSPACE_PATH,
    });
  } else {
    console.log('  Discord: disabled (no token or channel ID)');
  }

  // Initialize scheduled heartbeats (one-off and recurring)
  await initScheduledHeartbeats(WORKSPACE_PATH);

  // Start heartbeat scheduler (regular cadence)
  startHeartbeat(WORKSPACE_PATH);

  // Validate credentials and start periodic health monitoring
  await startHealthMonitoring();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopTelegram();
    stopDiscord();
    stopMcpServer();
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopTelegram();
    stopDiscord();
    stopMcpServer();
    server.close();
    process.exit(0);
  });

  console.log('Gateway running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
