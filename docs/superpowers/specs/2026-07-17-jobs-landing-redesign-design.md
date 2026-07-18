# Jobs Portal Redesign — Phase 1: The First Screen

**Date:** 2026-07-17
**Status:** Approved section-by-section by Vivek (visual companion session; mockups in `.superpowers/brainstorm/69995-1784323841/content/`)
**Scope:** The `/jobs` first screen (desktop + mobile) and its functional foundation. This is phase 1 of a multi-phase portal redesign; phase 2 (filter/results deep-dive) and later phases build on it.

## Problem

The portal feels broken: not intuitive, filter-poor, sorting unclear. The structural root (mapped during design exploration):

- Every fresh visitor hits a full-screen résumé gate before seeing a single job (`src/components/jobs/JobsEntryGate.tsx`); the browse bypass is a small text link.
- Nothing lives in the URL — no query, filters, sort, or selected job. Back/refresh/share/bookmark all fight the app (`src/app/jobs/page.tsx` mode state machine: loading → ask/choose → match/explore/search/browse).
- A `SearchAutocomplete` component exists but was never wired up; search is a bare input.
- The filter rail is hidden behind a "Filters" button below 1280px.

## Decisions (locked with Vivek)

1. **Portal goal:** hybrid, jobs-first — a genuinely good job-search experience with prep as the woven-in next step.
2. **Phase 1 surface:** the `/jobs` first screen (not a separate marketing page).
3. **Résumé gate:** demoted to an inline, dismissible upsell. Browsing is never blocked.
4. **Identity:** lead with trust/verification ("real, live jobs — ghost postings flagged"), expressed through working controls, not hero copy.
5. **Layout approach:** "The Pure Tool" (option B of three mocked) — no hero, one slim toolbar, rows from pixel one. Trust lives in row badges, the ghost filter, and the live corpus count in the search placeholder.

## Section 1 · Desktop layout (mockup: `layout-section1.html`)

Top to bottom on first paint, anonymous visitor, nothing typed:

- **Site chrome** (existing intervu header, Jobs tab active).
- **Toolbar:** search input with typeahead (placeholder carries the real live-role count, e.g. "Search 38,412 live-checked roles…"); sort select; "updated X min ago" freshness stamp (real last-sync time).
- **Three columns:** filter rail (left, always visible on desktop, threshold moves from 1280px to ~1024px) · results list (center, newest first, infinite scroll) · job detail panel (right, opens on row click).
- **Filter rail:** promoted facets on top — Posted, Work type, Salary (listed), Posting health — each with live counts; Experience/Employment/Visa/Country collapsed under "More".
- **Posting health:** "Hide likely-ghost" ships ON by default and shows the count it is hiding (e.g. "−1,911").
- **Row anatomy:** title · badge (`✓ live 2h ago` / `⚠ 41 days open` / `✕ likely ghost`; unscored shows nothing) · company · location/work type · salary if listed · posted age.
- **Résumé upsell:** one dismissible dashed card after the first row ("Upload your résumé to rank all N roles by fit — free"). Dismiss persists via localStorage; a quiet "Rank by fit" option remains in the sort menu.
- **Job detail:** title, company, badge with last-checked time, **Apply ↗** (external, no auth) + **Prep for this interview** (→ intervu prep, pre-loaded with the job — the hybrid funnel handoff), description.

## Section 2 · Functional foundation

### The URL is the state

| Param | Meaning |
|---|---|
| `q` | search query |
| `work`, `exp`, `emp`, `country`, `visa` | facet filters, comma-separated |
| `posted` | date bucket (24h/3d/7d/30d) |
| `salary` | minimum listed salary (preset tiers: `50k`/`100k`/`150k`/`200k`) |
| `ghosts` | ghost visibility (default hidden; `show` to reveal) |
| `sort` | explicit sort override (`newest` / `relevance` = query best-match / `salary` / `fit` = résumé rank, requires résumé) |
| `job` | selected job id → detail open |

- Filter/sort tweaks → `replaceState`; search submit and job open → `pushState` (Back closes detail, then unwinds searches — never unwinds checkbox clicks).
- Defaults stay out of the URL. The page is fully reconstructible from any URL: refresh, bookmark, share all reproduce the exact screen.

### Mode machine collapses

- Delete `JobsEntryGate` (ask/choose screens); ignore + clean up the `intervu.jobs.entry` localStorage key.
- **Match** becomes the "Rank by fit" sort option: no résumé → opens upload flow, then re-sorts in place.
- **Explore** (1-credit AI search) survives as a secondary affordance beside the search box, not an entry fork.
- Search/browse merge into the one board; empty query = newest-first everything.
- Auth stays action-level exactly as today (tailor/explore/mark-applied/upload prompt login; browse + external apply never do).

### Typeahead

Wire the existing `SearchAutocomplete` component to the search box: title + company suggestions, Enter searches without reload. Per-suggestion live counts only if the index serves prefix counts cheaply (verify in implementation plan); degrade gracefully to plain suggestions.

### Honesty dependency (hard prerequisite)

The freshness stamp and per-row "checked live" badges expose data freshness directly. The jobs-sync on the box has known reliability problems (disabled timer, failing reconciles — prior-session finding, unverified this session). **Sync repair is a ship prerequisite for this phase**, itemized in the implementation plan. The stamp always reads real last-sync time; past a staleness threshold it turns amber (threshold set in the implementation plan relative to the repaired sync cadence). Never fake freshness.

## Section 3 · Mobile (mockup: `mobile-section3.html`)

- **First paint:** search, then a horizontal chip row — Posted, Remote, Salary as one-tap chips + "All (n)" opening the full filter sheet with active-filter count. Result count + sort in a slim line above the rows.
- **Filter sheet:** bottom sheet mirroring the rail; the apply button is a live count ("Show 4,112 roles") that recomputes as toggles change — never filter blind into an empty screen.
- **Job detail:** a pushed URL, not a modal. System back gesture returns to the list with scroll position intact. Apply/Prep in a sticky bottom bar.
- **Parity rule:** the sheet and the rail are two renderings of one filter model driven by the same URL params. Nothing mobile-only or desktop-only.

## Section 4 · Edge cases, errors, testing

### States

- **Zero results:** each active filter becomes a one-tap "clear" chip; if the ghost filter is hiding results, say so explicitly ("12 roles hidden as likely-ghost — show them").
- **Dead deep-link** (`?job=` gone): honest tombstone — "This role is no longer live" (+ "came down N days ago" when known) with similar live roles below.
- **Stale index:** amber freshness stamp past threshold; never lie, never hide.
- **Search backend down:** error band with retry; no fake results.
- **Junk URL params:** ignored gracefully, cleaned on next state write.
- **Housekeeping:** migrate out `intervu.jobs.entry`; single upsell-dismissed key shared by desktop and mobile.

### Tests

1. **Unit:** URL serialization round-trip (state → URL → state identity; defaults omitted), sort auto-switch rules (query → relevance; cleared → newest; explicit override wins).
2. **Component:** one filter-model suite asserted against both renderings (rail + sheet) — parity enforced by CI.
3. **E2E (Playwright):** anonymous first paint shows rows, no gate; deep-link reconstructs exact screen; Back closes detail + restores scroll; sheet live count matches applied results; upsell dismissal survives reload. Logged-in-variant test account: settle in implementation plan (current intervu test users unverified).

## Out of scope (deferred deliberately)

- SSR/SEO for job pages (URL-addressability now makes this a clean later phase).
- Filter *content* redesign beyond promotion/ordering — that is phase 2 (filters & results deep-dive).
- Job-detail page redesign beyond the panel described here — later phase.
- Any change to the sync pipeline beyond "make it reliable" (it lives on the box, not in this repo).

## Mockup references

Visual-companion session files (gitignored, local): `.superpowers/brainstorm/69995-1784323841/content/` — `approaches.html` (A/B/C comparison), `layout-section1.html` (desktop), `mobile-section3.html` (mobile). Placeholder numbers in mockups (38,412 etc.) are illustrative; production reads real index counts.
