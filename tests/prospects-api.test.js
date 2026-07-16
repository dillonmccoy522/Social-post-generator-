process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');
const p = require('../db/prospects');

afterEach(() => db.closeDb());

function lead(over = {}) {
  return p.createProspect({
    business_name: 'Arctic Desert Cooling & Heating',
    trade: 'HVAC',
    city: 'Concord',
    phone: '(980) 436-7390',
    hook: "Website still has the default 'Hello world!' post live",
    ...over,
  });
}

test('GET /api/prospects returns the pool', async () => {
  lead();
  const res = await request(app).get('/api/prospects');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].business_name).toBe('Arctic Desert Cooling & Heating');
});

test('GET /api/prospects filters by status', async () => {
  lead();
  const b = lead({ business_name: 'Other', phone: '7045550001' });
  p.disqualifyProspect(b.id, 'Too many reviews');
  const res = await request(app).get('/api/prospects?status=disqualified');
  expect(res.body).toHaveLength(1);
  expect(res.body[0].business_name).toBe('Other');
});

test('GET /api/prospects/:id returns one lead with its activity history', async () => {
  const row = lead();
  p.logActivity({ prospect_id: row.id, type: 'call', outcome: 'no_answer' });
  const res = await request(app).get(`/api/prospects/${row.id}`);
  expect(res.status).toBe(200);
  expect(res.body.business_name).toBe('Arctic Desert Cooling & Heating');
  expect(res.body.activities).toHaveLength(1);
});

test('GET /api/prospects/:id is 404 for an unknown id', async () => {
  const res = await request(app).get('/api/prospects/99999');
  expect(res.status).toBe(404);
});

test('POST /api/prospects/:id/grade qualifies a good lead', async () => {
  const row = lead();
  const res = await request(app)
    .post(`/api/prospects/${row.id}/grade`)
    .send({ grade: 'good', grade_why: 'Brand new, DIY site never finished' });
  expect(res.status).toBe(200);
  expect(res.body.grade).toBe('good');
  expect(res.body.status).toBe('qualified');
});

test('POST /api/prospects/:id/grade with bad retires the lead and keeps the row', async () => {
  const row = lead();
  const res = await request(app)
    .post(`/api/prospects/${row.id}/grade`)
    .send({ grade: 'bad', grade_why: '365 reviews, way too established' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('disqualified');
  expect(res.body.disqualified_reason).toBe('365 reviews, way too established');
  const still = await request(app).get(`/api/prospects/${row.id}`);
  expect(still.status).toBe(200);
});

test('POST /api/prospects/:id/grade rejects a bad grade with no reason', async () => {
  const row = lead();
  const res = await request(app).post(`/api/prospects/${row.id}/grade`).send({ grade: 'bad' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/reason/i);
});

test('POST /api/prospects/:id/grade rejects an unknown grade', async () => {
  const row = lead();
  const res = await request(app).post(`/api/prospects/${row.id}/grade`).send({ grade: 'vibes' });
  expect(res.status).toBe(400);
});

test('POST /api/prospects/:id/grade is 404 for an unknown id', async () => {
  const res = await request(app).post('/api/prospects/99999/grade').send({ grade: 'good' });
  expect(res.status).toBe(404);
});

test('POST /api/prospects/:id/touch logs the call and schedules the next one', async () => {
  const row = lead();
  p.gradeProspect(row.id, { grade: 'good' });
  const res = await request(app)
    .post(`/api/prospects/${row.id}/touch`)
    .send({ outcome: 'no_answer', rep: 'Dillon' });
  expect(res.status).toBe(200);
  expect(res.body.cadence_step).toBe(1);
  expect(res.body.next_touch_at).toBeTruthy();
});

test('POST /api/prospects/:id/touch with meeting_set leaves the cadence', async () => {
  const row = lead();
  p.gradeProspect(row.id, { grade: 'good' });
  const res = await request(app).post(`/api/prospects/${row.id}/touch`).send({ outcome: 'meeting_set' });
  expect(res.body.stage).toBe('meeting_set');
  expect(res.body.next_touch_at).toBeNull();
});

test('POST /api/prospects/:id/touch rejects an unknown outcome', async () => {
  const row = lead();
  p.gradeProspect(row.id, { grade: 'good' });
  const res = await request(app).post(`/api/prospects/${row.id}/touch`).send({ outcome: 'vibes' });
  expect(res.status).toBe(400);
});

test('POST /api/prospects/:id/touch is 404 for an unknown id', async () => {
  const res = await request(app).post('/api/prospects/99999/touch').send({ outcome: 'no_answer' });
  expect(res.status).toBe(404);
});

test('GET /api/prospects/due returns who is due, with the touch attached', async () => {
  const row = lead();
  p.gradeProspect(row.id, { grade: 'good' });
  p.recordTouch(row.id, { outcome: 'no_answer' });
  const empty = await request(app).get('/api/prospects/due');
  expect(empty.body).toHaveLength(0);

  const d = db.getDb();
  d.prepare("UPDATE prospects SET next_touch_at = '2020-01-01 00:00:00' WHERE id = ?").run(row.id);
  const res = await request(app).get('/api/prospects/due');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].touch.step_number).toBe(2);
  expect(res.body[0].touch.channel).toBe('call');
});

test('GET /api/prospects/stats counts the pool by status', async () => {
  const a = lead();
  p.gradeProspect(a.id, { grade: 'good' });
  const b = lead({ business_name: 'Other', phone: '7045550002' });
  p.disqualifyProspect(b.id, 'Too old');
  lead({ business_name: 'Third', phone: '7045550003' });

  const res = await request(app).get('/api/prospects/stats');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ total: 3, ungraded: 1, qualified: 1, disqualified: 1, due: 0 });
});

test('the API exposes no delete route', async () => {
  const row = lead();
  const res = await request(app).delete(`/api/prospects/${row.id}`);
  expect(res.status).toBe(404);
  expect(p.getProspectById(row.id)).toBeDefined();
});
