# Pursuit detail, auto-analyse, prompt-first landing

Date: 2026-07-25
Status: approved (Vivek, 2026-07-25)

Three changes, independently revertible. #1 and #2 are self-contained; #3 changes what
every visitor sees first and carries the test blast radius.

## 1 — Job detail on the pursuit screen

**Problem.** `/yours/[id]` shows a company/position snapshot with no way to see the
posting it came from. The job detail UI exists, but as `JobDetail` declared inline in
`src/app/page.tsx` (~lines 590–793 of a 3,654-line file), reachable only from `/`.

**Change.** Extract `JobDetail` into `src/components/jobs/JobDetail.tsx`, and the pure
verdict/freshness helpers it needs into `src/lib/jobs/verdict.ts`. `page.tsx` imports
both back — no behaviour change there, and one oversized file gets smaller. `/yours/[id]`
then renders the same `Sheet` + `JobDetail`, fed by the existing single-job fetch
(`searchJobsAction({ id, limit: 1, offset: 0 })`).

**Decided:** the card is interactive **only when `pursuit.job_id` exists**. Manual
pursuits have no linked posting, so they stay non-interactive rather than opening a
sheet that promises detail we don't have.

**Honest failure.** A `job_id` whose posting has left the corpus returns no hit. The
sheet says the posting is no longer live. It never spins indefinitely and never
substitutes snapshot data for live data.

## 2 — Auto-analyse on arrival, straight to recommendations

**Problem.** "Tailor your resume to this role" links to
`/resume-tailor?company=X&position=Y`. Those two strings carry no posting text, so the
tailor page cannot analyse anything — the user re-enters what the pursuit already knows.

**Change.** Link carries identity instead: `?pursuit=<id>`. On mount the tailor page
resolves posting text in order `job_id` → `job_url` → snapshot, then runs
`analyzeJobRequirements` followed by `generateTailoringRecommendations`, and opens the
existing sheet on its `recommendations` view.

**Guards.** This fires with no click, so:

- Runs **once per pursuit id**, ref-guarded — not once per render.
- Requires a résumé on file. Without one, the existing "upload first" state shows.
  No silent spinner.
- Failures land in the existing error slot. A failed analysis never renders as an
  empty-but-successful recommendation set.
- Result is cached on the pursuit so revisiting does not re-bill.

**Cost.** Two LLM calls per navigation, unprompted. The cache is what keeps this from
being a credit leak on back-navigation.

## 3 — Prompt-first landing

**Problem/intent.** The root route runs an empty-query browse on every cold visit and
shows all live roles. Vivek wants the first screen to ask for a position or a résumé.

**Change.** With no query and no résumé-rank state, `/` renders the ask instead of
running a search. Two actions, both existing paths: submit the search box, or
`handleUploadClick` for the résumé-rank flow.

Visible: masthead, search line, corpus count, pipeline rail (user data, not search data).
Hidden until a search exists: filter legend, sort row, result-count line, ghost radar.

**This reverses a prior decision.** Task 4 deleted `JobsEntryGate` and
`jobs-first-screen.spec.ts` asserts rows appear with zero interaction. Those assertions
invert: the ask must render, and a typed query must reveal rows. The negative gate check
(no "No, I'll search" CTA) still holds and stays. `enterBrowseMode()` — used across both
jobs suites — must perform a search before waiting on the listbox.

**Consequences.**

- Removes the default empty-query browse, the slow Meilisearch path implicated in the
  browse-unavailable incidents. Cold visits stop firing the most expensive query.
- Visitors and crawlers land on an empty ask instead of live roles. Real
  first-impression and SEO change; the piece most likely to feel wrong in production,
  and the reason it is kept independently revertible.

## Testing

| Change | Test |
|---|---|
| 1 | Linked pursuit opens the sheet; manual pursuit is not interactive; dead `job_id` states the posting is gone |
| 2 | Arriving with `?pursuit=` opens recommendations without a click; runs once, not per render; no résumé → upload state, not a spinner |
| 3 | Ask renders with no query; typing a query reveals rows; upload path still reaches résumé-rank |

Existing suites must show no new failures against a same-machine baseline on
unmodified `main`, with live Meilisearch data.
