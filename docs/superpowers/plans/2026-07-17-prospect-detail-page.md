# Prospect Detail Page + Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each lead its own editable detail page — call/copy the number, correct the facts, add contacts, log the call — and retire the dormant Due Today view.

**Architecture:** Extend `db/prospects.js` with a user-only edit path, a cadence-free call logger, and contacts CRUD, using the already-present `contacts` table and `USER_FIELDS` list. Add matching routes to `routes/prospects.js`. Rework the single `public/pages/prospects.html` to add a full detail page and drop Due Today. No new dependencies.

**Tech Stack:** Node + Express, better-sqlite3, Jest + supertest, vanilla JS front-end (scoped `.prospects`).

## Global Constraints

- **Never delete, never machine-overwrite.** No delete function on any table. Contacts retire via `is_active = 0`.
- **Dillon-owned columns** (`stage`, `rep`, `next_action`, `next_date`, `notes`, `deal_*`) are written **only** by the user-action save path, never by an automated one.
- **Grade never rides the edit form.** `grade`, `status`, `disqualified_reason` are excluded from the save path; grading stays on the 👍/🤷/👎 flow with its required reason.
- **Tests use** `process.env.DB_PATH = ':memory:'` at the top and `afterEach(() => db.closeDb())`, matching `tests/prospects-db.test.js` / `tests/prospects-api.test.js`.
- **Brand v4.0** tokens already defined in `prospects.html` are reused; no new palette. UI copy: advisor voice, no em-dashes.
- The dormant cadence code (`recordTouch`, `getDueToday`, `/due`, `/touch`) **stays in place**; only the UI stops using it. Its 15 tests must keep passing.

---

### Task 1: `logCall` — call logging without cadence

**Files:**
- Modify: `db/prospects.js` (add function + export)
- Test: `tests/prospects-db.test.js` (append)

**Interfaces:**
- Consumes: existing `getProspectById`, `logActivity`, `touch`, `getDb`.
- Produces: `logCall(prospect_id, { outcome, notes?, channel?, rep? }) -> prospect row`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/prospects-db.test.js
test('logCall logs an activity and moves stage on connected, without scheduling', () => {
  const r = p.createProspect({ business_name: 'Ben Ross Roofing', city: 'Charlotte', phone: '7045550148' });
  const after = p.logCall(r.id, { outcome: 'connected', notes: 'talked to owner' });
  expect(after.stage).toBe('connected');
  expect(after.next_touch_at).toBeNull();
  const acts = p.getActivities(r.id);
  expect(acts).toHaveLength(1);
  expect(acts[0].outcome).toBe('connected');
});

test('logCall bumps a new lead to attempting on a plain outcome', () => {
  const r = p.createProspect({ business_name: 'Amen Plumbing', city: 'Charlotte', phone: '7045550149' });
  expect(p.logCall(r.id, { outcome: 'no_answer' }).stage).toBe('attempting');
});

test('logCall moves not_interested to dead_nurture', () => {
  const r = p.createProspect({ business_name: 'Top Cut Tree', city: 'Charlotte', phone: '7045550150' });
  expect(p.logCall(r.id, { outcome: 'not_interested' }).stage).toBe('dead_nurture');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-db.test.js -t logCall`
Expected: FAIL — `p.logCall is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` (after `recordTouch`, before `toSqlUtc`):

```js
// Call logging that does NOT schedule a next touch. recordTouch (the cadence path) stays
// dormant; this is what the detail page calls. Stage moves only on outcomes that mean it.
const STAGE_ON_LOG = {
  connected: 'connected',
  meeting_set: 'meeting_set',
  not_interested: 'dead_nurture',
};

function logCall(prospect_id, { outcome, notes = null, channel = 'call', rep = 'Dillon' } = {}) {
  const before = getProspectById(prospect_id);
  if (!before) throw new Error(`No prospect ${prospect_id}`);

  logActivity({ prospect_id, type: channel, outcome, notes, rep });

  const stage = STAGE_ON_LOG[outcome] || (before.stage === 'new' ? 'attempting' : before.stage);
  getDb().prepare('UPDATE prospects SET stage = ? WHERE id = ?').run(stage, prospect_id);
  return touch(prospect_id);
}
```

Add `logCall` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/prospects-db.test.js -t logCall`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/prospects-db.test.js
git commit -m "feat: add logCall — call logging without cadence scheduling"
```

---

### Task 2: `saveProspectEdits` — the human edit path

**Files:**
- Modify: `db/prospects.js` (add function + export)
- Test: `tests/prospects-db.test.js` (append)

**Interfaces:**
- Consumes: `getProspectById`, `touch`, `getDb`, `normalizePhone`, `dedupeKey`, existing `USER_FIELDS`.
- Produces: `saveProspectEdits(id, fields) -> prospect row | undefined`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/prospects-db.test.js
test('saveProspectEdits writes allowed fields and recomputes derived keys', () => {
  const r = p.createProspect({ business_name: 'Old Name', city: 'Concord', phone: '7045550000' });
  const after = p.saveProspectEdits(r.id, { business_name: 'New Name', city: 'Charlotte', phone: '(704) 555-1111', notes: 'call after 3pm' });
  expect(after.business_name).toBe('New Name');
  expect(after.notes).toBe('call after 3pm');
  expect(after.dedupe_key).toBe('new name|charlotte');
  expect(after.phone_normalized).toBe('7045551111');
});

test('saveProspectEdits ignores grade, status, and disqualified_reason', () => {
  const r = p.createProspect({ business_name: 'Guard Co', city: 'Charlotte', phone: '7045550002' });
  const after = p.saveProspectEdits(r.id, { grade: 'good', status: 'qualified', disqualified_reason: 'x', hook: 'edited hook' });
  expect(after.hook).toBe('edited hook');
  expect(after.grade).toBeNull();
  expect(after.status).toBe('new');
  expect(after.disqualified_reason).toBeNull();
});

test('saveProspectEdits marks a corrected review count as verified', () => {
  const r = p.createProspect({ business_name: 'Rev Co', city: 'Charlotte', phone: '7045550003', review_count: 150, review_verified: 0 });
  const after = p.saveProspectEdits(r.id, { review_count: 28 });
  expect(after.review_count).toBe(28);
  expect(after.review_verified).toBe(1);
  expect(after.review_source).toBe('manual');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-db.test.js -t saveProspectEdits`
Expected: FAIL — `p.saveProspectEdits is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` (after `updateResearch`). Note `USER_FIELDS` is already defined near the top of the file:

```js
// The human edit path. Reachable only from the detail-page Save. It may write identity,
// the research facts, and Dillon-owned columns — but never grade/status/disqualified_reason,
// which route through gradeProspect/disqualifyProspect so a rejection always carries a reason.
const EDITABLE_IDENTITY = ['business_name', 'trade', 'city', 'state', 'owner_name', 'phone', 'email', 'social'];
const EDITABLE_FACTS = ['website_url', 'website_quality', 'rating', 'review_count', 'review_source',
                        'est_year', 'est_year_note', 'segment', 'hook', 'runs_ads'];
const SAVEABLE = [...EDITABLE_IDENTITY, ...EDITABLE_FACTS, ...USER_FIELDS];

function saveProspectEdits(id, fields) {
  const before = getProspectById(id);
  if (!before) return undefined;
  const keys = Object.keys(fields).filter((k) => SAVEABLE.includes(k));
  if (keys.length === 0) return before;

  const set = {};
  for (const k of keys) set[k] = fields[k];

  // A hand-corrected review count is a confirmed Google read.
  if (keys.includes('review_count') && Number(fields.review_count) !== before.review_count) {
    set.review_verified = 1;
    if (!keys.includes('review_source')) set.review_source = 'manual';
  }
  // Recompute the derived keys when their inputs change.
  if (keys.includes('phone')) set.phone_normalized = normalizePhone(fields.phone);
  if (keys.includes('business_name') || keys.includes('city')) {
    const name = keys.includes('business_name') ? fields.business_name : before.business_name;
    const city = keys.includes('city') ? fields.city : before.city;
    set.dedupe_key = dedupeKey(name, city);
  }

  const cols = Object.keys(set);
  const assignments = cols.map((c) => `${c} = ?`).join(', ');
  getDb().prepare(`UPDATE prospects SET ${assignments} WHERE id = ?`).run(...cols.map((c) => set[c]), id);
  return touch(id);
}
```

Add `saveProspectEdits` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/prospects-db.test.js -t saveProspectEdits`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/prospects-db.test.js
git commit -m "feat: add saveProspectEdits — user-only field edits, verify-on-correct"
```

---

### Task 3: Contacts CRUD (db)

**Files:**
- Modify: `db/prospects.js` (add functions + exports)
- Test: `tests/contacts-db.test.js` (create)

**Interfaces:**
- Consumes: `getDb`.
- Produces: `getContacts(prospect_id)`, `getContactById(id)`, `createContact({...})`, `updateContact(id, fields)`, `deactivateContact(id)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/contacts-db.test.js
process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');

afterEach(() => db.closeDb());

function lead(over = {}) {
  return p.createProspect({ business_name: 'Ben Ross Roofing', city: 'Charlotte', phone: '7045550148', ...over });
}

test('createContact requires a name', () => {
  const r = lead();
  expect(() => p.createContact({ prospect_id: r.id, name: '   ' })).toThrow();
});

test('createContact and getContacts round-trip, scoped to the prospect', () => {
  const a = lead();
  const b = lead({ business_name: 'Other', phone: '7045550001' });
  p.createContact({ prospect_id: a.id, name: 'Mike Ross', role: 'owner', phone: '7045550148', is_decision_maker: 1 });
  p.createContact({ prospect_id: b.id, name: 'Someone Else' });
  const forA = p.getContacts(a.id);
  expect(forA).toHaveLength(1);
  expect(forA[0].name).toBe('Mike Ross');
  expect(forA[0].is_decision_maker).toBe(1);
});

test('updateContact edits fields', () => {
  const r = lead();
  const c = p.createContact({ prospect_id: r.id, name: 'Mike' });
  const updated = p.updateContact(c.id, { role: 'owner', is_gatekeeper: 1 });
  expect(updated.role).toBe('owner');
  expect(updated.is_gatekeeper).toBe(1);
});

test('deactivateContact hides without deleting', () => {
  const r = lead();
  const c = p.createContact({ prospect_id: r.id, name: 'Gone' });
  const after = p.deactivateContact(c.id);
  expect(after.is_active).toBe(0);
  expect(p.getContactById(c.id)).toBeTruthy(); // row still there
});

test('there is no deleteContact export', () => {
  expect(p.deleteContact).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/contacts-db.test.js`
Expected: FAIL — `p.createContact is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` (after `getActivities`):

```js
// Contacts — the people at a business. Append-only like everything else: a contact who
// leaves gets is_active = 0. There is deliberately no deleteContact.
function getContacts(prospect_id) {
  return getDb().prepare(
    'SELECT * FROM contacts WHERE prospect_id = ? ORDER BY is_active DESC, created_at DESC, id DESC'
  ).all(prospect_id);
}

function getContactById(id) {
  return getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
}

function createContact({ prospect_id, name, role = null, phone = null, email = null,
                         is_decision_maker = 0, is_gatekeeper = 0, notes = null }) {
  if (!name || !String(name).trim()) throw new Error('A contact needs a name.');
  const result = getDb().prepare(`
    INSERT INTO contacts (prospect_id, name, role, phone, email, is_decision_maker, is_gatekeeper, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(prospect_id, String(name).trim(), role, phone, email,
         is_decision_maker ? 1 : 0, is_gatekeeper ? 1 : 0, notes);
  return getContactById(result.lastInsertRowid);
}

const CONTACT_FIELDS = ['name', 'role', 'phone', 'email', 'is_decision_maker', 'is_gatekeeper', 'notes'];
function updateContact(id, fields) {
  const keys = Object.keys(fields).filter((k) => CONTACT_FIELDS.includes(k));
  if (keys.length === 0) return getContactById(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE contacts SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  return getContactById(id);
}

function deactivateContact(id) {
  getDb().prepare('UPDATE contacts SET is_active = 0 WHERE id = ?').run(id);
  return getContactById(id);
}
```

Add `getContacts, getContactById, createContact, updateContact, deactivateContact` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/contacts-db.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/contacts-db.test.js
git commit -m "feat: add contacts CRUD with append-only deactivate"
```

---

### Task 4: Routes — detail with contacts, save, log, contacts endpoints

**Files:**
- Modify: `routes/prospects.js`
- Test: `tests/prospects-api.test.js` (append; also check the `/stats` `due` assertion)

**Interfaces:**
- Consumes: Task 1–3 db functions.
- Produces: `GET /:id` (now returns `contacts`), `PATCH /:id`, `POST /:id/log`, `POST /:id/contacts`, `PATCH /:id/contacts/:contactId`, `POST /:id/contacts/:contactId/deactivate`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/prospects-api.test.js
test('GET /api/prospects/:id includes contacts', async () => {
  const row = lead();
  p.createContact({ prospect_id: row.id, name: 'Mike Ross', role: 'owner' });
  const res = await request(app).get(`/api/prospects/${row.id}`);
  expect(res.body.contacts).toHaveLength(1);
  expect(res.body.contacts[0].name).toBe('Mike Ross');
});

test('PATCH /api/prospects/:id saves edits and 404s on a bad id', async () => {
  const row = lead();
  const ok = await request(app).patch(`/api/prospects/${row.id}`).send({ hook: 'edited', notes: 'n' });
  expect(ok.status).toBe(200);
  expect(ok.body.hook).toBe('edited');
  const bad = await request(app).patch('/api/prospects/999999').send({ hook: 'x' });
  expect(bad.status).toBe(404);
});

test('POST /api/prospects/:id/log logs a call and rejects a bad outcome', async () => {
  const row = lead();
  const ok = await request(app).post(`/api/prospects/${row.id}/log`).send({ outcome: 'connected', notes: 'hi' });
  expect(ok.status).toBe(200);
  expect(ok.body.stage).toBe('connected');
  const bad = await request(app).post(`/api/prospects/${row.id}/log`).send({ outcome: 'nonsense' });
  expect(bad.status).toBe(400);
});

test('contacts create/update/deactivate round-trip over the API', async () => {
  const row = lead();
  const created = await request(app).post(`/api/prospects/${row.id}/contacts`).send({ name: 'Mike', role: 'owner' });
  expect(created.status).toBe(201);
  const cid = created.body.id;
  const upd = await request(app).patch(`/api/prospects/${row.id}/contacts/${cid}`).send({ is_decision_maker: 1 });
  expect(upd.body.is_decision_maker).toBe(1);
  const off = await request(app).post(`/api/prospects/${row.id}/contacts/${cid}/deactivate`).send();
  expect(off.body.is_active).toBe(0);
  const noName = await request(app).post(`/api/prospects/${row.id}/contacts`).send({ role: 'x' });
  expect(noName.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-api.test.js -t "includes contacts"`
Expected: FAIL — `res.body.contacts` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `routes/prospects.js`, replace the `GET /:id` handler and add the new routes before `module.exports`:

```js
router.get('/:id', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  res.json({ ...row, activities: p.getActivities(row.id), contacts: p.getContacts(row.id) });
});

router.patch('/:id', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  res.json(p.saveProspectEdits(row.id, req.body || {}));
});

router.post('/:id/log', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  const { outcome, notes, channel } = req.body || {};
  if (!OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` });
  }
  res.json(p.logCall(row.id, { outcome, notes: notes || null, channel: channel || 'call' }));
});

router.post('/:id/contacts', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'A contact needs a name.' });
  res.status(201).json(p.createContact({ prospect_id: row.id, ...req.body }));
});

router.patch('/:id/contacts/:contactId', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  res.json(p.updateContact(Number(req.params.contactId), req.body || {}));
});

router.post('/:id/contacts/:contactId/deactivate', (req, res) => {
  const row = findOr404(req, res);
  if (!row) return;
  res.json(p.deactivateContact(Number(req.params.contactId)));
});
```

Then drop `due` from the `/stats` handler:

```js
router.get('/stats', (_req, res) => {
  const all = p.getProspects();
  res.json({
    total: all.length,
    ungraded: all.filter((r) => r.status === 'new').length,
    qualified: all.filter((r) => r.status === 'qualified').length,
    disqualified: all.filter((r) => r.status === 'disqualified').length,
  });
});
```

- [ ] **Step 4: Update any stats test that asserted `due`, then run the suite**

Run: `grep -n "due" tests/prospects-api.test.js` — if a test asserts `res.body.due`, remove that one assertion (the `/due` route itself stays and keeps its own test).
Run: `npx jest tests/prospects-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/prospects.js tests/prospects-api.test.js
git commit -m "feat: add detail-with-contacts, save, log, and contacts routes"
```

---

### Task 5: Front-end — detail page + remove Due Today

**Files:**
- Modify: `public/pages/prospects.html`

**Interfaces:**
- Consumes: the Task 4 endpoints.
- Produces: no code interface; a working UI. Verified by driving the running app.

This task has no unit test (the codebase has no front-end test harness for these inline-script pages, matching `assets.html`). It is verified end-to-end in Task 6.

- [ ] **Step 1: Remove Due Today from the view model**

In the `<script>` IIFE:
- Delete the `due` entry from `VIEWS`.
- Change `let view = 'due';` to `let view = 'pipeline';`.
- In `renderStats`, remove the `['due', ...]` stat row and the `due:` key from the tab-count map; delete the `.stat.due` reliance (leave the CSS, it just goes unused).
- In `load()`, delete the `if (view === 'due')` branch and its `/api/prospects/due` fetch.
- Delete the `renderDue` function.
- Update the static `<h1 id="pTitle">` / `<div id="pDek">` defaults to the pipeline copy (`Pipeline` / `Everything in flight, by stage.`).

- [ ] **Step 2: Make every lead card open the detail page**

Add a module-level `let detailId = null;` and a `prior` view memory. In the existing `#pBody` click handler, before the grade/outcome checks, add:

```js
const openable = e.target.closest('[data-open]');
if (openable && !e.target.closest('button')) {
  detailId = Number(openable.dataset.open);
  return loadDetail();
}
```

Give each rendered card `data-open="${r.id}"` and `style="cursor:pointer"` (the queue grade-card, pipeline cards, and pool cards). Buttons inside already stop the open via the `!closest('button')` guard.

- [ ] **Step 3: Add the detail render**

Add a `loadDetail()` that fetches `GET /api/prospects/${detailId}` and renders into `#pBody` (hide the tabs/stats while in detail, or leave them — the Back button drives navigation). Structure, using the existing `esc` / `fmtPhone` / `facts` helpers and brand classes:

```js
async function loadDetail() {
  const body = document.getElementById('pBody');
  document.getElementById('pStats').innerHTML = '';
  document.getElementById('pTabs').innerHTML = '';
  document.getElementById('pTitle').textContent = 'Lead';
  document.getElementById('pDek').textContent = '';
  body.innerHTML = '<div class="empty">Loading…</div>';
  const r = await api(`/api/prospects/${detailId}`);
  body.innerHTML = detailHtml(r);
  wireDetail(r);
}
```

`detailHtml(r)` renders:
- A `‹ Back` button (`data-back`).
- Header: `business_name`, `trade · city · segment`, a grade/status pill.
- Call bar: `<a class="phone" href="tel:…">` + `Call` and `Copy` buttons (`Copy` uses `copyToClipboard(r.phone)`).
- An **edit form** (`<input>` per fact: rating, review_count, est_year, website_url, website_quality `<select>` none/basic/good/unknown, runs_ads `<select>`, segment, hook `<textarea>`; plus identity: owner_name, email, social) and a **Save** button (`data-save`).
- **Contacts:** `r.contacts.filter(c=>c.is_active)` each with name/role, phone Call/Copy, decision-maker/gatekeeper tags, an `Edit`/`Remove` (`data-deactivate`); plus an **+ Add contact** inline form (name required).
- **Notes:** a `<textarea>` bound into the same Save.
- **Log a call:** the outcome buttons `no_answer/voicemail/gatekeeper/connected/callback/meeting_set/not_interested` (`data-logout`), each `POST /:id/log` then refresh.
- **Call log:** `r.activities` newest-first, read-only.
- If `r.status === 'new'`: the 👍/🤷/👎 grade block (reuse the queue's `grade()` with a required why on 👎).

`wireDetail(r)` attaches handlers:
- `data-back` → `detailId = null; load();`
- `data-save` → collect the form fields into an object, `PATCH /api/prospects/${r.id}`, `showToast('Saved')`, `loadDetail()`.
- add-contact submit → `POST /api/prospects/${r.id}/contacts`, then `loadDetail()`.
- `data-deactivate` → `POST …/contacts/${cid}/deactivate`, then `loadDetail()`.
- `data-logout` → `POST …/log` with `{ outcome }` (prompt for notes on `connected`/`meeting_set`), then `loadDetail()`.
- grade buttons → existing `grade()`, then `loadDetail()`.

Reuse existing styles; add only small structural CSS if needed (e.g. `.prospects .detail-grid`, form input spacing) inside the existing `<style>` block, scoped under `.prospects`.

- [ ] **Step 4: Manual smoke in the browser** — deferred to Task 6 (kept as one verification pass).

- [ ] **Step 5: Commit**

```bash
git add public/pages/prospects.html
git commit -m "feat: lead detail page with edit, contacts, and call logging; remove Due Today"
```

---

### Task 6: Full regression + end-to-end verification

**Files:** none (verification only), plus fixups if anything fails.

- [ ] **Step 1: Run the whole suite**

Run: `npx jest`
Expected: all green, including the dormant cadence tests (`cadence-db.test.js`) and `getDueToday`/`/due`/`/touch`.

- [ ] **Step 2: Drive the running app**

Start the server (`node server.js`), then in the browser:
1. Prospecting opens on **Pipeline**; no Due Today tab; stats show no "due today".
2. Click a lead → detail page; `‹ Back` returns to Pipeline.
3. Edit the review count to a new number → Save → reopen → shows the new count and a **verified** badge.
4. Add a contact (name + phone) → it appears; Call/Copy work; Remove hides it.
5. Log a `Connected` call → it appears in the call log; the lead's stage moves.
6. From a `new` lead's detail, grade 👍 → it leaves the Queue and joins the Pipeline.

- [ ] **Step 3: If clean, use the `verify` skill for a recorded pass, then final commit**

```bash
git add -A
git commit -m "chore: Round 1 verification pass — detail page working end to end"
```

## Self-Review notes

- **Spec coverage:** Due Today removal (T5), detail page (T5), hand-editing via user-only path (T2/T4), verify-on-correct (T2), contacts CRUD (T3/T4), call logging without cadence (T1/T4), grade-from-detail (T5). All spec sections map to a task.
- **Never-delete:** asserted in T3 (`deleteContact` undefined; deactivate keeps the row) and preserved elsewhere (no delete added).
- **Type consistency:** `logCall`, `saveProspectEdits`, `getContacts/createContact/updateContact/deactivateContact/getContactById` names are identical across db, routes, and tests.
- **Dormant code stays:** T6 explicitly re-runs the cadence tests; no cadence function is removed.
