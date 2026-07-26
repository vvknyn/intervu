# PR #1 — Search logging

**Spec:** `docs/superpowers/specs/2026-07-25-search-journey-phase1-design.md`
**Position:** first of four. Blocks nothing; unblocks the evidence for everything else.

---

## Goal

Record what people search for and whether it worked — **before** the redesign removes the
filter panel.

## Why first

There is no query telemetry today (verified 2026-07-25): no analytics package, no server-side
logging in the search path, and `lib/jobs/recent-searches.ts` keeps recent searches in
`localStorage` where they never leave the browser.

Once filters are gone we cannot learn whether anyone used them. Measuring after the change
tells us nothing, because there is no before.

---

## Design

### New — `src/lib/jobs/search-log.ts`

Two exports, deliberately split at the I/O seam:

```ts
buildSearchLogEntry(params, result, ctx): SearchLogEntry   // PURE
recordSearch(entry): Promise<void>                          // impure, swallows everything
```

`ctx` carries the injected clock and id generator, so the pure half is deterministic and fully
unit-testable without Firestore. Everything worth testing — truncation, bucketing, the privacy
rules — lives in the pure half.

### Schema — Firestore collection `search_events`

| Field | Source | Note |
|---|---|---|
| `searchId` | generated | random uuid **per search**, the join key — *not* a user id |
| `q` | `params.q` | trimmed, capped at 200 chars |
| `qLength` | derived | pre-truncation length |
| `resultCount` | `result.total` | |
| `widened` | `result.widened ?? false` | **already exists**, `types.ts:143` |
| `backend` | `result.backend` | meilisearch / snapshot-preview / unconfigured |
| `unavailable` | `result.unavailable ?? false` | separates "failed" from "genuinely empty" |
| `postedBucket` | `params.postedBucket` | records whether the 30d default was in play |
| `hasFacets` | derived | any explicit facet filter applied |
| `createdAt` | injected clock | ISO |
| `expiresAt` | `createdAt + 90d` | Firestore TTL policy field |

**Deliberately not stored:** uid, IP, user agent, session cookie. `searchId` is random and
per-search, so events cannot be chained into one person's history.

### New — `recordJobOpenedAction(searchId, jobId, rank)`

Collection `search_opens`: `{ searchId, jobId, rank, createdAt, expiresAt }`.

`rank` is the position in the result list, and it is the real relevance signal — opening result
#1 and opening result #34 mean opposite things about our ranking. Without this the log tells us
what people *typed* but not whether we answered.

### Modified — `src/actions/jobs.ts`

`searchJobsAction` returns `{ ...result, searchId }` and schedules the write via `after()` from
`next/server` (Next **16.1.5**, verified). That keeps the write off the response path entirely,
so it cannot add latency and cannot be killed when the serverless response returns.

### Modified — `src/app/page.tsx`

Two touches: hold the `searchId` of the current result set; call `recordJobOpenedAction` when a
job detail opens.

---

## Non-negotiables

1. **A logging failure must never fail or slow a search.** Every write inside `try/catch`, off
   the response path via `after()`. If Firestore is down, search behaves exactly as today.
2. **No new dependency.** Reuses `getAdminDb()` from `@/lib/firebase/admin`.
3. **No new env var.**
4. **No UI change.** This PR is invisible to users.

---

## Tests — `tests/unit/search-log.test.ts`

Run with `npx tsx tests/unit/search-log.test.ts` (matches the existing `test:unit` convention).

- entry contains no uid / IP / user-agent even when present on the input
- `q` truncated at 200 chars, `qLength` records the pre-truncation length
- `widened` defaults to `false` when the backend omits it
- `postedBucket` records `"30d"` when the fresh-visit default applies
- `buildSearchLogEntry` is pure — same input plus same injected clock/id yields same output
- `recordSearch` resolves (does not throw) when the db write rejects

---

## Manual step — required, not optional

**Enable a Firestore TTL policy on `search_events.expiresAt` and `search_opens.expiresAt` in the
Firebase console.** The code writes the field; only GCP enforces deletion. Skipping this means
query text is retained forever, which is exactly the outcome the field exists to prevent.

---

## Verification

- Run a search locally → exactly one `search_events` doc with the expected fields, no uid
- Open a result → one `search_opens` doc carrying the matching `searchId` and correct `rank`
- Time `searchJobsAction` before and after → no measurable latency change
- Force a Firestore error → search still returns results normally

---

## Out of scope

- Dashboards or aggregate queries (read it by hand for the first week)
- Any UI change
- Anything in the redesign itself

---

## What week one tells us

| Question | Signal | Decides |
|---|---|---|
| Do people type sentences or keywords? | `qLength` distribution | whether Journey C's clarifying question solves a real problem or an imagined one |
| How often is the query too narrow? | `widened` rate | whether Screen 4's honest line is a main path or an edge case |
| Is the ranking any good? | `rank` distribution on opens | whether title-first precision is actually working |
| Did anyone rely on filters? | non-default `postedBucket` rate | the only real evidence for or against deleting the filter panel |

If searches cluster at short `qLength` with a high `widened` rate and opens landing deep in the
list, the premise of Journey A is wrong and we should revisit before PR #3.
