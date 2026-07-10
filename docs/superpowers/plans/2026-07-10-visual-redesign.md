# Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire Niewdel Social Dashboard (all 6 pages + login) from the current near-black/rust theme to the approved "Bright Blue Playful" system — dark blue shell, cream content cards, glossy 3D status/empty-state icons — with zero functional changes.

**Architecture:** Single-pass token rewrite. One rewrite of `public/styles.css` establishes new design tokens and component classes (`.card`, `.card-cream`, `.stat-card-hero/-outline`, `.badge`/`.badge-accent`, `.btn-*`, `.post-block`). Every page fragment then gets a targeted markup sweep — mostly automatic via the CSS cascade, with explicit diffs only where markup itself must change (icon slots, class swaps, the sidebar logo mark).

**Tech Stack:** Vanilla HTML/CSS/JS (no framework, no build step), Express static file serving, Jest/Supertest for the (backend-only) test suite. Icons generated via the Higgsfield MCP tools (`models_explore`, `generate_image`, `job_status`) already connected in this environment.

## Global Constraints

- No functional changes: every route, form field, API call, and JS behavior stays exactly as it is today. This is a presentational-only change.
- Page fragments (`public/pages/*.html`) have no `<html>/<head>` wrapper and use no module syntax — they're loaded via `new Function` by `public/app.js`. Do not add wrapper tags or `import`/`export`.
- All user-rendered strings go through the existing `esc()` helper (defined per-page-fragment); user-controlled URLs go through `safeUrl()`. This plan adds no new user-controlled rendering paths — icon `<img src>` values come from a static internal map, not user input, so they don't need `safeUrl()`.
- Commit style: `feat:` prefix for this work (it's new visual treatment, not a bug fix).
- `npm test` (50 tests, `jest --runInBand`) must pass unchanged after every task — the suite is entirely backend (routes/db), confirmed to contain zero references to frontend markup or CSS classes, so it's a pure regression guard here, not a source of new test cases.
- Branch: work happens on `feature/visual-redesign`, cut from `feature/aios-phase-a` (current HEAD `c1c0161`), per Dillon's approval of that branch strategy in the spec review.

---

## File Structure

**Create:**
- `public/icons/status-queued.png`, `status-generating.png`, `status-draft.png`, `status-approved.png`, `status-posted.png` — 5 status icons for the Assets page badges
- `public/icons/empty-general.png` — empty-state icon (Home activity, Assets grid, History list)
- `public/icons/empty-photos.png` — empty-state icon (Create's Drive picker)

**Modify:**
- `public/styles.css` — full rewrite: new tokens, new/updated component classes
- `public/index.html` — sidebar logo mark markup
- `public/login.html` — login card → cream card
- `public/pages/home.html` — stat cards (hero/outline treatment) + activity list → cream cards
- `public/pages/assets.html` — asset cards → cream cards, status icons, empty-state icon
- `public/pages/create.html` — empty-state icon only (rest restyles automatically via CSS)
- `public/pages/generate.html` — `.post-block` already restyles via CSS; no markup change needed
- `public/pages/history.html` — empty-state icon only (`.card`/`.post-block` restyle via CSS)

## Icon → Real Data Mapping (resolves a mockup/schema mismatch)

The approved Home-page mockup showed 4 stat cards themed around the asset pipeline (Queued/Generating/Approved/Posted) with icon glyphs in each. The **real** `/api/stats` endpoint (`database.js:172` `getStats()`) returns different fields: `clients`, `postsThisWeek`, `assetsByStatus.draft`, and `assetsByStatus.queued + assetsByStatus.generating`. Two of those four don't correspond to any of the spec's 7 approved icons ("Active clients" and "Posts this week" have no icon concept in the icon budget).

Resolution used throughout this plan: Home's 4 stat cards get the **hero/outline gradient card treatment** (the dominant visual signal from the mockup — gradient, shadow, radius) but **no icon glyph** — keeps the mockup's visual weight without inventing icons outside the approved 7. The 5 status icons are used where status data actually exists per-item: **next to each asset's status badge on the Assets page**, which is the one place in the app where all 5 (well, 6 — "failed" has no icon in the approved set) status values appear per-record. This is a closer, more meaningful fit for real icon imagery than forcing them onto stat cards that don't map to individual statuses.

---

### Task 1: Branch setup + generate the icon set

**Files:**
- Create: `public/icons/status-queued.png`, `public/icons/status-generating.png`, `public/icons/status-draft.png`, `public/icons/status-approved.png`, `public/icons/status-posted.png`, `public/icons/empty-general.png`, `public/icons/empty-photos.png`

**Interfaces:**
- Produces: 7 static PNG files at the paths above, each a square (1:1) glossy 3D render on a transparent background, referenced by later tasks as plain `<img src="/icons/<name>.png">`.

- [ ] **Step 1: Cut the branch**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard"
git checkout feature/aios-phase-a
git checkout -b feature/visual-redesign
```

Expected: `Switched to a new branch 'feature/visual-redesign'`

- [ ] **Step 2: Pick a model for the icon set**

Call `mcp__higgsfield__models_explore` with:
```json
{"action": "recommend", "input": "text", "query": "glossy rounded 3D icon render, isometric, transparent background, blue and cream color palette, matches a premium SaaS brand — single icon per image, no text, no background"}
```
Note the returned `model_id` — reuse it for all 7 icons in Step 3 so they render in a consistent style.

- [ ] **Step 3: Generate each icon**

For each of the 7 icons below, call `mcp__higgsfield__generate_image`:
```json
{"params": {"model": "<model_id from Step 2>", "prompt": "<prompt>", "aspect_ratio": "1:1", "count": 1}}
```

| File | Prompt |
|---|---|
| `status-queued.png` | "A single glossy 3D hourglass icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text" |
| `status-generating.png` | "A single glossy 3D sparkle/magic-wand icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text" |
| `status-draft.png` | "A single glossy 3D pencil icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text" |
| `status-approved.png` | "A single glossy 3D checkmark icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text" |
| `status-posted.png` | "A single glossy 3D paper airplane icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text" |
| `empty-general.png` | "A single glossy 3D open folder icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text, slightly larger and more detailed than a small status icon" |
| `empty-photos.png` | "A single glossy 3D camera icon, deep blue (#3B86DB) and cream white, soft rounded edges, floating on transparent background, isolated, no text, slightly larger and more detailed than a small status icon" |

Each call returns a `jobId`. Record all 7.

- [ ] **Step 4: Poll each job and download the result**

For each `jobId` from Step 3, call `mcp__higgsfield__job_status` with `{"jobId": "<id>", "sync": true}`. This blocks up to ~25s and returns on terminal state (image jobs typically finish in 10-20s). The response is the "normalized generation shape" — look for the image URL under one of `results[0].url`, `output[0].url`, `media_url`, or `url` at the top level (exact field name varies by job type; print the full JSON response and read it directly rather than guessing blind).

Download each to its target path:
```bash
curl -sL -o "public/icons/status-queued.png" "<url from job_status>"
curl -sL -o "public/icons/status-generating.png" "<url from job_status>"
curl -sL -o "public/icons/status-draft.png" "<url from job_status>"
curl -sL -o "public/icons/status-approved.png" "<url from job_status>"
curl -sL -o "public/icons/status-posted.png" "<url from job_status>"
curl -sL -o "public/icons/empty-general.png" "<url from job_status>"
curl -sL -o "public/icons/empty-photos.png" "<url from job_status>"
```

- [ ] **Step 5: Verify the files**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && file public/icons/*.png
```

Expected: 7 lines, each reporting `PNG image data` with nonzero dimensions (not `HTML document` or `ASCII text`, which would mean the download grabbed an error page instead of an image).

- [ ] **Step 6: Commit**

```bash
git add public/icons/
git commit -m "feat: add generated 3D icon set for visual redesign"
```

---

### Task 2: Rewrite design tokens and core component styles

**Files:**
- Modify: `public/styles.css` (full rewrite, replaces all 256 lines)

**Interfaces:**
- Produces: CSS custom properties (`--bg`, `--sidebar-grad-top`, `--sidebar-grad-bottom`, `--surface-outline`, `--surface-border`, `--surface-border-hover`, `--accent`, `--accent-dark`, `--accent-hero`, `--accent-soft`, `--cream`, `--cream-text`, `--cream-text-secondary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--radius-lg`, `--radius-md`, `--radius-sm`, `--shadow-accent`, `--shadow-card`, `--sidebar-width`) and classes (`.sidebar-logo-mark`, `.sidebar-logo-text`, `.card`, `.card-cream`, `.stat-card`, `.stat-card-hero`, `.stat-card-outline`, `.stat-label`, `.stat-value`, `.badge`, `.badge-accent`, `.btn-primary/-secondary/-ghost/-danger/-sm`, `.post-block`, `.post-block-header`, `.post-content`, `.empty-state img`, `.toast`) that every later task's markup relies on by exact name.

- [ ] **Step 1: Replace the full file**

```css
:root {
  --bg:                    #0a1220;
  --sidebar-grad-top:      #0f1b30;
  --sidebar-grad-bottom:   #0a1220;
  --surface-outline:       #101d33;
  --surface-border:        rgba(59, 134, 219, 0.25);
  --surface-border-hover:  rgba(59, 134, 219, 0.45);
  --accent:                #3B86DB;
  --accent-dark:           #2563b0;
  --accent-hero:           linear-gradient(150deg, #4a95e5, #2a63ad);
  --accent-soft:           rgba(59, 134, 219, 0.15);
  --cream:                 #fdfbf5;
  --cream-text:            #14213d;
  --cream-text-secondary:  #8a8a7e;
  --text-primary:          rgba(255, 255, 255, 0.93);
  --text-secondary:        rgba(255, 255, 255, 0.55);
  --text-muted:            rgba(255, 255, 255, 0.35);
  --radius-lg:             16px;
  --radius-md:             14px;
  --radius-sm:             9px;
  --shadow-accent:         0 12px 28px rgba(59, 134, 219, 0.4);
  --shadow-card:           0 10px 24px rgba(0, 0, 0, 0.35);
  --sidebar-width:         200px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: 'Inter', -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  height: 100vh;
  overflow: hidden;
}

.layout { display: flex; height: 100vh; }

/* SIDEBAR */
.sidebar {
  width: var(--sidebar-width);
  background: linear-gradient(180deg, var(--sidebar-grad-top), var(--sidebar-grad-bottom));
  border-right: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  padding: 28px 14px;
  flex-shrink: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  margin-bottom: 32px;
}

.sidebar-logo-mark {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(145deg, var(--accent), var(--accent-dark));
  box-shadow: 0 4px 12px rgba(59, 134, 219, 0.5);
  flex-shrink: 0;
}

.sidebar-logo-text {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.sidebar-nav { display: flex; flex-direction: column; gap: 4px; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  cursor: pointer;
}

.nav-item:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
.nav-item.active {
  background: linear-gradient(145deg, var(--accent), var(--accent-dark));
  color: #fff;
  font-weight: 600;
  box-shadow: var(--shadow-accent);
}
.nav-icon { font-size: 14px; width: 18px; text-align: center; }

/* CONTENT */
.content { flex: 1; overflow-y: auto; padding: 48px 56px; }

/* TYPOGRAPHY */
.page-title { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 6px; }
.page-subtitle { color: var(--text-secondary); font-size: 13.5px; margin-bottom: 36px; }
.section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 16px;
}

/* STRUCTURAL CARDS (dark — forms, grouping containers) */
.card {
  background: var(--surface-outline);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 12px;
  transition: border-color 0.15s;
}
.card:hover { border-color: var(--surface-border-hover); }

/* CONTENT CARDS (cream — posts, assets, history rows, login) */
.card-cream {
  background: var(--cream);
  color: var(--cream-text);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  margin-bottom: 10px;
  box-shadow: var(--shadow-card);
}

/* STAT CARDS (Home) */
.stat-card { border-radius: var(--radius-lg); padding: 16px; }
.stat-card-hero { background: var(--accent-hero); box-shadow: var(--shadow-accent); }
.stat-card-outline { background: var(--surface-outline); border: 1px solid var(--surface-border); }
.stat-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.stat-card-hero .stat-label { color: rgba(255, 255, 255, 0.85); }
.stat-card-outline .stat-label { color: #8ab4e8; }
.stat-value { font-size: 22px; font-weight: 800; margin-top: 4px; color: #fff; }

/* FORM ELEMENTS */
label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
  letter-spacing: 0.01em;
}

input, textarea, select {
  width: 100%;
  background: var(--surface-outline);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.5;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  margin-bottom: 20px;
}

input:focus, textarea:focus, select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

textarea { resize: vertical; min-height: 80px; }
select { cursor: pointer; }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* BUTTONS */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s, box-shadow 0.15s;
}

.btn:hover { opacity: 0.88; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary {
  background: linear-gradient(145deg, var(--accent), var(--accent-dark));
  color: #fff;
  box-shadow: var(--shadow-accent);
}
.btn-secondary { background: var(--surface-outline); color: var(--text-primary); border: 1px solid var(--surface-border); }
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--surface-border); }
.btn-danger { background: transparent; color: #e05a4e; border: 1px solid rgba(224, 90, 78, 0.35); }
.btn-sm { padding: 6px 12px; font-size: 12px; }

/* BADGES */
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--accent-soft);
  color: #8ab4e8;
}

.badge-accent {
  background: linear-gradient(145deg, var(--accent), var(--accent-dark));
  color: #fff;
}

/* POST OUTPUT (cream — nested content) */
.post-block {
  background: var(--cream);
  color: var(--cream-text);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 12px;
  box-shadow: var(--shadow-card);
}

.post-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.post-content {
  font-size: 13px;
  color: var(--cream-text-secondary);
  white-space: pre-wrap;
  line-height: 1.7;
}

/* LOADING / EMPTY */
.loading, .empty-state {
  color: var(--text-muted);
  font-size: 13.5px;
  text-align: center;
  padding: 48px 0;
}
.empty-state img { width: 48px; height: 48px; display: block; margin: 0 auto 12px; }

/* TOAST */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--cream);
  color: var(--cream-text);
  border-radius: var(--radius-sm);
  padding: 12px 20px;
  font-size: 13px;
  box-shadow: var(--shadow-card);
  z-index: 100;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.2s, transform 0.2s;
}

.toast.show { opacity: 1; transform: translateY(0); }

/* DIVIDER */
hr { border: none; border-top: 1px solid var(--surface-border); margin: 24px 0; }

/* SPINNER */
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Verify the file is well-formed CSS**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && node -e "require('fs').readFileSync('public/styles.css','utf8')" && echo "readable"
```

Then spot-check brace balance:
```bash
node -e "const s=require('fs').readFileSync('public/styles.css','utf8'); const o=(s.match(/{/g)||[]).length; const c=(s.match(/}/g)||[]).length; console.log(o,c,o===c?'BALANCED':'MISMATCH')"
```
Expected: two equal numbers and `BALANCED`.

- [ ] **Step 3: Run the regression suite**

```bash
npm test
```
Expected: `Tests: 50 passed, 50 total` (unaffected by a CSS-only change — this just confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "feat: rewrite design tokens for Bright Blue Playful visual system"
```

---

### Task 3: Restyle app shell — sidebar logo mark

**Files:**
- Modify: `public/index.html:14-24`

**Interfaces:**
- Consumes: `.sidebar-logo-mark`, `.sidebar-logo-text` from Task 2.

- [ ] **Step 1: Update the sidebar markup**

Replace:
```html
    <aside class="sidebar">
      <div class="sidebar-logo">Niewdel</div>
```
With:
```html
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-mark"></div>
        <div class="sidebar-logo-text">niewdel</div>
      </div>
```
(Leave the rest of `public/index.html` — the `<nav class="sidebar-nav">` block with its emoji `nav-icon` spans — unchanged. Nav emoji are out of scope for this redesign per the spec.)

- [ ] **Step 2: Verify with the running app**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/ | grep -c "sidebar-logo-mark"
kill %1
```
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add gradient logo mark to sidebar"
```

---

### Task 4: Restyle login page

**Files:**
- Modify: `public/login.html`

**Interfaces:**
- Consumes: `.card-cream`, `.sidebar-logo-mark`/`.sidebar-logo-text` (Task 2/3), `.btn-primary` (Task 2).

- [ ] **Step 1: Replace the body**

Replace the full `<body>` block:
```html
<body>
  <div class="login-box card">
    <div class="sidebar-logo" style="margin-bottom:16px;">Niewdel</div>
    <label>Password</label>
    <input type="password" id="password" autofocus />
    <button class="btn btn-primary" id="login-btn" style="width:100%;margin-top:12px;">Sign in</button>
    <div id="login-error" style="color:var(--accent);font-size:12.5px;margin-top:10px;display:none;">Wrong password.</div>
  </div>
```
With:
```html
<body>
  <div class="login-box card-cream">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
      <div class="sidebar-logo-mark"></div>
      <div class="sidebar-logo-text" style="color:var(--cream-text);">niewdel</div>
    </div>
    <label style="color:var(--cream-text-secondary);">Password</label>
    <input type="password" id="password" autofocus style="background:#fff;border-color:rgba(20,33,61,0.15);color:var(--cream-text);" />
    <button class="btn btn-primary" id="login-btn" style="width:100%;margin-top:12px;">Sign in</button>
    <div id="login-error" style="color:#c0392b;font-size:12.5px;margin-top:10px;display:none;">Wrong password.</div>
  </div>
```
(The `<style>` block in `<head>` — `body { display:flex; ... } .login-box { width: 340px; }` — stays unchanged; it's page-specific centering, not a token.)

- [ ] **Step 2: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/login.html | grep -c "card-cream"
kill %1
```
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add public/login.html
git commit -m "feat: restyle login page with cream card"
```

---

### Task 5: Restyle Home page

**Files:**
- Modify: `public/pages/home.html`

**Interfaces:**
- Consumes: `.stat-card`/`.stat-card-hero`/`.stat-card-outline`/`.stat-label`/`.stat-value` (Task 2), `.card-cream`, `.badge` (Task 2).
- Consumes: `/icons/empty-general.png` (Task 1).
- Consumes real data shape from `/api/stats`: `{ clients, postsThisWeek, assetsByStatus: { draft, queued, generating, ... }, recentActivity: [{ kind, client_name, label, created_at }] }` (`database.js:172`, unchanged).

- [ ] **Step 1: Replace the stat cards markup**

Replace:
```html
  <div class="form-row" style="margin-bottom:24px;" id="stat-cards">
    <div class="card"><div class="section-label">Active clients</div><div style="font-size:28px;font-weight:600;" id="stat-clients">—</div></div>
    <div class="card"><div class="section-label">Posts this week</div><div style="font-size:28px;font-weight:600;" id="stat-posts">—</div></div>
    <div class="card"><div class="section-label">Assets awaiting review</div><div style="font-size:28px;font-weight:600;" id="stat-draft">—</div></div>
    <div class="card"><div class="section-label">Queued generations</div><div style="font-size:28px;font-weight:600;" id="stat-queued">—</div></div>
  </div>
```
With:
```html
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;" id="stat-cards">
    <div class="stat-card stat-card-outline">
      <div class="stat-label">Active clients</div>
      <div class="stat-value" id="stat-clients">—</div>
    </div>
    <div class="stat-card stat-card-outline">
      <div class="stat-label">Posts this week</div>
      <div class="stat-value" id="stat-posts">—</div>
    </div>
    <div class="stat-card stat-card-outline">
      <div class="stat-label">Assets awaiting review</div>
      <div class="stat-value" id="stat-draft">—</div>
    </div>
    <div class="stat-card stat-card-hero">
      <div class="stat-label">Queued generations</div>
      <div class="stat-value" id="stat-queued">—</div>
    </div>
  </div>
```

- [ ] **Step 2: Replace the activity card wrapper**

Replace:
```html
  <div class="card" style="margin-bottom:24px;">
    <div class="section-label">Recent activity</div>
    <div id="activity"><div class="empty-state">Loading…</div></div>
  </div>
```
With:
```html
  <div style="margin-bottom:24px;">
    <div class="section-label">Recent activity</div>
    <div id="activity"><div class="empty-state">Loading…</div></div>
  </div>
```
(The section label now sits directly on the dark shell; each activity row becomes its own `.card-cream` in Step 3, matching the approved mockup instead of one big dark card wrapping a list.)

- [ ] **Step 3: Replace the `loadStats` script**

Replace:
```javascript
  const act = document.getElementById('activity');
  if (s.recentActivity.length === 0) {
    act.innerHTML = '<div class="empty-state">No activity yet. Generate something from the Create tab.</div>';
    return;
  }
  act.innerHTML = s.recentActivity.map(a => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <div><span class="badge" style="margin-right:8px;">${esc(a.kind)}</span>${esc(a.client_name)} — ${esc(a.label)}</div>
      <div style="color:var(--text-muted);">${esc((a.created_at || '').slice(0, 16))}</div>
    </div>
  `).join('');
```
With:
```javascript
  const act = document.getElementById('activity');
  if (s.recentActivity.length === 0) {
    act.innerHTML = '<div class="empty-state"><img src="/icons/empty-general.png" alt="" />No activity yet. Generate something from the Create tab.</div>';
    return;
  }
  act.innerHTML = s.recentActivity.map(a => `
    <div class="card-cream" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-weight:700;font-size:13px;">${esc(a.label)}</div>
        <div style="color:var(--cream-text-secondary);font-size:11px;margin-top:3px;">${esc(a.client_name)} &middot; ${esc((a.created_at || '').slice(0, 16))}</div>
      </div>
      <span class="badge">${esc(a.kind)}</span>
    </div>
  `).join('');
```

- [ ] **Step 4: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/home.html | grep -c "stat-card-hero"
curl -s http://localhost:3000/pages/home.html | grep -c "empty-general.png"
kill %1
npm test
```
Expected: both greps return `1`, and `Tests: 50 passed, 50 total`.

- [ ] **Step 5: Commit**

```bash
git add public/pages/home.html
git commit -m "feat: restyle Home page with hero stat card and cream activity cards"
```

---

### Task 6: Restyle Assets page

**Files:**
- Modify: `public/pages/assets.html`

**Interfaces:**
- Consumes: `.card-cream` (Task 2), `/icons/status-*.png` (5 files, Task 1), `/icons/empty-general.png` (Task 1).
- Consumes real data shape from `/api/assets`: `[{ id, client_name, type, campaign, status, error, prompt, thumbnail_url, output_drive_url }]` (unchanged — `routes/assets.js`).

- [ ] **Step 1: Add a status icon map to the script**

Replace:
```javascript
function safeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#';
  } catch { return '#'; }
}

const STATUS_ACTIONS = {
```
With:
```javascript
function safeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#';
  } catch { return '#'; }
}

const STATUS_ICONS = {
  queued: '/icons/status-queued.png',
  generating: '/icons/status-generating.png',
  draft: '/icons/status-draft.png',
  approved: '/icons/status-approved.png',
  posted: '/icons/status-posted.png',
};

const STATUS_ACTIONS = {
```

- [ ] **Step 2: Swap the card class and badge markup**

Replace:
```javascript
  grid.innerHTML = assets.map(a => `
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="height:140px;background:var(--surface-raised);display:flex;align-items:center;justify-content:center;">
        ${a.thumbnail_url
          ? `<img src="${esc(safeUrl(a.thumbnail_url))}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
          : `<span style="font-size:32px;">${a.type === 'video' ? '🎬' : '🖼️'}</span>`}
      </div>
      <div style="padding:12px;">
        <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${esc(a.client_name)}</div>
        <div style="color:var(--text-muted);font-size:11.5px;margin-bottom:6px;">${esc(a.type)}${a.campaign ? ' · ' + esc(a.campaign) : ''}</div>
        <span class="badge">${esc(a.status)}</span>
        ${a.error ? `<div style="color:var(--accent);font-size:11.5px;margin-top:6px;">${esc(a.error)}</div>` : ''}
        ${a.prompt ? `<div style="color:var(--text-secondary);font-size:11.5px;margin-top:6px;max-height:44px;overflow:hidden;">${esc(a.prompt)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${(STATUS_ACTIONS[a.status] || []).map(([to, label]) =>
            `<button class="btn btn-secondary btn-sm" data-action="status" data-id="${a.id}" data-to="${to}">${label}</button>`).join('')}
          ${a.output_drive_url ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl(a.output_drive_url))}" target="_blank" rel="noopener">Drive ↗</a>` : ''}
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${a.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
```
With:
```javascript
  grid.innerHTML = assets.map(a => `
    <div class="card-cream" style="padding:0;overflow:hidden;">
      <div style="height:140px;background:rgba(20,33,61,0.06);display:flex;align-items:center;justify-content:center;">
        ${a.thumbnail_url
          ? `<img src="${esc(safeUrl(a.thumbnail_url))}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
          : `<span style="font-size:32px;">${a.type === 'video' ? '🎬' : '🖼️'}</span>`}
      </div>
      <div style="padding:12px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${esc(a.client_name)}</div>
        <div style="color:var(--cream-text-secondary);font-size:11.5px;margin-bottom:6px;">${esc(a.type)}${a.campaign ? ' · ' + esc(a.campaign) : ''}</div>
        <span class="badge">${STATUS_ICONS[a.status] ? `<img src="${STATUS_ICONS[a.status]}" alt="" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;" />` : ''}${esc(a.status)}</span>
        ${a.error ? `<div style="color:#c0392b;font-size:11.5px;margin-top:6px;">${esc(a.error)}</div>` : ''}
        ${a.prompt ? `<div style="color:var(--cream-text-secondary);font-size:11.5px;margin-top:6px;max-height:44px;overflow:hidden;">${esc(a.prompt)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${(STATUS_ACTIONS[a.status] || []).map(([to, label]) =>
            `<button class="btn btn-secondary btn-sm" data-action="status" data-id="${a.id}" data-to="${to}">${label}</button>`).join('')}
          ${a.output_drive_url ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl(a.output_drive_url))}" target="_blank" rel="noopener">Drive ↗</a>` : ''}
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${a.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
```
(`--surface-raised` no longer exists as a token after Task 2 — replaced here with an inline cream-tinted placeholder background so the thumbnail area still reads correctly on the new cream card.)

- [ ] **Step 3: Add the empty-state icon**

Replace:
```javascript
  if (assets.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No assets match. Generate something from the Create tab.</div>';
    return;
  }
```
With:
```javascript
  if (assets.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><img src="/icons/empty-general.png" alt="" />No assets match. Generate something from the Create tab.</div>';
    return;
  }
```

- [ ] **Step 4: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/assets.html | grep -c "card-cream"
curl -s http://localhost:3000/pages/assets.html | grep -c "STATUS_ICONS"
kill %1
npm test
```
Expected: both greps return at least `1` (STATUS_ICONS defined once; `card-cream` appears in both the template string and this is a static grep on source so it will match the literal `class="card-cream"` in the template), and `Tests: 50 passed, 50 total`.

- [ ] **Step 5: Commit**

```bash
git add public/pages/assets.html
git commit -m "feat: restyle Assets page with cream cards and status icons"
```

---

### Task 7: Restyle Create page — empty-state icon

**Files:**
- Modify: `public/pages/create.html`

**Interfaces:**
- Consumes: `/icons/empty-photos.png` (Task 1). All other elements on this page (form `.card`, buttons, inputs, the Drive picker's folder/file tiles) restyle automatically via the Task 2 CSS cascade — no other markup change needed.

- [ ] **Step 1: Add the empty-state icon to the picker's empty-folder message**

Replace:
```javascript
  if (files.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Empty folder.</div>';
    return;
  }
```
With:
```javascript
  if (files.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><img src="/icons/empty-photos.png" alt="" />Empty folder.</div>';
    return;
  }
```

- [ ] **Step 2: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/create.html | grep -c "empty-photos.png"
kill %1
npm test
```
Expected: `1`, and `Tests: 50 passed, 50 total`.

- [ ] **Step 3: Commit**

```bash
git add public/pages/create.html
git commit -m "feat: add empty-state icon to Create page Drive picker"
```

---

### Task 8: Verify Generate page restyles correctly (no markup change)

**Files:**
- None modified — `public/pages/generate.html` uses `.card`, `.btn-primary`, `.badge-accent`, `.post-block`, `.post-block-header`, `.post-content`, `.spinner`, all restyled by Task 2's CSS with zero markup changes needed.

**Interfaces:**
- Consumes: `.post-block` (now a cream card per Task 2), `.badge-accent` (now the filled gradient variant per Task 2).

- [ ] **Step 1: Verify the page renders with the new classes present**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/generate.html | grep -c "post-block"
curl -s http://localhost:3000/pages/generate.html | grep -c "badge-accent"
kill %1
```
Expected: both `1` or more (the template literal defines these class names once each, but they're static strings in the fetched HTML).

- [ ] **Step 2: No commit needed** — this task made no file changes; it's a verification checkpoint confirming Task 2's cascade covers this page correctly before moving on.

---

### Task 9: Restyle History page — empty-state icon

**Files:**
- Modify: `public/pages/history.html`

**Interfaces:**
- Consumes: `/icons/empty-general.png` (Task 1). `.card` (dark, wraps each post's metadata + its nested `.post-block` cream cards) and `.post-block` restyle automatically via Task 2's CSS — no markup change needed for those.

- [ ] **Step 1: Add the empty-state icon**

Replace:
```javascript
    if (posts.length === 0) {
      list.innerHTML = '<div class="empty-state">No posts yet. Generate some content first.</div>';
      return;
    }
```
With:
```javascript
    if (posts.length === 0) {
      list.innerHTML = '<div class="empty-state"><img src="/icons/empty-general.png" alt="" />No posts yet. Generate some content first.</div>';
      return;
    }
```

- [ ] **Step 2: Verify**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm start &
sleep 1
curl -s http://localhost:3000/pages/history.html | grep -c "empty-general.png"
kill %1
npm test
```
Expected: `1`, and `Tests: 50 passed, 50 total`.

- [ ] **Step 3: Commit**

```bash
git add public/pages/history.html
git commit -m "feat: add empty-state icon to History page"
```

---

### Task 10: Full regression + manual visual QA sign-off

**Files:**
- None modified — this is the acceptance checkpoint for the whole redesign.

- [ ] **Step 1: Run the full test suite one more time**

```bash
cd "/Users/dillonmccoy/Niewdel /social-dashboard" && npm test
```
Expected: `Tests: 50 passed, 50 total`.

- [ ] **Step 2: Start the app and screenshot every page**

```bash
npm start
```
Open `http://localhost:3000` and click through: Home, Clients, Create (including the Drive photo picker modal), Assets, Posts (Generate), History, and `http://localhost:3000/login.html` directly (note: auth is off locally per `HANDOFF-CURSOR.md`, so the login page itself must be opened directly to review it — it won't appear in the normal nav flow).

For each page, confirm:
- Dark blue shell (`#0a1220`) with gradient sidebar, no leftover near-black (`#0A0A0C`) or rust (`#C84B31`) colors
- Content cards (posts, assets, history rows, login) render on cream backgrounds with the drop shadow
- Home's Queued stat card is the blue gradient "hero," the other three are dark outline cards
- Assets page shows the correct small icon next to each status badge (except "failed," which has no icon and is fine as text-only)
- Empty states (Assets grid, History list, Home activity, Create picker) show their icon when the relevant list/folder is empty — trigger by filtering to a client with no assets/posts, or browsing an empty Drive folder

- [ ] **Step 3: Fix anything visually broken inline**

If any page looks wrong, fix the specific CSS/markup issue directly (this step has no prescribed code since it's a reactive fix — but whatever's fixed must still pass Step 1's `npm test` before moving on).

- [ ] **Step 4: Final commit if fixes were made**

```bash
git add -A
git commit -m "fix: visual QA cleanup for redesign"
```
(Skip this step if Step 2 found nothing to fix.)
