process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

test('GET /api/posts returns empty array initially', async () => {
  const res = await request(app).get('/api/posts');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('GET /api/posts returns posts with client_name', async () => {
  const client = db.createClient({
    name: 'SA Roofing',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  db.createPost({
    clientId: client.id,
    weekOf: '2026-07-05',
    photoDescriptions: '["p1","p2","p3"]',
    generatedContent: 'POST 1 content',
  });
  const res = await request(app).get('/api/posts');
  expect(res.body).toHaveLength(1);
  expect(res.body[0].client_name).toBe('SA Roofing');
});

test('GET /api/posts?clientId filters by client', async () => {
  const c1 = db.createClient({ name: 'Client A', business_type: 'Roofing', location: 'SA, TX' });
  const c2 = db.createClient({ name: 'Client B', business_type: 'HVAC', location: 'Austin, TX' });
  db.createPost({ clientId: c1.id, weekOf: '2026-07-05', photoDescriptions: '[]', generatedContent: 'A content' });
  db.createPost({ clientId: c2.id, weekOf: '2026-07-05', photoDescriptions: '[]', generatedContent: 'B content' });

  const res = await request(app).get(`/api/posts?clientId=${c1.id}`);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].generated_content).toBe('A content');
});

test('GET /api/posts?clientId=abc returns 400', async () => {
  const res = await request(app).get('/api/posts?clientId=abc');
  expect(res.status).toBe(400);
});
