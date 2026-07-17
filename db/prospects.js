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
const { MIN_EST_YEAR } = require('./prospects-schema');

const RESEARCH_FIELDS = [
  'business_name', 'trade', 'city', 'state', 'owner_name', 'phone', 'email', 'social',
  'website_url', 'website_quality', 'rating', 'review_count', 'review_source',
  'review_verified', 'runs_ads', 'est_year', 'est_year_note', 'segment', 'hook',
  'source_run_id', 'source_kind', 'source_urls',
];

// Dillon's columns. No automated path may write these — that is what updateResearch is
// forbidden from touching. updateUserFields is the deliberate user-action counterpart:
// it is what the detail page saves through, and only a person clicking Save reaches it.
const USER_FIELDS = [
  'stage', 'rep', 'next_action', 'next_date', 'notes',
  'deal_service', 'deal_value', 'deal_objections', 'proposal_sent_at',
];

// Grade is excluded from USER_FIELDS on purpose: it routes through gradeProspect /
// disqualifyProspect so a rejection always carries a reason.

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

// The human edit path. Reachable only from the detail-page Save. It may write identity,
// the research facts, and Dillon-owned columns — but never grade/status/disqualified_reason,
// which route through gradeProspect/disqualifyProspect so a rejection always carries a reason.
const EDITABLE_IDENTITY = ['business_name', 'trade', 'city', 'state', 'owner_name', 'phone', 'email', 'social'];
const EDITABLE_FACTS = ['website_url', 'website_quality', 'rating', 'review_count', 'review_source',
                        'est_year', 'est_year_note', 'segment', 'hook', 'runs_ads'];
const SAVEABLE = [...EDITABLE_IDENTITY, ...EDITABLE_FACTS, ...USER_FIELDS];

function saveProspectEdits(id, fields) {
  const before = getProspectById(id);
  if (!before) return undefined;
  const keys = Object.keys(fields).filter((k) => SAVEABLE.includes(k));
  if (keys.length === 0) return before;

  const set = {};
  for (const k of keys) set[k] = fields[k];

  // A hand-corrected review count is a confirmed Google read.
  if (keys.includes('review_count') && Number(fields.review_count) !== before.review_count) {
    set.review_verified = 1;
    if (!keys.includes('review_source')) set.review_source = 'manual';
  }
  // Recompute the derived keys when their inputs change.
  if (keys.includes('phone')) set.phone_normalized = normalizePhone(fields.phone);
  if (keys.includes('business_name') || keys.includes('city')) {
    const name = keys.includes('business_name') ? fields.business_name : before.business_name;
    const city = keys.includes('city') ? fields.city : before.city;
    set.dedupe_key = dedupeKey(name, city);
  }

  const cols = Object.keys(set);
  const assignments = cols.map((c) => `${c} = ?`).join(', ');
  getDb().prepare(`UPDATE prospects SET ${assignments} WHERE id = ?`).run(...cols.map((c) => set[c]), id);
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

// Contacts — the people at a business. Append-only like everything else: a contact who
// leaves gets is_active = 0. There is deliberately no deleteContact.
function getContacts(prospect_id) {
  return getDb().prepare(
    'SELECT * FROM contacts WHERE prospect_id = ? ORDER BY is_active DESC, created_at DESC, id DESC'
  ).all(prospect_id);
}

function getContactById(id) {
  return getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
}

function createContact({ prospect_id, name, role = null, phone = null, email = null,
                         is_decision_maker = 0, is_gatekeeper = 0, notes = null }) {
  if (!name || !String(name).trim()) throw new Error('A contact needs a name.');
  const result = getDb().prepare(`
    INSERT INTO contacts (prospect_id, name, role, phone, email, is_decision_maker, is_gatekeeper, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(prospect_id, String(name).trim(), role, phone, email,
         is_decision_maker ? 1 : 0, is_gatekeeper ? 1 : 0, notes);
  return getContactById(result.lastInsertRowid);
}

const CONTACT_FIELDS = ['name', 'role', 'phone', 'email', 'is_decision_maker', 'is_gatekeeper', 'notes'];
function updateContact(id, fields) {
  const keys = Object.keys(fields).filter((k) => CONTACT_FIELDS.includes(k));
  if (keys.length === 0) return getContactById(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE contacts SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  return getContactById(id);
}

function deactivateContact(id) {
  getDb().prepare('UPDATE contacts SET is_active = 0 WHERE id = ?').run(id);
  return getContactById(id);
}

// Outcomes that end the sequence rather than advance it.
const EXIT_OUTCOMES = {
  meeting_set: 'meeting_set',
  not_interested: 'dead_nurture',
};

// Outcomes that advance the sequence and also move the stage.
const STAGE_ON_ADVANCE = {
  connected: 'connected',
  callback: 'attempting',
};

function getCadence() {
  return getDb().prepare('SELECT * FROM cadence_steps ORDER BY step_number').all();
}

// `cadence_step` is the number of the LAST COMPLETED step. 0 means never touched.
// The step that is next due is therefore cadence_step + 1. One meaning, everywhere.
function nextDueStep(steps, cadence_step) {
  return steps.find((s) => s.step_number === (cadence_step || 0) + 1);
}

// One tap from Due Today lands here: log it, advance the cadence, schedule the next touch.
function recordTouch(prospect_id, { outcome, notes = null, rep = null }) {
  const before = getProspectById(prospect_id);
  if (!before) throw new Error(`No prospect ${prospect_id}`);

  const steps = getCadence();
  const thisStep = nextDueStep(steps, before.cadence_step);
  if (!thisStep) {
    throw new Error(`Prospect ${prospect_id} has finished the cadence; there is no step to record.`);
  }

  logActivity({
    prospect_id,
    type: thisStep.channel,
    outcome,
    notes,
    rep,
    cadence_step: thisStep.step_number,
  });

  const d = getDb();

  if (EXIT_OUTCOMES[outcome]) {
    d.prepare('UPDATE prospects SET cadence_step = ?, stage = ?, next_touch_at = NULL WHERE id = ?')
      .run(thisStep.step_number, EXIT_OUTCOMES[outcome], prospect_id);
    return touch(prospect_id);
  }

  const nextStep = steps.find((s) => s.step_number === thisStep.step_number + 1);

  // Out of steps: the sequence breaks itself up rather than leaving a lead in limbo.
  if (!nextStep) {
    d.prepare(
      "UPDATE prospects SET cadence_step = ?, stage = 'dead_nurture', next_touch_at = NULL WHERE id = ?"
    ).run(thisStep.step_number, prospect_id);
    return touch(prospect_id);
  }

  const dayGap = nextStep.day_offset - thisStep.day_offset;
  const dueAt = toSqlUtc(new Date(Date.now() + dayGap * 86400000));
  const stage = STAGE_ON_ADVANCE[outcome] || (before.stage === 'new' ? 'attempting' : before.stage);

  d.prepare('UPDATE prospects SET cadence_step = ?, next_touch_at = ?, stage = ? WHERE id = ?')
    .run(thisStep.step_number, dueAt, stage, prospect_id);
  return touch(prospect_id);
}

// Call logging that does NOT schedule a next touch. recordTouch (the cadence path) stays
// dormant; this is what the detail page calls. Stage moves only on outcomes that mean it.
const STAGE_ON_LOG = {
  connected: 'connected',
  meeting_set: 'meeting_set',
  not_interested: 'dead_nurture',
};

function logCall(prospect_id, { outcome, notes = null, channel = 'call', rep = 'Dillon' } = {}) {
  const before = getProspectById(prospect_id);
  if (!before) throw new Error(`No prospect ${prospect_id}`);

  logActivity({ prospect_id, type: channel, outcome, notes, rep });

  const stage = STAGE_ON_LOG[outcome] || (before.stage === 'new' ? 'attempting' : before.stage);
  getDb().prepare('UPDATE prospects SET stage = ? WHERE id = ?').run(stage, prospect_id);
  return touch(prospect_id);
}

// SQLite stores datetimes as 'YYYY-MM-DD HH:MM:SS' in UTC, matching CURRENT_TIMESTAMP.
// Kept in one place so the write format and the read format cannot drift apart.
function toSqlUtc(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// The morning list: who is due, and what the touch is.
function getDueToday(now = new Date()) {
  const rows = getDb().prepare(`
    SELECT * FROM prospects
    WHERE status = 'qualified'
      AND stage NOT IN ('won', 'dead_nurture')
      AND next_touch_at IS NOT NULL
      AND next_touch_at <= ?
    ORDER BY next_touch_at ASC
  `).all(toSqlUtc(now));
  const steps = getCadence();
  return rows.map((r) => ({ ...r, touch: nextDueStep(steps, r.cadence_step) }));
}

const RUN_UPDATE_FIELDS = ['status', 'searched_count', 'dupe_count', 'enriched_count',
                           'passed_count', 'error', 'completed_at'];

function getSourcingRunById(id) {
  return getDb().prepare('SELECT * FROM sourcing_runs WHERE id = ?').get(id);
}

function createSourcingRun({ filters = {}, requested_count = 0 }) {
  const result = getDb()
    .prepare('INSERT INTO sourcing_runs (filters, requested_count) VALUES (?, ?)')
    .run(JSON.stringify(filters), requested_count);
  return getSourcingRunById(result.lastInsertRowid);
}

function updateSourcingRun(id, fields) {
  const keys = Object.keys(fields).filter((k) => RUN_UPDATE_FIELDS.includes(k));
  if (keys.length === 0) return getSourcingRunById(id);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE sourcing_runs SET ${set} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  return getSourcingRunById(id);
}

module.exports = {
  createProspect, getProspectById, getProspects, findDuplicate,
  gradeProspect, disqualifyProspect, updateResearch, saveProspectEdits,
  logActivity, getActivities,
  getContacts, getContactById, createContact, updateContact, deactivateContact,
  getCadence, recordTouch, getDueToday, logCall,
  createSourcingRun, getSourcingRunById, updateSourcingRun,
};
