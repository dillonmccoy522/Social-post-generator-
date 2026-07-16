process.env.DB_PATH = ':memory:';
const db = require('../database');
const p = require('../db/prospects');
const { importProspects, scrubEthnicity } = require('../scripts/import-prospects');
const seed = require('../data/seed/prospects-seed.json');

afterEach(() => {
  db.closeDb();
});

test('the seed holds all 30 recovered leads', () => {
  expect(Object.keys(seed.live)).toHaveLength(18);
  expect(Object.keys(seed.deleted)).toHaveLength(12);
});

test('import lands all 30 leads', () => {
  const out = importProspects(seed);
  expect(out.imported).toBe(30);
  expect(p.getProspects()).toHaveLength(30);
});

test('the 12 deleted leads import as disqualified with a reason', () => {
  importProspects(seed);
  const gone = p.getProspects({ status: 'disqualified' });
  expect(gone).toHaveLength(12);
  for (const g of gone) expect(g.disqualified_reason).toBeTruthy();
  expect(gone.map((g) => g.business_name)).toEqual(expect.arrayContaining([
    'Amen Plumbing', 'Dedicated Heating and Air', 'Ben Ross Roofing', 'Bucket Hat Landscaping',
  ]));
});

test('import restores the three values the rebuild flattened', () => {
  importProspects(seed);
  const byName = (n) => p.getProspects().find((r) => r.business_name === n);
  expect(byName('Electricians On the Go')).toMatchObject({ stage: 'attempting', rep: 'Dillon' });
  expect(byName('MOWtivated Lawn Care')).toMatchObject({ stage: 'attempting' });
  expect(byName('Gwinn Lawn Care')).toMatchObject({ rep: 'Dillon' });
});

test('import preserves Dillon grades verbatim', () => {
  importProspects(seed);
  const mkb = p.getProspects().find((r) => r.business_name === 'MKB Plumbing & Septic');
  expect(mkb.grade).toBe('good');
  expect(mkb.grade_why).toMatch(/less reviews/i);
  expect(mkb.status).toBe('qualified');
});

test('ONLY JP Lawn and Gwinn import as verified review counts', () => {
  importProspects(seed);
  const verified = p.getProspects().filter((r) => r.review_verified === 1);
  expect(verified.map((r) => r.business_name).sort())
    .toEqual(['Gwinn Lawn Care', 'JP Lawn and Landscaping']);
});

test('CR Weavers imports unverified because the sheet flags a conflict', () => {
  importProspects(seed);
  const cr = p.getProspects().find((r) => r.business_name === 'CR Weavers Heating & Cooling');
  expect(cr.review_verified).toBe(0);
  expect(cr.grade).toBe('maybe');
  expect(cr.status).toBe('qualified');
});

test('no imported note references owner race', () => {
  importProspects(seed);
  const all = p.getProspects()
    .map((r) => `${r.grade_why || ''} ${r.notes || ''} ${r.hook || ''}`)
    .join(' ')
    .toLowerCase();
  expect(all).not.toMatch(/\b(black|minority|wom[ae]n|hispanic|latino|asian)[\s-]+owned\b/);
});

describe('scrubEthnicity', () => {
  test('removes the ethnicity clause but preserves the rest of Bucket Hat\'s notes', () => {
    const raw = 'Est. 2023 (~2y, verified). ⚠Google reviews UNVERIFIED (may fail 15 floor). '
      + 'Minority-owned. Calvin Dulin (verified).';
    const scrubbed = scrubEthnicity(raw);
    expect(scrubbed).not.toMatch(/minority[\s-]+owned/i);
    expect(scrubbed).toContain('Est. 2023 (~2y, verified).');
    expect(scrubbed).toContain('⚠Google reviews UNVERIFIED (may fail 15 floor).');
    expect(scrubbed).toContain('Calvin Dulin (verified).');
  });

  test('passes null and undefined through unchanged', () => {
    expect(scrubEthnicity(null)).toBeNull();
    expect(scrubEthnicity(undefined)).toBeUndefined();
  });

  test('returns text unchanged when there is nothing to scrub', () => {
    expect(scrubEthnicity('7-yr father/son shop, veteran-owned.')).toBe('7-yr father/son shop, veteran-owned.');
  });

  test('returns null when the entire string is the ethnicity reference', () => {
    expect(scrubEthnicity('Black owned.')).toBeNull();
  });
});

test('est_year parses without inventing a year', () => {
  importProspects(seed);
  const byName = (n) => p.getProspects().find((r) => r.business_name === n);
  expect(byName('Arctic Desert Cooling & Heating').est_year).toBe(2025);
  expect(byName('MKB Plumbing & Septic').est_year).toBe(2014);
  expect(byName('Electricians On the Go').est_year).toBeNull();
  expect(byName('Electricians On the Go').est_year_note).toBe('unknown');
});

test('IDEMPOTENT: re-running imports nothing new', () => {
  importProspects(seed);
  const again = importProspects(seed);
  expect(again.imported).toBe(0);
  expect(again.skipped).toBe(30);
  expect(p.getProspects()).toHaveLength(30);
});
