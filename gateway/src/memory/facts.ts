/**
 * Fact Extraction Module
 * 
 * Uses Haiku to extract structured facts from conversation exchanges.
 * Facts represent stable information (preferences, decisions, info about user).
 */

import Anthropic from '@anthropic-ai/sdk';
import * as lancedb from '@lancedb/lancedb';
import { embedText, EMBEDDING_DIMENSIONS } from './embeddings.js';
import { join } from 'path';

const HAIKU_MODEL = 'claude-haiku-4-5';

// Lazy client initialization
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// Fact categories
export type FactCategory = 
  | 'preference'    // User likes/dislikes
  | 'personal_info' // Facts about user (name, location, etc.)
  | 'decision'      // Decisions made
  | 'commitment'    // Things user/assistant committed to
  | 'contact'       // Info about people user knows
  | 'project'       // Info about user's projects/work
  | 'other';

// Fact operations
export type FactOperation = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';

// Fact structure
export interface Fact {
  id: string;
  content: string;           // The fact itself
  category: FactCategory;
  confidence: number;        // 0-1, how confident we are
  sourceChunkId: string;     // Which conversation chunk this came from
  createdAt: string;
  lastValidatedAt: string;
  vector: number[];          // For semantic similarity matching
  [key: string]: unknown;    // Index signature for LanceDB
}

// Extracted fact candidate from Haiku
interface FactCandidate {
  content: string;
  category: FactCategory;
  confidence: number;
  operation: FactOperation;
  targetFactId?: string;     // For UPDATE/DELETE, which fact to modify
}

// Database references
let db: lancedb.Connection | null = null;
let factsTable: lancedb.Table | null = null;

/**
 * Initialize the facts table
 */
export async function initFactsStore(workspacePath: string): Promise<void> {
  const dbPath = join(workspacePath, 'memory.lance');
  
  if (!db) {
    db = await lancedb.connect(dbPath);
  }
  
  const tables = await db.tableNames();
  
  if (tables.includes('facts')) {
    factsTable = await db.openTable('facts');
    const count = await factsTable.countRows();
    console.log(`[facts] Opened existing facts table (${count} rows)`);
  } else {
    // Create with initial row to establish schema
    const initialFact: Fact = {
      id: '__init__',
      content: '',
      category: 'other',
      confidence: 0,
      sourceChunkId: '',
      createdAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      vector: new Array(EMBEDDING_DIMENSIONS).fill(0),
    };
    
    factsTable = await db.createTable('facts', [initialFact]);
    await factsTable.delete('id = "__init__"');
    console.log('[facts] Created new facts table');
  }
}

/**
 * Extract facts from a conversation exchange using Haiku
 */
export async function extractFacts(
  userMessage: string,
  assistantResponse: string,
  sourceChunkId: string
): Promise<FactCandidate[]> {
  // Fetch only semantically relevant facts rather than all facts.
  // Sending the full facts table on every call was the primary Haiku cost driver.
  const queryText = `${userMessage} ${assistantResponse}`.slice(0, 500);
  const relevantFacts = isFactsInitialized() ? await findSimilarFacts(queryText, 20) : [];
  const existingFactsContext = relevantFacts.length > 0
    ? `\nExisting known facts (most relevant to this exchange):\n${relevantFacts.map(f => `- [${f.id}] ${f.content}`).join('\n')}`
    : '\nNo existing facts yet.';

  const prompt = `Analyze this conversation exchange and extract any facts worth remembering.

Exchange:
User: ${userMessage}
Assistant: ${assistantResponse}
${existingFactsContext}

Extract facts that are:
- Preferences (likes, dislikes, favorites)
- Personal info (name, location, schedule patterns)
- Decisions made
- Commitments (things to do, promises)
- Info about contacts/people
- Project/work related info

For each fact, determine:
- operation: ADD (new fact), UPDATE (modifies existing fact), DELETE (contradicts existing fact), or NOOP (already known, no change)
- If UPDATE or DELETE, specify which existing fact ID it affects

Respond in JSON format:
{
  "facts": [
    {
      "content": "the fact as a clear statement",
      "category": "preference|personal_info|decision|commitment|contact|project|other",
      "confidence": 0.0-1.0,
      "operation": "ADD|UPDATE|DELETE|NOOP",
      "targetFactId": "only if UPDATE or DELETE"
    }
  ]
}

If no facts worth extracting, return: {"facts": []}
Only extract genuinely useful, stable facts. Skip transient conversation details.`;

  try {
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    
    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[facts] No JSON in Haiku response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const facts: FactCandidate[] = parsed.facts || [];
    
    console.log(`[facts] Haiku extracted ${facts.length} fact candidates`);
    return facts;
    
  } catch (err) {
    console.error('[facts] Fact extraction failed:', err);
    return [];
  }
}

/**
 * Apply fact operations to the store
 */
export async function applyFactOperations(
  candidates: FactCandidate[],
  sourceChunkId: string
): Promise<{ added: number; updated: number; deleted: number }> {
  if (!factsTable) {
    throw new Error('Facts store not initialized');
  }

  const stats = { added: 0, updated: 0, deleted: 0 };
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    try {
      switch (candidate.operation) {
        case 'ADD': {
          const id = `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const vector = await embedText(candidate.content);
          
          const fact: Fact = {
            id,
            content: candidate.content,
            category: candidate.category,
            confidence: candidate.confidence,
            sourceChunkId,
            createdAt: now,
            lastValidatedAt: now,
            vector,
          };
          
          await factsTable.add([fact]);
          console.log(`[facts] Added: ${candidate.content.slice(0, 50)}...`);
          stats.added++;
          break;
        }
        
        case 'UPDATE': {
          if (!candidate.targetFactId) break;
          
          const vector = await embedText(candidate.content);
          await factsTable.update({
            where: `id = '${candidate.targetFactId}'`,
            values: {
              content: candidate.content,
              confidence: candidate.confidence,
              lastValidatedAt: now,
              vector,
            },
          });
          console.log(`[facts] Updated ${candidate.targetFactId}: ${candidate.content.slice(0, 50)}...`);
          stats.updated++;
          break;
        }
        
        case 'DELETE': {
          if (!candidate.targetFactId) break;
          
          await factsTable.delete(`id = '${candidate.targetFactId}'`);
          console.log(`[facts] Deleted ${candidate.targetFactId}`);
          stats.deleted++;
          break;
        }
        
        case 'NOOP': {
          // Optionally update lastValidatedAt to show fact was confirmed
          if (candidate.targetFactId) {
            await factsTable.update({
              where: `id = '${candidate.targetFactId}'`,
              values: { lastValidatedAt: now },
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[facts] Failed to apply operation ${candidate.operation}:`, err);
    }
  }

  return stats;
}

/**
 * Get all facts from the store
 */
export async function getAllFacts(): Promise<Fact[]> {
  if (!factsTable) return [];
  
  const rows = await factsTable.query().toArray();
  return rows.map(row => ({
    id: row.id as string,
    content: row.content as string,
    category: row.category as FactCategory,
    confidence: row.confidence as number,
    sourceChunkId: row.sourceChunkId as string,
    createdAt: row.createdAt as string,
    lastValidatedAt: row.lastValidatedAt as string,
    vector: row.vector as number[],
  }));
}

/**
 * Search for similar facts (for deduplication)
 */
export async function findSimilarFacts(
  content: string,
  limit: number = 3
): Promise<Fact[]> {
  if (!factsTable) return [];
  
  const vector = await embedText(content);
  const results = await factsTable.vectorSearch(vector).limit(limit).toArray();
  
  return results.map(row => ({
    id: row.id as string,
    content: row.content as string,
    category: row.category as FactCategory,
    confidence: row.confidence as number,
    sourceChunkId: row.sourceChunkId as string,
    createdAt: row.createdAt as string,
    lastValidatedAt: row.lastValidatedAt as string,
    vector: row.vector as number[],
  }));
}

/**
 * Format facts for inclusion in system prompt
 */
export function formatFactsForPrompt(facts: Fact[]): string {
  if (facts.length === 0) return '';
  
  const lines = ['## Known Facts About User\n'];
  
  // Group by category
  const byCategory = new Map<FactCategory, Fact[]>();
  for (const fact of facts) {
    const existing = byCategory.get(fact.category) || [];
    existing.push(fact);
    byCategory.set(fact.category, existing);
  }
  
  const categoryLabels: Record<FactCategory, string> = {
    preference: 'Preferences',
    personal_info: 'Personal Info',
    decision: 'Decisions',
    commitment: 'Commitments',
    contact: 'Contacts',
    project: 'Projects/Work',
    other: 'Other',
  };
  
  for (const [category, categoryFacts] of byCategory) {
    lines.push(`**${categoryLabels[category]}:**`);
    for (const fact of categoryFacts) {
      lines.push(`- ${fact.content}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Process an exchange: extract and apply facts
 * Call this after storing a conversation exchange
 */
export async function processExchangeForFacts(
  userMessage: string,
  assistantResponse: string,
  sourceChunkId: string
): Promise<void> {
  try {
    const candidates = await extractFacts(userMessage, assistantResponse, sourceChunkId);
    
    if (candidates.length > 0) {
      const stats = await applyFactOperations(candidates, sourceChunkId);
      console.log(`[facts] Applied: +${stats.added} ~${stats.updated} -${stats.deleted}`);
    }
  } catch (err) {
    console.error('[facts] processExchangeForFacts failed:', err);
    // Non-fatal - don't break the conversation flow
  }
}

/**
 * Check if facts store is initialized
 */
export function isFactsInitialized(): boolean {
  return factsTable !== null;
}
