// Prospect CRM data access.
//
// HARD RULE: this module has no delete path and never will. A lead retires via
// disqualifyProspect(), which sets a status and a reason and leaves the row in place.
// A rebuild once wiped this data in the Google Sheet; the absence of a delete
// function is the structural guarantee that it cannot happen here.
//
// Dillon-owned columns (grade, grade_why, stage, rep, next_action, next_date, notes)
// are only ever written by the explicit user-action functions in this module.
// updateResearch() cannot touch them.

const { getDb } = require('../database');
const { normalizePhone, dedupeKey } = require('../lib/normalize');

const RESEARCH_FIELDS = [
  'business_name', 'trade', 'city', 'state', 'owner_name', 'phone', 'email', 'social',
  'website_url', 'website_quality', 'rating', 'review_count', 'review_source',
  'review_verified', 'runs_ads', 'est_year', 'est_year_note', 'segment', 'hook',
  'source_run_id', 'source_kind', 'source_urls',
];

function getProspectById(id) {
  return getDb().prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}

function createProspect(fields) {
  const phone_normalized = normalizePhone(fields.phone);
  const key = dedupeKey(fields.business_name, fields.city);

  const cols = [];
  const vals = [];
  for (const f of RESEARCH_FIELDS) {
    if (fields[f] !== undefined) { cols.push(f); vals.push(fields[f]); }
  }
  // Seeded imports carry Dillon's own prior work; nothing else may set these.
  for (const f of ['grade', 'grade_why', 'stage', 'rep', 'next_action', 'next_date',
                   'notes', 'status', 'disqualified_reason']) {
    if (fields[f] !== undefined) { cols.push(f); vals.push(fields[f]); }
  }
  cols.push('phone_normalized', 'dedupe_key');
  vals.push(phone_normalized, key);

  const placeholders = cols.map(() => '?').join(', ');
  const result = getDb()
    .prepare(`INSERT INTO prospects (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...vals);
  return getProspectById(result.lastInsertRowid);
}

// Phone is the strong signal; name+city is the fallback when a lead has no number.
// Deliberately searches every status, so a disqualified lead is never re-added.
function findDuplicate({ phone, business_name, city }) {
  const d = getDb();
  const normalized = normalizePhone(phone);
  if (normalized) {
    const byPhone = d.prepare('SELECT * FROM prospects WHERE phone_normalized = ?').get(normalized);
    if (byPhone) return byPhone;
  }
  return d.prepare('SELECT * FROM prospects WHERE dedupe_key = ?').get(dedupeKey(business_name, city));
}

function getProspects({ status, stage, trade, city } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (stage) { where.push('stage = ?'); params.push(stage); }
  if (trade) { where.push('trade = ?'); params.push(trade); }
  if (city) { where.push('city = ?'); params.push(city); }
  return getDb().prepare(`
    SELECT * FROM prospects
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, id DESC
  `).all(...params);
}

function touch(id) {
  getDb().prepare('UPDATE prospects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return getProspectById(id);
}

// A good or maybe grade qualifies the lead. Maybe is still callable: "borderline,
// either perfect or it is not" is not a rejection.
function gradeProspect(id, { grade, grade_why = null }) {
  if (grade === 'bad') {
    throw new Error('A bad grade retires a lead. Use disqualifyProspect(id, reason) so the reason is recorded.');
  }
  if (!['good', 'maybe'].includes(grade)) {
    throw new Error(`Unknown grade: ${grade}`);
  }
  getDb().prepare(
    "UPDATE prospects SET grade = ?, grade_why = ?, status = 'qualified' WHERE id = ?"
  ).run(grade, grade_why, id);
  return touch(id);
}

// The only retirement path. The row is never removed.
function disqualifyProspect(id, reason) {
  if (!reason || !String(reason).trim()) {
    throw new Error('disqualifyProspect requires a reason. A rejection without a reason teaches us nothing.');
  }
  getDb().prepare(
    "UPDATE prospects SET status = 'disqualified', grade = 'bad', disqualified_reason = ? WHERE id = ?"
  ).run(String(reason).trim(), id);
  return touch(id);
}

// Machine-owned columns only. Dillon-owned keys are dropped on the floor by design,
// so no automated path can overwrite his work the way the sheet rebuild did.
function updateResearch(id, fields) {
  const keys = Object.keys(fields).filter((k) => RESEARCH_FIELDS.includes(k));
  if (keys.length === 0) return getProspectById(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE prospects SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  return touch(id);
}

// Append-only. There is deliberately no updateActivity or deleteActivity:
// the record of what happened on a call is immutable, and stage is a summary of it.
function logActivity({ prospect_id, type, outcome = null, notes = null, rep = null, cadence_step = null }) {
  const result = getDb().prepare(`
    INSERT INTO activities (prospect_id, type, outcome, notes, rep, cadence_step)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(prospect_id, type, outcome, notes, rep, cadence_step);
  return getDb().prepare('SELECT * FROM activities WHERE id = ?').get(result.lastInsertRowid);
}

function getActivities(prospect_id) {
  return getDb().prepare(
    'SELECT * FROM activities WHERE prospect_id = ? ORDER BY occurred_at DESC, id DESC'
  ).all(prospect_id);
}

module.exports = {
  createProspect, getProspectById, getProspects, findDuplicate,
  gradeProspect, disqualifyProspect, updateResearch,
  logActivity, getActivities,
};
