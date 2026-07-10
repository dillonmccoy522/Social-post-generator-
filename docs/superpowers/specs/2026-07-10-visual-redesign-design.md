# Visual redesign — design spec

**Date:** 2026-07-10
**Status:** Draft — awaiting Dillon's review
**Codebase:** this repo (`social-dashboard`), branch `feature/aios-phase-a` (or a follow-on branch off it — see Open Question below)

## Why

Phase A shipped new pages (Home, Create, Assets) that are functional but visually plain — flat dark cards on the existing near-black/rust theme. Dillon's reaction: **"this looks horrible — I wanted something appealing to the eye."**

This spec covers a visual redesign of the entire app: new palette, new component styling, a small custom 3D icon set, applied consistently across all 6 pages plus login. No functional changes — every existing route, form, and behavior stays exactly as it is today.

## Direction (validated with Dillon via visual mockups, 2026-07-10)

Dillon is moving the Niewdel brand toward a **bright blue, playful 3D style** — evidenced by recent marketing artwork (`Niewdel Growth Services gmb post 07-01-26.png`): a glossy 3D phone/icon composition on a deep blue gradient background, cream/white UI surfaces, bold rounded lowercase wordmark ("niewdel"). This is a **departure from the current near-black `#0A0A0C` / rust `#C84B31` theme**, not a refinement of it.

Four decisions were validated by showing Dillon mockups and getting explicit approval on each:

1. **Palette direction:** Bright Blue Playful, not a polished version of the current dark/rust theme.
2. **Scope:** Whole app — sidebar, all 6 pages (Home, Create, Assets, Clients, Generate, History), and the login screen. Not just the 3 Phase A pages. A partial restyle would leave a jarring mix of old and new looks.
3. **Icon depth:** Full 3D iconography — not just gradients/shadows/rounded corners as a "language," but an actual small set of custom glossy 3D icon renders (matching the reference artwork's style) used at specific points: status indicators and empty states.
4. **Surface style:** Dark shell + cream content cards — the app frame (background, sidebar) stays dark blue, but individual content cards (posts, assets, history rows, login card) sit on warm cream surfaces for visual pop, matching the reference image's light UI-on-dark-background composition.

Dillon reviewed and approved a full mockup of the Home page built with all four decisions applied (sidebar, stat cards, cream activity cards) before this spec was written.

## Visual system

### Color tokens (replaces current `:root` block in `public/styles.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a1220` | App shell background |
| `--sidebar-grad-top` | `#0f1b30` | Sidebar gradient start |
| `--sidebar-grad-bottom` | `#0a1220` | Sidebar gradient end |
| `--surface-outline` | `#101d33` | Dark outline cards (stat cards, structural panels, form containers) |
| `--surface-border` | `rgba(59,134,219,0.25)` | Border on dark outline surfaces |
| `--accent` | `#3B86DB` | Primary blue |
| `--accent-dark` | `#2563b0` | Gradient partner for `--accent` (used in `linear-gradient(145deg, var(--accent), var(--accent-dark))`) |
| `--accent-soft` | `rgba(59,134,219,0.15)` | Subtle blue fill (icon chips, inactive badges) |
| `--cream` | `#fdfbf5` | Content card background |
| `--cream-text` | `#14213d` | Primary text on cream |
| `--cream-text-secondary` | `#8a8a7e` | Secondary text on cream |
| `--text-primary` | `rgba(255,255,255,0.93)` | Primary text on dark |
| `--text-secondary` | `rgba(255,255,255,0.55)` | Secondary text on dark |
| `--text-muted` | `rgba(255,255,255,0.35)` | Muted/label text on dark |
| `--radius-lg` | `16px` | Cards (stat cards, content cards) |
| `--radius-md` | `14px` | Nested cards (post/asset blocks) |
| `--radius-sm` | `9px` | Nav items, small controls |
| `--shadow-accent` | `0 12px 28px rgba(59,134,219,0.4)` | Blue gradient elements (buttons, active nav, hero stat card) |
| `--shadow-card` | `0 10px 24px rgba(0,0,0,0.35)` | Cream cards (lift them off the dark background) |

Font stays **Inter** (already loaded); weight usage shifts heavier — 800 for headings/logo, 700 for labels, 600 for nav-active/buttons, 500 for body — to read as bolder/friendlier rather than the current buttoned-down 700/600 max.

### Components

- **Sidebar:** dark gradient background (`--sidebar-grad-top` → `--sidebar-grad-bottom`), `--surface-border`-colored right border. Logo mark becomes a small rounded gradient square (CSS gradient, not an image) next to the "niewdel" wordmark text — **no custom logotype artwork is created as part of this spec** (see Out of Scope). Active nav item: blue gradient pill with `--shadow-accent`. Inactive: transparent, `--text-secondary`, hover lightens.
- **Stat cards (Home):** 4-across grid — Queued, Generating, Approved, Posted (matches the asset status pipeline). The **Queued** card is the "hero" card — blue gradient fill, `--shadow-accent`, white text — since it's the actionable one (things waiting on Dillon). The other three are outline cards — `--surface-outline` background, `--surface-border` border, `--accent`-tinted label. Each stat card has an icon slot (see Icon Set below) in a rounded chip at the top.
- **Content cards** (`.card-cream` — new class, replaces bare `.card` for these use cases): cream background, `--shadow-card`, `--radius-md`. Used for: post/asset list items, history rows, the login form container. Text uses `--cream-text` / `--cream-text-secondary`.
- **Structural cards** (`.card` — kept, restyled): dark `--surface-outline` background, used for form containers (Create/Generate/Clients pages) and any non-content structural grouping. Inputs/textareas/selects stay on dark surfaces for typing comfort — cream is reserved for *content display*, not form inputs.
- **Badges:** pill shape, two variants — filled (`--accent` background, white text, for "Approved"/positive states) and soft (`--accent-soft` background, `--accent-dark` text, for neutral/pending states).
- **Buttons:** `.btn-primary` becomes the blue gradient + `--shadow-accent` treatment. `.btn-secondary`/`.btn-ghost` keep flat dark surfaces, restyled to the new radius/border tokens. `.btn-danger` unchanged in behavior, restyled color to fit palette (keep a clear red — not blue — for destructive actions).
- **Login page:** centered `.card-cream` panel on the dark gradient background, replacing the current flat dark login card.

### Icon set (new — 3D generated assets)

A small set of **7 custom glossy 3D icons**, generated via Higgsfield (`generate_image`, transparent background, prompt matched to the reference artwork's render style — glossy, rounded, blue/cream palette) and stored as PNGs in `public/icons/`:

1. **Queued** — status icon (e.g., stacked squares / hourglass)
2. **Generating** — status icon (e.g., sparkle / paint motion)
3. **Draft** — status icon (e.g., pencil / document)
4. **Approved** — status icon (checkmark, matches reference)
5. **Posted** — status icon (rocket / paper plane)
6. **Empty state — general** — used on Home/Assets/History when a list is empty
7. **Empty state — photos** — used in Create's Drive photo picker when no photos are loaded

Icons are referenced via plain `<img src="/icons/{name}.png">` — static filenames, not user input, so the existing `safeUrl()` requirement (for user-controlled URLs) doesn't apply here, but `esc()` is still used for any surrounding dynamic text.

No icons are generated for page headers or purely decorative use — the set is scoped to functional status/empty-state moments to keep this pass bounded. Additional decorative icons are an easy follow-up once this set is validated in place.

## Build approach

**Single-pass token rewrite**, not page-by-page. Rationale: the app is small (256-line `styles.css`, 6 page fragments, no build step, no framework) and every page shares the same component classes. One coherent rewrite of `styles.css` (new tokens + new component styles) followed by a sweep of the 6 HTML fragments for markup changes (wrapping content items in `.card-cream`, adding icon `<img>` slots to stat cards/empty states) is less risky than 6 separate mini-redesigns that could drift from each other. Dillon confirmed this approach.

Sequence:
1. Rewrite `public/styles.css` with new tokens and component styles (keep existing class names where the component's *role* is unchanged — e.g. `.btn-primary`, `.badge` — add new classes only where a new visual role is introduced, e.g. `.card-cream`).
2. Generate the 7 icons via Higgsfield, save to `public/icons/`.
3. Sweep each page fragment (`public/pages/*.html`, `public/login.html`) and `public/index.html` (sidebar) for markup changes: swap `.card` → `.card-cream` where content is displayed, add icon slots to stat cards and empty states.
4. Manual visual QA pass across all 6 pages + login (screenshot each, compare to approved Home mockup for consistency).
5. Run `npm test` — all 50 tests must still pass unchanged (this is a presentational change; no route, schema, or behavior changes).

## Non-functional constraints (carried over from existing app conventions)

- Page fragments have no `<html>/<head>` wrapper and use no module syntax (loaded via `new Function` by `public/app.js`) — unchanged by this spec, just noting it constrains how new markup is added.
- All user-rendered strings continue to go through `esc()`; user-controlled URLs continue to go through `safeUrl()`. This redesign doesn't add any new user-controlled rendering paths, so no new escaping surface — existing call sites just get restyled.
- Commit style: `feat:` / `fix:` prefixes (this work is a `feat:`).

## Out of scope

- **Custom wordmark/logotype artwork.** The reference image's outlined "niewdel" logotype is a separate brand-asset creation task, not part of this redesign. The sidebar keeps a plain text wordmark, restyled (bold, tight tracking) but not recreated as custom lettering.
- **Phase B (in-app generation), Google Drive OAuth setup, deploy to Railway.** Unrelated to this visual pass — see `HANDOFF-CURSOR.md` remaining roadmap.
- **Minor UX polish list** from the handoff (delete toast, filter debounce, fetch error handling, stale breadcrumbs) — not visual, tracked separately.
- **Decorative-only icons** beyond the 7 functional ones listed above.

## Testing

No new automated tests needed — this is a presentational-only change with no new logic branches. Existing 50 tests are the regression guard (`npm test`) and must pass unchanged after the rewrite. Manual visual QA (screenshot each of the 6 pages + login) is the acceptance check for the design itself.

## Open question for Dillon

This work will happen on top of `feature/aios-phase-a` (already 15 commits, unmerged, unpushed per the handoff). Continue committing directly to that branch, or cut a new branch off it (e.g. `feature/visual-redesign`) to keep the redesign reviewable separately from the Phase A functional work? Recommendation: **new branch off `feature/aios-phase-a`**, since the two are logically separate changes (one functional, one presentational) and Dillon may want to merge/review them independently.
