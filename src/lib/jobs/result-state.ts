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
 * `resolveGhostReveal` above. `isUnavailableJobsResult` already distinguishes
 * a genuine backend failure from a valid empty result; this reuses it rather
 * than re-deriving the same check a second way.
 */
export function classifyExistenceCheck(id: string, result: JobSearchResult): ExistenceCheckStatus {
    if (!result.configured || isUnavailableJobsResult(result)) return { status: "unknown" };
    const job = result.hits.find((h) => h.id === id) ?? null;
    return job ? { status: "found", job } : { status: "not_found" };
}
