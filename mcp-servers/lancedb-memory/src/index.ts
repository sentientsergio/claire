/**
 * Claire Memory MCP Server
 *
 * Lightweight MCP server exposing LanceDB semantic memory search.
 * Reads the existing memory.lance database from Claire's workspace.
 *
 * Tools:
 *   search_memory(query, limit?) — Vector search over conversation chunks
 *   store_memory(text, channel?) — Embed and store a new conversation chunk
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import { join } from 'path';

// --- Config ---

const WORKSPACE_PATH = process.env.CLAIRE_WORKSPACE
  || join(process.env.HOME || '/Users/sergio', 'sentientsergio/claire/workspace');
const DB_PATH = join(WORKSPACE_PATH, 'memory.lance');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Retrieval calibration (ported from gateway)
const SIMILARITY_THRESHOLD = 0.35;
const SCORE_GAP_THRESHOLD = 0.10;
const RECENCY_WEIGHT = 0.2;
const DECAY_RATE = 0.005;
const MIN_TOP_K = 2;
const MAX_TOP_K = 10;

// --- Clients ---

let openai: OpenAI | null = null;
let db: lancedb.Connection | null = null;
let chunksTable: lancedb.Table | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI();
  }
  return openai;
}

async function getTable(): Promise<lancedb.Table> {
  if (chunksTable) return chunksTable;

  db = await lancedb.connect(DB_PATH);
  const tables = await db.tableNames();

  if (tables.includes('chunks')) {
    chunksTable = await db.openTable('chunks');
  } else {
    throw new Error(`No chunks table found in ${DB_PATH}`);
  }

  return chunksTable;
}

// --- Embeddings ---

async function embedText(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- Retrieval ---

function computeRecency(lastAccessedAt: string): number {
  const hoursSince = (Date.now() - new Date(lastAccessedAt).getTime()) / (1000 * 60 * 60);
  return Math.pow(1 - DECAY_RATE, hoursSince);
}

function formatAge(timestamp: string): string {
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / (1000 * 60));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

interface ScoredResult {
  content: string;
  channel: string;
  tier: string;
  createdAt: string;
  combinedScore: number;
  id: string;
}

async function searchMemory(query: string, limit: number): Promise<ScoredResult[]> {
  const table = await getTable();
  const queryVector = await embedText(query);

  // Vector search — get extra results for filtering
  const results = await table.vectorSearch(queryVector).limit(limit * 3).toArray();

  // Score with cosine similarity + recency
  const scored: ScoredResult[] = results.map((row: Record<string, unknown>) => {
    const rawVector = row.vector;
    const resultVector: number[] = Array.isArray(rawVector)
      ? rawVector
      : Array.from(rawVector as Iterable<number>);

    const similarity = cosineSimilarity(queryVector, resultVector);
    const recency = computeRecency(row.lastAccessedAt as string);
    const combinedScore = (similarity * (1 - RECENCY_WEIGHT)) + (recency * RECENCY_WEIGHT);

    return {
      content: row.content as string,
      channel: row.channel as string,
      tier: row.tier as string,
      createdAt: row.createdAt as string,
      combinedScore,
      id: row.id as string,
    };
  });

  // Filter by threshold, sort by score
  const filtered = scored
    .filter(r => r.combinedScore >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.combinedScore - a.combinedScore);

  // Adaptive top-K: cut off at score gaps
  const output: ScoredResult[] = filtered.slice(0, MIN_TOP_K);
  for (let i = MIN_TOP_K; i < Math.min(filtered.length, MAX_TOP_K); i++) {
    const gap = filtered[i - 1].combinedScore - filtered[i].combinedScore;
    if (gap > SCORE_GAP_THRESHOLD) break;
    if (output.length >= limit && gap > SCORE_GAP_THRESHOLD / 2) break;
    output.push(filtered[i]);
  }

  // Touch retrieved chunks (update lastAccessedAt)
  if (output.length > 0) {
    try {
      const now = new Date().toISOString();
      for (const r of output) {
        await table.update({
          where: `id = '${r.id}'`,
          values: { lastAccessedAt: now },
        });
      }
    } catch {
      // Non-fatal
    }
  }

  return output;
}

// --- MCP Server ---

const server = new McpServer({
  name: 'claire-memory',
  version: '1.0.0',
});

server.tool(
  'search_memory',
  'Search Claire\'s conversation memory by semantic similarity. Returns relevant past exchanges ranked by relevance and recency.',
  {
    query: z.string().describe('What to search for — a topic, question, or phrase'),
    limit: z.number().optional().default(5).describe('Max results to return (default 5)'),
  },
  async ({ query, limit }) => {
    try {
      const results = await searchMemory(query, limit ?? 5);

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No relevant memories found.' }],
        };
      }

      const formatted = results.map((r, i) => {
        const age = formatAge(r.createdAt);
        const channelNote = r.channel ? ` [${r.channel}]` : '';
        const score = (r.combinedScore * 100).toFixed(0);
        return `### ${i + 1}. ${age}${channelNote} (${score}% match)\n${r.content}`;
      }).join('\n\n');

      return {
        content: [{ type: 'text' as const, text: formatted }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Memory search failed: ${error}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'store_memory',
  'Store a conversation exchange or important text in Claire\'s long-term memory for later semantic search.',
  {
    text: z.string().describe('The text to store — a conversation exchange, insight, or important information'),
    channel: z.string().optional().default('unknown').describe('Source channel (telegram, discord, terminal)'),
  },
  async ({ text, channel }) => {
    try {
      const table = await getTable();
      const vector = await embedText(text);
      const now = new Date().toISOString();
      const id = `warm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await table.add([{
        id,
        content: text,
        channel: channel ?? 'unknown',
        tier: 'warm',
        createdAt: now,
        lastAccessedAt: now,
        turnCount: 1,
        vector,
      }]);

      return {
        content: [{ type: 'text' as const, text: `Stored memory chunk ${id} (${text.length} chars)` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Failed to store memory: ${error}` }],
        isError: true,
      };
    }
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
