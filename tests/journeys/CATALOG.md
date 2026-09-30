# User-journey catalog

The single list of user journeys velai must keep working. Each row is one journey; a covered row is guarded by a tagged Playwright spec in `tests/e2e/journeys/`.

## Run

```
npm run test:journeys:prod    # against https://velai.app — run after every deploy and before calling a user-facing fix done
npm run test:journeys         # against PLAYWRIGHT_BASE_URL, or a local dev server on :3000
```

Both print `journeys: N total, C covered, U uncovered, K known-bug`, then pass/fail per journey on a desktop (1440x900) and a mobile (390x844) project. Reports land in the gitignored `journeys-report/`.

## Contract

- **ID**: `J-<AREA>-NN` (e.g. `J-JOBS-03`), unique. One table per area, below.
- **Tag**: the spec test carries `{ tag: ['@J-JOBS-03'] }`. A `@writes` tag is added when the journey writes to prod data.
- **Read-only by default**: `@writes` tests are skipped unless `JOURNEYS_ALLOW_WRITES=1`. A row with `Writes = yes` must have its test tagged `@writes`.
- **Status**: `covered` (tagged spec exists and passes), `uncovered` (listed, no spec yet; Spec = `—`), `known-bug` (spec exists, wrapped in `test.fail()` with a reason naming the bug, so the suite stays green while the guard exists).
- **Auth / Writes cells**: Auth is `signed-out` or `signed-in`. Writes is `yes` when the journey writes prod data or sends email (DB row, email), `no` otherwise (including localStorage-only).
- **Legacy specs**: an `uncovered` row whose Spec reads `— (legacy: file › test)` names an older spec in `tests/e2e/` that touches the journey but is not tagged, is not run by the journey suite, and is stale, skipped or vacuous. It does not make the row covered. Rewrite it into `tests/e2e/journeys/` with a tag, then flip the row.
- **Fixtures**: import `test`/`expect` from `tests/e2e/journeys/fixtures.ts`. Analytics and `/api/telemetry` requests are aborted; console errors, page errors and same-origin 5xx responses are collected as `diagnostics` for a spec to assert.
- **Lint**: `bash scripts/run-unit-tests.sh` (file `tests/unit/journey-catalog.test.ts`, node:test) fails on a tag with no row, a duplicate ID, a covered/known-bug row with no tagged spec, an uncovered row that has one, or a Writes=yes row whose test lacks `@writes`.

## Add a journey

1. Add a row to the area table (new area = new table). Start it `uncovered` if you are not writing the spec now.
2. Add the test to `tests/e2e/journeys/<area>.spec.ts` with the `@J-…` tag, then set the row to `covered` and fill Spec.
3. Run `npm run test:journeys:prod`.

## Coverage gate

A push or PR whose range changes a user-facing file (non-test files under `src/app/`, `src/components/`, `src/actions/`) is blocked unless the same range also changes a spec under `tests/e2e/journeys/`. A catalog row alone does not pass. For a change that cannot alter any journey (pure refactor, styling), add a commit trailer instead:

```
Journey-Impact: none — <reason, at least 15 characters>
```

Enforced by `scripts/check-journey-coverage.mjs` at three points: the Claude Code PreToolUse hook (`git push` / `gh pr create`), the git `pre-push` hook (`.githooks/`, enabled by `npm install`), and `npm run preflight`.

## JOBS

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-JOBS-01 | Land on /jobs first visit and see the search box and at least 5 job rows within 5s, one visible h1, no poster | anon | `/jobs` (no seed) | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-03 | Seeded anon visit renders result rows on first paint with no dialog | anon | SEED-A + `/jobs?posted=any` | signed-out | no | uncovered | — |
| J-JOBS-04 | Result count line states the 30-day window | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-JOBS-05 | Load more rows by scrolling the list sentinel (20 per page) | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-JOBS-06 | Hit the anonymous depth wall after 90 results: it states the true hidden count ("See the other N roles that match") and offers Create free account, with no dismiss | anon | SEED-A + `/jobs?q=engineer` then page to the end with "Show N more" | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-07 | Depth-wall "Create free account" and "Sign in" links carry the current URL in `next=` | anon | SEED-A + `/jobs?q=software+engineer` at the wall | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-08 | Signed-in user is not depth-walled past 90 results | signed-in | `/jobs?q=software+engineer` then scroll past 90 | signed-in | no | uncovered | — |
| J-JOBS-09 | Open a row at xl and see it in the split-view detail pane with `?job=` | anon | SEED-A + viewport 1440x900 + `/jobs?q=software+engineer` | signed-out | yes | uncovered | — (legacy: jobs-split-view.spec.ts › (b) clicking a row shows that job in the pane; list stays visible; URL carries ?job=) |
| J-JOBS-10 | First-job auto-preview fills the detail pane without touching the URL | anon | SEED-A + viewport 1440x900 + `/jobs?q=software+engineer` | signed-out | no | uncovered | — (legacy: jobs-split-view.spec.ts › (a) renders the list AND an auto-previewed first job in the pane, no sheet, no ?job=) |
| J-JOBS-11 | Close the detail pane and return to the ambient preview with `?job=` cleared | anon | SEED-A + viewport 1440x900 + `/jobs?q=software+engineer&job=<id>` | signed-out | no | uncovered | — (legacy: jobs-split-view.spec.ts › (c) pane close (×) returns to the ambient first-job preview and clears ?job=) |
| J-JOBS-12 | Deep link with `?job=` below xl opens the bottom sheet, not the pane | anon | SEED-A + viewport 800x900 + `/jobs?q=software+engineer&job=<id>` | signed-out | no | uncovered | — (legacy: jobs-split-view.spec.ts › (d) a job deep link renders the sheet, not the pane) |
| J-JOBS-13 | Browser back after opening a job closes the detail and keeps the list | anon | SEED-A + `/jobs?q=software+engineer` then click a row then `page.goBack()` | signed-out | yes | uncovered | — (legacy: jobs-first-screen.spec.ts › opening a job pushes a URL; back closes the detail) |
| J-JOBS-14 | Reload a filtered, sorted deep link and get the same result state | anon | SEED-A + `/jobs?q=software+engineer&work=remote&sort=salary&posted=7d` then `page.reload()` | signed-out | no | uncovered | — (legacy: jobs-first-screen.spec.ts › refresh reproduces the same results state) |
| J-JOBS-15 | Zero-result query shows the empty state with a way out | anon | SEED-A + `/jobs?q=zzqxvjkwplm` | signed-out | no | uncovered | — |
| J-JOBS-16 | Zero results caused by filters says "Nothing matches these filters." | anon | SEED-A + `/jobs?q=zzqxvjkwplm&work=remote&salary=200k` | signed-out | no | uncovered | — |
| J-JOBS-17 | Slow search keeps the page responsive and shows "Loading more roles…" on page 2 | anon | SEED-A + `/jobs?q=software+engineer` with `page.route` delaying POSTs 3 s after first paint | signed-out | no | uncovered | — (legacy: jobs-search-polish.spec.ts › TC-JOBS-REFRESH-001: refetch keeps current results visible and shows in-flight feedback) |
| J-JOBS-18 | Change sort to Top pay and see `sort=salary` in the URL without a new history entry | anon | SEED-A + `/jobs?q=software+engineer`, click `jobs-sort-trigger` then `jobs-sort-salary` | signed-out | no | uncovered | — (legacy: jobs-search-polish.spec.ts › TC-JOBS-SORT-001: sort segments offer freshest / top pay / relevance when configured) |
| J-JOBS-19 | Toggle the home view between For you and Search from the docked toggle | signed-in | `/jobs` at 1440x900 with a résumé on file, click `For you` / `Search` in the `For you or Search` group | signed-in | no | uncovered | — (legacy: for-you-deck.spec.ts › TC-DECK-002: toggling Search -> For-you keeps the same job active) |
| J-JOBS-20 | "Back to Job Packs" from a searched state resets to the For-you hub | signed-in | `/jobs?view=search&q=nurse` with a résumé on file, click `jobs-back-to-packs` | signed-in | no | uncovered | — |
| J-JOBS-21 | Board visit banner is absent on a first-ever visit | anon | SEED-A + `/jobs?board=elite` | signed-out | no | uncovered | — (legacy: jobs-visit-banner-and-saved-search.spec.ts › banner is absent on a first-ever /jobs visit) |
| J-JOBS-22 | Guest save-search banner offers sign-in after a guest saves a search | anon | SEED-A + `/jobs?q=software+engineer`, save the search | signed-out | no | uncovered | — (legacy: jobs-visit-banner-and-saved-search.spec.ts › saving a search adds it to the saved-search list) |
| J-JOBS-23 | Click a job row title and the job detail opens (`?job=`, detail pane at desktop, sheet at mobile); fresh and previous-session visitor | anon | `/jobs` (no seed; second run with the `sb_jobs_visitor` cookie), click `job-title` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-24 | Click Sign in or Get started and the board is still visible 2s later; fresh and previous-session visitor | anon | `/jobs` (no seed; second run with the `sb_jobs_visitor` cookie), click the Sign in control | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-25 | List analytics fire: `results_impressed` on first render, `search_submitted` on a search (needs a build with NEXT_PUBLIC_POSTHOG_KEY, skips otherwise) | anon | `/jobs`, then fill the search box and press Enter, `/api/telemetry` fulfilled locally | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-26 | Job cards and the job page show location labels with no repeated adjacent word (e.g. "RemoteRemote Location, All States · Remote") | anon | onboarding-completed flag + search "remote", then the first row's `/jobs/<slug>` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-27 | A For-you pack opened from the packs hub (after dismissing the first-visit intro, which must then not block the pack controls): its Edit filters opens the search board on exactly the pack's filters; a thin pack offers the broaden options with counts | Candidate with a local résumé | `/jobs?view=for-you` (guest résumé seeded in localStorage), Got it on the intro, click `hub-pack-card-all` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-28 | A board search with zero results offers the same broaden options with counts, and applying one loads rows | anon | `/jobs?view=search&q=engineer&country=Iceland&exp=entry&posted=1d` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-29 | The /jobs search row (query, location, Search) shares the lg control step (44px) at 1440 and 390 | anon | onboarding-completed flag + `/jobs` | signed-out | no | covered | control-scale.spec.ts |
| J-JOBS-30 | Every control in the /jobs toolbar row takes the md control step (32px) at 1440 and 390 | anon | onboarding-completed flag + `/jobs` | signed-out | no | covered | control-scale.spec.ts |
| J-JOBS-31 | A failed For-you ranked-list read (every Server Action answers 503) shows an error with Retry, never "No ranked roles to show right now."; Retry re-reads | Candidate with a local résumé | `/jobs?view=for-you` (guest résumé seeded in localStorage), click `hub-pack-card-all`, action POSTs fulfilled 503 in the browser | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-32 | A guest whose second save is a saved search meets the "Save this search" gate (Create free account + Sign in), not a bare input | anon | `intervu.guestSaveCount=1` seeded + `/jobs?q=engineer`, click `save-search-trigger` | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-33 | A guest's first job save shows the dismissible save gate card; "Not now" removes it | anon | `/jobs?q=engineer`, click `job-save-trigger` on the first row | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-34 | A guest with a résumé (no local-AI flag) sees exactly their top 3 ranked matches on the Search list, then the "See all N matches ranked for you" gate | anon | a synthetic local résumé seeded + `/jobs?view=search&sort=fit` | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-35 | A guest with a résumé who opens "Browse all matches" on For you meets the same top 3 + fit gate (the deck never lists past the gate) | anon | a synthetic local résumé seeded + `/jobs?sort=fit`, click `hub-browse-all-matches` | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-36 | First-run guest upload, two résumés (Toronto analyst, Austin engineer): review shows each one's job title and location, "Rank my jobs" applies its country, then top 3 + fit gate | anon | `/jobs` fresh, "Upload résumé" with an in-memory .txt, skip download, parse, "Rank my jobs", `hub-browse-all-matches` | signed-out | no | covered | signup-gates.spec.ts |
| J-JOBS-37 | A For-you pack in a country with no roles for it shows "No roles in <country> yet." (the search drops the place) or "No matching roles in <country> yet." (the corpus has roles there, none the pack's) and the broaden options, never a deck of roles from other countries nor the generic "No ranked roles" state | Candidate with a local résumé | `/jobs?view=for-you` (guest résumé in Funafuti, Tuvalu seeded in localStorage), click `hub-pack-card-all` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-38 | A pack tile opens the résumé's pack with the tile's own filter (Fully remote → remote work type; Added this week → 7-day window), Edit filters carries it, and the next tile opened does not inherit it | Candidate with a local résumé | `/jobs?view=for-you` (Toronto guest résumé seeded in localStorage), click `hub-pack-card-remote`, back, `hub-pack-card-fresh` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-39 | An opened pack tile lists only its own roles from the first row it shows (every Fully remote row reads Remote before and after its search settles), and a row tile the hub counted (AI roles) opens on those roles behind the guest preview | Candidate with a local résumé | `/jobs?view=for-you` (Toronto guest résumé seeded in localStorage), click `hub-pack-card-remote`, back, read `hub-pack-count-ai`, click `hub-pack-card-ai` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-40 | Going back to the packs hub from an opened tile keeps the tile counts it had (Fully remote, Added this week, Jobs with salaries), never blanking them to "…" while it counts again | Candidate with a local résumé | `/jobs?view=for-you` (Toronto guest résumé seeded in localStorage), wait for `hub-pack-count-*`, click `hub-pack-card-remote`, back, sample the counts | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-41 | A pack opened after another pack loaded, whose own read fails, shows the load error with Retry (not its loading state, not the other pack's roles), and Retry lists its roles once reads answer again | Candidate with a local résumé | `/jobs?view=for-you` (Toronto guest résumé seeded in localStorage), open `hub-pack-card-remote`, back, fail every server action, open `hub-pack-card-salary`, Retry | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-42 | Signed in, the packs hub lists the tracker (applied roles first, with stage counts) and the last 20 roles opened under the pack tiles; a row opened in a pack leads Recently viewed on the way back | signed-in | `/jobs?view=for-you` with tracked roles, open a pack, click a row, `jobs-back-to-packs`, read `hub-tracker-row` and `hub-recent-row` | signed-in | no | uncovered | — |
| J-JOBS-46 | Signed out, the packs hub shows placeholders for the tracker and Recently viewed under the pack tiles and one sign-in gate that returns to the hub | Candidate with a local résumé | `/jobs?view=for-you` (Toronto guest résumé seeded in localStorage), read `hub-your-jobs`, `hub-tracker-placeholder`, `hub-recent-placeholder` and its `signup-gate` | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-52 | During a search outage a pack shows the load error with Retry, never "No roles in <country> yet." nor the cached newest-jobs list as its roles (it used to list the newest roles site-wide, all Stretch, and the fit gate counted the whole corpus); Retry lists the pack's own roles once search is back. The server half (a query or filter never gets the default-browse fallback) is unit-tested in jobs-search-cache.test.ts, since a browser spec cannot fail the server's Meilisearch | Candidate with a local résumé | `/jobs?view=for-you` (Toronto résumé seeded in localStorage), the pack's own search answered in the browser with the outage result (`unavailable`, place reported unmatched), click `hub-pack-card-all`, Retry | signed-out | no | covered | jobs.spec.ts |

## SRCH

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-SRCH-01 | Search box placeholder reads "Job title, skill, or company" | anon | SEED-A + `/jobs` | signed-out | no | uncovered | — (legacy: jobs-first-screen.spec.ts › placeholder names what to search by) |
| J-SRCH-02 | Placeholder fits its input at 360, 390 and desktop widths | anon | SEED-A + `/jobs` at each width | signed-out | no | uncovered | — (legacy: search-placeholder-fits.spec.ts › placeholder does not exceed the query input's usable width at 390px) |
| J-SRCH-03 | Type a query and submit it to put `q=` in the URL and get job rows | anon | SEED-A + `/jobs`, fill the `Search` combobox, press Enter | signed-out | no | covered | jobs.spec.ts |
| J-SRCH-04 | Typing shows suggestions from /api/jobs/suggest | anon | SEED-A + `/jobs`, type "soft" | signed-out | no | uncovered | — |
| J-SRCH-05 | Choosing a suggestion runs that search | anon | SEED-A + `/jobs`, type "soft", click first `role=option` | signed-out | no | uncovered | — |
| J-SRCH-06 | Clear button empties the query and sits above the input | anon | SEED-A + `/jobs?posted=any`, fill "engineer", click `search-input-clear` | signed-out | no | uncovered | — (legacy: search-clear.spec.ts › desktop: the clear button sits above the input and actually clears it) |
| J-SRCH-07 | Clearing the query removes `q=` and resets a relevance sort | anon | SEED-A + `/jobs?q=nurse&sort=relevance`, click `search-input-clear` | signed-out | no | uncovered | — (legacy: jobs-search-polish.spec.ts › TC-JOBS-SORT-002: clearing query resets relevance sort to freshest) |
| J-SRCH-08 | Location box suggests places from /api/jobs/locations | anon | SEED-A + `/jobs`, type "Lond" into the `location-input` combobox | signed-out | no | uncovered | — (legacy: jobs-location-search-click.spec.ts (see note)) |
| J-SRCH-09 | Picking a location suggestion filters and shows a location chip | anon | SEED-A + `/jobs?q=engineer`, type "Boston", click first `role=option` | signed-out | no | uncovered | — (legacy: jobs-location-work-mode.spec.ts (see note)) |
| J-SRCH-10 | Location clear button removes the place | anon | SEED-A + `/jobs?q=engineer&city=Boston`, click `location-input-clear` | signed-out | no | uncovered | — |
| J-SRCH-11 | Suggest API returns empty JSON for an empty query | agent | `GET /api/jobs/suggest` and `GET /api/jobs/suggest?q=` | signed-out | no | uncovered | — |
| J-SRCH-12 | Suggest API returns titles and companies for a real query | agent | `GET /api/jobs/suggest?q=engineer` | signed-out | no | uncovered | — |
| J-SRCH-13 | Locations API returns grouped suggestions and empty for no query | agent | `GET /api/jobs/locations?q=lond` and `?q=` | signed-out | no | uncovered | — |
| J-SRCH-14 | Search APIs answer 429 with an empty body shape when rate-limited | agent | 100+ rapid `GET /api/jobs/suggest?q=a` from one IP | signed-out | no | uncovered | — |
| J-SRCH-15 | Company-named query keeps the employer, not the city | anon | SEED-A + `/jobs?q=cleveland+clinic` | signed-out | no | uncovered | — (legacy: search-quality-s1.spec.ts › 'cleveland clinic' — the employer wins; Cleveland the CITY never eats the query as a bare location filter) |
| J-SRCH-16 | Role-in-place query still applies the place filter | anon | SEED-A + `/jobs?q=warehouse+jobs+in+dallas` | signed-out | no | uncovered | — (legacy: search-quality-s1.spec.ts › control: 'warehouse jobs in dallas' — Dallas place filter STILL applies (no company named that)) |
| J-SRCH-17 | Query text and place survive a reload and back/forward | anon | SEED-A + `/jobs`, search "nurse", then search "designer", `goBack()` | signed-out | no | uncovered | — |
| J-SRCH-18 | `/` redirects to `/jobs` and keeps query params | anon | `GET /?q=nurse` | signed-out | no | uncovered | — |
| J-SRCH-19 | Search box is docked into the top bar on lg+ once results show | anon | SEED-A + `/jobs?q=nurse` at 1440x900 | signed-out | no | uncovered | — (legacy: jobs-serp-scroll-stability.spec.ts › TC-SERP-SCROLL-002: the same holds with places filtered — the dock renders a place) |
| J-SRCH-20 | Search shows only the mobile "Search" CTA when the draft differs from the query | anon | SEED-A + `/jobs` at 390x844, type "nurse" | signed-out | no | uncovered | — |
| J-SRCH-21 | Returning visitor's search session throws no uncaught page errors (React hydration error #418 seen on prod 2026-09-28) | anon | SEED-A + `/jobs?q=engineer` | signed-out | no | covered | jobs.spec.ts |

## FILT

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-FILT-01 | Open the All filters panel and see every group | anon | SEED-A + `/jobs?q=software+engineer` at 1440x900, click `filters-toggle` | signed-out | no | uncovered | — (legacy: jobs-first-screen.spec.ts › All filters sheet reflects the 30d posted-date default when supported) |
| J-FILT-02 | Posted date defaults to Last 30 days with no `posted` param | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — (legacy: jobs-first-screen.spec.ts › All filters sheet reflects the 30d posted-date default when supported) |
| J-FILT-03 | Pick "Last 24h" and see `posted=1d` in the URL | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-04 | Pick "Any date" and see `posted=any` (not omitted) | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-05 | Toggle Work mode Remote via the facet chip and see `work=` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — (legacy: jobs-location-work-mode.spec.ts (see note)) |
| J-FILT-06 | Select two Experience values and see them comma-joined | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-07 | Pick a $100k+ salary tier and see `salary=100k` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-08 | Pick "$75k+" salary and observe it does not round-trip in the URL | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-09 | Enter a custom minimum salary | anon | SEED-A + `/jobs?q=software+engineer`, `salary-custom-min` | signed-out | no | uncovered | — |
| J-FILT-10 | Toggle "Sponsors visas" and see `visa=1` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-11 | Pick Years of experience "3–5 years" and see `years=3-5` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-12 | Choose "Show all postings" and see `ghosts=show` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-13 | Choose "Hide already viewed" and see `viewed=hide` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-14 | Switch Boards to "Elite startups" and see `board=elite` | anon | SEED-A + `/jobs?q=software+engineer` | signed-out | no | uncovered | — |
| J-FILT-15 | Load a URL with every filter param and see all chips rendered | anon | SEED-A + `/jobs?q=nurse&work=remote&exp=senior&salary=100k&visa=1&posted=7d&years=3-5&ghosts=show&viewed=hide` | signed-out | no | uncovered | — |
| J-FILT-16 | Remove one active filter chip | anon | SEED-A + `/jobs?q=nurse&work=remote&visa=1`, click chip remove | signed-out | no | uncovered | — |
| J-FILT-17 | "Reset all" clears every filter and the URL | anon | SEED-A + `/jobs?q=nurse&work=remote&visa=1&salary=100k` | signed-out | no | uncovered | — |
| J-FILT-18 | "Clear (N)" in the toolbar clears filters and shows N | anon | SEED-A + `/jobs?q=nurse&work=remote&visa=1` | signed-out | no | uncovered | — (legacy: states-empty.spec.ts › search mock keeps clear chip testid (mobile-390)) |
| J-FILT-19 | Filters survive a reload | anon | SEED-A + `/jobs?q=nurse&work=remote&visa=1` then `reload()` | signed-out | no | uncovered | — |
| J-FILT-20 | Filter changes replace history: Back after applying a filter leaves the SERP | anon | `/about` then SEED-A + `/jobs?q=nurse`, apply Remote, then `goBack()` | signed-out | no | uncovered | — |
| J-FILT-21 | Filter tweak keeps the chosen sort | anon | SEED-A + `/jobs?q=nurse&sort=salary`, toggle Remote | signed-out | no | uncovered | — (legacy: jobs-search-polish.spec.ts › TC-JOBS-SORT-003: sort and filter order do not change matched count or ID set) |
| J-FILT-22 | Company-scope chip appears for `?company=` and clears | anon | SEED-A + `/jobs?company=harrods.com` | signed-out | no | uncovered | — |
| J-FILT-23 | Unknown filter values in the URL are ignored, not crashed | anon | SEED-A + `/jobs?posted=bogus&sort=wat&years=99&salary=1m&view=x` | signed-out | no | uncovered | — |
| J-FILT-24 | Filters toggle reports its open state to assistive tech | anon | SEED-A + `/jobs?q=nurse`, click `filters-toggle` | signed-out | no | uncovered | — |

## MOB

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-MOB-01 | Poster does not scroll sideways at 360 and 390 | anon | `/jobs` (no seed) at 360 and 390 | signed-out | no | uncovered | — (legacy: no-horizontal-overflow.spec.ts › landing /jobs does not scroll sideways at 390px) |
| J-MOB-02 | SERP list does not scroll sideways at 360 and 390 | anon | SEED-A + `/jobs?q=product+designer` at 360 and 390 | signed-out | no | uncovered | — (legacy: no-horizontal-overflow.spec.ts › results /jobs?q=product+designer does not scroll sideways at 390px) |
| J-MOB-03 | Opened job sheet does not scroll sideways | anon | SEED-A + `/jobs?q=product+designer`, tap first row at 390 | signed-out | yes | uncovered | — (legacy: no-horizontal-overflow.spec.ts › results with first row opened does not scroll sideways at 390px) |
| J-MOB-04 | Bottom tab bar shows Jobs, Résumé, Tracker and Account below lg | anon | SEED-A + `/jobs` at 390x844 | signed-out | no | uncovered | — |
| J-MOB-05 | Bottom tab bar is hidden at lg and above | anon | SEED-A + `/jobs` at 1280x800 | signed-out | no | uncovered | — |
| J-MOB-06 | Tab bar Jobs tab is current on /jobs | anon | SEED-A + `/jobs` at 390x844 | signed-out | no | uncovered | — |
| J-MOB-07 | Tab bar Tracker tab navigates to /yours | anon | SEED-A + `/jobs` at 390x844, tap `mobile-topbar-tracker` | signed-out | no | uncovered | — |
| J-MOB-08 | Tab bar targets are at least 44 px high | anon | SEED-A + `/jobs` at 390x844 | signed-out | no | uncovered | — (legacy: mobile.spec.ts › TC-MOBILE-002 (see note)) |
| J-MOB-09 | Below xl a row opens a bottom sheet with a Close control | anon | SEED-A + `/jobs?q=software+engineer` at 390x844, tap first `job-row` | signed-out | yes | uncovered | — |
| J-MOB-10 | At xl and above a row opens the split-view pane, not a sheet | anon | SEED-A + `/jobs?q=software+engineer` at 1280x800, click first `job-row` | signed-out | yes | uncovered | — (legacy: jobs-split-view.spec.ts › (b) clicking a row shows that job in the pane; list stays visible; URL carries ?job=) |
| J-MOB-11 | Mobile filter sheet opens from the "Filters" button | anon | SEED-A + `/jobs?q=software+engineer` at 390x844, tap `filters-toggle` | signed-out | no | uncovered | — |
| J-MOB-12 | Mobile filter sheet applies a filter and closes | anon | SEED-A + `/jobs?q=software+engineer` at 390x844 | signed-out | no | uncovered | — |
| J-MOB-13 | Mobile location button opens the location sheet and applies a place | anon | SEED-A + `/jobs?q=engineer` at 390x844, tap `location-picker-trigger` | signed-out | no | uncovered | — (legacy: jobs-mobile-multi-location.spec.ts (see note)) |
| J-MOB-14 | Results header left edge lines up with row content at 360 and 390 | anon | SEED-A + `/jobs?q=product+designer` at 390 | signed-out | no | uncovered | — (legacy: mobile-list-inset-toolbar.spec.ts › results header left edge matches JobRow content left edge at 390px) |
| J-MOB-15 | Toolbar shows a right-edge fade only when its content overflows | anon | SEED-A + `/jobs?q=product+designer` at 390 | signed-out | no | uncovered | — (legacy: mobile-list-inset-toolbar.spec.ts › toolbar shows a right edge fade iff its content actually overflows at 390px) |
| J-MOB-16 | Search dock is a 16 px-corner stack below sm and a pill from sm up | anon | SEED-A + `/jobs?q=product+designer` at 390 and 800 | signed-out | no | uncovered | — (legacy: mobile-list-inset-toolbar.spec.ts › search dock corners are 16px below sm, pill from sm up, at 390px) |
| J-MOB-17 | Mobile Search CTA bar appears at landing and when the draft is dirty | anon | SEED-A + `/jobs` at 390x844 | signed-out | no | uncovered | — |
| J-MOB-18 | Cold-visitor orientation renders inside the list after row 3 on mobile | anon | SEED-A + `/jobs?q=software+engineer` at 390x844 | signed-out | no | uncovered | — (legacy: cold-visitor-orientation.spec.ts (see note)) |
| J-MOB-19 | Account and site chrome are hidden on /login, not on /jobs | anon | `/login` at 390x844 then `/jobs` | signed-out | no | uncovered | — |
| J-MOB-20 | Search clear button works on the mobile input | anon | SEED-A + `/jobs?posted=any` at 390x844, fill "engineer", click `search-input-clear` | signed-out | no | uncovered | — (legacy: search-clear.spec.ts › mobile: the clear button sits above the input and actually clears it) |

## DETAIL

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-DETAIL-01 | Cold visit to a canonical job page renders one h1 and one Apply button | anon | JOB_PATH | signed-out | no | covered | jobs.spec.ts |
| J-DETAIL-02 | Job page breadcrumb "All jobs" returns to the board | anon | JOB_PATH | signed-out | no | uncovered | — |
| J-DETAIL-03 | Job page canonical link never points at the retired domain | anon | JOB_PATH | signed-out | no | uncovered | — |
| J-DETAIL-04 | Bare-uuid job URL permanent-redirects to the canonical slug path | anon | /jobs/JOB_ID | signed-out | no | uncovered | — |
| J-DETAIL-05 | Bogus job slug shows "Page not found" (soft 404) with no job document | anon | /jobs/not-a-real-job-slug | signed-out | no | uncovered | — (legacy: job-page.spec.ts › a malformed slug 404s instead of rendering an empty shell (stale)) |
| J-DETAIL-06 | Well-formed but unknown job uuid shows the same "Page not found" | anon | /jobs/00000000-0000-0000-0000-000000000000 | signed-out | no | uncovered | — |
| J-DETAIL-07 | Job page is noindex (meta robots and X-Robots-Tag) and carries no JobPosting JSON-LD | anon | JOB_PATH | signed-out | no | uncovered | — (legacy: job-page.spec.ts › a job page renders server-side with JobPosting JSON-LD (stale)) |
| J-DETAIL-08 | Job page OG image route serves a PNG | anon | JOB_PATH + /opengraph-image | signed-out | no | uncovered | — |
| J-DETAIL-09 | Company name link on the job page goes to the company page | anon | JOB_PATH | signed-out | no | uncovered | — |
| J-DETAIL-10 | Employer card "All jobs at {brand}" link goes to the company-scoped board | anon | JOB_PATH | signed-out | no | uncovered | — |
| J-DETAIL-11 | Related job row from the document is a link to that job's own page (not the board); it opens there with the row's title as the heading, and Back returns to the first job page | anon | JOB_PATH | signed-out | no | covered | detail.spec.ts |
| J-DETAIL-12 | Description API returns the hydrate shape for a real id and an empty hit list for an unknown id | agent | GET /api/jobs/JOB_ID/description | signed-out | no | uncovered | — |
| J-DETAIL-13 | Description API rejects an over-long id with 400 | agent | GET /api/jobs/{201 chars}/description | signed-out | no | uncovered | — |
| J-DETAIL-14 | Desktop (>=xl) row click opens the detail in the pane and puts ?job= in the URL | anon | /jobs?posted=any at 1440x900 | signed-out | no | uncovered | — |
| J-DETAIL-15 | Pane close (x) clears ?job= and returns to the ambient preview | anon | /jobs?posted=any at 1440x900 | signed-out | no | uncovered | — |
| J-DETAIL-16 | Below xl a ?job= deep link renders the sheet dialog, not the pane | anon | /jobs?posted=any&job=JOB_ID at 1100x800 | signed-out | no | uncovered | — |
| J-DETAIL-17 | Browser Back after opening a job closes the detail | anon | /jobs?posted=any | signed-out | no | uncovered | — |
| J-DETAIL-18 | Dead ?job= id shows a tombstone/unresolved state, never another job's detail | anon | /jobs?posted=any&job=nonexistent-id-12345 at 1100x800 | signed-out | no | uncovered | — |
| J-DETAIL-19 | Mobile sheet scrolls the full posting | anon | /jobs?q=Ramsayhealthcare&posted=any&job=51130b30-8920-4e75-b076-86c898f1b091 at 390x844 | signed-out | no | uncovered | — |
| J-DETAIL-20 | Closed job document swaps the apply card for the closed notice | anon | JOB_PATH of a job with vacancy_status=closed | signed-out | no | uncovered | — |
| J-DETAIL-21 | Guest saves one job locally from the job page; the toast links the Tracker | anon | JOB_PATH at 1440x900 | signed-out | no | uncovered | — |
| J-DETAIL-22 | Guest's second save is blocked by the "Sign in to save this job to Tracker." gate | anon | JOB_PATH (after J-DETAIL-21 state) | signed-out | no | uncovered | — |
| J-DETAIL-23 | Signed-in save flips the bookmark to a confirmed link into /yours/<id> @writes | signed-in | JOB_PATH at 1440x900 | signed-in | yes | uncovered | — |
| J-DETAIL-24 | Signed-out Report listing opens the report form with no sign-in gate (only when the report flag is on) | anon | JOB_PATH at 1440x900 | signed-out | no | covered | signup-gates.spec.ts |
| J-DETAIL-25 | Signed-in Report submits and flips to "Reported ✓" (flag on) @writes | signed-in | JOB_PATH at 1440x900 | signed-in | yes | uncovered | — |
| J-DETAIL-26 | Share control in the board detail pane is a labelled "Copy link" action | anon | /jobs?posted=any at 1440x900 (pane) | signed-out | no | uncovered | — |
| J-DETAIL-27 | Slow document load shows the "Loading job page" skeleton before the job | anon | JOB_PATH with the document request delayed | signed-out | no | uncovered | — |
| J-DETAIL-28 | Anonymous Report submit reaches "Reported ✓" (flag on) @writes | anon | JOB_PATH at 1440x900, open `report-job-trigger`, click `report-job-submit` | signed-out | yes | covered | signup-gates.spec.ts |
| J-DETAIL-29 | Job page "More like this" rows hold their title and meta lines with space above and below (no spill over the hairline), the text sits inside the row's hover band, keyboard focus draws an inset ring (no outline over the text), no sideways scroll, and the heading reads "More like this" for similar roles or "More at {company}" for the company's own | anon | JOB_PATH from a live "product manager" search | signed-out | no | covered | detail.spec.ts |
| J-DETAIL-30 | Board pane's hiring-truth links say where they go ("All jobs at {brand}", "{brand} company page"), never a bare company name beside them | anon | /jobs?posted=any&job=<id from a live "product manager" search> | signed-out | no | covered | detail.spec.ts |
| J-DETAIL-31 | Job page's posting-check rows and "Keywords from the posting" show without a tap at 1440; on a phone they fold behind "Show details", which opens them and turns into "Hide details" | anon | JOB_PATH from a live "product manager" search | signed-out | no | covered | detail.spec.ts |
| J-DETAIL-32 | Job page's actions fit the screen: one "Upload résumé to customize." button on its own row (in the rail card at 1440, in the page on a phone), the phone's sticky bar holds only Apply and Save with nothing past its edge, no sideways scroll | anon | JOB_PATH from a live "product manager" search | signed-out | no | covered | detail.spec.ts |
| J-DETAIL-33 | Board role view shows one Upload/Customize button; on a phone the sheet's sticky bar holds only Apply and Save and fits the screen | anon | /jobs?posted=any&job=<id from a live "product manager" search> | signed-out | no | covered | detail.spec.ts |

## APPLY

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-APPLY-01 | Signed-out Apply on the job page opens the "Sign in to apply" gate instead of the employer site | anon | JOB_PATH at 1440x900 | signed-out | no | covered | apply-gate.spec.ts |
| J-APPLY-02 | Signed-out Apply persists a pending "apply" action bound to the current URL | anon | JOB_PATH | signed-out | no | uncovered | — (legacy: auth-gate-intent.spec.ts › signed-out Apply persists the action and the /auth/start next param matches the current page (stale)) |
| J-APPLY-03 | Google continue from the apply gate hits /auth/start with next equal to the job page | anon | JOB_PATH | signed-out | no | covered | apply-gate.spec.ts |
| J-APPLY-04 | Signed-out Apply never opens a new window (no employer departure before sign-in) | anon | JOB_PATH | signed-out | no | uncovered | — |
| J-APPLY-05 | Signed-out Apply from the sticky action bar on mobile gates identically ("Sign in to apply") | anon | JOB_PATH at 390x844 | signed-out | no | covered | apply-gate.spec.ts |
| J-APPLY-06 | A persisted "apply" action for the same job resumes into the apply flow after auth | signed-in | JOB_PATH with seeded sessionStorage | signed-in | no | uncovered | — |
| J-APPLY-07 | A persisted apply action for a different job is ignored | signed-in | JOB_PATH with seeded sessionStorage | signed-in | no | uncovered | — |
| J-APPLY-08 | A persisted action older than 15 minutes is discarded on load | signed-in | JOB_PATH with seeded sessionStorage | signed-in | no | uncovered | — |
| J-APPLY-09 | A persisted record with an unknown action kind opens nothing and logs no console error | anon | /jobs?q=engineer with seeded sessionStorage | signed-out | no | uncovered | — |
| J-APPLY-10 | Signed-in Apply opens the employer posting in a new tab and arms the return prompt | signed-in | JOB_PATH at 1440x900 | signed-in | no | uncovered | — |
| J-APPLY-11 | Apply button label is "Apply on employer site" on the desktop card and the mobile bar | anon | JOB_PATH | signed-out | no | uncovered | — |
| J-APPLY-12 | Job without an apply_url renders no Apply button | anon | JOB_PATH of a job with empty apply_url | signed-out | no | uncovered | — |
| J-APPLY-13 | Closed job offers no Apply button, only "See open roles" | anon | closed JOB_PATH | signed-out | no | uncovered | — |
| J-APPLY-14 | Opt-in intent dialog appears before the employer posting when enabled | signed-in | JOB_PATH with localStorage intervu.apply-intent-enabled=1 | signed-in | no | uncovered | — |
| J-APPLY-15 | Intent dialog "Continue" is a real employer link and arms the return prompt | signed-in | JOB_PATH with intent enabled | signed-in | no | uncovered | — |
| J-APPLY-16 | Returning after >=10 s away shows the "Did you apply?" prompt | signed-in | JOB_PATH with seeded sessionStorage velai.applyReturn | signed-in | no | uncovered | — |
| J-APPLY-17 | Returning after <10 s away shows no prompt | signed-in | JOB_PATH with seeded sessionStorage velai.applyReturn | signed-in | no | uncovered | — |
| J-APPLY-18 | Prompt "Yes" marks the job applied and writes a pursuit @writes | signed-in | JOB_PATH with seeded sessionStorage velai.applyReturn | signed-in | yes | uncovered | — |
| J-APPLY-19 | Prompt "Not yet" and "Skip" dismiss it without writing | signed-in | JOB_PATH with seeded sessionStorage velai.applyReturn | signed-in | no | uncovered | — |
| J-APPLY-20 | The prompt fires once per job per session (no re-prompt after dismiss or reload) | signed-in | JOB_PATH with seeded sessionStorage velai.applyReturn | signed-in | no | uncovered | — |
| J-APPLY-21 | An already-applied job never shows the prompt | signed-in | JOB_PATH of an applied pursuit | signed-in | no | uncovered | — |
| J-APPLY-22 | Mark applied on an expired session opens the "Sign in to track this application" gate and rolls back | signed-in | JOB_PATH with seeded velai.applyReturn and server auth revoked | signed-in | no | uncovered | — |
| J-APPLY-23 | Mark applied with a server error shows "Could not save" and rolls back the optimistic pursuit | signed-in | JOB_PATH with the action mocked to fail | signed-in | no | uncovered | — |
| J-APPLY-24 | Prompt survives a reload of the armed tab (mount-time check) | signed-in | JOB_PATH reload with seeded velai.applyReturn | signed-in | no | uncovered | — |
| J-APPLY-25 | Applying from the board pane (/jobs?job=) also arms the prompt on return | signed-in | /jobs?posted=any&job=JOB_ID at 1440x900 | signed-in | no | uncovered | — |
| J-APPLY-26 | On a phone, coming back to the job sheet asks "Did you apply?" inside the sheet (the floating chip is hidden behind any open sheet, so it isn't mounted); Yes saves the role as applied with its employer posting URL and says "Applied — nice work" (dev-server only: signed-in mock, stub search, save answered in the browser) | signed-in | `/jobs?q=backend%20engineer&posted=any` at 390x844, open a role, seeded velai.applyReturn + focus | signed-in | no | covered | apply-return.spec.ts |
| J-APPLY-27 | On a phone, "Not yet" in the job sheet closes the question without saving, and it doesn't come back on the next focus or after closing the sheet (dev-server only: signed-in mock) | signed-in | `/jobs?q=backend%20engineer&posted=any` at 390x844, open a role, seeded velai.applyReturn + focus | signed-in | no | covered | apply-return.spec.ts |
| J-APPLY-28 | At 1440 wide the role opens beside the list (no sheet) and "Did you apply?" floats over the page; Yes saves the role with its posting URL (dev-server only: signed-in mock) | signed-in | `/jobs?q=backend%20engineer&posted=any` at 1440x900, open a role, seeded velai.applyReturn + focus | signed-in | no | covered | apply-return.spec.ts |
| J-APPLY-29 | A closed Apply sign-in dialog stays closed when the session is checked again (back/forward cache return), and Apply still opens it | anon | JOB_PATH, Apply, Escape, `pageshow` | signed-out | no | covered | apply-gate.spec.ts |
| J-APPLY-30 | Create account from the Apply sign-in dialog returns to the job page (`/auth/start?mode=signup&next=<job>&pending=1`), not the résumé upload at /jobs?resume=gate | anon | JOB_PATH, Apply, Create account, Continue with Google | signed-out | no | covered | apply-gate.spec.ts |

## COMPANY

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-COMPANY-01 | Allowlisted company page renders header, hiring headline and Follow control | anon | /co/anthropic--com | signed-out | no | uncovered | — (legacy: company-follow.spec.ts › elite allowlisted company page loads) |
| J-COMPANY-02 | Unknown company slug shows "Page not found" with no company page | anon | /co/not-a-real-company-slug | signed-out | no | uncovered | — (legacy: company-follow.spec.ts › unknown company slug returns 404) |
| J-COMPANY-03 | Slug without "--" and not allowlisted also lands on "Page not found" | anon | /co/anthropic | signed-out | no | uncovered | — |
| J-COMPANY-04 | Company page metadata and JSON-LD (Organization + FAQPage), canonical /co/<slug> | agent | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-05 | Company page breadcrumb "Find jobs" goes to /jobs | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-06 | Role search filters the open roles by title, location or level | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-07 | Role search with no match shows the empty message and "Search all jobs at" link | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-08 | Escape clears the role search | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-09 | Role row opens the detail sheet in place; Close returns without navigating | anon | /co/anthropic--com at 1440x900 | signed-out | no | uncovered | — |
| J-COMPANY-10 | "View all N jobs" CTA opens the company-scoped board | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-11 | Company with zero open roles shows the follow-me empty state | anon | /co/<slug of a company with 0 live roles> | signed-out | no | uncovered | — |
| J-COMPANY-12 | Guest Follow click opens the email step and never renders "Following" | anon | /co/anthropic--com | signed-out | no | uncovered | — (legacy: company-follow.spec.ts › guest click on Follow never renders Following — it opens the email step instead) |
| J-COMPANY-13 | Guest Follow email step is focusable and its "Have an account? Sign in" opens the auth dialog (follow gate) | anon | /co/anthropic--com | signed-out | no | covered | signup-gates.spec.ts |
| J-COMPANY-14 | Email step submit sends a confirmation @writes | signing-up | /co/anthropic--com | signed-out | yes | uncovered | — |
| J-COMPANY-15 | Follow email API rejects an invalid body with 400 | agent | POST /api/follow-email | signed-out | no | uncovered | — |
| J-COMPANY-16 | Verify link success redirects to the company page with ?followed=1 and shows the verified state | anon | /api/follow-email/verify?token=...&domain=...&name=... | signed-out | yes | uncovered | — |
| J-COMPANY-17 | Verify link failure redirects to /jobs?followed=0 | anon | /api/follow-email/verify?token=bad&domain=anthropic.com&name=Anthropic | signed-out | no | uncovered | — |
| J-COMPANY-18 | Verified guest sees "Unfollow" and the watching caption; Unfollow reverts | anon | /co/anthropic--com?followed=1 | signed-out | yes | uncovered | — |
| J-COMPANY-19 | Signed-in Follow flips to "Unfollow" and back @writes | signed-in | /co/anthropic--com | signed-in | yes | uncovered | — |
| J-COMPANY-20 | Guest follows merge into the account on sign-in | signing-up | /co/anthropic--com then sign in | signed-in | yes | uncovered | — |
| J-COMPANY-21 | Anon sees the "The full record" gate with sign-in link and real teasers | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-22 | Anon "Sign in to open the record" link carries next=/co/<slug> | anon | /co/anthropic--com | signed-out | no | uncovered | — |
| J-COMPANY-23 | Signed-in member sees the integrity, tech-stack and filings bands instead of the gate | signed-in | /co/anthropic--com | signed-in | no | uncovered | — |
| J-COMPANY-24 | Signed-in non-follower sees the follower lock card; anon sees none in the main column | signed-in | /co/anthropic--com | signed-in | no | uncovered | — |
| J-COMPANY-25 | Following unlocks "Recent changes" and "Company details" | signed-in | /co/anthropic--com | signed-in | yes | uncovered | — |
| J-COMPANY-26 | Slow load shows the "Loading company page" skeleton | anon | /co/anthropic--com with the document delayed | signed-out | no | uncovered | — |
| J-COMPANY-27 | Name-keyed /companies/[slug] for a domainless company renders the truth page with roles or empty state | anon | /companies/Zzzz%20Nope%20Co | signed-out | no | uncovered | — |
| J-COMPANY-28 | /companies/[slug] for a company that has a domain redirects to /co/<slug> | anon | /companies/<name of a domain-known company> | signed-out | no | uncovered | — |
| J-COMPANY-29 | /companies/hiring redirects to /jobs | anon | /companies/hiring | signed-out | no | uncovered | — |
| J-COMPANY-30 | Career hub links through to live job search | anon | /careers/software-engineer-jobs | signed-out | no | uncovered | — |
| J-COMPANY-31 | Bogus career hub slug is a real 404 | anon | /careers/nope | signed-out | no | uncovered | — |
| J-COMPANY-32 | /watch/[id] signed out shows the sign-in prompt, not the session | anon | /watch/some-unguessable-id | signed-out | no | uncovered | — (legacy: watch-page.spec.ts › shows a login prompt, not the session, to a visitor who is not signed in) |
| J-COMPANY-33 | /watch/[id] keeps the visitor on the link | anon | /watch/some-unguessable-id | signed-out | no | uncovered | — (legacy: watch-page.spec.ts › keeps the visitor on the link so logging in does not lose the session) |
| J-COMPANY-34 | /watch/anywhere renders the static setup guide | anon | /watch/anywhere | signed-out | no | uncovered | — |

## AUTH

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-AUTH-01 | Open /login and see the Sign in tab by default | anon | /login | signed-out | no | uncovered | — |
| J-AUTH-02 | Bounce signed-out /settings to login with next= | anon | /settings | signed-out | no | uncovered | — (legacy: auth.spec.ts › TC-AUTH-007: Guest mode shows login prompt in settings) |
| J-AUTH-03 | Preserve tab query in next= when signed-out hits /settings?tab=prefs | anon | /settings?tab=prefs | signed-out | no | uncovered | — |
| J-AUTH-04 | Chain /account through /settings to login with next= | anon | /account | signed-out | no | uncovered | — |
| J-AUTH-05 | Switch to Create account tab and see signup fields | anon | /login | signed-out | no | uncovered | — |
| J-AUTH-06 | Open signup dialog from the TopBar Create account button | anon | /about | signed-out | no | uncovered | — (legacy: signup-ladder.spec.ts › TC-LADDER-002: marketing /about shows TopBar Sign in + Create account) |
| J-AUTH-07 | Hand off Continue with Google to /auth/start with provider | anon | /login?next=/jobs | signed-out | no | uncovered | — |
| J-AUTH-08 | Hand off passkey/email-code to /auth/start with no provider | anon | /login | signed-out | no | uncovered | — |
| J-AUTH-09 | Hand off Google on the signup tab with mode=signup | signing-up | /login (Create account tab) | signed-out | no | uncovered | — |
| J-AUTH-10 | Persist a pending Apply action and pass the page as next= to /auth/start | anon | /jobs?q=engineer (click Apply) | signed-out | no | uncovered | — |
| J-AUTH-11 | Show the Apply gate copy in the auth dialog | anon | /jobs?q=engineer (click Apply) | signed-out | no | uncovered | — |
| J-AUTH-12 | Show the Fit/Resume gate copy in the auth dialog | anon | /resume (Upload résumé -> gate) or /jobs fit chip | signed-out | no | uncovered | — |
| J-AUTH-13 | Reject empty signup submit with client message | signing-up | /login (Create account tab) | signed-out | no | uncovered | — |
| J-AUTH-14 | Reject a username under 3 characters on signup | signing-up | /login (Create account tab) | signed-out | no | uncovered | — |
| J-AUTH-15 | Reject a malformed email on signup | signing-up | /login (Create account tab) | signed-out | no | uncovered | — |
| J-AUTH-16 | @writes Create an account with username+password and land on the résumé gate | signing-up | /login (Create account tab) | signed-out | yes | uncovered | — (legacy: account-resume.spec.ts › signed-in flow: upload a resume, see it, replace it, delete it) |
| J-AUTH-17 | @writes Receive the welcome email exactly once per account | signing-up | /login (Create account tab) then inbox | signed-out | yes | uncovered | — |
| J-AUTH-18 | Reject empty sign-in submit | anon | /login | signed-out | no | uncovered | — |
| J-AUTH-19 | Reject a wrong password on sign-in | anon | /login | signed-out | no | uncovered | — |
| J-AUTH-20 | Toggle password visibility with Show/Hide password | anon | /login | signed-out | no | uncovered | — |
| J-AUTH-21 | @writes Request a password reset from the login form | anon | /login (Forgot password?) | signed-out | yes | uncovered | — |
| J-AUTH-22 | Return from Forgot password to the sign-in form | anon | /login (Forgot password?) | signed-out | no | uncovered | — |
| J-AUTH-23 | Show the no-token notice on /reset-password | anon | /reset-password | signed-out | no | uncovered | — |
| J-AUTH-24 | Reject mismatched and short passwords on /reset-password | anon | /reset-password?token=bogus | signed-out | no | uncovered | — |
| J-AUTH-25 | Reject an invalid reset token | anon | /reset-password?token=bogus | signed-out | no | uncovered | — |
| J-AUTH-26 | Redirect a direct hit on /auth/callback to /auth/retry | anon | /auth/callback | signed-out | no | uncovered | — |
| J-AUTH-27 | Show /auth/retry copy with a Start again link | anon | /auth/retry | signed-out | no | covered | auth-retry.spec.ts |
| J-AUTH-28 | Reject a protocol-relative next= at /auth/start | anon | /auth/start?next=//evil.com | signed-out | no | uncovered | — |
| J-AUTH-29 | Ignore an external next= when an already-signed-in user opens /login | signed-in | /login?next=https://evil.com | signed-in | no | uncovered | — |
| J-AUTH-30 | Honor a safe next= when an already-signed-in user with a résumé opens /login | signed-in | /login?next=%2Fsettings%3Ftab%3Daccount | signed-in | no | uncovered | — |
| J-AUTH-31 | Open the résumé importer and strip ?resume=gate after signup with no résumé | signing-up | /jobs?resume=gate | signed-in | no | uncovered | — |
| J-AUTH-32 | Strip ?resume=gate without a dialog when a résumé is on file | signed-in | /jobs?resume=gate | signed-in | no | uncovered | — |
| J-AUTH-33 | Keep ?resume=gate untouched while signed out | anon | /jobs?resume=gate | signed-out | no | uncovered | — |
| J-AUTH-34 | Refuse GET on /auth/signout | anon | GET /auth/signout | signed-out | no | uncovered | — |
| J-AUTH-35 | Return {user:null} with no-store from /api/auth/session when signed out | anon | GET /api/auth/session | signed-out | no | uncovered | — |
| J-AUTH-36 | Drop an expired/cleared session and bounce /settings to login | signed-in | /settings (after clearing wos-session cookie) | signed-in | no | uncovered | — |
| J-AUTH-37 | Show the logged-out consent card on /oauth/authorize with a valid request | anon | /oauth/authorize?client_id=…&redirect_uri=…&code_challenge=… | signed-out | no | uncovered | — |
| J-AUTH-38 | Show the error card on /oauth/authorize with no params | anon | /oauth/authorize | signed-out | no | uncovered | — |
| J-AUTH-39 | Bounce a bad email-verify token through /settings to login | anon | /api/account/email/verify?token=bogus | signed-out | no | uncovered | — |
| J-AUTH-40 | @writes Add an account email from the /jobs banner and dismiss it | signed-in | /jobs (signed-in, no reachable email) | signed-in | yes | uncovered | — |
| J-AUTH-41 | Start again on /auth/retry restarts sign-in at /auth/start | anon | /auth/retry?reason=exchange_failed | signed-out | no | covered | auth-retry.spec.ts |
| J-AUTH-42 | Signed-in visitor on /auth/retry is sent on, never shown the sign-in error (needs E2E_STORAGE_STATE; skipped without) | signed-in | /auth/retry?reason=exchange_failed | signed-in | no | covered | auth-retry.spec.ts |
| J-AUTH-43 | Failed Turnstile (error 110200 stubbed) on signup says to use Google or an email code above, and moves focus to the existing Continue with Google button (skips if the build has no site key) | signing-up | /login (Create account tab) | signed-out | no | covered | turnstile.spec.ts |
| J-AUTH-44 | Turnstile api.js blocked or offline on signup shows the same message and focus move (skips if the build has no site key) | signing-up | /login (Create account tab) | signed-out | no | covered | turnstile.spec.ts |

## RESUME

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-RESUME-01 | See the signed-out empty state with one Upload résumé action | anon | /resume | signed-out | no | uncovered | — (legacy: resume-touch-targets.spec.ts › RESUME-TOUCH-001: signed-out empty state exposes upload control) |
| J-RESUME-02 | See the loading skeleton before auth resolves | anon | /resume | signed-out | no | uncovered | — |
| J-RESUME-03 | Open the importer from Upload résumé without signing in | anon | /resume | signed-out | no | uncovered | — (legacy: resume-touch-targets.spec.ts › RESUME-TOUCH-002: import modal exposes skip-download secondary control) |
| J-RESUME-04 | Switch the importer between Upload file and Paste text | anon | /resume (importer open) | signed-out | no | uncovered | — |
| J-RESUME-05 | Keep Parse disabled until 51+ pasted characters | anon | /resume (importer open) | signed-out | no | uncovered | — |
| J-RESUME-06 | Skip the model download and parse pasted text with basic rules | anon | /resume (importer open) | signed-out | no | uncovered | — |
| J-RESUME-07 | Reject unsupported file types in the importer | anon | /resume (importer open) | signed-out | no | uncovered | — |
| J-RESUME-08 | Refuse to accept a low-confidence parse in the review step | anon | /resume (importer review) | signed-out | no | uncovered | — |
| J-RESUME-09 | Cancel and Back in the importer discard state | anon | /resume (importer open) | signed-out | no | uncovered | — |
| J-RESUME-10 | Save a parsed résumé locally and see the local banner and preview | anon | /resume (importer review) | signed-out | no | uncovered | — |
| J-RESUME-11 | Reload /resume and restore the local résumé | anon | /resume (after J-RESUME-10) | signed-out | no | uncovered | — |
| J-RESUME-12 | Replace the local résumé from the local banner | anon | /resume (local résumé) | signed-out | no | uncovered | — |
| J-RESUME-13 | Gate Edit, PDF and Sign up to sync behind signup on a local résumé | anon | /resume (local résumé) | signed-out | no | uncovered | — |
| J-RESUME-14 | Show the empty signed-in résumé state | signed-in | /resume | signed-in | no | uncovered | — |
| J-RESUME-15 | @writes Upload a résumé by paste and see the typeset preview | signed-in | /resume | signed-in | yes | uncovered | — (legacy: account-resume.spec.ts › signed-in flow: upload a resume, see it, replace it, delete it) |
| J-RESUME-16 | Cancel Replace without changing the résumé | signed-in | /resume | signed-in | no | uncovered | — |
| J-RESUME-17 | @writes Delete the résumé after inline confirm | signed-in | /resume | signed-in | yes | uncovered | — (legacy: account-resume.spec.ts › signed-in flow: upload a resume, see it, replace it, delete it) |
| J-RESUME-18 | Keep the résumé when Delete confirm is cancelled | signed-in | /resume | signed-in | no | uncovered | — |
| J-RESUME-19 | Reject an unsupported file in the signed-in upload form | signed-in | /resume (Replace) | signed-in | no | uncovered | — |
| J-RESUME-20 | Download the résumé as .json or .txt | signed-in | /resume | signed-in | no | uncovered | — |
| J-RESUME-21 | Download the résumé as PDF through /api/resume/pdf | signed-in | /resume | signed-in | no | uncovered | — |
| J-RESUME-22 | Open the template editor and hide the page header and tabs | signed-in | /resume | signed-in | no | uncovered | — |
| J-RESUME-23 | @writes Save edits from the template editor | signed-in | /resume (Edit template) | signed-in | yes | uncovered | — |
| J-RESUME-24 | Redirect /resume-builder and /resume-tailor to /yours | anon | /resume-builder | signed-out | no | uncovered | — |
| J-RESUME-25 | Return 400 from /api/resume/pdf for an empty body | anon | POST /api/resume/pdf | signed-out | no | uncovered | — |
| J-RESUME-26 | Render /resume at mobile width with 44px touch targets | anon | /resume (375x667) | signed-out | no | uncovered | — |
| J-RESUME-27 | Show the error state and retry when the résumé fetch fails | signed-in | /resume (fetchResumeSummaryAction fails) | signed-in | no | uncovered | — |
| J-RESUME-28 | Import a résumé without skipping the model: quick match opens at once, the model download shows MB of the measured size and its stages advance (or Skip keeps the quick match) | anon | /resume → Upload résumé (model fetch mocked) | signed-out | no | covered | resume-wait.spec.ts |
| J-RESUME-29 | A résumé whose contact line names a bare city (no region/country) asks on For-you which place it is — Yes / a candidate saves it as the location, No / None of these leaves it blank; no guess, no filter until answered | anon | /jobs → Upload résumé → For-you | signed-out | no | covered | resume-bare-city.spec.ts |
| J-RESUME-30 | A guest résumé offers "See jobs ranked for this résumé" (to /jobs) and "Remove from this device", which after a confirm clears it for good (empty state survives a reload) | Candidate with a local résumé | local résumé seeded + `/resume` | signed-out | no | covered | resume.spec.ts |
| J-RESUME-31 | An old Word .doc file in the importer is refused with "save it as .docx or PDF", never a failed DOCX read | anon | `/resume`, Upload résumé, choose `resume.doc` | signed-out | no | covered | resume.spec.ts |
| J-RESUME-32 | A résumé stored as text (file upload, MCP set_resume) previews its headline and summary section, not its first 300 characters, and an uncategorized skills list prints without a leading ":"; the signed-in subcopy drops "once you sign in" (dev-server only: signed-in mock) | signed-in | `/resume` | signed-in | no | covered | resume.spec.ts |
| J-RESUME-33 | Back from the template editor with unsaved edits asks "Leave without saving?"; Keep editing stays, Leave closes (dev-server only: signed-in mock) | signed-in | `/resume`, Edit template, edit Professional Summary, Back | signed-in | no | covered | resume.spec.ts |
| J-RESUME-34 | A résumé saved to the account as text (file upload on /resume or Settings, MCP set_resume) opens /jobs on the ranked packs hub with "Private matching active", not the "Add your résumé" step; the browser structures the text, the server only sends it (dev-server only: signed-in mock) | signed-in | `/jobs` | signed-in | no | covered | resume.spec.ts |

## SETTINGS

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-SETTINGS-01 | Open /settings on the Résumé tab with header and subcopy | signed-in | /settings | signed-in | no | uncovered | — |
| J-SETTINGS-02 | See exactly the Résumé, Preferences and Account tabs | signed-in | /settings | signed-in | no | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-002: Settings tabs are visible) |
| J-SETTINGS-03 | Switch to Preferences and see the privacy and agent cards | signed-in | /settings | signed-in | no | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-004: Preferences tab shows job search section) |
| J-SETTINGS-04 | Switch to Account and see the "Sign-in details" card (never a "Sign in" heading for a signed-in user) (dev-server only: signed-in mock) | signed-in | /mock/settings?tab=account | signed-in | no | covered | settings.spec.ts |
| J-SETTINGS-05 | Deep-link reload on /settings?tab=account keeps the tab | signed-in | /settings?tab=account | signed-in | no | uncovered | — |
| J-SETTINGS-06 | Fall back to Résumé for an unknown or retired tab | signed-in | /settings?tab=api-key | signed-in | no | uncovered | — |
| J-SETTINGS-07 | Leave /settings on Back after tab switches (replace, not push) | signed-in | /settings | signed-in | no | uncovered | — |
| J-SETTINGS-08 | Show the Loading account state before the session resolves | signed-in | /settings | signed-in | no | uncovered | — |
| J-SETTINGS-09 | Show the empty Résumé tab for an account with no résumé | signed-in | /settings | signed-in | no | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-003: Resume tab shows resume section) |
| J-SETTINGS-10 | @writes Upload a résumé from the Résumé tab | signed-in | /settings | signed-in | yes | uncovered | — (legacy: account-resume.spec.ts › signed-in flow: upload a resume, see it, replace it, delete it) |
| J-SETTINGS-11 | @writes Replace and delete the résumé from the Résumé tab | signed-in | /settings | signed-in | yes | uncovered | — (legacy: account-resume.spec.ts › signed-in flow: upload a resume, see it, replace it, delete it) |
| J-SETTINGS-12 | Show the guest prompt in the Résumé section (component-level) | anon | /settings (component only; unreachable on prod) | signed-out | no | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-013: Guest user sees login prompt on resume tab) |
| J-SETTINGS-13 | Navigate Back from /settings to / and land on /jobs | signed-in | /settings | signed-in | no | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-015: Back navigation works) |
| J-SETTINGS-14 | Hide the header and tab bar while the template editor is open | signed-in | /settings | signed-in | no | uncovered | — |
| J-SETTINGS-15 | @writes Save agent job-search preferences | signed-in | /settings?tab=prefs | signed-in | yes | uncovered | — |
| J-SETTINGS-16 | Toggle on-device AI inference | signed-in | /settings?tab=prefs | signed-in | no | uncovered | — |
| J-SETTINGS-17 | @writes Toggle the Weekly digest | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-SETTINGS-18 | Hide the digest switch and offer the email prompt when no email is reachable | signed-in | /settings?tab=account | signed-in | no | uncovered | — |
| J-SETTINGS-19 | @writes Add an account email from Settings | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-SETTINGS-20 | Show the Blocked suffix for a globally unsubscribed address | signed-in | /settings?tab=account | signed-in | no | uncovered | — |
| J-SETTINGS-21 | @writes Generate and revoke a manual agent token | signed-in | /settings?tab=account | signed-in | yes | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-006: Connected agents quiet link is visible) |
| J-SETTINGS-22 | @writes Send a password reset link from Account | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-SETTINGS-23 | Sign out from Account and lose the session | signed-in | /settings?tab=account | signed-in | no | uncovered | — |
| J-SETTINGS-24 | Gate Delete Forever behind typing DELETE and reset on Cancel | signed-in | /settings?tab=account | signed-in | no | uncovered | — |
| J-SETTINGS-25 | @writes Delete the account permanently | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-SETTINGS-26 | Render /settings at mobile width with tabs and 44px buttons | signed-in | /settings (375x667) | signed-in | no | uncovered | — (legacy: settings.spec.ts › TC-SETTINGS-012: Page responsive on mobile) |
| J-SETTINGS-27 | Redirect signed-in /account to the Account tab | signed-in | /account | signed-in | no | uncovered | — |
| J-SETTINGS-28 | Account tab lists the companies you follow A to Z, each linking to its company page; Unfollow removes one and says so (dev-server only: signed-in mock, actions answered in the browser) | signed-in | /mock/settings?tab=account | signed-in | no | covered | settings.spec.ts |
| J-SETTINGS-29 | Account tab says "You don't follow any companies yet." when you follow none (dev-server only: signed-in mock) | signed-in | /mock/settings?tab=account | signed-in | no | covered | settings.spec.ts |
| J-SETTINGS-30 | A failed email-preferences read ends in "Couldn't load your email preferences." with Try again (never an endless loading row), and Try again reads it again (dev-server only: signed-in mock) | signed-in | /mock/settings?tab=account | signed-in | no | covered | settings.spec.ts |

## TRACKER

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-TRACKER-01 | Guest with no saved roles sees the empty state with one primary action | anon | /yours | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-002: Guest empty state hierarchy — header track vs empty CTAs) |
| J-TRACKER-02 | Guest empty state hides search and board and sits in the upper third (desktop and mobile) | anon | /yours (1440x900 and 390x844) | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-002b: Guest empty hides filter chrome and sits upper-third (desktop) / (mobile)) |
| J-TRACKER-03 | Follow "Browse verified roles" from the empty state to /jobs | anon | /yours | signed-out | no | uncovered | — |
| J-TRACKER-04 | Open the auth dialog from the empty-state "Sign in" button | anon | /yours | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-002: Guest empty state hierarchy — header track vs empty CTAs) |
| J-TRACKER-05 | Empty state shows no Export CSV button and no search box | anon | /yours | signed-out | no | uncovered | — |
| J-TRACKER-06 | Open the Track a role sheet from the header button | anon | /yours | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-008: Track a role opens the add sheet) |
| J-TRACKER-07 | Deep-link /yours?view=new opens the Track a role sheet on load | anon | /yours?view=new | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-000b: /applications?view=new preserves the query param through the redirect) |
| J-TRACKER-08 | Cancel the Track a role sheet and return the URL to /yours | anon | /yours?view=new | signed-out | no | uncovered | — |
| J-TRACKER-09 | Save to tracker stays disabled until company and role are both filled | anon | /yours?view=new | signed-out | no | uncovered | — |
| J-TRACKER-10 | Track a role by hand and see it in the tracker (guest) | anon | /yours?view=new | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-011: tracking a role by hand creates a guest pursuit and closes the sheet back to the tracker) |
| J-TRACKER-11 | A hand-tracked pursuit survives reload in the Applied lane | anon | /yours?view=new then reload | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-012: a hand-tracked pursuit shows up on /yours as applied) |
| J-TRACKER-12 | Track a role with a non-default status, URL and note and see it in the chosen lane | anon | /yours?view=new | signed-out | no | uncovered | — |
| J-TRACKER-13 | A seeded pursuit row shows company, role and status "Saved" | anon | /yours (seeded localStorage) | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-005: Pursuit row shows company, role, and status) |
| J-TRACKER-14 | Board renders five labelled lanes with counts and "None" for empty lanes | anon | /yours (one seeded pursuit) | signed-out | no | uncovered | — |
| J-TRACKER-15 | A rejected pursuit is listed in the Closed lane | anon | /yours (seeded rejected pursuit) | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-009: Ended pursuit appears in the list when filter is all) |
| J-TRACKER-16 | Search box narrows rows by company or role | anon | /yours (two seeded pursuits) | signed-out | no | uncovered | — |
| J-TRACKER-17 | Search with no match shows "Nothing in this lane." and a Track a role button | anon | /yours (seeded), type "zzzz" in search | signed-out | no | uncovered | — |
| J-TRACKER-18 | Mobile stage rail jumps to a lane and is hidden at md+ | anon | /yours (390x844, then 1024x768) | signed-out | no | uncovered | — |
| J-TRACKER-19 | Row click below xl opens the detail sheet | anon | /yours (1024x768, seeded) | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-007: Row click opens the detail sheet below xl) |
| J-TRACKER-20 | Row click at xl+ navigates to /yours/[id] | anon | /yours (1440x900, seeded) | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-013: Row click navigates to the full pursuit page at xl+) |
| J-TRACKER-21 | Pick Rejected in the detail sheet's status row: it is pressed and "Marked rejected" shows | anon | /yours (1024x768, seeded applied pursuit) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-22 | Rejected and Withdrawn in the detail sheet each move the row to the Closed lane, labelled with that status (the sheet's one "Closed" button used to write withdrawn, so no surface could record a rejection) | anon | /yours (1024x768, seeded applied + offer pursuits) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-23 | Set an interview date in the detail sheet | anon | /yours (1024x768, seeded applied pursuit) | signed-out | no | uncovered | — |
| J-TRACKER-24 | A note typed in the detail sheet keeps focus through each autosave ("saved"), and all of it is there after closing and reopening the sheet | anon | /yours (1024x768, seeded) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-25 | Remove a pursuit through the inline confirm; cancel keeps it | anon | /yours (1024x768, seeded) | signed-out | no | uncovered | — |
| J-TRACKER-26 | Export CSV downloads velai-tracker-YYYY-MM-DD.csv with the header row | anon | /yours (seeded) | signed-out | no | uncovered | — |
| J-TRACKER-27 | Switch between the Tracker and History tabs | anon | /yours | signed-out | no | uncovered | — |
| J-TRACKER-28 | Signed-out History shows the sign-in gate | anon | /yours/history | signed-out | no | uncovered | — |
| J-TRACKER-29 | Signed-in History with no opened jobs shows the empty state | signed-in | /yours/history | signed-in | no | uncovered | — |
| J-TRACKER-30 | Signed-in History lists opened jobs newest first as links | signed-in | /yours/history | signed-in | yes | uncovered | — |
| J-TRACKER-31 | Deep link and reload of /yours/[id] show the pursuit with its status pressed; the server renders the loading state, never "couldn't find that pursuit", and there is no hydration error | anon | /yours/guest-journey-deep (seeded) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-32 | A bogus /yours/[id] shows the not-found state | anon | /yours/does-not-exist | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-004: Unknown pursuit id shows not-found) |
| J-TRACKER-33 | Pick Applied on a saved pursuit's /yours/[id] page: the dates line says Applied and the interview date field appears | anon | /yours/guest-journey-saved (seeded interested) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-34 | Set an interview date on /yours/[id]: status moves to Interviewing, "Interview Nov 3" shows, and "Change date" stays disabled until the date changes | anon | /yours/guest-journey-interview (seeded applied) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-35 | /yours/[id] for a saved pursuit shows the AI-assistant handoff note | anon | /yours/guest-e2e-1 (seeded interested) | signed-out | no | uncovered | — |
| J-TRACKER-36 | Posting-check sheet says "No longer live" for a delisted job | anon | /yours/guest-e2e-1 (seeded, job lookup stubbed to gone) | signed-out | no | uncovered | — |
| J-TRACKER-37 | Signed-out ?download=pdf on /yours/[id] redirects to login with next | anon | /yours/guest-e2e-1?download=pdf&variant=v1 | signed-out | no | uncovered | — |
| J-TRACKER-38 | Applied lane shows the daily apply-pace badge | anon | /yours (seeded pursuit applied today) | signed-out | no | uncovered | — |
| J-TRACKER-39 | An applied pursuit untouched for 14+ days shows "no update in Nd" | anon | /yours (seeded applied, updated_at 20 days ago) | signed-out | no | uncovered | — |
| J-TRACKER-40 | Guest saves a job from /jobs and finds it in the tracker | anon | /jobs | signed-out | no | uncovered | — |
| J-TRACKER-41 | First signed-in /yours syncs guest roles and clears the guest store @writes | signing-up | /yours (after login, guest key seeded) | signed-in | yes | uncovered | — |
| J-TRACKER-42 | Signed-in Track a role persists across reload @writes | signed-in | /yours?view=new | signed-in | yes | uncovered | — |
| J-TRACKER-43 | Signed-in status change persists across reload @writes | signed-in | /yours | signed-in | yes | uncovered | — |
| J-TRACKER-44 | Signed-in remove deletes the pursuit for good @writes | signed-in | /yours | signed-in | yes | uncovered | — |
| J-TRACKER-45 | Signed-in cold load shows the tracker loading skeleton on a slow network | signed-in | /yours (applications request delayed) | signed-in | no | uncovered | — |
| J-TRACKER-46 | A pursuit written by the MCP save_job tool appears in the signed-in tracker @writes | agent | /yours (after MCP tools/call save_job) | signed-in | yes | uncovered | — |
| J-TRACKER-47 | Signed-out user opening /yours?view=new from the legacy /applications URL lands on the sheet | anon | /applications?view=new | signed-out | no | uncovered | — (legacy: yours.spec.ts › TC-YOURS-000b: /applications?view=new preserves the query param through the redirect) |
| J-TRACKER-48 | A pursuit in the Offer lane shows the pay-it-forward panel in the detail sheet: "Pay it forward" to a Stripe link when `LANDED_PLEDGE_CHECKOUT_URL` is set, otherwise "Tell us how it went" to the contact page | anon | /yours (1024x768, seeded offer pursuit) | signed-out | no | covered | tracker.spec.ts |
| J-TRACKER-49 | A pursuit below the Offer lane shows no pledge panel in the detail sheet | anon | /yours (1024x768, seeded applied pursuit) | signed-out | no | covered | tracker.spec.ts |
| J-TRACKER-50 | The full pursuit page at xl+ shows the pay-it-forward panel for an offer | anon | /yours/[id] (1440x900, seeded offer pursuit) | signed-out | no | covered | tracker.spec.ts |
| J-TRACKER-51 | On /yours/[id] at xl+, move an applied role to Rejected from the status row (Saved, Applied, Interviewing, Offer, Rejected, Withdrawn); it stays Rejected after reload and the board lists it under Closed | anon | /yours/[id] (1440x900, seeded applied pursuit) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-52 | /yours/[id] names the role once (one h1, company and location as its subline) and renders the posting's Markdown as headings and a list, with no literal "*" or "##" | anon | /yours/[id] (1440x900, seeded pursuit with a Markdown description) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-53 | At 390x844 the /yours/[id] status row shows all six statuses without horizontal scroll, and Withdrawn sets | anon | /yours/[id] (390x844, seeded interviewing pursuit) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-54 | A note typed on /yours/[id] autosaves ("saved") and is there after reload | anon | /yours/[id] (1440x900, seeded) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-55 | Remove on /yours/[id] asks first; Cancel keeps the role, confirming returns to /yours without it | anon | /yours/[id] (1440x900, seeded) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-56 | West of UTC, /yours/[id] shows an interview set for Nov 3 as Nov 3 (text and date field), not Nov 2 | anon | /yours/[id] (America/Vancouver, seeded interviewing pursuit) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-57 | /yours with guest roles: the server renders the loading skeleton, not the empty state; the board loads and reloads with no hydration error | anon | /yours (1440x900, seeded applied pursuit) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-58 | A note typed on a tracked role's page right after it loads keeps its text and saves; the page is never rebuilt under it (the deferred auth and analytics providers used to rebuild every page after load, wiping what was typed) | anon | /yours/[id] (1440x900, seeded) | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-59 | The header's Tracker tab counts open roles only: with 2 open and 3 rejected or withdrawn roles it reads 2 (it used to count every tracked role, so a few closed roles meant a permanent "9+") | signed-in | /pricing at 1440x900, dev-only auth hook + mocked tracker list (local dev server only, skips elsewhere) | signed-in | no | covered | pursuit-status.spec.ts |
| J-TRACKER-60 | A tracked role with no résumé filed shows no "Resume used" card on its page and no "none linked" or disabled Download resume in the sheet; a role with a filed résumé (from the MCP tools) lists it with Download on both | anon | /yours/[id] (1440x900) + /yours sheet (1024x768), seeded | signed-out | no | covered | pursuit-status.spec.ts |
| J-TRACKER-61 | A guest's Open posting on a hand-tracked role's page (a link, no Velai job) opens the "Sign in to apply" dialog and no employer tab; it used to open a plain "Sign in" because the page never passed the gate's reason | anon | /yours/[id] (1440x900, seeded: job_url, no job_id) | signed-out | no | covered | pursuit-status.spec.ts |

## ALERTS

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-ALERTS-01 | Guest with zero search results sees the email-alert capture | anon | /jobs?q=zzzzqxwv (zero results) | signed-out | no | uncovered | — |
| J-ALERTS-02 | After two searches the results surface offers the alert capture | anon | /jobs?q=engineer (interactions seeded to 2) | signed-out | no | uncovered | — |
| J-ALERTS-03 | Toolbar "Get alerts" opens the capture manually | anon | /jobs?q=engineer | signed-out | no | uncovered | — |
| J-ALERTS-04 | "Not now" hides the capture and sets a 30-day dismissal | anon | /jobs?q=zzzzqxwv | signed-out | no | uncovered | — |
| J-ALERTS-05 | A recent dismissal suppresses the capture on reload | anon | /jobs?q=zzzzqxwv (dismissed key seeded) | signed-out | no | uncovered | — |
| J-ALERTS-06 | Submitting the capture shows the check-your-inbox state (network stubbed) | anon | /jobs?q=zzzzqxwv | signed-out | no | uncovered | — |
| J-ALERTS-07 | A failed alert request shows the retry error | anon | /jobs?q=zzzzqxwv (POST stubbed 503) | signed-out | no | uncovered | — |
| J-ALERTS-08 | Real alert signup sends a confirmation email @writes | signing-up | /jobs?q=zzzzqxwv | signed-out | yes | uncovered | — |
| J-ALERTS-09 | Signed-in user never sees the email-alert capture | signed-in | /jobs?q=zzzzqxwv | signed-in | no | uncovered | — |
| J-ALERTS-10 | POST /api/search-alerts with an invalid body returns 400 | anon | POST /api/search-alerts {} | signed-out | no | uncovered | — |
| J-ALERTS-11 | Search-alert verify link with a bogus token redirects to /jobs?search_alert=0 | anon | GET /api/search-alerts/verify?token=bogus | signed-out | no | uncovered | — |
| J-ALERTS-12 | Search-alert verify link with no token redirects to /jobs?search_alert=0 | anon | GET /api/search-alerts/verify | signed-out | no | uncovered | — |
| J-ALERTS-13 | Guest saves a search and it appears in the saved list | anon | /jobs?q=engineer&posted=any | signed-out | no | uncovered | — |
| J-ALERTS-14 | Clicking a saved search re-applies its URL | anon | /jobs (saved search seeded) | signed-out | no | uncovered | — |
| J-ALERTS-15 | Remove a saved search | anon | /jobs (saved search seeded) | signed-out | no | uncovered | — |
| J-ALERTS-16 | Save-search name field commits on Enter and cancels on Escape | anon | /jobs?q=engineer | signed-out | no | uncovered | — |
| J-ALERTS-17 | Second guest save is blocked by the auth gate | anon | /jobs?q=engineer (guestSaveCount=1) | signed-out | no | uncovered | — |
| J-ALERTS-18 | Signed-in user saves a search to their account @writes | signed-in | /jobs?q=engineer | signed-in | yes | uncovered | — |
| J-ALERTS-19 | Saved search shows a "+N" new-roles count | signed-in | /jobs (saved search with older cursor) | signed-in | yes | uncovered | — |
| J-ALERTS-20 | Guest saved searches sync to the account at first sign-in @writes | signing-up | /yours (after login, guest key seeded) | signed-in | yes | uncovered | — |
| J-ALERTS-21 | Visit banner is absent on a first-ever /jobs visit | anon | /jobs | signed-out | no | uncovered | — |
| J-ALERTS-22 | Visit banner reports new roles since the last visit and can be dismissed | anon | /jobs (visitCursor seeded, count stubbed to 3) | signed-out | no | uncovered | — (legacy: jobs-visit-banner-and-saved-search.spec.ts › revisiting shortly after does not break the page) |
| J-ALERTS-23 | Visit banner auto-dismisses after 6 seconds | anon | /jobs (visitCursor seeded, count stubbed) | signed-out | no | uncovered | — |
| J-ALERTS-24 | Guest clicking Follow opens the email step, never "Following" | anon | /co/<allowlisted-slug> | signed-out | no | uncovered | — (legacy: company-follow.spec.ts › guest click on Follow never renders Following — it opens the email step instead) |
| J-ALERTS-25 | Follow email step is focusable and its sign-in link opens the auth dialog | anon | /co/<allowlisted-slug> | signed-out | no | uncovered | — (legacy: company-follow.spec.ts › email step: focusable, sign-in link falls back to the auth dialog) |
| J-ALERTS-26 | Follow email step shows the confirmation message on success (network stubbed) | anon | /co/<allowlisted-slug> | signed-out | no | uncovered | — |
| J-ALERTS-27 | Follow email step shows the retry error on failure | anon | /co/<allowlisted-slug> (POST stubbed 503) | signed-out | no | uncovered | — |
| J-ALERTS-28 | Follow verify link with a bogus token redirects to /jobs?followed=0 | anon | GET /api/follow-email/verify?token=bogus | signed-out | no | uncovered | — |
| J-ALERTS-29 | Returning from a follow verify link shows the followed state | anon | /co/<allowlisted-slug>?followed=1 | signed-out | no | uncovered | — |
| J-ALERTS-30 | Signed-in Follow toggles to Unfollow and back @writes | signed-in | /co/<allowlisted-slug> | signed-in | yes | uncovered | — |
| J-ALERTS-31 | Follow-alerts bell lists new roles at followed companies | signed-in | /jobs (with follow alerts) | signed-in | yes | uncovered | — |
| J-ALERTS-32 | Email preferences digest switch toggles @writes | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-ALERTS-33 | Signed-out /settings redirects to login | anon | /settings?tab=account | signed-out | no | uncovered | — |
| J-ALERTS-34 | Unsubscribe link with no token shows a 400 page | anon | GET /unsubscribe | signed-out | no | uncovered | — |
| J-ALERTS-35 | Unsubscribe link with an invalid token shows a 400 page | anon | GET /unsubscribe?token=bogus | signed-out | no | uncovered | — |
| J-ALERTS-36 | POST /unsubscribe without a token returns 400 JSON | anon | POST /unsubscribe | signed-out | no | uncovered | — |
| J-ALERTS-37 | Undo-unsubscribe POST without a token returns the missing-token page | anon | POST /unsubscribe/undo | signed-out | no | uncovered | — |
| J-ALERTS-38 | Valid unsubscribe link suppresses mail and offers undo @writes | anon | GET /unsubscribe?token=<real token from an email> | signed-out | yes | uncovered | — |
| J-ALERTS-39 | NEVER-CALL: weekly digest cron endpoint is secret-gated | agent | POST /api/email/digest | signed-out | yes | uncovered | — |
| J-ALERTS-40 | Resend webhook rejects an unsigned POST | agent | POST /api/webhooks/resend | signed-out | no | uncovered | — |

## CONNECT

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-CONNECT-01 | Open /connect signed out and see the hero and the Universal MCP Server column | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-02 | Follow the signed-out "Sign in to velai" step to /login with a return path | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-03 | Signed in, the "Sign in to velai" step is absent and the endpoint step remains | signed-in | /connect | signed-in | no | uncovered | — |
| J-CONNECT-04 | See the MCP endpoint URL on the page | anon | /connect | signed-out | no | uncovered | — (legacy: agents-page.spec.ts › TC-AGENTS-003: the connect URL is visible) |
| J-CONNECT-05 | Copy the MCP endpoint with the Copy button | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-06 | Switch between the Claude, ChatGPT, Cursor and Gemini tabs and see each setup box | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-07 | Deep-link a client with ?client= and land on that tab | anon | /connect?client=cursor | signed-out | no | uncovered | — |
| J-CONNECT-08 | Deep-link ?client=openclaw and fall back to the Claude tab | anon | /connect?client=openclaw | signed-out | no | uncovered | — |
| J-CONNECT-09 | Click "Open <client>" and reach the verified vendor site in a new tab | anon | /connect?client=claude | signed-out | no | uncovered | — (legacy: connect.spec.ts › "<label>" tab: Open link points at the verified vendor URL, opens in a new tab without leaking window.opener) |
| J-CONNECT-10 | Read the Gemini-specific requirement note | anon | /connect?client=gemini | signed-out | no | uncovered | — |
| J-CONNECT-11 | Choose Claude or ChatGPT tab and have the choice remembered for job handoffs | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-12 | Open "Raw JSON config" and copy the mcpServers snippet | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-13 | Open "Sample prompts" and copy one prompt | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-14 | Open the FAQ and see only one answer expanded at a time | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-15 | Open "Permissions and privacy" and read the three guarantees | anon | /connect | signed-out | no | uncovered | — (legacy: agents-page.spec.ts › TC-AGENTS-004: the never-applies-without-you promise is present) |
| J-CONNECT-16 | Open "How MCP works" and "Watch the demo" in the film modal | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-17 | Copy the one-line Mac install command in the OpenClaw column | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-18 | Join the Windows/Linux waitlist with an email @writes | anon | /connect | signed-out | yes | uncovered | — |
| J-CONNECT-19 | See the waitlist error when the server action rejects | anon | /connect | signed-out | no | uncovered | — |
| J-CONNECT-20 | Land on /connect from /agents and /mcp legacy URLs | anon | /agents | signed-out | no | uncovered | — (legacy: agents-page.spec.ts › TC-AGENTS-001: /agents redirects to /connect) |
| J-CONNECT-21 | Open /connect/help and jump to a section anchor | anon | /connect/help#gateway | signed-out | no | uncovered | — |
| J-CONNECT-22 | See the loading skeleton while /connect streams | anon | /connect (slow network) | signed-out | no | uncovered | — |
| J-CONNECT-23 | Reach the orphan /openclaw page directly | anon | /openclaw | signed-out | no | uncovered | — (legacy: route-titles.spec.ts › /openclaw has a non-empty title that differs from the homepage) |

## OAUTH

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-OAUTH-01 | See "Can't connect this agent" when authorize params are missing or invalid | anon | /oauth/authorize | signed-out | no | uncovered | — (legacy: route-titles.spec.ts › /oauth/authorize has a non-empty title that differs from the homepage) |
| J-OAUTH-02 | Get bounced to sign in from a valid authorize request, then return | agent | /oauth/authorize?client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&response_type=code | signed-out | no | uncovered | — |
| J-OAUTH-03 | See the consent card with client name and destination host | signed-in | /oauth/authorize?client_id=…&… | signed-in | yes | uncovered | — |
| J-OAUTH-04 | Allow the agent and be redirected with a code and state @writes | signed-in | /oauth/authorize?client_id=…&state=xyz | signed-in | yes | uncovered | — |
| J-OAUTH-05 | Deny the agent and be redirected with access_denied | signed-in | /oauth/authorize?client_id=…&state=xyz | signed-in | no | uncovered | — |
| J-OAUTH-06 | Register a client via DCR and get a client_id @writes | agent | POST /api/oauth/register | signed-out | yes | uncovered | — |
| J-OAUTH-07 | Reject a DCR with a disallowed redirect URI | agent | POST /api/oauth/register | signed-out | no | uncovered | — |
| J-OAUTH-08 | Exchange an auth code plus PKCE verifier for tokens @writes | agent | POST /api/oauth/token | signed-out | yes | uncovered | — |
| J-OAUTH-09 | Get invalid_grant for a bad or reused code | agent | POST /api/oauth/token | signed-out | no | uncovered | — |
| J-OAUTH-10 | Rotate a refresh token | agent | POST /api/oauth/token | signed-out | yes | uncovered | — |
| J-OAUTH-11 | Discover OAuth metadata from /.well-known | agent | GET /.well-known/oauth-authorization-server | signed-out | no | uncovered | — |
| J-OAUTH-12 | Call /api/mcp with no bearer and get a 401 challenge | agent | GET /api/mcp | signed-out | no | uncovered | — |
| J-OAUTH-13 | List the 15 MCP tools with a valid bearer | agent | POST /api/mcp (tools/list) | signed-out | no | uncovered | — |
| J-OAUTH-14 | Hit the MCP rate limit and get a 429 with Retry-After | agent | POST /api/mcp | signed-out | no | uncovered | — |
| J-OAUTH-15 | Generate a manual token in Settings and see it once @writes | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-OAUTH-16 | Revoke a connected agent from Settings @writes | signed-in | /settings?tab=account | signed-in | yes | uncovered | — |
| J-OAUTH-17 | Read the agent-facing entity card at /llms.txt | agent | GET /llms.txt | signed-out | no | uncovered | — (legacy: agents-page.spec.ts › TC-AGENTS-005: /llms.txt returns 200 and names the MCP endpoint) |
| J-OAUTH-18 | Lose the approval when the session expires between render and Allow | signed-in | /oauth/authorize?client_id=…&state=xyz | signed-in | no | uncovered | — |

## CONTENT

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-CONTENT-01 | Read a career hub and follow its jobs CTA | anon | /careers/tech-jobs | signed-out | no | uncovered | — |
| J-CONTENT-02 | Land on a removed Canada hub and be redirected to remote jobs | anon | /careers/canada-jobs | signed-out | no | uncovered | — |
| J-CONTENT-03 | See the lean footer on /careers/remote-jobs | anon | /careers/remote-jobs | signed-out | no | uncovered | — |
| J-CONTENT-04 | Read the Indeed alternative page and follow its links | anon | /indeed-alternative | signed-out | no | uncovered | — |
| J-CONTENT-05 | Read the LinkedIn Jobs alternative page | anon | /linkedin-jobs-alternative | signed-out | no | uncovered | — |
| J-CONTENT-06 | Read the Eluta alternative page | anon | /eluta-alternative | signed-out | no | uncovered | — |
| J-CONTENT-07 | View market trends with live stats | anon | /trends | signed-out | no | uncovered | — (legacy: trends.spec.ts › TC-TRENDS-001: hero stats, top countries, freshness, and ghost radar all render real numbers) |
| J-CONTENT-08 | Open /trends and get the trends page route | anon | /trends | signed-out | no | uncovered | — (legacy: trends.spec.ts › TC-TRENDS-002: /trends route renders the trends page) |
| J-CONTENT-09 | See the 14-day market pulse day bars | anon | /trends | signed-out | no | uncovered | — (legacy: trends.spec.ts › TC-TRENDS-003: market pulse section renders the 14-day posted series as day bars) |
| J-CONTENT-10 | See the trends failure state when market data is down | anon | /trends | signed-out | no | uncovered | — |
| J-CONTENT-11 | Click the TopBar live-count ticker to reach /trends | anon | /jobs | signed-out | no | uncovered | — (legacy: trends.spec.ts › TC-TRENDS-004: TopBar live-count ticker is visible on /jobs at desktop viewport and links to /trends) |
| J-CONTENT-12 | Read the ghost-jobs research article | anon | /research/ghost-jobs | signed-out | no | uncovered | — |
| J-CONTENT-13 | Read the privacy policy and jump between sections | anon | /privacy | signed-out | no | uncovered | — |
| J-CONTENT-14 | Read the terms of service and follow its links | anon | /terms | signed-out | no | uncovered | — |
| J-CONTENT-15 | Read the About page and follow the alternative and hub links | anon | /about | signed-out | no | uncovered | — |
| J-CONTENT-16 | Send a contact message @writes | anon | /contact | signed-out | yes | uncovered | — |
| J-CONTENT-17 | See client-side validation errors on the contact form | anon | /contact | signed-out | no | uncovered | — |
| J-CONTENT-18 | Trip the contact honeypot and get a silent fake success | agent | POST /api/contact | signed-out | no | uncovered | — |
| J-CONTENT-19 | File a bug report from the footer with the source page prefilled | anon | /trends | signed-out | yes | uncovered | — |
| J-CONTENT-20 | See the guest empty state on /stories | anon | /stories | signed-out | no | uncovered | — |
| J-CONTENT-21 | Open /stories signed in and select the Sources tab | signed-in | /stories?tab=sources | signed-in | no | uncovered | — |
| J-CONTENT-22 | Get to /stories from the /library legacy URL | anon | /library | signed-out | no | uncovered | — |
| J-CONTENT-23 | See every public content route with a unique non-empty title | anon | /privacy | signed-out | no | uncovered | — (legacy: route-titles.spec.ts › /privacy has a non-empty title that differs from the homepage) |
| J-CONTENT-24 | Failed Turnstile (error stubbed) on /contact shows the notice telling the visitor to reload, with no invented alternative path (skips if the build has no site key) | anon | /contact | signed-out | no | covered | turnstile.spec.ts |

## SEO

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-SEO-01 | Fetch robots.txt and see the private-path and query disallows | agent | /robots.txt | signed-out | no | uncovered | — |
| J-SEO-02 | Fetch sitemap.xml and see hubs, marketing pages and companies | agent | /sitemap.xml | signed-out | no | uncovered | — |
| J-SEO-03 | Fetch the web manifest | agent | /manifest.webmanifest | signed-out | no | uncovered | — |
| J-SEO-04 | Get noindex headers on job and query URLs | agent | /jobs?q=nurse | signed-out | no | uncovered | — |
| J-SEO-05 | See the canonical link on a marketing page | agent | /trends | signed-out | no | uncovered | — |
| J-SEO-06 | See the root JSON-LD graph on the homepage | agent | /jobs | signed-out | no | uncovered | — |
| J-SEO-07 | See security headers on a page response | agent | /jobs | signed-out | no | uncovered | — |
| J-SEO-08 | See the sitemap fail loud when the data source is down | agent | /sitemap.xml | signed-out | no | uncovered | — |
| J-SEO-09 | Follow the signed-out short URLs /packs and /apply to real surfaces | anon | /packs | signed-out | no | uncovered | — |

## NAV

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-NAV-01 | Land on / and be redirected to /jobs | anon | / | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-007: Direct URL access to all pages) |
| J-NAV-02 | Search from the old home with ?q and land on /jobs with the query | anon | /?q=bogus-zzz | signed-out | no | uncovered | — |
| J-NAV-03 | Hit /?signin=1 and be sent to /login | anon | /?signin=1 | signed-out | no | uncovered | — |
| J-NAV-04 | See only logo, Sign in and Create account in the signed-out desktop TopBar | anon | /trends | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-001: Home page loads successfully) |
| J-NAV-05 | Open the auth popover from Sign in and from Create account | anon | /trends | signed-out | no | uncovered | — |
| J-NAV-06 | Click the logo to return to the front door | anon | /trends | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-006: Wordmark click returns to the front door) |
| J-NAV-07 | See exactly one Sign in and one Create account in the signed-out header on every surface (lean ones included) | anon | /jobs, /trends, /about | signed-out | no | covered | control-scale.spec.ts |
| J-NAV-08 | Use the signed-in TopBar tab links to reach Jobs, Résumé and Tracker | signed-in | /trends | signed-in | no | uncovered | — (legacy: navigation-comprehensive.spec.ts › NAV-001) |
| J-NAV-09 | Reach /connect from the signed-in MCP link, hidden on lean surfaces | signed-in | /trends | signed-in | no | uncovered | — |
| J-NAV-10 | See the Tracker badge when pursuits exist | signed-in | /trends | signed-in | no | uncovered | — |
| J-NAV-11 | Open the account menu and reach Account, Research and Privacy & Terms | signed-in | /trends | signed-in | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-004: Navigate to Settings via avatar menu) |
| J-NAV-12 | Sign out from the account menu | signed-in | /trends | signed-in | no | uncovered | — |
| J-NAV-13 | Share Velai from the account menu | signed-in | /trends | signed-in | no | uncovered | — |
| J-NAV-14 | Send feedback from the account menu @writes | signed-in | /trends | signed-in | yes | uncovered | — |
| J-NAV-15 | Use the four-tab mobile bar and see the active tab | anon | /jobs (390x844) | signed-out | no | uncovered | — |
| J-NAV-16 | Hide the mobile bar at desktop width | anon | /jobs (1280x800) | signed-out | no | uncovered | — |
| J-NAV-17 | Tap the guest mobile Account tab and be sent to login | anon | /jobs (390x844) | signed-out | no | uncovered | — |
| J-NAV-18 | Hit gated /settings signed out and be sent to login with next | anon | /settings | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-007: Direct URL access to all pages) |
| J-NAV-19 | Go back after a gated redirect and return to /jobs | anon | / | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-009: Back button navigation works) |
| J-NAV-20 | Follow the /account shortcut to settings account tab | anon | /account | signed-out | no | uncovered | — |
| J-NAV-21 | Follow /dashboard to /jobs | anon | /dashboard | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-008: Dashboard redirect works) |
| J-NAV-22 | Follow legacy resume routes to /yours | anon | /resume-builder | signed-out | no | uncovered | — (legacy: navigation.spec.ts › TC-NAV-010: Resume builder/tailor routes permanently redirect to /yours) |
| J-NAV-23 | Follow /applications, /prep and /pricing legacy redirects | anon | /applications | signed-out | no | uncovered | — |
| J-NAV-24 | See the full footer links on a content page and follow each | anon | /trends | signed-out | no | uncovered | — |
| J-NAV-25 | See the lean footer on /jobs | anon | /jobs | signed-out | no | uncovered | — |
| J-NAV-26 | See no site chrome on /login and /oauth/authorize | anon | /login | signed-out | no | uncovered | — |
| J-NAV-27 | Use the skip link to jump to main content | anon | /trends | signed-out | no | uncovered | — |
| J-NAV-28 | See the offline shell and retry | anon | /trends | signed-out | no | uncovered | — |
| J-NAV-29 | See the auth-pending placeholder before the session resolves | anon | /trends | signed-out | no | uncovered | — |
| J-NAV-30 | See the For you and Search header tabs; clicking one moves aria-current and `view=` in the URL (dev-server only: signed-in mock) | signed-in | /jobs | signed-in | no | covered | header-tabs.spec.ts |
| J-NAV-31 | See the follow-alerts count chip fully inside the header bar (dev-server only: signed-in mock) | signed-in | /jobs | signed-in | no | covered | header-tabs.spec.ts |
| J-NAV-32 | Read header tab labels and count chips at WCAG AA text contrast (4.5:1) against their real backdrop (dev-server only: signed-in mock) | signed-in | /jobs | signed-in | no | covered | header-tabs.spec.ts |
| J-NAV-33 | Header controls share the md control step (32px) at 1440 and 390: Sign in, Create account, and on desktop with a query the docked search | anon | /jobs, /trends, /about, /jobs?q=data+analyst | signed-out | no | covered | control-scale.spec.ts |
| J-NAV-34 | No flex row mixes control heights: the buttons, fields, selects and tabs of every row share one step (a sm glyph inside a text field excepted), at 1440 and 390; also an open job: the /jobs detail (split pane at 1440, sheet at 390) and /jobs/[slug], whose job actions sit on the md step | anon | /jobs, /jobs?q=data+analyst, /trends, /about, /jobs/[slug] | signed-out | no | covered | control-scale.spec.ts |
| J-NAV-35 | No wrapping row (a flex-wrap row or a `.wrap-row`) strands its last control on a line of its own — e.g. the /jobs toolbar "?" under "Get alerts" — at 1440 and 390 | anon | onboarding-completed flag + /, /jobs, /jobs?q=engineer | signed-out | no | covered | page-scale.spec.ts |
| J-NAV-36 | The page column starts on the header logo's left edge (one page container, no centred column) at 1440 and 390 | anon | /about, /privacy, /terms, /contact | signed-out | no | covered | page-scale.spec.ts |
| J-NAV-37 | Every visible h1 is on the page-title step (28px) at 1440 and 390 | anon | onboarding-completed flag + /, /about, /privacy, /yours, /login | signed-out | no | covered | page-scale.spec.ts |
| J-NAV-38 | Every visible labelled button face takes its type from its control step at 1440 and 390: 24px → 12px, 32px → 14px, 44px → 16px, all at weight 500, on the control corner unless it names its own; the header Sign in and Create account are 32px / 14px / 500; also an open job's actions | anon | onboarding-completed flag + /jobs, /about, /trends, /jobs?q=data+analyst | signed-out | no | covered | control-scale.spec.ts |
| J-NAV-39 | The page stays on screen after it paints: once the header and content show, they are never blanked or rebuilt as the deferred auth and analytics providers load (they used to wrap the page on arrival, so every route went blank for ~300ms and repainted) | anon | onboarding-completed flag + /pricing, /jobs | signed-out | no | covered | steady-shell.spec.ts |
| J-NAV-40 | The follow-alerts bell's footer link reads "Manage companies you follow" and opens Settings › Account at the list, not the Elite startups board (dev-server only: signed-in mock) | signed-in | /jobs, open `topbar-follow-alerts` | signed-in | no | covered | settings.spec.ts |

## PRICING

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|---|---|---|---|---|---|---|---|
| J-PRICING-01 | Read the pricing page: Free, Pro and Data API columns, the founding-seat price and count, and the promise that Free stays free | anon | /pricing | signed-out | no | covered | pricing.spec.ts |
| J-PRICING-02 | Reach pricing from the footer link on a marketing page | anon | /about | signed-out | no | covered | pricing.spec.ts |
| J-PRICING-03 | Founding-seat button links out to Stripe checkout when the link is configured, otherwise the Pro column takes an email-only reservation ("Reserve a founding seat"); the headline, Pro badge and meta description say the same thing as the button | anon | /pricing | signed-out | no | covered | pricing.spec.ts |
| J-PRICING-04 | Return from Stripe with checkout=success and a session id and see the founding thank-you; a bare checkout=success shows nothing | anon | /pricing?checkout=success&session_id=cs_test_… | signed-out | no | covered | pricing.spec.ts |
| J-PRICING-05 | Follow the Data API call to action to the contact form | anon | /pricing | signed-out | no | covered | pricing.spec.ts |
| J-PRICING-06 | Signed-in visitor sees "You are on Free" instead of the create-account door | signed-in | /pricing | signed-in | no | uncovered | — |
| J-PRICING-07 | Reserve a founding seat with an email while the Stripe link is unset: the confirmation shows, one row lands in `founding_waitlist` (kept on resubmission), one confirmation email goes out, and /admin's Waitlist group counts it | anon | /pricing | signed-out | yes | uncovered | — |

## ERR

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-ERR-01 | Hit an unknown route and see the branded 404 with chrome | anon | /this-route-does-not-exist-615 | signed-out | no | uncovered | — (legacy: states-empty.spec.ts › unknown route 404 keeps TopBar and single main landmark) |
| J-ERR-02 | Return to jobs from the 404 page | anon | /this-route-does-not-exist-615 | signed-out | no | uncovered | — |
| J-ERR-03 | Get a real HTTP 404 status from an unknown route | agent | /this-route-does-not-exist-615 | signed-out | no | uncovered | — |
| J-ERR-04 | Hit a bogus career hub slug | anon | /careers/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-05 | Hit an unknown API route | agent | /api/nope | signed-out | no | uncovered | — |
| J-ERR-06 | Get a 404 for /mock routes on prod | anon | /mock/empty-states | signed-out | no | uncovered | — (legacy: states-empty.spec.ts › mock empty surface: ${surface}) |
| J-ERR-07 | Hit a bogus job slug and see the not-found UI | anon | /jobs/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-08 | Get a real 404 status for a bogus job slug | agent | /jobs/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-09 | Hit a bogus company slug on /co | anon | /co/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-10 | Get a real 404 status for a bogus /co slug | agent | /co/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-11 | See the empty company state and search for the name | anon | /companies/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-12 | Hit /watch/<id> signed out and see the login wall | anon | /watch/bogus | signed-out | no | uncovered | — |
| J-ERR-13 | See the route error boundary and recover | anon | (no prod trigger) | signed-out | no | uncovered | — |
| J-ERR-14 | See the global error boundary and reload | anon | (no prod trigger) | signed-out | no | uncovered | — |
| J-ERR-15 | Get a bare 403 from a non-GET API call with no User-Agent | agent | POST /api/contact | signed-out | no | uncovered | — |
| J-ERR-16 | Open /unsubscribe with no token | anon | /unsubscribe | signed-out | no | uncovered | — |
| J-ERR-17 | Reload a 404 deep link and stay on the 404 | anon | /careers/bogus-zzz | signed-out | no | uncovered | — |
| J-ERR-18 | Non-admin signed-in user opening /admin is redirected home (DEFECT: currently renders the panel) | signed-in | /admin | signed-in | no | uncovered | — |

## ADMIN

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-ADMIN-01 | Opens /admin signed out and is redirected to /login?next=/admin | Signed-out visitor | /admin | signed-out | no | covered | admin.spec.ts |

## MODAL

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-MODAL-01 | Parse a 7-role résumé in the importer at 1280x600, 390x844 and 390x420; wheel-scroll the body to the last experience entry and last field, footer Back and confirm stay in view and Back works, page behind does not scroll | anon | /resume (importer open, basic parse) | signed-out | no | covered | modal.spec.ts |
| J-MODAL-02 | Sign-in dialog fits 1280x600, 390x844 and 390x420; its last control is reachable by wheel-scrolling and Close dismisses it | anon | /resume then `topbar-signin` | signed-out | no | covered | modal.spec.ts |
| J-MODAL-03 | Open "Customize résumé" on a role with a guest résumé; the dialog sits above its dim layer (Close is the topmost element), "Use a rules draft" produces a draft, Close dismisses it | anon with a guest résumé | /jobs?view=search&q=engineer, open a role, `local-customize-open` | signed-out | no | covered | modal.spec.ts |
| J-MODAL-04 | Open "Track a role" on /yours as a guest; the Status picker opens above the sheet (an option is the topmost element), picking one sets it, Close dismisses without saving | anon | /yours?view=new | signed-out | no | covered | modal.spec.ts |
| J-MODAL-05 | Open Feedback from the account menu; the menu closes, the Type picker opens above the dialog and picking an option sets it, Cancel closes without sending (dev-server only: signed-in mock) | signed-in | any page, `topbar-avatar` then Feedback | signed-in | no | covered | modal.spec.ts |
| J-MODAL-06 | Customize a role twice with a guest résumé (on-device mode on); each draft starts from the guest's own summary, offers only Close, Copy and Download PDF, and the résumé stored in the browser is unchanged | anon with a guest résumé | /jobs?view=search&q=engineer, open a role, `local-customize-open` | signed-out | no | covered | modal.spec.ts |

## Legacy specs pending repair

Specs in `tests/e2e/` triaged "fix" that no row above cites. Not run by the journey suite; the journey each guards is not covered.

| Legacy spec | Why it does not guard anything |
|-------------|--------------------------------|
| elite-board.spec.ts | Goes to `/?posted=any`; the Concept A poster gate hides `filters-toggle`. Journey: `board=elite` toggle (no row yet). |
| first-pack-reveal.spec.ts | Uses `/mock/for-you-deck`, which 404s on prod; asserts a `for-you-deck-position` testid that does not exist. |
| grok-ux-wave.spec.ts | Rows never mount behind the poster gate; G4 skips silently, G3/G5b/G6 fail on prod (G6 asserts a button that is a link). |
| jobs-first-paint.spec.ts | TC-PAINT-001..004 fail on prod (detector scans the poster; `search-live-count` not visible); needs the onboarding-completed seed. |
| jobs-renamed-city.spec.ts | All 4 tests wait for `location-input` behind the poster gate. Journey: renamed city returns real results (no row yet). |
| jobs-rulebook.spec.ts | `beforeAll` waits 60 s for result rows behind the poster gate; every test times out; dev-server oriented. |

Deleted as stale (no journey behind them): api-search-stability, audit-search, motivational-banner, parallel-loading, privacy-account, quirky-messages, setup-wizard-fix, storage-persistence.
