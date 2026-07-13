# Per-client Drive Folders v2 — Design

**Date:** 2026-07-13
**Supersedes behavior from:** `2026-07-12-drive-links-per-client-design.md`

## Problem

The v1 feature added a per-client **source** ("pull-from") Drive link, but:
1. The field was buried inside the collapsed "Edit Client" form — Dillon couldn't find a place to paste links.
2. There was **no field for the output ("send-to") folder** — the app auto-created output folders instead, which is not what Dillon wants. He wants to paste the destination folder himself.

## Goal

Each client has **two Drive folders that Dillon pastes in himself**, both **obvious** (visible directly on the client card, not hidden in a form):

- 📥 **Pull-from** (`source_drive_folder_id`) — where Higgsfield grabs source photos.
- 📤 **Send-to** (`output_drive_folder_id`) — where Higgsfield saves what it creates.

## Changes

### 1. Output folder becomes a paste field (remove auto-create)
- `routes/clients.js`: on `POST` and `PUT`, accept `output_drive_folder_id` as a raw pasted link/ID, run it through `drive.parseFolderId()`, validate (400 on unparseable, same as source), and store it.
- **Remove** the eager `drive.ensureFolder(...)` / `setClientOutputFolder(...)` auto-create block from `POST`. `setClientOutputFolder` in `database.js` can stay (harmless, unused) or be removed — plan will keep it to avoid churn, but `updateClient` must now also persist `output_drive_folder_id`.
- `database.js`: `createClient` and `updateClient` accept and persist `output_drive_folder_id` (currently only `source_drive_folder_id` flows through). Column already exists.

### 2. Clients page — both fields obvious
- **Card** (`public/pages/clients.html`): each client card always shows both folders:
  - If set: a clickable "Open folder ↗" link (📥 Pull-from / 📤 Send-to labels).
  - If not set: an inline `+ Add pull-from folder` / `+ Add send-to folder` button that opens the Edit form for that client.
- **Form**: two clearly-labeled fields with helper text:
  - "📥 Pull-from folder — where Higgsfield pulls photos from"
  - "📤 Send-to folder — where Higgsfield saves what it makes"
  - Both pre-fill (as full `https://drive.google.com/drive/folders/<id>` URLs) on edit and clear on hide.
- `saveClient()` sends both `source_drive_folder_id` and `output_drive_folder_id` from the two fields.
- Edit-button `data-*` attributes carry both folder IDs; the "+ Add" buttons reuse the same edit-open path.

### 3. Create page — unchanged behavior
- The "Browse Drive" button already jumps the picker into the selected client's `source_drive_folder_id` (pull-from). No change needed.
- Actually saving generated output into the send-to folder is **Phase B (in-app generation)** — out of scope here. We only store the target now.

## Non-goals / YAGNI
- No global/default folders, no per-client override hierarchy — pure per-client (Dillon confirmed).
- No inline-editable card fields (no new mini-forms on the card) — the "+ Add" buttons just open the existing Edit form. Keeps JS simple.
- No Phase B generation wiring.

## Data model
No schema change — `clients.source_drive_folder_id` and `clients.output_drive_folder_id` (both TEXT, nullable) already exist from v1.

## Validation & safety
- Both links: parse with `drive.parseFolderId()`, 400 with a clear message if unparseable, `null` if blank.
- All rendered folder URLs go through existing `esc()` + `safeUrl()` helpers on the page fragment.

## Testing
- `tests/clients.test.js`: extend to cover `output_drive_folder_id` parse/store on POST and PUT, 400 on bad output link, blank → null, and that the removed auto-create no longer fires. Update/remove the v1 auto-create tests.
- `tests/database.test.js`: `createClient`/`updateClient` persist `output_drive_folder_id`.
- Frontend (clients.html) has no automated coverage (consistent with the app) — verified via curl grep + manual click-through.
- `npm test` must stay green.

## Commit style
`feat:` / `refactor:` prefixes, one commit per task.
