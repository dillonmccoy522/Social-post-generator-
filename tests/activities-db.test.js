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
