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

afterEach(() => {
  db.closeDb();
  jest.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

function configureDrive() {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
}

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

test('GET /api/clients/:id returns client', async () => {
  const created = db.createClient({ name: 'Test', business_type: 'Roofing', location: 'SA', brand_voice: '' });
  const res = await request(app).get(`/api/clients/${created.id}`);
  expect(res.status).toBe(200);
  expect(res.body.id).toBe(created.id);
});

test('GET /api/clients/:id returns 404 for unknown id', async () => {
  const res = await request(app).get('/api/clients/9999');
  expect(res.status).toBe(404);
});

test('DELETE /api/clients/:id returns 404 for unknown id', async () => {
  const res = await request(app).delete('/api/clients/9999');
  expect(res.status).toBe(404);
});

test('POST /api/clients parses and stores a valid Drive folder link', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Drive Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'https://drive.google.com/drive/folders/1AbCdEf?usp=sharing',
  });
  expect(res.status).toBe(201);
  expect(res.body.source_drive_folder_id).toBe('1AbCdEf');
});

test('POST /api/clients returns 400 for an unrecognizable Drive link', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Bad Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'not a link',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/not recognizable/);
});

test('POST /api/clients succeeds with no Drive link at all', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'No Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.source_drive_folder_id).toBeNull();
  expect(res.body.output_drive_folder_id).toBeNull();
});

test('POST /api/clients eagerly creates output folder when Drive is configured', async () => {
  configureDrive();
  process.env.OUTPUT_DRIVE_FOLDER_ID = 'output-root';
  mockList.mockResolvedValue({ data: { files: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'new-client-output-folder' } });

  const res = await request(app).post('/api/clients').send({
    name: 'Eager Client',
    business_type: 'Detailing',
    location: 'Houston, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBe('new-client-output-folder');
  delete process.env.OUTPUT_DRIVE_FOLDER_ID;
});

test('POST /api/clients leaves output_drive_folder_id null when Drive is not configured', async () => {
  const res = await request(app).post('/api/clients').send({
    name: 'Unconfigured Client',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBeNull();
});

test('POST /api/clients still succeeds even if eager output folder creation throws', async () => {
  configureDrive();
  process.env.OUTPUT_DRIVE_FOLDER_ID = 'output-root';
  mockList.mockRejectedValue(new Error('Drive API down'));

  const res = await request(app).post('/api/clients').send({
    name: 'Resilient Client',
    business_type: 'Roofing',
    location: 'Austin, TX',
  });
  expect(res.status).toBe(201);
  expect(res.body.output_drive_folder_id).toBeNull();
  delete process.env.OUTPUT_DRIVE_FOLDER_ID;
});

test('PUT /api/clients/:id updates source_drive_folder_id', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Update Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Update Link Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    source_drive_folder_id: '1XyZAbC',
  });
  expect(res.status).toBe(200);
  expect(res.body.source_drive_folder_id).toBe('1XyZAbC');
});

test('PUT /api/clients/:id returns 400 for an unrecognizable Drive link', async () => {
  const created = await request(app).post('/api/clients').send({
    name: 'Bad Update Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Bad Update Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    source_drive_folder_id: '///bad///',
  });
  expect(res.status).toBe(400);
});

test('PUT /api/clients/:id does not touch output_drive_folder_id', async () => {
  configureDrive();
  process.env.OUTPUT_DRIVE_FOLDER_ID = 'output-root';
  mockList.mockResolvedValue({ data: { files: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'preexisting-output-folder' } });

  const created = await request(app).post('/api/clients').send({
    name: 'Output Preserved Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  expect(created.body.output_drive_folder_id).toBe('preexisting-output-folder');

  const res = await request(app).put(`/api/clients/${created.body.id}`).send({
    name: 'Output Preserved Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: '',
    source_drive_folder_id: '1NewSourceFolder',
  });
  expect(res.status).toBe(200);
  expect(res.body.output_drive_folder_id).toBe('preexisting-output-folder');
  delete process.env.OUTPUT_DRIVE_FOLDER_ID;
});
