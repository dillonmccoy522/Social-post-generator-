# Per-client Google Drive Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dillon paste a Google Drive folder link once per client so the Create page's Drive picker jumps straight into that client's photos, and let the app auto-create and display each client's output folder link — no per-client OAuth, no manual Drive-account sharing steps.

**Architecture:** Two new nullable columns on the existing `clients` table (`source_drive_folder_id`, `output_drive_folder_id`). A new `parseFolderId()` helper in `services/drive.js` normalizes a pasted URL or bare ID into a folder ID. `routes/clients.js` validates and stores the source link on create/update, and eagerly creates the output folder (via the already-built `ensureFolder()`) right after a client is created. The Clients page gains one form field and two conditional links per client card. The Create page's "Browse Drive" button looks up the selected client's stored source folder and opens the picker there instead of at Drive root.

**Tech Stack:** Node.js + Express, better-sqlite3, vanilla JS (no framework, no build step), Jest + Supertest for backend tests.

## Global Constraints

- No changes to `uploadFromUrl`'s or `ensureFolder`'s core behavior — only new callers/inputs are added.
- Source folder validation blocks client creation/update entirely if the pasted value isn't parseable (400 response) — consistent with how `name`/`business_type`/`location` are already required-and-validated.
- Eager output-folder creation must never fail or block the client-creation response — wrap in try/catch, log and continue.
- If Drive isn't configured (`GOOGLE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` unset), client creation/update proceeds normally; `source_drive_folder_id` still saves (it's just a string), `output_drive_folder_id` stays null.
- All user-rendered strings go through the existing `esc()` helper; all externally-derived URLs go through `safeUrl()` — both are per-page-fragment helpers (existing pattern, since fragments load independently via `new Function` with no shared module system).
- `npm test` (currently 50 tests, backend-only) must keep passing; new tests are additive.
- Commit style: `feat:` prefix.
- Page fragments (`public/pages/*.html`) have no `<html>/<head>` wrapper and use no module syntax.

---

### Task 1: Database layer — migration + client Drive fields

**Files:**
- Modify: `database.js:23-61` (`initSchema`), `database.js:72-86` (`createClient`, `updateClient`), `database.js:204-222` (`module.exports`)
- Test: `tests/database.test.js`

**Interfaces:**
- Produces: `createClient({ name, business_type, location, brand_voice, source_drive_folder_id })` — `source_drive_folder_id` now accepted, defaults to `null`.
- Produces: `updateClient(id, { name, business_type, location, brand_voice, source_drive_folder_id })` — same.
- Produces: `setClientOutputFolder(id, folderId)` — new function, returns the updated client record. Later tasks (Task 3) call this by this exact name.
- Produces: `clients` rows now include `source_drive_folder_id` and `output_drive_folder_id` (both `TEXT`, nullable).

- [ ] **Step 1: Write the failing tests**

Add to `tests/database.test.js` (after the existing `updateClientLastPillar` test):

```javascript
test('createClient accepts and stores source_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Drive Test',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'abc123',
  });
  expect(client.source_drive_folder_id).toBe('abc123');
  expect(client.output_drive_folder_id).toBeNull();
});

test('createClient defaults source_drive_folder_id to null when omitted', () => {
  const client = db.createClient({
    name: 'No Drive',
    business_type: 'HVAC',
    location: 'Austin, TX',
  });
  expect(client.source_drive_folder_id).toBeNull();
});

test('updateClient updates source_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Update Me',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  const updated = db.updateClient(client.id, {
    name: 'Update Me',
    business_type: 'Roofing',
    location: 'Dallas, TX',
    brand_voice: '',
    source_drive_folder_id: 'xyz789',
  });
  expect(updated.source_drive_folder_id).toBe('xyz789');
});

test('setClientOutputFolder sets output_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Output Test',
    business_type: 'Detailing',
    location: 'Houston, TX',
  });
  const updated = db.setClientOutputFolder(client.id, 'output-folder-id');
  expect(updated.output_drive_folder_id).toBe('output-folder-id');
  expect(updated.id).toBe(client.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/database.test.js -t "source_drive_folder_id|setClientOutputFolder" -v`
Expected: FAIL — `db.createClient(...)` returns a client with `source_drive_folder_id: undefined` (column doesn't exist yet, or the field isn't passed through), and `db.setClientOutputFolder` throws `TypeError: db.setClientOutputFolder is not a function`.

- [ ] **Step 3: Add the migration and extend the functions**

In `database.js`, replace the `initSchema` function:

```javascript
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      business_type TEXT NOT NULL,
      location TEXT NOT NULL,
      brand_voice TEXT DEFAULT '',
      last_pillar TEXT DEFAULT NULL,
      source_drive_folder_id TEXT DEFAULT NULL,
      output_drive_folder_id TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      week_of DATE NOT NULL,
      photo_descriptions TEXT NOT NULL,
      generated_content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
  `);
  migrateClientsDriveColumns(db);
}

function migrateClientsDriveColumns(db) {
  const columns = db.prepare('PRAGMA table_info(clients)').all().map(c => c.name);
  if (!columns.includes('source_drive_folder_id')) {
    db.exec('ALTER TABLE clients ADD COLUMN source_drive_folder_id TEXT DEFAULT NULL');
  }
  if (!columns.includes('output_drive_folder_id')) {
    db.exec('ALTER TABLE clients ADD COLUMN output_drive_folder_id TEXT DEFAULT NULL');
  }
}
```

Replace `createClient` and `updateClient`, and add `setClientOutputFolder` right after `updateClient`:

```javascript
function createClient({ name, business_type, location, brand_voice = '', source_drive_folder_id = null }) {
  const stmt = getDb().prepare(
    'INSERT INTO clients (name, business_type, location, brand_voice, source_drive_folder_id) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, business_type, location, brand_voice, source_drive_folder_id);
  return getClientById(result.lastInsertRowid);
}

function updateClient(id, { name, business_type, location, brand_voice, source_drive_folder_id = null }) {
  getDb().prepare(
    'UPDATE clients SET name = ?, business_type = ?, location = ?, brand_voice = ?, source_drive_folder_id = ? WHERE id = ?'
  ).run(name, business_type, location, brand_voice, source_drive_folder_id, id);
  return getClientById(id);
}

function setClientOutputFolder(id, folderId) {
  getDb().prepare('UPDATE clients SET output_drive_folder_id = ? WHERE id = ?').run(folderId, id);
  return getClientById(id);
}
```

Add `setClientOutputFolder` to `module.exports` (after `updateClientLastPillar`):

```javascript
module.exports = {
  getDb,
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  updateClientLastPillar,
  setClientOutputFolder,
  createPost,
  getPostsByClientId,
  getAllPosts,
  createAsset,
  getAssetById,
  getAssets,
  updateAsset,
  deleteAsset,
  getStats,
  closeDb,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/database.test.js -v`
Expected: all tests in the file PASS, including the 4 new ones.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test`
Expected: `Tests: 54 passed, 54 total` (50 existing + 4 new).

- [ ] **Step 6: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add database.js tests/database.test.js
git commit -m "feat: add source/output Drive folder fields to clients table"
```

---

### Task 2: `parseFolderId` helper

**Files:**
- Modify: `services/drive.js:1-16` (add function, extend exports)
- Test: `tests/drive.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseFolderId(input)` — pure function, exported from `services/drive.js`. Returns a folder ID string, or `null` if `input` is empty/unparseable. Task 3 imports and calls this exact function.

- [ ] **Step 1: Write the failing tests**

Add to `tests/drive.test.js` (after the existing `ensureFolder creates when missing` test — no `configure()` call needed since this is a pure function, no Drive API involved):

```javascript
test('parseFolderId extracts id from a full folder URL', () => {
  expect(drive.parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'))
    .toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
});

test('parseFolderId extracts id from a folder URL with query string', () => {
  expect(drive.parseFolderId('https://drive.google.com/drive/folders/1AbCdEf?usp=sharing'))
    .toBe('1AbCdEf');
});

test('parseFolderId extracts id from a /u/0/folders/ URL variant', () => {
  expect(drive.parseFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEf'))
    .toBe('1AbCdEf');
});

test('parseFolderId accepts a bare folder id', () => {
  expect(drive.parseFolderId('1AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
});

test('parseFolderId returns null for empty input', () => {
  expect(drive.parseFolderId('')).toBeNull();
  expect(drive.parseFolderId(null)).toBeNull();
  expect(drive.parseFolderId(undefined)).toBeNull();
});

test('parseFolderId returns null for unrecognizable input', () => {
  expect(drive.parseFolderId('not a link at all, just words')).toBeNull();
  expect(drive.parseFolderId('https://example.com/not-drive')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/drive.test.js -t "parseFolderId" -v`
Expected: FAIL with `TypeError: drive.parseFolderId is not a function`.

- [ ] **Step 3: Implement `parseFolderId`**

In `services/drive.js`, add this function right after `isConfigured` (before `getDrive`):

```javascript
function parseFolderId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}
```

Update the final export line:

```javascript
module.exports = { isConfigured, parseFolderId, browse, ensureFolder, uploadFromUrl };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/drive.test.js -v`
Expected: all tests in the file PASS, including the 6 new ones.

- [ ] **Step 5: Run the full suite**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test`
Expected: `Tests: 60 passed, 60 total` (54 from Task 1 + 6 new).

- [ ] **Step 6: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add services/drive.js tests/drive.test.js
git commit -m "feat: add parseFolderId helper for Drive folder links"
```

---

### Task 3: Wire Drive links into the clients route

**Files:**
- Modify: `routes/clients.js` (full file — `POST /` and `PUT /:id` handlers)
- Test: `tests/clients.test.js`

**Interfaces:**
- Consumes: `db.createClient`, `db.updateClient`, `db.setClientOutputFolder` (Task 1); `drive.parseFolderId`, `drive.isConfigured`, `drive.ensureFolder` (Task 2 + existing).
- Produces: `POST /api/clients` and `PUT /api/clients/:id` now accept `source_drive_folder_id` (a raw pasted link or bare ID) in the request body; `POST` additionally attempts eager output-folder creation.

- [ ] **Step 1: Write the failing tests**

Add this Drive mock setup to the top of `tests/clients.test.js` (this file currently has no Drive mocking — this mirrors the exact pattern already used in `tests/drive.test.js`), replacing the first 4 lines:

```javascript
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

afterEach(() => {
  db.closeDb();
  jest.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

function configureDrive() {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
}
```

(This replaces the existing `process.env.DB_PATH = ':memory:';`, `const request = require('supertest');`, `const app = require('../server');`, `const db = require('../database');`, and `afterEach(() => db.closeDb());` lines at the top of the file with the block above — same behavior for existing tests, plus the new Drive mock.)

Add these new tests at the end of `tests/clients.test.js`:

```javascript
test('POST /api/clients parses and stores a valid Drive folder link', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Drive Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'https://drive.google.com/drive/folders/1AbCdEf?usp=sharing',
  });
  expect(res.status).toBe(201);
  expect(res.body.source_drive_folder_id).toBe('1AbCdEf');
});

test('POST /api/clients returns 400 for an unrecognizable Drive link', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Bad Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'not a link',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/not recognizable/);
});

test('POST /api/clients succeeds with no Drive link at all', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'No Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.source_drive_folder_id).toBeNull();
  expect(res.body.output_drive_folder_id).toBeNull();
});

test('POST /api/clients eagerly creates output folder when Drive is configured', async () => {
  configureDrive();
  process.env.OUTPUT_DRIVE_FOLDER_ID = 'output-root';
  mockList.mockResolvedValue({ data: { files: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'new-client-output-folder' } });

  const res = await request(app).post('/api/clients').send({
    name: 'Eager Client',
    business_type: 'Detailing',
    location: 'Houston, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBe('new-client-output-folder');
  delete process.env.OUTPUT_DRIVE_FOLDER_ID;
});

test('POST /api/clients leaves output_drive_folder_id null when Drive is not configured', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Unconfigured Client',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBeNull();
});

test('POST /api/clients still succeeds even if eager output folder creation throws', async () => {
  configureDrive();
  process.env.OUTPUT_DRIVE_FOLDER_ID = 'output-root';
  mockList.mockRejectedValue(new Error('Drive API down'));

  const res = await request(app).post('/api/clients').send({
    name: 'Resilient Client',
    business_type: 'Roofing',
    location: 'Austin, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBeNull();
  delete process.env.OUTPUT_DRIVE_FOLDER_ID;
});

test('PUT /api/clients/:id updates source_drive_folder_id', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Update Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Update Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    source_drive_folder_id: '1XyZAbC',
  });
  expect(res.status).toBe(200);
  expect(res.body.source_drive_folder_id).toBe('1XyZAbC');
});

test('PUT /api/clients/:id returns 400 for an unrecognizable Drive link', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Bad Update Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Bad Update Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    source_drive_folder_id: '///bad///',
  });
  expect(res.status).toBe(400);
});

test('PUT /api/clients/:id does not touch output_drive_folder_id', async () => {
  configureDrive();
  process.env.OUTPUT_DRIVE_FOLDER_ID = 'output-root';
  mockList.mockResolvedValue({ data: { files: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'preexisting-output-folder' } });

  const created = await request(app).post('/api/clients').send({
    name: 'Output Preserved Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  expect(created.body.output_drive_folder_id).toBe('preexisting-output-folder');

  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Output Preserved Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    source_drive_folder_id: '1NewSourceFolder',
  });
  expect(res.status).toBe(200);
  expect(res.body.output_drive_folder_id).toBe('preexisting-output-folder');
  delete process.env.OUTPUT_DRIVE_FOLDER_ID;
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/clients.test.js -v`
Expected: the new tests FAIL — `res.body.source_drive_folder_id` is `undefined` (route doesn't read or validate it yet), `res.status` is `201` instead of `400` for the bad-link tests.

- [ ] **Step 3: Update the route**

Replace the full contents of `routes/clients.js`:

```javascript
const express = require('express');
const router = express.Router();
const db = require('../database');
const drive = require('../services/drive');

router.get('/', (_req, res) => {
  res.json(db.getAllClients());
});

router.get('/:id', (req, res) => {
  const client = db.getClientById(Number(req.params.id));
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', async (req, res) => {
  const { name, business_type, location, brand_voice = '', source_drive_folder_id: rawLink } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }

  let source_drive_folder_id = null;
  if (rawLink) {
    source_drive_folder_id = drive.parseFolderId(rawLink);
    if (!source_drive_folder_id) {
      return res.status(400).json({ error: 'Source Drive folder link is not recognizable' });
    }
  }

  let client = db.createClient({ name, business_type, location, brand_voice, source_drive_folder_id });

  if (drive.isConfigured()) {
    try {
      const folderId = await drive.ensureFolder(client.name, process.env.OUTPUT_DRIVE_FOLDER_ID);
      client = db.setClientOutputFolder(client.id, folderId);
    } catch (err) {
      console.error('Failed to create output Drive folder for client', client.id, err.message);
    }
  }

  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const { name, business_type, location, brand_voice = '', source_drive_folder_id: rawLink } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const existing = db.getClientById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  let source_drive_folder_id = null;
  if (rawLink) {
    source_drive_folder_id = drive.parseFolderId(rawLink);
    if (!source_drive_folder_id) {
      return res.status(400).json({ error: 'Source Drive folder link is not recognizable' });
    }
  }

  const updated = db.updateClient(req.params.id, { name, business_type, location, brand_voice, source_drive_folder_id });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = db.getClientById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  db.deleteClient(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/clients.test.js -v`
Expected: all tests in the file PASS, including the 9 new ones.

- [ ] **Step 5: Run the full suite**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test`
Expected: `Tests: 69 passed, 69 total` (60 from Task 2 + 9 new).

- [ ] **Step 6: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add routes/clients.js tests/clients.test.js
git commit -m "feat: validate and store client Drive links, eager-create output folder"
```

---

### Task 4: Clients page — form field and link display

**Files:**
- Modify: `public/pages/clients.html` (full file)

**Interfaces:**
- Consumes: `POST /api/clients` and `PUT /api/clients/:id` now accept/return `source_drive_folder_id` and `output_drive_folder_id` (Task 3).
- No new interfaces produced — this is a leaf UI task.

- [ ] **Step 1: Add the form field**

In `public/pages/clients.html`, replace:

```html
    <label>Brand Voice Notes</label>
    <textarea id="f-voice" placeholder="e.g. Friendly and direct. Emphasize 20+ years experience. Avoid corporate-speak."></textarea>
    <div style="display:flex;gap:10px;">
```

With:

```html
    <label>Brand Voice Notes</label>
    <textarea id="f-voice" placeholder="e.g. Friendly and direct. Emphasize 20+ years experience. Avoid corporate-speak."></textarea>
    <label>Source Drive Folder Link</label>
    <input type="text" id="f-drive-link" placeholder="https://drive.google.com/drive/folders/..." />
    <div style="display:flex;gap:10px;">
```

- [ ] **Step 2: Add the `safeUrl` helper**

Replace:

```html
<script>
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadClients() {
```

With:

```html
<script>
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#';
  } catch { return '#'; }
}

async function loadClients() {
```

- [ ] **Step 3: Show the Source/Output links and pass the source folder id through to Edit**

Replace:

```html
  list.innerHTML = clients.map(c => `
    <div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
      <div>
        <div style="font-weight:600;margin-bottom:4px;">${esc(c.name)}</div>
        <div style="color:var(--text-muted);font-size:12px;">${esc(c.business_type)} · ${esc(c.location)}</div>
        ${c.last_pillar ? `<span class="badge" style="margin-top:8px;display:inline-block;">${esc(c.last_pillar)}</span>` : ''}
        ${c.brand_voice ? `<div style="color:var(--text-secondary);font-size:12.5px;margin-top:6px;">${esc(c.brand_voice)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${c.id}" data-name="${esc(c.name)}" data-type="${esc(c.business_type)}" data-location="${esc(c.location)}" data-voice="${esc(c.brand_voice || '')}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">Delete</button>
      </div>
    </div>
  `).join('');
```

With:

```html
  list.innerHTML = clients.map(c => `
    <div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
      <div>
        <div style="font-weight:600;margin-bottom:4px;">${esc(c.name)}</div>
        <div style="color:var(--text-muted);font-size:12px;">${esc(c.business_type)} · ${esc(c.location)}</div>
        ${c.last_pillar ? `<span class="badge" style="margin-top:8px;display:inline-block;">${esc(c.last_pillar)}</span>` : ''}
        ${c.brand_voice ? `<div style="color:var(--text-secondary);font-size:12.5px;margin-top:6px;">${esc(c.brand_voice)}</div>` : ''}
        <div style="display:flex;gap:12px;margin-top:8px;">
          ${c.source_drive_folder_id ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl('https://drive.google.com/drive/folders/' + c.source_drive_folder_id))}" target="_blank" rel="noopener">Source ↗</a>` : ''}
          ${c.output_drive_folder_id ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl('https://drive.google.com/drive/folders/' + c.output_drive_folder_id))}" target="_blank" rel="noopener">Output ↗</a>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${c.id}" data-name="${esc(c.name)}" data-type="${esc(c.business_type)}" data-location="${esc(c.location)}" data-voice="${esc(c.brand_voice || '')}" data-source-folder="${esc(c.source_drive_folder_id || '')}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">Delete</button>
      </div>
    </div>
  `).join('');
```

- [ ] **Step 4: Clear the new field on hide, and populate it on edit**

Replace:

```html
function hideForm() {
  document.getElementById('client-form').style.display = 'none';
  document.getElementById('edit-id').value = '';
  ['f-name','f-type','f-location','f-voice'].forEach(id => document.getElementById(id).value = '');
}

function editClient(id, name, type, location, voice) {
  document.getElementById('edit-id').value = id;
  document.getElementById('f-name').value = name;
  document.getElementById('f-type').value = type;
  document.getElementById('f-location').value = location;
  document.getElementById('f-voice').value = voice;
  showForm('Edit Client');
  document.getElementById('client-form').scrollIntoView({ behavior: 'smooth' });
}
```

With:

```html
function hideForm() {
  document.getElementById('client-form').style.display = 'none';
  document.getElementById('edit-id').value = '';
  ['f-name','f-type','f-location','f-voice','f-drive-link'].forEach(id => document.getElementById(id).value = '');
}

function editClient(id, name, type, location, voice, sourceFolderId) {
  document.getElementById('edit-id').value = id;
  document.getElementById('f-name').value = name;
  document.getElementById('f-type').value = type;
  document.getElementById('f-location').value = location;
  document.getElementById('f-voice').value = voice;
  document.getElementById('f-drive-link').value = sourceFolderId ? `https://drive.google.com/drive/folders/${sourceFolderId}` : '';
  showForm('Edit Client');
  document.getElementById('client-form').scrollIntoView({ behavior: 'smooth' });
}
```

- [ ] **Step 5: Send the field in `saveClient`, and pass it through the edit-button delegation**

Replace:

```html
async function saveClient() {
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('f-name').value.trim(),
    business_type: document.getElementById('f-type').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    brand_voice: document.getElementById('f-voice').value.trim(),
  };
```

With:

```html
async function saveClient() {
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('f-name').value.trim(),
    business_type: document.getElementById('f-type').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    brand_voice: document.getElementById('f-voice').value.trim(),
    source_drive_folder_id: document.getElementById('f-drive-link').value.trim(),
  };
```

Replace:

```html
  if (action === 'edit') {
    editClient(id, btn.dataset.name, btn.dataset.type, btn.dataset.location, btn.dataset.voice);
  } else if (action === 'delete') {
```

With:

```html
  if (action === 'edit') {
    editClient(id, btn.dataset.name, btn.dataset.type, btn.dataset.location, btn.dataset.voice, btn.dataset.sourceFolder);
  } else if (action === 'delete') {
```

- [ ] **Step 6: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/clients.html | grep -c "f-drive-link"
curl -s http://localhost:3000/pages/clients.html | grep -c "data-source-folder"
kill %1
npm test
```
Expected: both greps return `1` or more, and `Tests: 69 passed, 69 total` (unchanged from Task 3 — this is a markup/JS-only change with no new automated tests, consistent with this app having zero frontend test coverage).

- [ ] **Step 7: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add public/pages/clients.html
git commit -m "feat: add Drive folder link field and display to Clients page"
```

---

### Task 5: Create page — jump to client's source folder

**Files:**
- Modify: `public/pages/create.html:84-127`

**Interfaces:**
- Consumes: `GET /api/clients` response now includes `source_drive_folder_id` per client (Task 1/3, already returned by `getAllClients()` since it does `SELECT *`).

- [ ] **Step 1: Keep the fetched client list in memory**

Replace:

```html
let crumbs = [{ id: 'root', name: 'Drive' }];
let picked = null;

async function loadClientOptions() {
  const res = await fetch('/api/clients');
  const clients = await res.json();
  document.getElementById('c-client').innerHTML =
    clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}
```

With:

```html
let crumbs = [{ id: 'root', name: 'Drive' }];
let picked = null;
let clients = [];

async function loadClientOptions() {
  const res = await fetch('/api/clients');
  clients = await res.json();
  document.getElementById('c-client').innerHTML =
    clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}
```

- [ ] **Step 2: Default the Browse Drive button to the selected client's source folder**

Replace:

```html
document.getElementById('pick-btn').addEventListener('click', () => {
  crumbs = [{ id: 'root', name: 'Drive' }];
  openPicker('root');
});
```

With:

```html
document.getElementById('pick-btn').addEventListener('click', () => {
  const selected = clients.find(c => String(c.id) === document.getElementById('c-client').value);
  if (selected && selected.source_drive_folder_id) {
    crumbs = [{ id: selected.source_drive_folder_id, name: selected.name }];
    openPicker(selected.source_drive_folder_id);
  } else {
    crumbs = [{ id: 'root', name: 'Drive' }];
    openPicker('root');
  }
});
```

- [ ] **Step 3: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/create.html | grep -c "selected.source_drive_folder_id"
kill %1
npm test
```
Expected: grep returns `1` or more, `Tests: 69 passed, 69 total` (unchanged — no new automated tests for this page-fragment-only change).

- [ ] **Step 4: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add public/pages/create.html
git commit -m "feat: Create page Browse Drive jumps to client's source folder"
```

---

### Task 6: Full regression + manual verification

**Files:**
- None modified — this is the acceptance checkpoint for the whole feature.

- [ ] **Step 1: Run the full test suite**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test
```
Expected: `Tests: 69 passed, 69 total`.

- [ ] **Step 2: Manual click-through**

```bash
npm start
```
Open `http://localhost:3000`, go to Clients, and:
- Add a client with a Drive folder link pasted in as a full URL (e.g. `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`) — confirm it saves without error and a "Source ↗" link appears on the card, pointing to that same URL.
- Add a client with an obviously-bad value in the Drive link field (e.g. `hello world`) — confirm you get a clear error toast and the client is NOT created.
- Add a client with the Drive link field left blank — confirm it saves fine, no Source/Output links shown.
- Edit an existing client that has a source folder set — confirm the Drive link field is pre-filled with the full URL, not just the bare ID.
- Go to Create, pick a client that has a source folder set, click "Browse Drive…" — confirm the picker's breadcrumb starts at that client's name (not "Drive") and doesn't 503/error unexpectedly beyond what's expected without real Drive credentials configured locally (a `Google Drive isn't connected yet` message is expected in local dev since `GOOGLE_*` env vars aren't set — this confirms the request now targets the client's folder ID instead of `root`, which you can also confirm via browser dev tools' Network tab on the `/api/drive/browse?folderId=...` request).
- Pick a client with no source folder set, click "Browse Drive…" — confirm it falls back to breadcrumb "Drive" (today's behavior, unchanged).

- [ ] **Step 3: Fix anything found**

If anything above doesn't match, fix the specific issue directly (must still pass Step 1's `npm test` afterward).

- [ ] **Step 4: Final commit if fixes were made**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add -A
git commit -m "fix: manual verification cleanup for Drive links feature"
```
(Skip this step if Step 2 found nothing to fix.)
