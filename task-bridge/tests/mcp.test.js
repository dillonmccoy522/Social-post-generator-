process.env.MCP_SECRET = 'test-secret';
process.env.BRIDGE_TZ = 'America/Chicago';

const mockTasksList = jest.fn();
const mockTasksInsert = jest.fn();
const mockTasksPatch = jest.fn();
const mockEventsInsert = jest.fn();
const mockEventsList = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    tasks: jest.fn(() => ({ tasks: { list: mockTasksList, insert: mockTasksInsert, patch: mockTasksPatch } })),
    calendar: jest.fn(() => ({ events: { insert: mockEventsInsert, list: mockEventsList } })),
  },
}));

const request = require('supertest');
const app = require('../server');
const { addDays, todayInTz } = require('../lib/dates');

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

function configureGoogle() {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
}

let nextId = 1;
function rpc(method, params) {
  return request(app)
    .post('/mcp/test-secret')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .send({ jsonrpc: '2.0', id: nextId++, method, params });
}

function callTool(name, args = {}) {
  return rpc('tools/call', { name, arguments: args });
}

function resultText(res) {
  return res.body.result.content.map(c => c.text).join('\n');
}

test('GET /health returns ok', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('wrong secret is rejected with 401', async () => {
  const res = await request(app)
    .post('/mcp/wrong-secret')
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect(res.status).toBe(401);
});

test('initialize handshake returns server info', async () => {
  const res = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  expect(res.status).toBe(200);
  expect(res.body.result.serverInfo.name).toBe('niewdel-task-bridge');
});

test('tools/list exposes the five bridge tools', async () => {
  const res = await rpc('tools/list', {});
  expect(res.status).toBe(200);
  const names = res.body.result.tools.map(t => t.name).sort();
  expect(names).toEqual(['add_event', 'add_task', 'complete_task', 'list_events', 'list_tasks']);
});

test('add_task reports when Google is not configured', async () => {
  const res = await callTool('add_task', { title: 'Test task' });
  expect(res.status).toBe(200);
  expect(resultText(res)).toMatch(/isn't connected yet/);
  expect(mockTasksInsert).not.toHaveBeenCalled();
});

test('add_task with a date-only due inserts a task and no calendar event', async () => {
  configureGoogle();
  mockTasksInsert.mockResolvedValue({ data: { id: 't1' } });
  const res = await callTool('add_task', { title: 'Send invoice', due: '2026-07-17' });
  expect(resultText(res)).toMatch(/Added "Send invoice"/);
  expect(resultText(res)).toMatch(/Fri, Jul 17/);
  expect(mockTasksInsert).toHaveBeenCalledWith(expect.objectContaining({
    tasklist: '@default',
    requestBody: expect.objectContaining({ title: 'Send invoice', due: '2026-07-17T00:00:00.000Z' }),
  }));
  expect(mockEventsInsert).not.toHaveBeenCalled();
});

test('add_task with a time also creates a calendar alert', async () => {
  configureGoogle();
  mockTasksInsert.mockResolvedValue({ data: { id: 't1' } });
  mockEventsInsert.mockResolvedValue({ data: { id: 'e1' } });
  const res = await callTool('add_task', { title: 'Call roofing client', due: '2026-07-16T14:00' });
  expect(resultText(res)).toMatch(/alert at 2:00 PM/);
  expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
    calendarId: 'primary',
    requestBody: expect.objectContaining({
      summary: 'Call roofing client',
      start: { dateTime: '2026-07-16T14:00:00', timeZone: 'America/Chicago' },
      end: { dateTime: '2026-07-16T14:30:00', timeZone: 'America/Chicago' },
    }),
  }));
});

test('add_task rejects an unreadable due date', async () => {
  configureGoogle();
  const res = await callTool('add_task', { title: 'Vague', due: 'sometime friday' });
  expect(resultText(res)).toMatch(/Couldn't read the due date/);
  expect(mockTasksInsert).not.toHaveBeenCalled();
});

test('list_tasks groups overdue and today', async () => {
  configureGoogle();
  const today = todayInTz();
  mockTasksList.mockResolvedValue({ data: { items: [
    { id: '1', title: 'Old thing', due: `${addDays(today, -2)}T00:00:00.000Z` },
    { id: '2', title: 'Today thing', due: `${today}T00:00:00.000Z` },
    { id: '3', title: 'Future thing', due: `${addDays(today, 3)}T00:00:00.000Z` },
    { id: '4', title: 'Someday thing' },
  ] } });
  const res = await callTool('list_tasks', { window: 'today' });
  const text = resultText(res);
  expect(text).toMatch(/OVERDUE:/);
  expect(text).toMatch(/Old thing/);
  expect(text).toMatch(/DUE TODAY:/);
  expect(text).toMatch(/Today thing/);
  expect(text).not.toMatch(/Future thing/);
  expect(text).not.toMatch(/Someday thing/);
});

test('list_tasks window=week includes near-future tasks', async () => {
  configureGoogle();
  const today = todayInTz();
  mockTasksList.mockResolvedValue({ data: { items: [
    { id: '3', title: 'Future thing', due: `${addDays(today, 3)}T00:00:00.000Z` },
  ] } });
  const res = await callTool('list_tasks', { window: 'week' });
  expect(resultText(res)).toMatch(/Future thing/);
});

test('list_tasks reports an empty list', async () => {
  configureGoogle();
  mockTasksList.mockResolvedValue({ data: { items: [] } });
  const res = await callTool('list_tasks', {});
  expect(resultText(res)).toMatch(/list is clear/);
});

test('complete_task completes a unique match', async () => {
  configureGoogle();
  mockTasksList.mockResolvedValue({ data: { items: [
    { id: 't1', title: 'Send Henderson invoice' },
    { id: 't2', title: 'Order shingles' },
  ] } });
  mockTasksPatch.mockResolvedValue({ data: {} });
  const res = await callTool('complete_task', { query: 'invoice' });
  expect(resultText(res)).toMatch(/Done ✓ "Send Henderson invoice"/);
  expect(mockTasksPatch).toHaveBeenCalledWith(expect.objectContaining({
    tasklist: '@default', task: 't1',
    requestBody: { status: 'completed' },
  }));
});

test('complete_task asks when multiple tasks match', async () => {
  configureGoogle();
  mockTasksList.mockResolvedValue({ data: { items: [
    { id: 't1', title: 'Call Henderson' },
    { id: 't2', title: 'Call the city office' },
  ] } });
  const res = await callTool('complete_task', { query: 'call' });
  expect(resultText(res)).toMatch(/More than one task matches/);
  expect(mockTasksPatch).not.toHaveBeenCalled();
});

test('complete_task reports when nothing matches', async () => {
  configureGoogle();
  mockTasksList.mockResolvedValue({ data: { items: [{ id: 't1', title: 'Order shingles' }] } });
  const res = await callTool('complete_task', { query: 'invoice' });
  expect(resultText(res)).toMatch(/No open task matches/);
  expect(mockTasksPatch).not.toHaveBeenCalled();
});

test('add_event creates a timed event with a reminder', async () => {
  configureGoogle();
  mockEventsInsert.mockResolvedValue({ data: { id: 'e1' } });
  const res = await callTool('add_event', { title: 'Client shoot', start: '2026-07-22T09:00', reminder_minutes: 45 });
  expect(resultText(res)).toMatch(/On the calendar: "Client shoot"/);
  expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
    calendarId: 'primary',
    requestBody: expect.objectContaining({
      summary: 'Client shoot',
      start: { dateTime: '2026-07-22T09:00:00', timeZone: 'America/Chicago' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 45 }] },
    }),
  }));
});

test('add_event with a bare date creates an all-day event', async () => {
  configureGoogle();
  mockEventsInsert.mockResolvedValue({ data: { id: 'e1' } });
  const res = await callTool('add_event', { title: 'Materials delivery', start: '2026-07-20' });
  expect(resultText(res)).toMatch(/On the calendar/);
  expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
    requestBody: expect.objectContaining({
      start: { date: '2026-07-20' },
      end: { date: '2026-07-21' },
    }),
  }));
});

test('list_events formats timed and all-day events', async () => {
  configureGoogle();
  mockEventsList.mockResolvedValue({ data: { items: [
    { summary: 'Client shoot', start: { dateTime: '2026-07-22T09:00:00-05:00' } },
    { summary: 'Materials delivery', start: { date: '2026-07-20' } },
  ] } });
  const res = await callTool('list_events', { window: 'week' });
  const text = resultText(res);
  expect(text).toMatch(/Client shoot — Wed, Jul 22 at 9:00 AM/);
  expect(text).toMatch(/Materials delivery — Mon, Jul 20 \(all day\)/);
});

test('google API failure surfaces as a readable error, not a crash', async () => {
  configureGoogle();
  mockTasksInsert.mockRejectedValue(new Error('quota exceeded'));
  const res = await callTool('add_task', { title: 'Doomed task' });
  expect(res.status).toBe(200);
  expect(resultText(res)).toMatch(/Couldn't save the task: quota exceeded/);
});
