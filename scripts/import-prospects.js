#!/usr/bin/env node
// One-time, idempotent import of the recovered call-sheet into the prospects pool.
//
// Seed source: data/seed/prospects-seed.json, frozen from two Drive revisions of
// "Niewdel — Prospecting Call-Sheet" on 2026-07-16. `live` is the sheet head;
// `deleted` is the 12 leads that revision 69 dropped when a rebuild PATCHed a
// generated xlsx over the file. They import as disqualified, not as absences.
//
// Run: node scripts/import-prospects.js

const p = require('../db/prospects');
const { parseEstYear } = require('../lib/normalize');

const GRADE = { '👍 Good': 'good', '🤷 Maybe': 'maybe', '👎 Bad': 'bad' };

// Values the 2026-07-15 rebuild flattened. Recovered from revision 68.
const RESTORE = {
  'Electricians On the Go': { stage: 'attempting', rep: 'Dillon' },
  'MOWtivated Lawn Care': { stage: 'attempting' },
  'Gwinn Lawn Care': { rep: 'Dillon' },
};

// The only two counts the sheet records as a confirmed Google read.
// CR Weavers is deliberately absent: the sheet says "conflict 19 vs 25 — confirm".
const VERIFIED_REVIEWS = new Set(['JP Lawn and Landscaping', 'Gwinn Lawn Care']);

// Business signals only. These two notes cite the owner's race; the leads import, the text does not.
const DROP_WHY = new Set(['Gwinn Lawn Care', 'Bucket Hat Landscaping']);

// Owner race/ethnicity is never a selection, exclusion, or stored factor — business
// signals only. This catches the phrase wherever it lands, in any free-text field,
// rather than depending on DROP_WHY remembering every lead/column it can hide in.
// Veteran status is deliberately excluded: it is not race or ethnicity.
const ETHNICITY_RE = /\b(black|minority|wom[ae]n|hispanic|latino|asian)[\s-]+owned\b/i;

// Removes any sentence (and, failing that, any comma-separated clause within a
// sentence) that references owner race/ethnicity, leaving the rest of the text and
// its formatting intact. Passes null/undefined through unchanged. Returns null if
// nothing survives the scrub.
function scrubEthnicity(text) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  if (!ETHNICITY_RE.test(str)) return text;

  const sentences = str.split(/(?<=[.!?])\s+/);
  const kept = [];

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    if (!ETHNICITY_RE.test(sentence)) {
      kept.push(sentence);
      continue;
    }
    // Sentence references ethnicity. Try to salvage any non-offending clauses.
    const trailingPunct = (sentence.match(/[.!?]+\s*$/) || [''])[0];
    const body = trailingPunct ? sentence.slice(0, sentence.length - trailingPunct.length) : sentence;
    const clauses = body.split(/\s*,\s*/).filter((c) => c.trim() && !ETHNICITY_RE.test(c));
    if (clauses.length) kept.push(clauses.join(', ') + trailingPunct);
    // else: the whole sentence was the ethnicity reference; drop it entirely.
  }

  const result = kept.join(' ').replace(/[ \t]+/g, ' ').trim();
  return result || null;
}

function segment(raw) {
  if (!raw) return null;
  const m = String(raw).match(/Invisible|Greenfield|Overspend/i);
  return m ? m[0] : null;
}

function websiteQuality(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return ['none', 'basic', 'good'].includes(v) ? v : 'unknown';
}

function reviewCount(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
}

function toFields(name, row, { disqualified }) {
  const est = parseEstYear(row['Est. Year']);
  const grade = GRADE[row['Grade']] || null;
  const why = DROP_WHY.has(name) ? null : scrubEthnicity(row['Why (teach me)'] || null);
  const notes = scrubEthnicity(row['Notes (why-not-hot / objections)'] || null);
  const hook = scrubEthnicity(row['Hook (the one specific observation)'] || null);

  let status = 'new';
  if (disqualified) status = 'disqualified';
  else if (grade === 'good' || grade === 'maybe') status = 'qualified';

  return {
    business_name: name,
    trade: row['Trade'] || null,
    city: row['City'] || null,
    owner_name: row['Owner Name'] || null,
    phone: row['Primary Phone'] || null,
    email: row['Email'] || null,
    social: row['IG / FB'] || null,
    website_url: row['Website Link'] || null,
    website_quality: websiteQuality(row['Website?']),
    rating: row['Rating'] ? Number(row['Rating']) : null,
    review_count: reviewCount(row['# Reviews']),
    review_source: row['# Reviews'] ? 'sheet import' : null,
    review_verified: VERIFIED_REVIEWS.has(name) ? 1 : 0,
    runs_ads: 'unknown',
    est_year: est.year,
    est_year_note: est.note,
    segment: segment(row['Segment']),
    hook,
    grade,
    grade_why: why,
    notes,
    next_action: row['Next Action'] || null,
    rep: row['Rep'] || null,
    stage: (row['Stage'] || 'new').toLowerCase().replace(/[^a-z]/g, '_'),
    status,
    disqualified_reason: disqualified
      ? (notes || 'Dropped by the 2026-07-15 rebuild; reason not recorded')
      : null,
    source_kind: 'sheet',
    ...(RESTORE[name] || {}),
  };
}

function importProspects(seed) {
  let imported = 0;
  let skipped = 0;

  const load = (bucket, disqualified) => {
    for (const [name, row] of Object.entries(bucket)) {
      const fields = toFields(name, row, { disqualified });
      if (p.findDuplicate({ phone: fields.phone, business_name: name, city: fields.city })) {
        skipped++;
        continue;
      }
      p.createProspect(fields);
      imported++;
    }
  };

  load(seed.live, false);
  load(seed.deleted, true);

  return {
    imported,
    skipped,
    live: Object.keys(seed.live).length,
    disqualified: Object.keys(seed.deleted).length,
  };
}

module.exports = { importProspects, scrubEthnicity };

if (require.main === module) {
  const seed = require('../data/seed/prospects-seed.json');
  const out = importProspects(seed);
  console.log(`Imported ${out.imported}, skipped ${out.skipped} already present.`);
  console.log(`Pool: ${out.live} live, ${out.disqualified} disqualified and kept on record.`);
}
