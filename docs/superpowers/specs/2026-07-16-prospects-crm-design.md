# Prospects CRM Module — Design

**Date:** 2026-07-16
**Owner:** Dillon (Chief Growth Officer)
**Status:** Design approved, ready for implementation plan
**Repo:** `~/Niewdel /social-dashboard`

## Goal

Move Niewdel's prospecting from a Google Sheet into the dashboard as a CRM module: a pool of
leads, a filter panel that sources new ones on demand, a grading queue, and a call pipeline
with an automated cadence.

Replaces the sheet "Niewdel — Prospecting Call-Sheet"
(`1fkC_JuWp0LlcKvsm5JMTCaDMKPwM2GoNzrjqBVDPGy4`), which becomes a read-only archive.

## Background: why we are leaving the sheet

On 2026-07-15 a rebuild script (`update_gsheet.py`) PATCHed a freshly built `.xlsx` over the
whole file. It overwrote Dillon's live hand-edits (Stage on 2 leads, Rep on 3) and dropped 12
leads that a verification pass had "disqualified." The sheet had two writers, no merge rules,
and no history. Nobody noticed for a day.

The data model below exists to make that class of loss impossible.

## Hard rule

**Nothing is ever deleted or machine-overwritten.** Not rejected leads, not 👎 grades, not
disqualified rows. A lead retires by getting a `status` and a reason. The row stays forever.

Two mechanisms enforce it:

1. No `deleteProspect()` function exists. Retirement is `status='disqualified'` +
   `disqualified_reason`.
2. Dillon-owned columns are never written by any automated path. Only a user action writes them.

## Scope

**In scope (this spec):** the Prospects module — schema, sourcing run, grading queue, call
pipeline with cadence, and the one-time migration of all 30 known leads.

**Out of scope (separate specs, in order):**

- **Paid provider ingestion.** Outscraper / Apify / Google Places bulk harvest into the pool.
  Deferred, but the ingestion boundary is designed for it now (see Sourcing sources).
- **Sourcing quality tuning.** Feedback loop from grades back into the sourcing prompt/ICP.
  Needs grading data that does not exist yet. Blocked on this module shipping.
- **Aligning the app shell to brand v4.0.** See Brand.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Source of truth | **The app.** Sheet imported once, then read-only archive. | Only option where never-delete is enforced by the database rather than by everyone remembering. |
| Pool | **Accumulated, not pre-harvested.** Every run appends; the pool never shrinks. | We have no reservoir to filter against. The pool grows into one, and dedupe makes it smarter each run. |
| Sourcing | **Hybrid: harvest cheap, enrich deep.** Seed batch hand-researched. | Review count is the #1 filter and is cheap to get. Age and site quality are the best filters and cannot be bulk-harvested. Cull on the cheap ones before paying for the expensive ones. |
| Cadence | **Auto-schedule the next touch.** One cadence for all segments. | The 9-touch Playbook already exists in a document that requires remembering it. Moving it into the app turns it into a list that says what to do today. Per-segment later via `cadence_id`. |
| Primary screen | **Due Today**, not a lead grid. | Answers "who is due right now and what is the touch," not "what leads do I have." |
| Brand | **Brand v4.0 for this module.** Shell aligned in a follow-up. | Brand guidelines v4.0 (July 2026) postdate the app's 2026-07-10 redesign. |

## Data model

Four tables in `database.js`, following existing conventions: `CREATE TABLE IF NOT EXISTS` in
`initSchema`, `migrate*` functions for column additions, `getX` / `createX` / `updateX` exports.

### `prospects` — the pool (append-only)

| Group | Columns |
|---|---|
| Identity | `business_name` NOT NULL, `trade`, `city`, `state` DEFAULT 'NC', `owner_name`, `phone`, `email`, `social` |
| Research (machine-owned) | `website_url`, `website_quality` CHECK IN (`none`,`basic`,`good`,`unknown`), `rating` REAL, `review_count` INT, `review_source`, `review_verified` INT DEFAULT 0, `runs_ads` DEFAULT 'unknown', `est_year`, `segment`, `hook` |
| Dillon-owned (never machine-written) | `grade` CHECK IN (`good`,`bad`,`maybe`,NULL), `grade_why`, `stage`, `rep`, `next_action`, `next_date`, `notes` |
| Lifecycle | `status` CHECK IN (`new`,`qualified`,`disqualified`) DEFAULT 'new', `disqualified_reason` |
| Cadence | `cadence_step` INT DEFAULT 0, `next_touch_at` DATETIME |
| Provenance | `source_run_id` REFERENCES `sourcing_runs(id)`, `source_kind` CHECK IN (`hand`,`agent`,`provider`,`sheet`), `source_urls` (JSON), `created_at`, `updated_at` |
| Dedupe | `phone_normalized` (digits only), `dedupe_key` (`lower(business_name)` + `|` + `lower(city)`) |

`stage` values: `new`, `attempting`, `connected`, `meeting_set`, `proposal`, `won`,
`dead_nurture`. Matches the sheet so the migration is lossless.

**`status` and `stage` are different axes and must not overlap.**

- `status` is the **pool gate**: has this lead been graded, and is it in play?
  `new` (ungraded, sits in the Queue) -> `qualified` (👍 or 🤷, enters the pipeline) or
  `disqualified` (👎, leaves the call list, row stays forever).
- `stage` is the **pipeline position** for qualified leads, and owns the outcome:
  `won` and `dead_nurture` live here, not in `status`.

Grade-to-status mapping is mechanical: 👍 `good` -> `qualified`; 🤷 `maybe` -> `qualified`
(graded, still callable — CR Weavers is the case that motivated this); 👎 `bad` ->
`disqualified` + a required reason.

A lead is on the call list when `status='qualified'` AND `stage` is not `won` or
`dead_nurture`.

**Indexes:** `phone_normalized`, `dedupe_key`, `status`, `next_touch_at`.

**`review_verified` matters.** Today "27 reviews (Birdeye)" and "27 reviews (confirmed Google)"
are indistinguishable. Platform proxies under-report badly — Amen showed 150, Dedicated 365.
Splitting `review_count` / `review_source` / `review_verified` lets the #1 filter say "only
leads whose count is actually confirmed."

### `sourcing_runs` — one row per button press

Mirrors the `assets` status pattern exactly.

`filters` (JSON), `status` CHECK IN (`queued`,`running`,`done`,`failed`) DEFAULT 'queued',
`requested_count`, `searched_count`, `dupe_count`, `enriched_count`, `passed_count`,
`error`, `created_at`, `completed_at`.

The counts exist so a run reports what it dropped. Silent truncation reads as "covered
everything" when it did not.

### `activities` — every touch (append-only, never edited)

`prospect_id` NOT NULL REFERENCES `prospects(id)`, `type` CHECK IN
(`call`,`email`,`dm`,`sms`,`note`,`stage_change`), `outcome` CHECK IN
(`no_answer`,`voicemail`,`gatekeeper`,`connected`,`callback`,`not_interested`,`meeting_set`,NULL),
`notes`, `rep`, `cadence_step`, `occurred_at` DEFAULT CURRENT_TIMESTAMP.

This is the never-delete rule as a table. Stage becomes a derived summary of activity history
rather than the only record of it. No `updateActivity()`, no `deleteActivity()`.

### `cadence_steps` — the Playbook as data

`step_number`, `day_offset`, `channel` (`call`/`email`/`dm`/`sms`), `label`.

Seeded from the existing Playbook tab:

| Step | Day | Channel | Label |
|---|---|---|---|
| 1 | 0 | call | First call + intro email |
| 2 | 1 | call | Second call |
| 3 | 3 | dm | DM / social touch |
| 4 | 4 | call | Third call |
| 5 | 6 | email | Free audit email |
| 6 | 8 | call | Fourth call |
| 7 | 11 | sms | DM / SMS |
| 8 | 13 | call | "Close your file?" call |
| 9 | 15 | email | Breakup email |

Logging a touch advances `cadence_step` and sets `next_touch_at = now + (next step's
day_offset - current step's day_offset)`.

## Sourcing run

### API

```
POST /api/sourcing/runs   { filters, count }  ->  201 { id, status: 'queued' }
GET  /api/sourcing/runs/:id                   ->  { status, counts, error }
```

Returns immediately; the page polls. Identical shape to `assets`, so the front-end polling
pattern is already written.

### `services/sourcer.js`

Mirrors `services/generator.js`: processes one queued run, never throws, records failure on
the row. Status flow `queued -> running -> done | failed`.

**Stage 1 — Harvest (cheap).** Claude with the web-search server tool, one call per
trade × city, forced through a JSON schema. Returns cheap fields only: name, city, trade,
phone, owner, website URL, rating, review count + source. No age, no site judgment.

**Stage 2 — Dedupe (plain code, no model).** Match on `phone_normalized`, then `dedupe_key`.
Anything already in `prospects` — including disqualified rows — is dropped and counted.
Runs **before** enrichment so we never pay to research a lead already rejected.

**Stage 3 — Enrich (expensive, survivors only).** Per fresh lead: fetch the site and classify
`website_quality`; find the founding year; hunt the real Google review count via a directory
mirror (LawnStarter pages are a reliable Google mirror) and set `review_verified`.

Fresh leads land as `status='new'` — the grading queue. Nothing reaches the call list
without a human grade.

### Filters, split by what is honest

- **Real filters** (Stage 1 constrains the search): trade, city, review-count band, rating band
- **Post-filters** (Stage 3 finds it, then drops failures): max age, website quality
- **Never a filter:** `runs_ads`. Displayed, never filtered on, until manually checked.

A request for 10 may return 9. The run reports the funnel; it does not pad.

### Accuracy guardrails (non-negotiable)

A CRM full of invented phone numbers is worse than an empty one — the failure surfaces as a
call to a stranger. Therefore:

- Every lead needs at least one `source_url` or it is dropped.
- `review_verified` defaults to 0 and only flips on a confirmed Google read.
- Unverifiable fields are `null` plus a flag. Never guessed.
- The system prompt uses the accuracy rules from
  `~/claude-workspace/reference/niewdel-sourcing-brief.md` verbatim: never invent phones,
  reviews, or owner names.
- **Never use owner race or ethnicity as a selection or exclusion factor.** Business signals only.

### Sourcing sources (the boundary for paid providers later)

Stage 1 is an interface, not a hard-coded agent call. A source module takes filters and
returns candidate records. `source_kind` records which produced each lead:

- `hand` — researched manually, the seed batch
- `sheet` — migrated from the call-sheet
- `agent` — Claude + web search (this spec)
- `provider` — Outscraper / Apify / Places (later, drops in without a rewrite)

## Dependency: Anthropic SDK upgrade

`@anthropic-ai/sdk` is pinned at **0.26.1**. The web-search server tool
(`web_search_20260209`) requires a current version. This upgrade is what makes the button
possible.

- Sourcing runs on `claude-opus-4-8`. Research quality is the product; a bad lead costs a call.
- `routes/generate.js:92` currently pins `claude-sonnet-4-6`. It must be re-verified after
  the upgrade — the existing generate path must not regress.

## Screens

One page, `public/pages/prospects.html`, plus a segmented control. Same vanilla-JS + `app.js`
+ `styles.css` pattern as `assets.html`.

| View | Purpose |
|---|---|
| **Due Today** (default) | "9 touches due." Each row: business, the touch, step `4 of 9`, the hook, the phone. |
| **Queue** | Ungraded leads, one at a time, large. Hook, facts, website link, 👍/👎/🤷 + why. Keyboard-driven. 👎 sets `status='disqualified'` and asks for a reason. The row stays. |
| **Pipeline** | Everything in flight, grouped by stage. |
| **Pool** | All leads including disqualified, filterable. This view exists so nothing is ever hidden. |
| **Source** | Filter panel + Generate, with live run progress and the funnel counts. |

### The interaction that decides whether this survives

**Logging a call is one tap.** From Due Today: `No answer` · `Voicemail` · `Gatekeeper` ·
`Connected` · `Callback` · `Not interested` · `Meeting set`.

That tap writes an `activities` row, advances `cadence_step`, computes `next_touch_at`, and
drops the lead off today's list. `Connected` opens a notes box. `Meeting set` moves the stage.
Never a form. If logging a call takes more than one tap it stops happening by Thursday, and
the module rots the way the sheet did.

## Brand

Follows **Niewdel Brand Guidelines v4.0 (July 2026)** for this module.

| Token | Value | Use |
|---|---|---|
| Jet Black | `#0D0D0D` | page ground |
| Onyx | `#1A1A1A` | surfaces, cards |
| Niewdel Blue | `#3B86DB` | accent, CTAs, links. **Never body text.** |
| Deep Navy | `#1B4D8F` | accent on light, gradients |
| Cloud White | `#F5F5F5` | text on dark |

Montserrat 700–800 for headings, nav, CTAs, labels. Inter 400/600 for body. Montserrat must be
added to the font link in `index.html` — it is not currently loaded. Type scale 48 / 32 / 24 /
18 / 16 / 14 / 12. Headings track tight (0.02em); body at 1.6 line height. Eyebrow labels:
Montserrat 600, uppercase, 0.2em tracking, blue. The signature gradient (135° blue to navy) is
hero accents only.

Scoped under a `.prospects` root so it does not leak into existing pages.

**UI copy follows the brand voice:** advisor not salesperson, lead with the outcome, short
sentences, contractions fine, **no em-dashes**. Banned: world-class, cutting-edge,
game-changing, guru, "innovative solutions," "solutions provider."

**Known inconsistency, accepted:** the app shell stays `#0a1220` and `--cream` (7 usages)
stays until the follow-up. The 2026-07-10 redesign deliberately moved the app off near-black;
brand v4.0 then specified Jet. Aligning the shell is a separate change so this build does not
touch working pages.

## Migration

One-time script, run once, idempotent (safe to re-run — dedupes on `dedupe_key`).

Imports **all 30 leads** from the recovered exports:

- **18 live** from the current sheet -> `status='new'` or `'qualified'`
- **12 deleted** from `rev68.xlsx` -> `status='disqualified'` + `disqualified_reason`
- All grades and Dillon's verbatim `Why` text
- The 3 values the rebuild flattened: `Electricians On the Go` -> `stage='attempting'`,
  `rep='Dillon'`; `MOWtivated Lawn Care` -> `stage='attempting'`; `Gwinn Lawn Care` ->
  `rep='Dillon'`
- `source_kind='sheet'`, `review_verified=0` for every lead **except** the two the sheet
  explicitly confirms as a Google read: **JP Lawn 27** and **Gwinn Lawn Care 30** (both noted
  "Google via Birdeye — CONFIRMED").

  **CR Weavers is deliberately not verified.** An earlier note recorded it as "26 confirmed,"
  but the sheet itself says `25` with "⚠Reviews conflict 19 vs 25 — confirm." The sheet's own
  warning wins over the summary. Imports at `review_verified=0`. This is exactly the failure
  `review_verified` exists to prevent, so the migration must not launder a conflict into a
  confirmation.

**Not imported:** two `Why` notes citing the owner being Black. Business signals only.

Source files: `rev68.xlsx` and `current.xlsx` in the session scratchpad. Both are recovered
Drive revision exports and must be copied into the repo before the script runs, since the
scratchpad is session-scoped.

## Testing

Jest + supertest, matching `tests/`.

- **Never-delete is a test, not a convention.** Assert no delete export exists on `prospects`
  or `activities`; assert a 👎 grade leaves the row present with `status='disqualified'`;
  assert a sourcing run never updates a Dillon-owned column on an existing row.
- **Dedupe:** same phone in different formats collides; same name+city collides; a
  disqualified lead is not re-added.
- **Cadence:** logging each outcome advances the step and computes the right `next_touch_at`;
  step 9 with no connect moves to `dead_nurture`.
- **Sourcer:** a failing run records `error` and `status='failed'` rather than throwing
  (mirrors `generator.test.js`).
- **Guardrails:** a candidate with no `source_url` is dropped; an unverified review count
  never sets `review_verified=1`.
- **Migration:** all 30 rows land; the 12 are `disqualified` with reasons; the 3 flattened
  values are restored; the 2 race-citing notes are absent.

## Risks

| Risk | Mitigation |
|---|---|
| Model invents leads | Source-URL requirement, verified flags, human grading gate before any lead reaches the call list |
| SDK upgrade regresses generate | Re-verify `routes/generate.js` against existing tests as part of the upgrade |
| Sourcing cost per run is unbounded | `requested_count` caps the run; dedupe before enrichment keeps the expensive stage small |
| Cadence turns into spam | One cadence, 9 touches, auto-breakup at step 9 |
| The module rots like the sheet | One-tap call logging is the acceptance bar, not a nice-to-have |

## Follow-ups (parked, not lost)

1. Align the app shell to brand v4.0: `#0a1220` -> Jet, add Montserrat globally, retire
   `--cream`.
2. Paid provider ingestion (`source_kind='provider'`).
3. Grade-to-ICP feedback loop: derive sourcing filters from grading patterns.
4. Per-segment cadences via `cadence_id`.
5. Manual verification pass for `runs_ads` across the 18 live leads (ad libraries, human only).
