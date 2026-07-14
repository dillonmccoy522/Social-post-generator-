process.env.MCP_SECRET = 'test-secret';

const mockGenerateAuthUrl = jest.fn();
const mockGetToken = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
      })),
    },
    tasks: jest.fn(),
    calendar: jest.fn(),
  },
}));

const request = require('supertest');
const app = require('../server');

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

function configureClient() {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
}

test('setup page rejects a wrong secret', async () => {
  const res = await request(app).get('/setup/wrong');
  expect(res.status).toBe(401);
});

test('setup page asks for client credentials when missing', async () => {
  const res = await request(app).get('/setup/test-secret');
  expect(res.status).toBe(200);
  expect(res.text).toMatch(/Missing Google credentials/);
  expect(res.text).toMatch(/\/oauth\/callback/);
});

test('setup page offers the Connect Google button when client is set', async () => {
  configureClient();
  const res = await request(app).get('/setup/test-secret');
  expect(res.text).toMatch(/Connect Google/);
  expect(res.text).toMatch(/\/setup\/test-secret\/start/);
});

test('setup page shows the connector URL once fully configured', async () => {
  configureClient();
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
  const res = await request(app).get('/setup/test-secret');
  expect(res.text).toMatch(/Google is connected/);
  expect(res.text).toMatch(/\/mcp\/test-secret/);
});

test('start redirects to the Google consent URL with state', async () => {
  configureClient();
  mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?fake');
  const res = await request(app).get('/setup/test-secret/start');
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/accounts\.google\.com/);
  expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
    access_type: 'offline',
    prompt: 'consent',
    state: 'test-secret',
    scope: expect.arrayContaining([
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar.events',
    ]),
  }));
});

test('callback rejects a forged state', async () => {
  configureClient();
  const res = await request(app).get('/oauth/callback?code=abc&state=forged');
  expect(res.status).toBe(401);
  expect(mockGetToken).not.toHaveBeenCalled();
});

test('callback shows the refresh token with paste instructions', async () => {
  configureClient();
  mockGetToken.mockResolvedValue({ tokens: { refresh_token: 'the-refresh-token' } });
  const res = await request(app).get('/oauth/callback?code=abc&state=test-secret');
  expect(res.status).toBe(200);
  expect(res.text).toMatch(/the-refresh-token/);
  expect(res.text).toMatch(/GOOGLE_REFRESH_TOKEN/);
});

test('callback explains when Google returns no refresh token', async () => {
  configureClient();
  mockGetToken.mockResolvedValue({ tokens: {} });
  const res = await request(app).get('/oauth/callback?code=abc&state=test-secret');
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/myaccount\.google\.com\/permissions/);
});

test('callback surfaces token-exchange failures readably', async () => {
  configureClient();
  mockGetToken.mockRejectedValue(new Error('invalid_grant'));
  const res = await request(app).get('/oauth/callback?code=bad&state=test-secret');
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/invalid_grant/);
});
