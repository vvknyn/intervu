# intervu.cc — Phase 1 search journey ("The Single Line")

**Date:** 2026-07-25
**Status:** design, pending approval
**Scope:** the root route (`src/app/page.tsx`) in the intervu repo

---

## Goal

A stranger looking for work lands, types one sentence, and reads a relevant job posting
without ever noticing the site. Everything else the product can do is invisible until
they've been served.

## The one rule

> Nothing appears on screen unless a job seeker would ask for it out loud.

Every element below survives that test or is cut. Nobody says "show me a pipeline card."

## Non-goals for Phase 1

- Accounts, auth walls, plan upsells
- Filter panels and filter chips
- Resume gating of any kind (résumé is *offered*, late, once)
- Saved searches, alerts, email — deliberately deferred (see Phase 1.5)
- Company hiring stats on the detail screen — deferred, needs a pipeline change

---

## Screens

### 1. The line

Full viewport, empty, one input roughly a third down. Placeholder is a real question:
*what kind of work are you looking for?*

- **Present:** the box. Nothing else.
- **Absent:** nav, logo bar, sign-in, footer, marketing copy, illustrations. The page does not scroll.
- Autofocus on desktop. **No autofocus on mobile** — it slams the keyboard up and eats the screen before the question is read.
- Returning visitor: up to three previous sentences as plain grey lines below the box. No heading, no icons, no chips. Tap re-runs. Source: `lib/jobs/recent-searches.ts` (localStorage, no account needed).

### 2. Typing

Keep the existing `SearchAutocomplete`, restrained: max 5 suggestions, real titles and
companies from the corpus, no icons, no category headers, no "trending."

- **Hover/arrow never runs a search.** Enter runs it.

### 3. Results

The box animates to the top and pins. It is the only pinned element.

Directly under it, one small grey line:

```
412 roles from the last 30 days · updated 2 hours ago
```

Both halves exist today (`getJobsFreshnessAction`). The "last 30 days" wording is load-bearing —
see *Data honesty* below.

Each row, in visual weight order:

```
Senior Backend Engineer          <- dominant
Acme · Bengaluru · posted 12 days ago
```

Nothing else — no logo, no badges, no match score, no salary chip unless salary genuinely
exists, no "Easy Apply."

> **No logos on rows.** `CompanyLogo` is imported only by `JobDetail.tsx:121` (`size="lg"`), so
> it is not on result rows today. Adding it is net-new work that buys scanning speed and costs
> a network request per row plus a fallback state for every company without a resolvable domain.
> Cut from Phase 1. It stays on the detail screen, where it already is.

Infinite scroll. No pagination.

> **Why the title dominates:** pass 1 ranks on `title` + `company` only
> (`PRECISION_SEARCH_ATTRIBUTES`, `lib/jobs/meilisearch.ts`). Making the title dominant means
> the thing the engine ranked on is the thing the eye lands on, so the user can see *why* a
> result matched. When visual hierarchy and ranking disagree, correct results still feel arbitrary.

### 4. Thin results (fewer than 10)

The engine already widens automatically (`WIDEN_THRESHOLD = 10`, `shouldWidenSearch`).
The design adds one honest line above the widened block:

```
Only 4 roles are actually titled that. These mention it.
```

This is the ladder out of a bad query — it tells the user their words were too narrow and
hands them the fix, with no question asked and no added latency.

**The widening engine is a three-rung ladder. Each rung ships independently; the sentence above
is identical at every rung, so the screen is never blocked on infrastructure.**

| Rung | Mechanism | Status |
|---|---|---|
| 1 | Strict pass — title + company | built |
| 2 | Keyword widen into descriptions | built |
| 3 | Semantic widen via the `default` embedder | blocked on corpus embedding |

Rung 3 reuses the hybrid path from `feat/resume-semantic-fit`, **with its own blend ratio.**
It must not share `SEMANTIC_RATIO = 0.8` — that value is tuned for résumé-length prose, and a
three-word query embedded at 0.8 drifts into "adjacent" roles that read as wrong. Two callers
with opposite input shapes need a parameter, not a shared global.

### 5. Nothing found, even after widening

Never a blank page. **Never a consolation grid of popular jobs** — that is a lying fallback.

One specific sentence built from what was actually parsed (`query-understanding.ts` already
extracts work-arrangement tokens):

```
Nothing remote for "quantum optics" in the last 30 days. Try dropping "remote".
```

The failed sentence stays in the box, selected, ready to edit.

### 6. Slow or degraded

Matches the posture already in the code — *"honest thin-but-fast beats a timeout"*
(`WIDE_PASS_LATENCY_BUDGET_MS`, written after the 2026-07-24 incident).

- Calm skeleton of ~5 rows. No spinner, no percentage, no bouncing dots.
- Past ~6s, one line: *taking longer than usual.*
- If the client settle guard trips: a plain sentence, not an error page. The search box stays
  usable without a reload.

### 7. Reading a job

Full-screen takeover, on desktop as well as mobile. Escape/back returns to the exact scroll position.

Order: title, company, location, **how long it has been open**, then description.
One action: *apply on their site* → the real posting, new tab.

The age line is the differentiator — "posted 43 days ago, still open" is something most boards
cannot say honestly.

> *Known tension:* the classic desktop pattern is list-left / detail-right, which is better for
> comparing. It also forces a narrow list column and re-introduces persistent chrome. Takeover
> for Phase 1; cheap to flip once there's usage evidence.

### 8. Back to the list

Rows already opened are quietly recessed — no badge, no checkmark. Local only, no account.

### 9. The résumé moment

**Trigger:** third job opened in a session, or the second session. Not a timer, not scroll depth.

One grey line at the bottom of the list: *want these ranked against your actual experience?
drop your résumé.* Dismissible forever with one tap. Never a modal, never mid-scroll, never twice.

---

## Removed from the route — re-parenting plan

Call sites verified 2026-07-25. **Five components are route-only** — they have no import anywhere
except `src/app/page.tsx`, so removing them from the route would orphan the feature outright.
Every one has a natural existing home. **Nothing is deleted; everything is re-parented.**

| Component | Other imports | Destination |
|---|---|---|
| `GhostRadarCard` | none | `/yours` — it's pursuit signal, not search |
| `PipelineCard` | none | `/yours` — same |
| `ResumeUpsellCard` | none | the Screen 9 résumé moment (replaced by one grey line; card retires to `/resume-tailor`) |
| `TailorAnalysisSheet` | none | `/resume-tailor` — auto-tailor already lives there (`aef103c`) |
| `JobsAsk` | none | keep the module; stop rendering it on the primary path |
| `FilterPanel` | `FilterChipsRow`, `search-payload` | unmounted from the route; module stays |
| `FilterChipsRow` | **no import found anywhere** | likely already dead — confirm, then delete |
| `JobDetail` | `/yours/[id]` | **stays** — shared, do not touch |

`AuthPopover` and the `PageLayout` chrome come off the route only.

> The rule that makes this safe: a component with exactly one import is not "on the route,"
> it *is* the feature. Moving it is a product decision about where the feature lives, not a
> layout cleanup, and it needs a destination before it needs a diff.

---

## Data honesty rules

1. **State the 30-day window.** A fresh visit already filters to the last 30 days
   (`DEFAULT_URL_STATE.postedBucket = "30d"`, `lib/jobs/url-state.ts`). With the filter panel
   gone the user can neither see nor change it, so the displayed count is not the corpus.
   Naming it in the freshness line converts a hidden filter into a stated fact.
2. **Counts, not averages.** Any company-level statistic must be a count of observed events,
   never an average over completed ones (see Phase 1.5).
3. **No consolation results.** An empty result set is reported, not padded.
4. **Never promise seniority.** The corpus measured 76% `mid` (classifier dump bucket,
   2026-07-21), which is why seniority is deliberately not filtered. "Senior" in a sentence
   leans on title ranking alone.

---

## Phase 1.5 — company hiring stats (deferred, not dropped)

On the job detail screen, two directly observed counts:

```
Acme opened 41 roles in the last 90 days and closed 12.
```

and for the ~14% of companies that close nothing:

```
Nothing at Acme has closed in the 90 days we've been watching.
```

**Rejected:** "average time to close." It averages only roles that *did* close, so a company
where nothing moves scores well off its two closures — the statistic inverts the answer.
Also: we observe first-sighting, not true posting date; disappearance ≠ filled (repost detection
is dead code); and coverage is limited to verified-scrape boards (~34k of ~385k companies).

**Cost:** a new per-company field carried through the sync job, plus a pinned definition of
"closed." Sits after Phase 1 so the redesign is not held hostage by a pipeline change.

---

## Ship-blocking prerequisite: search logging

About twenty lines, before the redesign lands, not after:

```
(query text, result count, did the wide pass fire, did they open anything)
```

There is currently **no query telemetry at all** — no analytics package, no server-side logging
in the search path, and recent searches never leave the browser. Two reasons this comes first:

1. It converts every remaining design argument into evidence within a week.
2. Once the filter panel is deleted we need to know whether anyone relied on it. Measuring after
   the change tells us nothing, because there is no before.

**Privacy:** log the query text with nothing tying it to a person, and pin the retention window
up front.

---

## Risks

| Risk | Note |
|---|---|
| Deleting filters | Location and work-type survive because typing them works. Salary, company, and date have no such escape hatch. |
| Rung 3 never lands | Acceptable — the screen ships on rungs 1–2. Vector search must never become a dependency. |
| ~~Orphaned features~~ | **Closed 2026-07-25.** Call sites verified; five route-only components each have a destination. See re-parenting plan. |
| Desktop takeover | Disagrees with the dominant pattern for comparing roles. Flip if usage says so. |
| Re-parenting is real work | Moving five features into `/yours` and `/resume-tailor` is its own PR. It must land *before* the route is stripped, or the features are dark in between. |

---

## Build order (decided)

Four PRs, each independently shippable and independently revertable.

| # | PR | Why this position |
|---|---|---|
| 1 | **Search logging** (~20 lines) | Must precede the strip — there is no "before" to measure once filters are gone. |
| 2 | **Re-parent the five features** into `/yours` and `/resume-tailor` | Features must have a home *before* the route loses them, or they go dark. |
| 3 | **Strip the route + the journey** — one line, pinned box, freshness line, thin-results sentence, honest empty state, takeover detail, résumé moment | The redesign itself. Almost entirely subtraction. |
| 4 | **Rung 3: semantic widen** | Only when the corpus actually has vectors. Never a blocker for #3. |

Phase 1.5 (company hiring counts) follows #4 and needs a sync-pipeline change first.

## How we would know this is wrong

If users type a sentence, get results, then immediately retype three or four times in a row,
"just retype" is not a real recovery move and the whole journey is built on a false premise.
Checkable within a week of the logging landing.

---

## Decisions taken as defaults (one-line flips)

1. Freshness line names the 30-day window — *taken*
2. Full-screen takeover on desktop — *taken*
3. ~~Company logos stay~~ → **no logos on rows** — reversed 2026-07-25 once verification showed
   `CompanyLogo` lives only in `JobDetail`. "Keep" was actually "build," and it buys nothing
   the title doesn't already give.
4. Five route-only features are **re-parented, never deleted** — and re-parenting ships as its
   own PR *before* the strip.

---

## Amendments from implementation (2026-07-26)

The redesign shipped as ONE PR, not the planned two. What follows is what the code
disagreed with, and why.

### The re-parenting PR evaporated

The plan above verified how many files import each of the five route-only components. It
never asked what those components *do*, and on that question two of the five have no
destination at all:

| Component | Why it can't move | Outcome |
|---|---|---|
| `PipelineCard` | Renders an "open tracker →" link **to `/yours`**. On `/yours` it would summarise the page it sits on and link to itself. | Unmounted; module kept |
| `GhostRadarCard` | `if (!distribution) return null` — its data is a search's facet distribution. `/yours` runs no search, so it could never draw. | Unmounted; module kept |
| `JobsAsk` | Its content *was* the first screen ("What role are you after? Type a position in the line above"). Screen 1 is that, done properly. | Replaced |
| `ResumeUpsellCard` | Injected after row 0. Replaced by the Screen 9 line at the foot of the read rows. | Replaced |
| `TailorAnalysisSheet` | `page.tsx` never writes `intervu:tailor-job`, so this sheet is the **only** tailor path from search. Unmounting it would go dark. | **Kept, unchanged** |

**The lesson: an import count tells you whether removing something orphans a feature. It
cannot tell you whether the destination makes sense.** Same class of error as the
`CompanyLogo` reversal — a verified fact answering the wrong question.

### Deleting a control can strand the mode it controlled

Removing the legend row and sort trio silently orphaned three escape hatches. Each was
found by the compiler reporting a now-unused handler, not by design review:

- `handleRankByFit` — a returning user with a résumé on file lost every way to rank by it.
  Screen 9 now adapts: *use the résumé on file* when one exists, *drop your résumé* when not.
- `clearFit` — no way to leave fit ranking.
- The explore chip — explore blanks the search box, so its removal left unexplained results
  over an empty box with no exit.

All three now live on the result line. **A mode the user can neither see nor leave is a trap**,
and "delete the control" is not the same as "delete the mode."

### Two screens must be one tree

Screen 1 and Screen 3 were first written as separate `return`s, each with its own
`SearchAutocomplete`. React identifies a component by its position in the element tree, so
the first keystroke unmounted one input and mounted the other — focus went with it.
Verified live: typing "product manager" produced `?q=p`.

They are now one tree whose layout changes. This is also why the route no longer uses
`PageLayout`: its shell is genuinely its own.

### "The bottom of the list" does not exist under infinite scroll

Screen 9 was specified at the foot of the list. With 2,477 matches the foot is never
reached, so it would never render. It now sits above the load-more sentinel — the foot of
what has actually been *read*.

### Ghost flags survived on rows

The spec said no badges. But `hideGhosts: true` filters only `likely_ghost`, so `caution`
and `repost` rows still appear — verified live. A flagged row that says nothing is the
dishonest option, so the flag renders as lowercase words in the meta line
("· caution · stale 6d"), not as a fixed-width verdict column.

### Still on the route, deliberately

- `SearchSeedLine` ("Already interviewing somewhere? Prep for it.") — one grey line, and the
  only entry to the prep-seed flow. Candidate for removal, not removed silently.
- `JobDetail` is unchanged. Screen 7 asks for one action; it currently offers six. It is
  **shared with `/yours/[id]`**, so redesigning it is its own PR.
