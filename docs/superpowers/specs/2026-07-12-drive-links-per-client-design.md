# Per-client Google Drive links — design spec

**Date:** 2026-07-12
**Status:** Draft — awaiting Dillon's review
**Codebase:** this repo (`social-dashboard`), branch `main` (current HEAD, live on Railway)

## Why

Dillon already keeps every client's source photos/videos organized in his own Google Drive, one folder per client. The app's Drive plumbing (`services/drive.js`, built in Phase A) already supports browsing a folder and auto-uploading generated content into a per-client output folder — but there's no way to tell the app *which* folder belongs to which client, and no OAuth was ever finished being set up. Today, the Create page's "Browse Drive" button always starts at the root of the whole connected Drive account, requiring manual navigation every time.

Goal: make onboarding a new client's Drive folder a single paste, so it stays simple as Dillon adds more clients ("mass clients").

## Decisions (confirmed with Dillon, 2026-07-12)

1. **Source folder:** one field on the client form — paste a Google Drive folder link (or bare folder ID). The app parses out the folder ID and saves it on the client record.
2. **Destination folder:** stays fully automatic, unchanged from the existing design — the app creates a folder per client inside the single shared output Drive (`OUTPUT_DRIVE_FOLDER_ID`) the first time it's needed, using the already-built `ensureFolder()` logic. The only new part is *persisting and displaying* that folder's link on the client's profile once it exists, instead of it being invisible.
3. **Access model:** Dillon owns/creates all client source folders himself inside his own Niewdel Drive account — the single connected OAuth account (already used everywhere in `services/drive.js`) can browse any folder ID within it. No per-client OAuth, no client-side sharing step required.
4. **Output folder creation timing:** eager — created right when a client is saved (client-side of `POST /api/clients`), not lazily on first generated content. Rationale: Phase B (in-app generation, the natural "first content" trigger) isn't built yet, so a lazy trigger would leave the destination link permanently empty until Phase B ships. Eager creation makes the feature immediately useful. If Drive isn't configured or the create call fails, client save still succeeds — the output link is just absent until a future retry (see Error Handling).
5. **Fallback browsing:** if a client has no source folder set, the Create page's Drive picker falls back to today's behavior — starts at the root of the whole connected Drive, manual navigation. Nothing breaks for clients not yet configured.

## Non-goals

- No per-client OAuth or Drive account switching.
- No bulk/CSV import of client Drive links — one client, one paste, via the existing add/edit client form.
- No support for multiple source folders per client (e.g. per-campaign folders) — out of scope, add later if it becomes a real need.
- No automatic retry mechanism if eager output-folder creation fails at save time — the client record just has a null output link until a future spec addresses retry.
- No changes to the actual Phase A generation/upload logic (`uploadFromUrl`'s core behavior is unchanged, only its inputs are extended — see Components).

## Components

### 1. Database (`database.js`)

Add two nullable columns to `clients`:

```sql
source_drive_folder_id TEXT DEFAULT NULL
output_drive_folder_id TEXT DEFAULT NULL
```

Since schema is applied via `CREATE TABLE IF NOT EXISTS` at startup (no formal migration system in this codebase), and the `clients` table already exists in every running environment (local dev DB, and the live Railway DB once it has real data), a startup-safe migration step is needed: check `PRAGMA table_info(clients)` for each column's presence and `ALTER TABLE clients ADD COLUMN ...` if missing, run inside `initSchema()` after the existing `CREATE TABLE IF NOT EXISTS` block. Idempotent — safe to run on every startup.

Function changes:
- `createClient({ name, business_type, location, brand_voice, source_drive_folder_id = null })` — insert the new column.
- `updateClient(id, { name, business_type, location, brand_voice, source_drive_folder_id = null })` — update the new column (source folder can be added/changed after client creation).
- New: `setClientOutputFolder(id, folderId)` — `UPDATE clients SET output_drive_folder_id = ? WHERE id = ?`, returns the updated client record. Called once, right after eager creation succeeds.

### 2. Drive service (`services/drive.js`)

New exported helper:

```js
function parseFolderId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed; // bare ID, no slashes/spaces
  return null; // unrecognized format
}
```

Handles both a full pasted URL (`https://drive.google.com/drive/folders/{id}...`, with or without a trailing `/u/0` or query string) and a bare folder ID pasted directly. Returns `null` for anything that isn't recognizable as either, which the route layer turns into a 400.

`uploadFromUrl` and `ensureFolder` are unchanged — they already take a `parentId`/root folder ID as input, which is exactly what `output_drive_folder_id` will supply once this feature wires it in. No behavior change to the actual upload logic in this spec.

### 3. Clients route (`routes/clients.js`)

- `POST /` — accept `source_drive_folder_id` (raw string) from the body. If present and non-empty, parse it via `drive.parseFolderId()`; if parsing fails, return `400 { error: 'Source Drive folder link is not recognizable' }`. Pass the parsed ID (or `null`) to `db.createClient()`.

  After the client is created successfully, if `drive.isConfigured()`, attempt eager output-folder creation:
  ```js
  try {
    const folderId = await drive.ensureFolder(client.name, process.env.OUTPUT_DRIVE_FOLDER_ID);
    db.setClientOutputFolder(client.id, folderId);
    client.output_drive_folder_id = folderId;
  } catch (err) {
    // Non-fatal: client save already succeeded. Log and move on — output link stays null.
    console.error('Failed to create output Drive folder for client', client.id, err.message);
  }
  ```
  This must not block or fail the client-creation response — it's a best-effort follow-up.

- `PUT /:id` — same `source_drive_folder_id` parse/validate handling as POST. Does not re-run output-folder creation (that only happens once, at initial creation, per the eager-creation decision above).

### 4. Clients page (`public/pages/clients.html`)

- Add one new field to the add/edit form: **"Source Drive Folder Link"** (`<input type="text" id="f-drive-link" placeholder="https://drive.google.com/drive/folders/...">`), optional, positioned after the existing Brand Voice Notes field.
- `saveClient()` includes `source_drive_folder_id: document.getElementById('f-drive-link').value.trim()` in the request body (empty string is fine — the route treats empty as "no source folder").
- On save error specifically about the Drive link (400 from the route), show that message via the existing `showToast()` pattern rather than a generic failure message.
- Each client card gains two conditional links, rendered only when the corresponding field is set (styled consistent with the existing `output_drive_url` link pattern already used on the Assets page — `esc(safeUrl(...))`, opens in a new tab):
  - **Source ↗** → `https://drive.google.com/drive/folders/{source_drive_folder_id}`
  - **Output ↗** → `https://drive.google.com/drive/folders/{output_drive_folder_id}`
- `editClient(...)` gains a `sourceFolderId` parameter, populated from a new `data-source-folder="${esc(c.source_drive_folder_id || '')}"` attribute on the Edit button. When populating the edit form, reconstruct the full link (`https://drive.google.com/drive/folders/{id}`) for the `f-drive-link` field rather than showing the bare ID — so what the user sees when re-editing always looks like the link they'd paste, not raw internal storage.

### 5. Create page (`public/pages/create.html`)

- `loadClientOptions()` currently only builds `<option>` elements from the client list and discards the rest of each client object. Change it to also keep the fetched client array in a module-level variable (e.g. `let clients = []`) so other handlers can look up the selected client's Drive folder.
- The `pick-btn` click handler (`document.getElementById('pick-btn').addEventListener('click', ...)`) currently always does:
  ```js
  crumbs = [{ id: 'root', name: 'Drive' }];
  openPicker('root');
  ```
  Change it to look up the currently selected client (`document.getElementById('c-client').value`) in the in-memory `clients` array:
  ```js
  const selected = clients.find(c => String(c.id) === document.getElementById('c-client').value);
  if (selected && selected.source_drive_folder_id) {
    crumbs = [{ id: selected.source_drive_folder_id, name: selected.name }];
    openPicker(selected.source_drive_folder_id);
  } else {
    crumbs = [{ id: 'root', name: 'Drive' }];
    openPicker('root');
  }
  ```
  Breadcrumb navigation, subfolder browsing, and file picking below that starting point are unchanged — this only changes where browsing *starts*.

## Error handling

- Pasting something unparseable as a folder link/ID → `400` from the route, surfaced as a toast on the Clients page; the rest of the client form's data is preserved (not cleared) so the user can just fix the one field.
- Drive not configured (`GOOGLE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` unset, e.g. local dev) → client creation succeeds normally; `source_drive_folder_id` is still saved (it's just a string, no Drive API call needed to store it), but eager output-folder creation is skipped entirely (guarded by `drive.isConfigured()`), and `output_drive_folder_id` stays null. No error shown to the user — this matches the existing graceful-degradation pattern already used for Drive browsing (503 with a clear message) elsewhere in the app.
- Eager output-folder creation throws (Drive API error, network issue, etc.) → logged server-side, client creation response is unaffected, `output_drive_folder_id` stays null. No user-facing error for this specific failure, per the Non-goals section (no retry mechanism in this spec).
- Browse Drive on a client whose `source_drive_folder_id` points to a folder that no longer exists or isn't accessible → existing `/api/drive/browse` error handling already covers this (502 with a clear message in the picker UI) — no new handling needed, the picker just fails to load that folder's contents same as it would for any bad folder ID today.

## Testing

- `parseFolderId()` unit tests: full URL with query string, full URL without query string, `/u/0/folders/` variant, bare ID, empty string, garbage input (spaces, wrong format) → each asserted against expected output.
- `routes/clients.js` tests: POST with a valid Drive link parses and stores correctly; POST with an invalid link returns 400 and does not create the client... actually — **decision needed on ordering**: should an invalid Drive link block client creation entirely (validate before insert), or should the client still be created with the link simply omitted? This spec chooses **block entirely** (validate before insert, 400 response, no client created) — consistent with how `name`/`business_type`/`location` are already required-and-validated before creation; treating the Drive link as "validated if present" keeps one consistent validation posture rather than a special case.
- POST without a Drive link at all → client created normally, `source_drive_folder_id` and `output_drive_folder_id` both null (unless `drive.isConfigured()` and eager creation succeeds, in which case only `output_drive_folder_id` gets set).
- PUT updates `source_drive_folder_id` correctly; PUT does not touch `output_drive_folder_id`.
- Existing 50-test suite must continue passing unchanged (no behavior change to anything outside this feature's surface).

## Out of scope for this spec (tracked in project memory / prior specs)

- Phase B in-app generation (the eventual natural trigger for asset uploads that will use `output_drive_folder_id` via `uploadFromUrl`).
- A UI affordance to manually retry output-folder creation if it failed at save time.
- Bulk-importing many clients' Drive links at once.
