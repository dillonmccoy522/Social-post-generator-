// Schema for the prospecting CRM. Pure: takes a db handle, imports nothing.
// Called from database.js initSchema so there is one connection and no require cycle.

// The Playbook cadence, as data. Source: the call-sheet's Playbook tab.
const CADENCE = [
  { step_number: 1, day_offset: 0,  channel: 'call',  label: 'First call + intro email' },
  { step_number: 2, day_offset: 1,  channel: 'call',  label: 'Second call' },
  { step_number: 3, day_offset: 3,  channel: 'dm',    label: 'DM / social touch' },
  { step_number: 4, day_offset: 4,  channel: 'call',  label: 'Third call' },
  { step_number: 5, day_offset: 6,  channel: 'email', label: 'Free audit email' },
  { step_number: 6, day_offset: 8,  channel: 'call',  label: 'Fourth call' },
  { step_number: 7, day_offset: 11, channel: 'sms',   label: 'DM / SMS' },
  { step_number: 8, day_offset: 13, channel: 'call',  label: '"Close your file?" call' },
  { step_number: 9, day_offset: 15, channel: 'email', label: 'Breakup email' },
];

function initProspectsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sourcing_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filters TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','done','failed')),
      requested_count INTEGER NOT NULL DEFAULT 0,
      searched_count INTEGER NOT NULL DEFAULT 0,
      dupe_count INTEGER NOT NULL DEFAULT 0,
      enriched_count INTEGER NOT NULL DEFAULT 0,
      passed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      business_name TEXT NOT NULL,
      trade TEXT DEFAULT NULL,
      city TEXT DEFAULT NULL,
      state TEXT DEFAULT 'NC',
      owner_name TEXT DEFAULT NULL,
      phone TEXT DEFAULT NULL,
      email TEXT DEFAULT NULL,
      social TEXT DEFAULT NULL,

      website_url TEXT DEFAULT NULL,
      website_quality TEXT DEFAULT 'unknown'
        CHECK (website_quality IN ('none','basic','good','unknown')),
      rating REAL DEFAULT NULL,
      review_count INTEGER DEFAULT NULL,
      review_source TEXT DEFAULT NULL,
      review_verified INTEGER NOT NULL DEFAULT 0,
      runs_ads TEXT NOT NULL DEFAULT 'unknown'
        CHECK (runs_ads IN ('google','meta','both','no','unknown')),
      est_year INTEGER DEFAULT NULL,
      est_year_note TEXT DEFAULT NULL,
      segment TEXT DEFAULT NULL,
      hook TEXT DEFAULT NULL,

      grade TEXT DEFAULT NULL CHECK (grade IN ('good','bad','maybe') OR grade IS NULL),
      grade_why TEXT DEFAULT NULL,
      stage TEXT NOT NULL DEFAULT 'new'
        CHECK (stage IN ('new','attempting','connected','meeting_set','proposal','won','dead_nurture')),
      rep TEXT DEFAULT NULL,
      next_action TEXT DEFAULT NULL,
      next_date DATE DEFAULT NULL,
      notes TEXT DEFAULT NULL,

      status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','qualified','disqualified')),
      disqualified_reason TEXT DEFAULT NULL,

      cadence_step INTEGER NOT NULL DEFAULT 0,
      next_touch_at DATETIME DEFAULT NULL,

      source_run_id INTEGER DEFAULT NULL REFERENCES sourcing_runs(id),
      source_kind TEXT NOT NULL DEFAULT 'hand'
        CHECK (source_kind IN ('hand','sheet','agent','provider')),
      source_urls TEXT DEFAULT NULL,

      phone_normalized TEXT DEFAULT NULL,
      dedupe_key TEXT NOT NULL,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_prospects_phone ON prospects(phone_normalized);
    CREATE INDEX IF NOT EXISTS idx_prospects_dedupe ON prospects(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS idx_prospects_touch ON prospects(next_touch_at);

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER NOT NULL REFERENCES prospects(id),
      type TEXT NOT NULL
        CHECK (type IN ('call','email','dm','sms','note','stage_change')),
      outcome TEXT DEFAULT NULL
        CHECK (outcome IN ('no_answer','voicemail','gatekeeper','connected','callback',
                           'not_interested','meeting_set') OR outcome IS NULL),
      notes TEXT DEFAULT NULL,
      rep TEXT DEFAULT NULL,
      cadence_step INTEGER DEFAULT NULL,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospect_id);

    CREATE TABLE IF NOT EXISTS cadence_steps (
      step_number INTEGER PRIMARY KEY,
      day_offset INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('call','email','dm','sms')),
      label TEXT NOT NULL
    );
  `);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO cadence_steps (step_number, day_offset, channel, label) VALUES (?, ?, ?, ?)'
  );
  for (const s of CADENCE) insert.run(s.step_number, s.day_offset, s.channel, s.label);
}

module.exports = { initProspectsSchema, CADENCE };
