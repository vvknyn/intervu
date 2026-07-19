import type { JobSearchResult, PublicJob } from "./types";

/**
 * The dispatcher returns configured backend failures as an empty result with
 * an unavailable note. Keep that state distinct from a successful empty query.
 * Existing hits are never considered unavailable so background refresh errors
 * can leave the current list visible.
 */
export function isUnavailableJobsResult(result: JobSearchResult): boolean {
    return (
        result.configured &&
        result.hits.length === 0 &&
        /temporarily unavailable/i.test(result.note ?? "")
    );
}

export interface SelectionAfterRefresh {
    selectedId: string | null;
    /**
     * True only when the previously displayed job still exists (or is being
     * given the benefit of the doubt — see `wasConfirmed` below). If it does
     * not survive AND `wasConfirmed`, mobile closes the sheet instead of
     * silently swapping its contents.
     */
    preserveDeliberateDetail: boolean;
}

export interface ResolveSelectionOptions {
    /**
     * Was `previousSelectedId` confirmed present a moment ago — i.e. does
     * this look like a LIVE selection that just dropped out of a NEW
     * search/filter, as opposed to a URL/deep-link id this tab has never
     * once confirmed? Defaults to `true`, preserving every pre-Task-11 call
     * site's behavior (always fall back to `hits[0]` and close detail when
     * the selection goes missing).
     *
     * When explicitly `false` and the id is still missing, the selection is
     * PRESERVED rather than replaced (`preserveDeliberateDetail: true`, no
     * reassignment) — this is what stops a fresh, never-yet-confirmed
     * id from being silently swapped for an unrelated `hits[0]` before a
     * dedicated existence check (jobs/page.tsx, Task 11) gets to run.
     *
     * The caller is responsible for only granting this leniency ONCE per
     * id (see `firstUnresolvedDeadLinkIdRef` in page.tsx) — this function
     * has no memory of past calls, so a caller that keeps passing `false`
     * for the same id forever would keep it "preserved" forever too.
     */
    wasConfirmed: boolean;
}

export function resolveSelectionAfterRefresh(
    previousSelectedId: string | null,
    hits: Pick<PublicJob, "id">[],
    opts: ResolveSelectionOptions = { wasConfirmed: true },
): SelectionAfterRefresh {
    if (previousSelectedId && hits.some((hit) => hit.id === previousSelectedId)) {
        return {
            selectedId: previousSelectedId,
            preserveDeliberateDetail: true,
        };
    }
    if (previousSelectedId && !opts.wasConfirmed) {
        return {
            selectedId: previousSelectedId,
            preserveDeliberateDetail: true,
        };
    }
    return {
        selectedId: hits[0]?.id ?? null,
        preserveDeliberateDetail: false,
    };
}

/**
 * Task 11 review fix — should the dead-link `job=` URL param be cleared
 * after this fetch? True exactly when a previously-unconfirmed id's ONE
 * free pass (see `ResolveSelectionOptions.wasConfirmed`'s doc comment) was
 * consumed by THIS fetch — i.e. the id had already used its pass before
 * this fetch started, and it is STILL absent from the fresh hits.
 *
 * Extracted as a standalone, unit-tested predicate because the inline
 * version of this shipped BROKEN: it read `!wasConfirmed && alreadyUsedItsPass`,
 * but the caller defines `wasConfirmed = wasConfirmedBeforeThisFetch ||
 * alreadyUsedItsPass` — so `alreadyUsedItsPass` being true ALWAYS forces
 * `wasConfirmed` true, making `!wasConfirmed && alreadyUsedItsPass` a
 * logical contradiction that can never be true. The branch was reported
 * fixed while being permanently dead code; caught only by a reviewer
 * tracing the predicate against its own definitions by hand. Taking the
 * two RAW, non-derived facts as separate parameters — rather than the
 * already-OR'd `wasConfirmed` — makes that specific self-contradiction
 * structurally impossible here, and a unit test proves the true branch is
 * actually reachable (the exact gap that let the bug ship unnoticed).
 */
export function shouldClearDeadLinkUrl(alreadyUsedItsPass: boolean, foundInFreshHits: boolean): boolean {
    return alreadyUsedItsPass && !foundInFreshHits;
}

/**
 * Task 11 — empty state's ghost-reveal line: only worth showing when ghosts
 * are currently hidden (the first-screen default) AND the honest hidden
 * count (Task 7's `ghostHiddenCount` — `null` while unresolved, or when
 * ghosts are shown) is actually positive. Extracted as a pure function
 * rather than an inline JSX condition so it's unit-testable without a React
 * harness, matching `isUnavailableJobsResult`/`resolveSelectionAfterRefresh`
 * above. Returns the count itself (not a boolean) so the caller can render
 * `{n} roles hidden as likely-ghost — show them` directly off the result.
 */
export function resolveGhostReveal(hideGhosts: boolean, ghostHiddenCount: number | null): number | null {
    if (!hideGhosts) return null;
    if (ghostHiddenCount == null || ghostHiddenCount <= 0) return null;
    return ghostHiddenCount;
}

/**
 * The tombstone's mandated headline (Task 11 controller resolution #1,
 * verbatim — never a date, never a guessed cause). Exported as a constant,
 * consumed by `DeadJobTombstone` (jobs/page.tsx), rather than living only as
 * an inline JSX literal — review fix: the e2e coverage for it is an `.or()`
 * alongside the non-assertive state's own copy (a dead id may resolve
 * either way — see jobs-first-screen.spec.ts), which alone could silently
 * keep passing even if this exact string drifted. Pinned directly here
 * instead.
 */
export const DEAD_JOB_TOMBSTONE_TEXT = "This role is no longer available.";

/** Outcome of the Task 11 dead-link existence check (`classifyExistenceCheck` below). */
export type ExistenceCheckStatus =
    | { status: "found"; job: PublicJob }
    | { status: "not_found" }
    /** The check itself was inconclusive — backend unconfigured, or the
     *  request failed (e.g. `id` isn't a legal filter on this index yet —
     *  see `buildFilter` in lib/jobs/meilisearch.ts). Never treated as a
     *  "not found" — honesty requires the absence of proof to stay
     *  distinct from proof of absence. */
    | { status: "unknown" };

/**
 * Classifies a `searchJobsAction({ id, limit: 1 })` response for the
 * dead-link existence check (jobs/page.tsx). Extracted as a pure function —
 * the riskiest branch in the Task 11 review-fix diff — so it's directly
 * unit-testable without spinning up the 2000-line client component, mirroring
 * `resolveGhostReveal` above.
 *
 * Review fix: this must require POSITIVE PROOF of absence, not merely the
 * absence of a recognized error. The first draft treated `not_found` as the
 * DEFAULT for any configured, zero-hit response whose note didn't match
 * `isUnavailableJobsResult`'s `/temporarily unavailable/i` pattern — so an
 * error worded differently, or a configured+empty response with no note at
 * all, silently became "proof" the role was gone. It also ignored
 * `backend` entirely: `snapshot-preview` is a CAPPED SUBSET of the corpus
 * (see lib/jobs/snapshot-preview.ts's own header comment — "NOT the full
 * corpus and NOT scalable"), so an id absent from it is not evidence of
 * anything. `not_found` now requires ALL of: a known-COMPLETE backend
 * (`"meilisearch"` — never `"snapshot-preview"` or `"unconfigured"`), no
 * error/degraded note of ANY kind (not just the "temporarily unavailable"
 * shape), and zero hits. Every other combination — including a `found`
 * check's own preconditions failing — falls through to `unknown` by
 * construction (the function's LAST line, not a special-cased branch),
 * so a future new failure mode can't silently reintroduce this bug by
 * being routed to the wrong default again.
 *
 * `!result.note` enumerated (review fix — is this check load-bearing today,
 * and will it stay correct once the id-filterable reindex lands?): traced
 * every `JobSearchResult` constructor across lib/jobs/{search,meilisearch,
 * snapshot-preview}.ts. A `configured:true, backend:"meilisearch"` result
 * carries a `.note` in exactly ONE case — `search.ts`'s outer `catch`, when
 * `searchMeili` throws (e.g. TODAY's `id`-not-filterable 400, or any other
 * request failure) — never on ANY successful return, including the
 * `posted_ts` legacy-retry success path (`searchMeili`'s success object has
 * no `note` field at all; the retry's `console.warn` is server-side only,
 * never reaches the client). So `!result.note` is doing real, necessary
 * work RIGHT NOW (it's what keeps today's live 400 from being misread as
 * proof of absence) and imposes no dormancy risk after the reindex: a
 * successful post-reindex response is exactly as note-free as every
 * successful response today. `getJobsBackendStatus()`'s own "Meilisearch
 * index" string (search.ts) is a red herring — that function is never
 * called by `searchJobs`'s meilisearch path, so its note never reaches a
 * `JobSearchResult` at all.
 */
export function classifyExistenceCheck(id: string, result: JobSearchResult): ExistenceCheckStatus {
    const job = result.hits.find((h) => h.id === id) ?? null;
    if (job) return { status: "found", job };
    const isCompleteAndClean =
        result.configured && result.backend === "meilisearch" && !result.note && result.hits.length === 0;
    if (isCompleteAndClean) return { status: "not_found" };
    return { status: "unknown" };
}
