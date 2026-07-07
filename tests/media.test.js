process.env.DB_PATH = ':memory:';

jest.mock('../lib/google-auth', () => ({
  requireAuth: (req, res, next) => { req.googleAuth = {}; next(); },
}));
jest.mock('../lib/drive', () => ({
  folderIdFromUrl: () => 'output-folder',
  downloadPhotoAsBase64: jest.fn().mockResolvedValue({ data: 'base64', mimeType: 'image/jpeg' }),
  writeOutputFile: jest.fn().mockResolvedValue(),
  listPhotos: jest.fn(),
}));
jest.mock('../lib/media-prompt', () => ({
  selectPhotosAndGeneratePlan: jest.fn().mockResolvedValue({
    selectedPhotos: [{ id: 'p1', name: 'photo.jpg', reason: 'Great' }],
    script: 'Test script',
    higgsfieldPrompt: 'Test video',
    midjourneyPrompt: 'Test image --ar 9:16',
  }),
}));

const request = require('supertest');
const app = require('../server');
const db = require('../database');

afterEach(() => db.closeDb());

let clientId;
beforeEach(() => {
  const c = db.createClient({ name: 'Test', business_type: 'Roofing', location: 'SA' });
  clientId = c.id;
  db.updateClient(clientId, {
    name: 'Test', business_type: 'Roofing', location: 'SA', brand_voice: '',
    drive_photos_url: 'https://drive.google.com/drive/folders/photos',
    drive_output_url: 'https://drive.google.com/drive/folders/output',
  });
});

describe('POST /api/media/generate', () => {
  test('returns a media plan', async () => {
    const res = await request(app).post('/api/media/generate')
      .send({ clientId, photos: [{ id: 'p1', name: 'photo.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-01-01' }] });
    expect(res.status).toBe(200);
    expect(res.body.plan.script).toBe('Test script');
  });
  test('returns 400 when clientId missing', async () => {
    const res = await request(app).post('/api/media/generate').send({ photos: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/media/save', () => {
  test('saves job and returns it', async () => {
    const plan = { selectedPhotos: [{ id: 'p1', name: 'p.jpg', reason: 'Great' }], script: 'Save script', higgsfieldPrompt: 'H', midjourneyPrompt: 'M' };
    const res = await request(app).post('/api/media/save').send({ clientId, plan });
    expect(res.status).toBe(200);
    expect(res.body.job.script).toBe('Save script');
  });
});

describe('GET /api/media/history/:clientId', () => {
  test('returns past jobs', async () => {
    db.createMediaJob({ clientId, selectedPhotos: '[]', script: 'History', higgsfieldPrompt: 'H', midjourneyPrompt: 'M' });
    const res = await request(app).get(`/api/media/history/${clientId}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs[0].script).toBe('History');
  });
});
