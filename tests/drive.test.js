process.env.DB_PATH = ':memory:';

const mockList = jest.fn();
const mockCreate = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    drive: jest.fn(() => ({ files: { list: mockList, create: mockCreate } })),
  },
}));

const request = require('supertest');
const app = require('../server');
const db = require('../database');
const drive = require('../services/drive');

afterEach(() => {
  db.closeDb();
  jest.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

function configure() {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
}

test('GET /api/drive/browse returns 503 when not configured', async () => {
  const res = await request(app).get('/api/drive/browse');
  expect(res.status).toBe(503);
});

test('browse returns only folders, images, and videos', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [
    { id: '1', name: 'Folder', mimeType: 'application/vnd.google-apps.folder' },
    { id: '2', name: 'pic.jpg', mimeType: 'image/jpeg', thumbnailLink: 't' },
    { id: '3', name: 'doc.pdf', mimeType: 'application/pdf' },
    { id: '4', name: 'clip.mp4', mimeType: 'video/mp4' },
  ] } });
  const files = await drive.browse('root');
  expect(files.map(f => f.id)).toEqual(['1', '2', '4']);
});

test('GET /api/drive/browse returns files when configured', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [
    { id: '2', name: 'pic.jpg', mimeType: 'image/jpeg', thumbnailLink: 't' },
  ] } });
  const res = await request(app).get('/api/drive/browse?folderId=abc');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
    q: "'abc' in parents and trashed = false",
  }));
});

test('ensureFolder returns existing folder id without creating', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [{ id: 'existing', name: 'Acme' }] } });
  const id = await drive.ensureFolder('Acme', 'root-id');
  expect(id).toBe('existing');
  expect(mockCreate).not.toHaveBeenCalled();
});

test('ensureFolder creates when missing', async () => {
  configure();
  mockList.mockResolvedValue({ data: { files: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'new-folder' } });
  const id = await drive.ensureFolder('Acme', 'root-id');
  expect(id).toBe('new-folder');
});
