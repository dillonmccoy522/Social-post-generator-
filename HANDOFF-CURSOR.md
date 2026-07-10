# Handoff — Niewdel AIOS Dashboard (2026-07-10)

> To the AI reading this in Cursor: this doc is your starting context. Read it fully before changing anything.

## What this project is

The Niewdel Social Dashboard — an Express + better-sqlite3 + vanilla-JS app (no framework, no build step) that manages agency clients and content. Live on Railway (repo: dillonmccoy522/Social-post-generator). Today it was extended into "Phase A" of an AIOS content engine.

## Current state

- **Branch:** `feature/aios-phase-a` — 15 commits, NOT merged to main, NOT pushed. All work is local.
- **Tests:** 50/50 passing (`npm test`).
- **Reviewed:** every task was code-reviewed; a final whole-branch security review passed after fixes.

### What Phase A added

| Area | Files |
|---|---|
| Password gate (session cookie + `Authorization: Bearer $API_TOKEN` for scripts). Auth is OFF when `DASHBOARD_PASSWORD` env is unset. | `middleware/auth.js`, `routes/auth.js`, `public/login.html` |
| `assets` table (visual content: status queued→generating→draft→approved→posted, Drive links, prompts) + CRUD API | `database.js`, `routes/assets.js` |
| Stats endpoint for Home page | `routes/stats.js`, `database.js` (getStats) |
| Google Drive service: browse (picker), ensureFolder, uploadFromUrl to output Drive; `GET /api/drive/browse`; one-time OAuth mint script | `services/drive.js`, `routes/drive.js`, `scripts/google-oauth.js` |
| New pages: Home (live stats), Create (client → Drive photo picker → prompt → queues an asset), Assets (gallery with approve/posted workflow); sidebar reworked | `public/pages/home.html`, `create.html`, `assets.html`, `public/index.html`, `public/app.js` |
| Deploy notes (env vars for Railway) | `docs/DEPLOY.md` |

Design docs: `docs/superpowers/specs/2026-07-10-aios-dashboard-design.md` (the what/why) and `docs/superpowers/plans/2026-07-10-aios-dashboard-phase-a.md` (the how).

## THE IMMEDIATE TASK (why this handoff exists)

Dillon looked at the new pages and said **"this looks horrible — I wanted something appealing to the eye."** The pages are functional but visually utilitarian. The next job is a **visual redesign pass** on the frontend (`public/styles.css` + the page fragments), keeping all functionality intact.

Design direction (Niewdel brand):
- Current app theme: near-black `#0A0A0C`, surface `#0f0f12`, accent `#C84B31` (rust), Inter font
- Dillon has ALSO been gravitating to a bright-blue playful 3D style (`#3B86DB` blue, "niewdel GROWTH SERVICES" artwork) in other materials — **ask him which direction before restyling**
- He is highly visual: show screenshots/mockups, iterate in rounds, don't describe in prose
- Brand adjectives: premium, modern, minimal, clean, confident without being flashy; inspirations: Apple, Stripe, Linear, Notion

## How to run

```bash
npm start   # http://localhost:3000, port 3000
npm test    # 50 tests
```
Local `.env` exists (gitignored): has ANTHROPIC_API_KEY + HIGGSFIELD_API_KEY/SECRET. No DASHBOARD_PASSWORD locally, so auth is off in dev — you land straight on Home. The dev SQLite DB has 2 real clients: Perfect Balance Roofing (id 1), Franky's Detailing (id 2).

## Remaining roadmap (after the visual pass)

1. **Phase B — in-app generation:** `POST /api/generate-visual` calling the Higgsfield platform API (`platform.higgsfield.ai`, auth header `Key {key}:{secret}` — creds already in `.env`) so the Create page's Generate button fires real generations; webhook/poll completion → upload result to output Drive via `services/drive.js#uploadFromUrl` → asset flips to `draft`. See spec Phase B section.
2. **Google Drive one-time setup:** create OAuth client in Google Cloud Console (redirect `http://localhost:53682/callback`, Drive API enabled), run `node scripts/google-oauth.js`, set `GOOGLE_*` env vars + `OUTPUT_DRIVE_FOLDER_ID`.
3. **Deploy:** merge branch → push → set all env vars in Railway per `docs/DEPLOY.md`. WARNING: SQLite resets on each Railway deploy (no volume) — re-add clients after, and prioritize a Railway volume or Postgres migration.
4. Minor UX polish list (non-blocking): DELETE success toast, filter debounce, fetch error handling on loadFilters/loadClientOptions, stale picker breadcrumbs on error.

## Related but separate (do not mix into this repo)

- `~/claude-workspace` — Dillon's Niewdel workspace for Claude Code: client brand context (`clients/perfect-balance-roofing/brand.md`, `clients/frankys-detailing/brand.md`), an in-progress pop-up flyer design (`plans/2026-07-09-popup-flyer-design.md`, mockup at `outputs/flyer-mockup-v4.html`), and a queue-processing protocol in its CLAUDE.md.
- `~/dropship-launch` — unrelated project (ChillLoop). Leave it alone.

## Gotchas

- The parent folder is `~/Niewdel ` **with a trailing space** — quote paths in scripts, or rename the folder (nothing in the repo depends on the absolute path; `~/.claude/launch.json` and Claude's memory reference it and would need updating).
- Frontend pages are HTML *fragments* loaded by `public/app.js` into the shell; their inline `<script>` runs via `new Function` — don't add `<html>/<head>` wrappers, don't use module syntax.
- All user-rendered strings must go through the existing `esc()` helper; URLs into `src`/`href` must also pass `safeUrl()` (XSS — this was a real review finding).
- Commit style: `feat:` / `fix:` prefixes.
