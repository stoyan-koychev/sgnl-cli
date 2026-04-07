/**
 * Google OAuth2 module for GSC integration.
 *
 * Handles the browser-based OAuth2 consent flow, token storage,
 * and automatic refresh for Google Search Console API access.
 */

import * as fs from 'fs';
import * as http from 'http';
import { OAuth2Client } from 'google-auth-library';
import { getGSCTokenPath, getSgnlDir } from '../config';
import type { GSCTokens } from '../config';

export type { GSCTokens };

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const REDIRECT_PATH = '/oauth2callback';

/**
 * Load stored GSC tokens from disk.
 */
export function loadTokens(): GSCTokens | null {
  const tokenPath = getGSCTokenPath();
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf-8')) as GSCTokens;
  } catch {
    return null;
  }
}

/**
 * Save GSC tokens to disk.
 */
export function saveTokens(tokens: GSCTokens): void {
  const dir = getSgnlDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getGSCTokenPath(), JSON.stringify(tokens, null, 2) + '\n', 'utf-8');
}

/**
 * Remove stored GSC tokens.
 */
export function removeTokens(): boolean {
  const tokenPath = getGSCTokenPath();
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
    return true;
  }
  return false;
}

/**
 * Create an authenticated OAuth2Client with valid tokens.
 * Returns null if no credentials or tokens are available.
 */
export async function getAuthenticatedClient(
  clientId: string,
  clientSecret: string,
): Promise<OAuth2Client | null> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) return null;

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
  });

  // Auto-refresh if expired
  const now = Date.now();
  if (!tokens.expiry_date || tokens.expiry_date < now + 60_000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      saveTokens({
        access_token: credentials.access_token ?? undefined,
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: credentials.expiry_date ?? undefined,
      });
    } catch {
      return null;
    }
  }

  return oauth2Client;
}

/**
 * Get a valid access token string for API calls.
 * Returns null if authentication is not configured or token refresh fails.
 */
export async function getAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const client = await getAuthenticatedClient(clientId, clientSecret);
  if (!client) return null;

  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token ?? null;
}

/**
 * Run the interactive OAuth2 browser consent flow.
 * Starts a local HTTP server, opens the browser for consent,
 * and exchanges the authorization code for tokens.
 */
export async function runOAuthFlow(
  clientId: string,
  clientSecret: string,
): Promise<GSCTokens> {
  return new Promise((resolve, reject) => {
    // Find a free port
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start local server'));
        return;
      }

      const port = address.port;
      const redirectUri = `http://127.0.0.1:${port}${REDIRECT_PATH}`;

      const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [GSC_SCOPE],
        prompt: 'consent',
      });

      // Handle the callback
      server.removeAllListeners('request');
      server.on('request', async (req, res) => {
        if (!req.url?.startsWith(REDIRECT_PATH)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>');
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Missing authorization code.</h2></body></html>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        try {
          const { tokens: tokenResponse } = await oauth2Client.getToken(code);
          const tokens: GSCTokens = {
            access_token: tokenResponse.access_token ?? undefined,
            refresh_token: tokenResponse.refresh_token ?? undefined,
            expiry_date: tokenResponse.expiry_date ?? undefined,
          };

          saveTokens(tokens);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>SGNL authorized!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Token exchange failed.</h2></body></html>');
          server.close();
          reject(err);
        }
      });

      // Open browser (dynamic import — 'open' is ESM-only)
      console.log('\nOpening browser for Google authorization...');
      console.log(`If the browser doesn't open, visit:\n${authUrl}\n`);
      import('open').then(mod => mod.default(authUrl)).catch(() => {
        // Browser open failed — user can copy URL
      });
    });

    server.on('error', reject);

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out (2 minutes)'));
    }, 120_000);
  });
}

/**
 * Fetch the list of GSC properties available to the authenticated user.
 */
export async function fetchGSCProperties(accessToken: string): Promise<string[]> {
  const { default: axios } = await import('axios');
  const response = await axios.get(
    'https://www.googleapis.com/webmasters/v3/sites',
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10_000 },
  );

  const entries = response.data?.siteEntry ?? [];
  return entries.map((e: { siteUrl: string }) => e.siteUrl);
}
