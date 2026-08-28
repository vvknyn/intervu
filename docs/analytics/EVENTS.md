# Analytics event catalog

`src/lib/analytics/events.ts` defines every wire name as a naming contract —
`ANALYTICS_EVENTS`. It started as `funnel.ts`, six wave-3 events covering
search → apply → save/follow → signup; this file generalizes that same
catalog to every entity worth a funnel (job, company, search, application
tracker) without opening a second place an event name could be decided.

**Status: wired.** `tests/unit/events-wiring.test.ts` asserts per-event that a
call site exists in `src/`, so an event can no longer be declared and left
dead — the table below is what the code does, not what a doc promises.

## The original six (wave-3)

| Event | Payload | Seam (file:line) |
|---|---|---|
| `search_submitted` | `{ query_length, has_location, filter_count }` | `src/app/jobs/page.tsx:1395` — `submitSearch(q)`, the single chokepoint the search box's Enter/suggestion-pick and a recent-search chip click both route through. |
| `result_clicked` | `{ position, job_id, source }` | `src/app/jobs/page.tsx:2310` — a SERP row's open handler. `position` is the row's index in the current result list, `source` is `"serp"`. |
| `apply_clicked` | `{ job_id, source }` | `src/app/jobs/page.tsx:3256` — the **first line** of `handleOpenPosting`, before the auth gate and the AI hand-off prompt, so the event means "clicked Apply" and not "reached the posting." `source` is `"serp"`; `"co"` and `"email"` stay in the type but are **not reachable today** — `src/app/co/**` has no apply handler of its own, and there is no emailed-link landing handler. |
| `job_saved` | `{ job_id }` | `src/app/jobs/page.tsx:3376,3397` (guest and signed-in `handleGoAfter` branches) and `src/components/jobs/PublicJobDetail.tsx:230,247` (same two branches, `/co`'s job-detail wrapper). The `/co` pair was a real gap this wave closed — `handleGoAfter` there never fired the event at all before. Internally this concept is called a "pursuit" (`src/lib/pursuits/`); the event name stays `job_saved` because that's the user-facing verb. |
| `company_followed` | `{ company_domain }` | `src/components/companies/FollowButton.tsx:172` — the same chokepoint that already fires `recordFollowFunnelAction("follow_click", ...)`, so both funnels record a follow the same way. `CompanyFollowControl.tsx` wraps `FollowButton` and needs no separate wiring. |
| `signup_completed` | `{ method }` | `src/components/auth/login-form.tsx:144`, immediately after `signUp(...)` returns without an error (`method: "username"`). ⚠️ **PARTIAL — counts the username/password form only.** Google moved to WorkOS AuthKit (`startAuthKit("GoogleOAuth")`), a full-page redirect whose callback is server-side, where posthog-js does not run — AuthKit signups are **uncounted rather than guessed at**. Closing the gap needs server-side capture (posthog-node) or `/auth/callback` handing an explicit new-user signal back to the client. Deriving it from `user.createdAt ≈ now` would be an inference, not a fact, and is deliberately not done. |

No landing/pageview event is defined here — `POSTHOG_OPTIONS.capture_pageview:
"history_change"` (`src/lib/posthog-options.ts`) already fires a `$pageview`
on every route change, including client-side navigation.

## Job entity

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `job_viewed` | `{ job_id, company_domain, source }` | `src/components/jobs/JobDetail.tsx:322` and `src/components/jobs/JobDetailDocument.tsx:273` — a `useEffect` keyed on `[job.id, source]`, so a job re-opened in the same mount (e.g. toggling between two SERP rows) fires once per job, not once per render. `source` is threaded down from every render call site (`PublicJobDetail`'s computed default, `jobs/page.tsx`'s `"serp"`, `/co`'s `"co"`, `/yours/[id]`'s `"direct"`). | detail-view volume per source; view→save/apply drop-off. |
| `job_unsaved` | `{ job_id }` | `src/app/yours/page.tsx:390` — the tracker's remove action, guarded on the delete actually succeeding (`removed === true`) so a failed delete never reports a removal that didn't happen. | unsave rate, tracker churn. |
| `job_marked_applied` | `{ job_id }` | `src/app/jobs/page.tsx:3291` and `src/components/jobs/PublicJobDetail.tsx:162` — `doMarkApplied`, both call sites of the SERP and `/co` trackers. | apply-confirmation rate downstream of `apply_clicked`. |
| `job_shared` | `{ job_id, method }` | `src/lib/share/share-decision.ts:111` — `performShare`'s job-surface branch (a `jobId` is present on the `ShareRequest`). Wire name is kept as the pre-existing `"share_initiated"` (previously sent by the untyped `trackEvent` in `lib/analytics.ts`) so this doesn't fork an existing dashboard metric — job-surface shares now additionally carry `job_id`. Non-job shares (e.g. the top-bar "Share Velai" menu item) still go through the old untyped `trackEvent("share_initiated", ...)` without a `job_id`. | share volume per job; native vs. clipboard split. |
| `job_match_expanded` | `{ job_id }` | `src/components/jobs/MatchChip.tsx:43` — the match-score chip's `ContextHelp` tooltip `onOpenChange`, fired only on open (not close) and only when a `jobId` was passed in. | résumé-match receipt engagement rate. |

## Company entity

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `company_viewed` | `{ company_domain }` | `src/components/companies/CompanyFollowChannelProvider.tsx:26` — every `/co/[slug]` mount wraps its page in this provider exactly once, so it's the one place a company page view is guaranteed to fire from, keyed on `[domain]`. | company page traffic; view→follow drop-off. |
| `company_unfollowed` | `{ company_domain }` | `src/components/companies/FollowButton.tsx:139` (guest, contact-cookie unfollow) and `:176` (signed-in unfollow). | unfollow rate. |

Not wired: `company_band_expanded` `{ company_domain, band }` — no band
expand/collapse UI exists on `/co` today (checked: no such control in
`src/components/company/**` or `src/app/co/**`). Skipped per design item 2's
"if band expand/collapse UI exists" gate rather than wired to a
nonexistent seam.

## Search / SERP

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `search_zero_results` | `{ query_length, filter_count }` | `src/app/jobs/page.tsx:2032` — inside the debounced search effect, right after a result with `hits.length === 0` lands, guarded on `!isPristineLanding` so the zero-query initial mount (not a failed search) never counts. | zero-result rate, the search-quality signal `search_submitted` alone can't answer. |
| `search_filter_applied` | `{ facet }` | `src/app/jobs/page.tsx:2933` — `applyFilterState`, looping `changedFilterFacets(prev, next)` (pure diff, `src/components/jobs/FilterPanel.tsx`) and capturing once per facet that actually changed value, not once per call (a single filter action can touch more than one facet, e.g. clearing "all filters"). | facet-level refinement volume. |
| `search_results_paged` | `{ depth }` | `src/app/jobs/page.tsx:2802` — `loadMore`, fired once per genuinely-served page (`depth` = 1-indexed page number), never for a gated/refused response. | scroll depth into results. |
| `results_impressed` | `{ job_ids, count, source }` | `src/lib/jobs/use-result-impressions.ts:47`, mounted on `#jobs-results-list` from `src/app/jobs/page.tsx`. An `IntersectionObserver` (threshold 0.5) plus a `MutationObserver` (for rows added by infinite scroll or a new search) feed a 1s-debounced batch flush — one event per burst of rows scrolled into view, not one per card. The batching/dedupe decision itself is pure (`src/lib/jobs/impression-batch.ts`, tested independently of the DOM in `tests/unit/impression-batch.test.ts`); a job already flushed this mount is never re-added to a later batch even if scrolled past again. | true impression-to-click rate (currently only inferable from `result_clicked` alone, with no denominator). |

## Application tracker

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `application_stage_changed` | `{ job_id, from_stage, to_stage }` | `src/app/yours/page.tsx:365` — the tracker row's stage-select `onStatusChange`, guarded on the pursuit having a real `job_id` (a tracked "outside interview" has none). `from_stage` is read before the mutation, `to_stage` after — deliberately not inside the shared `mutate()` helper (also used for note-saves and interview-date patches) since folding it in there would misattribute non-stage-change patches. | stage-funnel conversion (interested → applied → interviewing → ...). |
| `resume_uploaded` | `{}` | `src/components/settings/YourResumeSection.tsx:454` — `ResumeUploadForm`'s `handleSave`, right after `uploadBaseResumeAction` returns without an error and before `onSaved()`. | base-résumé upload volume. |

Not wired: `onboarding_step_completed` `{ step }` — no onboarding-step seam
was found (checked `src/app/(onboarding)/**`, settings, and the signup flow
for a step-indexed wizard); this codebase's signup is a single form, not a
multi-step onboarding flow. Skipped rather than invented.

## Reading the funnel

1. land → search (`$pageview` on `/jobs` → `search_submitted`)
2. search → impression → result click (`search_submitted` →
   `results_impressed` → `result_clicked`)
3. result click → view → apply (`result_clicked` → `job_viewed` →
   `apply_clicked` → `job_marked_applied`)
4. visit → follow or save (`company_viewed`/`$pageview` → `company_followed`
   or `job_saved`)
5. follow/save → signup (`company_followed` or `job_saved` →
   `signup_completed`)
6. save → stage progress (`job_saved` → `application_stage_changed`,
   repeated per stage move)
7. D7 return (repeat `$pageview` from the same identified/anonymous user
   within 7 days)

Reading these requires the PostHog dashboard (funnel/retention insights) or
a personal API key — **neither exists in this repo**. This module only makes
the event stream analyzable; querying it is a separate, later step.

## Why `search_submitted` and `search_zero_results` carry lengths, not the raw query

`src/lib/jobs/search-log.ts` already logs the raw query server-side (`q: raw
.slice(0, SEARCH_LOG_Q_MAX)`, capped at 200 chars, to Firestore's
`search_events`) — so raw-query logging already happens in this codebase.
But that module's own doc comment calls it "deliberately anonymous": no uid,
no IP, no user agent, and `searchId` is random per search specifically so an
entry can't be chained back to one person's history.

PostHog's posture is different, and worse for this specific purpose:
`PostHogProvider` calls `posthog.identify(uid)` on sign-in
(`POSTHOG_OPTIONS.person_profiles: "identified_only"`), so anything captured
through PostHog can be tied to an identified person's profile once they sign
in. Mirroring `search-log.ts`'s raw-query field into a PostHog event would
attach a signed-in user's literal search text to their PostHog profile — the
two systems' privacy postures aren't equivalent just because both are
"server-side app telemetry." So every search-adjacent event carries only
`query_length` (a count, not content).

## Why this module doesn't re-set the `product` super-property

`PostHogProvider` (`src/components/providers/PostHogProvider.tsx`) calls
`posthog.register({ product: POSTHOG_PRODUCT })` exactly once, immediately
after `posthog.init()`. That's the one place intervu's events are stamped
`product: "intervu"` to tell them apart from subspace's inside the shared
PostHog project. `events.ts` never calls `posthog.register()` — doing so on
every `captureEvent()` call would just re-set the same super-property
repeatedly for no benefit, and would create a second place that decision
could drift from the first.

## The old untyped `trackEvent` (`src/lib/analytics.ts`)

Predates this catalog and is not deleted: `src/lib/share/share-decision.ts`
still calls `trackEvent("share_initiated", { surface, method })` for
non-job-surface shares (e.g. the top-bar "Share Velai" menu item, which has
no `job_id` to carry). That's its only remaining caller. `job_shared`
(above) covers the job-surface case through the typed catalog instead —
`trackEvent` stays alive only for the case that doesn't fit `EventPayloads`'
shape (no entity id to key on).
