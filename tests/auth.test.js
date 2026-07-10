process.env.DB_PATH = ':memory:';
process.env.DASHBOARD_PASSWORD = 'test-password';
process.env.SESSION_SECRET = 'test-secret';
process.env.API_TOKEN = 'test-api-token';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());
afterAll(() => {
  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.SESSION_SECRET;
  delete process.env.API_TOKEN;
});

test('GET /api/clients without auth returns 401', async () => {
  const res = await request(app).get('/api/clients');
  expect(res.status).toBe(401);
});

test('GET /api/health is public', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
});

test('POST /api/login with wrong password returns 401', async () => {
  const res = await request(app).post('/api/login').send({ password: 'nope' });
  expect(res.status).toBe(401);
});

test('POST /api/login with correct password sets session cookie', async () => {
  const res = await request(app).post('/api/login').send({ password: 'test-password' });
  expect(res.status).toBe(204);
  expect(res.headers['set-cookie'][0]).toMatch(/^session=/);
});

test('cookie from login grants API access', async () => {
  const login = await request(app).post('/api/login').send({ password: 'test-password' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const res = await request(app).get('/api/clients').set('Cookie', cookie);
  expect(res.status).toBe(200);
});

test('bearer API token grants access', async () => {
  const res = await request(app).get('/api/clients').set('Authorization', 'Bearer test-api-token');
  expect(res.status).toBe(200);
});

test('GET /api/me returns ok when authed', async () => {
  const login = await request(app).post('/api/login').send({ password: 'test-password' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const res = await request(app).get('/api/me').set('Cookie', cookie);
  expect(res.body).toEqual({ ok: true });
});
