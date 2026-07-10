process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

test('GET /api/stats returns zeroed shape when empty', async () => {
  const res = await request(app).get('/api/stats');
  expect(res.status).toBe(200);
  expect(res.body.clients).toBe(0);
  expect(res.body.postsThisWeek).toBe(0);
  expect(res.body.assetsByStatus.draft).toBe(0);
  expect(res.body.recentActivity).toEqual([]);
});

test('GET /api/stats counts and orders activity', async () => {
  const c = db.createClient({ name: 'Acme', business_type: 'Roofing', location: 'SA', brand_voice: '' });
  db.createPost({ clientId: c.id, weekOf: '2026-07-06', photoDescriptions: '[]', generatedContent: 'hi' });
  db.createAsset({ client_id: c.id, type: 'image', status: 'queued', campaign: 'launch' });
  const res = await request(app).get('/api/stats');
  expect(res.body.clients).toBe(1);
  expect(res.body.postsThisWeek).toBe(1);
  expect(res.body.assetsByStatus.queued).toBe(1);
  expect(res.body.recentActivity).toHaveLength(2);
  expect(res.body.recentActivity[0].client_name).toBe('Acme');
});
