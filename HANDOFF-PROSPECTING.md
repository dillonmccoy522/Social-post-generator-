# Handoff — Prospecting CRM (2026-07-17)

> To the developer picking this up: this is the full picture of the prospecting tool — what's already built and shipped, and what's designed and ready to build next. Read it fully before changing anything. Pair it with the two design docs linked at the bottom; they have the deep reasoning this summary compresses.

---

## TL;DR

The **Prospecting CRM** is a module inside the Niewdel Social Dashboard (an Express + better-sqlite3 + vanilla-JS app, no framework, no build step). It replaced a Google call-sheet that a rebuild script once wiped. It's a pool of leads you grade and call, with a hard "nothing is ever deleted" guarantee baked into the database.

- **Round 1 (detail page + cleanup) — SHIPPED** on branch `feature/prospects-crm`.
- **Round 2 (Generate — source new leads on demand) — DESIGNED, NOT BUILT.** This is the next job.

---

## How to run

```bash
npm start   # http://localhost:3000
npm test    # full jest suite
```

- Local `.env` exists (gitignored). **No `DASHBOARD_PASSWORD` locally, so auth is OFF in dev** — you land straight on Home. Click **Prospects** in the sidebar.
- The dev SQLite DB (`data/dashboard.db`) already holds the **30 real recovered leads**.
- **Do NOT run mutating API calls (POST/PATCH) against the dev DB to "test" it** — it's real data and there's no delete path to undo with. Verify UI changes read-only in the browser, or point `DB_PATH` at a throwaway file.

**Tests:** the prospecting/contacts/cadence suites are **68/68 green**. The full suite has 2 unrelated pre-existing failures (`tests/drive.test.js`, `tests/stats.test.js` — a Drive-config quirk and a "posts this week" date test); they were red before any prospecting work and are not ours to fix here.

---

## The one hard rule (do not break this)

**Nothing is ever deleted or machine-overwritten.** A rebuild script once PATCHed a generated spreadsheet over the live call-sheet and silently destroyed a day of hand-edits plus 12 leads. The whole data model exists to make that impossible.

Two mechanisms enforce it:

1. **No delete function exists on any table.** A lead retires by getting `status='disqualified'` + a required reason. A contact retires with `is_active=0`. The row always stays.
2. **"Dillon-owned" columns are never written by automated code.** Only an explicit user action (a person clicking Save/Grade) can write them. The sourcer you're about to build (Round 2) physically cannot touch them.

If you add a feature, keep both invariants. There are tests that assert no `deleteProspect`/`deleteContact` export exists — leave them.

---

## Round 1 — SHIPPED (what's in the app today)

Click any lead → a full **detail page**: call/copy the number, edit any fact and Save, add contacts, log a call, grade. "Due Today" (an old auto-cadence view) was retired; the default view is now **Pipeline**.

### Files touched

| Area | Files |
|---|---|
| Data access — the human edit path (`saveProspectEdits`), call logging (`logCall`), contacts CRUD (`getContacts`/`createContact`/`updateContact`/`deactivateContact`) | `db/prospects.js` |
| Schema — `contacts` table, deal-field migration, "Due Today dormant" note | `db/prospects-schema.js` |
| API — detail returns contacts; `PATCH /:id`; `POST /:id/log`; contacts routes; dropped `due` from `/stats` | `routes/prospects.js` |
| Front-end — detail page (edit form, contacts, call logging, grade-from-detail); Due Today removed; default view Pipeline | `public/pages/prospects.html` |
| Tests | `tests/prospects-db.test.js`, `tests/contacts-db.test.js`, `tests/prospects-api.test.js` |

### The views (tabs)

- **Pipeline** (default) — qualified leads you're actively working, grouped by stage.
- **Queue** — ungraded new leads, one at a time, keyboard-driven (`g`/`m`/`b`). Grading a 👎 requires a reason.
- **Pool** — every lead ever found, including the ones you passed on. Nothing hidden.

### The detail page

Reachable by clicking a card in any view. Has: header + grade/status pill, a big phone with **Call** (`tel:`) and **Copy**, an editable form (owner, phone, email, website, rating, reviews, est year, site quality, runs-ads, segment, hook, notes) with **Save**, a **Contacts** section (add/remove people, decision-maker/gatekeeper flags), **Log a call** outcome buttons, and a read-only **Call log**. If the lead is still ungraded, the grade buttons show here too.

### Two behaviors worth knowing

- **Correcting a review count marks the lead verified.** When a human edits `review_count`, the code sets `review_verified=1` and `review_source='manual'`. Rationale: real Google review count is the #1 lead filter, and a hand-check is the most trustworthy source we have.
- **Logging a call does not schedule anything.** `logCall` writes an activity and moves the stage on `connected`/`meeting_set`/`not_interested`. The old auto-cadence engine (`recordTouch`, `getDueToday`, the `cadence_steps` table) is left in place, dormant and still tested, in case scheduling ever comes back — but nothing in the UI calls it.

---

## Data model (the `prospects` module)

Five tables, all in `db/prospects-schema.js`.

- **`prospects`** — the pool (append-only). Columns grouped as: identity (name/trade/city/owner/phone/email/social), machine-owned research (website, `website_quality`, `rating`, `review_count`, `review_source`, `review_verified`, `runs_ads`, `est_year`, `segment`, `hook`), Dillon-owned (`grade`, `grade_why`, `stage`, `rep`, `next_action`, `next_date`, `notes`, deal fields), lifecycle (`status`, `disqualified_reason`), provenance (`source_run_id`, `source_kind`, `source_urls`), and dedupe keys (`phone_normalized`, `dedupe_key`).
- **`contacts`** — the people at a business. Append-only; `is_active=0` to retire.
- **`activities`** — every touch (call/email/dm/sms/note). Append-only, never edited.
- **`sourcing_runs`** — one row per Generate button press (Round 2). Table and its `createSourcingRun`/`updateSourcingRun` helpers already exist; the feature that fills it does not.
- **`cadence_steps`** — the dormant 9-touch playbook.

**`status` vs `stage` are different axes.** `status` (`new`→`qualified`/`disqualified`) is the pool gate: has it been graded, is it in play. `stage` (`new`→`attempting`→`connected`→`meeting_set`→`proposal`→`won`/`dead_nurture`) is the pipeline position of a qualified lead. `won`/`dead_nurture` live on `stage`, not `status`.

**Grade → status is mechanical:** 👍 good → qualified; 🤷 maybe → qualified (still callable); 👎 bad → disqualified + required reason.

---

## Round 2 — TO BUILD: **Generate** (source new leads on demand)

The goal: a form where Dillon picks requirements (industry, location, review count, rating), hits **Generate**, and ~10 fresh leads drop into the **Queue** for him to grade. It's the centerpiece of the tool.

### The key decision (Dillon, 2026-07-17) — READ THIS

**Source leads from a PAID DATA PROVIDER** (Google Places / Outscraper-style live business listings), **NOT** the Claude + web-search approach written in the original `2026-07-16-prospects-crm-design.md` spec.

Why the change: the tool's entire value is *"numbers I can actually dial today."* Real, structured business-listing data (phone, rating, review count, category, location) is far more reliable than an LLM transcribing details off web pages, where a single wrong digit becomes a call to a stranger. This decision **overrides** the sourcing section of the older spec — build the provider version.

First step before any code: **stand up a data-provider account + API key** (a small per-lead cost). Dillon needs a hand doing this; it's the only external dependency and it blocks the build.

### The honest constraint on filters

Business-listing APIs return: name, address, **phone**, website, **rating**, **review count**, business category, hours, location. They do **NOT** return **"years in business"** or **"runs ads."**

That matters because **business age is Dillon's hard filter** — he targets newer businesses (under ~15–20 years) that haven't been courted by agencies yet. So Round 2 must either enrich age as a separate step, or surface age as "unknown, eyeball at grade time." Don't silently drop the filter or fake the data. `runs_ads` stays display-only (never a filter) until manually checked.

### How it plugs into what exists

- Fresh leads land as **`status='new'`** (the Queue). Nothing reaches the call list without a human grade — the existing grade → Pipeline/Pool flow takes over unchanged.
- Each run creates a `sourcing_runs` row and records a **funnel** (`searched_count`, `dupe_count`, `enriched_count`, `passed_count`). A request for 10 may return 8; the run reports what it dropped rather than padding.
- **Dedupe before spending.** Match new candidates on `phone_normalized`, then `dedupe_key`, against the *entire* pool including disqualified rows, so a lead Dillon already passed on never comes back and you never pay to enrich a known dupe. `findDuplicate()` already does this.
- `source_kind='provider'` on generated leads; store the listing URL in `source_urls`. **Every lead needs at least one source URL or it's dropped.**

### Suggested API shape (mirrors the existing `assets` async pattern)

```
POST /api/sourcing/runs   { filters, count }  ->  201 { id, status: 'queued' }
GET  /api/sourcing/runs/:id                   ->  { status, counts, error }
```

Returns immediately; the page polls for progress. A failing run records `error` + `status='failed'` on the row instead of throwing (mirror `services/generator.js`). New page: a Generate view with the filter form, a live progress/funnel readout, and a link to the new leads in the Queue.

### Guardrails (non-negotiable — a CRM of invented numbers is worse than an empty one)

- Every lead needs a real source URL, or drop it.
- `review_verified` stays 0 on import; it only flips on a confirmed read (or Dillon's manual correction).
- Unverifiable fields are `null` + a flag, never guessed.
- **Never use owner race or ethnicity as a selection or exclusion factor.** Business signals only. (There is existing scrub logic and a test enforcing this — keep it.)

---

## Architecture & conventions

- **No framework, no build step.** Express server (`server.js`), routes in `routes/`, data access in `db/` + `database.js`, SQLite via better-sqlite3.
- **Front-end pages are HTML *fragments*** loaded by `public/app.js` into the shell; their inline `<script>` runs via `new Function`. Don't add `<html>`/`<head>` wrappers, don't use module syntax.
- The prospects page is scoped under a `.prospects` CSS root (brand v4.0 tokens: Jet `#0D0D0D`, Onyx `#1A1A1A`, Blue `#3B86DB`, Cloud `#F5F5F5`, Montserrat headings / Inter body) so its styling doesn't leak into other pages.
- **All user-rendered strings go through the existing `esc()` helper.**
- **Tests:** Jest + supertest. `process.env.DB_PATH = ':memory:'` at the top of a test file, `afterEach(() => db.closeDb())`. Follow `tests/prospects-db.test.js` / `tests/prospects-api.test.js`.
- **Commits:** `feat:` / `fix:` prefixes. Work happens on `feature/prospects-crm`; it is **not merged to main and not pushed** — all local.
- **Voice for any UI copy:** advisor not salesperson, lead with the outcome, short sentences, **no em-dashes**. Banned words: world-class, cutting-edge, game-changing, guru, "innovative solutions."

---

## Where the deep docs live

- **Round 1** spec: `docs/superpowers/specs/2026-07-17-prospect-detail-page-design.md`
- **Round 1** plan (task-by-task, with code): `docs/superpowers/plans/2026-07-17-prospect-detail-page.md`
- **Original CRM** design (data model + the sourcing section Round 2 partly overrides): `docs/superpowers/specs/2026-07-16-prospects-crm-design.md`
- **Original data-layer** plan: `docs/superpowers/plans/2026-07-16-prospects-data-layer.md`

---

## Gotchas

- The repo's parent folder is `~/Niewdel ` **with a trailing space** — quote paths in scripts.
- The `@anthropic-ai/sdk` is pinned old (`^0.26.0`). The original spec wanted a bump for the web-search tool; since Round 2 is now a data-provider build, that bump may not be needed — decide based on what the provider integration actually requires.
- `data/dashboard.db` is the **real dev data** (30 leads). Don't wipe it, don't mutate it casually. It's gitignored.
- The 2 failing tests (`drive`, `stats`) are pre-existing and unrelated — don't let them block you or "fix" them as part of this work.

---

## Roadmap beyond Round 2 (parked, not lost)

1. Enrich or verify "years in business" and "runs ads" for generated leads.
2. Grade → ICP feedback loop: derive sourcing filters from what Dillon grades up/down.
3. Align the rest of the app shell to brand v4.0 (the shell is still the older near-black theme; only the prospects module is v4.0).
4. Railway deploy note: SQLite resets on each deploy without a volume — prioritize a Railway volume or Postgres before this holds real pipeline data.
