# Funnel events — wave-3 wiring map

`src/lib/analytics/funnel.ts` defines six event names as a naming contract.
This PR ships that module, its tests, and this map only — **nothing calls it
yet**. Wave 3 wires each `captureFunnelEvent(...)` call into the sites below.

## The six events

| Event | Payload | Intended call site |
|---|---|---|
| `search_submitted` | `{ query_length, has_location, filter_count }` | `src/app/jobs/page.tsx`, `submitSearch(q)` (~line 1236) — the single chokepoint the search box's Enter/suggestion-pick and a recent-search chip click both already route through. |
| `result_clicked` | `{ position, job_id, source }` | `src/app/jobs/page.tsx`, the SERP row's open handler (`JobCard`'s `onClick`, defined ~line 482) and `onOpenRelated` (wired ~line 3331 for the detail pane's "also in" rail) — `position` is the row's index in the current result list, `source` is `"serp"` for both. |
| `apply_clicked` | `{ job_id, source }` | `src/app/jobs/page.tsx`, `handleOpenPosting` (~line 2653), wired to `JobDetailActionBar`/`JobDetail`'s `onOpenPosting` prop (`src/components/jobs/JobDetail.tsx`, the "Apply on Company Site" / "Apply" buttons, ~lines 203 and 584). `source` is `"serp"` from the jobs page, `"co"` from `src/app/co/**`'s job detail rendering, `"email"` from an emailed job link's landing handler. |
| `job_saved` | `{ job_id }` | `src/app/jobs/page.tsx`, `handleGoAfter` (wired ~line 3330 to `JobDetail`'s `onGoAfter` prop) — this is the "Save" button in `src/components/jobs/JobDetail.tsx` (~line 598). Internally this concept is called a "pursuit" (`src/lib/pursuits/use-pursuits.ts`); the event name stays `job_saved` because that's the user-facing verb. |
| `company_followed` | `{ company_domain }` | `src/components/companies/FollowButton.tsx`, `handleClick`'s `if (next)` branch (~line 50) — the same chokepoint that already fires `recordFollowFunnelAction("follow_click", ...)`, so both funnels record a follow the same way. `CompanyFollowControl.tsx` wraps `FollowButton` and needs no separate wiring. |
| `signup_completed` | `{ method }` | `src/lib/firebase/client-auth.ts`: `signUpWithUsername` (~line 86, `method: "username"`) and `signInWithGoogle` (~line 120, `method: "google"`) — the latter fires on sign-IN too, so wave-3 wiring must gate on Firebase's `additionalUserInfo?.isNewUser` (from `getAdditionalUserInfo(userCredential)`) to fire only on an actual signup, not every Google login. There is no separate plain-email/password signup path today — `method: "email"` is reserved for if/when one ships. |

No landing/pageview event is defined here — `POSTHOG_OPTIONS.capture_pageview:
"history_change"` (`src/lib/posthog-options.ts`) already fires a `$pageview`
on every route change, including client-side navigation. Adding a bespoke
`landing_viewed` event would duplicate that.

## Reading the funnel

Once wave-3 wiring ships, these are the six weekly rates the funnel is built
to answer:

1. land → search (`$pageview` on `/jobs` → `search_submitted`)
2. search → result click (`search_submitted` → `result_clicked`)
3. result click → apply (`result_clicked` → `apply_clicked`)
4. visit → follow or save (`$pageview` → `company_followed` or `job_saved`)
5. follow → signup (`company_followed` or `job_saved` → `signup_completed`)
6. D7 return (repeat `$pageview` from the same identified/anonymous user
   within 7 days)

Reading these requires the PostHog dashboard (funnel/retention insights) or
a personal API key — **neither exists in this repo**. This module only makes
the event stream analyzable; querying it is a separate, later step.

## Why `search_submitted` carries `query_length`, not the raw query

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
in. Mirroring `search-log.ts`'s raw-query field into `search_submitted` would
attach a signed-in user's literal search text to their PostHog profile — the
two systems' privacy postures aren't equivalent just because both are
"server-side app telemetry." So `search_submitted` carries only
`query_length` (a count, not content), `has_location`, and `filter_count`.

## Why this module doesn't re-set the `product` super-property

`PostHogProvider` (`src/components/providers/PostHogProvider.tsx`) calls
`posthog.register({ product: POSTHOG_PRODUCT })` exactly once, immediately
after `posthog.init()`. That's the one place intervu's events are stamped
`product: "intervu"` to tell them apart from subspace's inside the shared
PostHog project. `funnel.ts` never calls `posthog.register()` — doing so on
every `captureFunnelEvent()` call would just re-set the same super-property
repeatedly for no benefit, and would create a second place that decision
could drift from the first.
