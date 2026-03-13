/**
 * MCP Server — Channel Sense
 *
 * The gateway's sole external interface. All surfaces (Telegram bridge,
 * web voice, Claude voice mode, future platforms) connect as MCP clients.
 * Nothing is privileged. MCP is the only door.
 *
 * Exposed tools:
 *   - converse(message, channel)            — route a message through Claire
 *   - converse_with_media(...)              — route with image attachment
 *   - read_workspace(path)                  — read a workspace file
 *   - write_workspace(path, content)        — write a workspace file
 *   - list_workspace(dir)                   — list a workspace directory
 *   - get_status()                          — read status.json
 *
 * Transport: Streamable HTTP (works locally and over Tailscale)
 * Auth: Bearer token (simple for N=1)
 *
 * The MCP server runs in-process with the gateway — no IPC needed.
 * It shares direct access to conversation state, tools, and workspace.
 */

import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readFile, writeFile, readdir, mkdir, stat } from 'fs/promises';
import { join, resolve, relative, sep } from 'path';
import {
  appendUserMessage,
  appendUserContentBlocks,
  replaceImageBlocks,
  rollbackLastUserMessage,
  enqueueTurn,
  persistState,
} from './conversation-state.js';
import { chat } from './claude.js';
import { addMessage } from './conversation.js';
import { cacheImage, updateImageSummary } from './tools/image-cache.js';
import { storeExchange, isInitialized as isMemoryInitialized } from './memory/index.js';
import { channelRegistry } from './channel-registry.js';

const MCP_PATH = '/mcp';
const SERVER_VERSION = '1.0.0';

let workspacePath: string = '';
let authToken: string = '';
let mcpHttpServer: http.Server | null = null;

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!authToken) return true; // No token configured = open (local dev)
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return token === authToken;
}

// ─── Tool: converse ───────────────────────────────────────────────────────────

async function handleConverse(message: string, channel: string): Promise<string> {
  channelRegistry.updateActivity(channel);

  const result = await enqueueTurn(async () => {
    appendUserMessage(message);
    try {
      const chatResult = await chat(workspacePath);
      await persistState();
      return chatResult;
    } catch (err) {
      rollbackLastUserMessage();
      throw err;
    }
  });

  const isHold =
    result.text.trim() === 'NO_RESPONSE' || result.text.includes('NO_RESPONSE');
  if (isHold) {
    console.log(`[mcp-server] converse (${channel}): Claire is holding`);
    return '';
  }

  await addMessage(workspacePath, channel, 'user', message);
  await addMessage(workspacePath, channel, 'assistant', result.text);

  if (isMemoryInitialized()) {
    storeExchange(message, result.text, channel).catch(err => {
      console.error('[mcp-server] Failed to store exchange in memory:', err);
    });
  }

  console.log(`[mcp-server] converse (${channel}): ${result.text.length} chars`);
  return result.text;
}

// ─── Tool: converse_with_media ────────────────────────────────────────────────

async function handleConverseWithMedia(
  message: string,
  mediaBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
  channel: string
): Promise<string> {
  channelRegistry.updateActivity(channel);

  const imageBuffer = Buffer.from(mediaBase64, 'base64');
  const { entry, base64 } = await cacheImage(imageBuffer, mediaType, message);

  const contentBlocks = [
    {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: mediaType,
        data: base64,
      },
    },
    {
      type: 'text' as const,
      text: `[Photo: ${entry.id}] ${message || '(Media shared without caption)'}`,
    },
  ];

  const result = await enqueueTurn(async () => {
    const msgIndex = appendUserContentBlocks(contentBlocks);
    try {
      const chatResult = await chat(workspacePath);
      replaceImageBlocks(
        msgIndex,
        `[Photo: ${entry.id} — ${message || 'no caption'}]`
      );
      await persistState();
      return chatResult;
    } catch (err) {
      rollbackLastUserMessage();
      throw err;
    }
  });

  updateImageSummary(entry.id, result.text.slice(0, 500)).catch(() => {});

  const logMessage = message ? `[Photo: ${entry.id}] ${message}` : `[Photo: ${entry.id}]`;
  await addMessage(workspacePath, channel, 'user', logMessage);
  await addMessage(workspacePath, channel, 'assistant', result.text);

  if (isMemoryInitialized()) {
    storeExchange(logMessage, result.text, channel).catch(err => {
      console.error('[mcp-server] Failed to store media exchange in memory:', err);
    });
  }

  console.log(`[mcp-server] converse_with_media (${channel}): ${result.text.length} chars`);
  return result.text;
}

// ─── Tool: workspace helpers ──────────────────────────────────────────────────

function safeWorkspacePath(relativePath: string): string {
  const abs = resolve(join(workspacePath, relativePath));
  const wsAbs = resolve(workspacePath);
  // Prevent path traversal outside workspace
  if (!abs.startsWith(wsAbs + sep) && abs !== wsAbs) {
    throw new Error(`Path traversal not allowed: ${relativePath}`);
  }
  return abs;
}

async function handleReadWorkspace(path: string): Promise<string> {
  const abs = safeWorkspacePath(path);
  return await readFile(abs, 'utf-8');
}

async function handleWriteWorkspace(path: string, content: string): Promise<string> {
  const abs = safeWorkspacePath(path);
  await mkdir(resolve(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf-8');
  return `Written: ${path}`;
}

async function handleListWorkspace(dir: string): Promise<string> {
  const abs = safeWorkspacePath(dir);
  const entries = await readdir(abs, { withFileTypes: true });
  const lines = entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
  return lines.join('\n');
}

async function handleGetStatus(): Promise<string> {
  const abs = safeWorkspacePath('status.json');
  return await readFile(abs, 'utf-8');
}

// ─── MCP Server Setup ─────────────────────────────────────────────────────────

const SURFACE_INSTRUCTIONS = `You are a thin surface layer for Claire's runtime. Your only role is to pass input through and render output faithfully.

When the user sends a message:
1. Call the converse tool with the user's exact message and channel "claude-desktop"
2. Display Claire's response exactly as returned — no paraphrasing, no "Claire says:", no summarizing, no third-person narration
3. If converse returns an empty string, say nothing (Claire is holding — this is intentional)

Do not add your own framing. Do not describe what you're doing ("Seeking clarification from Claire..."). Just call the tool and render the result verbatim.

If asked who you are: "I'm running on Claude Desktop but the thinking is Claire's — a separate runtime on Sergio's Mac."`;

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'claire-channel-sense',
    version: SERVER_VERSION,
  });

  // Prompt: surface instructions (shows as slash command in Claude Desktop)
  server.prompt(
    'claire-surface',
    'Load Claire surface instructions — turns this conversation into a transparent relay to Claire\'s runtime.',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: SURFACE_INSTRUCTIONS,
          },
        },
      ],
    })
  );

  // Tool: converse
  server.tool(
    'converse',
    'Send a message to Claire and receive her response. Routes through the full unified loop — same mind, same context, same tools.',
    {
      message: z.string().describe('The message to send to Claire'),
      channel: z
        .string()
        .describe(
          'Self-identified channel name (e.g., "telegram", "web-voice", "claude-voice"). Used for cross-channel continuity logging.'
        ),
    },
    async ({ message, channel }) => {
      try {
        const response = await handleConverse(message, channel);
        return {
          content: [{ type: 'text', text: response }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: converse_with_media
  server.tool(
    'converse_with_media',
    'Send a message with an image attachment to Claire. Handles the image cache lifecycle — Claire sees the image during the turn, then it becomes a text reference.',
    {
      message: z
        .string()
        .describe('Caption or message accompanying the media (may be empty)'),
      media_base64: z.string().describe('Base64-encoded image data'),
      media_type: z
        .enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
        .describe('MIME type of the image'),
      channel: z
        .string()
        .describe('Self-identified channel name for cross-channel continuity'),
    },
    async ({ message, media_base64, media_type, channel }) => {
      try {
        const response = await handleConverseWithMedia(
          message,
          media_base64,
          media_type,
          channel
        );
        return {
          content: [{ type: 'text', text: response }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: read_workspace
  server.tool(
    'read_workspace',
    "Read a file from Claire's workspace. Use this to load identity files, memory, or conversation logs.",
    {
      path: z
        .string()
        .describe(
          'Relative path within the workspace (e.g., "SOUL.md", "memory/2026-03-12.md")'
        ),
    },
    async ({ path }) => {
      try {
        const content = await handleReadWorkspace(path);
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error reading ${path}: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: write_workspace
  server.tool(
    'write_workspace',
    "Write a file to Claire's workspace. Use this to log conversations or update identity files.",
    {
      path: z
        .string()
        .describe('Relative path within the workspace to write'),
      content: z.string().describe('File content to write'),
    },
    async ({ path, content }) => {
      try {
        const result = await handleWriteWorkspace(path, content);
        return { content: [{ type: 'text', text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error writing ${path}: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_workspace
  server.tool(
    'list_workspace',
    "List the contents of a workspace directory.",
    {
      dir: z
        .string()
        .default('')
        .describe('Relative directory path within the workspace (empty = root)'),
    },
    async ({ dir }) => {
      try {
        const listing = await handleListWorkspace(dir || '');
        return { content: [{ type: 'text', text: listing }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing ${dir}: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_status
  server.tool(
    'get_status',
    "Read Claire's status.json — habits tracking, preferences, and always-on state. Use for surfaces that want awareness of Claire's current state.",
    {},
    async () => {
      try {
        const content = await handleGetStatus();
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error reading status: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

/**
 * Parse the raw body of an IncomingMessage into a string.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export async function startMcpServer(
  port: number,
  wsPath: string,
  token: string
): Promise<http.Server> {
  workspacePath = resolve(wsPath);
  authToken = token;

  // Stateless mode: each request gets a fresh McpServer + transport pair.
  // The McpServer instance cannot be reused across connections — the SDK
  // enforces one transport per server instance. Tool handlers capture
  // workspacePath/channelRegistry from module scope, so state is shared.
  mcpHttpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: SERVER_VERSION }));
      return;
    }

    // MCP endpoint
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // Auth check
    if (!isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Parse body for POST requests
    let parsedBody: unknown;
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        parsedBody = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
    }

    // Fresh server + transport per request (required for stateless mode)
    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      console.error('[mcp-server] Request handling error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    } finally {
      // Clean up connection after request completes
      await mcpServer.close().catch(() => {});
    }
  });

  return new Promise((resolve, reject) => {
    mcpHttpServer!.listen(port, () => {
      console.log(`[mcp-server] Listening on port ${port} (path: ${MCP_PATH})`);
      console.log(`[mcp-server] Auth: ${authToken ? 'enabled' : 'disabled (no token)'}`);
      resolve(mcpHttpServer!);
    });
    mcpHttpServer!.on('error', reject);
  });
}

export function stopMcpServer(): void {
  if (mcpHttpServer) {
    mcpHttpServer.close();
    mcpHttpServer = null;
    console.log('[mcp-server] Stopped');
  }
}
