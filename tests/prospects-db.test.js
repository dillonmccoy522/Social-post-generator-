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

test('NEVER-DELETE: source contains no destructive SQL', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'db', 'prospects.js'), 'utf-8');
  expect(source.toUpperCase()).not.toMatch(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/);
});

test('updateResearch cannot overwrite Dillon-owned columns', () => {
  const row = p.createProspect({ business_name: 'Gwinn Lawn Care', city: 'Gastonia', phone: '9802852055' });
  p.gradeProspect(row.id, { grade: 'good', grade_why: 'Strong reviews, template site' });
  const d = require('../database').getDb();
  d.prepare("UPDATE prospects SET stage='attempting', rep='Dillon', next_action='Follow up Monday', next_date='2026-07-20' WHERE id = ?").run(row.id);

  const after = p.updateResearch(row.id, {
    review_count: 30,
    review_verified: 1,
    grade: 'bad',              // must be ignored
    grade_why: 'overwritten',  // must be ignored
    stage: 'new',              // must be ignored
    rep: null,                 // must be ignored
    next_action: 'Call Tuesday',  // must be ignored
    next_date: '2026-07-22',      // must be ignored
    notes: 'clobbered',        // must be ignored
  });

  expect(after.review_count).toBe(30);
  expect(after.review_verified).toBe(1);
  expect(after.grade).toBe('good');
  expect(after.grade_why).toBe('Strong reviews, template site');
  expect(after.stage).toBe('attempting');
  expect(after.rep).toBe('Dillon');
  expect(after.next_action).toBe('Follow up Monday');
  expect(after.next_date).toBe('2026-07-20');
  expect(after.notes).toBeNull();
});
