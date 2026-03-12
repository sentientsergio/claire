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
import { initScheduledHeartbeats } from './scheduled-heartbeats.js';
import { startWebhookServer, registerDefaultHandler } from './webhook.js';
import { initMemoryStore, initFactsStore } from './memory/index.js';
import { initConversationState } from './conversation-state.js';
import { startHealthMonitoring } from './health.js';
import { initImageCache } from './tools/image-cache.js';
import { resolve } from 'path';

const PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

async function main() {
  console.log(`Starting assistant-bot gateway [${ENV_LABEL}] — v2 architecture`);
  console.log(`  Environment: ${NODE_ENV}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Workspace: ${WORKSPACE_PATH}`);

  // Initialize unified conversation state (reload from disk)
  try {
    await initConversationState(resolve(WORKSPACE_PATH));
    console.log('  Conversation state: initialized');
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

  // Start webhook HTTP server
  startWebhookServer();
  registerDefaultHandler();

  // Start Telegram bot if configured
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
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopTelegram();
    server.close();
    process.exit(0);
  });

  console.log('Gateway running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
