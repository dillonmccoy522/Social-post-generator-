process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

async function makeClient() {
  const res = await request(app).post('/api/clients').send({
    name: 'Acme', business_type: 'Roofing', location: 'SA, TX',
  });
  return res.body;
}

test('POST /api/assets creates queued asset', async () => {
  const c = await makeClient();
  const res = await request(app).post('/api/assets').send({
    client_id: c.id, type: 'image', status: 'queued', prompt: 'hero shot', campaign: 'launch',
  });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('queued');
  expect(res.body.client_name).toBe('Acme');
});

test('POST /api/assets 400 on missing type / bad enums / unknown client', async () => {
  const c = await makeClient();
  expect((await request(app).post('/api/assets').send({ client_id: c.id })).status).toBe(400);
  expect((await request(app).post('/api/assets').send({ client_id: c.id, type: 'gif' })).status).toBe(400);
  expect((await request(app).post('/api/assets').send({ client_id: c.id, type: 'image', status: 'nope' })).status).toBe(400);
  expect((await request(app).post('/api/assets').send({ client_id: 999, type: 'image' })).status).toBe(400);
});

test('GET /api/assets filters by status', async () => {
  const c = await makeClient();
  await request(app).post('/api/assets').send({ client_id: c.id, type: 'image', status: 'queued' });
  await request(app).post('/api/assets').send({ client_id: c.id, type: 'video' });
  const res = await request(app).get('/api/assets?status=queued');
  expect(res.body).toHaveLength(1);
  expect(res.body[0].type).toBe('image');
});

test('PATCH /api/assets/:id updates status; rejects bad status; 404 unknown', async () => {
  const c = await makeClient();
  const created = await request(app).post('/api/assets').send({ client_id: c.id, type: 'image' });
  const ok = await request(app).patch(`/api/assets/${created.body.id}`).send({ status: 'approved' });
  expect(ok.status).toBe(200);
  expect(ok.body.status).toBe('approved');
  expect((await request(app).patch(`/api/assets/${created.body.id}`).send({ status: 'bogus' })).status).toBe(400);
  expect((await request(app).patch('/api/assets/9999').send({ status: 'draft' })).status).toBe(404);
});

test('DELETE /api/assets/:id removes; 404 unknown', async () => {
  const c = await makeClient();
  const created = await request(app).post('/api/assets').send({ client_id: c.id, type: 'image' });
  expect((await request(app).delete(`/api/assets/${created.body.id}`)).status).toBe(204);
  expect((await request(app).delete('/api/assets/9999')).status).toBe(404);
});
