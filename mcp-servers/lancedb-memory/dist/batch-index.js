/**
 * Batch Index — ingest daily memory files and transcripts into LanceDB
 *
 * Reads workspace/memory/YYYY-MM-DD.md and workspace/transcript/recent.md,
 * chunks them into conversation-sized segments, embeds, and stores in LanceDB.
 *
 * Tracks last indexed state in workspace/.memory-index-state.json to avoid
 * re-indexing already-processed content.
 *
 * Usage: node dist/batch-index.js [--force]
 */
import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import { join } from 'path';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
// --- Config ---
const WORKSPACE_PATH = process.env.CLAIRE_WORKSPACE
    || join(process.env.HOME || '/Users/sergio', 'sentientsergio/claire/workspace');
const DB_PATH = join(WORKSPACE_PATH, 'memory.lance');
const STATE_FILE = join(WORKSPACE_PATH, '.memory-index-state.json');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_TARGET_CHARS = 1500; // ~3-5 conversation turns
const CHUNK_MAX_CHARS = 3000;
// --- Clients ---
const openai = new OpenAI();
async function embedText(text) {
    const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
    });
    return response.data[0].embedding;
}
function loadState() {
    if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
    return { lastIndexedFiles: [], lastTranscriptHash: '', lastRunAt: '' };
}
function saveState(state) {
    state.lastRunAt = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash.toString(36);
}
function chunkDailyMemory(filename, content) {
    // Extract date from filename (YYYY-MM-DD.md)
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
    // Split by ## headers (sections in daily memory files)
    const sections = content.split(/^## /m).filter(s => s.trim());
    const chunks = [];
    let buffer = '';
    for (const section of sections) {
        const sectionText = `## ${section}`.trim();
        if (buffer.length + sectionText.length > CHUNK_MAX_CHARS && buffer.length > 0) {
            chunks.push({
                content: buffer.trim(),
                channel: 'daily-memory',
                createdAt: `${date}T12:00:00.000Z`,
            });
            buffer = '';
        }
        buffer += (buffer ? '\n\n' : '') + sectionText;
        if (buffer.length >= CHUNK_TARGET_CHARS) {
            chunks.push({
                content: buffer.trim(),
                channel: 'daily-memory',
                createdAt: `${date}T12:00:00.000Z`,
            });
            buffer = '';
        }
    }
    if (buffer.trim()) {
        chunks.push({
            content: buffer.trim(),
            channel: 'daily-memory',
            createdAt: `${date}T12:00:00.000Z`,
        });
    }
    return chunks;
}
function chunkTranscript(content) {
    // Split by session boundaries
    const sessions = content.split(/^## Session /m).filter(s => s.trim());
    const chunks = [];
    for (const session of sessions) {
        // Extract conversation lines
        const lines = session.split('\n').filter(l => l.startsWith('['));
        if (lines.length === 0)
            continue;
        // Extract timestamp from first line
        const tsMatch = lines[0].match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
        const createdAt = tsMatch ? tsMatch[1] : new Date().toISOString();
        // Detect channel from first line
        const channelMatch = lines[0].match(/\((\w+)\)/);
        const channel = channelMatch ? channelMatch[1] : 'unknown';
        // Group lines into chunks
        let buffer = '';
        for (const line of lines) {
            if (buffer.length + line.length > CHUNK_MAX_CHARS && buffer.length > 0) {
                chunks.push({ content: buffer.trim(), channel, createdAt });
                buffer = '';
            }
            buffer += (buffer ? '\n' : '') + line;
        }
        if (buffer.trim().length > 50) { // Skip trivially small chunks
            chunks.push({ content: buffer.trim(), channel, createdAt });
        }
    }
    return chunks;
}
// --- Main ---
async function main() {
    const force = process.argv.includes('--force');
    const state = loadState();
    console.log(`[batch-index] Connecting to ${DB_PATH}`);
    const db = await lancedb.connect(DB_PATH);
    const tables = await db.tableNames();
    let table;
    if (tables.includes('chunks')) {
        table = await db.openTable('chunks');
    }
    else {
        throw new Error('No chunks table found — run the MCP server first to initialize');
    }
    const initialCount = await table.countRows();
    console.log(`[batch-index] Current chunks: ${initialCount}`);
    let newChunks = [];
    // 1. Index daily memory files
    const memoryDir = join(WORKSPACE_PATH, 'memory');
    if (existsSync(memoryDir)) {
        const files = readdirSync(memoryDir)
            .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
            .sort();
        for (const file of files) {
            if (!force && state.lastIndexedFiles.includes(file))
                continue;
            const content = readFileSync(join(memoryDir, file), 'utf-8');
            if (content.trim().length < 50)
                continue;
            const fileChunks = chunkDailyMemory(file, content);
            newChunks.push(...fileChunks);
            state.lastIndexedFiles.push(file);
            console.log(`[batch-index] Chunked ${file}: ${fileChunks.length} chunks`);
        }
    }
    // 2. Index transcript (only new content)
    const transcriptPath = join(WORKSPACE_PATH, 'transcript/recent.md');
    if (existsSync(transcriptPath)) {
        const content = readFileSync(transcriptPath, 'utf-8');
        const hash = simpleHash(content);
        if (force || hash !== state.lastTranscriptHash) {
            const transcriptChunks = chunkTranscript(content);
            newChunks.push(...transcriptChunks);
            state.lastTranscriptHash = hash;
            console.log(`[batch-index] Chunked transcript: ${transcriptChunks.length} chunks`);
        }
        else {
            console.log(`[batch-index] Transcript unchanged, skipping`);
        }
    }
    // 3. Embed and store
    if (newChunks.length === 0) {
        console.log(`[batch-index] Nothing new to index`);
        saveState(state);
        return;
    }
    console.log(`[batch-index] Embedding ${newChunks.length} chunks...`);
    // Batch embed in groups of 20 to avoid rate limits
    const BATCH_SIZE = 20;
    let stored = 0;
    for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
        const batch = newChunks.slice(i, i + BATCH_SIZE);
        const texts = batch.map(c => c.content);
        const embeddingResponse = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: texts,
        });
        const rows = batch.map((chunk, j) => ({
            id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            content: chunk.content,
            channel: chunk.channel,
            tier: 'warm',
            createdAt: chunk.createdAt,
            lastAccessedAt: new Date().toISOString(),
            turnCount: 1,
            vector: embeddingResponse.data[j].embedding,
        }));
        await table.add(rows);
        stored += rows.length;
        console.log(`[batch-index] Stored ${stored}/${newChunks.length}`);
    }
    const finalCount = await table.countRows();
    console.log(`[batch-index] Done. ${initialCount} → ${finalCount} chunks (+${finalCount - initialCount})`);
    saveState(state);
}
main().catch(err => {
    console.error('[batch-index] Fatal:', err);
    process.exit(1);
});
