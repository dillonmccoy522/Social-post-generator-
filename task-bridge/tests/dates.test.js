const {
  parseDue, toTasksDue, taskDueDate, addDays, formatDate, formatTime, todayInTz,
} = require('../lib/dates');

test('parseDue accepts a bare date', () => {
  expect(parseDue('2026-07-17')).toEqual({ date: '2026-07-17', time: null });
});

test('parseDue accepts date with time (T and space separators)', () => {
  expect(parseDue('2026-07-17T14:00')).toEqual({ date: '2026-07-17', time: '14:00' });
  expect(parseDue('2026-07-17 09:30')).toEqual({ date: '2026-07-17', time: '09:30' });
  expect(parseDue('2026-07-17T14:00:00')).toEqual({ date: '2026-07-17', time: '14:00' });
});

test('parseDue rejects garbage', () => {
  expect(parseDue('Friday')).toBeNull();
  expect(parseDue('tomorrow at 2')).toBeNull();
  expect(parseDue('2026-13-40')).toBeNull();
  expect(parseDue('2026-07-17T25:00')).toBeNull();
  expect(parseDue('')).toBeNull();
  expect(parseDue(null)).toBeNull();
});

test('toTasksDue produces RFC3339 midnight', () => {
  expect(toTasksDue('2026-07-17')).toBe('2026-07-17T00:00:00.000Z');
});

test('taskDueDate extracts the date portion', () => {
  expect(taskDueDate({ due: '2026-07-17T00:00:00.000Z' })).toBe('2026-07-17');
  expect(taskDueDate({})).toBeNull();
});

test('addDays crosses month boundaries', () => {
  expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
  expect(addDays('2026-07-14', 0)).toBe('2026-07-14');
});

test('formatDate and formatTime are human-friendly', () => {
  expect(formatDate('2026-07-16')).toBe('Thu, Jul 16');
  expect(formatTime('14:00')).toBe('2:00 PM');
  expect(formatTime('09:05')).toBe('9:05 AM');
  expect(formatTime('00:15')).toBe('12:15 AM');
});

test('todayInTz returns YYYY-MM-DD', () => {
  expect(todayInTz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
