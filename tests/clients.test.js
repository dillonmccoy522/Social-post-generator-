process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

test('GET /api/clients returns empty array initially', async () => {
  const res = await request(app).get('/api/clients');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('POST /api/clients creates a client', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'San Antonio Roofing',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: 'Friendly and direct',
  });
  expect(res.status).toBe(201);
  expect(res.body.name).toBe('San Antonio Roofing');
  expect(res.body.id).toBeDefined();
});

test('POST /api/clients returns 400 if name missing', async () => {
  const res = await request(app).post('/api/clients').send({
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  expect(res.status).toBe(400);
});

test('PUT /api/clients/:id updates a client', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Old Name',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'New Name',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: 'Bold tone',
  });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('New Name');
});

test('DELETE /api/clients/:id removes a client', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Delete Me',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).delete(`/api/clients/${created.body.id}`);
  expect(res.status).toBe(204);

  const list = await request(app).get('/api/clients');
  expect(list.body).toHaveLength(0);
});

test('PUT /api/clients/:id returns 404 for unknown id', async () => {
  const res = await request(app).put('/api/clients/99999').send({
    name: 'Ghost',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
  });
  expect(res.status).toBe(404);
});
