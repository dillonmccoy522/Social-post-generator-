require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { buildMcpServer } = require('./mcp');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

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
