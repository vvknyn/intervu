import type { JobSearchResult, PublicJob } from "./types";

/**
 * The ONLY copy shown when search fails — server catch (search.ts) and client
 * transport catch (page.tsx) both use it. Raw error messages (Next RSC digest
 * text, fetch internals) reached prod users twice on Jul 24; internals go to
 * logs, never into this string.
 *
 * Calmer wording (Deliverable 1, 2026-08-01): dropped the "search index"
 * internals-speak (a visitor has no idea what that means, and naming it read
 * as more alarming, not less) — the reassurance ("usually clears within a
 * minute") is the part that actually helps. Keeps the phrase "temporarily
 * unavailable" verbatim: `search.ts`'s own backend-thrown notes already carry
 * it as a literal prefix, so this fallback stays consistent with a real note
 * rather than introducing a second way of describing the same state. This
 * hard-error copy is now reached ONLY for the genuine no-results-available
 * case — a `meta.degraded` response (served-but-stale) renders results
 * normally with `degradedResultsNote`'s calm inline note instead (below).
 */
export const SEARCH_UNAVAILABLE_MESSAGE =
    "Search is temporarily unavailable — this usually clears within a minute. Try again in a moment.";

/**
 * Shape of the additive `meta` field the data-plane lane (branch
 * feat/2026-08-01/p0-data-plane, unmerged at the time of this change) is
 * adding to `JobSearchResult`. Declared here so this lane's UI can code
 * defensively against it before that type change lands upstream — every
 * field optional, absence read as "live" (see `degradedResultsNote` below).
 * Once `JobSearchResult.meta` is declared for real, this stays correct by
 * construction (structural typing) and the cast in `servedMeta` becomes a
 * no-op rather than a landmine.
 */
export interface SearchServedMeta {
    degraded: boolean;
    servedFrom: "live" | "cache";
    cachedAtMs?: number;
}

/**
 * The one place that reaches past `JobSearchResult`'s currently-declared
 * shape for the not-yet-landed `meta` field — every reader goes through this
 * instead of repeating the cast (single source of truth, writing-lean-code
 * rule 2). A response with no `meta` at all (today's live shape, and any
 * backend that never sends it) reads as `undefined`, never as degraded.
 */
function servedMeta(result: JobSearchResult): SearchServedMeta | undefined {
    return (result as JobSearchResult & { meta?: SearchServedMeta }).meta;
}

/**
 * Deliverable 1's calm inline note: results still render normally, this is
 * just an honest caption for where they came from. `null` means render
 * nothing — the ordinary case (live, or `meta` absent entirely).
 */
export function degradedResultsNote(result: JobSearchResult): string | null {
    return servedMeta(result)?.degraded
        ? "Showing recent results — live search is catching up."
        : null;
}

/**
 * The dispatcher returns configured backend failures as an empty result with
 * `unavailable: true`. Keep that state distinct from a successful empty query.
 * Existing hits are never considered unavailable so background refresh errors
 * can leave the current list visible.
 */
export function isUnavailableJobsResult(result: JobSearchResult): boolean {
    return result.configured && result.hits.length === 0 && result.unavailable === true;
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
 * Whole-branch review fix — the GENERAL form of "should the URL's `job=`
 * param be cleared after this refresh." The narrower dead-link predicate that
 * preceded it only
 * catches ONE way a selection gets reassigned away (a dead link that used
 * its free pass): it stays true. But `resolveSelectionAfterRefresh` also
 * reassigns `preserveDeliberateDetail: false` for a DIFFERENT, more common
 * case it was never written to cover — a filter/query change that excludes
 * an already-open, previously-CONFIRMED job (`wasConfirmed` is `true` on
 * its very first look, so it never touches the free-pass machinery at all).
 * That case fell through the older, narrower dead-link predicate silently:
 * `alreadyUsedItsPass`
 * is `false` (the id was never "unresolved"), so the old guard never fired,
 * leaving `job=<excluded-id>` stuck in the address bar while the pane moved
 * on to `hits[0]` — sharing that URL reproduces a job the recipient's own
 * filters exclude, and on mobile the next reconcile pops a stale "can't
 * confirm this role's status" sheet over the results.
 *
 * The general rule: clear the URL exactly when there WAS an explicit prior
 * selection, the refresh did NOT preserve it, AND the URL (at the time this
 * fetch started) still names that now-abandoned id — the last check is what
 * keeps this from clobbering an unrelated open job when the reassigned
 * selection came from local-only keyboard nav (`selectJob` in page.tsx,
 * which deliberately never touches the URL) rather than the address bar.
 *
 * This provably subsumes that narrower case too: a dead link
 * that used its free pass always has `preserveDeliberateDetail: false`
 * (`resolveSelectionAfterRefresh`'s `wasConfirmed: true` branch) and the URL
 * never changed while the id sat unconfirmed, so `urlJobId` still equals
 * `previousSelectedId` there too — so this is now the ONE predicate
 * page.tsx's fetch effect calls to decide "clear the URL." The narrower predicate
 * itself is left in place rather than deleted (out of scope for this fix;
 * see its own round-3 review-fix history above) and stays independently
 * unit-tested below.
 */
export function shouldClearStaleJobUrl(
    urlJobId: string | null,
    previousSelectedId: string | null,
    preserveDeliberateDetail: boolean,
): boolean {
    return previousSelectedId != null && !preserveDeliberateDetail && urlJobId === previousSelectedId;
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
        result.configured &&
        result.backend === "meilisearch" &&
        !result.note &&
        !result.unavailable &&
        result.hits.length === 0;
    if (isCompleteAndClean) return { status: "not_found" };
    return { status: "unknown" };
}

/**
 * The empty-query landing state (page.tsx's `emptySearchState`, unit-tested
 * here rather than only inline in the component). An empty search must never
 * list the whole corpus — no query, browse mode, no fit ⇒ nothing was
 * fetched — so this decides what to show INSTEAD, one of:
 *
 *   - `"results"` — there's a query, a fit ranking, or Explore is active
 *     (`mode !== "browse"`): render the ordinary results surface, nothing
 *     to do with the empty-search states below.
 *   - `"auto-explore"` — first landing this visit (`isInitialLoad`), the
 *     visitor already has a usable résumé on hand (folded together with any
 *     "would this open the sign-in gate" check by the CALLER — see page.tsx,
 *     which only ever passes `true` here when auto-entering explore is also
 *     auth-safe), and no prior auto-attempt has already failed. The caller
 *     reuses the exact manual "explore roles like mine" entry point.
 *   - `"serp-ask"` — filters are active, so the visitor has already told us
 *     something (keep the SERP chrome up, filters editable), or a prior
 *     auto-explore attempt didn't pan out (`exploreFailed`) and a plain
 *     empty landing isn't the moment for the fully overlay ask again.
 *   - `"overlay-ask"` — the genuine first-screen prompt: nothing typed, no
 *     filters, no résumé to auto-explore with.
 *
 * `exploreFailed` is checked BEFORE the auto-explore gate on purpose: once
 * an attempt has already failed, `isInitialLoad`/`hasUsableResume` alone
 * would keep re-selecting `"auto-explore"` forever (neither flips on a
 * failed attempt) — the page.tsx effect that drives the actual attempt only
 * fires once per `"auto-explore"` result anyway (its own one-way latch), but
 * this ordering is what makes the STEADY STATE after a failure land on the
 * seeded ask instead of looping the decision.
 */
export type EmptySearchState = "results" | "overlay-ask" | "serp-ask" | "auto-explore";

export interface EmptySearchStateInput {
    hasQuery: boolean;
    fitActive: boolean;
    mode: "browse" | "explore";
    activeFilterCount: number;
    /** Résumé usable AND (for the auto path) any auth precondition the
     *  caller requires already satisfied — see this function's doc comment. */
    hasUsableResume: boolean;
    isInitialLoad: boolean;
    exploreFailed: boolean;
}

export function resolveEmptySearchState(input: EmptySearchStateInput): EmptySearchState {
    if (input.mode !== "browse" || input.hasQuery || input.fitActive) return "results";
    if (input.exploreFailed) return "serp-ask";
    if (input.isInitialLoad && input.hasUsableResume) return "auto-explore";
    return input.activeFilterCount > 0 ? "serp-ask" : "overlay-ask";
}
