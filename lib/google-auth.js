require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, '../data/tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/auth/google/callback'
  );
}

function getAuthUrl() {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens));
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')); } catch (_) { return null; }
}

function getAuthorizedClient() {
  const tokens = loadTokens();
  if (!tokens) return null;
  const client = getOAuthClient();
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => saveTokens({ ...tokens, ...newTokens }));
  return client;
}

function requireAuth(req, res, next) {
  const client = getAuthorizedClient();
  if (!client) return res.status(401).json({ error: 'Google auth required', authUrl: getAuthUrl() });
  req.googleAuth = client;
  next();
}

module.exports = { getOAuthClient, getAuthUrl, saveTokens, loadTokens, getAuthorizedClient, requireAuth };
