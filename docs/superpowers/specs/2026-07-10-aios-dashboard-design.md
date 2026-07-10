# Niewdel AIOS Dashboard — design spec

**Date:** 2026-07-10
**Status:** Draft — awaiting Dillon's review
**Codebase:** this repo (`social-dashboard`), live on Railway, repo `dillonmccoy522/Social-post-generator`

## Vision

One dashboard that runs Niewdel's entire content operation. Dillon's flow, in his words:

> Go in, pull a photo from a Google Drive, put it in a text box with a prompt, send it to Higgsfield to create, and it shows up in the dashboard when it's done generating.

Content sources and destinations:

- **Source Drives** — existing Google Drives full of client content (photos/videos from clients). Read-only.
- **Output Drive** — a separate Google Drive Dillon has set up. Everything Niewdel generates is uploaded there.
- **Dashboard** — shows/manages everything: clients, text posts (existing), and now visual assets.

## Current state (already built & live)

- Express + better-sqlite3 + vanilla-JS SPA, dark theme (#0A0A0C bg, #C84B31 accent, Inter)
- `clients` table + CRUD UI; `posts` table + Claude text-post generation + history UI
- 27 passing Jest/Supertest tests; no auth; SQLite on Railway (resets on deploy)

## Higgsfield account facts (verified 2026-07-10)

- Company account admin@niewdel.com, **Plus plan, 275.5 credits**
- MCP (`https://mcp.higgsfield.ai/mcp`) connected and working — generation via Claude sessions works today on subscription credits
- Platform API (`platform.higgsfield.ai`, key+secret auth, per-model POST endpoints, polling/webhooks) — **key availability on Plus plan unverified.** Dillon to check cloud.higgsfield.ai. May be separately billed.

## Phases

### Phase A — foundation (no new external dependencies except Google)

1. **Password gate.** `DASHBOARD_PASSWORD` env var; login page; signed session cookie; middleware on all `/api/*` except `/api/health` and `/api/login`. Bearer token support (`API_TOKEN` env) so Claude sessions/scripts can register assets programmatically.
2. **`assets` table.**
   ```sql
   CREATE TABLE assets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
     campaign TEXT DEFAULT '',
     type TEXT NOT NULL CHECK (type IN ('image','video')),
     status TEXT NOT NULL DEFAULT 'draft'
       CHECK (status IN ('queued','generating','failed','draft','approved','posted')),
     prompt TEXT DEFAULT '',
     model TEXT DEFAULT '',
     source_drive_file_id TEXT DEFAULT NULL,
     output_drive_file_id TEXT DEFAULT NULL,
     output_drive_url TEXT DEFAULT NULL,
     thumbnail_url TEXT DEFAULT NULL,
     higgsfield_job_id TEXT DEFAULT NULL,
     error TEXT DEFAULT NULL,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```
3. **Assets API.** `GET /api/assets?clientId&status&campaign`, `POST /api/assets`, `PATCH /api/assets/:id` (status transitions, campaign rename), `DELETE /api/assets/:id`.
4. **Google Drive integration (server-side).** One-time OAuth connect of the Google account that can see both the source Drives and the output Drive. Endpoints: `GET /api/drive/browse?folderId=` (folder/file listing for the picker, images/videos only, thumbnails via Drive thumbnailLink) and internal upload helper `uploadToOutputDrive(clientName, campaign, buffer|url)` → creates `/<client>/<campaign>/` folders in the output Drive as needed. Config: `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`, `OUTPUT_DRIVE_FOLDER_ID`.
5. **Home page (new default view).** Live stats: active clients, posts this week, assets by status, recent activity feed. Niewdel priorities/team blocks (static text, editable later). Sidebar: Home / Clients / Create / Assets / History.
6. **Assets gallery page.** Grid of thumbnails; filters: client, status, campaign, type. Click → detail (full preview, prompt, source, Drive link). Actions: approve / reject(→draft) / mark posted / delete.
7. **Create page (UI complete in Phase A).** Client selector → campaign field → source photo picker (Drive browse modal) → prompt textarea → model/aspect-ratio selects → Generate button. In Phase A the button POSTs to `/api/assets` with status `queued` and shows the asset in the gallery as "queued" — generation itself is fulfilled by Phase B, or in the interim by Claude/MCP sessions that watch for queued assets (manual trigger: Dillon asks Claude to "process queued assets").
8. **Claude session pipeline.** Workspace CLAUDE.md instruction (already partially in place): when Claude generates client content via Higgsfield MCP, it uploads the file to the output Drive (via Drive MCP or the dashboard API) and POSTs the asset row. Both roads end in the same gallery.

### Phase B — in-app generation (needs platform API key)

9. `POST /api/generate-visual`: creates asset (status `generating`), calls Higgsfield platform API with prompt + source image, stores `higgsfield_job_id`.
10. Completion via webhook (`POST /api/higgsfield-webhook`, verified) with polling fallback; on success: download result → upload to output Drive → update asset row (status `draft`, thumbnail, Drive URL). On failure: status `failed` + error.
11. Create page's Generate button switches from queue-only to live generation. Queued-asset flow remains as fallback.

### Explicitly out of scope (this round)

PostgreSQL migration / Railway volume (flagged: metadata now matters — schedule right after Phase A), Metricool/direct posting, performance KPIs, competitor scraping (Apify), multi-user accounts/roles, editing tools (crop/brightness).

## Open questions — RESOLVED 2026-07-10

1. ✅ One Google account can see both source Drives and output Drive (exact account confirmed at OAuth setup)
2. 🔄 Dillon fetching API key + secret from cloud.higgsfield.ai (admin@niewdel.com). Phase B starts when delivered. If API access requires separate payment, review cost first.
3. ✅ Output Drive structure `/<client name>/<campaign>/` approved
4. ✅ Text posts appear in Home activity feed

**Spec approved by Dillon 2026-07-10.**

## Risks

- **Railway SQLite reset:** asset metadata lost on redeploy until persistence fix. Mitigation: media itself lives in Drive; add Railway volume or Postgres immediately after Phase A ships.
- **Higgsfield API billing unknown:** Phase B blocked until key confirmed; Phase A + Claude/MCP bridge keeps everything usable meanwhile.
- **Drive quota/token expiry:** use refresh token, surface auth errors in UI banner.
