require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { buildMcpServer } = require('./mcp');
const g = require('./google');

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
];

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#F7F8FB;color:#1B2333;margin:0;padding:40px 20px;line-height:1.5}
  .card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #E1E5EE;border-radius:14px;padding:28px}
  h1{font-size:22px;margin:0 0 12px}
  p{margin:10px 0;color:#3d465c}
  .ok{color:#1F9D61;font-weight:700}
  .warn{color:#C25E00;font-weight:700}
  code,.token{background:#EDF0F6;border-radius:8px;padding:2px 8px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
  .token{display:block;padding:14px;margin:14px 0;word-break:break-all;user-select:all}
  a.btn{display:inline-block;background:#2B5FE3;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:12px 22px;margin-top:12px}
  ol{padding-left:22px}li{margin:6px 0}
</style></head><body><div class="card">${body}</div></body></html>`;
}

function baseUrl(req) {
  const host = req.get('host') || '';
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return `${local ? req.protocol : 'https'}://${host}`;
}

function oauthClient(req) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl(req)}/oauth/callback`
  );
}

// One-time, browser-only Google setup — works from a phone or iPad.
app.get('/setup/:secret', (req, res) => {
  if (!secretOk(req.params.secret)) return res.status(401).send(page('Not authorized', '<h1>Not authorized</h1><p>Check the setup link.</p>'));
  const haveClient = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!haveClient) {
    return res.send(page('Task Bridge setup', `
      <h1>Task Bridge setup</h1>
      <p class="warn">Missing Google credentials.</p>
      <p>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in Railway variables first, then reload this page.</p>
      <p>Also add this redirect URI to the OAuth client in Google Cloud Console:</p>
      <code class="token">${esc(baseUrl(req))}/oauth/callback</code>`));
  }
  if (g.isConfigured()) {
    return res.send(page('Task Bridge setup', `
      <h1>Task Bridge setup</h1>
      <p class="ok">✓ Google is connected.</p>
      <p>Your Claude connector URL (treat it like a password):</p>
      <code class="token">${esc(baseUrl(req))}/mcp/${esc(req.params.secret)}</code>
      <p>Add it on claude.ai → Settings → Connectors → <b>Add custom connector</b>.</p>`));
  }
  return res.send(page('Task Bridge setup', `
    <h1>Task Bridge setup</h1>
    <p>One step: sign in with the Google account whose Tasks and Calendar you use.</p>
    <p>Heads-up: the OAuth client in Google Cloud must list this redirect URI:</p>
    <code class="token">${esc(baseUrl(req))}/oauth/callback</code>
    <a class="btn" href="/setup/${esc(req.params.secret)}/start">Connect Google</a>`));
});

app.get('/setup/:secret/start', (req, res) => {
  if (!secretOk(req.params.secret)) return res.status(401).send(page('Not authorized', '<h1>Not authorized</h1>'));
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect(`/setup/${encodeURIComponent(req.params.secret)}`);
  }
  const url = oauthClient(req).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: OAUTH_SCOPES,
    state: req.params.secret,
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!secretOk(state)) return res.status(401).send(page('Not authorized', '<h1>Not authorized</h1>'));
  try {
    const { tokens } = await oauthClient(req).getToken(String(code));
    if (!tokens.refresh_token) {
      return res.status(400).send(page('Almost', `
        <h1>Almost — no refresh token came back</h1>
        <p>Google only hands one out on the first approval. Remove the app's access at
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, then
        <a href="/setup/${encodeURIComponent(String(state))}">try again</a>.</p>`));
    }
    return res.send(page('Connected', `
      <h1 class="ok">✓ Google sign-in worked</h1>
      <p>Last step — copy this value:</p>
      <code class="token">${esc(tokens.refresh_token)}</code>
      <ol>
        <li>In Railway, open this service's <b>Variables</b>.</li>
        <li>Add <code>GOOGLE_REFRESH_TOKEN</code> and paste the value.</li>
        <li>Railway redeploys itself — then <a href="/setup/${encodeURIComponent(String(state))}">come back here</a> to grab your Claude connector URL.</li>
      </ol>`));
  } catch (err) {
    console.error('OAuth callback failed:', err.message);
    return res.status(400).send(page('Sign-in failed', `
      <h1>Sign-in failed</h1>
      <p>${esc(err.message)}</p>
      <p><a href="/setup/${encodeURIComponent(String(state || ''))}">Try again</a></p>`));
  }
});

function secretOk(given) {
  const secret = process.env.MCP_SECRET;
  if (!secret) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Stateless Streamable HTTP: a fresh server + transport per request.
app.post('/mcp/:secret', async (req, res) => {
  if (!secretOk(req.params.secret)) return res.status(401).json({ error: 'unauthorized' });
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Stateless mode has no long-lived stream or session to manage.
app.get('/mcp/:secret', (_req, res) => res.status(405).json({ error: 'Method not allowed' }));
app.delete('/mcp/:secret', (_req, res) => res.status(405).json({ error: 'Method not allowed' }));

if (require.main === module) {
  const PORT = process.env.PORT || 3200;
  if (!process.env.MCP_SECRET) {
    console.error('MCP_SECRET is not set — the /mcp endpoint will reject everything.');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'base64url\'))"');
  }
  app.listen(PORT, () => {
    console.log(`\nNiewdel Task Bridge listening on port ${PORT}`);
    if (process.env.MCP_SECRET) {
      console.log(`MCP endpoint: /mcp/<your MCP_SECRET>`);
    }
  });
}

module.exports = app;
