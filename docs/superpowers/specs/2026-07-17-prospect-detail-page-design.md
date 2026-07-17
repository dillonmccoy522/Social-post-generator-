# Prospect Detail Page + Cleanup — Design

**Date:** 2026-07-17
**Owner:** Dillon (Chief Growth Officer)
**Status:** Design approved, building
**Repo:** `~/Niewdel /social-dashboard`
**Follows:** `2026-07-16-prospects-crm-design.md` (the CRM foundation this builds on)

## Goal

Turn each lead from a static card into something Dillon can actually work: click any lead,
open its own full page, call or copy the number, correct the facts, add the real people
(contacts), and log the call — all in one place. Retire the dormant "Due Today" view.

This is **Round 1** of the prospecting changes. Lead **Generation** (sourcing new leads from a
paid data provider) is Round 2, a separate spec.

## Scope

**In scope:**
1. Remove the **Due Today** view from the UI. Default view becomes **Pipeline**. Tabs:
   Pipeline · Queue · Pool.
2. **Lead detail page** — a full page (not modal), reachable by clicking any lead card in any
   view, with a Back button that returns to the prior view.
3. **Hand-editing** of a lead's fields on the detail page, through a deliberate user-action
   save path that no automated code can reach.
4. **Contacts** — add, edit, and deactivate the people at a business.
5. **Call logging** on the detail page (the outcome buttons that used to live only on Due
   Today), without cadence auto-scheduling.

**Out of scope (Round 2, separate spec):** the Generate / sourcing-run feature and the data
provider integration.

## Hard rules carried over (non-negotiable)

- **Nothing is deleted or machine-overwritten.** Contacts deactivate (`is_active = 0`), never
  DELETE. No delete path is added to any table.
- **Dillon-owned columns are never written by an automated path.** The detail-page save is a
  user action and is the only thing that writes them.
- **Grade routes through grading, not the free edit form.** 👍/🤷/👎 stay in the Queue flow so
  a 👎 always carries a reason. The detail page does not expose grade as an editable field.

## Backend

All in `db/prospects.js` and `routes/prospects.js`. Uses the already-present `contacts` table
and the `USER_FIELDS` list (currently defined but unused).

### `saveProspectEdits(id, fields)` — the human edit path

The counterpart to `updateResearch` (machine-only). This one is reachable **only** from the
detail-page Save. It may write:

- **Identity/contact:** `business_name`, `trade`, `city`, `state`, `owner_name`, `phone`,
  `email`, `social`
- **Facts:** `website_url`, `website_quality`, `rating`, `review_count`, `review_source`,
  `est_year`, `est_year_note`, `segment`, `hook`, `runs_ads`
- **Dillon-owned:** `stage`, `rep`, `next_action`, `next_date`, `notes`, `deal_service`,
  `deal_value`, `deal_objections`, `proposal_sent_at`

Behavior:
- **May NOT write** `grade`, `status`, `disqualified_reason` (grade path owns those). Those keys
  are dropped if passed, same defensive pattern as `updateResearch`.
- If `phone` changes, recompute `phone_normalized`. If `business_name` or `city` changes,
  recompute `dedupe_key`.
- **If `review_count` is provided and differs from the stored value, set `review_verified = 1`**
  — a hand-corrected count is a confirmed Google read. `review_source` is set to `'manual'` when
  the human edits the count without supplying a source.
- Touches `updated_at`. Returns the updated row.

### Contacts

- `getContacts(prospect_id)` — all contacts for a lead, active first, newest first.
- `createContact({ prospect_id, name, role, phone, email, is_decision_maker, is_gatekeeper, notes })`
  — `name` required; returns the new row.
- `updateContact(id, fields)` — edit any of `name`, `role`, `phone`, `email`,
  `is_decision_maker`, `is_gatekeeper`, `notes`. (Fixing a typo is allowed; deletion is not.)
- `deactivateContact(id)` — sets `is_active = 0`. The retire path. No `deleteContact` exists.

### `logCall(prospect_id, { outcome, notes, channel })` — call logging without cadence

Referenced already in the schema comment; implement it now. It:
- Writes an `activities` row (`type` = `channel` or `'call'`; `outcome`; `notes`; `rep`).
- Moves stage on the two outcomes that mean progress: `connected` → `stage='connected'`,
  `meeting_set` → `stage='meeting_set'`. `not_interested` → `stage='dead_nurture'`. Other
  outcomes (`no_answer`, `voicemail`, `gatekeeper`, `callback`) log without moving stage, and
  bump a `new` lead to `attempting`.
- **Does not schedule `next_touch_at`.** The cadence path (`recordTouch`) stays in place,
  dormant and tested, but is no longer used by the UI.

### Routes (`routes/prospects.js`)

- `GET /api/prospects/:id` — extend the existing route to also return `contacts`.
- `PATCH /api/prospects/:id` — body is a field bag → `saveProspectEdits`. 404 on unknown id.
- `POST /api/prospects/:id/log` — `{ outcome, notes, channel }` → `logCall`. Validates `outcome`
  against the existing `OUTCOMES` list; 400 otherwise.
- `POST /api/prospects/:id/contacts` — `{ name, ... }` → `createContact`. 400 if no `name`.
- `PATCH /api/prospects/:id/contacts/:contactId` — → `updateContact`.
- `POST /api/prospects/:id/contacts/:contactId/deactivate` — → `deactivateContact`.

The `/stats` response drops the `due` count. `getDueToday` / `recordTouch` / the `/due` and
`/touch` routes remain (dormant) so their 15 tests keep passing.

## Frontend (`public/pages/prospects.html`)

Single file, same scoped-`.prospects` vanilla-JS pattern. Two modes in the one content area:
the **list** (existing) and the **detail** (new). Clicking a card sets a `detailId` and
re-renders into detail; Back clears it and restores the prior view and scroll.

### List changes
- Remove `due` from `VIEWS`, remove `renderDue`, remove the `/due` fetch, drop the "due today"
  stat. Default `view = 'pipeline'`. Page title/dek follow the active view.
- Every lead card becomes clickable (cursor, hover) → opens detail. Buttons inside a card
  (grade, etc.) still stop propagation and do their own thing.

### Detail page
Layout (matches the approved mockup):
- **‹ Back** to the prior view.
- **Header:** business name (Montserrat 800), `trade · city · segment`, grade/status pill.
- **Call bar:** big blue phone number, `Call` (`tel:`) and `Copy` buttons.
- **Facts:** rating, reviews (+ verified badge), est year, website link, site quality, runs-ads
  — rendered as an **editable form** (inputs pre-filled), with a **Save** button that PATCHes.
  A subtle "verified" flip when a review count is corrected.
- **Contacts:** list of active contacts (name, role, phone with Call/Copy, decision-maker /
  gatekeeper tags), an **+ Add contact** inline form, edit and "remove" (deactivate) per row.
- **Notes:** editable textarea, saved with the rest.
- **Call log:** `activities` history, newest first, read-only.
- **Log a call:** the outcome buttons (`No answer` · `Voicemail` · `Gatekeeper` · `Connected` ·
  `Callback` · `Meeting set` · `Not interested`), one tap → `POST /:id/log`, refreshes the log.
- If the lead is ungraded (`status='new'`), the detail page also offers the 👍/🤷/👎 grade
  action (with the required "why" on 👎), so grading is reachable from here too, not only the
  Queue.

Brand v4.0 tokens already defined at the top of the file are reused; no new palette.

## Testing

Jest + supertest, matching `tests/`.

- **`saveProspectEdits`:** writes an allowed field; **drops** `grade`/`status`/
  `disqualified_reason` if passed; recomputes `phone_normalized` / `dedupe_key` on change;
  correcting `review_count` flips `review_verified` to 1; leaves other rows untouched.
- **Never-delete still holds:** no `deleteProspect` / `deleteContact` / `deleteActivity` export
  exists; `deactivateContact` keeps the row with `is_active = 0`.
- **Contacts:** create requires a name; update edits fields; deactivate hides without deleting;
  `getContacts` returns them for the right prospect only.
- **`logCall`:** logs an activity, moves stage on `connected` / `meeting_set` /
  `not_interested`, bumps `new`→`attempting` on a plain outcome, and never sets `next_touch_at`.
- **Routes:** `GET /:id` includes contacts; `PATCH /:id` saves; bad id is 404; `POST /:id/log`
  rejects a bad outcome with 400; contact create/update/deactivate round-trip.
- **Regression:** the dormant cadence tests (`getDueToday`, `recordTouch`) still pass unchanged.

## Risks

| Risk | Mitigation |
|---|---|
| Human edit path accidentally writes grade/status | Whitelist-drop like `updateResearch`; a test asserts those keys are ignored |
| Correcting a review count silently hides a real conflict | The flip to verified is a deliberate, tested behavior; `review_source='manual'` records that a person did it |
| Removing Due Today breaks the dormant cadence tests | Data-layer functions and their routes stay; only the UI stops calling them |
| Detail page grows the single file too large | Keep detail render in its own function block; if it strains, split later (noted, not now) |
