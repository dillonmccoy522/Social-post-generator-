# Per-client Drive Folders v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each client two Drive folders that Dillon pastes in himself — 📥 pull-from (source) and 📤 send-to (output) — both shown plainly on the client card, and remove the auto-create-output behavior.

**Architecture:** The `output_drive_folder_id` column already exists but only `source_drive_folder_id` currently flows through the DB layer and route. This plan (1) makes `createClient`/`updateClient` persist `output_drive_folder_id`, (2) makes `routes/clients.js` parse + validate BOTH pasted links via the existing `drive.parseFolderId()` and drops the eager `ensureFolder` auto-create, and (3) reworks `public/pages/clients.html` so both folders (or a "+ Add" prompt) sit directly on each client card, with two labeled fields in the edit form.

**Tech Stack:** Node.js + Express, better-sqlite3, vanilla JS (no framework/build step), Jest + Supertest.

## Global Constraints

- No schema change — `clients.source_drive_folder_id` and `clients.output_drive_folder_id` (both TEXT, nullable) already exist.
- Both pasted links: normalize with `drive.parseFolderId()`; blank → `null`; unparseable → `400` with a clear message.
- All rendered folder URLs go through the page fragment's existing `esc()` + `safeUrl()` helpers.
- The clients route no longer calls the Drive API at all — remove the `googleapis` test mock added in v1 (it becomes dead code).
- `npm test` must stay green. Commit style: `feat:` / `refactor:` / `test:`.
- Page fragments (`public/pages/*.html`) have no `<html>/<head>` wrapper and use no module syntax.

---

### Task 1: Database layer — persist `output_drive_folder_id`

**Files:**
- Modify: `database.js:85-97` (`createClient`, `updateClient`)
- Test: `tests/database.test.js`

**Interfaces:**
- Produces: `createClient({ ..., source_drive_folder_id, output_drive_folder_id })` — `output_drive_folder_id` now accepted, defaults to `null`.
- Produces: `updateClient(id, { ..., source_drive_folder_id, output_drive_folder_id })` — same.

- [ ] **Step 1: Write the failing tests**

Add to `tests/database.test.js` after the existing `setClientOutputFolder sets output_drive_folder_id` test:

```javascript
test('createClient accepts and stores output_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Output Store',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    output_drive_folder_id: 'out123',
  });
  expect(client.output_drive_folder_id).toBe('out123');
});

test('createClient defaults output_drive_folder_id to null when omitted', () => {
  const client = db.createClient({
    name: 'No Output',
    business_type: 'HVAC',
    location: 'Austin, TX',
  });
  expect(client.output_drive_folder_id).toBeNull();
});

test('updateClient updates output_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Up Output',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  const updated = db.updateClient(client.id, {
    name: 'Up Output',
    business_type: 'Roofing',
    location: 'Dallas, TX',
    brand_voice: '',
    source_drive_folder_id: null,
    output_drive_folder_id: 'newout',
  });
  expect(updated.output_drive_folder_id).toBe('newout');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/database.test.js -t "output_drive_folder_id" -v`
Expected: FAIL — `createClient` returns `output_drive_folder_id: null` even when passed `'out123'` (param not destructured / not in INSERT), and `updateClient` leaves it null.

- [ ] **Step 3: Extend the two functions**

In `database.js`, replace `createClient`:

```javascript
function createClient({ name, business_type, location, brand_voice = '', source_drive_folder_id = null, output_drive_folder_id = null }) {
  const stmt = getDb().prepare(
    'INSERT INTO clients (name, business_type, location, brand_voice, source_drive_folder_id, output_drive_folder_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, business_type, location, brand_voice, source_drive_folder_id, output_drive_folder_id);
  return getClientById(result.lastInsertRowid);
}
```

Replace `updateClient`:

```javascript
function updateClient(id, { name, business_type, location, brand_voice, source_drive_folder_id = null, output_drive_folder_id = null }) {
  getDb().prepare(
    'UPDATE clients SET name = ?, business_type = ?, location = ?, brand_voice = ?, source_drive_folder_id = ?, output_drive_folder_id = ? WHERE id = ?'
  ).run(name, business_type, location, brand_voice, source_drive_folder_id, output_drive_folder_id, id);
  return getClientById(id);
}
```

(Leave `setClientOutputFolder` as-is — harmless, still exported.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/database.test.js -v`
Expected: all PASS, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add database.js tests/database.test.js
git commit -m "feat: persist output_drive_folder_id in createClient/updateClient"
```

---

### Task 2: Clients route — parse/validate both links, remove auto-create

**Files:**
- Modify: `routes/clients.js` (full file)
- Test: `tests/clients.test.js`

**Interfaces:**
- Consumes: `db.createClient`, `db.updateClient` (Task 1); `drive.parseFolderId` (existing).
- Produces: `POST /api/clients` and `PUT /api/clients/:id` accept `source_drive_folder_id` AND `output_drive_folder_id` as raw pasted links/IDs; both validated (400 on unparseable), stored as normalized IDs. No Drive API calls.

- [ ] **Step 1: Update the tests**

In `tests/clients.test.js`, replace the entire top-of-file block (everything from `process.env.DB_PATH = ':memory:';` down to and including the `function configureDrive() { ... }` block added in v1) with the original simple header (the route no longer touches Drive, so the `googleapis` mock is dead code):

```javascript
process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());
```

Then DELETE these four v1 tests wholesale (they assert the removed auto-create behavior or the Drive mock):
- `POST /api/clients eagerly creates output folder when Drive is configured`
- `POST /api/clients leaves output_drive_folder_id null when Drive is not configured`
- `POST /api/clients still succeeds even if eager output folder creation throws`
- `PUT /api/clients/:id does not touch output_drive_folder_id`

Then ADD these tests at the end of the file:

```javascript
test('POST /api/clients parses and stores a valid output Drive link', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Output Client',
    business_type: 'Detailing',
    location: 'Houston, TX',
    output_drive_folder_id: 'https://drive.google.com/drive/folders/1OutPut?usp=sharing',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBe('1OutPut');
});

test('POST /api/clients returns 400 for an unrecognizable output link', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Bad Output Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    output_drive_folder_id: 'not a link',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/not recognizable/);
});

test('POST /api/clients stores both links together', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Both Links Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'https://drive.google.com/drive/folders/1Source',
    output_drive_folder_id: 'https://drive.google.com/drive/folders/1Output',
  });
  expect(res.status).toBe(201);
  expect(res.body.source_drive_folder_id).toBe('1Source');
  expect(res.body.output_drive_folder_id).toBe('1Output');
});

test('POST /api/clients leaves both null when neither link is sent', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'No Links Client',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.source_drive_folder_id).toBeNull();
  expect(res.body.output_drive_folder_id).toBeNull();
});

test('PUT /api/clients/:id updates output_drive_folder_id', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Update Output Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Update Output Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    output_drive_folder_id: '1NewOutput',
  });
  expect(res.status).toBe(200);
  expect(res.body.output_drive_folder_id).toBe('1NewOutput');
});

test('PUT /api/clients/:id returns 400 for an unrecognizable output link', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Bad Output Update',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Bad Output Update',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    output_drive_folder_id: '///bad///',
  });
  expect(res.status).toBe(400);
});
```

(The v1 tests for the SOURCE link — valid link, 400 on bad, blank → null, PUT updates source — stay unchanged and keep passing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npx jest tests/clients.test.js -v`
Expected: the new output-link tests FAIL — `res.body.output_drive_folder_id` is `undefined`/`null` and bad-output posts return `201` instead of `400` (route ignores `output_drive_folder_id`).

- [ ] **Step 3: Rewrite the route**

Replace the full contents of `routes/clients.js`:

```javascript
const express = require('express');
const router = express.Router();
const db = require('../database');
const drive = require('../services/drive');

// Normalize an optional pasted Drive link into a folder id.
// Returns { id } (id is null when blank) on success, or { error: true } if unparseable.
function parseOptionalLink(rawLink) {
  if (!rawLink) return { id: null };
  const id = drive.parseFolderId(rawLink);
  return id ? { id } : { error: true };
}

router.get('/', (_req, res) => {
  res.json(db.getAllClients());
});

router.get('/:id', (req, res) => {
  const client = db.getClientById(Number(req.params.id));
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', (req, res) => {
  const { name, business_type, location, brand_voice = '',
          source_drive_folder_id: rawSource, output_drive_folder_id: rawOutput } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const source = parseOptionalLink(rawSource);
  if (source.error) return res.status(400).json({ error: 'Pull-from Drive folder link is not recognizable' });
  const output = parseOptionalLink(rawOutput);
  if (output.error) return res.status(400).json({ error: 'Send-to Drive folder link is not recognizable' });

  const client = db.createClient({
    name, business_type, location, brand_voice,
    source_drive_folder_id: source.id,
    output_drive_folder_id: output.id,
  });
  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const { name, business_type, location, brand_voice = '',
          source_drive_folder_id: rawSource, output_drive_folder_id: rawOutput } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const existing = db.getClientById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const source = parseOptionalLink(rawSource);
  if (source.error) return res.status(400).json({ error: 'Pull-from Drive folder link is not recognizable' });
  const output = parseOptionalLink(rawOutput);
  if (output.error) return res.status(400).json({ error: 'Send-to Drive folder link is not recognizable' });

  const updated = db.updateClient(req.params.id, {
    name, business_type, location, brand_voice,
    source_drive_folder_id: source.id,
    output_drive_folder_id: output.id,
  });
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
Expected: all PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test`
Expected: all suites pass (v1 auto-create tests removed, output tests added).

- [ ] **Step 6: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add routes/clients.js tests/clients.test.js
git commit -m "refactor: parse/validate both Drive links, drop output auto-create"
```

---

### Task 3: Clients page — both folders obvious on the card + two labeled form fields

**Files:**
- Modify: `public/pages/clients.html` (full file)

**Interfaces:**
- Consumes: `GET /api/clients` returns `source_drive_folder_id` + `output_drive_folder_id` per client; `POST`/`PUT` accept both as pasted links (Task 2).
- No new interfaces produced — leaf UI task.

This task also refactors the edit flow to look the client up from an in-memory cache by `id` (instead of threading every field through `data-*` attributes), so the "+ Add" buttons only need `data-id`.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `public/pages/clients.html`:

```html
<div>
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:36px;">
    <div>
      <div class="page-title">Clients</div>
      <div class="page-subtitle">Manage your client accounts and brand voice settings.</div>
    </div>
    <button class="btn btn-primary" id="add-btn">+ Add Client</button>
  </div>

  <!-- ADD / EDIT FORM -->
  <div id="client-form" class="card" style="display:none;margin-bottom:24px;">
    <div class="section-label" id="form-label">New Client</div>
    <input type="hidden" id="edit-id" />
    <div class="form-row">
      <div>
        <label>Business Name</label>
        <input type="text" id="f-name" placeholder="San Antonio Roofing Co." />
      </div>
      <div>
        <label>Business Type</label>
        <input type="text" id="f-type" placeholder="Roofing" />
      </div>
    </div>
    <label>Location</label>
    <input type="text" id="f-location" placeholder="San Antonio, TX + northern areas" />
    <label>Brand Voice Notes</label>
    <textarea id="f-voice" placeholder="e.g. Friendly and direct. Emphasize 20+ years experience. Avoid corporate-speak."></textarea>
    <label>📥 Pull-from folder <span style="color:var(--text-muted);font-weight:400;">— where Higgsfield pulls photos from</span></label>
    <input type="text" id="f-source-link" placeholder="https://drive.google.com/drive/folders/..." />
    <label>📤 Send-to folder <span style="color:var(--text-muted);font-weight:400;">— where Higgsfield saves what it makes</span></label>
    <input type="text" id="f-output-link" placeholder="https://drive.google.com/drive/folders/..." />
    <div style="display:flex;gap:10px;">
      <button class="btn btn-primary" id="save-btn">Save Client</button>
      <button class="btn btn-ghost" id="cancel-btn">Cancel</button>
    </div>
  </div>

  <!-- CLIENT LIST -->
  <div id="client-list"><div class="empty-state">Loading clients...</div></div>
</div>

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

function folderUrl(id) {
  return safeUrl('https://drive.google.com/drive/folders/' + id);
}

let clientsCache = [];

async function loadClients() {
  const res = await fetch('/api/clients');
  clientsCache = await res.json();
  const list = document.getElementById('client-list');
  if (clientsCache.length === 0) {
    list.innerHTML = '<div class="empty-state">No clients yet. Add your first client above.</div>';
    return;
  }
  list.innerHTML = clientsCache.map(c => `
    <div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
      <div style="min-width:0;">
        <div style="font-weight:600;margin-bottom:4px;">${esc(c.name)}</div>
        <div style="color:var(--text-muted);font-size:12px;">${esc(c.business_type)} · ${esc(c.location)}</div>
        ${c.last_pillar ? `<span class="badge" style="margin-top:8px;display:inline-block;">${esc(c.last_pillar)}</span>` : ''}
        ${c.brand_voice ? `<div style="color:var(--text-secondary);font-size:12.5px;margin-top:6px;">${esc(c.brand_voice)}</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;font-size:12.5px;color:var(--text-secondary);">
          <div>📥 Pull-from: ${c.source_drive_folder_id
            ? `<a href="${esc(folderUrl(c.source_drive_folder_id))}" target="_blank" rel="noopener" style="color:var(--accent);">Open folder ↗</a>`
            : `<button class="btn btn-ghost btn-sm" data-action="edit" data-id="${c.id}">+ Add pull-from folder</button>`}</div>
          <div>📤 Send-to: ${c.output_drive_folder_id
            ? `<a href="${esc(folderUrl(c.output_drive_folder_id))}" target="_blank" rel="noopener" style="color:var(--accent);">Open folder ↗</a>`
            : `<button class="btn btn-ghost btn-sm" data-action="edit" data-id="${c.id}">+ Add send-to folder</button>`}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${c.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

function showForm(label = 'New Client') {
  document.getElementById('client-form').style.display = 'block';
  document.getElementById('form-label').textContent = label;
}

function hideForm() {
  document.getElementById('client-form').style.display = 'none';
  document.getElementById('edit-id').value = '';
  ['f-name','f-type','f-location','f-voice','f-source-link','f-output-link'].forEach(id => document.getElementById(id).value = '');
}

function editClient(id) {
  const c = clientsCache.find(x => x.id === id);
  if (!c) return;
  document.getElementById('edit-id').value = c.id;
  document.getElementById('f-name').value = c.name;
  document.getElementById('f-type').value = c.business_type;
  document.getElementById('f-location').value = c.location;
  document.getElementById('f-voice').value = c.brand_voice || '';
  document.getElementById('f-source-link').value = c.source_drive_folder_id ? `https://drive.google.com/drive/folders/${c.source_drive_folder_id}` : '';
  document.getElementById('f-output-link').value = c.output_drive_folder_id ? `https://drive.google.com/drive/folders/${c.output_drive_folder_id}` : '';
  showForm('Edit Client');
  document.getElementById('client-form').scrollIntoView({ behavior: 'smooth' });
}

async function saveClient() {
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('f-name').value.trim(),
    business_type: document.getElementById('f-type').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    brand_voice: document.getElementById('f-voice').value.trim(),
    source_drive_folder_id: document.getElementById('f-source-link').value.trim(),
    output_drive_folder_id: document.getElementById('f-output-link').value.trim(),
  };
  if (!body.name || !body.business_type || !body.location) {
    showToast('Name, business type, and location are required');
    return;
  }
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/clients/${id}` : '/api/clients';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || 'Failed to save client', 'error');
    return;
  }
  hideForm();
  loadClients();
  showToast(id ? 'Client updated' : 'Client added');
}

async function deleteClient(id) {
  if (!confirm('Delete this client? All post history for this client will also be removed.')) return;
  const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    showToast('Failed to delete client', 'error');
    return;
  }
  loadClients();
  showToast('Client deleted');
}

loadClients();

// Wire up static button handlers
document.getElementById('add-btn').addEventListener('click', () => showForm());
document.getElementById('save-btn').addEventListener('click', saveClient);
document.getElementById('cancel-btn').addEventListener('click', hideForm);

// Event delegation for dynamically-rendered client cards
document.getElementById('client-list').addEventListener('click', function(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = parseInt(btn.dataset.id, 10);
  if (action === 'edit') {
    editClient(id);
  } else if (action === 'delete') {
    deleteClient(id);
  }
});
</script>
```

- [ ] **Step 2: Verify markup + full suite**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && (npm start >/tmp/dash.log 2>&1 &) && sleep 2
echo "source field: $(curl -s http://localhost:3000/pages/clients.html | grep -c 'f-source-link')"
echo "output field: $(curl -s http://localhost:3000/pages/clients.html | grep -c 'f-output-link')"
echo "pull-from label: $(curl -s http://localhost:3000/pages/clients.html | grep -c 'Pull-from folder')"
echo "add send-to btn: $(curl -s http://localhost:3000/pages/clients.html | grep -c '+ Add send-to folder')"
pkill -f "node server"
npm test
```
Expected: each grep returns `1`+; `npm test` all green.

- [ ] **Step 3: Commit**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git add public/pages/clients.html
git commit -m "feat: show both Drive folders on client cards, add send-to field"
```

---

### Task 4: End-to-end verification

**Files:** none — acceptance checkpoint.

- [ ] **Step 1: Full suite**

Run: `cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test`
Expected: all green.

- [ ] **Step 2: Live end-to-end via curl**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && rm -f /tmp/v2.db && DB_PATH=/tmp/v2.db PORT=3998 npm start >/tmp/dash.log 2>&1 &
sleep 2
B="http://localhost:3998/api/clients"
# create with both links
curl -s -X POST $B -H 'Content-Type: application/json' -d '{"name":"E2E","business_type":"Roofing","location":"TX","source_drive_folder_id":"https://drive.google.com/drive/folders/1Src","output_drive_folder_id":"https://drive.google.com/drive/folders/1Out"}'
echo ""
# bad output link -> 400
curl -s -o /dev/null -w 'bad output HTTP %{http_code}\n' -X POST $B -H 'Content-Type: application/json' -d '{"name":"Bad","business_type":"Roofing","location":"TX","output_drive_folder_id":"nope"}'
pkill -f "node server"; rm -f /tmp/v2.db
```
Expected: first response shows `"source_drive_folder_id":"1Src"` and `"output_drive_folder_id":"1Out"`; bad output returns `HTTP 400`.

- [ ] **Step 3: Manual click-through (Dillon)**

Open the running app → Clients:
- Each client card shows a 📥 Pull-from row and a 📤 Send-to row — either an "Open folder ↗" link or a "+ Add ..." button.
- Click "+ Add send-to folder" → edit form opens for that client with both link fields.
- Paste a Drive URL into Send-to, save → card now shows "Open folder ↗" for Send-to pointing at that folder.
- Paste garbage into a link field, save → clear error toast, client not corrupted.
