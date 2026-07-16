// Pure helpers for prospect identity. No database access.

// Digits only, minus a leading US country code. Null when there is no usable number.
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

// Fallback identity when a lead has no phone.
function dedupeKey(name, city) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(name)}|${norm(city)}`;
}

// The sheet mixes "2014", "~2023", "~2011-16 ⚠" and "unknown ⚠" in one column.
// The age filter needs a number; the uncertainty still has to be recorded, never guessed away.
function parseEstYear(raw) {
  if (!raw) return { year: null, note: 'unknown' };
  const s = String(raw).trim();
  const match = s.match(/(19|20)\d{2}/);
  if (!match) return { year: null, note: 'unknown' };
  const year = Number(match[0]);
  const approximate = s.includes('~') || /\d{4}\s*-\s*\d{2}/.test(s);
  return { year, note: approximate ? 'approximate' : null };
}

module.exports = { normalizePhone, dedupeKey, parseEstYear };
