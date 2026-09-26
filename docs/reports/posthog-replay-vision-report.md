# Replay Vision Setup Report

## Recording status

Session replay is live. The server-side toggle was already enabled, and nothing in the client init chain (`src/lib/posthog-options.ts` → `PostHogProvider.tsx`) disables it — `session_recording: { maskAllInputs: true }` only masks input values, it doesn't turn recording off.

**One thing to check:** `PostHogProvider` no-ops entirely unless `NEXT_PUBLIC_POSTHOG_KEY` is set in the environment. If recordings don't start showing up, confirm that env var is actually present in your deploy.

## Scanners created

Three scanners were created from scratch (no existing scanners in the project to update or collide with):

### 1. Broken job search & listings — monitor
- **Watches:** search/filter returning no results despite matching jobs, stale or contradictory trust-badge verdicts on a job, blank/garbled salary-company-location text, a closed/expired job still showing an active apply option, facet counts not matching what's actually listed.
- **Query scope:** sessions where `$current_url` contains `/jobs` (covers both the listings page and job detail pages), sampled at 50%.
- **Est. cost:** ~580 credits/month.
- **Link:** https://us.posthog.com/project/314095/replay-vision/01a0ab06-695a-7154-b185-5db5dc9e9395

### 2. Job hunt frustration — monitor
- **Watches:** facet filters narrowing to zero results with no reset option, an unresolvable free-text location returning empty results silently, clicking a since-removed job closing the detail panel without explanation, stale results staying visible when the job index goes down, tracker search returning no matches with no path forward, interview-prep generation showing only a spinner with no progress.
- **Query scope:** sessions containing a `$rageclick` event, sampled at 100%. Deliberately has no URL scope, so it stays disjoint from the URL-scoped breakage monitor above.
- **Est. cost:** ~105 credits/month.
- **Link:** https://us.posthog.com/project/314095/replay-vision/01a0ab06-086a-7005-88c7-0dd15c9d09d0

### 3. Job seeker session summaries — summarizer
- **Watches:** nothing specific — it narrates what the user did in the session (browsing/filtering jobs, viewing a job's ghost-job status, saving or applying).
- **Query scope:** unscoped, sampled at 10%.
- **Est. cost:** ~135 credits/month.
- **Link:** https://us.posthog.com/project/314095/replay-vision/01a0ab04-e8e4-7435-9ebf-fc91537e4f7e

**Total estimated spend:** ~820 credits/month against a 2,500/month quota — well within budget, so nothing was throttled or scaled back.

## Skipped or deferred

Nothing was skipped. All three standard scanners (breakage monitor, frustration monitor, session summarizer) applied cleanly to this job-board product and were created. One non-blocking internal note: the authoritative scanner-authoring skill couldn't be fetched due to an API key scope gap, so scanners were built directly from the tool's own schema instead — this didn't affect the output.

## Where to look

Observations will start appearing on the [Replay vision page](https://us.posthog.com/project/314095/replay-vision) in PostHog as new recordings complete and get scanned — the three scanners above run automatically against qualifying sessions going forward.
