# Handoff → Justin — Niewdel Social Dashboard (2026-07-13)

> Justin: this doc is your starting context. Read it fully before changing anything.
> It supersedes the older `HANDOFF-CURSOR.md` / `HANDOFF.html` (those are from 2026-07-10 and stale).

## What this project is

The **Niewdel Social Dashboard** — an agency tool to manage clients and generate/organize
their social content. Stack: **Express + better-sqlite3 + vanilla JS** — no framework, no build
step. Frontend pages are HTML *fragments* loaded into a shell by `public/app.js`.

- **Live on:** Railway
- **Repo:** `dillonmccoy522/Social-post-generator-` (this repo — **public**)
- **Run:** `npm start` → http://localhost:3000 · `npm test` (Jest)

## Current state (as of this handoff)

- **Active branch:** `feature/phase-b-generation` — where the live work is. **This branch is
  where Phase B (in-app image generation) is half-wired.** The Phase B code was previously
  local-only and is committed as part of this handoff so you have it.
- **Tests:** 74 total, **73 passing / 1 failing** (see "Known issues" below — it's a test
  isolation bug, not a product bug).
- **Data:** dev SQLite has 2 real clients — **Perfect Balance Roofing (id 1)** and
  **Franky's Detailing (id 2)**. The DB (`data/dashboard.db`) is gitignored.

### What's already shipped (merged history on this branch)
- **Phase A** — AIOS content engine base: password gate, `assets` table + CRUD, stats/Home,
  Google Drive service (browse/upload), Create + Assets + Home pages.
- **Visual redesign** pass on the frontend.
- **Per-client Drive folders (v1 + v2)** — each client stores a source Drive folder and an
  output ("send-to") Drive folder; both pasted on the client card.

## Phase B — in-app generation (IN PROGRESS, the main open thread)

Goal: the Create page's **Generate** button fires a real image generation, result lands in the
client's output Drive folder, asset flips `queued → generating → draft`.

**What's built (committed with this handoff):**
| Piece | File | Status |
|---|---|---|
| Higgsfield SDK wrapper (text-to-image, `@higgsfield/client/v2`, `createHiggsfieldClient`) | `services/higgsfield.js` | ✅ written |
| Generation pipeline: `processAsset(id)` → generate → upload to client output Drive → set status | `services/generator.js` | ✅ written |
| `uploadToFolder(url, filename, folderId)` — download remote file, push into a Drive folder | `services/drive.js` | ✅ written |
| DB columns: `higgsfield_job_id`, `thumbnail_url`, `output_drive_file_id`, `error`, `failed` status | `database.js` | ✅ present |
| `startGeneration(id)` helper + imports | `routes/assets.js` | ⚠️ **defined but never called** |

**The gap (what's left to finish Phase B):**
1. 🔴 **No trigger wired.** `startGeneration()` exists in `routes/assets.js` but nothing calls it.
   Dillon decided on an **explicit endpoint** approach: add `POST /api/assets/:id/generate`
   that calls `startGeneration`, reusable as a "Retry" on failed assets.
2. 🔴 **Frontend not wired.** `public/pages/create.html` "Generate" button POSTs an asset with
   `status: 'queued'` and stops — it needs to then call the generate endpoint. Add a "Retry"
   button on `public/pages/assets.html` for `failed` assets.
3. 🟡 `higgsfield` is imported in `routes/assets.js` but unused — wire or remove.

> ⚠️ **Model choice matters — this is the big open design question.** The wrapper currently
> calls Higgsfield **text-to-image**, which *ignores the source photo* and invents a brand-new
> AI image. Dillon's explicit direction (2026-07-13) is that outputs must **use the client's
> real photo** so they don't look like "AI slop." See the next section — the direction is
> shifting toward real-photo-based flyer generation, and Justin is now driving that.

## New direction (2026-07-13) — real-photo flyers, Justin driving

Dillon wants image outputs built **from the actual selected photo**, not hallucinated. The
concept discussed:

- Pick source photo(s) → AI **looks at / understands** the photo (vision) → builds a
  **flyer-style** post that fits *that* specific photo, in a consistent structural style.
- **Not** rigid presets (outputs shouldn't be identical every time) — an **adaptive recipe**.
- Must **use the real pixels** to avoid AI slop. Two candidate mechanics surfaced:
  1. **Composite / real design** — real photo placed unchanged into a designed layout with
     crisp, real (non-AI) text + graphics; AI only for background/cutout/polish. Best for
     realism + legible text.
  2. **AI edits the photo** — feed real photo to Flux **Kontext** (image-to-image editing
     model, *not* text-to-image); keeps subject, restyles scene. Faster, but text/detail less
     reliable.

This direction is **not yet designed or built** — Justin is taking it over and integrating it
into the new app with tooling he has access to. No spec committed yet. The `services/*.js`
files above are the current (text-to-image) starting point to evolve or replace.

## Environment / config (names only — get values from Dillon)

Set in Railway (and locally in a gitignored `.env`):

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude text-post generation |
| `HIGGSFIELD_API_KEY` / `HIGGSFIELD_API_SECRET` | Higgsfield image generation |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (Drive API enabled) |
| `GOOGLE_REFRESH_TOKEN` | Minted once via `node scripts/google-oauth.js` (already done) |
| `OUTPUT_DRIVE_FOLDER_ID` | Output Drive root folder ID |
| `DASHBOARD_PASSWORD` | Web UI login password (auth is OFF when unset — dev) |
| `API_TOKEN` | Bearer token for scripts/Claude sessions (`openssl rand -hex 32`) |

Deploy details: `docs/DEPLOY.md`. Design/plan docs: `docs/superpowers/specs/` and `.../plans/`.

## Known issues

- 🟡 **1 failing test** — `tests/drive.test.js`: "GET /api/drive/browse returns 503 when not
  configured" returns **502**. Cause: now that `.env` has real `GOOGLE_*` creds, they leak into
  the first test because it only clears them in `afterEach`, not before. Fix: clear the three
  `GOOGLE_*` vars in a `beforeEach` (make the test hermetic). Not a product bug.
- ⚠️ **Railway SQLite resets on each deploy** (no volume) — client/asset **metadata** is lost on
  redeploy; the media itself lives in Drive. Prioritize a **Railway volume or Postgres**
  migration. Re-add clients after a deploy until then.

## Gotchas

- The parent folder is `~/Niewdel ` **with a trailing space** — quote paths in scripts. Nothing
  in the repo depends on the absolute path.
- Frontend pages are HTML **fragments** loaded by `public/app.js` into the shell; their inline
  `<script>` runs via `new Function`. **Don't** add `<html>`/`<head>` wrappers or module syntax.
- All user-rendered strings must go through the existing `esc()` helper; URLs into `src`/`href`
  must also pass `safeUrl()` (XSS — this was a real review finding).
- Commit style: `feat:` / `fix:` prefixes.

## Sensitive material — shared privately, NOT in this public repo

This repo is **public**, so the following were deliberately kept out. Dillon will share directly:
- Secrets / API keys / Google OAuth token (gitignored `.env`).
- Client brand context: `~/claude-workspace/clients/{perfect-balance-roofing,frankys-detailing}/brand.md`
- Business/strategy/personal context: `~/claude-workspace/context/*.md`, `reference/brand-guide.md`
- In-progress flyer designs: `~/claude-workspace/outputs/flyer-mockup-v4.html`, `flyer-mockup-v5.html`,
  `outputs/flyer-assets/`, and plan `~/claude-workspace/plans/2026-07-09-popup-flyer-design.md`
- Workspace operating instructions: `~/claude-workspace/CLAUDE.md`

Ask Dillon for these — they're directly relevant to the real-photo flyer direction.
