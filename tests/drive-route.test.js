process.env.DB_PATH = ':memory:';

jest.mock('../lib/google-auth', () => ({
  requireAuth: (req, res, next) => { req.googleAuth = {}; next(); },
}));

jest.mock('../lib/drive', () => ({
  folderIdFromUrl: () => 'folder123',
  listPhotos: jest.fn().mockResolvedValue([
    { id: 'img1', name: 'photo.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-01-01' },
  ]),
  downloadPhotoAsBase64: jest.fn(),
  writeOutputFile: jest.fn(),
}));

const request = require('supertest');
const app = require('../server');
const db = require('../database');

describe('GET /api/drive/scan/:clientId', () => {
  let clientId;

  beforeEach(() => {
    const client = db.createClient({ name: 'Test', business_type: 'Roofing', location: 'SA' });
    clientId = client.id;
    db.updateClient(clientId, {
      name: 'Test', business_type: 'Roofing', location: 'SA', brand_voice: '',
      drive_photos_url: 'https://drive.google.com/drive/folders/abc',
      drive_output_url: 'https://drive.google.com/drive/folders/def',
    });
  });

  test('returns photo list for valid client', async () => {
    const res = await request(app).get(`/api/drive/scan/${clientId}`);
    expect(res.status).toBe(200);
    expect(res.body.photos[0].id).toBe('img1');
  });

  test('returns 404 for unknown client', async () => {
    const res = await request(app).get('/api/drive/scan/9999');
    expect(res.status).toBe(404);
  });

  test('returns 400 when client has no photos folder', async () => {
    const c = db.createClient({ name: 'No Folder', business_type: 'Plumbing', location: 'Austin' });
    const res = await request(app).get(`/api/drive/scan/${c.id}`);
    expect(res.status).toBe(400);
  });
});
