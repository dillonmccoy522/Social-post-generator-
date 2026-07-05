process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const db = require('../database');

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: 'POST 1 — Job Showcase\nPhoto: photo1\nCaption: Great roof.\nHashtags: #SanAntonio\nCTA: Call us today\n\nPOST 2 — Education/Trust\nPhoto: photo2\nCaption: Know the signs.\nHashtags: #RoofTips\nCTA: Free inspection\n\nPOST 3 — Local/Community\nPhoto: photo3\nCaption: Proud to serve SA.\nHashtags: #SATX\nCTA: DM us' }],
      }),
    },
  }));
});

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

test('POST /api/generate returns generated content and postId', async () => {
  const res = await request(app).post('/api/generate').send({
    clientId,
    photos: ['Before: damaged shingles', 'After: new shingles', 'Crew on site'],
    jobDetails: 'Full replacement in Boerne',
    cta: 'Call for a free inspection',
  });
  expect(res.status).toBe(200);
  expect(res.body.generatedContent).toContain('POST 1');
  expect(res.body.postId).toBeDefined();
});

test('POST /api/generate updates last_pillar on client', async () => {
  await request(app).post('/api/generate').send({
    clientId,
    photos: ['photo1', 'photo2', 'photo3'],
  });
  const client = db.getClientById(clientId);
  expect(client.last_pillar).toBeDefined();
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
