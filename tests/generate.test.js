process.env.DB_PATH = ':memory:';

jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ text: 'POST 1 — Job Showcase\nPhoto: photo1\nCaption: Great roof.\nHashtags: #SanAntonio\nCTA: Call us today\n\nPOST 2 — Education/Trust\nPhoto: photo2\nCaption: Know the signs.\nHashtags: #RoofTips\nCTA: Free inspection\n\nPOST 3 — Local/Community\nPhoto: photo3\nCaption: Proud to serve SA.\nHashtags: #SATX\nCTA: DM us' }],
  });
  const MockAnthropic = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  MockAnthropic.mockCreate = mockCreate;
  return MockAnthropic;
});

const request = require('supertest');
const app = require('../server');
const db = require('../database');
const Anthropic = require('@anthropic-ai/sdk');
const mockCreate = Anthropic.mockCreate;

let clientId;
beforeEach(() => {
  const client = db.createClient({
    name: 'Test Roofing',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: 'Friendly',
  });
  clientId = client.id;
});

afterEach(() => db.closeDb());

test('POST /api/generate returns posts array', async () => {
  const res = await request(app).post('/api/generate').send({
    clientId,
    photos: ['Before: damaged shingles', 'After: new shingles', 'Crew on site'],
    jobDetails: 'Full replacement in Boerne',
    cta: 'Call for a free inspection',
  });
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.posts)).toBe(true);
  expect(res.body.posts).toHaveLength(3);
});

test('POST /api/generate updates last_pillar on client', async () => {
  await request(app).post('/api/generate').send({
    clientId,
    photos: ['photo1', 'photo2', 'photo3'],
  });
  const client = db.getClientById(clientId);
  expect(client.last_pillar).toBe('Local/Community');
});

test('POST /api/generate returns 400 if photos missing', async () => {
  const res = await request(app).post('/api/generate').send({ clientId });
  expect(res.status).toBe(400);
});

test('POST /api/generate returns 400 if not exactly 3 photos', async () => {
  const res = await request(app).post('/api/generate').send({
    clientId,
    photos: ['only one'],
  });
  expect(res.status).toBe(400);
});

test('POST /api/generate returns 404 for unknown client', async () => {
  const res = await request(app).post('/api/generate').send({
    clientId: 99999,
    photos: ['a', 'b', 'c'],
  });
  expect(res.status).toBe(404);
});

test('POST /api/generate returns 400 if clientId missing', async () => {
  const res = await request(app).post('/api/generate').send({
    photos: ['p1', 'p2', 'p3'],
  });
  expect(res.status).toBe(400);
});

test('POST /api/generate returns 500 if Claude API fails', async () => {
  const client = db.createClient({ name: 'Test', business_type: 'Roofing', location: 'SA', brand_voice: '' });
  mockCreate.mockRejectedValueOnce(new Error('quota exceeded'));
  const res = await request(app).post('/api/generate').send({
    clientId: client.id,
    photos: ['p1', 'p2', 'p3'],
  });
  expect(res.status).toBe(500);
  expect(res.body.error).toBeDefined();
});
