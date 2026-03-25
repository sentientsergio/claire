/**
 * Cost Tracker
 *
 * Tracks daily API spend across all model calls and persists it to
 * workspace/cost/YYYY-MM-DD.json. Each entry records per-call spend so
 * the file doubles as a lightweight audit log.
 *
 * Model rates (as of 2026-03):
 *   Opus 4.6:   $15.00 / $75.00 per million input/output tokens
 *   Sonnet 4.6:  $3.00 / $15.00 per million input/output tokens
 *   Haiku 4.5:   $0.80 /  $4.00 per million input/output tokens
 */

import { readFile, writeFile, rename, mkdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

// ─── Model Rate Table ─────────────────────────────────────────────────────────

interface ModelRates {
  inputPerM: number;
  outputPerM: number;
}

const MODEL_RATES: Record<string, ModelRates> = {
  'claude-opus-4-6':            { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-sonnet-4-6':          { inputPerM:  3.00, outputPerM: 15.00 },
  'claude-haiku-4-5-20251001':  { inputPerM:  0.80, outputPerM:  4.00 },
  'claude-haiku-4-5':           { inputPerM:  0.80, outputPerM:  4.00 },
};

const FALLBACK_RATES: ModelRates = { inputPerM: 3.00, outputPerM: 15.00 };

export function getRates(model: string): ModelRates {
  return MODEL_RATES[model] ?? FALLBACK_RATES;
}

export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = getRates(model);
  return (inputTokens / 1_000_000) * rates.inputPerM
       + (outputTokens / 1_000_000) * rates.outputPerM;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

interface SpendEntry {
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface DailyLog {
  date: string;
  totalCost: number;
  entries: SpendEntry[];
}

let wsPath = '';

export function initCostTracker(workspacePath: string): void {
  wsPath = workspacePath;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function logPath(date: string): string {
  return join(wsPath, 'cost', `${date}.json`);
}

async function readLog(date: string): Promise<DailyLog> {
  try {
    const raw = await readFile(logPath(date), 'utf-8');
    return JSON.parse(raw) as DailyLog;
  } catch {
    return { date, totalCost: 0, entries: [] };
  }
}

async function writeLog(log: DailyLog): Promise<void> {
  const p = logPath(log.date);
  const dir = dirname(p);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp_cost_${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(tmp, JSON.stringify(log, null, 2), 'utf-8');
    await rename(tmp, p);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function recordSpend(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (!wsPath) return;
  try {
    const date = todayKey();
    const cost = calcCost(model, inputTokens, outputTokens);
    const log = await readLog(date);
    log.totalCost = +(log.totalCost + cost).toFixed(6);
    log.entries.push({
      ts: new Date().toISOString(),
      model,
      inputTokens,
      outputTokens,
      cost: +cost.toFixed(6),
    });
    await writeLog(log);
  } catch (err) {
    console.error('[cost-tracker] Failed to record spend:', err);
  }
}

export async function getDailySpend(): Promise<number> {
  if (!wsPath) return 0;
  try {
    const log = await readLog(todayKey());
    return log.totalCost;
  } catch {
    return 0;
  }
}

export async function getDailySpendFormatted(): Promise<string> {
  const spend = await getDailySpend();
  return `$${spend.toFixed(2)} spent today`;
}
