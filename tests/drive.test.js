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

test('parseFolderId extracts id from a full folder URL', () => {
  expect(drive.parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'))
    .toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
});

test('parseFolderId extracts id from a folder URL with query string', () => {
  expect(drive.parseFolderId('https://drive.google.com/drive/folders/1AbCdEf?usp=sharing'))
    .toBe('1AbCdEf');
});

test('parseFolderId extracts id from a /u/0/folders/ URL variant', () => {
  expect(drive.parseFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEf'))
    .toBe('1AbCdEf');
});

test('parseFolderId accepts a bare folder id', () => {
  expect(drive.parseFolderId('1AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
});

test('parseFolderId returns null for empty input', () => {
  expect(drive.parseFolderId('')).toBeNull();
  expect(drive.parseFolderId(null)).toBeNull();
  expect(drive.parseFolderId(undefined)).toBeNull();
});

test('parseFolderId returns null for unrecognizable input', () => {
  expect(drive.parseFolderId('not a link at all, just words')).toBeNull();
  expect(drive.parseFolderId('https://example.com/not-drive')).toBeNull();
});
