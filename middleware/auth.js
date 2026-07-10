const crypto = require('crypto');

const PUBLIC_PATHS = new Set(['/api/health', '/api/login']);

function sessionToken() {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'dev-secret')
    .update('niewdel-dashboard-session')
    .digest('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function requireAuth(req, res, next) {
  if (!process.env.DASHBOARD_PASSWORD) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();

  const authHeader = req.headers.authorization || '';
  if (process.env.API_TOKEN && authHeader === `Bearer ${process.env.API_TOKEN}`) return next();

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session && crypto.timingSafeEqual(
    Buffer.from(cookies.session.padEnd(64).slice(0, 64)),
    Buffer.from(sessionToken())
  )) return next();

  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { requireAuth, sessionToken };
