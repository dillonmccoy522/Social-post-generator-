# AIOS Dashboard Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the live Niewdel social-dashboard into the AIOS command center: password gate, visual-assets tracking with Google Drive integration, Home/Create/Assets pages.

**Architecture:** Same stack as existing app — Express + better-sqlite3 backend with vanilla-JS SPA fragments. New `assets` table mirrors the `posts` pattern. Google Drive is the media store (source Drives read-only for the picker; one output Drive for everything generated); the DB stores only metadata + Drive links. Auth is a single shared password issuing an HMAC-signed cookie, with a bearer token for programmatic (Claude session) access.

**Tech Stack:** Node ≥18 (global `fetch` available), Express 4, better-sqlite3, googleapis (new dep), Jest + Supertest, vanilla HTML/CSS/JS frontend (no framework, no build step).

**Spec:** `docs/superpowers/specs/2026-07-10-aios-dashboard-design.md`

## Global Constraints

- CommonJS (`require`) everywhere — no ESM in this repo
- No frontend framework, no build step; pages are HTML fragments in `public/pages/` loaded by `public/app.js`; inline `<script>` executed via `new Function`
- All user-rendered strings go through the `esc()` helper (XSS) — copy the pattern from `public/pages/clients.html`
- Dark theme: reuse CSS variables from `public/styles.css` (`--bg`, `--surface`, `--accent: #C84B31`, etc.); classes `card`, `btn`, `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-danger`, `btn-sm`, `badge`, `page-title`, `page-subtitle`, `section-label`, `empty-state`, `form-row`
- Tests: `npx jest tests/<file> --runInBand` per task; full suite `npm test` must stay green (27 existing tests)
- Auth must be OFF when `DASHBOARD_PASSWORD` is unset so existing tests and local dev keep working; auth middleware reads env at request time, not module load
- Never commit `.env`; new env vars: `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `API_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `OUTPUT_DRIVE_FOLDER_ID`
- Commit messages follow existing `feat:` / `fix:` convention and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

| Path | Responsibility |
|---|---|
| `middleware/auth.js` (new) | Session-cookie + bearer-token gate for `/api/*` |
| `routes/auth.js` (new) | `POST /api/login`, `GET /api/me` |
| `routes/assets.js` (new) | Assets CRUD API |
| `routes/stats.js` (new) | `GET /api/stats` for Home page |
| `routes/drive.js` (new) | `GET /api/drive/browse` picker endpoint |
| `services/drive.js` (new) | googleapis wrapper: browse, ensureFolder, uploadFromUrl |
| `scripts/google-oauth.js` (new) | One-time local flow to mint `GOOGLE_REFRESH_TOKEN` |
| `database.js` (modify) | `assets` table schema + helpers + stats queries |
| `server.js` (modify) | Mount auth middleware + new routers |
| `public/index.html` (modify) | Sidebar: Home/Clients/Create/Assets/History |
| `public/app.js` (modify) | New pages map, default `home`, 401 redirect |
| `public/login.html` (new) | Standalone login page |
| `public/pages/home.html` (new) | Live stats + activity feed |
| `public/pages/create.html` (new) | Client → Drive photo picker → prompt → queue |
| `public/pages/assets.html` (new) | Filterable gallery + status actions |
| `tests/auth.test.js`, `tests/assets-db.test.js`, `tests/assets.test.js`, `tests/stats.test.js`, `tests/drive.test.js` (new) | Per-task test suites |

---

### Task 1: Auth — login route, session cookie, API token

**Files:**
- Create: `middleware/auth.js`, `routes/auth.js`, `tests/auth.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: middleware `requireAuth(req, res, next)`; `POST /api/login {password}` → 204 + `Set-Cookie: session=<hmac>`; `GET /api/me` → `{ok:true}` when authed (or auth disabled); helper `sessionToken()` exported from `middleware/auth.js` for tests.
- Auth rules: disabled entirely when `!process.env.DASHBOARD_PASSWORD`. Public paths: `/api/health`, `/api/login`. `Authorization: Bearer <API_TOKEN>` passes when `API_TOKEN` set. Everything else under `/api/` needs the cookie. Non-`/api` paths are never blocked (static shell is public; data is not).

- [ ] **Step 1: Write the failing tests**

`tests/auth.test.js`:
```js
process.env.DB_PATH = ':memory:';
process.env.DASHBOARD_PASSWORD = 'test-password';
process.env.SESSION_SECRET = 'test-secret';
process.env.API_TOKEN = 'test-api-token';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());
afterAll(() => {
  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.SESSION_SECRET;
  delete process.env.API_TOKEN;
});

test('GET /api/clients without auth returns 401', async () => {
  const res = await request(app).get('/api/clients');
  expect(res.status).toBe(401);
});

test('GET /api/health is public', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
});

test('POST /api/login with wrong password returns 401', async () => {
  const res = await request(app).post('/api/login').send({ password: 'nope' });
  expect(res.status).toBe(401);
});

test('POST /api/login with correct password sets session cookie', async () => {
  const res = await request(app).post('/api/login').send({ password: 'test-password' });
  expect(res.status).toBe(204);
  expect(res.headers['set-cookie'][0]).toMatch(/^session=/);
});

test('cookie from login grants API access', async () => {
  const login = await request(app).post('/api/login').send({ password: 'test-password' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const res = await request(app).get('/api/clients').set('Cookie', cookie);
  expect(res.status).toBe(200);
});

test('bearer API token grants access', async () => {
  const res = await request(app).get('/api/clients').set('Authorization', 'Bearer test-api-token');
  expect(res.status).toBe(200);
});

test('GET /api/me returns ok when authed', async () => {
  const login = await request(app).post('/api/login').send({ password: 'test-password' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const res = await request(app).get('/api/me').set('Cookie', cookie);
  expect(res.body).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/auth.test.js --runInBand`
Expected: FAIL — `/api/login` 404s and `/api/clients` returns 200 instead of 401 (middleware doesn't exist yet).

- [ ] **Step 3: Implement middleware and routes**

`middleware/auth.js`:
```js
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
```

`routes/auth.js`:
```js
const express = require('express');
const router = express.Router();
const { sessionToken } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.DASHBOARD_PASSWORD || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.setHeader(
    'Set-Cookie',
    `session=${sessionToken()}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`
  );
  res.status(204).send();
});

router.get('/me', (_req, res) => res.json({ ok: true }));

module.exports = router;
```

`server.js` — add after `app.use(express.json());` and before the static middleware:
```js
const { requireAuth } = require('./middleware/auth');
const authRouter = require('./routes/auth');

app.use(requireAuth);
app.use('/api', authRouter);
```
(`/api/login` must be reachable, and it is: `requireAuth` whitelists it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/auth.test.js --runInBand`
Expected: 7 tests PASS.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all suites pass — existing tests don't set `DASHBOARD_PASSWORD`, and `tests/auth.test.js` cleans up its env in `afterAll`. (Jest `--runInBand` shares the process; the cleanup matters.)

- [ ] **Step 6: Commit**

```bash
git add middleware/auth.js routes/auth.js tests/auth.test.js server.js
git commit -m "feat: password gate with session cookie and API bearer token

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `assets` table + database helpers

**Files:**
- Modify: `database.js`
- Create: `tests/assets-db.test.js`

**Interfaces:**
- Produces (exported from `database.js`):
  - `createAsset({ client_id, campaign?, type, status?, prompt?, model?, source_drive_file_id?, output_drive_file_id?, output_drive_url?, thumbnail_url?, higgsfield_job_id? })` → asset row
  - `getAssets({ clientId?, status?, campaign? })` → rows joined with `clients.name AS client_name`, newest first
  - `getAssetById(id)` → row or undefined
  - `updateAsset(id, fields)` → updated row (allowed keys: `campaign, status, prompt, model, source_drive_file_id, output_drive_file_id, output_drive_url, thumbnail_url, higgsfield_job_id, error`)
  - `deleteAsset(id)`
- Valid `type`: `'image' | 'video'`. Valid `status`: `'queued' | 'generating' | 'failed' | 'draft' | 'approved' | 'posted'` (default `'draft'`).

- [ ] **Step 1: Write the failing tests**

`tests/assets-db.test.js`:
```js
process.env.DB_PATH = ':memory:';
const db = require('../database');

afterEach(() => db.closeDb());

function makeClient() {
  return db.createClient({ name: 'Acme Roofing', business_type: 'Roofing', location: 'SA, TX', brand_voice: '' });
}

test('createAsset inserts with defaults', () => {
  const c = makeClient();
  const a = db.createAsset({ client_id: c.id, type: 'image', prompt: 'roof hero shot' });
  expect(a.id).toBeDefined();
  expect(a.status).toBe('draft');
  expect(a.campaign).toBe('');
});

test('getAssets filters by clientId, status, campaign', () => {
  const c = makeClient();
  db.createAsset({ client_id: c.id, type: 'image', status: 'queued', campaign: 'summer' });
  db.createAsset({ client_id: c.id, type: 'video', status: 'approved', campaign: 'summer' });
  expect(db.getAssets({})).toHaveLength(2);
  expect(db.getAssets({ status: 'queued' })).toHaveLength(1);
  expect(db.getAssets({ campaign: 'summer', status: 'approved' })[0].type).toBe('video');
  expect(db.getAssets({ clientId: c.id })[0].client_name).toBe('Acme Roofing');
});

test('updateAsset updates allowed fields only', () => {
  const c = makeClient();
  const a = db.createAsset({ client_id: c.id, type: 'image' });
  const updated = db.updateAsset(a.id, { status: 'approved', thumbnail_url: 'https://x/y.jpg', bogus: 'ignored' });
  expect(updated.status).toBe('approved');
  expect(updated.thumbnail_url).toBe('https://x/y.jpg');
  expect(updated.bogus).toBeUndefined();
});

test('deleteAsset removes row; cascade on client delete', () => {
  const c = makeClient();
  const a = db.createAsset({ client_id: c.id, type: 'image' });
  db.deleteAsset(a.id);
  expect(db.getAssetById(a.id)).toBeUndefined();
  const b = db.createAsset({ client_id: c.id, type: 'image' });
  db.deleteClient(c.id);
  expect(db.getAssetById(b.id)).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/assets-db.test.js --runInBand`
Expected: FAIL with `db.createAsset is not a function`.

- [ ] **Step 3: Implement schema + helpers in `database.js`**

Append inside `initSchema`'s `db.exec` template string (after the `posts` table; note `PRAGMA foreign_keys` must be on for cascade — better-sqlite3 has it off by default):
```sql
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('image','video')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('queued','generating','failed','draft','approved','posted')),
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  source_drive_file_id TEXT DEFAULT NULL,
  output_drive_file_id TEXT DEFAULT NULL,
  output_drive_url TEXT DEFAULT NULL,
  thumbnail_url TEXT DEFAULT NULL,
  higgsfield_job_id TEXT DEFAULT NULL,
  error TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```
In `getDb()` after `db.pragma('journal_mode = WAL');` add:
```js
db.pragma('foreign_keys = ON');
```
Helper functions (add before `module.exports`, and add all five names to `module.exports`):
```js
const ASSET_UPDATE_FIELDS = ['campaign', 'status', 'prompt', 'model', 'source_drive_file_id',
  'output_drive_file_id', 'output_drive_url', 'thumbnail_url', 'higgsfield_job_id', 'error'];

function createAsset({ client_id, campaign = '', type, status = 'draft', prompt = '', model = '',
  source_drive_file_id = null, output_drive_file_id = null, output_drive_url = null,
  thumbnail_url = null, higgsfield_job_id = null }) {
  const stmt = getDb().prepare(`
    INSERT INTO assets (client_id, campaign, type, status, prompt, model, source_drive_file_id,
      output_drive_file_id, output_drive_url, thumbnail_url, higgsfield_job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(client_id, campaign, type, status, prompt, model, source_drive_file_id,
    output_drive_file_id, output_drive_url, thumbnail_url, higgsfield_job_id);
  return getAssetById(result.lastInsertRowid);
}

function getAssetById(id) {
  return getDb().prepare(`
    SELECT assets.*, clients.name AS client_name
    FROM assets JOIN clients ON assets.client_id = clients.id
    WHERE assets.id = ?
  `).get(id);
}

function getAssets({ clientId, status, campaign } = {}) {
  const where = [];
  const params = [];
  if (clientId) { where.push('assets.client_id = ?'); params.push(clientId); }
  if (status) { where.push('assets.status = ?'); params.push(status); }
  if (campaign) { where.push('assets.campaign = ?'); params.push(campaign); }
  return getDb().prepare(`
    SELECT assets.*, clients.name AS client_name
    FROM assets JOIN clients ON assets.client_id = clients.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY assets.created_at DESC, assets.id DESC
  `).all(...params);
}

function updateAsset(id, fields) {
  const keys = Object.keys(fields).filter(k => ASSET_UPDATE_FIELDS.includes(k));
  if (keys.length === 0) return getAssetById(id);
  const set = keys.map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE assets SET ${set} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
  return getAssetById(id);
}

function deleteAsset(id) {
  getDb().prepare('DELETE FROM assets WHERE id = ?').run(id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/assets-db.test.js --runInBand`
Expected: 4 tests PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm test` — all pass. Then:
```bash
git add database.js tests/assets-db.test.js
git commit -m "feat: assets table with CRUD helpers and client cascade

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Assets API routes

**Files:**
- Create: `routes/assets.js`, `tests/assets.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `db.createAsset/getAssets/getAssetById/updateAsset/deleteAsset` (Task 2)
- Produces: `GET /api/assets?clientId&status&campaign`, `POST /api/assets` (requires `client_id`+`type`; validates enums and client existence), `PATCH /api/assets/:id`, `DELETE /api/assets/:id`

- [ ] **Step 1: Write the failing tests**

`tests/assets.test.js`:
```js
process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

async function makeClient() {
  const res = await request(app).post('/api/clients').send({
    name: 'Acme', business_type: 'Roofing', location: 'SA, TX',
  });
  return res.body;
}

test('POST /api/assets creates queued asset', async () => {
  const c = await makeClient();
  const res = await request(app).post('/api/assets').send({
    client_id: c.id, type: 'image', status: 'queued', prompt: 'hero shot', campaign: 'launch',
  });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('queued');
  expect(res.body.client_name).toBe('Acme');
});

test('POST /api/assets 400 on missing type / bad enums / unknown client', async () => {
  const c = await makeClient();
  expect((await request(app).post('/api/assets').send({ client_id: c.id })).status).toBe(400);
  expect((await request(app).post('/api/assets').send({ client_id: c.id, type: 'gif' })).status).toBe(400);
  expect((await request(app).post('/api/assets').send({ client_id: c.id, type: 'image', status: 'nope' })).status).toBe(400);
  expect((await request(app).post('/api/assets').send({ client_id: 999, type: 'image' })).status).toBe(400);
});

test('GET /api/assets filters by status', async () => {
  const c = await makeClient();
  await request(app).post('/api/assets').send({ client_id: c.id, type: 'image', status: 'queued' });
  await request(app).post('/api/assets').send({ client_id: c.id, type: 'video' });
  const res = await request(app).get('/api/assets?status=queued');
  expect(res.body).toHaveLength(1);
  expect(res.body[0].type).toBe('image');
});

test('PATCH /api/assets/:id updates status; rejects bad status; 404 unknown', async () => {
  const c = await makeClient();
  const created = await request(app).post('/api/assets').send({ client_id: c.id, type: 'image' });
  const ok = await request(app).patch(`/api/assets/${created.body.id}`).send({ status: 'approved' });
  expect(ok.status).toBe(200);
  expect(ok.body.status).toBe('approved');
  expect((await request(app).patch(`/api/assets/${created.body.id}`).send({ status: 'bogus' })).status).toBe(400);
  expect((await request(app).patch('/api/assets/9999').send({ status: 'draft' })).status).toBe(404);
});

test('DELETE /api/assets/:id removes; 404 unknown', async () => {
  const c = await makeClient();
  const created = await request(app).post('/api/assets').send({ client_id: c.id, type: 'image' });
  expect((await request(app).delete(`/api/assets/${created.body.id}`)).status).toBe(204);
  expect((await request(app).delete('/api/assets/9999')).status).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/assets.test.js --runInBand`
Expected: FAIL — 404s (router not mounted).

- [ ] **Step 3: Implement `routes/assets.js` and mount**

`routes/assets.js`:
```js
const express = require('express');
const router = express.Router();
const db = require('../database');

const TYPES = ['image', 'video'];
const STATUSES = ['queued', 'generating', 'failed', 'draft', 'approved', 'posted'];

router.get('/', (req, res) => {
  const { clientId, status, campaign } = req.query;
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  res.json(db.getAssets({ clientId: clientId ? Number(clientId) : undefined, status, campaign }));
});

router.post('/', (req, res) => {
  const { client_id, type, status = 'draft' } = req.body;
  if (!client_id || !type) return res.status(400).json({ error: 'client_id and type are required' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}` });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  if (!db.getClientById(Number(client_id))) return res.status(400).json({ error: 'client not found' });
  const asset = db.createAsset({ ...req.body, client_id: Number(client_id) });
  res.status(201).json(asset);
});

router.patch('/:id', (req, res) => {
  const existing = db.getAssetById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  if (req.body.status && !STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  res.json(db.updateAsset(Number(req.params.id), req.body));
});

router.delete('/:id', (req, res) => {
  const existing = db.getAssetById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  db.deleteAsset(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;
```

`server.js` — with the other route mounts:
```js
const assetsRouter = require('./routes/assets');
app.use('/api/assets', assetsRouter);
```

- [ ] **Step 4: Run tests, full suite, commit**

Run: `npx jest tests/assets.test.js --runInBand` → 5 PASS. `npm test` → green.
```bash
git add routes/assets.js tests/assets.test.js server.js
git commit -m "feat: assets CRUD API with enum and client validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Stats API for Home page

**Files:**
- Modify: `database.js`
- Create: `routes/stats.js`, `tests/stats.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: existing `posts`/`clients` tables, `assets` (Task 2)
- Produces: `GET /api/stats` →
  ```json
  {
    "clients": 2,
    "postsThisWeek": 1,
    "assetsByStatus": { "queued": 1, "draft": 3, "approved": 0, "posted": 0, "generating": 0, "failed": 0 },
    "recentActivity": [ { "kind": "asset", "client_name": "Acme", "label": "image · launch", "created_at": "..." } ]
  }
  ```
- db helper `getStats()` exported from `database.js` returning exactly that shape (activity = last 10 of posts+assets combined).

- [ ] **Step 1: Write the failing tests**

`tests/stats.test.js`:
```js
process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

test('GET /api/stats returns zeroed shape when empty', async () => {
  const res = await request(app).get('/api/stats');
  expect(res.status).toBe(200);
  expect(res.body.clients).toBe(0);
  expect(res.body.postsThisWeek).toBe(0);
  expect(res.body.assetsByStatus.draft).toBe(0);
  expect(res.body.recentActivity).toEqual([]);
});

test('GET /api/stats counts and orders activity', async () => {
  const c = db.createClient({ name: 'Acme', business_type: 'Roofing', location: 'SA', brand_voice: '' });
  db.createPost({ clientId: c.id, weekOf: '2026-07-06', photoDescriptions: '[]', generatedContent: 'hi' });
  db.createAsset({ client_id: c.id, type: 'image', status: 'queued', campaign: 'launch' });
  const res = await request(app).get('/api/stats');
  expect(res.body.clients).toBe(1);
  expect(res.body.postsThisWeek).toBe(1);
  expect(res.body.assetsByStatus.queued).toBe(1);
  expect(res.body.recentActivity).toHaveLength(2);
  expect(res.body.recentActivity[0].client_name).toBe('Acme');
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx jest tests/stats.test.js --runInBand` → 404.

- [ ] **Step 3: Implement**

Add to `database.js` (export `getStats`):
```js
function getStats() {
  const d = getDb();
  const clients = d.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const postsThisWeek = d.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE created_at >= datetime('now', '-7 days')"
  ).get().n;
  const assetsByStatus = { queued: 0, generating: 0, failed: 0, draft: 0, approved: 0, posted: 0 };
  for (const row of d.prepare('SELECT status, COUNT(*) AS n FROM assets GROUP BY status').all()) {
    assetsByStatus[row.status] = row.n;
  }
  const recentActivity = d.prepare(`
    SELECT * FROM (
      SELECT 'post' AS kind, clients.name AS client_name,
             'text posts · week of ' || posts.week_of AS label, posts.created_at
      FROM posts JOIN clients ON posts.client_id = clients.id
      UNION ALL
      SELECT 'asset' AS kind, clients.name AS client_name,
             assets.type || CASE WHEN assets.campaign != '' THEN ' · ' || assets.campaign ELSE '' END AS label,
             assets.created_at
      FROM assets JOIN clients ON assets.client_id = clients.id
    ) ORDER BY created_at DESC LIMIT 10
  `).all();
  return { clients, postsThisWeek, assetsByStatus, recentActivity };
}
```

`routes/stats.js`:
```js
const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (_req, res) => res.json(db.getStats()));

module.exports = router;
```

`server.js`: `app.use('/api/stats', require('./routes/stats'));`

- [ ] **Step 4: PASS + full suite + commit**

```bash
git add database.js routes/stats.js tests/stats.test.js server.js
git commit -m "feat: stats endpoint for home page metrics and activity feed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Google Drive service + browse endpoint + OAuth script

**Files:**
- Create: `services/drive.js`, `routes/drive.js`, `scripts/google-oauth.js`, `tests/drive.test.js`
- Modify: `server.js`, `.env.example`, `package.json` (dependency)

**Interfaces:**
- Consumes: env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `OUTPUT_DRIVE_FOLDER_ID`
- Produces (from `services/drive.js`):
  - `isConfigured()` → boolean (all three Google env vars present)
  - `browse(folderId = 'root')` → `[{ id, name, mimeType, thumbnailLink, webViewLink }]` (folders + images + videos only)
  - `ensureFolder(name, parentId)` → folder id (find-or-create)
  - `uploadFromUrl(url, filename, clientName, campaign)` → `{ id, webViewLink, thumbnailLink }` — downloads media, uploads into `OUTPUT_DRIVE_FOLDER_ID/<clientName>/<campaign>/`
- Produces route: `GET /api/drive/browse?folderId=` → file list, or **503 `{ error: 'Google Drive not configured' }`** when `!isConfigured()` (frontend shows a banner on 503)

- [ ] **Step 1: Install dependency**

Run: `npm install googleapis`
Expected: added to `package.json` dependencies.

- [ ] **Step 2: Write the failing tests (service mocked at googleapis level)**

`tests/drive.test.js`:
```js
process.env.DB_PATH = ':memory:';

const mockList = jest.fn();
const mockCreate = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    drive: jest.fn(() => ({ files: { list: mockList, create: mockCreate } })),
  },
}));

const request = require('supertest');
const app = require('../server');
const db = require('../database');
const drive = require('../services/drive');

afterEach(() => {
  db.closeDb();
  jest.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

function configure() {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
}

test('GET /api/drive/browse returns 503 when not configured', async () => {
  const res = await request(app).get('/api/drive/browse');
  expect(res.status).toBe(503);
});

test('browse returns only folders, images, and videos', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [
    { id: '1', name: 'Folder', mimeType: 'application/vnd.google-apps.folder' },
    { id: '2', name: 'pic.jpg', mimeType: 'image/jpeg', thumbnailLink: 't' },
    { id: '3', name: 'doc.pdf', mimeType: 'application/pdf' },
    { id: '4', name: 'clip.mp4', mimeType: 'video/mp4' },
  ] } });
  const files = await drive.browse('root');
  expect(files.map(f => f.id)).toEqual(['1', '2', '4']);
});

test('GET /api/drive/browse returns files when configured', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [
    { id: '2', name: 'pic.jpg', mimeType: 'image/jpeg', thumbnailLink: 't' },
  ] } });
  const res = await request(app).get('/api/drive/browse?folderId=abc');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
    q: "'abc' in parents and trashed = false",
  }));
});

test('ensureFolder returns existing folder id without creating', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [{ id: 'existing', name: 'Acme' }] } });
  const id = await drive.ensureFolder('Acme', 'root-id');
  expect(id).toBe('existing');
  expect(mockCreate).not.toHaveBeenCalled();
});

test('ensureFolder creates when missing', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'new-folder' } });
  const id = await drive.ensureFolder('Acme', 'root-id');
  expect(id).toBe('new-folder');
});
```

- [ ] **Step 3: Run to verify FAIL** — `npx jest tests/drive.test.js --runInBand` → cannot find `../services/drive`.

- [ ] **Step 4: Implement `services/drive.js`**

```js
const { google } = require('googleapis');
const { Readable } = require('stream');

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

function getDrive() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

const FILE_FIELDS = 'files(id, name, mimeType, thumbnailLink, webViewLink)';

function isMedia(f) {
  return f.mimeType === 'application/vnd.google-apps.folder'
    || f.mimeType.startsWith('image/')
    || f.mimeType.startsWith('video/');
}

async function browse(folderId = 'root') {
  const { data } = await getDrive().files.list({
    q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`,
    fields: FILE_FIELDS,
    pageSize: 200,
    orderBy: 'folder,name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (data.files || []).filter(isMedia);
}

async function ensureFolder(name, parentId) {
  const drive = getDrive();
  const escaped = name.replace(/'/g, "\\'");
  const { data } = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (data.files && data.files.length > 0) return data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function uploadFromUrl(url, filename, clientName, campaign) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';

  const root = process.env.OUTPUT_DRIVE_FOLDER_ID;
  if (!root) throw new Error('OUTPUT_DRIVE_FOLDER_ID is not set');
  const clientFolder = await ensureFolder(clientName, root);
  const parent = campaign ? await ensureFolder(campaign, clientFolder) : clientFolder;

  const created = await getDrive().files.create({
    requestBody: { name: filename, parents: [parent] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink, thumbnailLink',
    supportsAllDrives: true,
  });
  return created.data;
}

module.exports = { isConfigured, browse, ensureFolder, uploadFromUrl };
```

`routes/drive.js`:
```js
const express = require('express');
const router = express.Router();
const drive = require('../services/drive');

router.get('/browse', async (req, res) => {
  if (!drive.isConfigured()) {
    return res.status(503).json({ error: 'Google Drive not configured' });
  }
  try {
    res.json(await drive.browse(req.query.folderId || 'root'));
  } catch (err) {
    res.status(502).json({ error: `Drive error: ${err.message}` });
  }
});

module.exports = router;
```

`server.js`: `app.use('/api/drive', require('./routes/drive'));`

Append to `.env.example`:
```
DASHBOARD_PASSWORD=
SESSION_SECRET=
API_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
OUTPUT_DRIVE_FOLDER_ID=
```

- [ ] **Step 5: Implement `scripts/google-oauth.js`** (one-time token mint; run locally: `node scripts/google-oauth.js`)

```js
require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');
const { exec } = require('child_process');

const PORT = 53682;
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
  scope: ['https://www.googleapis.com/auth/drive'],
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
  console.log('Opening Google consent screen — sign in with the account that can see both Drives...');
  exec(`open "${authUrl}"`);
});
```

- [ ] **Step 6: Run tests, full suite, commit**

Run: `npx jest tests/drive.test.js --runInBand` → 5 PASS. `npm test` → green.
```bash
git add services/drive.js routes/drive.js scripts/google-oauth.js tests/drive.test.js server.js .env.example package.json package-lock.json
git commit -m "feat: google drive service with browse endpoint and oauth mint script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Sidebar rework + login page + Home page

**Files:**
- Modify: `public/index.html`, `public/app.js`
- Create: `public/login.html`, `public/pages/home.html`

**Interfaces:**
- Consumes: `GET /api/stats` (Task 4), `GET /api/me` + `POST /api/login` (Task 1)
- Produces: nav order Home / Clients / Create / Assets / History; default page `home`; global 401 → redirect to `/login.html`

- [ ] **Step 1: Update `public/index.html` nav** — replace the existing `<nav class="sidebar-nav">` block:

```html
<nav class="sidebar-nav">
  <a href="#" class="nav-item" data-page="home"><span class="nav-icon">🏠</span>Home</a>
  <a href="#" class="nav-item" data-page="clients"><span class="nav-icon">👤</span>Clients</a>
  <a href="#" class="nav-item" data-page="create"><span class="nav-icon">✨</span>Create</a>
  <a href="#" class="nav-item" data-page="assets"><span class="nav-icon">🖼️</span>Assets</a>
  <a href="#" class="nav-item" data-page="generate"><span class="nav-icon">⚡</span>Posts</a>
  <a href="#" class="nav-item" data-page="history"><span class="nav-icon">📋</span>History</a>
</nav>
```
(Existing text-post page stays, relabeled "Posts".)

- [ ] **Step 2: Update `public/app.js`** — extend the pages map, switch the default, add auth check at the bottom:

```js
const pages = {
  home: '/pages/home.html',
  clients: '/pages/clients.html',
  create: '/pages/create.html',
  assets: '/pages/assets.html',
  generate: '/pages/generate.html',
  history: '/pages/history.html',
};
```
Replace `loadPage('clients');` at the bottom with:
```js
fetch('/api/me').then(r => {
  if (r.status === 401) { location.href = '/login.html'; return; }
  loadPage('home');
});
```

- [ ] **Step 3: Create `public/login.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Niewdel — Sign in</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { display: flex; align-items: center; justify-content: center; }
    .login-box { width: 340px; }
  </style>
</head>
<body>
  <div class="login-box card">
    <div class="sidebar-logo" style="margin-bottom:16px;">Niewdel</div>
    <label>Password</label>
    <input type="password" id="password" autofocus />
    <button class="btn btn-primary" id="login-btn" style="width:100%;margin-top:12px;">Sign in</button>
    <div id="login-error" style="color:var(--accent);font-size:12.5px;margin-top:10px;display:none;">Wrong password.</div>
  </div>
  <script>
    async function login() {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('password').value }),
      });
      if (res.ok) { location.href = '/'; }
      else { document.getElementById('login-error').style.display = 'block'; }
    }
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  </script>
</body>
</html>
```

- [ ] **Step 4: Create `public/pages/home.html`**

```html
<div>
  <div style="margin-bottom:36px;">
    <div class="page-title">Home</div>
    <div class="page-subtitle">Niewdel content operations at a glance.</div>
  </div>

  <div class="form-row" style="margin-bottom:24px;" id="stat-cards">
    <div class="card"><div class="section-label">Active clients</div><div style="font-size:28px;font-weight:600;" id="stat-clients">—</div></div>
    <div class="card"><div class="section-label">Posts this week</div><div style="font-size:28px;font-weight:600;" id="stat-posts">—</div></div>
    <div class="card"><div class="section-label">Assets awaiting review</div><div style="font-size:28px;font-weight:600;" id="stat-draft">—</div></div>
    <div class="card"><div class="section-label">Queued generations</div><div style="font-size:28px;font-weight:600;" id="stat-queued">—</div></div>
  </div>

  <div class="card" style="margin-bottom:24px;">
    <div class="section-label">Recent activity</div>
    <div id="activity"><div class="empty-state">Loading…</div></div>
  </div>

  <div class="form-row">
    <div class="card">
      <div class="section-label">Current priorities</div>
      <div style="color:var(--text-secondary);font-size:13px;line-height:1.8;">
        1. Client acquisition — pipeline &amp; outreach<br />
        2. Service delivery — premium work for current clients<br />
        3. Systems — build the AIOS so delivery scales
      </div>
    </div>
    <div class="card">
      <div class="section-label">Team</div>
      <div style="color:var(--text-secondary);font-size:13px;line-height:1.8;">
        Dillon McCoy — Co-Founder, CGO<br />
        Leddy — Co-Founder, Operations
      </div>
    </div>
  </div>
</div>

<script>
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadStats() {
  const res = await fetch('/api/stats');
  if (!res.ok) return;
  const s = await res.json();
  document.getElementById('stat-clients').textContent = s.clients;
  document.getElementById('stat-posts').textContent = s.postsThisWeek;
  document.getElementById('stat-draft').textContent = s.assetsByStatus.draft;
  document.getElementById('stat-queued').textContent = s.assetsByStatus.queued + s.assetsByStatus.generating;

  const act = document.getElementById('activity');
  if (s.recentActivity.length === 0) {
    act.innerHTML = '<div class="empty-state">No activity yet. Generate something from the Create tab.</div>';
    return;
  }
  act.innerHTML = s.recentActivity.map(a => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <div><span class="badge" style="margin-right:8px;">${esc(a.kind)}</span>${esc(a.client_name)} — ${esc(a.label)}</div>
      <div style="color:var(--text-muted);">${esc((a.created_at || '').slice(0, 16))}</div>
    </div>
  `).join('');
}
loadStats();
</script>
```

- [ ] **Step 5: Manual verification**

Run: `npm start`, open http://localhost:3000
- Without `DASHBOARD_PASSWORD` in `.env`: lands on Home, stats show real numbers (2 clients).
- Add `DASHBOARD_PASSWORD=letmein` + `SESSION_SECRET=<random>` to `.env`, restart: reload → redirected to `/login.html`; wrong password shows error; right password lands on Home.
Expected: both flows work; nav shows all six items; Clients/Posts/History still function.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/login.html public/pages/home.html
git commit -m "feat: home page with live stats, login page, sidebar rework

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Assets gallery page

**Files:**
- Create: `public/pages/assets.html`

**Interfaces:**
- Consumes: `GET /api/assets?clientId&status`, `PATCH /api/assets/:id`, `DELETE /api/assets/:id`, `GET /api/clients`

- [ ] **Step 1: Create `public/pages/assets.html`**

```html
<div>
  <div style="margin-bottom:24px;">
    <div class="page-title">Assets</div>
    <div class="page-subtitle">Every visual generated for every client. Review, approve, mark as posted.</div>
  </div>

  <div style="display:flex;gap:10px;margin-bottom:20px;">
    <select id="filter-client"><option value="">All clients</option></select>
    <select id="filter-status">
      <option value="">All statuses</option>
      <option value="queued">Queued</option>
      <option value="generating">Generating</option>
      <option value="failed">Failed</option>
      <option value="draft">Draft</option>
      <option value="approved">Approved</option>
      <option value="posted">Posted</option>
    </select>
  </div>

  <div id="asset-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">
    <div class="empty-state">Loading assets…</div>
  </div>
</div>

<script>
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STATUS_ACTIONS = {
  draft: [['approved', 'Approve']],
  approved: [['posted', 'Mark posted'], ['draft', 'Back to draft']],
  posted: [['draft', 'Back to draft']],
  failed: [['queued', 'Retry (re-queue)']],
  queued: [],
  generating: [],
};

async function loadFilters() {
  const res = await fetch('/api/clients');
  const clients = await res.json();
  document.getElementById('filter-client').innerHTML =
    '<option value="">All clients</option>' +
    clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadAssets() {
  const clientId = document.getElementById('filter-client').value;
  const status = document.getElementById('filter-status').value;
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (status) params.set('status', status);
  const res = await fetch('/api/assets?' + params.toString());
  const assets = await res.json();
  const grid = document.getElementById('asset-grid');
  if (assets.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No assets match. Generate something from the Create tab.</div>';
    return;
  }
  grid.innerHTML = assets.map(a => `
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="height:140px;background:var(--surface-raised);display:flex;align-items:center;justify-content:center;">
        ${a.thumbnail_url
          ? `<img src="${esc(a.thumbnail_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
          : `<span style="font-size:32px;">${a.type === 'video' ? '🎬' : '🖼️'}</span>`}
      </div>
      <div style="padding:12px;">
        <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${esc(a.client_name)}</div>
        <div style="color:var(--text-muted);font-size:11.5px;margin-bottom:6px;">${esc(a.type)}${a.campaign ? ' · ' + esc(a.campaign) : ''}</div>
        <span class="badge">${esc(a.status)}</span>
        ${a.error ? `<div style="color:var(--accent);font-size:11.5px;margin-top:6px;">${esc(a.error)}</div>` : ''}
        ${a.prompt ? `<div style="color:var(--text-secondary);font-size:11.5px;margin-top:6px;max-height:44px;overflow:hidden;">${esc(a.prompt)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${(STATUS_ACTIONS[a.status] || []).map(([to, label]) =>
            `<button class="btn btn-secondary btn-sm" data-action="status" data-id="${a.id}" data-to="${to}">${label}</button>`).join('')}
          ${a.output_drive_url ? `<a class="btn btn-ghost btn-sm" href="${esc(a.output_drive_url)}" target="_blank" rel="noopener">Drive ↗</a>` : ''}
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${a.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('filter-client').addEventListener('change', loadAssets);
document.getElementById('filter-status').addEventListener('change', loadAssets);

document.getElementById('asset-grid').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'status') {
    const res = await fetch(`/api/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: btn.dataset.to }),
    });
    if (!res.ok) { showToast('Failed to update asset'); return; }
    showToast('Updated');
    loadAssets();
  } else if (btn.dataset.action === 'delete') {
    if (!confirm('Delete this asset record? (The file in Drive is not deleted.)')) return;
    const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Failed to delete'); return; }
    loadAssets();
  }
});

loadFilters();
loadAssets();
</script>
```

- [ ] **Step 2: Manual verification**

Run: `npm start`. Seed one asset via curl:
```bash
curl -X POST localhost:3000/api/assets -H 'Content-Type: application/json' \
  -d '{"client_id":1,"type":"image","status":"draft","prompt":"test asset","campaign":"smoke-test"}'
```
Open Assets tab. Expected: card renders with client name, badge `draft`, Approve button; Approve → badge flips to `approved` with "Mark posted" action; filters narrow correctly; Delete removes it.

- [ ] **Step 3: Commit**

```bash
git add public/pages/assets.html
git commit -m "feat: assets gallery with filters and status workflow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Create page (Drive picker + prompt → queue)

**Files:**
- Create: `public/pages/create.html`

**Interfaces:**
- Consumes: `GET /api/clients`, `GET /api/drive/browse?folderId=`, `POST /api/assets`
- Behavior: Generate button POSTs `{ client_id, campaign, type, prompt, model, source_drive_file_id, status: 'queued' }`. Queued assets are fulfilled by Claude/MCP sessions (Phase A bridge) or the platform API (Phase B).

- [ ] **Step 1: Create `public/pages/create.html`**

```html
<div>
  <div style="margin-bottom:24px;">
    <div class="page-title">Create</div>
    <div class="page-subtitle">Pick a client, grab a source photo from Drive, describe what you want. It lands in Assets when it's ready.</div>
  </div>

  <div class="card" style="max-width:720px;">
    <div class="form-row">
      <div>
        <label>Client</label>
        <select id="c-client"></select>
      </div>
      <div>
        <label>Campaign</label>
        <input type="text" id="c-campaign" placeholder="e.g. ceramic-coating-july" />
      </div>
    </div>

    <label>Source photo (optional)</label>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
      <button class="btn btn-secondary" id="pick-btn">Browse Drive…</button>
      <div id="picked" style="display:none;align-items:center;gap:8px;">
        <img id="picked-thumb" src="" alt="" style="height:44px;border-radius:6px;" />
        <span id="picked-name" style="font-size:12.5px;color:var(--text-secondary);"></span>
        <button class="btn btn-ghost btn-sm" id="clear-pick">✕</button>
      </div>
    </div>

    <label>Prompt — what should this look like?</label>
    <textarea id="c-prompt" placeholder="e.g. Turn this into a bold before/after style Instagram ad. Text hook: 'YOUR ROOF, 10 YEARS YOUNGER'. Brand: dependable, fair pricing."></textarea>

    <div class="form-row">
      <div>
        <label>Type</label>
        <select id="c-type">
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </div>
      <div>
        <label>Aspect ratio</label>
        <select id="c-aspect">
          <option value="1:1">1:1 (feed)</option>
          <option value="4:5">4:5 (portrait)</option>
          <option value="9:16">9:16 (story/reel)</option>
          <option value="16:9">16:9 (wide)</option>
        </select>
      </div>
    </div>

    <button class="btn btn-primary" id="queue-btn">Generate</button>
    <div style="color:var(--text-muted);font-size:11.5px;margin-top:10px;">
      Queued generations are processed by Claude (or the Higgsfield API once connected) and appear in Assets.
    </div>
  </div>

  <!-- DRIVE PICKER MODAL -->
  <div id="picker" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:50;align-items:center;justify-content:center;">
    <div class="card" style="width:640px;max-height:80vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="section-label" style="margin:0;">Pick a source photo</div>
        <button class="btn btn-ghost btn-sm" id="picker-close">✕</button>
      </div>
      <div id="picker-crumbs" style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;"></div>
      <div id="picker-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
        <div class="empty-state">Loading…</div>
      </div>
    </div>
  </div>
</div>

<script>
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let crumbs = [{ id: 'root', name: 'Drive' }];
let picked = null;

async function loadClientOptions() {
  const res = await fetch('/api/clients');
  const clients = await res.json();
  document.getElementById('c-client').innerHTML =
    clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function openPicker(folderId) {
  document.getElementById('picker').style.display = 'flex';
  const grid = document.getElementById('picker-grid');
  grid.innerHTML = '<div class="empty-state">Loading…</div>';
  const res = await fetch('/api/drive/browse?folderId=' + encodeURIComponent(folderId));
  if (res.status === 503) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Google Drive isn\'t connected yet. Run scripts/google-oauth.js and set the env vars.</div>';
    return;
  }
  if (!res.ok) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Drive error — try again.</div>';
    return;
  }
  const files = await res.json();
  document.getElementById('picker-crumbs').innerHTML = crumbs
    .map((c, i) => `<a href="#" data-crumb="${i}" style="color:var(--text-secondary);">${esc(c.name)}</a>`)
    .join(' / ');
  if (files.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Empty folder.</div>';
    return;
  }
  grid.innerHTML = files.map(f => f.mimeType === 'application/vnd.google-apps.folder'
    ? `<div class="card" style="cursor:pointer;text-align:center;padding:14px;" data-folder="${f.id}" data-name="${esc(f.name)}">📁<div style="font-size:11.5px;margin-top:6px;">${esc(f.name)}</div></div>`
    : `<div class="card" style="cursor:pointer;padding:6px;text-align:center;" data-file="${f.id}" data-name="${esc(f.name)}" data-thumb="${esc(f.thumbnailLink || '')}">
        ${f.thumbnailLink ? `<img src="${esc(f.thumbnailLink)}" alt="" style="width:100%;height:80px;object-fit:cover;border-radius:6px;" />` : '🖼️'}
        <div style="font-size:11px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</div>
      </div>`
  ).join('');
}

document.getElementById('pick-btn').addEventListener('click', () => {
  crumbs = [{ id: 'root', name: 'Drive' }];
  openPicker('root');
});
document.getElementById('picker-close').addEventListener('click', () => {
  document.getElementById('picker').style.display = 'none';
});
document.getElementById('picker-crumbs').addEventListener('click', e => {
  const a = e.target.closest('[data-crumb]');
  if (!a) return;
  e.preventDefault();
  crumbs = crumbs.slice(0, Number(a.dataset.crumb) + 1);
  openPicker(crumbs[crumbs.length - 1].id);
});
document.getElementById('picker-grid').addEventListener('click', e => {
  const folder = e.target.closest('[data-folder]');
  if (folder) {
    crumbs.push({ id: folder.dataset.folder, name: folder.dataset.name });
    openPicker(folder.dataset.folder);
    return;
  }
  const file = e.target.closest('[data-file]');
  if (file) {
    picked = { id: file.dataset.file, name: file.dataset.name, thumb: file.dataset.thumb };
    document.getElementById('picked').style.display = 'flex';
    document.getElementById('picked-thumb').src = picked.thumb;
    document.getElementById('picked-name').textContent = picked.name;
    document.getElementById('picker').style.display = 'none';
  }
});
document.getElementById('clear-pick').addEventListener('click', () => {
  picked = null;
  document.getElementById('picked').style.display = 'none';
});

document.getElementById('queue-btn').addEventListener('click', async () => {
  const prompt = document.getElementById('c-prompt').value.trim();
  if (!prompt) { showToast('Write a prompt first'); return; }
  const aspect = document.getElementById('c-aspect').value;
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Number(document.getElementById('c-client').value),
      campaign: document.getElementById('c-campaign').value.trim(),
      type: document.getElementById('c-type').value,
      prompt: `${prompt}\n\nAspect ratio: ${aspect}`,
      status: 'queued',
      source_drive_file_id: picked ? picked.id : null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || 'Failed to queue');
    return;
  }
  showToast('Queued — check the Assets tab');
  document.getElementById('c-prompt').value = '';
  document.getElementById('clear-pick').click();
});

loadClientOptions();
</script>
```
Note on the modal: `position: fixed` is fine here because this page renders inside the app shell (not the streaming-widget context).

- [ ] **Step 2: Manual verification**

Run: `npm start`, open Create tab.
- Client dropdown lists Perfect Balance Roofing + Frankys Detailing.
- Without Google env vars: Browse Drive… opens the modal with the "isn't connected yet" message.
- Fill prompt, Generate → toast; Assets tab shows the queued card.
Expected: all three behaviors.

- [ ] **Step 3: Commit**

```bash
git add public/pages/create.html
git commit -m "feat: create page with drive picker modal and generation queue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Claude pipeline protocol + deployment notes

**Files:**
- Modify: `/Users/dillonmccoy/claude-workspace/CLAUDE.md` (outside this repo)
- Create: `docs/DEPLOY.md` (this repo)

**Interfaces:**
- Consumes: `GET /api/assets?status=queued` + `PATCH /api/assets/:id` with `Authorization: Bearer $API_TOKEN` (Task 1/3), `uploadFromUrl` contract (Task 5)

- [ ] **Step 1: Append to the workspace CLAUDE.md "Content engine (AIOS)" section**

```markdown
### Processing queued generations

When Dillon says "process the queue" (or similar), in a session with the Higgsfield MCP:

1. `GET <dashboard-url>/api/assets?status=queued` with header `Authorization: Bearer $API_TOKEN`
   (URL + token in `~/claude-workspace/.env.dashboard` — never commit or echo the token).
2. For each queued asset: read `clients/<client>/brand.md`, then PATCH status to `generating`,
   then generate via Higgsfield MCP using the asset's prompt (+ source Drive file as reference
   image if `source_drive_file_id` is set — fetch it via the Drive connector).
3. Upload the result to the output Drive under `/<client name>/<campaign>/`.
4. `PATCH /api/assets/:id` with `{ status: 'draft', output_drive_file_id, output_drive_url, thumbnail_url, model }`.
   On failure: `{ status: 'failed', error: '<short reason>' }`.
```

- [ ] **Step 2: Create `~/claude-workspace/.env.dashboard`** (values from Dillon at execution time)

```
DASHBOARD_URL=https://<railway-app-url>
API_TOKEN=<same value as the Railway API_TOKEN env var>
```

- [ ] **Step 3: Create `docs/DEPLOY.md` in this repo**

```markdown
# Deploying to Railway

Environment variables (Railway → project → Variables):

| Var | Purpose |
|---|---|
| ANTHROPIC_API_KEY | Claude text-post generation (existing) |
| DASHBOARD_PASSWORD | Login password for the web UI |
| SESSION_SECRET | Random string; signs the session cookie (`openssl rand -hex 32`) |
| API_TOKEN | Bearer token for Claude sessions/scripts (`openssl rand -hex 32`) |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | OAuth client (Google Cloud Console → APIs & Credentials, Drive API enabled) |
| GOOGLE_REFRESH_TOKEN | Minted once via `node scripts/google-oauth.js` locally |
| OUTPUT_DRIVE_FOLDER_ID | Folder ID of the output Drive root (from its URL) |

Known limitation: SQLite data resets on each deploy (no volume). Media lives in
Drive so files survive; asset/client rows do not. Fix (next up after Phase A):
attach a Railway volume for `data/` or migrate to Postgres.
```

- [ ] **Step 4: Full suite one last time**

Run: `npm test`
Expected: all suites green (existing 27 + ~23 new).

- [ ] **Step 5: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: railway deployment env vars and queue-processing protocol

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan follow-ups (not in this plan)

- Phase B: `POST /api/generate-visual` + Higgsfield platform API + webhook (blocked on API key from cloud.higgsfield.ai)
- Railway persistence (volume or Postgres) — schedule immediately after Phase A ships
- Push Phase A to Railway with the new env vars set
- Gallery campaign/type filter dropdowns (API already supports `campaign`; conscious UI trim from spec — add if Dillon wants them)
