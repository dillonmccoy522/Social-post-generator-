const { normalizePhone, dedupeKey, parseEstYear } = require('../lib/normalize');

test('normalizePhone strips formatting to digits', () => {
  expect(normalizePhone('(980) 436-7390')).toBe('9804367390');
  expect(normalizePhone('980.436.7390')).toBe('9804367390');
  expect(normalizePhone('980-436-7390')).toBe('9804367390');
});

test('normalizePhone strips a leading US country code', () => {
  expect(normalizePhone('+1 (980) 436-7390')).toBe('9804367390');
  expect(normalizePhone('19804367390')).toBe('9804367390');
});

test('normalizePhone returns null for unusable input', () => {
  expect(normalizePhone(null)).toBeNull();
  expect(normalizePhone('')).toBeNull();
  expect(normalizePhone('call the office')).toBeNull();
  expect(normalizePhone('555-1234')).toBeNull();
});

test('dedupeKey is case and whitespace insensitive', () => {
  expect(dedupeKey('CR Weavers Heating & Cooling', 'Kannapolis'))
    .toBe(dedupeKey('  cr weavers   heating & cooling ', 'KANNAPOLIS'));
});

test('dedupeKey tolerates a missing city', () => {
  expect(dedupeKey('Boss Wash', null)).toBe('boss wash|');
});

test('parseEstYear reads an exact year', () => {
  expect(parseEstYear('2014')).toEqual({ year: 2014, note: null });
});

test('parseEstYear marks an approximate year', () => {
  expect(parseEstYear('~2023')).toEqual({ year: 2023, note: 'approximate' });
  expect(parseEstYear('~2011-16 ⚠')).toEqual({ year: 2011, note: 'approximate' });
});

test('parseEstYear marks unknown without inventing a year', () => {
  expect(parseEstYear('unknown ⚠')).toEqual({ year: null, note: 'unknown' });
  expect(parseEstYear(null)).toEqual({ year: null, note: 'unknown' });
  expect(parseEstYear('')).toEqual({ year: null, note: 'unknown' });
});
