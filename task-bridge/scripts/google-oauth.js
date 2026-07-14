require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');
const { exec } = require('child_process');

const PORT = 53683;
const REDIRECT = `http://localhost:${PORT}/callback`;
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  console.error('Create them at https://console.cloud.google.com/apis/credentials');
  console.error(`(OAuth client type: Web application, redirect URI: ${REDIRECT})`);
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/calendar.events',
  ],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') { res.end(); return; }
  const { tokens } = await oauth2.getToken(url.searchParams.get('code'));
  res.end('Done — you can close this tab and return to the terminal.');
  console.log('\nAdd this to your .env (and Railway variables):\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  server.close();
});

server.listen(PORT, () => {
  console.log('Open this URL and sign in with the Google account whose Tasks/Calendar you use:\n');
  console.log(authUrl + '\n');
  exec(`open "${authUrl}" 2>/dev/null || xdg-open "${authUrl}" 2>/dev/null`);
});
