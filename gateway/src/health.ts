/**
 * Health Monitoring — Dead-Man's-Switch
 *
 * Validates external credentials on startup and periodically.
 * Sends macOS notifications on failure (works even when cloud APIs are down).
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface HealthResult {
  service: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
}

interface HealthReport {
  timestamp: string;
  results: HealthResult[];
  allHealthy: boolean;
}

async function sendAlert(message: string): Promise<void> {
  const title = 'Assistant Bot — Health Alert';
  const escaped = message.replace(/"/g, '\\"').replace(/\n/g, ' ');

  try {
    await execAsync(
      `terminal-notifier -title "${title}" -message "${escaped}" -sound Basso -group "assistant-health"`
    );
    return;
  } catch {
    // fall back to osascript
  }

  try {
    const asEscaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await execAsync(
      `osascript -e "display notification \\"${asEscaped}\\" with title \\"${title}\\""`
    );
  } catch (err) {
    console.error('[health] Failed to send alert:', err);
  }
}

async function checkAnthropic(): Promise<HealthResult> {
  const start = Date.now();
  try {
    const client = new Anthropic();
    await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { service: 'Anthropic', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      service: 'Anthropic',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function checkOpenAI(): Promise<HealthResult> {
  const start = Date.now();
  try {
    const client = new OpenAI();
    await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'health check',
    });
    return { service: 'OpenAI', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      service: 'OpenAI',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function checkGoogleCalendar(): Promise<HealthResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return { service: 'Google Calendar', ok: true, latencyMs: 0 };
  }

  const start = Date.now();
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return {
        service: 'Google Calendar',
        ok: false,
        error: `Token refresh failed (${tokenRes.status}): ${body}`,
        latencyMs: Date.now() - start,
      };
    }

    return { service: 'Google Calendar', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      service: 'Google Calendar',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function runHealthChecks(): Promise<HealthReport> {
  const results = await Promise.all([
    checkAnthropic(),
    checkOpenAI(),
    checkGoogleCalendar(),
  ]);

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    results,
    allHealthy: results.every(r => r.ok),
  };

  return report;
}

function formatReport(report: HealthReport): string {
  const lines = report.results.map(r => {
    const status = r.ok ? '✓' : '✗';
    const detail = r.ok ? `${r.latencyMs}ms` : r.error;
    return `  ${status} ${r.service}: ${detail}`;
  });
  return lines.join('\n');
}

/**
 * Run health checks and log results. Alerts on failure.
 */
export async function performHealthCheck(context: string): Promise<HealthReport> {
  console.log(`[health] Running checks (${context})...`);
  const report = await runHealthChecks();

  console.log(`[health] Results:\n${formatReport(report)}`);

  if (!report.allHealthy) {
    const failed = report.results.filter(r => !r.ok);
    const names = failed.map(r => r.service).join(', ');
    const errors = failed.map(r => `${r.service}: ${r.error}`).join('; ');
    console.error(`[health] UNHEALTHY: ${names}`);
    await sendAlert(`Credential failure: ${names}. ${errors}`);
  }

  return report;
}

const HEALTH_CHECK_SCHEDULE = '15 * * * *';

/**
 * Start periodic health monitoring.
 * Runs on startup and then hourly.
 */
export async function startHealthMonitoring(): Promise<void> {
  const startupReport = await performHealthCheck('startup');

  if (startupReport.allHealthy) {
    console.log('[health] All credentials healthy on startup');
  } else {
    console.error('[health] WARNING: Unhealthy credentials detected on startup');
  }

  cron.schedule(HEALTH_CHECK_SCHEDULE, () => {
    performHealthCheck('hourly').catch(err => {
      console.error('[health] Periodic check failed:', err);
    });
  });

  console.log(`[health] Periodic monitoring started (schedule: ${HEALTH_CHECK_SCHEDULE})`);
}
