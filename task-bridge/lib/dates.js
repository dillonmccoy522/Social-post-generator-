const DEFAULT_TZ = 'America/Chicago';

function tz() {
  return process.env.BRIDGE_TZ || DEFAULT_TZ;
}

// 'YYYY-MM-DD' for the current moment in the bridge's timezone.
function todayInTz(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// Accepts 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM', or 'YYYY-MM-DD HH:MM' (seconds optional).
// Returns { date, time } where time is 'HH:MM' or null, or null if unparseable.
function parseDue(input) {
  if (!input) return null;
  const trimmed = String(input).trim().replace(' ', 'T');
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?)?$/);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (m[2]) {
    const [h, mi] = m[2].split(':').map(Number);
    if (h > 23 || mi > 59) return null;
  }
  return { date: m[1], time: m[2] || null };
}

// Google Tasks wants RFC3339; it only keeps the date portion.
function toTasksDue(dateStr) {
  return `${dateStr}T00:00:00.000Z`;
}

// Extract 'YYYY-MM-DD' from a Google Tasks `due` value.
function taskDueDate(task) {
  return task && task.due ? String(task.due).slice(0, 10) : null;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// Minutes east of UTC for the bridge timezone at a given instant.
function tzOffsetMinutes(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz(), hour12: false, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map(p => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return (asUTC - instant.getTime()) / 60000;
}

// Absolute Date for a wall-clock date+time in the bridge timezone.
function zonedTimeToUtc(dateStr, timeStr) {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
}

// Human-friendly 'Thu, Jul 16'.
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// Human-friendly '2:00 PM' from 'HH:MM'.
function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

module.exports = {
  tz, todayInTz, parseDue, toTasksDue, taskDueDate,
  addDays, zonedTimeToUtc, formatDate, formatTime,
};
