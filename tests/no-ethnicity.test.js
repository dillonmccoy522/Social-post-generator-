// The project rule: owner race or ethnicity is never a selection, exclusion, or stored
// factor. Business signals only.
//
// This gate reads EVERY string column of EVERY row rather than a list of field names.
// That is the whole point. The rule was broken three separate times because someone
// enumerated the fields they remembered — grade_why, then notes, then hook — and missed
// disqualified_reason every time. A test that names fields inherits the same blind spot
// as the bug it is meant to catch.

process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');
const { importProspects, scrubEthnicity } = require('../scripts/import-prospects');
const { backfill } = require('../scripts/backfill-scrub');
const seed = require('../data/seed/prospects-seed.json');

afterEach(() => db.closeDb());

const BANNED = /black[-\s]?owned|minority[-\s]?owned|hispanic[-\s]?owned|latino[-\s]?owned|asian[-\s]?owned|wom[ae]n[-\s]?owned/i;

// Every string value in a row, without naming a single column.
const allText = (row) => Object.values(row).filter((v) => typeof v === 'string').join(' | ');

test('no stored field on any imported lead references owner race or ethnicity', () => {
  importProspects(seed);
  const offenders = p.getProspects()
    .map((r) => ({ name: r.business_name, text: allText(r) }))
    .filter((r) => BANNED.test(r.text));
  expect(offenders).toEqual([]);
});

test('the seed archive deliberately KEEPS the original text', () => {
  // The archive is the recovered record of the source spreadsheet and must stay complete.
  // The scrub happens on import: the CRM does not encode ethnicity, the archive still
  // shows what the sheet actually said. If this test fails, someone edited the evidence.
  const raw = JSON.stringify(seed);
  expect(raw).toMatch(/Black owned/);
  expect(raw).toMatch(/Minority-owned/);
});

test('every lead still imports — only the clause is dropped, never a lead', () => {
  importProspects(seed);
  expect(p.getProspects()).toHaveLength(30);
  const bucket = p.getProspects().find((r) => r.business_name === 'Bucket Hat Landscaping');
  expect(bucket).toBeDefined();
  // The surrounding business signal survives; only the offending sentence is gone.
  expect(bucket.notes).toMatch(/Est\. 2023/);
  expect(bucket.notes).toMatch(/Calvin Dulin/);
  expect(bucket.notes).not.toMatch(BANNED);
});

test('veteran-owned is NOT scrubbed — veteran status is not race or ethnicity', () => {
  const text = 'Est. 2019 (~7y, veteran-owned). Google count unconfirmed.';
  expect(scrubEthnicity(text)).toBe(text);
  importProspects(seed);
  const bb = p.getProspects().find((r) => r.business_name === 'B&B Family Plumbing');
  expect(bb.notes).toMatch(/veteran-owned/i);
});

test('backfill repairs a row that predates the scrub, and reports what it changed', () => {
  // Reproduces the real failure: rows imported before scrubEthnicity existed kept the
  // reference, and the idempotent import will not revisit them.
  const row = p.createProspect({
    business_name: 'Legacy Row', city: 'Concord', phone: '7045559999',
    notes: 'Est. 2023 (~2y, verified). Minority-owned. Calvin Dulin (verified).',
  });
  const d = db.getDb();
  d.prepare("UPDATE prospects SET disqualified_reason = ? WHERE id = ?")
    .run('Passed: Minority-owned. Too small.', row.id);

  const changes = backfill();
  expect(changes.length).toBe(2);
  expect(changes.map((c) => c.col).sort()).toEqual(['disqualified_reason', 'notes']);

  const after = p.getProspectById(row.id);
  expect(allText(after)).not.toMatch(BANNED);
  expect(after.notes).toMatch(/Est\. 2023/);
  expect(after.notes).toMatch(/Calvin Dulin/);
  expect(after.disqualified_reason).toMatch(/Too small/);
});

test('backfill removes no rows', () => {
  importProspects(seed);
  const before = p.getProspects().length;
  backfill();
  expect(p.getProspects()).toHaveLength(before);
});
