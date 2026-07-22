# intervu.cc — Jobs-first "bloom" redesign

**Date:** 2026-07-21
**Status:** Draft — awaiting Vivek's review
**Origin:** Brainstorming session 2026-07-21 (visual companion mockups in `.superpowers/brainstorm/21659-1784677159/content/`, gitignored)

## 1. Vision

intervu becomes a **jobs product**. Search is the main entry point and the retention loop; every other feature is invisible until the user's own behavior makes it relevant, then appears exactly at that moment — "like a flower." Two governing principles:

- **Objective results, emotional experience.** The ranking must be defensibly correct (measured, not vibes); the *feeling* of using the site must be that it is on your side. Founder dogfood is the bar: Vivek should reach for his own site.
- **A surface is visible iff its data exists.** No unlock flags, no feature tours, no static nav. Nav, petals, and personalization all derive from what is true about this user right now.

The app has **two nouns and one verb**:

- **All jobs** — the search surface (root).
- **Yours** — the jobs you are going after (pursuits).
- **Go after this job** — the single verb on every job page. Pressing it makes the job yours; tailoring, tracking, and prep are *stages inside the pursuit*, surfaced one at a time — never three tool offers at once, never a disabled button.

## 2. Information architecture & shell

- Root (`/`) is the search page: wordmark, one obsessively-polished search field, fresh results. No sidebar, no nav items, no feature names. The current 6-item `AppShell` sidebar and mobile bottom tabs are **deleted, not hidden**.
- One minimal top bar everywhere: wordmark left; right side is typography only — `All jobs · Yours` — where the word **Yours** renders iff the user has ≥1 pursuit. Avatar dot (signed in) or a quiet "Log in" text (signed out). Mobile uses the same top bar.
- The landing carries one line of quiet type under the field — the honesty promise: *"Every job here is real. Live-verified this morning."* **Ship-gated:** this line goes live only when the freshness pipe is verified true (see §6 and §9).
- Settings, BYOK, base resume live under the avatar menu — identity-adjacent, not features.
- Job detail remains the existing slide-out on the search page (`?job=<id>`), restyled: freshness as typography ("Posted Tuesday. Verified 6:00 this morning."), one verb button. No pill confetti, no badges, no green dots anywhere in the app.
- Motion language: petals/surfaces *materialize* quietly (one soft breath), never slide/bounce/badge.

## 3. The pursuit entity

A **pursuit** is a job the user is going after. It is the only new concept in the product, and it is plural by nature — ten simultaneous applications are ten rows, never new chrome.

**Storage:** the existing Firestore `applications` collection is extended in place (Firestore is schemaless; rename happens in code only — model type `Pursuit`). Per repo scan 2026-07-21: docs currently hold `{company_name, position, job_url?, applied_at?, status, resume_version_id?, cover_letter?, user_id, …}` with status `applied|interviewing|offer|rejected|withdrawn` (`src/actions/application.ts`).

**Extensions (all optional fields — existing rows are already valid pursuits mid-stage):**

- `stage`: adds `interested` (pressed *Go after*) and `resume_ready` ahead of the existing five. `rejected`/`withdrawn` render as a dimmed **Ended** — data keeps its precision, presentation loses the red.
- `job_id`: Meilisearch listing id; `null` for outside interviews.
- `job_snapshot`: `{title, company, location, description}` captured at go-after time. Listings live only in Meilisearch and expire; the pursuit must carry its own JD or tailor/prep break when the listing dies.
- `interview_date?`.
- Prep linkage: prep plan reference + progress move **onto the pursuit** as a subcollection (`applications/{id}/prep`) — unbounded progress data stays out of the parent doc. Today prep is a 24h server cache (`interview_prep_cache`) plus localStorage-only progress (`src/lib/prep/session-progress.ts`) — ephemeral. A pursuit that "carries its prep" requires durable prep; this is the one genuinely new piece of persistence in the redesign, and it fixes an existing cross-device hole.

**Relations:** `resume_version_id → tailored_resumes` already exists and is inherited. Stories (`stories` collection) stay **global** — they are cross-pursuit assets by design, reachable as a quiet `/stories` shelf from any prep surface; optionally tagged with the pursuit that birthed them (later, not required).

**Guests:** pursuits live in localStorage (same pattern as today's guest resume draft), merged at sign-in. Merge rule: match by `job_id`, keep the more advanced stage. No conflict UI.

**Stage choreography on the pursuit page** (one stage surfaced at a time):

1. `interested` → offer: *Tailor your resume to this role* (opens builder first if no base resume).
2. `resume_ready` → offer: *Finish applying* (+ "I applied" confirmation → `applied`).
3. `applied` → quiet; when the user marks an interview (or sets `interview_date`) → `interviewing`.
4. `interviewing` → offer: *Prep for this interview* (prep runs against the pursuit's snapshot; **P**ersisted).
5. `offer` / **Ended** → closure states; Ended dims, never scolds.

**The search seed (outside interviews):** one quiet, always-present line under search results — *"Already interviewing somewhere? Prep for it."* — creates a pursuit at `interviewing` with a typed company/role (+ optional pasted JD). Deliberately dumb: no company-shaped-query NLP detection, so it can never misfire.

## 4. Routes & redirects

| Today | Becomes | Note |
|---|---|---|
| `/jobs` | `/` | 301; `?job=<id>` deep links preserved |
| `/` (prep flow) | removed from root | reached via pursuit stage 4 or the search seed |
| `/applications` | `/yours` + `/yours/[id]` | 301; kanban becomes next-action list |
| `/library` | `/stories` | 301; no nav presence, linked from prep |
| `/resume-builder`, `/resume-tailor` | unchanged URLs | reached from pursuit resume stage or avatar menu |
| `/settings`, `/account`, `/admin`, `/reset-password` | unchanged | `/dashboard`, `/login` already redirect |

Returning users get a one-time quiet "things moved" note. SEO: root becomes the search page; metadata/OG updated; `/jobs` backlinks preserved by the 301.

## 5. The Yours surface

A list of pursuit rows, each leading with the **next action**, not a status column:

- Row = company — role · stage in words ("Interview Thursday") · next action in green type ("Prep tonight?").
- Ordering: pursuits with upcoming interviews first, then by recency of activity. Ended pursuits dim at the bottom.
- No kanban chrome. Status is typography. Momentum, not bureaucracy.

## 6. Search — the trunk

The whole design rests on search being excellent. Live-probe evidence (2026-07-21, raw Meilisearch on the box): "senior backend engineer" ranked a *Senior Product Marketing Manager* #1 and included a ~500-day-old listing in the top 5; "marketing" returned one marketing title in the top 5 with garbled companies (*Talkdesk2*, *Doordashusa*) above the fold; every broad query echoes the 100k index cap as its count. Config truth (repo scan): stock ranking rules, no synonyms, no `attributesToSearchOn`, resume-match = keyword stuffing with a documented "relevance mush" failure (`src/lib/jobs/resume-match.ts:73-79`).

### Objective leg

1. **Two-pass precision search.** Pass 1: `attributesToSearchOn: [title, company, tags]`. Fallback to description-wide search only when pass 1 is thin (default threshold: <10 hits; tunable constant). Kills description-mention outranking of title matches.
2. **Deterministic query understanding.** Fixed dictionary → filters: seniority tokens → `experience_level`, remote/hybrid/onsite → `work_type`, known geo tokens → location filters; residue remains the query. No LLM, no misfires.
3. **Freshness pressure.** `posted_ts:desc` as final ranking rule + honest date rendering. Note: sampled live hits all carried `posted_ts`, so the "0% populated" reading currently disabling freshness UI (`src/lib/jobs/meilisearch.ts:296`) may be stale after the Jul 19–20 box reconciles — re-measure first; this may unblock for free.
4. **Synonyms & typo tuning.** Curated pack (swe↔software engineer, pm, sre, k8s, …); typo tolerance tuned for short queries.
5. **Honest counts.** Display "10,000+" past a threshold; never echo the `maxTotalHits` cap as a real number.
6. **Resume-aware ranking, structured.** Resume sets the experience filter + a role-family boost — rendered as a visible, removable toggle ("Matching your resume"), never silently and never as keyword soup.
7. **Name hygiene at the sync gate** (cross-repo, Subspace side): garbled company names normalized or held back before they reach the index. Trust leak, not cosmetics.
8. **Golden-query set.** ~30 real queries with expected-top-titles, scored by a script (`scripts/` in this repo) before any relevance change ships. First artifact of the build: turns "feels weak" into a number that goes up. Founder dogfood is the acceptance test on top of it.

### Emotional leg

Top results visibly echo the ask; dates are real and recent-first; no garbled brands above the fold; zero-result screens gracefully broaden ("fewer words, more jobs") instead of dead-ending; results settle instantly without layout jank; every surface either helps or is silent.

### Earned personalization

Preferences are never a settings form. Recent searches remembered locally; repeated filter habits quietly pre-applied **with a visible, removable chip** ("remote first — you always do"); resume presence enables the match toggle. All derived, all reversible, all visible when active.

## 7. Edge cases

- **Listing dies mid-pursuit:** snapshot carries the JD; pursuit page states plainly the listing went down. Honesty extends inward.
- **Same company, two roles:** distinct pursuits (keyed per pursuit, not per company).
- **Guest→auth merge:** by `job_id`, keep the more advanced stage (see §3).
- **Prep without JD:** seed-created pursuits prep from company+role; tailor asks for a pasted JD when needed.
- **Credits/BYOK:** unchanged — credit gate fires on AI generations (tailor analysis, prep plan) via the existing `credit-gate.ts`; balance surfaces in the avatar menu and at spend moments only.
- **Auth timing:** unchanged model — browse and go-after work signed out; the popover appears at persistence/AI moments.

## 8. Migration

Nothing to backfill. Existing `applications` rows are valid pursuits mid-stage; `tailored_resumes` links survive; stories stay global. "Yours" appears for existing users because their data exists — the visibility rule does the migration. Legacy URLs 301 (§4). The dead `supabase/migrations/` tree (no runtime wiring; Firestore is the DB) is deleted in the final phase.

## 9. Dependencies & risks

- **Freshness truth gates the promise line.** *"Live-verified this morning"* ships only when the Subspace-side sync is verified healthy (the P2-b/c work on the interview-os side: sync timers + `posted_ts`/freshness_tier). Everything else in this spec is intervu-repo-only.
- **posted_ts population reading may be stale** (see §6.3) — re-measure before building around its absence.
- **Corpus name-quality** (garbled companies) is a Subspace-side fix; intervu can only mitigate (e.g., display-name cleanup) until the gate exists upstream.
- **CI lint was red at merge-base as of Jul 19** (memory, not re-verified) — if still true, fix inside the first PR so subsequent PRs merge clean without `--admin`.
- **Prep durability** changes data shape mid-flight; guard with a read-path that tolerates both old (cache/localStorage) and new (pursuit-attached) prep state during rollout.

## 10. Phasing — five PRs, each shippable alone

| # | Name | Contents | Depends on |
|---|---|---|---|
| S1 | **The trunk** | Two-pass search, query-token parsing, synonyms, honest counts, zero-state, golden-query script + baseline score | nothing |
| 1 | **The flip** | Jobs to `/`, all redirects, two-word top bar, sidebar deleted; CI lint fix if still red | nothing (parallel with S1) |
| 2 | **The pursuit** | `Pursuit` model over `applications`, *Go after this job* verb, `/yours` list + pursuit page, next-action rows | 1 |
| 3 | **The stages** | Tailor/applied/interview/prep wired into pursuit, durable prep, search seed line, `/library`→`/stories` | 2 |
| 4 | **The breath** | Materialize motion, typography freshness, empty states, promise line (if pipe verified), earned-personalization chips, resume-aware toggle, dead-code deletion (old nav, prep root, supabase tree) | S1, 3; promise line additionally gated on box-side sync health |

Box-side (parallel, other repo/boxes): freshness re-measure → enable `posted_ts` ranking; sync hygiene gate for company names.

## 11. Out of scope

- Monetization changes (Stripe purchase flow stays "fast-follow" as today).
- Job alerts / saved-search notifications.
- Vector/hybrid semantic search — only if S1's golden-query score proves keyword+structure insufficient; requires box-side Meili version check first.
- Native/mobile apps; admin surface changes.
- Automatic pursuit-stage inference from email/ATS integrations.

## 12. Success criteria

1. Golden-query score: baseline recorded before S1; every top-5 for the golden set contains ≥3 title-relevant results after S1 (measured by the script, tracked in the repo).
2. Founder dogfood: Vivek reaches for intervu for a real search and says so.
3. A new visitor sees zero feature names before their behavior earns them; every legacy URL lands somewhere correct (redirect tests).
4. Ten simultaneous pursuits produce zero additional chrome (design invariant, checked in review).
5. No regression in auth/credit gating (existing popover + credit-gate behavior unchanged).

## Appendix — decision history (session 2026-07-21)

1. Identity: **jobs product with companions** (over pursuit-pipeline-as-app and prep-with-jobs-front-door).
2. Bloom model: earned & persistent petals (over ephemeral-only and minimal-shell) — later **superseded** by:
3. The Apple pass collapse: **All jobs / Yours, one verb** — R/T/P petals dissolved into stages inside each pursuit. Multi-job handling became structural.
4. Prep entry: **search is the seed** (over tracker-only and permanent side door).
5. Search elevated to its own workstream (S1) ahead of the flip after live probes confirmed weak relevance.
