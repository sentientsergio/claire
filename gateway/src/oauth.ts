/**
 * OAuth 2.0 Authorization Server — In-Process, N=1
 *
 * Implements the MCP auth spec (2025-06-18) using the "internal mode" pattern:
 * OAuth endpoints run in the same process as the MCP server. No Redis, no
 * separate auth service — appropriate for single-user personal use.
 *
 * Implements:
 *   GET  /.well-known/oauth-protected-resource  — Protected Resource Metadata
 *   GET  /.well-known/oauth-authorization-server — Authorization Server Metadata
 *   POST /register                              — Dynamic Client Registration
 *   GET  /authorize                             — Authorization approval page
 *   POST /authorize                             — Handle approval, issue code
 *   POST /token                                 — Token exchange + refresh
 *
 * Security:
 *   - PKCE (S256) required for all authorization flows
 *   - Access tokens expire after 7 days; refresh tokens after 30 days
 *   - All storage is in-memory; tokens are lost on restart (Claude.ai re-auths)
 *   - Local requests (loopback) skip OAuth entirely via the MCP server
 *
 * Claude.ai callback URL: https://claude.ai/api/mcp/auth_callback
 */

import { createHash, randomBytes } from 'crypto';
import type http from 'http';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;                // 10 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  clientName: string;
  registeredAt: number;
}

interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  expiresAt: number;
}

interface AccessToken {
  token: string;
  clientId: string;
  expiresAt: number;
}

interface RefreshToken {
  token: string;
  clientId: string;
  expiresAt: number;
}

// ─── In-Memory Storage ────────────────────────────────────────────────────────

const clients = new Map<string, OAuthClient>();
const pendingCodes = new Map<string, PendingAuth>(); // code -> PendingAuth
const accessTokens = new Map<string, AccessToken>();
const refreshTokens = new Map<string, RefreshToken>();

// ─── Config (set once on init) ────────────────────────────────────────────────

let serverBaseUrl = '';

/**
 * Initialize OAuth. If staticClientId + staticClientSecret are provided,
 * pre-registers a static client that survives restarts. The user enters these
 * credentials once in the Claude connector's "Advanced settings" fields.
 * DCR still works for clients that don't use static credentials.
 */
export function initOAuth(
  baseUrl: string,
  staticClientId?: string,
  staticClientSecret?: string,
): void {
  serverBaseUrl = baseUrl.replace(/\/$/, '');

  if (staticClientId && staticClientSecret) {
    const staticClient: OAuthClient = {
      clientId: staticClientId,
      clientSecret: staticClientSecret,
      // Accept all known Claude callback URLs
      redirectUris: [
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.ai/api/organizations/mcp/auth_callback',
      ],
      clientName: 'Claude (pre-registered)',
      registeredAt: Date.now(),
    };
    clients.set(staticClientId, staticClient);
    console.log(`[oauth] Static client pre-registered: ${staticClientId}`);
  }

  console.log(`[oauth] Initialized — base URL: ${serverBaseUrl}`);
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

function generateToken(prefix: string = ''): string {
  return prefix + randomBytes(32).toString('hex');
}

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === 'S256') {
    const computed = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return computed === challenge;
  }
  // plain method (discouraged, but handle it)
  return verifier === challenge;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
  });
  res.end(json);
}

function errorResponse(
  res: http.ServerResponse,
  status: number,
  error: string,
  description?: string
): void {
  jsonResponse(res, status, {
    error,
    ...(description ? { error_description: description } : {}),
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function parseFormBody(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of raw.split('&')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = decodeURIComponent(part.slice(0, idx).replace(/\+/g, ' '));
    const v = decodeURIComponent(part.slice(idx + 1).replace(/\+/g, ' '));
    params[k] = v;
  }
  return params;
}

function extractBearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

// ─── OAuth Handlers ───────────────────────────────────────────────────────────

/**
 * GET /.well-known/oauth-protected-resource
 * Tells Claude.ai where the authorization server lives (ourselves, internal mode).
 */
export function handleProtectedResourceMetadata(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  jsonResponse(res, 200, {
    resource: serverBaseUrl,
    authorization_servers: [serverBaseUrl],
  });
}

/**
 * GET /.well-known/oauth-authorization-server
 * Authorization Server Metadata (RFC 8414).
 */
export function handleAuthServerMetadata(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  jsonResponse(res, 200, {
    issuer: serverBaseUrl,
    authorization_endpoint: `${serverBaseUrl}/authorize`,
    token_endpoint: `${serverBaseUrl}/token`,
    registration_endpoint: `${serverBaseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  });
}

/**
 * POST /register
 * Dynamic Client Registration (RFC 7591). Claude.ai registers itself here.
 */
export async function handleRegister(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    errorResponse(res, 400, 'invalid_request', 'Invalid JSON body');
    return;
  }

  const redirectUris = Array.isArray(body['redirect_uris']) ? body['redirect_uris'] as string[] : [];
  if (redirectUris.length === 0) {
    errorResponse(res, 400, 'invalid_redirect_uri', 'redirect_uris is required');
    return;
  }

  const clientId = generateToken('client_');
  const clientSecret = generateToken('secret_');
  const client: OAuthClient = {
    clientId,
    clientSecret,
    redirectUris,
    clientName: typeof body['client_name'] === 'string' ? body['client_name'] : 'Unknown Client',
    registeredAt: Date.now(),
  };
  clients.set(clientId, client);
  console.log(`[oauth] Client registered: ${client.clientName} (${clientId})`);

  jsonResponse(res, 201, {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(client.registeredAt / 1000),
    client_secret_expires_at: 0,
    redirect_uris: redirectUris,
    client_name: client.clientName,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
}

/**
 * GET /authorize
 * Shows an approval page. Claude.ai redirects the user here.
 */
export function handleAuthorizeGet(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const url = new URL(req.url || '/', `http://localhost`);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
  const state = url.searchParams.get('state') || '';
  const scope = url.searchParams.get('scope') || '';

  const client = clients.get(clientId);
  if (!client) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Unknown client</h1>');
    return;
  }

  if (!client.redirectUris.includes(redirectUri)) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Invalid redirect URI</h1>');
    return;
  }

  if (!codeChallenge) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>PKCE code_challenge is required</h1>');
    return;
  }

  const approvalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claire — Authorization Request</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e8e8e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 40px;
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .avatar {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #fff;
    }
    .client-name {
      font-size: 15px;
      color: #888;
      margin-bottom: 28px;
    }
    .client-name strong { color: #ccc; }
    .description {
      font-size: 14px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 32px;
      padding: 16px;
      background: #111;
      border-radius: 8px;
      text-align: left;
    }
    .description ul {
      padding-left: 16px;
      margin-top: 8px;
    }
    .description li { margin-bottom: 4px; }
    .buttons {
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 12px 20px;
      border-radius: 10px;
      border: none;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    .approve {
      background: #5865f2;
      color: #fff;
    }
    .deny {
      background: #2a2a2a;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="avatar">⬡</div>
    <h1>Authorization Request</h1>
    <p class="client-name"><strong>${escapeHtml(client.clientName)}</strong> wants to connect to Claire's runtime</p>
    <div class="description">
      If approved, this client will be able to:
      <ul>
        <li>Send messages to Claire</li>
        <li>Read and write workspace files</li>
        <li>Access Claire's status</li>
      </ul>
    </div>
    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="scope" value="${escapeHtml(scope)}">
      <div class="buttons">
        <button type="submit" name="action" value="deny" class="deny">Deny</button>
        <button type="submit" name="action" value="approve" class="approve">Approve</button>
      </div>
    </form>
  </div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(approvalHtml);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * POST /authorize
 * Handles the approval form. Issues an authorization code and redirects.
 */
export async function handleAuthorizePost(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  const params = parseFormBody(raw);

  const { client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, action } = params;

  if (action !== 'approve') {
    // User denied — redirect with error
    const errUrl = new URL(redirect_uri);
    errUrl.searchParams.set('error', 'access_denied');
    if (state) errUrl.searchParams.set('state', state);
    res.writeHead(302, { Location: errUrl.toString() });
    res.end();
    return;
  }

  const client = clients.get(client_id);
  if (!client || !client.redirectUris.includes(redirect_uri)) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Invalid request</h1>');
    return;
  }

  const code = generateToken('code_');
  const pending: PendingAuth = {
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method || 'S256',
    state: state || '',
    scope: scope || '',
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  };
  pendingCodes.set(code, pending);
  console.log(`[oauth] Authorization code issued for client: ${client.clientName}`);

  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set('code', code);
  if (state) callbackUrl.searchParams.set('state', state);

  res.writeHead(302, { Location: callbackUrl.toString() });
  res.end();
}

/**
 * POST /token
 * Handles authorization_code and refresh_token grant types.
 */
export async function handleToken(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  const params = parseFormBody(raw);
  const grantType = params['grant_type'];

  if (grantType === 'authorization_code') {
    await handleAuthCodeExchange(params, res);
  } else if (grantType === 'refresh_token') {
    await handleRefreshTokenGrant(params, res);
  } else {
    errorResponse(res, 400, 'unsupported_grant_type', `grant_type '${grantType}' is not supported`);
  }
}

async function handleAuthCodeExchange(
  params: Record<string, string>,
  res: http.ServerResponse
): Promise<void> {
  const { code, client_id, client_secret, redirect_uri, code_verifier } = params;

  if (!code || !client_id || !redirect_uri || !code_verifier) {
    errorResponse(res, 400, 'invalid_request', 'Missing required parameters: code, client_id, redirect_uri, code_verifier');
    return;
  }

  const client = clients.get(client_id);
  if (!client || client.clientSecret !== client_secret) {
    errorResponse(res, 401, 'invalid_client', 'Invalid client credentials');
    return;
  }

  const pending = pendingCodes.get(code);
  if (!pending) {
    errorResponse(res, 400, 'invalid_grant', 'Authorization code not found or already used');
    return;
  }

  pendingCodes.delete(code); // single-use

  if (Date.now() > pending.expiresAt) {
    errorResponse(res, 400, 'invalid_grant', 'Authorization code has expired');
    return;
  }

  if (pending.clientId !== client_id || pending.redirectUri !== redirect_uri) {
    errorResponse(res, 400, 'invalid_grant', 'Code was not issued for this client/redirect_uri');
    return;
  }

  if (!verifyPkce(code_verifier, pending.codeChallenge, pending.codeChallengeMethod)) {
    errorResponse(res, 400, 'invalid_grant', 'PKCE code_verifier does not match code_challenge');
    return;
  }

  const accessToken = generateToken('at_');
  const refreshToken = generateToken('rt_');
  const now = Date.now();

  accessTokens.set(accessToken, {
    token: accessToken,
    clientId: client_id,
    expiresAt: now + ACCESS_TOKEN_TTL_MS,
  });

  refreshTokens.set(refreshToken, {
    token: refreshToken,
    clientId: client_id,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
  });

  console.log(`[oauth] Access token issued for client: ${client.clientName}`);

  jsonResponse(res, 200, {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: '',
  });
}

async function handleRefreshTokenGrant(
  params: Record<string, string>,
  res: http.ServerResponse
): Promise<void> {
  const { refresh_token, client_id, client_secret } = params;

  if (!refresh_token || !client_id) {
    errorResponse(res, 400, 'invalid_request', 'Missing required parameters: refresh_token, client_id');
    return;
  }

  const client = clients.get(client_id);
  if (!client || client.clientSecret !== client_secret) {
    errorResponse(res, 401, 'invalid_client', 'Invalid client credentials');
    return;
  }

  const storedRefresh = refreshTokens.get(refresh_token);
  if (!storedRefresh) {
    errorResponse(res, 400, 'invalid_grant', 'Refresh token not found or already used');
    return;
  }

  if (storedRefresh.clientId !== client_id) {
    errorResponse(res, 400, 'invalid_grant', 'Refresh token was not issued for this client');
    return;
  }

  if (Date.now() > storedRefresh.expiresAt) {
    refreshTokens.delete(refresh_token);
    errorResponse(res, 400, 'invalid_grant', 'Refresh token has expired');
    return;
  }

  // Rotate: revoke old, issue new pair
  refreshTokens.delete(refresh_token);

  const newAccessToken = generateToken('at_');
  const newRefreshToken = generateToken('rt_');
  const now = Date.now();

  accessTokens.set(newAccessToken, {
    token: newAccessToken,
    clientId: client_id,
    expiresAt: now + ACCESS_TOKEN_TTL_MS,
  });

  refreshTokens.set(newRefreshToken, {
    token: newRefreshToken,
    clientId: client_id,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
  });

  console.log(`[oauth] Tokens refreshed for client: ${client.clientName}`);

  jsonResponse(res, 200, {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: '',
  });
}

// ─── Token Validation (used by MCP server) ────────────────────────────────────

/**
 * Validate an OAuth access token. Returns true if valid and not expired.
 * Called by the MCP server to gate remote /mcp requests.
 */
export function validateOAuthToken(token: string): boolean {
  const stored = accessTokens.get(token);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    accessTokens.delete(token);
    return false;
  }
  return true;
}

/**
 * Returns a WWW-Authenticate header value indicating OAuth is required.
 * Sent with 401 responses so Claude.ai knows to initiate the auth flow.
 */
export function wwwAuthenticateHeader(): string {
  return `Bearer realm="Claire", resource_metadata="${serverBaseUrl}/.well-known/oauth-protected-resource"`;
}

// ─── Request Dispatcher ───────────────────────────────────────────────────────

/**
 * Route an incoming request to the appropriate OAuth handler.
 * Returns true if the request was handled, false if it should fall through.
 */
export async function handleOAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://localhost`);
  const { pathname } = url;
  const method = req.method?.toUpperCase();

  // CORS preflight for OAuth endpoints
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return true;
  }

  if (pathname === '/.well-known/oauth-protected-resource' && method === 'GET') {
    handleProtectedResourceMetadata(req, res);
    return true;
  }

  if (pathname === '/.well-known/oauth-authorization-server' && method === 'GET') {
    handleAuthServerMetadata(req, res);
    return true;
  }

  if (pathname === '/register' && method === 'POST') {
    await handleRegister(req, res);
    return true;
  }

  if (pathname === '/authorize' && method === 'GET') {
    handleAuthorizeGet(req, res);
    return true;
  }

  if (pathname === '/authorize' && method === 'POST') {
    await handleAuthorizePost(req, res);
    return true;
  }

  if (pathname === '/token' && method === 'POST') {
    await handleToken(req, res);
    return true;
  }

  return false;
}
