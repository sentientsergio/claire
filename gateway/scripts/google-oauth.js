#!/usr/bin/env node
/**
 * Google OAuth Flow
 * 
 * Run this script to get a refresh token for Google Calendar API.
 * Usage: node scripts/google-oauth.js
 */

import http from 'http';
import { URL } from 'url';
import open from 'open';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables');
  console.error('');
  console.error('Example:');
  console.error('  export GOOGLE_CLIENT_ID=your-client-id');
  console.error('  export GOOGLE_CLIENT_SECRET=your-client-secret');
  console.error('  node scripts/google-oauth.js');
  process.exit(1);
}

// Build authorization URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // Force refresh token generation

console.log('Starting OAuth flow...');
console.log('');

// Start local server to receive callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3000`);
  
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  
  if (error) {
    res.writeHead(400);
    res.end(`Error: ${error}`);
    console.error('Authorization failed:', error);
    server.close();
    process.exit(1);
  }
  
  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    server.close();
    process.exit(1);
  }
  
  // Exchange code for tokens
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }
    
    const tokens = await tokenResponse.json();
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✓ Authorization successful!</h1>
          <p>You can close this window and return to the terminal.</p>
        </body>
      </html>
    `);
    
    console.log('✓ Authorization successful!');
    console.log('');
    console.log('Add this to your gateway/.env file:');
    console.log('');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('');
    
    if (!tokens.refresh_token) {
      console.log('⚠️  No refresh token received. This can happen if you already authorized this app.');
      console.log('   Go to https://myaccount.google.com/permissions and remove "claire"');
      console.log('   Then run this script again.');
    }
    
    server.close();
    process.exit(0);
    
  } catch (err) {
    res.writeHead(500);
    res.end(`Error: ${err.message}`);
    console.error('Token exchange failed:', err);
    server.close();
    process.exit(1);
  }
});

server.listen(3000, async () => {
  console.log('Opening browser for authorization...');
  console.log('');
  console.log('If the browser doesn\'t open, visit this URL:');
  console.log(authUrl.toString());
  console.log('');
  
  // Open browser
  try {
    await open(authUrl.toString());
  } catch {
    // Browser open failed, user will need to click the link
  }
});
