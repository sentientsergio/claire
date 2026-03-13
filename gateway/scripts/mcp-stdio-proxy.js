#!/usr/bin/env node
/**
 * MCP stdio ↔ HTTP proxy for Claude Desktop
 *
 * Claude Desktop only supports stdio transport (subprocess). This script
 * bridges that requirement to the Claire HTTP MCP server running on port 18793.
 *
 * Claude Desktop launches this as a subprocess and communicates via stdin/stdout
 * using newline-delimited JSON-RPC. This proxy forwards each message to the
 * HTTP server and writes responses back to stdout.
 *
 * Configured in claude_desktop_config.json as:
 *   "command": "node",
 *   "args": ["/path/to/gateway/scripts/mcp-stdio-proxy.js"]
 */

const MCP_HTTP_URL = process.env.CLAIRE_MCP_URL || 'http://localhost:18793/mcp';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

async function forwardToHttp(jsonLine) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  const response = await fetch(MCP_HTTP_URL, {
    method: 'POST',
    headers,
    body: jsonLine,
  });

  if (response.status === 202) {
    // Notification acknowledged — no body expected
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const text = await response.text();

  // SSE format: find the data: line
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      return line.slice(5).trim();
    }
  }

  return null;
}

async function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // Not valid JSON, skip
  }

  const isNotification = msg.id === undefined;

  try {
    const result = await forwardToHttp(line);
    if (!isNotification && result) {
      process.stdout.write(result + '\n');
    }
  } catch (err) {
    process.stderr.write(`[claire-proxy] Error: ${err.message}\n`);
    if (!isNotification && msg.id !== undefined) {
      const errorResponse = JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message: `Claire proxy error: ${err.message}` },
      });
      process.stdout.write(errorResponse + '\n');
    }
  }
}

// Read newline-delimited JSON from stdin (MCP stdio protocol)
let buffer = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? ''; // Keep any incomplete trailing line

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      handleMessage(trimmed).catch((err) => {
        process.stderr.write(`[claire-proxy] Unhandled: ${err.message}\n`);
      });
    }
  }
});

process.stdin.on('end', () => process.exit(0));

process.stderr.write(`[claire-proxy] Started. Forwarding to ${MCP_HTTP_URL}\n`);
