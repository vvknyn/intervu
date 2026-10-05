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
| `result_clicked` | `{ position, job_id, source, query_id?, posted_age_days?, match_label?, match_score?, match_band? }` | `src/app/jobs/page.tsx:2384` — a SERP row's open handler (`openJob`). `position` is the row's index in the current result list, `source` is `"serp"`. `query_id` (added for the ledger's position-corrected CTR, SPEC §5) is `resultRef.current?.searchId` — the id of the rendered result set the click came from, stable across `loadMore` pagination, and the SAME value `results_impressed` stamps below. Absent only when there's no resolved search to attribute to. `posted_age_days` is whole days since the opened row was posted (`posted_ts`, floored at 0; `postedAgeAnalyticsProps`, `src/lib/analytics/posted-age-props.ts`), omitted when the row has no posted date; it shows whether searchers open fresh or older roles, which the default posted window is tuned on. Optional match fields (`match_label`: `"Strong"` \| `"Good"` \| `"Stretch"`, `match_score`: 0–100 integer, `match_band`: `"strong"` \| `"good"` \| `"stretch"`) come from the SERP's precomputed `matchScores` map when a signed-in résumé score exists — omitted entirely when there is no score (never null or a fabricated 0). |
| `apply_clicked` | `{ job_id, source, query_id?, match_label?, match_score?, match_band? }` | `src/app/jobs/page.tsx:3551` — the **first line** of `handleOpenPosting`, before the auth gate and the AI hand-off prompt, so the event means "clicked Apply" and not "reached the posting." `source` is `"serp"`; `"co"` and `"email"` stay in the type but are **not reachable today** — `src/app/co/**` has no apply handler of its own, and there is no emailed-link landing handler. `query_id` has the same `resultRef.current?.searchId` contract as `result_clicked`. Optional match fields use the same shape and omission rules as `result_clicked` (from `matchScores` when available). |
| `job_saved` | `{ job_id, match_label?, match_score?, match_band? }` | `src/app/jobs/page.tsx` (guest and signed-in `handleGoAfter` branches) and `src/components/jobs/PublicJobDetail.tsx` (same two branches). Optional match fields use the same shape and omission rules as `result_clicked` — attached from the in-scope résumé score when one exists, omitted entirely otherwise. Internally this concept is called a "pursuit" (`src/lib/pursuits/`); the event name stays `job_saved` because that's the user-facing verb. |
| `company_followed` | `{ company_domain }` | `src/components/companies/FollowButton.tsx:172` — the same chokepoint that already fires `recordFollowFunnelAction("follow_click", ...)`, so both funnels record a follow the same way. `CompanyFollowControl.tsx` wraps `FollowButton` and needs no separate wiring. |
| `auth_started` | `{ reason, gate_reason, origin_surface?, trigger_type?, pending_action_id?, job_id?, return_to?, has_resume?, signed_in?, guest_save_count? }` | Fires on real auth method engagement in **`src/components/auth/login-form.tsx`** (Google / username submit / passkey-or-email-code), NOT on AuthPopover open or `/login` mount. `trigger_type: "user"`. Reason is the current gate attempt (`lastGateReason`), or `"generic"` when none is stored (`/login` still begins a `"topbar"` attempt before the form mounts). `auth_method_selected` still fires alongside as the method detail. Passive prompts use `auth_nudge_shown` instead. Apply never auth-gates — tracker sign-in uses `reason: "tracker"`. |
| `auth_nudge_shown` | same shape as `auth_started` | Passive/unsolicited auth prompts only (`trigger_type: "auto"`), on AuthPopover open. Explicit fit/save/tailor/resume/tracker clicks must NOT land here. Closing the modal is not `auth_started`. |
| `auth_method_selected` | `{ method, first_gate_reason?, last_gate_reason?, pending_action_id?, origin_surface? }` | **`src/components/auth/login-form.tsx`** — username submit and AuthKit buttons (Google, passkey-or-email-code). Fires immediately after `auth_started` on those same seams. |
| `signup_completed` | `{ method, first_gate_reason?, last_gate_reason?, pending_action_id?, origin_surface? }` | **Username/password:** `login-form.tsx`, only when `signUp` returns `signupCompleted`. **AuthKit:** `PostHogProvider` after `identify`, only when `/auth/callback` set the signal cookie. Both gated by `claimSignupEvent` (`src/lib/auth/signup-event.ts`): WorkOS `createdAt` inside 1h + an atomic once-per-uid claim on `profiles/<uid>.signup_event_at`. At most one per user id, ever. Gate continuity from `src/lib/auth/gate-attempt.ts`. |
| `turnstile_error` | `{ code, surface }` | `src/components/ui/turnstile-widget.tsx` — the one Turnstile wrapper, on Cloudflare's `error-callback` or a failed api.js load. `code` is Cloudflare's numeric error code (`110200` = hostname not authorized) or `script_load_failed`; `surface` is `signup` / `contact` / `waitlist` / `follow_email` / `search_alert`. No PII. Alert on any volume: every occurrence is a visitor who could not pass the human check. |

No landing/pageview event is defined here — `POSTHOG_OPTIONS.capture_pageview:
"history_change"` (`src/lib/posthog-options.ts`) already fires a `$pageview`
on every route change, including client-side navigation.

## Job entity

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `job_viewed` | `{ job_id, company_domain, source, match_label?, match_score?, match_band? }` | `src/lib/analytics/use-job-viewed-capture.ts` (called from `src/components/jobs/JobDetail.tsx` and `src/components/jobs/JobDetailDocument.tsx`) — at most once per `job.id` mount via a ref; a `signedIn` flip alone never re-fires. Standalone `/jobs/[slug]` and `/co` views (`PublicJobDetail`) pass `matchPending` until the in-flight auth callback and résumé read settle, so match fields attach when a score exists; a view that unmounts or switches jobs before that read settles still counts once, without match fields (flush on `[job.id]` cleanup only). SERP detail (`jobs/page.tsx`) passes a precomputed `matchScore` from the card's `matchScores` map — no extra résumé fetch. Optional match fields use the same shape as `result_clicked`; omitted entirely when there is no score. | detail-view volume per source; view→save/apply drop-off; match-band vs. funnel outcomes. |
| `job_unsaved` | `{ job_id }` | `src/app/yours/page.tsx:390` and `src/app/yours/[id]/page.tsx` (the full pursuit page's Remove) — the tracker's remove action, guarded on the delete actually succeeding (`removed === true`) so a failed delete never reports a removal that didn't happen. | unsave rate, tracker churn. |
| `job_marked_applied` | `{ job_id, match_label?, match_score?, match_band? }` | `src/app/jobs/page.tsx` and `src/components/jobs/PublicJobDetail.tsx` — `doMarkApplied`, both call sites of the SERP and `/co` trackers. Optional match fields use the same shape and omission rules as `apply_clicked`. | apply-confirmation rate downstream of `apply_clicked`; match-band vs. confirmed applies. |
| `job_shared` | `{ job_id, method }` | `src/lib/share/share-decision.ts:111` — `performShare`'s job-surface branch (a `jobId` is present on the `ShareRequest`). Wire name is kept as the pre-existing `"share_initiated"` (previously sent by the untyped `trackEvent` in `lib/analytics.ts`) so this doesn't fork an existing dashboard metric — job-surface shares now additionally carry `job_id`. Non-job shares (e.g. the top-bar "Share Velai" menu item) still go through the old untyped `trackEvent("share_initiated", ...)` without a `job_id`. | share volume per job; native vs. clipboard split. |
| `job_match_expanded` | `{ job_id, match_label?, match_score?, match_band? }` | `src/components/jobs/MatchChip.tsx` — the match-score chip's `ContextHelp` tooltip `onOpenChange`, fired only on open (not close) and only when a `jobId` was passed in. The chip always has a score, so match fields are attached from that score. | résumé-match receipt engagement rate by band. |

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
| `results_impressed` | `{ job_ids, positions, count, source, query_id? }` | `src/lib/jobs/use-result-impressions.ts:62`, mounted on `#jobs-results-list` from `src/app/jobs/page.tsx` with a `queryId` (`result?.searchId`, stable across `loadMore` pagination, fresh on every new/refined search). An `IntersectionObserver` (threshold 0.5) plus a `MutationObserver` (for rows added by infinite scroll or a new search) feed a 1s-debounced batch flush — one event per burst of rows scrolled into view, not one per card. `positions` is 1-based, parallel to `job_ids` (read off each row's `data-position`, stamped by `JobCard`). The batching/dedupe decision itself is pure (`src/lib/jobs/impression-batch.ts`, tested independently of the DOM in `tests/unit/impression-batch.test.ts`) and is keyed on `${queryId}:${jobId}`, **not** `jobId` alone — a job already flushed under the CURRENT query is never re-added, but a new/refined query (a new `queryId`, which also re-arms the hook) makes every row eligible again, so a job present across several refinements gets impressed once per refinement rather than only once per page mount. | true, position-corrected impression-to-click rate (join `results_impressed` to `result_clicked`/`apply_clicked` on `query_id`). |
| `list_rendered` | `{ phase, ms, surface, rows, viewport }` | `src/lib/analytics/use-list-render-timing.ts`, called from `src/app/jobs/JobsContent.tsx` beside `useResultImpressions`. Once per result set (keyed on `searchId`), two animation frames after its rows commit. `phase: "first_load"` only for the first list of a page load that started at `/jobs`, with `ms` from navigation start; every other list is `phase: "search"`, timed from when its request started (after the typing debounce). `surface` is `"browse"` for the default list (no query or filters), else `"search"`. `viewport` is `"narrow"` below the `lg` breakpoint. | The 2-second list budget on real devices: p50/p95 of `ms` by `phase` and `viewport`. |

## Application tracker

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `application_stage_changed` | `{ job_id, from_stage, to_stage }` | `src/app/yours/page.tsx:365` — the tracker row's stage-select `onStatusChange`, and the same status row on the full pursuit page (`src/app/yours/[id]/page.tsx`, xl+), guarded on the pursuit having a real `job_id` (a tracked "outside interview" has none). `from_stage` is read before the mutation, `to_stage` after — deliberately not inside the shared `mutate()` helper (also used for note-saves and interview-date patches) since folding it in there would misattribute non-stage-change patches. | stage-funnel conversion (interested → applied → interviewing → ...). |
| `resume_uploaded` | `{ surface?: string }` — optional origin surface (`post_signup`, gate attempt origin surface, `jobs`, `settings`) | Terminal cloud save — `YourResumeSection.tsx` and signed-in `jobs/page.tsx` `handleImport`. | base-résumé upload volume. |
| `resume_gate_shown` | privacy-safe funnel props | `ResumeImportModal.tsx` on open. | résumé funnel entry. |
| `resume_upload_started` | `{ reason?, source?, surface?, signed_in? }` | `ResumeImportModal.tsx` parse click. | upload intent. |
| `resume_upload_selected` | `{ source: drop\|picker, file_type, size_bucket, ... }` | file pick/drop. | input method mix. |
| `resume_upload_accepted` | `{ file_type, source, ... }` | review confirm. | accepted uploads. |
| `resume_upload_rejected` | `{ error_class, ... }` | low-confidence reject. | rejection reasons. |
| `resume_parse_started` | `{ surface?, signed_in? }` | parse step begins. | parse latency start. |
| `resume_parse_succeeded` | `{ duration_ms, parser_source, section_count, warning_count, ... }` | on-device parse completes. | parse success rate. |
| `resume_parse_failed` | `{ error_class, ... }` | parse error (stable codes only — never raw messages). | parse failure mix. |
| `resume_review_completed` | `{ section_count, warning_count, edited?, ... }` | user confirms review step. | review completion. |

Privacy: résumé funnel events never include filenames, emails, file contents, or raw error strings. Helpers in `src/lib/analytics/resume-funnel.ts`.

Not wired: `onboarding_step_completed` `{ step }` — no onboarding-step seam
was found (checked `src/app/(onboarding)/**`, settings, and the signup flow
for a step-indexed wizard); this codebase's signup is a single form, not a
multi-step onboarding flow. Skipped rather than invented.

## Pricing (willingness-to-pay test)

| Event | Payload | Seam (file:line) | Feeds |
|---|---|---|---|
| `pricing_viewed` | `{ signed_in, founding_available }` | `src/app/pricing/pricing-client.tsx` — on mount. `founding_available` is whether `FOUNDING_MEMBER_CHECKOUT_URL` was set (a real Stripe link behind the button) or the button read "opening soon"; it is the denominator that makes `upgrade_clicked` rates comparable across deploys. `$pageview` already fires for the route; this event exists so the founding-state is on the record. | pricing-page reach; visitor → price-click rate. |
| `upgrade_clicked` | `{ plan: "pro_founding" \| "data_api", signed_in }` | `src/app/pricing/pricing-client.tsx` — the founding-seat button (`pro_founding`; the visitor is leaving for Stripe) and the Data API "tell us your use case" link (`data_api`, goes to `/contact?from=/pricing`). Fires on click, before navigation; no price in the payload — prices are constants in `src/lib/billing/founding-offer.ts`. | the whole test: how many of ~1,100 monthly visitors click a price, per plan, signed-in vs. out. |
| `founding_seat_reserved` | `{ signed_in }` | `src/app/pricing/founding-reserve-form.tsx` — after `reserveFoundingSeat` (`src/actions/founding-seat.ts`) saved the address, while `FOUNDING_MEMBER_CHECKOUT_URL` is unset and the Pro column takes reservations instead of linking to Stripe. `upgrade_clicked` fires first on the same submit with `mode: "reserve"`. No email in the payload; the row is Firestore `founding_waitlist`, counted on /admin under Waitlist. | reservations before the Stripe link exists; click → reserve conversion. |
| `landed_pledge_clicked` | `{ job_id }` | `src/components/tracker/LandedPledgePanel.tsx` — the "Pay it forward" button shown in the pursuit detail sheet once a pursuit is in the Offer lane, while `LANDED_PLEDGE_CHECKOUT_URL` is set (a Stripe pay-what-you-want link, $99 suggested). Fires on click, before navigation; `job_id` is null for a hand-tracked role. The moment itself is already on the record as `application_stage_changed` with `to_stage: "offer"`. | landings that turn into a voluntary payment; offer → pledge-click rate. |
| `founding_member_paid` | `{ checkout_session_id, signed_in }` | `src/app/pricing/pricing-client.tsx` — on the Stripe return, only when `paidCheckoutSessionId` (`src/lib/billing/founding-offer.ts`) accepted BOTH `checkout=success` and a well-formed `cs_live_…`/`cs_test_…` id; once per session id per browser session (`sessionStorage`). Not a ledger: it is unverified against Stripe and exists to join a PostHog person to a Stripe dashboard row. Revenue is read in Stripe. | purchases attributable to a PostHog person; click → pay conversion. |

## MCP tool calls (`$mcp_tool_call`)

Not in `ANALYTICS_EVENTS` — it is PostHog's reserved MCP-analytics event name, sent server-side through `postServerCapture` the way `$ai_generation` is. Seam: `withDeps` in `src/app/api/mcp/route.ts` (one event per tool call past the auth check: budget refusal, tool error, success, thrown exception) and the rate-limit reject in `handleMcpRequest` (`$mcp_error_type: "rate_limited"`). Helper: `src/lib/agent/telemetry.ts`. Properties: `$mcp_tool_name`, `$mcp_server_name` (`velai-agent`), `$mcp_duration_ms`, `$mcp_is_error`, `$mcp_error_type` (bounded slug — `unavailable`, `rate_limited`, `exception`, or the tool's own error string slugged, e.g. `job_not_found`), `$mcp_client_name` (the caller's `User-Agent`, first 80 chars), `$mcp_session_id` (when the client sends `Mcp-Session-Id`). `distinct_id` is the account uid, the same id `PostHogProvider` identifies the browser with, so web and MCP activity land on one person. No tool input or output is ever sent.

## Packs home (Today header)

| Event | Payload | Seam | Feeds |
|---|---|---|---|
| `home_viewed` | `{ new_count, applied_today, follow_ups, interviews, has_last_visit }` | `src/components/jobs/for-you/TodayHome.tsx`, once per load after the new-since search settles. | how often the signed-in home has something new or due; return visits (join on person). |
| `home_action_clicked` | `{ kind, job_id?, step?, match_* }` — `kind` is one of `new_role_open`, `new_role_apply`, `new_role_skip`, `see_more`, `stat_new`, `stat_applied`, `stat_follow_ups`, `stat_interviews`; from "Needs you" (`NeedsYou.tsx`) `needs_interview`, `needs_follow_up`, `needs_closed`, `needs_saved_search`, `needs_follow`, `needs_more` (Show N more), `needs_tracker` (Open tracker on the empty list), and `starter_step` with `step` = `apply`\|`save_search`\|`follow` | same file, on each row action, stat link and "Needs you" button. | which part of the home gets used. |
| `pack_opened` | `{ pack, source: tile\|browse_all\|today }` | `src/app/jobs/JobsContent.tsx`, `openHubPack` (tiles, "Browse all matches", and the Today header's "See more"). | pack tile use (before this, only autocapture saw it). |

## New-account setup

Setup is offered only to accounts whose sign-up claim wrote `profiles/<uid>.onboarding` (`claimSignupEvent`, `src/lib/auth/signup-event.ts`), so every event below comes from an account made after setup shipped. The store that fires most of them is `src/hooks/use-onboarding.ts`.

| Event | Payload | Seam | Feeds |
|---|---|---|---|
| `saved_search_created` | `{ surface: toolbar\|after_sign_in\|setup, signed_in }` | `src/components/jobs/SavedSearchesPanel.tsx` (toolbar Save search; `signed_in: false` for a guest search kept in this browser), `src/lib/jobs/use-saved-searches.ts` `savePendingSearchAfterSignIn` (a gated Save search finished after sign-in), and setup step 3 (`src/components/onboarding/SetupSteps.tsx`). Fires once the save succeeds. | saved searches per account, the weekly email's only way in. |
| `onboarding_strip_shown` | `{ day }` | `markStripDay`, from the welcome strip (`WelcomeStrip.tsx`) and the /jobs setup panel (`SetupPanel.tsx`), once per local visit day. `day` is 1 to 3. | how many new accounts come back on a second and third day. |
| `onboarding_setup_opened` | `{ surface: strip\|menu\|jobs_page\|email }` | `openSetupSheet` (strip button, account menu "Finish setup", the welcome email's `/jobs?setup=open` link via `OnboardingRoot.tsx`) and `SetupPanel.tsx` mount (`jobs_page`). | which door into setup gets used. |
| `onboarding_step_answered` | `{ step: resume\|place\|email, outcome: done\|skipped, via? }` | `answerStep`. `via` says how a done step was answered: `resume`, `roles`, `place`, `remote` or `saved_search`. | per-step completion and skip rates. |
| `onboarding_later` | `{ answered }` | `putSetupOff`: the strip's Later, the panel's Later, or the sheet closed before its last step. | where people put setup off. |
| `onboarding_finished` | `{ done, skipped }` | `answerStep` when the last step is answered, and `finishIfAllHeld` when everything the account already holds answers every step. Once per account. | setup completion. |

## Reading the funnel

North-star for Velai cold traffic:

`$pageview` → `results_impressed` / `result_clicked` / `job_viewed` →
`auth_started` → `signup_completed`

`search_submitted` is a **typed/chip search**, not the top of the cold-browse
funnel. Default browse (`getDefaultBrowseAction` / `overlay-ask`) does not
fire it; that is intentional — `results_impressed` already fires on visible
SERP rows, including default browse.

Secondary paths:

1. result click → view → apply (`result_clicked` → `job_viewed` →
   `apply_clicked` → `job_marked_applied`)
2. visit → follow or save (`company_viewed`/`$pageview` → `company_followed`
   or `job_saved`)
3. follow/save → auth → signup (`company_followed` or `job_saved` →
   `auth_started` → `signup_completed`)
4. save → stage progress (`job_saved` → `application_stage_changed`,
   repeated per stage move)
5. D7 return (repeat `$pageview` from the same identified/anonymous user
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

## Auth gates (what this PR ships)

Guest **Apply** — `apply_clicked` still fires first (`src/app/jobs/page.tsx`,
events-wiring lock). The ATS opens synchronously in the click gesture; the
tracker sign-in gate follows only to **track** the application — no second
navigation after sign-in. Opening that gate does not fire `auth_started`.
Save uses a **2nd-save** gate (`reason: "save"` on the gate attempt; that
reason rides on `auth_started` only if the user then engages a method).

Post-engage soft auth nudge — after first `result_clicked` or two
`job_viewed` events, a dismissible banner on `/jobs` offers sign-in
(`auth_nudge_shown`, reason `"generic"`). Closing it is not a funnel
failure. Hidden when the guest-save banner is showing or the nudge was
dismissed (`src/lib/auth/guest-engage-nudge.ts`).

## Browse cold-start (what shipped)

Zero-query `/jobs` fetches the cached default browse
(`getDefaultBrowseAction` when `resolveEmptySearchState` is `"overlay-ask"` —
`src/lib/jobs/result-state.ts`, `src/app/jobs/page.tsx`). Desktop and mobile
both show those hits — the mobile results column is no longer hidden behind
"Pick one to start searching" / "Show jobs" (`LandingMarketingShowcase` chips
stay above the list). Default browse does **not** fire `search_submitted`; do
not invent one for the seed list.

## PostHog AI observability (`$ai_generation`)

**Not part of `ANALYTICS_EVENTS`.** PostHog AI observability event `$ai_generation`
is captured separately via `postServerCapture` in `src/lib/analytics/ai-generation.ts`.

**Seam:** `OpenAICompatibleProvider.generate` (`src/lib/llm/providers.ts`) — one
event per provider attempt (each `chat.completions.create` call). `fetchJSON`
(`src/actions/generate-context.ts`) stamps one `$ai_trace_id` per invocation so
failed free rungs, the paid tail, and any JSON-repair second call share a trace.

**Properties:** `$ai_model`, `$ai_provider`, `$ai_input_tokens`, `$ai_output_tokens`,
`$ai_total_cost_usd` (only when OpenRouter returns `usage.cost`; otherwise PostHog
prices from model + tokens), `$ai_latency` (seconds), `$ai_is_error`, `$ai_error`
(stable code only), `$ai_trace_id`, `$ai_span_id`, `$ai_span_name` / `llm_feature`,
`llm_is_fallback`, `llm_attempt`, `product: intervu`, plus the server capture's
`$host` and `$lib`.

**Live feature slug today:** `search_query_parse` (`parseSearchQuery` in
`src/actions/search.ts`). Any future `generateGenericJSON` caller is covered if it
passes a short feature slug; default is `generic_json`.

**Out of scope:** résumé parse, tailor, and customize run on-device
(`src/lib/local-ai/`) and are not these events. Match scoring is not an LLM call.

**Privacy:** `$ai_input` and `$ai_output_choices` are intentionally omitted.
Feature slugs longer than 64 characters or containing newlines are dropped to
`unspecified`. Distinct id is the account uid, never an email. Error property is
an enum code, never the provider message.

**What actually calls the model today:** the capture sits on
`OpenAICompatibleProvider.generate`, so every future `generateGenericJSON` /
`fetchJSON` caller is covered. The jobs UI does not reach it. `parseSearchQuery`
is the only in-repo caller of `generateGenericJSON`, nothing imports that
action, and `quickParseSearchQuery` returns a result for every non-empty
query — so typing in the search box does not emit `$ai_generation`. On-device
résumé parse and tailor do not either.

**Test plan:**

1. `npx tsx --test tests/unit/ai-generation.test.ts` — asserts a `$ai_generation`
   POST with model, provider, tokens, latency, `llm_feature`, `$host`, and
   `$lib`, and that prompt/response keys are absent.
2. Live check (spends the shared OpenRouter key): signed in, with
   `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SITE_URL`, and `OPENROUTER_API_KEY`
   set, call `generateGenericJSON` from a server context with a short feature
   slug, for example
   `generateGenericJSON('Return JSON {"ok":true}', undefined, "search_query_parse")`.
3. In PostHog project 314095 → AI observability → Generations
   (https://us.posthog.com/project/314095/ai), filter event `$ai_generation`
   and `$ai_span_name = search_query_parse`.
4. Expect one row per ladder attempt that actually called the model: model,
   provider `openrouter`, token counts, latency, `llm_feature`, and no
   prompt/response text in the event properties.
5. A failed free rung and the paid tail share one `$ai_trace_id` and are
   separate generations (not double-counted as a second event name).
