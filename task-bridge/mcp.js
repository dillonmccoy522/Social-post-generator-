const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const g = require('./google');
const {
  tz, todayInTz, parseDue, toTasksDue, taskDueDate,
  addDays, zonedTimeToUtc, formatDate, formatTime,
} = require('./lib/dates');

const NOT_CONFIGURED =
  "Google isn't connected yet. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the bridge (see task-bridge/README.md).";

function text(t, isError = false) {
  return { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) };
}

async function openTasks() {
  const { data } = await g.tasksApi().tasks.list({
    tasklist: '@default', showCompleted: false, maxResults: 100,
  });
  return (data.items || []).filter(t => t.title && t.title.trim());
}

function describeDue(date, time) {
  return time ? `${formatDate(date)} at ${formatTime(time)}` : formatDate(date);
}

async function createAlertEvent(title, date, time, description) {
  const start = `${date}T${time}:00`;
  const [h, m] = time.split(':').map(Number);
  const endMinutes = h * 60 + m + 30;
  const end = endMinutes >= 24 * 60
    ? `${addDays(date, 1)}T${String(Math.floor((endMinutes - 24 * 60) / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`
    : `${date}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
  await g.calendarApi().events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: description || 'Reminder set via Claude Task Bridge',
      start: { dateTime: start, timeZone: tz() },
      end: { dateTime: end, timeZone: tz() },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }, { method: 'popup', minutes: 30 }] },
    },
  });
}

function buildMcpServer() {
  const server = new McpServer({ name: 'niewdel-task-bridge', version: '1.0.0' });

  server.registerTool('add_task', {
    title: 'Add a task',
    description:
      'Add a to-do to Google Tasks. Use whenever the user says they need to do something. ' +
      'Resolve relative dates ("Friday", "tomorrow") to a concrete date before calling. ' +
      '`due` accepts YYYY-MM-DD or YYYY-MM-DDTHH:MM (local time). When a time is given, a phone alert ' +
      'is also scheduled at that exact time via Google Calendar (Google Tasks itself only keeps the date).',
    inputSchema: {
      title: z.string().min(1).describe('Short imperative task title, e.g. "Call the roofing client back"'),
      due: z.string().optional().describe('YYYY-MM-DD or YYYY-MM-DDTHH:MM in the user\'s local time'),
      notes: z.string().optional().describe('Extra details worth keeping with the task'),
    },
  }, async ({ title, due, notes }) => {
    if (!g.isConfigured()) return text(NOT_CONFIGURED, true);
    let parsed = null;
    if (due) {
      parsed = parseDue(due);
      if (!parsed) return text(`Couldn't read the due date "${due}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`, true);
    }
    try {
      await g.tasksApi().tasks.insert({
        tasklist: '@default',
        requestBody: {
          title,
          ...(notes ? { notes } : {}),
          ...(parsed ? { due: toTasksDue(parsed.date) } : {}),
        },
      });
      if (parsed && parsed.time) {
        await createAlertEvent(title, parsed.date, parsed.time, notes);
        return text(`Added "${title}" — due ${describeDue(parsed.date, parsed.time)}. Devices will get an alert at ${formatTime(parsed.time)} (and a 30-minute heads-up).`);
      }
      return text(parsed
        ? `Added "${title}" — due ${formatDate(parsed.date)}.`
        : `Added "${title}" (no due date).`);
    } catch (err) {
      return text(`Couldn't save the task: ${err.message}`, true);
    }
  });

  server.registerTool('list_tasks', {
    title: "List what's due",
    description:
      'List open (not completed) Google Tasks. Use when the user asks what they need to do. ' +
      '`window` = "today" (overdue + due today), "week" (overdue + next 7 days), or "all" (everything open).',
    inputSchema: {
      window: z.enum(['today', 'week', 'all']).optional().describe('Defaults to "today"'),
    },
  }, async ({ window = 'today' }) => {
    if (!g.isConfigured()) return text(NOT_CONFIGURED, true);
    try {
      const tasks = await openTasks();
      if (tasks.length === 0) return text('Nothing open — the list is clear. 🎉');

      const today = todayInTz();
      const horizon = window === 'week' ? addDays(today, 6) : today;
      const overdue = [], inWindow = [], later = [], undated = [];
      for (const t of tasks) {
        const d = taskDueDate(t);
        if (!d) undated.push(t);
        else if (d < today) overdue.push(t);
        else if (window === 'all' || d <= horizon) inWindow.push(t);
        else later.push(t);
      }
      const byDue = (a, b) => (taskDueDate(a) || '9999').localeCompare(taskDueDate(b) || '9999');
      overdue.sort(byDue); inWindow.sort(byDue); later.sort(byDue);

      const line = t => `- ${t.title}${taskDueDate(t) ? ` (due ${formatDate(taskDueDate(t))})` : ''}`;
      const sections = [];
      if (overdue.length) sections.push(`OVERDUE:\n${overdue.map(line).join('\n')}`);
      if (inWindow.length) sections.push(`${window === 'today' ? 'DUE TODAY' : window === 'week' ? 'THIS WEEK' : 'SCHEDULED'}:\n${inWindow.map(line).join('\n')}`);
      if (window === 'all' && undated.length) sections.push(`NO DATE:\n${undated.map(line).join('\n')}`);

      if (sections.length === 0) {
        const rest = later.length + undated.length;
        return text(`Nothing due ${window === 'today' ? 'today' : 'this week'} and nothing overdue. ${rest ? `(${rest} open task${rest === 1 ? '' : 's'} scheduled later or undated — ask for "all" to see them.)` : ''}`.trim());
      }
      return text(sections.join('\n\n'));
    } catch (err) {
      return text(`Couldn't fetch tasks: ${err.message}`, true);
    }
  });

  server.registerTool('complete_task', {
    title: 'Mark a task done',
    description:
      'Mark an open Google Task as completed. Matches by title, case-insensitive, partial words fine — ' +
      'pass whatever the user said, e.g. "the invoice thing" → query "invoice".',
    inputSchema: {
      query: z.string().min(1).describe('A word or phrase from the task title'),
    },
  }, async ({ query }) => {
    if (!g.isConfigured()) return text(NOT_CONFIGURED, true);
    try {
      const tasks = await openTasks();
      const q = query.trim().toLowerCase();
      const matches = tasks.filter(t => t.title.toLowerCase().includes(q));
      if (matches.length === 0) {
        const sample = tasks.slice(0, 10).map(t => `- ${t.title}`).join('\n');
        return text(`No open task matches "${query}".${tasks.length ? ` Open tasks:\n${sample}` : ' The list is empty.'}`);
      }
      if (matches.length > 1) {
        return text(`More than one task matches "${query}" — which one?\n${matches.map(t => `- ${t.title}`).join('\n')}`);
      }
      await g.tasksApi().tasks.patch({
        tasklist: '@default', task: matches[0].id,
        requestBody: { status: 'completed' },
      });
      return text(`Done ✓ "${matches[0].title}"`);
    } catch (err) {
      return text(`Couldn't complete the task: ${err.message}`, true);
    }
  });

  server.registerTool('add_event', {
    title: 'Add a calendar event',
    description:
      'Put an appointment on Google Calendar with a phone alert. Use for anything happening at a ' +
      'specific time or day (meetings, shoots, calls). `start` accepts YYYY-MM-DD (all-day) or ' +
      'YYYY-MM-DDTHH:MM (local time). Resolve relative dates before calling.',
    inputSchema: {
      title: z.string().min(1).describe('Event name, e.g. "Client shoot — Acme Roofing"'),
      start: z.string().describe('YYYY-MM-DD or YYYY-MM-DDTHH:MM in the user\'s local time'),
      duration_minutes: z.number().int().positive().optional().describe('Length of the event; defaults to 60'),
      description: z.string().optional().describe('Details, address, links'),
      reminder_minutes: z.number().int().min(0).optional().describe('Alert this many minutes before; defaults to 30'),
    },
  }, async ({ title, start, duration_minutes = 60, description, reminder_minutes = 30 }) => {
    if (!g.isConfigured()) return text(NOT_CONFIGURED, true);
    const parsed = parseDue(start);
    if (!parsed) return text(`Couldn't read the start "${start}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`, true);
    try {
      let startBody, endBody;
      if (parsed.time) {
        const startUtc = zonedTimeToUtc(parsed.date, parsed.time);
        const endUtc = new Date(startUtc.getTime() + duration_minutes * 60000);
        startBody = { dateTime: `${parsed.date}T${parsed.time}:00`, timeZone: tz() };
        endBody = { dateTime: endUtc.toISOString(), timeZone: tz() };
      } else {
        startBody = { date: parsed.date };
        endBody = { date: addDays(parsed.date, 1) };
      }
      await g.calendarApi().events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: title,
          ...(description ? { description } : {}),
          start: startBody,
          end: endBody,
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: reminder_minutes }] },
        },
      });
      return text(`On the calendar: "${title}" — ${describeDue(parsed.date, parsed.time)}${parsed.time ? ` (alert ${reminder_minutes} min before)` : ''}.`);
    } catch (err) {
      return text(`Couldn't create the event: ${err.message}`, true);
    }
  });

  server.registerTool('list_events', {
    title: "List what's coming up",
    description:
      'List upcoming Google Calendar events. Use when the user asks about their schedule. ' +
      '`window` = "today" or "week" (next 7 days).',
    inputSchema: {
      window: z.enum(['today', 'week']).optional().describe('Defaults to "today"'),
    },
  }, async ({ window = 'today' }) => {
    if (!g.isConfigured()) return text(NOT_CONFIGURED, true);
    try {
      const today = todayInTz();
      const endDate = window === 'week' ? addDays(today, 7) : addDays(today, 1);
      const { data } = await g.calendarApi().events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        timeMax: zonedTimeToUtc(endDate, '00:00').toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });
      const events = data.items || [];
      if (events.length === 0) return text(`Nothing on the calendar ${window === 'today' ? 'for the rest of today' : 'in the next 7 days'}.`);
      const lines = events.map(e => {
        const s = e.start || {};
        if (s.date) return `- ${e.summary} — ${formatDate(s.date)} (all day)`;
        const dt = String(s.dateTime || '');
        const date = dt.slice(0, 10);
        const time = dt.slice(11, 16);
        return `- ${e.summary} — ${formatDate(date)} at ${formatTime(time)}`;
      });
      return text(lines.join('\n'));
    } catch (err) {
      return text(`Couldn't fetch events: ${err.message}`, true);
    }
  });

  return server;
}

module.exports = { buildMcpServer };
