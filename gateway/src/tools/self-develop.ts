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
import { readFile, writeFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import type Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAIRE_REPO_ROOT = resolve(__dirname, '../../..');
const SESSION_FILE = join(CLAIRE_REPO_ROOT, '.claude-session.json');
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/sergio/.local/bin/claude';

const DEFAULT_MAX_TURNS = 25;
const DEFAULT_MAX_BUDGET_USD = 3;
const EXEC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

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
    '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep',
    '--dangerously-skip-permissions',
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
    description: `Hand a development task to Claude Code, which has full access to the claire codebase.

Use this to:
- Fix bugs documented in DEV-NOTES.md
- Make targeted improvements to the gateway
- Investigate issues in the codebase

For significant changes, scope the work and get Sergio's approval via Telegram first.
For small bounded fixes (documented bugs, minor improvements), you can invoke this directly on a quiet heartbeat.

Maintains a persistent session — Claude Code builds up context about the codebase across calls.`,
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
  const maxTurns = input.max_turns ?? DEFAULT_MAX_TURNS;
  const maxBudget = input.max_budget_usd ?? DEFAULT_MAX_BUDGET_USD;

  const existingSessionId = await readSessionId();

  if (existingSessionId) {
    console.log(`[self_develop] Resuming session ${existingSessionId}`);
  } else {
    console.log('[self_develop] No session found — starting fresh');
  }

  let result: ClaudeCliResult;
  let usedSessionId = existingSessionId;

  try {
    result = await runClaude(input.task, existingSessionId, maxTurns, maxBudget);
  } catch (resumeErr) {
    // execFile errors carry stderr/stdout on the error object itself
    const resumeError = resumeErr as Error & { stderr?: string; stdout?: string; code?: number | string };
    const resumeStderr = resumeError.stderr?.slice(0, 500) || '';
    console.error(`[self_develop] Failed (code=${resumeError.code}): ${resumeError.message}\nStderr: ${resumeStderr}`);

    // Resume failed — session is stale (machine restart, session ended)
    if (existingSessionId) {
      console.log('[self_develop] Resume failed, starting fresh session');
      usedSessionId = null;
      try {
        result = await runClaude(input.task, null, maxTurns, maxBudget);
      } catch (freshErr) {
        const err = freshErr as Error & { stderr?: string; stdout?: string; code?: number | string };
        const freshStderr = err.stderr?.slice(0, 500) || '';
        console.error(`[self_develop] Fresh session also failed (code=${err.code}): ${err.message}\nStderr: ${freshStderr}`);
        return `self_develop failed (fresh session): ${err.message}\n\nStderr: ${freshStderr || 'none'}\nStdout: ${err.stdout?.slice(0, 500) || 'none'}`;
      }
    } else {
      return `self_develop failed: ${resumeError.message}\n\nStderr: ${resumeStderr || 'none'}\nStdout: ${resumeError.stdout?.slice(0, 500) || 'none'}`;
    }
  }

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

  return [
    `## self_develop completed${cost}${turns}`,
    sessionNote,
    '',
    result.result || '(no result text)',
  ].filter(Boolean).join('\n');
}
