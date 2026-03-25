/**
 * self_develop — Claire's self-development tool
 *
 * Hands tasks to a Claude Code CLI session. Maintains a persistent session
 * across calls by saving the session ID to .claude-session.json after each run.
 *
 * Flow:
 *   1. Check .claude-session.json for a saved session ID
 *   2. If found: claude -p "<task>" --resume <id> --output-format json
 *   3. If not found (first use) or resume fails (stale): claude -p "<task>" fresh
 *   4. Save the returned session_id back to .claude-session.json
 *
 * This means self_develop builds up its own persistent session context over time.
 * The interactive `claude` terminal Sergio uses is a separate session — both
 * have CLAUDE.md context but they are independent.
 */

import { execFile } from 'child_process';
import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAIRE_REPO_ROOT = resolve(__dirname, '../../..');
const SESSION_FILE = join(CLAIRE_REPO_ROOT, '.claude-session.json');
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/sergio/.local/bin/claude';

const DEFAULT_MAX_TURNS = 25;
const DEFAULT_MAX_BUDGET_USD = 3;
const EXEC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── Mutex ────────────────────────────────────────────────────────────────────
let running = false;

// ─── Audit log ────────────────────────────────────────────────────────────────
let auditLogDir = '';

export function initSelfDevelopAuditLog(workspacePath: string): void {
  auditLogDir = join(resolve(workspacePath), 'cost');
}

interface AuditEntry {
  ts: string;
  task: string;
  sessionId: string | null;
  maxTurns: number;
  maxBudget: number;
  durationMs: number;
  resultTurns?: number;
  resultCost?: number;
  status: 'completed' | 'failed';
  error?: string;
}

async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  if (!auditLogDir) return;
  const logPath = join(auditLogDir, 'self-develop-log.json');
  try {
    await mkdir(auditLogDir, { recursive: true });
    let entries: AuditEntry[] = [];
    try {
      const raw = await readFile(logPath, 'utf-8');
      entries = JSON.parse(raw);
    } catch { /* new file */ }
    entries.push(entry);
    const tmp = join(auditLogDir, `.tmp_sdlog_${randomBytes(6).toString('hex')}`);
    await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
    await rename(tmp, logPath);
  } catch (err) {
    try { await unlink(join(auditLogDir, `.tmp_sdlog_${randomBytes(6).toString('hex')}`)); } catch { /* ignore */ }
    console.error('[self_develop] Failed to write audit log:', err);
  }
}

interface ClaudeSession {
  session_id: string;
  last_used: string;
}

interface ClaudeCliResult {
  result?: string;
  session_id?: string;
  cost_usd?: number;
  num_turns?: number;
  error?: string;
}

async function readSessionId(): Promise<string | null> {
  try {
    const content = await readFile(SESSION_FILE, 'utf-8');
    const data = JSON.parse(content) as ClaudeSession;
    return data.session_id || null;
  } catch {
    return null;
  }
}

async function writeSessionId(sessionId: string): Promise<void> {
  const data: ClaudeSession = {
    session_id: sessionId,
    last_used: new Date().toISOString(),
  };
  await writeFile(SESSION_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function runClaude(task: string, sessionId: string | null, maxTurns: number, maxBudget: number): Promise<ClaudeCliResult & { rawStdout?: string }> {
  const args = [
    '-p', task,
    '--output-format', 'json',
    '--max-turns', String(maxTurns),
    '--max-budget-usd', String(maxBudget),
    '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const { stdout, stderr } = await execFileAsync(CLAUDE_BIN, args, {
    cwd: CLAIRE_REPO_ROOT,
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    },
  });

  if (stderr) {
    console.error(`[self_develop stderr] ${stderr.slice(0, 500)}`);
  }

  try {
    return JSON.parse(stdout) as ClaudeCliResult;
  } catch {
    return { result: stdout.slice(0, 3000), rawStdout: stdout };
  }
}

export function getSelfDevelopToolDefinition(): Anthropic.Tool {
  return {
    name: 'self_develop',
    description: `Hand a development task to Claude Code, which has access to the claire codebase.

Use this to:
- Fix bugs documented in DEV-NOTES.md
- Make targeted improvements to the gateway
- Investigate issues in the codebase

For significant changes, scope the work and get Sergio's approval first.
For small bounded fixes (documented bugs, minor improvements), you may invoke this on a quiet heartbeat — but scope the task tightly to specific files and behaviors.

Only one self_develop session can run at a time. Maintains a persistent session across calls.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'What you want Claude Code to do. Be specific — include file names, expected behavior, and what "done" looks like.',
        },
        max_turns: {
          type: 'number',
          description: `Maximum agent turns. Defaults to ${DEFAULT_MAX_TURNS}.`,
        },
        max_budget_usd: {
          type: 'number',
          description: `Maximum USD to spend. Defaults to $${DEFAULT_MAX_BUDGET_USD}. Hard cap — tasks over budget are abandoned.`,
        },
      },
      required: ['task'],
    },
  };
}

export async function executeSelfDevelop(input: {
  task: string;
  max_turns?: number;
  max_budget_usd?: number;
}): Promise<string> {
  // Mutex — only one self_develop session at a time
  if (running) {
    console.log('[self_develop] Rejected — another session is already running');
    return 'Error: self_develop is already running. Wait for the current session to complete.';
  }

  running = true;
  const startTime = Date.now();
  const maxTurns = input.max_turns ?? DEFAULT_MAX_TURNS;
  const maxBudget = input.max_budget_usd ?? DEFAULT_MAX_BUDGET_USD;

  const existingSessionId = await readSessionId();

  if (existingSessionId) {
    console.log(`[self_develop] Resuming session ${existingSessionId}`);
  } else {
    console.log('[self_develop] No session found — starting fresh');
  }

  console.log(`[self_develop] Task: ${input.task.slice(0, 200)}${input.task.length > 200 ? '...' : ''}`);

  let result: ClaudeCliResult;
  let usedSessionId = existingSessionId;

  try {
    result = await runClaude(input.task, existingSessionId, maxTurns, maxBudget);
  } catch (resumeErr) {
    const resumeError = resumeErr as Error & { stderr?: string; stdout?: string; code?: number | string };
    const resumeStderr = resumeError.stderr?.slice(0, 500) || '';
    console.error(`[self_develop] Failed (code=${resumeError.code}): ${resumeError.message}\nStderr: ${resumeStderr}`);

    if (existingSessionId) {
      console.log('[self_develop] Resume failed, starting fresh session');
      usedSessionId = null;
      try {
        result = await runClaude(input.task, null, maxTurns, maxBudget);
      } catch (freshErr) {
        const err = freshErr as Error & { stderr?: string; stdout?: string; code?: number | string };
        const freshStderr = err.stderr?.slice(0, 500) || '';
        console.error(`[self_develop] Fresh session also failed (code=${err.code}): ${err.message}\nStderr: ${freshStderr}`);
        running = false;
        await writeAuditEntry({
          ts: new Date().toISOString(), task: input.task, sessionId: usedSessionId,
          maxTurns, maxBudget, durationMs: Date.now() - startTime,
          status: 'failed', error: err.message,
        });
        return `self_develop failed (fresh session): ${err.message}\n\nStderr: ${freshStderr || 'none'}\nStdout: ${err.stdout?.slice(0, 500) || 'none'}`;
      }
    } else {
      running = false;
      await writeAuditEntry({
        ts: new Date().toISOString(), task: input.task, sessionId: usedSessionId,
        maxTurns, maxBudget, durationMs: Date.now() - startTime,
        status: 'failed', error: resumeError.message,
      });
      return `self_develop failed: ${resumeError.message}\n\nStderr: ${resumeStderr || 'none'}\nStdout: ${resumeError.stdout?.slice(0, 500) || 'none'}`;
    }
  }

  running = false;

  // Persist the session ID for next call
  const returnedSessionId = result.session_id;
  if (returnedSessionId) {
    await writeSessionId(returnedSessionId);
    if (returnedSessionId !== usedSessionId) {
      console.log(`[self_develop] New session ID saved: ${returnedSessionId}`);
    }
  }

  const cost = result.cost_usd != null ? ` | cost: $${result.cost_usd.toFixed(3)}` : '';
  const turns = result.num_turns != null ? ` | turns: ${result.num_turns}` : '';
  const sessionNote = returnedSessionId ? `Session: ${returnedSessionId}` : '';

  await writeAuditEntry({
    ts: new Date().toISOString(), task: input.task, sessionId: returnedSessionId ?? usedSessionId,
    maxTurns, maxBudget, durationMs: Date.now() - startTime,
    resultTurns: result.num_turns, resultCost: result.cost_usd,
    status: 'completed',
  });

  return [
    `## self_develop completed${cost}${turns}`,
    sessionNote,
    '',
    result.result || '(no result text)',
  ].filter(Boolean).join('\n');
}
