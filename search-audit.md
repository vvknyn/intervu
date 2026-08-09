# Search-quality audit — /jobs, job-seeker's eyes (2026-08-08)
Fidelity: BEST achieved — real prod build (`next build`+`next start`, after fixing a stale-node_modules `posthog-js/react` gap) driven via Playwright on the actual `/jobs` UI, real clicks, real typing, live Meili. Control arm = bare `q` + `vacancy_status` filter only, matching golden-queries.mjs's shape.

## Per-query verdict (app top1 vs Meili-control top1)
stripe: app=Stripe✓ ctrl=Stripe✓ — match, both correct
walmart: app=Mars Canada "Walmart Sales Director"✗ ctrl=Tastingtable content-farm✗ — both wrong, different noise
cleveland clinic: app=Iterativehealth "Clinical Research Coordinator"✗ ctrl=**Cleveland Clinic**✓ — APP-ONLY REGRESSION
home depot: app=Generac "Nat'l Acct Mgr (Home Depot)"~ ctrl=Thedailymeal content-farm✗ — app better, still not employer=Home Depot
nurse / registered nurse: app✓ ctrl✓ — both fine
rn: app="Hospice RN Case Manager"~ ctrl~ — both fine (literal RN token present)
software engineer: app✓ ctrl✓ — fine
swe: app=Vattenfall/Sweden✗ ctrl=Msd/Sweden✗ — APP+DATA, both wrong (see class 2)
accountant: app✓ ctrl✓ — fine
acountant (typo): app="Station Accountant"~ ctrl~ — typo tolerance works, thin relevance
remote customer service jobs: app✓ (work_type=remote applied) — fine
part time evening jobs: app✓ (1,303 hits after 4.5s — my first pass under-waited, not a bug)
warehouse jobs in dallas: app top1=Ryder/Lancaster PA✗ (top2=Ryder/Dallas TX✓) ctrl=Ryder/Dallas TX✓ top1 — app demotes the correct match
entry level marketing jobs / jobs near me: app✓ counts, "near me" has zero geo intent (literal word match only — feature gap, not a bug)
stripe software engineer: app✓ ctrl✓ — fine
nurse at cleveland clinic: app=Elara Caring/Mentor OH~ (no real Cleveland Clinic hit in top3) — same class as above
jobs paying $25/hr: app=99 hits, no salary semantics (unsupported, as expected) — fine as documented gap

## Failure classes (ranked by user pain)
1. **Place-token hijack of company/role text** — `query-understanding.ts:119-138,264-273` calls `parsePlaceTokens(q, vocab, guardFreeTextWords=true)` on the WHOLE typed query. `resolve-place.ts:188-219` `resolveCity("cleveland")` matches (gazetteer has Cleveland OH); `resolvePlacePhrase`'s guard (`resolve-place.ts:322`, `GUARD_WORDS`) never blocks it — "cleveland" isn't in `common-words.ts`/`job-vocab.ts` (verified: 0 hits). Query becomes `places=[Cleveland+40 neighbors]` + residual `q="clinic"`, prefix-matched against any "Clinical" job — **zero of top3 are Cleveland Clinic**, confirmed live UI + confirmed the bare-Meili control gets it right (Cleveland Clinic Florida, top1). Same mechanism buries the real Dallas TX hit under a Lancaster PA one. No user-visible disclosure — `effectiveQ` is computed (page.tsx:1723) but never rendered as a "we searched X in Y" chip.
2. **3-letter role abbreviation collides with ISO3 country code** — `resolve-place.ts:135` `resolveCountry`'s `byIso3` branch fires for ANY 3-char token matching an ISO3 code, unguarded. `"swe"` (JOBS_SYNONYMS' own registered abbreviation for "software engineer", `meilisearch.ts:28`) resolves to Sweden before the synonym ever reaches Meili — residual q becomes empty, search degrades to "browse Sweden." Compounded by a data-side issue: corpus `location` values embed raw `"SWE - <region> - <city>"` strings, so even the bare-Meili control's top1 is Sweden-contaminated.
3. **Explicit "newest" sort erases company-match precision** — confirmed via live UI click (not just the code trace): `/jobs?q=stripe`, click "freshest" (`page.tsx:2953-2957`→`chooseSort`, `sort.ts:33-44` `buildMeiliSort`). Result: **"Staff Product Engineer…(Revenue Engineering, Stripe)" at Dash0 jumps to #1**, above real Stripe listings. Root cause: live `rankingRules` (`meilisearch.ts:82`) places `sort` BEFORE `wordPosition`/`exactness` — an explicit sort short-circuits the two rules that separate "IS the company" from "mentions the company." Sticky-sort-across-typed-queries is NOT the bug — `shouldResetSortOnQueryChange` (`url-state.ts:54-63`) correctly resets on any new typed query, verified live (sort param dropped mid-type). The bug is re-sorting an EXISTING company query to Newest, which the app correctly preserves by design (facet/sort changes don't reset) — but Meili's rule order then wrecks it.
4. **Data-side noise** (report only): content-farm rows (Tastingtable/Thedailymeal) win relevance ties for brand-name queries at the bare-index level; brand-name collisions (Walmart AMP venue = Walton Arts Center; vendor postings titled after their client).

## Fix list
- App-fix (no index change): 3 — guard place-resolution against tokens with a registered Meili synonym or company-name hit; surface a "we understood X as location Y" disclosure/undo chip; consider gating auto place-consumption behind a length/frequency floor tighter than the current guard.
- Meili settings (hot-swappable, no reindex per `apply-ranking-rules.mjs` precedent): 1 — move `sort` after `wordPosition`/`exactness` in rankingRules so an explicit sort only breaks ties among already-relevant matches.
- Data-side (report only): 3 — content-farm/article rows in corpus; brand-name string collisions; `location` field embedding raw ISO3 codes as substrings.

## Sticky-sort verdict
NOT the mechanism for cross-query leakage (verified: typing a new query resets `sort=newest` from the URL live). IS the mechanism when a user re-sorts an EXISTING company search to Newest — by design the app preserves that choice, and Meili's `rankingRules` order then buries the true company match (class 3 above).
