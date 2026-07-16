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

test('the step 2 -> 3 touch lands on the day-offset delta, not the absolute offset', () => {
  const row = qualified();
  p.recordTouch(row.id, { outcome: 'no_answer' });          // step 1 (day 0) -> step 2 (day 1)
  p.recordTouch(row.id, { outcome: 'no_answer' });          // step 2 (day 1) -> step 3 (day 3)
  const after = p.getProspectById(row.id);
  // Correct delta is 3 - 1 = 2 days. A buggy implementation using the next step's
  // absolute day_offset (3) instead of the delta would schedule ~3 days out instead.
  const due = new Date(after.next_touch_at.replace(' ', 'T') + 'Z');
  const delta = (due - Date.now()) / 86400000;
  expect(delta).toBeGreaterThan(1.5);
  expect(delta).toBeLessThan(2.5);
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

test('not_interested on the first touch still records cadence_step as completed', () => {
  const row = qualified();
  const after = p.recordTouch(row.id, { outcome: 'not_interested' });
  expect(after.cadence_step).toBe(1);
  expect(after.stage).toBe('dead_nurture');
  expect(after.next_touch_at).toBeNull();
});

test('callback advances the cadence and moves the stage to attempting', () => {
  const row = qualified();
  const after = p.recordTouch(row.id, { outcome: 'callback' });
  expect(after.stage).toBe('attempting');
  expect(after.next_touch_at).toBeTruthy();
  expect(after.cadence_step).toBe(1);
});

test('recordTouch on a nonexistent prospect throws', () => {
  expect(() => p.recordTouch(999999, { outcome: 'no_answer' })).toThrow(/No prospect/);
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
