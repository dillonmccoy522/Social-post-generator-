# Media Generation Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Media tab to the Niewdel dashboard that scans a client's Google Drive photos folder, uses Claude vision to select the best photos and generate marketing prompts (Higgsfield video + Midjourney image), shows results for review in the dashboard, and saves the plan to the client's Google Drive output folder.

**Architecture:** Three new `lib/` modules handle Google OAuth (`google-auth.js`), Drive API (`drive.js`), and Claude media generation (`media-prompt.js`). Three new route files expose these as Express endpoints. The existing `database.js` is extended with two new client columns and a `media_jobs` table. A new `public/pages/media.html` page and nav entry complete the feature.

**Tech Stack:** Node.js/Express, better-sqlite3, googleapis, @anthropic-ai/sdk, express-session, Jest + supertest

## Global Constraints

- Node.js only — no TypeScript
- SQLite via better-sqlite3 (synchronous API — no async DB calls)
- Tests run with `DB_PATH=:memory:` env var for isolation
- All new API routes under `/api/` except `/auth/google` and `/auth/google/callback`
- `.env` must contain: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`
- OAuth redirect URI: `http://localhost:3000/auth/google/callback`
- Google Drive OAuth scope: `https://www.googleapis.com/auth/drive`
- OAuth tokens persisted to `data/tokens.json` — add to `.gitignore`
- Cap Drive fetch at 50 photos by `modifiedTime desc`; cap photos sent to Claude at 20
- Claude model: `claude-sonnet-4-6`

---

### Task 1: Dependencies, .gitignore, DB Schema

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `database.js`
- Test: `tests/database.test.js`

**Interfaces:**
- Produces:
  - `db.getUsedPhotoIds(clientId: number): string[]`
  - `db.createMediaJob({ clientId, selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt }): MediaJob`
  - `db.getMediaJobsByClientId(clientId: number): MediaJob[]`
  - `clients` table has `drive_photos_url TEXT` and `drive_output_url TEXT` columns
  - `media_jobs` table exists with columns: `id, client_id, selected_photos, script, higgsfield_prompt, midjourney_prompt, created_at`

- [ ] **Step 1: Install dependencies**

```bash
npm install googleapis express-session
```

- [ ] **Step 2: Add tokens file to .gitignore**

Add this line to `.gitignore`:
```
data/tokens.json
```

- [ ] **Step 3: Write failing tests**

Add to `tests/database.test.js`:

```javascript
describe('media jobs', () => {
  let clientId;

  beforeEach(() => {
    const client = db.createClient({
      name: 'Test Media Client',
      business_type: 'Roofing',
      location: 'San Antonio, TX',
    });
    clientId = client.id;
  });

  test('clients table has drive_photos_url and drive_output_url columns', () => {
    const client = db.getClientById(clientId);
    expect(client).toHaveProperty('drive_photos_url');
    expect(client).toHaveProperty('drive_output_url');
  });

  test('createMediaJob saves and returns a job', () => {
    const job = db.createMediaJob({
      clientId,
      selectedPhotos: JSON.stringify([{ id: 'abc', name: 'photo1.jpg', reason: 'great shot' }]),
      script: 'Test script',
      higgsfieldPrompt: 'Test video prompt',
      midjourneyPrompt: 'Test image prompt',
    });
    expect(job.id).toBeDefined();
    expect(job.client_id).toBe(clientId);
    expect(job.script).toBe('Test script');
  });

  test('getMediaJobsByClientId returns jobs for that client', () => {
    db.createMediaJob({
      clientId,
      selectedPhotos: '[]',
      script: 'Script A',
      higgsfieldPrompt: 'Video A',
      midjourneyPrompt: 'Image A',
    });
    const jobs = db.getMediaJobsByClientId(clientId);
    expect(jobs.length).toBe(1);
    expect(jobs[0].script).toBe('Script A');
  });

  test('getUsedPhotoIds returns all photo IDs used for a client', () => {
    db.createMediaJob({
      clientId,
      selectedPhotos: JSON.stringify([{ id: 'photo-1' }, { id: 'photo-2' }]),
      script: 'S',
      higgsfieldPrompt: 'H',
      midjourneyPrompt: 'M',
    });
    const ids = db.getUsedPhotoIds(clientId);
    expect(ids).toContain('photo-1');
    expect(ids).toContain('photo-2');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/database.test.js
```
Expected: FAIL — `db.createMediaJob is not a function`

- [ ] **Step 5: Update database.js schema and add functions**

In `initSchema(db)`, add after the existing `CREATE TABLE` statements:

```javascript
try { db.exec("ALTER TABLE clients ADD COLUMN drive_photos_url TEXT DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE clients ADD COLUMN drive_output_url TEXT DEFAULT ''"); } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS media_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    selected_photos TEXT NOT NULL,
    script TEXT NOT NULL,
    higgsfield_prompt TEXT NOT NULL,
    midjourney_prompt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
```

Add these functions before `module.exports`:

```javascript
function getUsedPhotoIds(clientId) {
  const jobs = getDb()
    .prepare('SELECT selected_photos FROM media_jobs WHERE client_id = ?')
    .all(clientId);
  return jobs.flatMap(job => {
    try { return JSON.parse(job.selected_photos).map(p => p.id); } catch (_) { return []; }
  });
}

function createMediaJob({ clientId, selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt }) {
  const result = getDb()
    .prepare(`INSERT INTO media_jobs (client_id, selected_photos, script, higgsfield_prompt, midjourney_prompt)
              VALUES (?, ?, ?, ?, ?)`)
    .run(clientId, selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt);
  return getDb().prepare('SELECT * FROM media_jobs WHERE id = ?').get(result.lastInsertRowid);
}

function getMediaJobsByClientId(clientId) {
  return getDb()
    .prepare('SELECT * FROM media_jobs WHERE client_id = ? ORDER BY created_at DESC')
    .all(clientId);
}
```

Add to `module.exports`: `getUsedPhotoIds, createMediaJob, getMediaJobsByClientId`

Also update `createClient` and `updateClient` to accept and persist the new Drive URL fields:

```javascript
function createClient({ name, business_type, location, brand_voice = '', drive_photos_url = '', drive_output_url = '' }) {
  const stmt = getDb().prepare(
    'INSERT INTO clients (name, business_type, location, brand_voice, drive_photos_url, drive_output_url) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, business_type, location, brand_voice, drive_photos_url, drive_output_url);
  return getClientById(result.lastInsertRowid);
}

function updateClient(id, { name, business_type, location, brand_voice, drive_photos_url = '', drive_output_url = '' }) {
  getDb().prepare(
    'UPDATE clients SET name = ?, business_type = ?, location = ?, brand_voice = ?, drive_photos_url = ?, drive_output_url = ? WHERE id = ?'
  ).run(name, business_type, location, brand_voice, drive_photos_url, drive_output_url, id);
  return getClientById(id);
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/database.test.js
```
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore database.js tests/database.test.js
git commit -m "feat: add media_jobs schema, Drive URL columns, and DB functions"
```

---

### Task 2: Google OAuth

**Files:**
- Create: `lib/google-auth.js`
- Create: `routes/auth.js`
- Modify: `server.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` from env
- Produces:
  - `requireAuth` Express middleware — attaches `req.googleAuth` (OAuth2Client) or returns `401 { error, authUrl }`
  - `GET /auth/google` → 302 redirect to Google OAuth consent page
  - `GET /auth/google/callback?code=X` → saves tokens to `data/tokens.json`, redirects to `/?auth=success`

- [ ] **Step 1: Write failing tests**

Create `tests/auth.test.js`:

```javascript
const request = require('supertest');

jest.mock('../lib/google-auth', () => ({
  getAuthUrl: () => 'https://accounts.google.com/mock',
  getOAuthClient: () => ({
    getToken: jest.fn().mockResolvedValue({ tokens: { access_token: 'test', refresh_token: 'refresh' } }),
  }),
  saveTokens: jest.fn(),
  loadTokens: jest.fn().mockReturnValue(null),
  requireAuth: (req, res, next) => next(),
}));

const app = require('../server');

describe('GET /auth/google', () => {
  test('redirects to Google OAuth URL', async () => {
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://accounts.google.com/mock');
  });
});

describe('GET /auth/google/callback', () => {
  test('returns 400 when no code provided', async () => {
    const res = await request(app).get('/auth/google/callback');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/auth.test.js
```
Expected: FAIL — route not found.

- [ ] **Step 3: Create lib/google-auth.js**

```javascript
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
```

- [ ] **Step 4: Create routes/auth.js**

```javascript
const express = require('express');
const router = express.Router();
const { getOAuthClient, getAuthUrl, saveTokens } = require('../lib/google-auth');

router.get('/google', (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No auth code provided');
  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    saveTokens(tokens);
    res.redirect('/?auth=success');
  } catch (err) {
    res.status(500).send('Auth failed: ' + err.message);
  }
});

module.exports = router;
```

- [ ] **Step 5: Update server.js**

Add after existing requires at top:
```javascript
const session = require('express-session');
const authRouter = require('./routes/auth');
```

Add session middleware before `app.use(express.json())`:
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
}));
```

Add auth routes after `app.use(express.json())`:
```javascript
app.use('/auth', authRouter);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/auth.test.js
```
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/google-auth.js routes/auth.js server.js tests/auth.test.js
git commit -m "feat: add Google OAuth flow with token persistence"
```

---

### Task 3: Google Drive Library

**Files:**
- Create: `lib/drive.js`
- Test: `tests/drive.test.js`

**Interfaces:**
- Produces:
  - `folderIdFromUrl(url: string): string` — throws `'Invalid Google Drive folder URL'` on bad input
  - `listPhotos(auth, folderId: string, usedFileIds: string[]): Promise<DrivePhoto[]>`
    - DrivePhoto: `{ id: string, name: string, mimeType: string, modifiedTime: string }`
    - Returns at most 20 items, excludes usedFileIds
  - `downloadPhotoAsBase64(auth, fileId: string): Promise<{ data: string, mimeType: string }>`
  - `writeOutputFile(auth, folderId: string, filename: string, content: string): Promise<void>`

- [ ] **Step 1: Write failing tests**

Create `tests/drive.test.js`:

```javascript
jest.mock('googleapis', () => {
  const mockList = jest.fn();
  const mockGet = jest.fn();
  const mockCreate = jest.fn();
  return {
    google: {
      drive: () => ({ files: { list: mockList, get: mockGet, create: mockCreate } }),
      __mocks: { mockList, mockGet, mockCreate },
    },
  };
});

const { google } = require('googleapis');
const { mockList, mockGet, mockCreate } = google.__mocks;
const { folderIdFromUrl, listPhotos, downloadPhotoAsBase64, writeOutputFile } = require('../lib/drive');

describe('folderIdFromUrl', () => {
  test('extracts folder ID from Drive URL', () => {
    expect(folderIdFromUrl('https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'))
      .toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
  });
  test('throws on invalid URL', () => {
    expect(() => folderIdFromUrl('https://google.com')).toThrow('Invalid Google Drive folder URL');
  });
});

describe('listPhotos', () => {
  test('excludes used IDs and returns remaining', async () => {
    mockList.mockResolvedValue({
      data: { files: [
        { id: 'img1', name: 'a.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-01-01' },
        { id: 'img2', name: 'b.png', mimeType: 'image/png', modifiedTime: '2026-01-02' },
      ]},
    });
    const result = await listPhotos({}, 'folder123', ['img1']);
    expect(result.map(f => f.id)).toEqual(['img2']);
  });

  test('caps results at 20', async () => {
    mockList.mockResolvedValue({
      data: { files: Array.from({ length: 30 }, (_, i) => ({ id: `img${i}`, name: `p${i}.jpg`, mimeType: 'image/jpeg', modifiedTime: '2026-01-01' })) },
    });
    expect((await listPhotos({}, 'folder123', [])).length).toBe(20);
  });
});

describe('downloadPhotoAsBase64', () => {
  test('returns base64 string and mimeType', async () => {
    mockGet.mockResolvedValue({ data: Buffer.from('fake').buffer, headers: { 'content-type': 'image/jpeg' } });
    const result = await downloadPhotoAsBase64({}, 'file123');
    expect(result.mimeType).toBe('image/jpeg');
    expect(typeof result.data).toBe('string');
  });
});

describe('writeOutputFile', () => {
  test('calls drive.files.create with correct name and parent', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'new-file' } });
    await writeOutputFile({}, 'folder123', 'output.txt', 'Hello');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: 'output.txt', parents: ['folder123'] }) })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/drive.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create lib/drive.js**

```javascript
const { google } = require('googleapis');
const { Readable } = require('stream');

function folderIdFromUrl(url) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Invalid Google Drive folder URL');
  return match[1];
}

async function listPhotos(auth, folderId, usedFileIds = []) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });
  return (response.data.files || [])
    .filter(f => !usedFileIds.includes(f.id))
    .slice(0, 20);
}

async function downloadPhotoAsBase64(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return {
    data: Buffer.from(response.data).toString('base64'),
    mimeType: response.headers['content-type'] || 'image/jpeg',
  };
}

async function writeOutputFile(auth, folderId, filename, content) {
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType: 'text/plain' },
    media: { mimeType: 'text/plain', body: Readable.from([content]) },
  });
}

module.exports = { folderIdFromUrl, listPhotos, downloadPhotoAsBase64, writeOutputFile };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/drive.test.js
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/drive.js tests/drive.test.js
git commit -m "feat: add Google Drive library for photo listing, download, and output writing"
```

---

### Task 4: Drive Scan Route

**Files:**
- Create: `routes/drive.js`
- Modify: `server.js`
- Test: `tests/drive-route.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `listPhotos`, `folderIdFromUrl`, `db.getClientById`, `db.getUsedPhotoIds`
- Produces: `GET /api/drive/scan/:clientId` → `200 { photos: DrivePhoto[] }` or error

- [ ] **Step 1: Write failing tests**

Create `tests/drive-route.test.js`:

```javascript
process.env.DB_PATH = ':memory:';

jest.mock('../lib/google-auth', () => ({
  requireAuth: (req, res, next) => { req.googleAuth = {}; next(); },
}));

jest.mock('../lib/drive', () => ({
  folderIdFromUrl: () => 'folder123',
  listPhotos: jest.fn().mockResolvedValue([
    { id: 'img1', name: 'photo.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-01-01' },
  ]),
  downloadPhotoAsBase64: jest.fn(),
  writeOutputFile: jest.fn(),
}));

const request = require('supertest');
const app = require('../server');
const db = require('../database');

describe('GET /api/drive/scan/:clientId', () => {
  let clientId;

  beforeEach(() => {
    const client = db.createClient({ name: 'Test', business_type: 'Roofing', location: 'SA' });
    clientId = client.id;
    db.updateClient(clientId, {
      name: 'Test', business_type: 'Roofing', location: 'SA', brand_voice: '',
      drive_photos_url: 'https://drive.google.com/drive/folders/abc',
      drive_output_url: 'https://drive.google.com/drive/folders/def',
    });
  });

  test('returns photo list for valid client', async () => {
    const res = await request(app).get(`/api/drive/scan/${clientId}`);
    expect(res.status).toBe(200);
    expect(res.body.photos[0].id).toBe('img1');
  });

  test('returns 404 for unknown client', async () => {
    const res = await request(app).get('/api/drive/scan/9999');
    expect(res.status).toBe(404);
  });

  test('returns 400 when client has no photos folder', async () => {
    const c = db.createClient({ name: 'No Folder', business_type: 'Plumbing', location: 'Austin' });
    const res = await request(app).get(`/api/drive/scan/${c.id}`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/drive-route.test.js
```
Expected: FAIL — route not found.

- [ ] **Step 3: Create routes/drive.js**

```javascript
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/google-auth');
const { folderIdFromUrl, listPhotos } = require('../lib/drive');
const db = require('../database');

router.get('/scan/:clientId', requireAuth, async (req, res) => {
  const client = db.getClientById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.drive_photos_url) return res.status(400).json({ error: 'Client has no photos folder configured' });

  let folderId;
  try { folderId = folderIdFromUrl(client.drive_photos_url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const usedFileIds = db.getUsedPhotoIds(client.id);
    const photos = await listPhotos(req.googleAuth, folderId, usedFileIds);
    if (photos.length === 0) return res.json({ photos: [], message: 'All photos in this folder have been used' });
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Register in server.js**

Add:
```javascript
const driveRouter = require('./routes/drive');
```
```javascript
app.use('/api/drive', driveRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/drive-route.test.js
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/drive.js server.js tests/drive-route.test.js
git commit -m "feat: add GET /api/drive/scan/:clientId route"
```

---

### Task 5: Claude Media Generation Library

**Files:**
- Create: `lib/media-prompt.js`
- Test: `tests/media-prompt.test.js`

**Interfaces:**
- Produces:
  - `selectPhotosAndGeneratePlan(client, photos): Promise<MediaPlan>`
    - Input `photos`: `[{ id: string, name: string, data: string, mimeType: string }]`
    - Output `MediaPlan`: `{ selectedPhotos: [{ id, name, reason }], script: string, higgsfieldPrompt: string, midjourneyPrompt: string }`

- [ ] **Step 1: Write failing tests**

Create `tests/media-prompt.test.js`:

```javascript
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [{
        text: `SELECTED PHOTOS
1: Great before/after showing roof quality
2: Shows the crew working professionally

SCRIPT
San Antonio homeowners trust this crew to get it done right the first time. Full replacement in one day — clean and built to last.

HIGGSFIELD PROMPT
Cinematic slow pan across a newly installed shingle roof, golden hour light. Camera pulls back to reveal satisfied homeowner.

MIDJOURNEY PROMPT
Professional roofing crew on a residential Texas home, golden hour, photorealistic --ar 9:16 --style raw`,
      }],
    }),
  },
})));

const { selectPhotosAndGeneratePlan } = require('../lib/media-prompt');

const client = { name: 'ABC Roofing', business_type: 'Roofing', location: 'San Antonio, TX', brand_voice: 'Direct' };
const photos = [
  { id: 'p1', name: 'before.jpg', data: 'base64data1', mimeType: 'image/jpeg' },
  { id: 'p2', name: 'after.jpg', data: 'base64data2', mimeType: 'image/jpeg' },
];

test('returns selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt', async () => {
  const plan = await selectPhotosAndGeneratePlan(client, photos);
  expect(plan.selectedPhotos).toHaveLength(2);
  expect(plan.selectedPhotos[0]).toMatchObject({ id: 'p1', name: 'before.jpg' });
  expect(plan.selectedPhotos[0].reason).toBeTruthy();
  expect(plan.script).toContain('San Antonio');
  expect(plan.higgsfieldPrompt).toContain('Cinematic');
  expect(plan.midjourneyPrompt).toContain('--ar 9:16');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/media-prompt.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create lib/media-prompt.js**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(client) {
  return `You are a marketing content strategist for local service businesses. Analyze job site photos to plan compelling marketing videos and images.

Client: ${client.name}
Business Type: ${client.business_type}
Location: ${client.location}
Brand Voice: ${client.brand_voice || 'Professional and approachable'}

Select the 5-10 best photos for marketing. Respond in this EXACT format:

SELECTED PHOTOS
1: [one sentence why this photo is valuable for marketing]
2: [one sentence why this photo is valuable for marketing]
(numbered by order received, one line each)

SCRIPT
[3-5 sentences. What should this make the viewer feel and do? Be specific to the business and work shown.]

HIGGSFIELD PROMPT
[Cinematic video prompt referencing visual elements from the selected photos. Include camera movement, mood, lighting. 2-4 sentences.]

MIDJOURNEY PROMPT
[Image generation prompt with style, mood, subject, composition. End with --ar 9:16 --style raw]`;
}

function parseResponse(text, photos) {
  const selectedPhotos = [];
  const selectedMatch = text.match(/SELECTED PHOTOS\n([\s\S]*?)(?=\n\nSCRIPT|\nSCRIPT)/);
  if (selectedMatch) {
    selectedMatch[1].trim().split('\n').forEach(line => {
      const m = line.match(/^(\d+):\s*(.+)$/);
      if (!m) return;
      const photo = photos[parseInt(m[1], 10) - 1];
      if (photo) selectedPhotos.push({ id: photo.id, name: photo.name, reason: m[2].trim() });
    });
  }
  const scriptMatch = text.match(/SCRIPT\n([\s\S]*?)(?=\n\nHIGGSFIELD PROMPT|\nHIGGSFIELD PROMPT)/);
  const higgsfieldMatch = text.match(/HIGGSFIELD PROMPT\n([\s\S]*?)(?=\n\nMIDJOURNEY PROMPT|\nMIDJOURNEY PROMPT)/);
  const midjourneyMatch = text.match(/MIDJOURNEY PROMPT\n([\s\S]*?)$/);
  return {
    selectedPhotos,
    script: scriptMatch ? scriptMatch[1].trim() : '',
    higgsfieldPrompt: higgsfieldMatch ? higgsfieldMatch[1].trim() : '',
    midjourneyPrompt: midjourneyMatch ? midjourneyMatch[1].trim() : '',
  };
}

async function selectPhotosAndGeneratePlan(client, photos) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: buildSystemPrompt(client),
    messages: [{
      role: 'user',
      content: [
        ...photos.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } })),
        { type: 'text', text: `Here are ${photos.length} photos from ${client.name}'s recent work. Select the best and generate the plan.` },
      ],
    }],
  });
  return parseResponse(message.content[0].text, photos);
}

module.exports = { selectPhotosAndGeneratePlan };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/media-prompt.test.js
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media-prompt.js tests/media-prompt.test.js
git commit -m "feat: add Claude media generation library"
```

---

### Task 6: Media API Routes

**Files:**
- Create: `routes/media.js`
- Modify: `server.js`
- Test: `tests/media.test.js`

**Interfaces:**
- Produces:
  - `POST /api/media/generate` body `{ clientId, photos: DrivePhoto[] }` → `200 { plan: MediaPlan }`
  - `POST /api/media/save` body `{ clientId, plan: MediaPlan }` → `200 { job }`
  - `GET /api/media/history/:clientId` → `200 { jobs: MediaJob[] }`

- [ ] **Step 1: Write failing tests**

Create `tests/media.test.js`:

```javascript
process.env.DB_PATH = ':memory:';

jest.mock('../lib/google-auth', () => ({
  requireAuth: (req, res, next) => { req.googleAuth = {}; next(); },
}));
jest.mock('../lib/drive', () => ({
  folderIdFromUrl: () => 'output-folder',
  downloadPhotoAsBase64: jest.fn().mockResolvedValue({ data: 'base64', mimeType: 'image/jpeg' }),
  writeOutputFile: jest.fn().mockResolvedValue(),
  listPhotos: jest.fn(),
}));
jest.mock('../lib/media-prompt', () => ({
  selectPhotosAndGeneratePlan: jest.fn().mockResolvedValue({
    selectedPhotos: [{ id: 'p1', name: 'photo.jpg', reason: 'Great' }],
    script: 'Test script',
    higgsfieldPrompt: 'Test video',
    midjourneyPrompt: 'Test image --ar 9:16',
  }),
}));

const request = require('supertest');
const app = require('../server');
const db = require('../database');

let clientId;
beforeEach(() => {
  const c = db.createClient({ name: 'Test', business_type: 'Roofing', location: 'SA' });
  clientId = c.id;
  db.updateClient(clientId, {
    name: 'Test', business_type: 'Roofing', location: 'SA', brand_voice: '',
    drive_photos_url: 'https://drive.google.com/drive/folders/photos',
    drive_output_url: 'https://drive.google.com/drive/folders/output',
  });
});

describe('POST /api/media/generate', () => {
  test('returns a media plan', async () => {
    const res = await request(app).post('/api/media/generate')
      .send({ clientId, photos: [{ id: 'p1', name: 'photo.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-01-01' }] });
    expect(res.status).toBe(200);
    expect(res.body.plan.script).toBe('Test script');
  });
  test('returns 400 when clientId missing', async () => {
    const res = await request(app).post('/api/media/generate').send({ photos: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/media/save', () => {
  test('saves job and returns it', async () => {
    const plan = { selectedPhotos: [{ id: 'p1', name: 'p.jpg', reason: 'Great' }], script: 'Save script', higgsfieldPrompt: 'H', midjourneyPrompt: 'M' };
    const res = await request(app).post('/api/media/save').send({ clientId, plan });
    expect(res.status).toBe(200);
    expect(res.body.job.script).toBe('Save script');
  });
});

describe('GET /api/media/history/:clientId', () => {
  test('returns past jobs', async () => {
    db.createMediaJob({ clientId, selectedPhotos: '[]', script: 'History', higgsfieldPrompt: 'H', midjourneyPrompt: 'M' });
    const res = await request(app).get(`/api/media/history/${clientId}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs[0].script).toBe('History');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/media.test.js
```
Expected: FAIL — route not found.

- [ ] **Step 3: Create routes/media.js**

```javascript
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/google-auth');
const { downloadPhotoAsBase64, writeOutputFile, folderIdFromUrl } = require('../lib/drive');
const { selectPhotosAndGeneratePlan } = require('../lib/media-prompt');
const db = require('../database');

router.post('/generate', requireAuth, async (req, res) => {
  const { clientId, photos } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  if (!photos || !Array.isArray(photos) || photos.length === 0) return res.status(400).json({ error: 'photos array is required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  try {
    const photosWithData = await Promise.all(
      photos.map(async (photo) => {
        const { data, mimeType } = await downloadPhotoAsBase64(req.googleAuth, photo.id);
        return { ...photo, data, mimeType };
      })
    );
    const plan = await selectPhotosAndGeneratePlan(client, photosWithData);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', requireAuth, async (req, res) => {
  const { clientId, plan } = req.body;
  if (!clientId || !plan) return res.status(400).json({ error: 'clientId and plan are required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const job = db.createMediaJob({
    clientId,
    selectedPhotos: JSON.stringify(plan.selectedPhotos || []),
    script: plan.script || '',
    higgsfieldPrompt: plan.higgsfieldPrompt || '',
    midjourneyPrompt: plan.midjourneyPrompt || '',
  });

  if (client.drive_output_url) {
    try {
      const folderId = folderIdFromUrl(client.drive_output_url);
      const date = new Date().toISOString().split('T')[0];
      const content = [
        `Niewdel Media Plan — ${client.name} — ${date}`,
        '', 'MARKETING SCRIPT', plan.script,
        '', 'HIGGSFIELD VIDEO PROMPT', plan.higgsfieldPrompt,
        '', 'MIDJOURNEY IMAGE PROMPT', plan.midjourneyPrompt,
        '', 'SELECTED PHOTOS',
        ...(plan.selectedPhotos || []).map(p => `- ${p.name}: ${p.reason}`),
      ].join('\n');
      await writeOutputFile(req.googleAuth, folderId, `niewdel-media-${date}.txt`, content);
    } catch (err) {
      console.error('Drive output write failed:', err.message);
    }
  }
  res.json({ job });
});

router.get('/history/:clientId', async (req, res) => {
  const client = db.getClientById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ jobs: db.getMediaJobsByClientId(req.params.clientId) });
});

module.exports = router;
```

- [ ] **Step 4: Register in server.js**

Add:
```javascript
const mediaRouter = require('./routes/media');
```
```javascript
app.use('/api/media', mediaRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/media.test.js
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/media.js server.js tests/media.test.js
git commit -m "feat: add media API routes for generate, save, and history"
```

---

### Task 7: Update Clients Route for Drive URL Fields

**Files:**
- Modify: `routes/clients.js`
- Test: `tests/clients.test.js`

**Interfaces:**
- Produces: `POST /api/clients` and `PUT /api/clients/:id` now accept and persist `drive_photos_url` and `drive_output_url`

- [ ] **Step 1: Write failing tests**

Add to `tests/clients.test.js`:

```javascript
test('POST /api/clients saves Drive URL fields', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Drive Client', business_type: 'Roofing', location: 'San Antonio',
    drive_photos_url: 'https://drive.google.com/drive/folders/photos123',
    drive_output_url: 'https://drive.google.com/drive/folders/output456',
  });
  expect(res.status).toBe(201);
  expect(res.body.drive_photos_url).toBe('https://drive.google.com/drive/folders/photos123');
  expect(res.body.drive_output_url).toBe('https://drive.google.com/drive/folders/output456');
});

test('PUT /api/clients/:id updates Drive URL fields', async () => {
  const created = (await request(app).post('/api/clients').send({ name: 'X', business_type: 'Y', location: 'Z' })).body;
  const res = await request(app).put(`/api/clients/${created.id}`).send({
    name: 'X', business_type: 'Y', location: 'Z', brand_voice: '',
    drive_photos_url: 'https://drive.google.com/drive/folders/new',
    drive_output_url: 'https://drive.google.com/drive/folders/out',
  });
  expect(res.status).toBe(200);
  expect(res.body.drive_photos_url).toBe('https://drive.google.com/drive/folders/new');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DB_PATH=:memory: npm test -- tests/clients.test.js
```
Expected: New tests FAIL.

- [ ] **Step 3: Update routes/clients.js**

Read `routes/clients.js`. In the POST handler, destructure and pass the new fields:

```javascript
router.post('/', (req, res) => {
  const { name, business_type, location, brand_voice, drive_photos_url, drive_output_url } = req.body;
  if (!name || !business_type || !location) return res.status(400).json({ error: 'name, business_type, and location are required' });
  const client = db.createClient({ name, business_type, location, brand_voice, drive_photos_url, drive_output_url });
  res.status(201).json(client);
});
```

In the PUT handler:
```javascript
router.put('/:id', (req, res) => {
  const { name, business_type, location, brand_voice, drive_photos_url, drive_output_url } = req.body;
  const client = db.updateClient(req.params.id, { name, business_type, location, brand_voice, drive_photos_url, drive_output_url });
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DB_PATH=:memory: npm test -- tests/clients.test.js
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/clients.js tests/clients.test.js
git commit -m "feat: pass Drive URL fields through clients create/update routes"
```

---

### Task 8: Frontend — Client Form + Media Page

**Files:**
- Modify: `public/pages/clients.html`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Create: `public/pages/media.html`

- [ ] **Step 1: Read clients.html**

Read `public/pages/clients.html` to find the form and the JS that populates/submits it.

- [ ] **Step 2: Add Drive URL fields to client form**

In the add/edit form in `clients.html`, add after the `brand_voice` field:

```html
<div class="form-group">
  <label for="client-photos-url">Photos Folder (Google Drive URL)</label>
  <input type="url" id="client-photos-url" placeholder="https://drive.google.com/drive/folders/..." />
</div>
<div class="form-group">
  <label for="client-output-url">Output Folder (Google Drive URL)</label>
  <input type="url" id="client-output-url" placeholder="https://drive.google.com/drive/folders/..." />
</div>
```

In the form submit JS, add to the request body:
```javascript
drive_photos_url: document.getElementById('client-photos-url').value,
drive_output_url: document.getElementById('client-output-url').value,
```

In the edit-populate JS, add:
```javascript
document.getElementById('client-photos-url').value = client.drive_photos_url || '';
document.getElementById('client-output-url').value = client.drive_output_url || '';
```

- [ ] **Step 3: Add Media nav item to index.html**

In `public/index.html`, after the History nav item:
```html
<a href="#" class="nav-item" data-page="media">
  <span class="nav-icon">🎬</span>Media
</a>
```

- [ ] **Step 4: Register media page in app.js**

In `public/app.js`, add `media` to the pages object:
```javascript
media: '/pages/media.html',
```

- [ ] **Step 5: Create public/pages/media.html**

```html
<div class="page-header">
  <h1>Media Generation</h1>
  <p class="page-subtitle">Scan Drive photos and generate marketing prompts</p>
</div>

<div class="card">
  <div class="form-group">
    <label for="media-client-select">Client</label>
    <select id="media-client-select">
      <option value="">Select a client...</option>
    </select>
  </div>
  <div id="auth-warning" style="display:none" class="empty-state">
    Google Drive not connected. <a href="/auth/google">Connect Google Drive</a>
  </div>
  <button id="scan-btn" class="btn btn-primary" disabled>Scan Drive Photos</button>
</div>

<div class="card" id="photos-section" style="display:none">
  <h2>Available Photos</h2>
  <p id="photos-count" class="page-subtitle"></p>
  <div id="photos-grid" class="photos-grid"></div>
  <button id="generate-btn" class="btn btn-primary">Generate Marketing Plan</button>
</div>

<div class="card" id="plan-section" style="display:none">
  <h2>Marketing Plan</h2>

  <div class="plan-block">
    <div class="plan-block-header">
      <h3>Selected Photos</h3>
    </div>
    <ul id="selected-photos-list" class="selected-photos-list"></ul>
  </div>

  <div class="plan-block">
    <div class="plan-block-header">
      <h3>Marketing Script</h3>
      <button class="btn btn-sm" onclick="copyToClipboard(document.getElementById('script-output').textContent)">Copy</button>
    </div>
    <p id="script-output" class="plan-output"></p>
  </div>

  <div class="plan-block">
    <div class="plan-block-header">
      <h3>Higgsfield Video Prompt</h3>
      <button class="btn btn-sm" onclick="copyToClipboard(document.getElementById('higgsfield-output').textContent)">Copy</button>
    </div>
    <p id="higgsfield-output" class="plan-output"></p>
  </div>

  <div class="plan-block">
    <div class="plan-block-header">
      <h3>Midjourney Image Prompt</h3>
      <button class="btn btn-sm" onclick="copyToClipboard(document.getElementById('midjourney-output').textContent)">Copy</button>
    </div>
    <p id="midjourney-output" class="plan-output"></p>
  </div>

  <button id="save-btn" class="btn btn-primary">Save to Drive &amp; History</button>
</div>

<div class="card" id="media-history-section" style="display:none">
  <h2>Past Media Jobs</h2>
  <div id="media-history-list"></div>
</div>

<script>
let scannedPhotos = [];
let currentPlan = null;
let currentClientId = null;

async function loadClients() {
  const res = await fetch('/api/clients');
  const clients = await res.json();
  const select = document.getElementById('media-client-select');
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

document.getElementById('media-client-select').addEventListener('change', function () {
  currentClientId = this.value;
  document.getElementById('scan-btn').disabled = !currentClientId;
  document.getElementById('photos-section').style.display = 'none';
  document.getElementById('plan-section').style.display = 'none';
  if (currentClientId) loadHistory(currentClientId);
});

document.getElementById('scan-btn').addEventListener('click', async function () {
  this.disabled = true;
  this.textContent = 'Scanning...';
  document.getElementById('photos-section').style.display = 'none';
  document.getElementById('auth-warning').style.display = 'none';
  try {
    const res = await fetch(`/api/drive/scan/${currentClientId}`);
    if (res.status === 401) { document.getElementById('auth-warning').style.display = 'block'; return; }
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Scan failed'); return; }
    scannedPhotos = data.photos;
    const grid = document.getElementById('photos-grid');
    grid.innerHTML = scannedPhotos.length === 0
      ? '<p class="empty-state">No new photos available.</p>'
      : scannedPhotos.map(p => `<div class="photo-card"><p class="photo-name">${p.name}</p><p class="photo-date">${p.modifiedTime.split('T')[0]}</p></div>`).join('');
    document.getElementById('photos-count').textContent = `${scannedPhotos.length} new photo${scannedPhotos.length !== 1 ? 's' : ''} found`;
    document.getElementById('photos-section').style.display = 'block';
    if (data.message) showToast(data.message);
  } catch (err) {
    showToast('Scan failed: ' + err.message);
  } finally {
    this.disabled = false;
    this.textContent = 'Scan Drive Photos';
  }
});

document.getElementById('generate-btn').addEventListener('click', async function () {
  this.disabled = true;
  this.textContent = 'Generating...';
  try {
    const res = await fetch('/api/media/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: currentClientId, photos: scannedPhotos }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Generation failed'); return; }
    currentPlan = data.plan;
    document.getElementById('selected-photos-list').innerHTML =
      (data.plan.selectedPhotos || []).map(p => `<li><strong>${p.name}</strong> — ${p.reason}</li>`).join('');
    document.getElementById('script-output').textContent = data.plan.script;
    document.getElementById('higgsfield-output').textContent = data.plan.higgsfieldPrompt;
    document.getElementById('midjourney-output').textContent = data.plan.midjourneyPrompt;
    document.getElementById('plan-section').style.display = 'block';
  } catch (err) {
    showToast('Generation failed: ' + err.message);
  } finally {
    this.disabled = false;
    this.textContent = 'Generate Marketing Plan';
  }
});

document.getElementById('save-btn').addEventListener('click', async function () {
  this.disabled = true;
  this.textContent = 'Saving...';
  try {
    const res = await fetch('/api/media/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: currentClientId, plan: currentPlan }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Save failed'); return; }
    showToast('Saved to Drive and history');
    loadHistory(currentClientId);
  } catch (err) {
    showToast('Save failed: ' + err.message);
  } finally {
    this.disabled = false;
    this.textContent = 'Save to Drive & History';
  }
});

async function loadHistory(clientId) {
  const res = await fetch(`/api/media/history/${clientId}`);
  const data = await res.json();
  const section = document.getElementById('media-history-section');
  const list = document.getElementById('media-history-list');
  if (!data.jobs || data.jobs.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = data.jobs.map(job => `
    <div class="history-item">
      <p class="history-date">${job.created_at.split(' ')[0]}</p>
      <p><strong>Script:</strong> ${job.script}</p>
      <p><strong>Higgsfield:</strong> ${job.higgsfield_prompt}</p>
      <p><strong>Midjourney:</strong> ${job.midjourney_prompt}</p>
    </div>`).join('');
}

loadClients();
</script>
```

- [ ] **Step 6: Add CSS to styles.css**

Read `public/styles.css` to confirm existing CSS variable names (e.g. `--bg-secondary`, `--border`), then append:

```css
.photos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.photo-card {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 10px;
  text-align: center;
}

.photo-name { font-size: 12px; font-weight: 500; word-break: break-word; margin: 0 0 4px; }
.photo-date { font-size: 11px; color: var(--text-muted); margin: 0; }

.plan-block { margin-bottom: 24px; }

.plan-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.plan-block-header h3 { margin: 0; font-size: 14px; font-weight: 600; }

.plan-output {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  margin: 0;
}

.selected-photos-list { margin: 0 0 8px; padding-left: 20px; font-size: 13px; line-height: 1.7; }

.history-item {
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
  font-size: 13px;
  line-height: 1.5;
}
.history-item:last-child { border-bottom: none; }
.history-date { font-weight: 600; margin: 0 0 6px; font-size: 12px; color: var(--text-muted); }

.btn-sm { font-size: 12px; padding: 4px 10px; }
```

- [ ] **Step 7: Run all tests**

```bash
DB_PATH=:memory: npm test
```
Expected: All tests PASS.

- [ ] **Step 8: Manual test in browser**

1. Restart server: kill port 3000 and `npm start`
2. Open `http://localhost:3000`
3. Verify "Media" appears in sidebar
4. Clients page → add a client with Drive folder URLs → verify fields save and pre-fill on edit
5. Media page → select that client → click Scan → verify auth redirect if not connected
6. After Google auth, return to Media → scan → verify photo grid appears
7. Click Generate → verify script, prompts, and selected photos list appear with copy buttons
8. Click Save → verify toast and history section appear

- [ ] **Step 9: Commit**

```bash
git add public/pages/media.html public/pages/clients.html public/index.html public/app.js public/styles.css
git commit -m "feat: add Media page, Drive URL fields on client form, nav item"
```
