const request = require('supertest');

jest.mock('../lib/google-auth', () => ({
  getAuthUrl: () => 'https://accounts.google.com/mock',
  getOAuthClient: () => ({
    getToken: jest.fn().mockResolvedValue({ tokens: { access_token: 'test', refresh_token: 'refresh' } }),
  }),
  saveTokens: jest.fn(),
  loadTokens: jest.fn().mockReturnValue(null),
  requireAuth: (req, res, next) => next(),
}));

const app = require('../server');

describe('GET /auth/google', () => {
  test('redirects to Google OAuth URL', async () => {
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://accounts.google.com/mock');
  });
});

describe('GET /auth/google/callback', () => {
  test('returns 400 when no code provided', async () => {
    const res = await request(app).get('/auth/google/callback');
    expect(res.status).toBe(400);
  });
});
