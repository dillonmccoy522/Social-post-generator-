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
