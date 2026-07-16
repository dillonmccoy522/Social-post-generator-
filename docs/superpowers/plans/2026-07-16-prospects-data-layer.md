# Prospects CRM — Plan 1: Data Layer & Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the append-only prospect data layer and import all 30 recovered leads, so prospecting data lives in SQLite where deletion is structurally impossible.

**Architecture:** Four new SQLite tables behind a focused `db/prospects.js` module that borrows the shared `getDb()` connection from `database.js`. Schema creation lives in `db/prospects-schema.js`, called from `database.js`'s existing `initSchema()`. No delete path exists anywhere in the module. A one-time idempotent script imports `data/seed/prospects-seed.json` (already committed).

**Tech Stack:** Node 18+, Express 4, better-sqlite3 12, Jest 29 + supertest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-16-prospects-crm-design.md`

**Plan sequence:** This is Plan 1 of 3. Plan 2 is API + screens; Plan 3 is the sourcing run. Plans 2 and 3 get written after this one lands.

## Global Constraints

Every task's requirements implicitly include this section.

- **Nothing is ever deleted.** No `deleteProspect`, `deleteActivity`, or equivalent may exist in any module in this plan. Retirement is `status='disqualified'` plus a `disqualified_reason`. This is asserted by tests, not left to convention.
- **Dillon-owned columns are never machine-written:** `grade`, `grade_why`, `stage`, `rep`, `next_action`, `next_date`, `notes`. Only an explicit user-action function may write them. No bulk/research writer may touch them.
- **Never use owner race or ethnicity** as a selection, exclusion, or stored factor. Business signals only.
- **Never invent data.** Unverifiable fields are `null` plus a flag. `review_verified` defaults to `0` and only ever flips on a confirmed Google read.
- **UI copy** (Plan 2, noted here for continuity) follows Niewdel brand voice: advisor not salesperson, lead with the outcome, short sentences, contractions fine, **no em-dashes**. Banned words: world-class, cutting-edge, game-changing, guru, "innovative solutions", "solutions provider".
- **Follow existing codebase patterns:** `CREATE TABLE IF NOT EXISTS` in schema init, `migrate*` functions for later column additions, `getX`/`createX`/`updateX` naming, tests set `process.env.DB_PATH = ':memory:'` at the top and call `db.closeDb()` in `afterEach`.
- **No new npm dependencies in this plan.**
- **The baseline is RED. Do not chase it, do not fix it.** `main` already fails exactly two tests before any work in this plan, both in files this plan never touches:
  - `tests/drive.test.js` "returns 503 when not configured" gets 502. It clears the `GOOGLE_*` env vars in `afterEach` but never before the first test, and `dotenv` loads the real `.env` at require time. Red only on a machine with populated Drive credentials.
  - `tests/stats.test.js` "counts and orders activity" expects `postsThisWeek` 1, gets 0. It hard-codes `created_at = '2026-07-09 10:00:00'` against a rolling `datetime('now','-7 days')` window, which aged out on 2026-07-16.

  **The gate for every `npm test` step in this plan is: exactly these two failures and no more.** A third failure is ours. These two are tracked as separate follow-ups; fixing them here would mix unrelated files into this branch's diff.

## Decisions this plan locks in (refinements to the spec)

1. **`db/prospects.js` rather than growing `database.js`.** `database.js` is 241 lines and owns clients/posts/assets. Four tables plus CRUD plus cadence would roughly triple it. `database.js` remains the single owner of `getDb()`; `db/prospects.js` imports it. `db/prospects-schema.js` exports a pure `initProspectsSchema(db)` with no imports back, so there is no circular require.
2. **`est_year` splits into `est_year` INTEGER and `est_year_note` TEXT.** The sheet holds `2014`, `~2023`, and `unknown ⚠` in one column. The age post-filter needs a number; the provenance nuance still matters. `~2023` becomes `est_year=2023, est_year_note='approximate'`. `unknown ⚠` becomes `est_year=NULL, est_year_note='unknown'`.
3. **Seed is JSON, not xlsx.** `data/seed/prospects-seed.json` is committed. No spreadsheet parser is added to the Node app.

## File Structure

| File | Responsibility |
|---|---|
| `db/prospects-schema.js` (create) | `initProspectsSchema(db)` — the four `CREATE TABLE IF NOT EXISTS` statements, indexes, and cadence seed. Pure; imports nothing. |
| `db/prospects.js` (create) | Prospect/activity/cadence/run CRUD. Imports `getDb` from `../database`. No delete path. |
| `lib/normalize.js` (create) | `normalizePhone`, `dedupeKey`, `parseEstYear`. Pure functions, no db. |
| `database.js` (modify) | `initSchema()` calls `initProspectsSchema(db)`. One line plus a require. |
| `scripts/import-prospects.js` (create) | One-time idempotent import of the JSON seed. |
| `tests/normalize.test.js` (create) | Pure-function tests. |
| `tests/prospects-db.test.js` (create) | Prospect CRUD, never-delete, grade/status, dedupe. |
| `tests/activities-db.test.js` (create) | Append-only activity log. |
| `tests/cadence-db.test.js` (create) | Cadence advance and `next_touch_at`. |
| `tests/import-prospects.test.js` (create) | Migration correctness against the real seed. |

---

### Task 1: Normalization helpers

**Files:**
- Create: `lib/normalize.js`
- Test: `tests/normalize.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizePhone(raw: string|null) => string|null` — digits only, strips a leading US `1`, returns `null` if fewer than 10 digits remain
  - `dedupeKey(name: string, city: string|null) => string` — `lower(trim(name))|lower(trim(city))`, collapsed whitespace
  - `parseEstYear(raw: string|null) => { year: number|null, note: string|null }`

- [ ] **Step 1: Write the failing test**

Create `tests/normalize.test.js`:

```javascript
const { normalizePhone, dedupeKey, parseEstYear } = require('../lib/normalize');

test('normalizePhone strips formatting to digits', () => {
  expect(normalizePhone('(980) 436-7390')).toBe('9804367390');
  expect(normalizePhone('980.436.7390')).toBe('9804367390');
  expect(normalizePhone('980-436-7390')).toBe('9804367390');
});

test('normalizePhone strips a leading US country code', () => {
  expect(normalizePhone('+1 (980) 436-7390')).toBe('9804367390');
  expect(normalizePhone('19804367390')).toBe('9804367390');
});

test('normalizePhone returns null for unusable input', () => {
  expect(normalizePhone(null)).toBeNull();
  expect(normalizePhone('')).toBeNull();
  expect(normalizePhone('call the office')).toBeNull();
  expect(normalizePhone('555-1234')).toBeNull();
});

test('dedupeKey is case and whitespace insensitive', () => {
  expect(dedupeKey('CR Weavers Heating & Cooling', 'Kannapolis'))
    .toBe(dedupeKey('  cr weavers   heating & cooling ', 'KANNAPOLIS'));
});

test('dedupeKey tolerates a missing city', () => {
  expect(dedupeKey('Boss Wash', null)).toBe('boss wash|');
});

test('parseEstYear reads an exact year', () => {
  expect(parseEstYear('2014')).toEqual({ year: 2014, note: null });
});

test('parseEstYear marks an approximate year', () => {
  expect(parseEstYear('~2023')).toEqual({ year: 2023, note: 'approximate' });
  expect(parseEstYear('~2011-16 ⚠')).toEqual({ year: 2011, note: 'approximate' });
});

test('parseEstYear marks unknown without inventing a year', () => {
  expect(parseEstYear('unknown ⚠')).toEqual({ year: null, note: 'unknown' });
  expect(parseEstYear(null)).toEqual({ year: null, note: 'unknown' });
  expect(parseEstYear('')).toEqual({ year: null, note: 'unknown' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/normalize.test.js`
Expected: FAIL with `Cannot find module '../lib/normalize'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/normalize.js`:

```javascript
// Pure helpers for prospect identity. No database access.

// Digits only, minus a leading US country code. Null when there is no usable number.
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

// Fallback identity when a lead has no phone.
function dedupeKey(name, city) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(name)}|${norm(city)}`;
}

// The sheet mixes "2014", "~2023", "~2011-16 ⚠" and "unknown ⚠" in one column.
// The age filter needs a number; the uncertainty still has to be recorded, never guessed away.
function parseEstYear(raw) {
  if (!raw) return { year: null, note: 'unknown' };
  const s = String(raw).trim();
  const match = s.match(/(19|20)\d{2}/);
  if (!match) return { year: null, note: 'unknown' };
  const year = Number(match[0]);
  const approximate = s.includes('~') || /\d{4}\s*-\s*\d{2}/.test(s);
  return { year, note: approximate ? 'approximate' : null };
}

module.exports = { normalizePhone, dedupeKey, parseEstYear };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/normalize.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/normalize.js tests/normalize.test.js
git commit -m "feat: add prospect normalization helpers"
```

---

### Task 2: Schema

**Files:**
- Create: `db/prospects-schema.js`
- Modify: `database.js` (add require at top; call `initProspectsSchema(db)` at the end of `initSchema`)
- Test: `tests/prospects-db.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `initProspectsSchema(db)` — creates `sourcing_runs`, `prospects`, `activities`, `cadence_steps`, their indexes, and seeds the 9 cadence steps. Idempotent.

- [ ] **Step 1: Write the failing test**

Create `tests/prospects-db.test.js`:

```javascript
process.env.DB_PATH = ':memory:';
const db = require('../database');

afterEach(() => {
  db.closeDb();
});

test('initSchema creates the prospect tables', () => {
  const d = db.getDb();
  const names = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  expect(names).toEqual(expect.arrayContaining(['prospects', 'activities', 'cadence_steps', 'sourcing_runs']));
});

test('cadence_steps seeds the nine-touch Playbook', () => {
  const d = db.getDb();
  const steps = d.prepare('SELECT * FROM cadence_steps ORDER BY step_number').all();
  expect(steps).toHaveLength(9);
  expect(steps[0]).toMatchObject({ step_number: 1, day_offset: 0, channel: 'call' });
  expect(steps[8]).toMatchObject({ step_number: 9, day_offset: 15, channel: 'email' });
});

test('cadence seed is idempotent across re-init', () => {
  db.getDb();
  db.closeDb();
  const d = db.getDb();
  expect(d.prepare('SELECT COUNT(*) AS n FROM cadence_steps').get().n).toBe(9);
});

test('prospects rejects an unknown status', () => {
  const d = db.getDb();
  expect(() =>
    d.prepare("INSERT INTO prospects (business_name, status) VALUES ('X', 'bogus')").run()
  ).toThrow();
});

test('prospects rejects an unknown stage', () => {
  const d = db.getDb();
  expect(() =>
    d.prepare("INSERT INTO prospects (business_name, stage) VALUES ('X', 'bogus')").run()
  ).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-db.test.js`
Expected: FAIL — `prospects` is not in the table list

- [ ] **Step 3: Write minimal implementation**

Create `db/prospects-schema.js`:

```javascript
// Schema for the prospecting CRM. Pure: takes a db handle, imports nothing.
// Called from database.js initSchema so there is one connection and no require cycle.

// The Playbook cadence, as data. Source: the call-sheet's Playbook tab.
const CADENCE = [
  { step_number: 1, day_offset: 0,  channel: 'call',  label: 'First call + intro email' },
  { step_number: 2, day_offset: 1,  channel: 'call',  label: 'Second call' },
  { step_number: 3, day_offset: 3,  channel: 'dm',    label: 'DM / social touch' },
  { step_number: 4, day_offset: 4,  channel: 'call',  label: 'Third call' },
  { step_number: 5, day_offset: 6,  channel: 'email', label: 'Free audit email' },
  { step_number: 6, day_offset: 8,  channel: 'call',  label: 'Fourth call' },
  { step_number: 7, day_offset: 11, channel: 'sms',   label: 'DM / SMS' },
  { step_number: 8, day_offset: 13, channel: 'call',  label: '"Close your file?" call' },
  { step_number: 9, day_offset: 15, channel: 'email', label: 'Breakup email' },
];

function initProspectsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sourcing_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filters TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','done','failed')),
      requested_count INTEGER NOT NULL DEFAULT 0,
      searched_count INTEGER NOT NULL DEFAULT 0,
      dupe_count INTEGER NOT NULL DEFAULT 0,
      enriched_count INTEGER NOT NULL DEFAULT 0,
      passed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      business_name TEXT NOT NULL,
      trade TEXT DEFAULT NULL,
      city TEXT DEFAULT NULL,
      state TEXT DEFAULT 'NC',
      owner_name TEXT DEFAULT NULL,
      phone TEXT DEFAULT NULL,
      email TEXT DEFAULT NULL,
      social TEXT DEFAULT NULL,

      website_url TEXT DEFAULT NULL,
      website_quality TEXT DEFAULT 'unknown'
        CHECK (website_quality IN ('none','basic','good','unknown')),
      rating REAL DEFAULT NULL,
      review_count INTEGER DEFAULT NULL,
      review_source TEXT DEFAULT NULL,
      review_verified INTEGER NOT NULL DEFAULT 0,
      runs_ads TEXT NOT NULL DEFAULT 'unknown'
        CHECK (runs_ads IN ('google','meta','both','no','unknown')),
      est_year INTEGER DEFAULT NULL,
      est_year_note TEXT DEFAULT NULL,
      segment TEXT DEFAULT NULL,
      hook TEXT DEFAULT NULL,

      grade TEXT DEFAULT NULL CHECK (grade IN ('good','bad','maybe') OR grade IS NULL),
      grade_why TEXT DEFAULT NULL,
      stage TEXT NOT NULL DEFAULT 'new'
        CHECK (stage IN ('new','attempting','connected','meeting_set','proposal','won','dead_nurture')),
      rep TEXT DEFAULT NULL,
      next_action TEXT DEFAULT NULL,
      next_date DATE DEFAULT NULL,
      notes TEXT DEFAULT NULL,

      status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','qualified','disqualified')),
      disqualified_reason TEXT DEFAULT NULL,

      cadence_step INTEGER NOT NULL DEFAULT 0,
      next_touch_at DATETIME DEFAULT NULL,

      source_run_id INTEGER DEFAULT NULL REFERENCES sourcing_runs(id),
      source_kind TEXT NOT NULL DEFAULT 'hand'
        CHECK (source_kind IN ('hand','sheet','agent','provider')),
      source_urls TEXT DEFAULT NULL,

      phone_normalized TEXT DEFAULT NULL,
      dedupe_key TEXT NOT NULL,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_prospects_phone ON prospects(phone_normalized);
    CREATE INDEX IF NOT EXISTS idx_prospects_dedupe ON prospects(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS idx_prospects_touch ON prospects(next_touch_at);

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER NOT NULL REFERENCES prospects(id),
      type TEXT NOT NULL
        CHECK (type IN ('call','email','dm','sms','note','stage_change')),
      outcome TEXT DEFAULT NULL
        CHECK (outcome IN ('no_answer','voicemail','gatekeeper','connected','callback',
                           'not_interested','meeting_set') OR outcome IS NULL),
      notes TEXT DEFAULT NULL,
      rep TEXT DEFAULT NULL,
      cadence_step INTEGER DEFAULT NULL,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospect_id);

    CREATE TABLE IF NOT EXISTS cadence_steps (
      step_number INTEGER PRIMARY KEY,
      day_offset INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('call','email','dm','sms')),
      label TEXT NOT NULL
    );
  `);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO cadence_steps (step_number, day_offset, channel, label) VALUES (?, ?, ?, ?)'
  );
  for (const s of CADENCE) insert.run(s.step_number, s.day_offset, s.channel, s.label);
}

module.exports = { initProspectsSchema, CADENCE };
```

Modify `database.js`. Add near the other requires at the top:

```javascript
const { initProspectsSchema } = require('./db/prospects-schema');
```

And at the end of `initSchema(db)`, after the existing `migrateClientsDriveColumns(db);` line:

```javascript
  initProspectsSchema(db);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/prospects-db.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the full suite to prove no regression**

Run: `npm test`
Expected: exactly the two known baseline failures (`drive.test.js`, `stats.test.js`) and no others. The new schema must not disturb clients/posts/assets. A third failure is ours.

- [ ] **Step 6: Commit**

```bash
git add db/prospects-schema.js database.js tests/prospects-db.test.js
git commit -m "feat: add prospects CRM schema with seeded cadence"
```

---

### Task 3: Prospect create and read, with dedupe

**Files:**
- Create: `db/prospects.js`
- Test: `tests/prospects-db.test.js` (append)

**Interfaces:**
- Consumes: `getDb` from `../database`; `normalizePhone`, `dedupeKey` from `../lib/normalize`
- Produces:
  - `createProspect(fields) => prospect` — derives `phone_normalized` and `dedupe_key`
  - `getProspectById(id) => prospect|undefined`
  - `getProspects({ status, stage, trade, city } = {}) => prospect[]`
  - `findDuplicate({ phone, business_name, city }) => prospect|undefined` — phone match first, then name+city

- [ ] **Step 1: Write the failing test**

Append to `tests/prospects-db.test.js`:

```javascript
const p = require('../db/prospects');

test('createProspect derives dedupe fields', () => {
  const row = p.createProspect({
    business_name: 'Arctic Desert Cooling & Heating',
    trade: 'HVAC',
    city: 'Concord',
    phone: '(980) 436-7390',
  });
  expect(row.id).toBeDefined();
  expect(row.phone_normalized).toBe('9804367390');
  expect(row.dedupe_key).toBe('arctic desert cooling & heating|concord');
  expect(row.status).toBe('new');
  expect(row.stage).toBe('new');
  expect(row.review_verified).toBe(0);
});

test('findDuplicate matches on phone across formats', () => {
  p.createProspect({ business_name: 'Boss Wash', city: 'Concord', phone: '(980) 334-0232' });
  const hit = p.findDuplicate({ phone: '+1 980.334.0232', business_name: 'Different Name', city: 'Gastonia' });
  expect(hit).toBeDefined();
  expect(hit.business_name).toBe('Boss Wash');
});

test('findDuplicate falls back to name and city when there is no phone', () => {
  p.createProspect({ business_name: 'Top Cut Tree Expert', city: 'Rock Hill SC' });
  const hit = p.findDuplicate({ phone: null, business_name: '  top cut tree expert ', city: 'ROCK HILL SC' });
  expect(hit).toBeDefined();
});

test('findDuplicate still matches a disqualified lead so it is never re-added', () => {
  const row = p.createProspect({ business_name: 'Amen Plumbing', city: 'Rock Hill SC', phone: '(803) 555-0100' });
  p.disqualifyProspect(row.id, 'Roughly 150 reviews, too established');
  const hit = p.findDuplicate({ phone: '8035550100', business_name: 'Amen Plumbing', city: 'Rock Hill SC' });
  expect(hit).toBeDefined();
  expect(hit.status).toBe('disqualified');
});

test('getProspects filters by status', () => {
  p.createProspect({ business_name: 'A', city: 'Concord', phone: '7045550001' });
  const b = p.createProspect({ business_name: 'B', city: 'Concord', phone: '7045550002' });
  p.disqualifyProspect(b.id, 'Too old');
  expect(p.getProspects({ status: 'new' })).toHaveLength(1);
  expect(p.getProspects({ status: 'disqualified' })).toHaveLength(1);
  expect(p.getProspects()).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-db.test.js`
Expected: FAIL with `Cannot find module '../db/prospects'`

- [ ] **Step 3: Write minimal implementation**

Create `db/prospects.js`:

```javascript
// Prospect CRM data access.
//
// HARD RULE: this module has no delete path and never will. A lead retires via
// disqualifyProspect(), which sets a status and a reason and leaves the row in place.
// A rebuild once wiped this data in the Google Sheet; the absence of a delete
// function is the structural guarantee that it cannot happen here.
//
// Dillon-owned columns (grade, grade_why, stage, rep, next_action, next_date, notes)
// are only ever written by the explicit user-action functions in this module.
// updateResearch() cannot touch them.

const { getDb } = require('../database');
const { normalizePhone, dedupeKey } = require('../lib/normalize');

const RESEARCH_FIELDS = [
  'business_name', 'trade', 'city', 'state', 'owner_name', 'phone', 'email', 'social',
  'website_url', 'website_quality', 'rating', 'review_count', 'review_source',
  'review_verified', 'runs_ads', 'est_year', 'est_year_note', 'segment', 'hook',
  'source_run_id', 'source_kind', 'source_urls',
];

function getProspectById(id) {
  return getDb().prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}

function createProspect(fields) {
  const phone_normalized = normalizePhone(fields.phone);
  const key = dedupeKey(fields.business_name, fields.city);

  const cols = [];
  const vals = [];
  for (const f of RESEARCH_FIELDS) {
    if (fields[f] !== undefined) { cols.push(f); vals.push(fields[f]); }
  }
  // Seeded imports carry Dillon's own prior work; nothing else may set these.
  for (const f of ['grade', 'grade_why', 'stage', 'rep', 'next_action', 'next_date',
                   'notes', 'status', 'disqualified_reason']) {
    if (fields[f] !== undefined) { cols.push(f); vals.push(fields[f]); }
  }
  cols.push('phone_normalized', 'dedupe_key');
  vals.push(phone_normalized, key);

  const placeholders = cols.map(() => '?').join(', ');
  const result = getDb()
    .prepare(`INSERT INTO prospects (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...vals);
  return getProspectById(result.lastInsertRowid);
}

// Phone is the strong signal; name+city is the fallback when a lead has no number.
// Deliberately searches every status, so a disqualified lead is never re-added.
function findDuplicate({ phone, business_name, city }) {
  const d = getDb();
  const normalized = normalizePhone(phone);
  if (normalized) {
    const byPhone = d.prepare('SELECT * FROM prospects WHERE phone_normalized = ?').get(normalized);
    if (byPhone) return byPhone;
  }
  return d.prepare('SELECT * FROM prospects WHERE dedupe_key = ?').get(dedupeKey(business_name, city));
}

function getProspects({ status, stage, trade, city } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (stage) { where.push('stage = ?'); params.push(stage); }
  if (trade) { where.push('trade = ?'); params.push(trade); }
  if (city) { where.push('city = ?'); params.push(city); }
  return getDb().prepare(`
    SELECT * FROM prospects
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, id DESC
  `).all(...params);
}

module.exports = { createProspect, getProspectById, getProspects, findDuplicate };
```

- [ ] **Step 4: Run test to verify it fails on the missing disqualify function**

Run: `npx jest tests/prospects-db.test.js`
Expected: FAIL with `p.disqualifyProspect is not a function`. This is expected — Task 4 adds it. Steps 5 and 6 of this task are deferred until Task 4 lands; do not commit a red suite.

- [ ] **Step 5: Proceed directly to Task 4**

Task 3 and Task 4 share a test file and are committed together at the end of Task 4. This is deliberate: `findDuplicate` cannot be honestly tested against a disqualified lead without `disqualifyProspect` existing.

---

### Task 4: Grading and disqualification (the never-delete path)

**Files:**
- Modify: `db/prospects.js`
- Test: `tests/prospects-db.test.js` (append)

**Interfaces:**
- Consumes: everything from Task 3
- Produces:
  - `gradeProspect(id, { grade, grade_why }) => prospect` — `good`/`maybe` set `status='qualified'`; `bad` throws (use `disqualifyProspect`)
  - `disqualifyProspect(id, reason) => prospect` — `status='disqualified'`, `grade='bad'`, requires a non-empty reason
  - `updateResearch(id, fields) => prospect` — writes only `RESEARCH_FIELDS`, silently ignores Dillon-owned keys

- [ ] **Step 1: Write the failing test**

Append to `tests/prospects-db.test.js`:

```javascript
test('a good grade qualifies the lead', () => {
  const row = p.createProspect({ business_name: 'Pearson Electrical Service', city: 'Concord', phone: '7047738676' });
  const graded = p.gradeProspect(row.id, { grade: 'good', grade_why: 'Dead site plus a 4.2 rating' });
  expect(graded.grade).toBe('good');
  expect(graded.status).toBe('qualified');
});

test('a maybe grade also qualifies, because borderline is still callable', () => {
  const row = p.createProspect({ business_name: 'CR Weavers Heating & Cooling', city: 'Kannapolis', phone: '7042530221' });
  const graded = p.gradeProspect(row.id, { grade: 'maybe', grade_why: 'Borderline, either perfect or it is not' });
  expect(graded.status).toBe('qualified');
});

test('gradeProspect refuses a bad grade and points at the disqualify path', () => {
  const row = p.createProspect({ business_name: 'X', city: 'Concord', phone: '7045550003' });
  expect(() => p.gradeProspect(row.id, { grade: 'bad', grade_why: 'nope' })).toThrow(/disqualifyProspect/);
});

test('disqualifyProspect keeps the row and requires a reason', () => {
  const row = p.createProspect({ business_name: 'Dedicated Heating and Air', city: 'Rock Hill SC', phone: '8035550111' });
  const out = p.disqualifyProspect(row.id, '365 reviews, too established');
  expect(out.status).toBe('disqualified');
  expect(out.grade).toBe('bad');
  expect(out.disqualified_reason).toBe('365 reviews, too established');
  expect(p.getProspectById(row.id)).toBeDefined();
});

test('disqualifyProspect rejects an empty reason', () => {
  const row = p.createProspect({ business_name: 'Y', city: 'Concord', phone: '7045550004' });
  expect(() => p.disqualifyProspect(row.id, '')).toThrow(/reason/i);
  expect(() => p.disqualifyProspect(row.id, '   ')).toThrow(/reason/i);
});

test('NEVER-DELETE: the module exposes no delete path', () => {
  const exported = Object.keys(p).join(' ').toLowerCase();
  expect(exported).not.toMatch(/delete|destroy|remove|purge|drop/);
});

test('updateResearch cannot overwrite Dillon-owned columns', () => {
  const row = p.createProspect({ business_name: 'Gwinn Lawn Care', city: 'Gastonia', phone: '9802852055' });
  p.gradeProspect(row.id, { grade: 'good', grade_why: 'Strong reviews, template site' });
  const d = require('../database').getDb();
  d.prepare("UPDATE prospects SET stage='attempting', rep='Dillon' WHERE id = ?").run(row.id);

  const after = p.updateResearch(row.id, {
    review_count: 30,
    review_verified: 1,
    grade: 'bad',              // must be ignored
    grade_why: 'overwritten',  // must be ignored
    stage: 'new',              // must be ignored
    rep: null,                 // must be ignored
    notes: 'clobbered',        // must be ignored
  });

  expect(after.review_count).toBe(30);
  expect(after.review_verified).toBe(1);
  expect(after.grade).toBe('good');
  expect(after.grade_why).toBe('Strong reviews, template site');
  expect(after.stage).toBe('attempting');
  expect(after.rep).toBe('Dillon');
  expect(after.notes).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-db.test.js`
Expected: FAIL with `p.gradeProspect is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` above `module.exports`:

```javascript
function touch(id) {
  getDb().prepare('UPDATE prospects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return getProspectById(id);
}

// A good or maybe grade qualifies the lead. Maybe is still callable: "borderline,
// either perfect or it is not" is not a rejection.
function gradeProspect(id, { grade, grade_why = null }) {
  if (grade === 'bad') {
    throw new Error('A bad grade retires a lead. Use disqualifyProspect(id, reason) so the reason is recorded.');
  }
  if (!['good', 'maybe'].includes(grade)) {
    throw new Error(`Unknown grade: ${grade}`);
  }
  getDb().prepare(
    "UPDATE prospects SET grade = ?, grade_why = ?, status = 'qualified' WHERE id = ?"
  ).run(grade, grade_why, id);
  return touch(id);
}

// The only retirement path. The row is never removed.
function disqualifyProspect(id, reason) {
  if (!reason || !String(reason).trim()) {
    throw new Error('disqualifyProspect requires a reason. A rejection without a reason teaches us nothing.');
  }
  getDb().prepare(
    "UPDATE prospects SET status = 'disqualified', grade = 'bad', disqualified_reason = ? WHERE id = ?"
  ).run(String(reason).trim(), id);
  return touch(id);
}

// Machine-owned columns only. Dillon-owned keys are dropped on the floor by design,
// so no automated path can overwrite his work the way the sheet rebuild did.
function updateResearch(id, fields) {
  const keys = Object.keys(fields).filter((k) => RESEARCH_FIELDS.includes(k));
  if (keys.length === 0) return getProspectById(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE prospects SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  return touch(id);
}
```

Update the exports line:

```javascript
module.exports = {
  createProspect, getProspectById, getProspects, findDuplicate,
  gradeProspect, disqualifyProspect, updateResearch,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/prospects-db.test.js`
Expected: PASS, 17 tests (5 schema + 5 from Task 3 + 7 here)

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/prospects-db.test.js
git commit -m "feat: add prospect CRUD, grading, and the no-delete retirement path"
```

---

### Task 5: Activity log (append-only)

**Files:**
- Modify: `db/prospects.js`
- Test: `tests/activities-db.test.js`

**Interfaces:**
- Consumes: `getProspectById` from Task 3
- Produces:
  - `logActivity({ prospect_id, type, outcome, notes, rep, cadence_step }) => activity`
  - `getActivities(prospect_id) => activity[]` — newest first

- [ ] **Step 1: Write the failing test**

Create `tests/activities-db.test.js`:

```javascript
process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');

afterEach(() => {
  db.closeDb();
});

function lead() {
  return p.createProspect({ business_name: 'Electricians On the Go', city: 'Concord', phone: '7044531644' });
}

test('logActivity records a touch', () => {
  const row = lead();
  const act = p.logActivity({ prospect_id: row.id, type: 'call', outcome: 'no_answer', rep: 'Dillon', cadence_step: 1 });
  expect(act.id).toBeDefined();
  expect(act.type).toBe('call');
  expect(act.outcome).toBe('no_answer');
  expect(act.occurred_at).toBeDefined();
});

test('getActivities returns the history newest first', () => {
  const row = lead();
  p.logActivity({ prospect_id: row.id, type: 'call', outcome: 'no_answer' });
  p.logActivity({ prospect_id: row.id, type: 'call', outcome: 'connected', notes: 'Spoke to Cesar' });
  const history = p.getActivities(row.id);
  expect(history).toHaveLength(2);
  expect(history[0].outcome).toBe('connected');
});

test('logActivity rejects an unknown outcome', () => {
  const row = lead();
  expect(() => p.logActivity({ prospect_id: row.id, type: 'call', outcome: 'vibes' })).toThrow();
});

test('APPEND-ONLY: activities expose no update or delete path', () => {
  const exported = Object.keys(p).join(' ');
  expect(exported).not.toContain('updateActivity');
  expect(exported).not.toContain('deleteActivity');
});

test('a disqualified lead keeps its call history', () => {
  const row = lead();
  p.logActivity({ prospect_id: row.id, type: 'call', outcome: 'connected', notes: 'Not interested right now' });
  p.disqualifyProspect(row.id, 'Owner said not interested');
  expect(p.getActivities(row.id)).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/activities-db.test.js`
Expected: FAIL with `p.logActivity is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` above `module.exports`:

```javascript
// Append-only. There is deliberately no updateActivity or deleteActivity:
// the record of what happened on a call is immutable, and stage is a summary of it.
function logActivity({ prospect_id, type, outcome = null, notes = null, rep = null, cadence_step = null }) {
  const result = getDb().prepare(`
    INSERT INTO activities (prospect_id, type, outcome, notes, rep, cadence_step)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(prospect_id, type, outcome, notes, rep, cadence_step);
  return getDb().prepare('SELECT * FROM activities WHERE id = ?').get(result.lastInsertRowid);
}

function getActivities(prospect_id) {
  return getDb().prepare(
    'SELECT * FROM activities WHERE prospect_id = ? ORDER BY occurred_at DESC, id DESC'
  ).all(prospect_id);
}
```

Add `logActivity, getActivities` to the exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/activities-db.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/activities-db.test.js
git commit -m "feat: add append-only prospect activity log"
```

---

### Task 6: Cadence engine

**Files:**
- Modify: `db/prospects.js`
- Test: `tests/cadence-db.test.js`

**Interfaces:**
- Consumes: `logActivity`, `getProspectById`
- Produces:
  - `getCadence() => step[]`
  - `recordTouch(prospect_id, { outcome, notes, rep }) => prospect` — logs the activity, advances `cadence_step`, sets `next_touch_at`, applies outcome side effects
  - `getDueToday(now = new Date()) => Array<prospect & { touch: step }>`

Outcome side effects:

| Outcome | Effect |
|---|---|
| `no_answer`, `voicemail`, `gatekeeper` | advance a step, schedule the next touch |
| `connected` | advance a step, schedule the next touch, `stage='connected'` |
| `callback` | advance a step, schedule the next touch, `stage='attempting'` |
| `meeting_set` | `stage='meeting_set'`, clear `next_touch_at` (out of cadence) |
| `not_interested` | `stage='dead_nurture'`, clear `next_touch_at` |
| advancing past step 9 | `stage='dead_nurture'`, clear `next_touch_at` (auto-breakup) |

- [ ] **Step 1: Write the failing test**

Create `tests/cadence-db.test.js`:

```javascript
process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');

afterEach(() => {
  db.closeDb();
});

function qualified(name = 'MOWtivated Lawn Care') {
  const row = p.createProspect({ business_name: name, city: 'Matthews', phone: '7049998409' });
  return p.gradeProspect(row.id, { grade: 'good', grade_why: 'Webador template, no review system' });
}

test('getCadence returns the nine steps in order', () => {
  const steps = p.getCadence();
  expect(steps).toHaveLength(9);
  expect(steps.map((s) => s.step_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a no-answer advances the step and schedules the next touch', () => {
  const row = qualified();
  const after = p.recordTouch(row.id, { outcome: 'no_answer', rep: 'Dillon' });
  // cadence_step is the LAST COMPLETED step. Step 1 is now done, so step 2 is next due.
  expect(after.cadence_step).toBe(1);
  expect(after.next_touch_at).toBeTruthy();
  expect(p.getActivities(row.id)).toHaveLength(1);
  expect(p.getActivities(row.id)[0].cadence_step).toBe(1);
});

test('the next touch lands on the Playbook day offset', () => {
  const row = qualified();
  p.recordTouch(row.id, { outcome: 'no_answer' });          // step 1 (day 0) -> step 2 (day 1)
  const after = p.getProspectById(row.id);
  // SQLite datetimes are 'YYYY-MM-DD HH:MM:SS' in UTC. Date cannot parse that with a
  // bare 'Z' appended, so restore the ISO 'T' first.
  const due = new Date(after.next_touch_at.replace(' ', 'T') + 'Z');
  const delta = (due - Date.now()) / 86400000;
  expect(delta).toBeGreaterThan(0.5);
  expect(delta).toBeLessThan(1.5);
});

test('recordTouch refuses to run past the end of the cadence', () => {
  const row = qualified();
  for (let i = 0; i < 9; i++) p.recordTouch(row.id, { outcome: 'no_answer' });
  expect(() => p.recordTouch(row.id, { outcome: 'no_answer' })).toThrow(/finished the cadence/);
});

test('connected moves the stage and stays in cadence', () => {
  const row = qualified();
  const after = p.recordTouch(row.id, { outcome: 'connected', notes: 'Spoke to John' });
  expect(after.stage).toBe('connected');
  expect(after.next_touch_at).toBeTruthy();
});

test('meeting_set leaves the cadence', () => {
  const row = qualified();
  const after = p.recordTouch(row.id, { outcome: 'meeting_set' });
  expect(after.stage).toBe('meeting_set');
  expect(after.next_touch_at).toBeNull();
});

test('not_interested drops to nurture and leaves the cadence', () => {
  const row = qualified();
  const after = p.recordTouch(row.id, { outcome: 'not_interested' });
  expect(after.stage).toBe('dead_nurture');
  expect(after.next_touch_at).toBeNull();
});

test('AUTO-BREAKUP: nine touches with no connect ends the sequence', () => {
  const row = qualified();
  for (let i = 0; i < 9; i++) p.recordTouch(row.id, { outcome: 'no_answer' });
  const after = p.getProspectById(row.id);
  expect(after.stage).toBe('dead_nurture');
  expect(after.next_touch_at).toBeNull();
  expect(p.getActivities(row.id)).toHaveLength(9);
});

test('a retired lead keeps every touch on record', () => {
  const row = qualified();
  for (let i = 0; i < 9; i++) p.recordTouch(row.id, { outcome: 'no_answer' });
  expect(p.getProspectById(row.id)).toBeDefined();
  expect(p.getActivities(row.id)).toHaveLength(9);
});

test('getDueToday returns leads whose touch is due, with the touch attached', () => {
  const row = qualified();
  p.recordTouch(row.id, { outcome: 'no_answer' });
  expect(p.getDueToday(new Date())).toHaveLength(0);          // due tomorrow
  const tomorrow = new Date(Date.now() + 2 * 86400000);
  const due = p.getDueToday(tomorrow);
  expect(due).toHaveLength(1);
  expect(due[0].touch.step_number).toBe(2);
  expect(due[0].touch.channel).toBe('call');
});

test('getDueToday excludes ungraded and disqualified leads', () => {
  const ungraded = p.createProspect({ business_name: 'Ungraded', city: 'Concord', phone: '7045550009' });
  p.recordTouch(ungraded.id, { outcome: 'no_answer' });
  const bad = qualified('Bucket Hat Landscaping');
  p.recordTouch(bad.id, { outcome: 'no_answer' });
  p.disqualifyProspect(bad.id, 'Not a fit');
  const tomorrow = new Date(Date.now() + 2 * 86400000);
  expect(p.getDueToday(tomorrow)).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cadence-db.test.js`
Expected: FAIL with `p.getCadence is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` above `module.exports`:

```javascript
// Outcomes that end the sequence rather than advance it.
const EXIT_OUTCOMES = {
  meeting_set: 'meeting_set',
  not_interested: 'dead_nurture',
};

// Outcomes that advance the sequence and also move the stage.
const STAGE_ON_ADVANCE = {
  connected: 'connected',
  callback: 'attempting',
};

function getCadence() {
  return getDb().prepare('SELECT * FROM cadence_steps ORDER BY step_number').all();
}

// `cadence_step` is the number of the LAST COMPLETED step. 0 means never touched.
// The step that is next due is therefore cadence_step + 1. One meaning, everywhere.
function nextDueStep(steps, cadence_step) {
  return steps.find((s) => s.step_number === (cadence_step || 0) + 1);
}

// One tap from Due Today lands here: log it, advance the cadence, schedule the next touch.
function recordTouch(prospect_id, { outcome, notes = null, rep = null }) {
  const before = getProspectById(prospect_id);
  if (!before) throw new Error(`No prospect ${prospect_id}`);

  const steps = getCadence();
  const thisStep = nextDueStep(steps, before.cadence_step);
  if (!thisStep) {
    throw new Error(`Prospect ${prospect_id} has finished the cadence; there is no step to record.`);
  }

  logActivity({
    prospect_id,
    type: thisStep.channel,
    outcome,
    notes,
    rep,
    cadence_step: thisStep.step_number,
  });

  const d = getDb();

  if (EXIT_OUTCOMES[outcome]) {
    d.prepare('UPDATE prospects SET stage = ?, next_touch_at = NULL WHERE id = ?')
      .run(EXIT_OUTCOMES[outcome], prospect_id);
    return touch(prospect_id);
  }

  const nextStep = steps.find((s) => s.step_number === thisStep.step_number + 1);

  // Out of steps: the sequence breaks itself up rather than leaving a lead in limbo.
  if (!nextStep) {
    d.prepare(
      "UPDATE prospects SET cadence_step = ?, stage = 'dead_nurture', next_touch_at = NULL WHERE id = ?"
    ).run(thisStep.step_number, prospect_id);
    return touch(prospect_id);
  }

  const dayGap = nextStep.day_offset - thisStep.day_offset;
  const dueAt = toSqlUtc(new Date(Date.now() + dayGap * 86400000));
  const stage = STAGE_ON_ADVANCE[outcome] || (before.stage === 'new' ? 'attempting' : before.stage);

  d.prepare('UPDATE prospects SET cadence_step = ?, next_touch_at = ?, stage = ? WHERE id = ?')
    .run(thisStep.step_number, dueAt, stage, prospect_id);
  return touch(prospect_id);
}

// SQLite stores datetimes as 'YYYY-MM-DD HH:MM:SS' in UTC, matching CURRENT_TIMESTAMP.
// Kept in one place so the write format and the read format cannot drift apart.
function toSqlUtc(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// The morning list: who is due, and what the touch is.
function getDueToday(now = new Date()) {
  const rows = getDb().prepare(`
    SELECT * FROM prospects
    WHERE status = 'qualified'
      AND stage NOT IN ('won', 'dead_nurture')
      AND next_touch_at IS NOT NULL
      AND next_touch_at <= ?
    ORDER BY next_touch_at ASC
  `).all(toSqlUtc(now));
  const steps = getCadence();
  return rows.map((r) => ({ ...r, touch: nextDueStep(steps, r.cadence_step) }));
}
```

Add `getCadence, recordTouch, getDueToday` to the exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/cadence-db.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/cadence-db.test.js
git commit -m "feat: add cadence engine with auto-breakup at step nine"
```

---

### Task 7: Sourcing run records

**Files:**
- Modify: `db/prospects.js`
- Test: `tests/prospects-db.test.js` (append)

**Interfaces:**
- Consumes: `getDb`
- Produces:
  - `createSourcingRun({ filters, requested_count }) => run` — status `queued`
  - `getSourcingRunById(id) => run`
  - `updateSourcingRun(id, fields) => run` — allowed: `status`, the four counts, `error`, `completed_at`

Plan 3 consumes these. They land here because `prospects.source_run_id` references the table.

- [ ] **Step 1: Write the failing test**

Append to `tests/prospects-db.test.js`:

```javascript
test('createSourcingRun starts queued and stores filters as JSON', () => {
  const run = p.createSourcingRun({ filters: { trade: 'HVAC', city: 'Concord' }, requested_count: 10 });
  expect(run.status).toBe('queued');
  expect(run.requested_count).toBe(10);
  expect(JSON.parse(run.filters)).toEqual({ trade: 'HVAC', city: 'Concord' });
});

test('updateSourcingRun records the funnel counts', () => {
  const run = p.createSourcingRun({ filters: {}, requested_count: 10 });
  const done = p.updateSourcingRun(run.id, {
    status: 'done', searched_count: 34, dupe_count: 6, enriched_count: 28, passed_count: 9,
  });
  expect(done.status).toBe('done');
  expect(done.searched_count).toBe(34);
  expect(done.passed_count).toBe(9);
});

test('updateSourcingRun records a failure instead of throwing it away', () => {
  const run = p.createSourcingRun({ filters: {}, requested_count: 5 });
  const failed = p.updateSourcingRun(run.id, { status: 'failed', error: 'web_search timed out' });
  expect(failed.status).toBe('failed');
  expect(failed.error).toBe('web_search timed out');
});

test('a prospect links back to the run that found it', () => {
  const run = p.createSourcingRun({ filters: {}, requested_count: 1 });
  const row = p.createProspect({
    business_name: 'Found Lead', city: 'Concord', phone: '7045550055',
    source_run_id: run.id, source_kind: 'agent',
  });
  expect(row.source_run_id).toBe(run.id);
  expect(row.source_kind).toBe('agent');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prospects-db.test.js`
Expected: FAIL with `p.createSourcingRun is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `db/prospects.js` above `module.exports`:

```javascript
const RUN_UPDATE_FIELDS = ['status', 'searched_count', 'dupe_count', 'enriched_count',
                           'passed_count', 'error', 'completed_at'];

function getSourcingRunById(id) {
  return getDb().prepare('SELECT * FROM sourcing_runs WHERE id = ?').get(id);
}

function createSourcingRun({ filters = {}, requested_count = 0 }) {
  const result = getDb()
    .prepare('INSERT INTO sourcing_runs (filters, requested_count) VALUES (?, ?)')
    .run(JSON.stringify(filters), requested_count);
  return getSourcingRunById(result.lastInsertRowid);
}

function updateSourcingRun(id, fields) {
  const keys = Object.keys(fields).filter((k) => RUN_UPDATE_FIELDS.includes(k));
  if (keys.length === 0) return getSourcingRunById(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE sourcing_runs SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  return getSourcingRunById(id);
}
```

Add `createSourcingRun, getSourcingRunById, updateSourcingRun` to the exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/prospects-db.test.js`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add db/prospects.js tests/prospects-db.test.js
git commit -m "feat: add sourcing run records"
```

---

### Task 8: Import the 30 recovered leads

**Files:**
- Create: `scripts/import-prospects.js`
- Test: `tests/import-prospects.test.js`
- Reads: `data/seed/prospects-seed.json` (already committed)

**Interfaces:**
- Consumes: `createProspect`, `findDuplicate`, `parseEstYear`
- Produces: `importProspects(seed) => { imported, skipped, live, disqualified }` — idempotent via `findDuplicate`

**Seed shape:** `{ _provenance, live: { "<name>": {<sheet columns>} }, deleted: { ... } }`. Sheet column keys are the literal headers, for example `"Business Name"`, `"Est. Year"`, `"Why (teach me)"`, `"Website Link"`.

**Mapping rules:**

| Sheet | Column | Rule |
|---|---|---|
| `Grade` | `grade` | `👍 Good` -> `good`; `🤷 Maybe` -> `maybe`; `👎 Bad` -> `bad` |
| `Why (teach me)` | `grade_why` | verbatim, **except the exclusions below** |
| `Est. Year` | `est_year` + `est_year_note` | via `parseEstYear` |
| `# Reviews` | `review_count` | `parseInt`, null when absent |
| `Segment` | `segment` | strip the emoji, keep the word: `Invisible` / `Greenfield` / `Overspend` |
| `Runs Ads?` | `runs_ads` | `⚠ check` -> `unknown` |
| `Website?` | `website_quality` | `None`/`Basic`/`Good` lowercased; missing -> `unknown` |
| `Website Link` | `website_url` | already a plain URL in the seed |
| — | `review_verified` | `1` **only** for JP Lawn and Gwinn (see below); else `0` |
| — | `source_kind` | `'sheet'` |
| — | `status` | live -> `new`, or `qualified` when graded good/maybe; deleted -> `disqualified` |

**Restore the three values the rebuild flattened:**

```javascript
const RESTORE = {
  'Electricians On the Go': { stage: 'attempting', rep: 'Dillon' },
  'MOWtivated Lawn Care':   { stage: 'attempting' },
  'Gwinn Lawn Care':        { rep: 'Dillon' },
};
```

**Two exclusions, both deliberate:**

1. **`review_verified` is 1 for exactly two leads:** `JP Lawn and Landscaping` (27) and `Gwinn Lawn Care` (30). Both are noted in the sheet as "Google via Birdeye — CONFIRMED". **CR Weavers is not verified**, despite an earlier note claiming "26 confirmed": the sheet says 25 with "⚠Reviews conflict 19 vs 25 — confirm". Importing it as verified would launder a conflict into a confirmation, in the migration that creates the field.
2. **Two `Why` notes citing the owner being Black are dropped** (`Gwinn Lawn Care`, `Bucket Hat Landscaping`). Business signals only. The leads still import; only that text is excluded.

- [ ] **Step 1: Write the failing test**

Create `tests/import-prospects.test.js`:

```javascript
process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');
const { importProspects } = require('../scripts/import-prospects');
const seed = require('../data/seed/prospects-seed.json');

afterEach(() => {
  db.closeDb();
});

test('the seed holds all 30 recovered leads', () => {
  expect(Object.keys(seed.live)).toHaveLength(18);
  expect(Object.keys(seed.deleted)).toHaveLength(12);
});

test('import lands all 30 leads', () => {
  const out = importProspects(seed);
  expect(out.imported).toBe(30);
  expect(p.getProspects()).toHaveLength(30);
});

test('the 12 deleted leads import as disqualified with a reason', () => {
  importProspects(seed);
  const gone = p.getProspects({ status: 'disqualified' });
  expect(gone).toHaveLength(12);
  for (const g of gone) expect(g.disqualified_reason).toBeTruthy();
  expect(gone.map((g) => g.business_name)).toEqual(expect.arrayContaining([
    'Amen Plumbing', 'Dedicated Heating and Air', 'Ben Ross Roofing', 'Bucket Hat Landscaping',
  ]));
});

test('import restores the three values the rebuild flattened', () => {
  importProspects(seed);
  const byName = (n) => p.getProspects().find((r) => r.business_name === n);
  expect(byName('Electricians On the Go')).toMatchObject({ stage: 'attempting', rep: 'Dillon' });
  expect(byName('MOWtivated Lawn Care')).toMatchObject({ stage: 'attempting' });
  expect(byName('Gwinn Lawn Care')).toMatchObject({ rep: 'Dillon' });
});

test('import preserves Dillon grades verbatim', () => {
  importProspects(seed);
  const mkb = p.getProspects().find((r) => r.business_name === 'MKB Plumbing & Septic');
  expect(mkb.grade).toBe('good');
  expect(mkb.grade_why).toMatch(/less reviews/i);
  expect(mkb.status).toBe('qualified');
});

test('ONLY JP Lawn and Gwinn import as verified review counts', () => {
  importProspects(seed);
  const verified = p.getProspects().filter((r) => r.review_verified === 1);
  expect(verified.map((r) => r.business_name).sort())
    .toEqual(['Gwinn Lawn Care', 'JP Lawn and Landscaping']);
});

test('CR Weavers imports unverified because the sheet flags a conflict', () => {
  importProspects(seed);
  const cr = p.getProspects().find((r) => r.business_name === 'CR Weavers Heating & Cooling');
  expect(cr.review_verified).toBe(0);
  expect(cr.grade).toBe('maybe');
  expect(cr.status).toBe('qualified');
});

test('no imported note references owner race', () => {
  importProspects(seed);
  const all = p.getProspects().map((r) => `${r.grade_why || ''} ${r.notes || ''}`).join(' ').toLowerCase();
  expect(all).not.toMatch(/black owned|black-owned/);
});

test('est_year parses without inventing a year', () => {
  importProspects(seed);
  const byName = (n) => p.getProspects().find((r) => r.business_name === n);
  expect(byName('Arctic Desert Cooling & Heating').est_year).toBe(2025);
  expect(byName('MKB Plumbing & Septic').est_year).toBe(2014);
  expect(byName('Electricians On the Go').est_year).toBeNull();
  expect(byName('Electricians On the Go').est_year_note).toBe('unknown');
});

test('IDEMPOTENT: re-running imports nothing new', () => {
  importProspects(seed);
  const again = importProspects(seed);
  expect(again.imported).toBe(0);
  expect(again.skipped).toBe(30);
  expect(p.getProspects()).toHaveLength(30);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/import-prospects.test.js`
Expected: FAIL with `Cannot find module '../scripts/import-prospects'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/import-prospects.js`:

```javascript
#!/usr/bin/env node
// One-time, idempotent import of the recovered call-sheet into the prospects pool.
//
// Seed source: data/seed/prospects-seed.json, frozen from two Drive revisions of
// "Niewdel — Prospecting Call-Sheet" on 2026-07-16. `live` is the sheet head;
// `deleted` is the 12 leads that revision 69 dropped when a rebuild PATCHed a
// generated xlsx over the file. They import as disqualified, not as absences.
//
// Run: node scripts/import-prospects.js

const p = require('../db/prospects');
const { parseEstYear } = require('../lib/normalize');

const GRADE = { '👍 Good': 'good', '🤷 Maybe': 'maybe', '👎 Bad': 'bad' };

// Values the 2026-07-15 rebuild flattened. Recovered from revision 68.
const RESTORE = {
  'Electricians On the Go': { stage: 'attempting', rep: 'Dillon' },
  'MOWtivated Lawn Care': { stage: 'attempting' },
  'Gwinn Lawn Care': { rep: 'Dillon' },
};

// The only two counts the sheet records as a confirmed Google read.
// CR Weavers is deliberately absent: the sheet says "conflict 19 vs 25 — confirm".
const VERIFIED_REVIEWS = new Set(['JP Lawn and Landscaping', 'Gwinn Lawn Care']);

// Business signals only. These two notes cite the owner's race; the leads import, the text does not.
const DROP_WHY = new Set(['Gwinn Lawn Care', 'Bucket Hat Landscaping']);

function segment(raw) {
  if (!raw) return null;
  const m = String(raw).match(/Invisible|Greenfield|Overspend/i);
  return m ? m[0] : null;
}

function websiteQuality(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return ['none', 'basic', 'good'].includes(v) ? v : 'unknown';
}

function reviewCount(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
}

function toFields(name, row, { disqualified }) {
  const est = parseEstYear(row['Est. Year']);
  const grade = GRADE[row['Grade']] || null;
  const why = DROP_WHY.has(name) ? null : (row['Why (teach me)'] || null);

  let status = 'new';
  if (disqualified) status = 'disqualified';
  else if (grade === 'good' || grade === 'maybe') status = 'qualified';

  return {
    business_name: name,
    trade: row['Trade'] || null,
    city: row['City'] || null,
    owner_name: row['Owner Name'] || null,
    phone: row['Primary Phone'] || null,
    email: row['Email'] || null,
    social: row['IG / FB'] || null,
    website_url: row['Website Link'] || null,
    website_quality: websiteQuality(row['Website?']),
    rating: row['Rating'] ? Number(row['Rating']) : null,
    review_count: reviewCount(row['# Reviews']),
    review_source: row['# Reviews'] ? 'sheet import' : null,
    review_verified: VERIFIED_REVIEWS.has(name) ? 1 : 0,
    runs_ads: 'unknown',
    est_year: est.year,
    est_year_note: est.note,
    segment: segment(row['Segment']),
    hook: row['Hook (the one specific observation)'] || null,
    grade,
    grade_why: why,
    notes: row['Notes (why-not-hot / objections)'] || null,
    next_action: row['Next Action'] || null,
    rep: row['Rep'] || null,
    stage: (row['Stage'] || 'new').toLowerCase().replace(/[^a-z]/g, '_'),
    status,
    disqualified_reason: disqualified
      ? (row['Notes (why-not-hot / objections)'] || 'Dropped by the 2026-07-15 rebuild; reason not recorded')
      : null,
    source_kind: 'sheet',
    ...(RESTORE[name] || {}),
  };
}

function importProspects(seed) {
  let imported = 0;
  let skipped = 0;

  const load = (bucket, disqualified) => {
    for (const [name, row] of Object.entries(bucket)) {
      const fields = toFields(name, row, { disqualified });
      if (p.findDuplicate({ phone: fields.phone, business_name: name, city: fields.city })) {
        skipped++;
        continue;
      }
      p.createProspect(fields);
      imported++;
    }
  };

  load(seed.live, false);
  load(seed.deleted, true);

  return {
    imported,
    skipped,
    live: Object.keys(seed.live).length,
    disqualified: Object.keys(seed.deleted).length,
  };
}

module.exports = { importProspects };

if (require.main === module) {
  const seed = require('../data/seed/prospects-seed.json');
  const out = importProspects(seed);
  console.log(`Imported ${out.imported}, skipped ${out.skipped} already present.`);
  console.log(`Pool: ${out.live} live, ${out.disqualified} disqualified and kept on record.`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/import-prospects.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: exactly the two known baseline failures (`drive.test.js`, `stats.test.js`) and no others. Every new suite green.

- [ ] **Step 6: Run the import for real and eyeball it**

```bash
node scripts/import-prospects.js
node -e "
process.env.DB_PATH = process.env.DB_PATH || './data/dashboard.db';
const p = require('./db/prospects');
const all = p.getProspects();
console.log('total:', all.length);
console.log('qualified:', p.getProspects({ status: 'qualified' }).length);
console.log('disqualified:', p.getProspects({ status: 'disqualified' }).length);
console.log('verified reviews:', all.filter(r => r.review_verified === 1).map(r => r.business_name));
"
```

Expected: total 30; disqualified 12; verified reviews exactly `[ 'JP Lawn and Landscaping', 'Gwinn Lawn Care' ]`.

- [ ] **Step 7: Commit**

```bash
git add scripts/import-prospects.js tests/import-prospects.test.js
git commit -m "feat: import the 30 recovered leads, including the 12 the rebuild deleted"
```

---

## Definition of done

- [ ] `npm test` shows exactly the two known baseline failures and no others
- [ ] 30 prospects in SQLite: 18 live, 12 disqualified with reasons
- [ ] Exactly 2 leads carry `review_verified = 1`
- [ ] No module in this plan exports a delete path
- [ ] `updateResearch` provably cannot overwrite a Dillon-owned column
- [ ] Re-running the import changes nothing
- [ ] No imported text references owner race

## What Plan 2 picks up

Routes (`routes/prospects.js`), the five screens, one-tap call logging wired to `recordTouch`, and brand v4.0 styling scoped under `.prospects`. It consumes this plan's exports unchanged.
