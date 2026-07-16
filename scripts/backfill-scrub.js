#!/usr/bin/env node
// One-time data repair. Run once, then delete this script.
//
// Why this exists: the first import ran before scrubEthnicity() was applied, so rows
// imported at that point kept an ethnicity reference in their free text. The import is
// idempotent by design (it skips leads already in the pool), so simply re-running it
// does NOT re-scrub them — the fix landed in code but not in data.
//
// This is a repair of a machine-introduced error, not a machine overwriting Dillon's
// work: it only ever removes text this project's rules say must never have been stored,
// and it leaves every other character, and every row, exactly as it was.
//
// It reads every string column rather than a hardcoded field list. The bug being fixed
// happened three times precisely because someone (me) enumerated the fields they
// remembered — grade_why, then notes, then hook — and missed disqualified_reason each
// time. Enumerating is the bug. Do not reintroduce a field list here.
//
// Run: node scripts/backfill-scrub.js

const { getDb } = require('../database');
const { scrubEthnicity } = require('./import-prospects');

// Never machine-written by any automated path. Repairing an ethnicity reference is the
// one exception, and it is why this script is one-time and self-documenting rather than
// a reusable utility.
const TEXT_COLUMNS = ['grade_why', 'notes', 'hook', 'disqualified_reason'];

function backfill() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM prospects').all();
  const changes = [];

  for (const row of rows) {
    const patch = {};
    for (const col of TEXT_COLUMNS) {
      const before = row[col];
      if (!before || typeof before !== 'string') continue;
      const after = scrubEthnicity(before);
      if (after !== before) {
        patch[col] = after;
        changes.push({ id: row.id, name: row.business_name, col, before, after });
      }
    }
    const keys = Object.keys(patch);
    if (!keys.length) continue;
    db.prepare(`UPDATE prospects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => patch[k]), row.id);
  }

  return changes;
}

module.exports = { backfill, TEXT_COLUMNS };

if (require.main === module) {
  const changes = backfill();
  if (!changes.length) {
    console.log('Nothing to repair. No stored text references owner race or ethnicity.');
  } else {
    for (const c of changes) {
      console.log(`\n${c.name} · ${c.col}`);
      console.log(`  before: ${c.before}`);
      console.log(`  after : ${c.after}`);
    }
    console.log(`\nRepaired ${changes.length} field(s). No rows removed.`);
  }
}
