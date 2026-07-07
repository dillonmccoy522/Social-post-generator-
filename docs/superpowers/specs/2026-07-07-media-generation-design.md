# Media Generation Feature — Design Spec
Date: 2026-07-07

## Overview

Add a Media tab to the Niewdel dashboard that allows the admin to scan a client's Google Drive photo folder, have Claude select the best photos and generate a marketing plan, and output a Higgsfield video prompt and Midjourney image prompt — all reviewable in the dashboard and saved to a client-specific Google Drive output folder.

This is Phase 1 (MVP): manual trigger only, prompt output only (no actual video/image API calls yet).

---

## User Flow

1. Admin pastes two Drive folder URLs into a client's profile: a **photos folder** and an **output folder**
2. On the Media page, admin picks a client and clicks **Scan Drive**
3. App fetches the most recent 50 photos from the client's photos folder, skipping any already used in past media jobs
4. Claude reviews the photos, selects the best 5–10 for marketing value, and explains each selection
5. Admin sees a photo grid with Claude's reasoning
6. Admin clicks **Generate Plan**
7. Claude writes:
   - A short marketing script (what the video/images should convey)
   - A ready-to-copy Higgsfield video prompt
   - A ready-to-copy Midjourney image prompt
8. Admin sees all three outputs with copy buttons in the dashboard
9. Results are saved to the `media_jobs` table and written to the client's Google Drive output folder

---

## Database Changes

**`clients` table — two new columns:**
- `drive_photos_url TEXT` — Google Drive folder URL for source photos
- `drive_output_url TEXT` — Google Drive folder URL for generated output

**New `media_jobs` table:**
```sql
CREATE TABLE IF NOT EXISTS media_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  selected_photos TEXT NOT NULL,       -- JSON array of Drive file IDs used
  marketing_script TEXT NOT NULL,
  higgsfield_prompt TEXT NOT NULL,
  midjourney_prompt TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Used photo tracking:** The `selected_photos` field in `media_jobs` is used to exclude already-used photos from future scans for that client.

---

## Backend Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/auth/google` | Initiate Google OAuth flow |
| GET | `/auth/google/callback` | OAuth callback, store token in session |
| GET | `/api/drive/scan/:clientId` | List unscanned photos from client's photos folder |
| POST | `/api/media/generate` | Claude selects photos + generates script and prompts |
| POST | `/api/media/save` | Save job to DB and write output to client's Drive output folder |
| GET | `/api/media/history/:clientId` | Fetch past media jobs for a client |

---

## Google Drive Integration

- Admin authenticates once via OAuth at `/auth/google` — token stored in session
- All Drive access uses the admin's credentials
- Photo scan: list files in photos folder, filter to image types (jpg, png, webp, heic), cap at 50 most recent by `modifiedTime`
- Exclude any Drive file IDs already present in `media_jobs.selected_photos` for that client
- Output: after generation, write a markdown/text file with the script + prompts into the client's output folder, named `niewdel-media-YYYY-MM-DD.txt`

---

## Claude's Role

Claude receives:
- Thumbnails/previews of scanned photos (via Drive export URLs)
- Client context: name, business type, location, brand voice

Claude outputs:
- A ranked selection of 5–10 photos with a one-line reason per photo
- A marketing script (3–5 sentences: what the video/images should make the viewer feel and do)
- A Higgsfield video prompt (specific, cinematic, references selected photos)
- A Midjourney image prompt (style, mood, subject references)

---

## Frontend

**Client profile page** — two new fields added to the edit form:
- Photos Folder URL
- Output Folder URL

**New `public/pages/media.html` page:**
- Client dropdown
- Scan Drive button
- Photo grid (thumbnails + Claude's selection reasoning)
- Generate Plan button
- Three output cards (script, Higgsfield prompt, Midjourney prompt) each with a copy button
- Past jobs section at the bottom (collapsible list)

**Sidebar** — new Media nav item added alongside Clients, Generate, History.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| OAuth token expired | Redirect to re-authenticate |
| Drive folder URL missing or invalid | Show error when saving client profile |
| Folder has no new photos (all used) | Show message: "All photos in this folder have been used" |
| Folder is empty | Show message: "No photos found in this client's Drive folder" |
| Unsupported file format | Skip silently, continue with valid photos |
| Claude fails | Show error, allow retry without re-scanning |
| Output Drive write fails | Show error, results still saved to DB |
| Double-click scan | Disable button during active scan |

---

## Out of Scope (Phase 1)

- Scheduling / automatic triggers
- Actual Higgsfield or Midjourney API calls (prompts only)
- Client-facing access
- Scoring / prompt calibration
- Video/image preview in dashboard (Phase 2 once generation APIs are added)
