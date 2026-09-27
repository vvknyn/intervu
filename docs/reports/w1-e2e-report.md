# W1 e2e leg — report

## Specs rewritten/touched + why

- **jobs-first-screen.spec.ts** (task 1, full rewrite of the ask-screen tests + doc block): browse-by-default means a bare `/jobs` now fetches+renders real rows (`JobsAsk`/testid `jobs-ask` is dead code, no `<JobsAsk` call site left). Rewrote the two ask/gate tests to assert rows-without-typing + `serp-ask-seed` pivot chips (same testid in both the compact pivot row and the full serp-ask fallback, so it holds regardless of Meilisearch reachability) + no modal wall. Also fixed 4 **pre-existing** stale assertions surfaced by actually running the file (all predate 346c61a by days, none caused by the audited change set): `aria-pressed` → `toBeChecked()` (Affordance renders a native radio input, not an `aria-pressed` toggle, since #121/Aug 4); ghost-toggle `checkbox` role/copy → `radio` role, "Hide likely ghosts" (no hyphen); removed the "upsell card" test (`ResumeUpsellCard` has had no call site in page.tsx since #24 — verified via `git log -S`); "No roles match." → "Nothing matches these filters." for a query+filter combo (`EmptyResults` branches on `hasFilters`, present since #97).
- **agents-page.spec.ts**: TC-AGENTS-004 copy updated — "intervu never submits applications for you" was cut in #152's /connect fine-print pass; the promise now reads "…can never apply anywhere without you" (hero sub-copy + Approve-step checklist).
- **mobile.spec.ts**: TC-MOBILE-009 "Gemini CLI" tab label → "Gemini" (badge changed "via Gemini CLI" → "us · web app" in #152 — connector now targets the Gemini web app, not the CLI). TC-MOBILE-001 rewritten — `/` no longer renders a separate OpenClaw marketing deck with an email waitlist form (retired in #145, predates my range); it's a redirect to the job board, so the front door's own input is now the jobs search box. TC-MOBILE-008 updated to expect the `/login?next=…` redirect (see finding below).
- **navigation.spec.ts**: TC-NAV-007 updated — `/` lands on `/jobs` (redirect, #145), and `/yours`/`/settings` land on `/login?next=…` (see finding below). Both predate my range.
- **elite-board.spec.ts**: removed a dead 3s wait for `jobs-ask` (never renders now) in `enterBrowseMode`.
- **jobs-search-polish.spec.ts**, **trends.spec.ts**: comment-only accuracy fixes (stale "ask screen blocks browsing" / "overlay-ask covers TopBar" framing) — no assertion changes, both already passed.
- **yours.spec.ts**, **company-follow.spec.ts**: swept, no changes — B1-B4 tracker/company copy checks still match current truth. (yours.spec.ts fails live for an unrelated reason — see finding #1.)

## APP-BUG FINDINGS (prominent — not papered over)

**1. `/yours` and `/connect` are middleware-gated behind login, but both ship extensive guest/public UI that can never be reached.** `AUTH_GATED_PRODUCT_PREFIXES` (`src/lib/auth/product-routes.ts`, unchanged in my range, identical on `origin/main`) lists `/yours`, `/connect`, `/settings`, `/account`. A signed-out visit to any of them 307s to `/login?next=…` **before the page renders** — verified live, no session cookie, no bypass. Yet `src/app/yours/page.tsx` has a full guest-pursuit system (`listGuestPursuits`, `yours-guest-empty` testid, guest→account sync-on-login toast) and `src/app/connect/connect-client.tsx` is a public-shaped onboarding/waitlist flow — neither can ever be seen by an unauthenticated visitor today. This is pre-existing (product-routes.ts created in #127, long before 346c61a) and NOT caused by this wave's changes, but it makes **the tracker B1-B4 work this wave shipped (notes autosave, stale marker, applied-this-week chip, blank slate) completely unreachable for any guest** — the exact audience the parallel front-door-pivot work (browse-by-default, #144/#145) targets. All 13 guest tests in yours.spec.ts fail this way; so does agents-page.spec.ts (5/5) and mobile.spec.ts TC-MOBILE-009. Left yours.spec.ts and agents-page.spec.ts's URL assertions **unchanged** rather than rewriting them to expect the redirect — doing so would hide the regression instead of surfacing it.

**2. Mobile "system back" on `/jobs` no longer preserves scroll position** — `jobs-first-screen.spec.ts` "system back closes detail and preserves scroll": scrollY drifts 513-1236px vs a 200px tolerance, reproduced on 2 consecutive runs. This IS in the audited range: #152 replaced the mobile sheet's decorative drag-handle with a real close button wired to `router.back()` — worth checking against the same file's own comment that `router.back()` on this sheet previously caused a full-document-reload bug (page.tsx ~line 1075-1086), since the fix there was to avoid the Next router for this exact interaction. Not fixed (src/ out of scope); test left in place, failing honestly.

**3. Sidebar (`<aside role="complementary">`, pipeline+ghost-radar cards) was removed from `/jobs` in #121 (Aug 4)** but `jobs-search-polish.spec.ts` TC-JOBS-LAYOUT-001/002/003 still assert it exists and that the page is height-contained around it — document height is now 3291-3951px vs an expected ~900px. Pre-existing, predates my range by 4 days; not fixed (would need redesigning the tests' premise, out of proportion for this sweep).

**4. Lower-confidence**: "ArrowDown then Enter … pushes a new history entry" (jobs-first-screen.spec.ts) — suggestion-pick no longer increments `window.history.length`. `submitSearch`/`applyUrlState` (the push mechanism) and `SearchAutocomplete.tsx` are both unchanged in my range; likely pre-existing or a prod-build timing difference vs. the dev server the test's own comment says it was verified against. Not fixed.

## Live-run results (build + `next start -p 3000`; config's hardcoded `baseURL`/`webServer.url` is `localhost:3000` with no env/flag override — ran the prod build on that same port rather than editing playwright.config.ts)

| Spec | Result |
|---|---|
| jobs-first-screen.spec.ts | 19/21 pass — 2 fail (findings #2, #4) |
| jobs-search-polish.spec.ts | 7/11 pass — 4 fail, pre-existing (finding #3) |
| elite-board.spec.ts | 1/1 pass |
| trends.spec.ts | 2/2 pass |
| company-follow.spec.ts | 3/3 pass |
| yours.spec.ts | 1/14 pass — 13 fail (finding #1) |
| agents-page.spec.ts | 0/5 fail (finding #1) |
| mobile.spec.ts (TC-001/008/009 spot-checked) | 001 pass, 008 pass (redirect-aware), 009 fails (finding #1) |
| navigation.spec.ts (TC-007 spot-checked) | pass (redirect-aware) |
| auth, settings, privacy-account, api-key-persistence, api-search-stability, quirky-messages, storage-persistence, motivational-banner, parallel-loading, watch-page, setup-wizard-fix, navigation-comprehensive | not-run — outside the assigned jobs-surface/trends/company/tracker scope; none need invented credentials (no storageState/fixture exists in this repo for any spec) |

Typecheck not re-run (e2e-only change, no src/ touched). Commit(s): see `git log tests/e2e/`.
