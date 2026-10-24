import { activeFilterEntries, type FilterState } from "@/components/jobs/FilterPanel";
import type { EventPayloads } from "@/lib/analytics/events";
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

/** Signed-out / unconfigured backend panel — production uses degraded-search tone (#618). */
export function jobsNotConnectedPanelCopy(input: {
    isDev: boolean;
    operatorNote?: string | null;
}): { title: string; body: string; operatorDetail: string | null } {
    if (input.isDev) {
        return {
            title: "Job search is being connected.",
            body:
                "We're wiring Velai up to Subspace's live job corpus — including the posting check that flags roles that aren't really hiring.",
            operatorDetail: input.operatorNote?.trim() || null,
        };
    }
    return {
        title: "We can't load results right now.",
        body: SEARCH_UNAVAILABLE_MESSAGE,
        operatorDetail: null,
    };
}

/** Operator/setup notes from backends — must never be shown in product UI. */
const OPERATOR_SEARCH_NOTE_PATTERN =
    /MEILISEARCH_HOST|JOBS_PREVIEW_FROM_SNAPSHOT|SUBSPACE_API_KEY/i;

export function isOperatorSearchNote(note: string | null | undefined): boolean {
    if (!note?.trim()) return false;
    return OPERATOR_SEARCH_NOTE_PATTERN.test(note);
}

/** Strip env-var setup copy; pass through user-safe messages unchanged. */
export function userFacingSearchErrorMessage(message: string | null | undefined): string | null {
    if (!message?.trim()) return null;
    if (isOperatorSearchNote(message)) return SEARCH_UNAVAILABLE_MESSAGE;
    return message;
}

/** True when Rank / Save / alerts must not pretend search is actionable. */
export function isSearchUnhealthy(input: {
    searchError: string | null;
    result: Pick<JobSearchResult, "unavailable" | "configured"> | null;
}): boolean {
    if (input.searchError != null) return true;
    const r = input.result;
    if (!r) return false;
    return r.unavailable === true || r.configured === false;
}

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
 * Deliverable 2's honest disclosure (the "North America" bug's general
 * fix, query-understanding.ts's `resolveLocationFacet`): a typed location
 * phrase that named nothing this corpus could filter on gets DROPPED rather
 * than kept as an exact-facet predicate guaranteed to return zero results —
 * this is the caption that tells the searcher so, rather than leaving them
 * looking at results that quietly ignored part of what they typed. `null`
 * means render nothing (the ordinary case — nothing was dropped). Takes the
 * mentions array directly, not a `JobSearchResult` (unlike
 * `degradedResultsNote` above) — `unmatchedPlaceMentions` lives on the
 * per-call return-type intersection each search entry point builds (see
 * `defaultedLocation`'s identical shape, search.ts/actions/jobs.ts), never on
 * `JobSearchResult` itself, so there is no result object to reach into here.
 */
export function unmatchedPlaceNote(
    placeMentions: string[] | undefined,
    queryMentions?: string[],
): string | null {
    const notes: string[] = [];
    if (placeMentions?.length) {
        notes.push(`We have no roles in ${quotedList(placeMentions)} — showing results without ${pronoun(placeMentions)}.`);
    }
    // The LLM stage's leftovers (`unmatchedQueryMentions`): words it read but
    // could not turn into a filter, or was told to exclude.
    if (queryMentions?.length) notes.push(`We couldn't apply ${quotedList(queryMentions)} — searched without ${pronoun(queryMentions)}.`);
    return notes.length ? notes.join(" ") : null;
}

const pronoun = (xs: string[]) => (xs.length === 1 ? "it" : "them");

function quotedList(mentions: string[]): string {
    const quoted = mentions.map((m) => `"${m}"`);
    return quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * An employer search with a place asked for lists the employer's roles in that
 * place first, then its roles elsewhere (`JobSearchResult.inPlace` marks where
 * the first group ends). This is the caption that says so, rather than leaving
 * out-of-place rows to read as matches for the place. `null` means render
 * nothing: no place was asked for, or every row is in it.
 */
export function employerElsewhereNote(inPlace: number | undefined, total: number): string | null {
    if (inPlace === undefined || inPlace >= total) return null;
    if (inPlace === 0) return "No roles at this employer match your location — showing its roles elsewhere.";
    return `Showing ${inPlace} ${inPlace === 1 ? "role" : "roles"} in your location first, then this employer's roles elsewhere.`;
}

/**
 * Pure: the `search_zero_results` analytics payload (lib/analytics/events.ts)
 * for one failed search — everything needed to reconstruct WHICH filter
 * combination produced zero hits from a dashboard, without ever carrying the
 * typed query text (see `EventPayloads.search_zero_results`'s own doc
 * comment for the "why" of that split). Extracted here, not inlined at the
 * `captureEvent` call site (jobs/page.tsx), so it's testable without a
 * browser or a mocked `posthog-js` — matching this file's own
 * `unmatchedPlaceNote`/`isUnavailableJobsResult` precedent.
 *
 * `active_facets` (facet names only, never their values) reads `activeFilterEntries` (FilterPanel.tsx) — the SAME
 * chokepoint the toolbar chips, the mobile sheet, and this exact zero-result
 * state's own "clear a filter" suggestions already read — with
 * `includeQuietDefaults: true`, so a silently-applied default (today, only
 * the pristine 90d posted-bucket) is named here just like an explicit pick.
 * That can make `active_facets` longer than `filter_count` (which stays the
 * pre-existing, quiet-defaults-excluded count — an established dashboard
 * contract this change doesn't touch): a search failing under a quiet
 * default IS the kind of excluder this payload exists to surface, the same
 * reasoning `activeFilterEntries`'s own doc comment gives for why the
 * zero-result state passes that option elsewhere. Never enumerates a facet
 * by name — a facet added to `FilterState` later is covered by construction,
 * the same guarantee `activeFilterEntries` already gives its other callers.
 *
 * `defaultedLocation` is the IP-based default country the search response
 * carries (actions/jobs.ts). The typed places the resolver could not match
 * (`unmatchedPlaceMentions`) are not sent: they are words a person typed, and
 * this event is tied to a signed-in account. The anonymous search log keeps
 * them for the demand view (`unmatchedPlaces`, lib/jobs/search-log.ts).
 */
export function buildZeroResultPayload(
    filterState: FilterState,
    query: string,
    location: { defaultedLocation?: string },
): EventPayloads["search_zero_results"] {
    return {
        query_length: query.trim().length,
        filter_count: activeFilterEntries(filterState).length,
        active_facets: activeFilterEntries(filterState, { includeQuietDefaults: true }).map((entry) => entry.key.split(":")[0]),
        defaulted_location: location.defaultedLocation ?? null,
    };
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
     * id and search (see `usedDeadLinkPassBefore` below and
     * `deadLinkPassRef` in JobsContent.tsx) — this function has no memory
     * of past calls, so a caller that keeps passing `false` for the same id
     * forever would keep it "preserved" forever too.
     */
    wasConfirmed: boolean;
}

/** The id that used its one "preserve, don't reassign" pass, and the search it used it on. */
export interface DeadLinkPass {
    id: string;
    searchKey: string;
}

/**
 * Has `id` already used its free pass on an EARLIER search than `searchKey`?
 * The pass lasts until the visitor starts a new search; the same search
 * fetched again keeps it. On a dev server StrictMode runs the fetch effect
 * twice, and the second run spent the pass, so a job opened from a shared
 * link closed itself about 3 seconds after load (2026-10-01).
 */
export function usedDeadLinkPassBefore(pass: DeadLinkPass | null, id: string | null, searchKey: string): boolean {
    return id != null && pass?.id === id && pass.searchKey !== searchKey;
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
 * Should the detail sheet's dismiss call `router.back()`? Only when the URL
 * still names an open job — i.e. the visitor closed the sheet themselves.
 * When history/reconcile already cleared `job`, Radix still invokes
 * `onOpenChange(false)` on the controlled sheet; backing again would pop a
 * prior search entry and re-run the fetch effect.
 */
export function shouldBackOnDetailSheetClose(open: boolean, urlJobId: string | null): boolean {
    return !open && urlJobId != null;
}

/**
 * Two-Panel Selector (desktop split view, xl+) — the ONE place that decides
 * where the shared detail ternary mounts. Both the Sheet's `open` prop and
 * the xl+ pane's render condition derive from this single function so they
 * can never independently drift out of mutual exclusion — a CSS-only "hide
 * the sheet, show the pane" would double-mount `JobDetail` (double
 * related-jobs fetch, double open-rank telemetry).
 *
 * Auto-preview (2026-08-14 investor-polish, reversing v1's no-auto-select):
 * at xl+ the pane previews the ambient job with no explicit open, via
 * `hasAmbientJob`. The original objection to auto-select was open-rank
 * telemetry poisoning, and that still holds — which is why this stays a
 * RENDER-ONLY mount: `recordJobOpenedAction`, `openedIds`, and the `?job=`
 * URL write all live exclusively in `openJob` (jobs/page.tsx), which only a
 * real click/keypress reaches. Below xl nothing changes: the sheet still
 * opens only on an explicit open (`detailSheetOpen`).
 *
 * Item 5, 2026-08-21 front-door audit: the caller now passes
 * `hasAmbientJob` as "is there actually a job selected/previewable" rather
 * than "are there hits at all" — on the pristine, zero-intent landing
 * below xl there's no explicit selection AND ambient preview is suppressed
 * (see `shouldSuppressLandingAmbientPreview`), so `hasAmbientJob` is false
 * there even with hits on screen. At xl+ on the same pristine landing,
 * `hits[0]` fills the pane as an ambient preview without writing `?job=`.
 * Everywhere else (a real search, a deep link) is unchanged: this function's
 * own contract didn't move, only what the caller means by "ambient job" got
 * more precise.
 */
export type DetailMountSite = "sheet" | "pane" | "none";

export function resolveDetailMountSite(
    isXlUp: boolean,
    detailSheetOpen: boolean,
    hasAmbientJob: boolean,
): DetailMountSite {
    if (detailSheetOpen) return isXlUp ? "pane" : "sheet";
    return isXlUp && hasAmbientJob ? "pane" : "none";
}

/**
 * Item 5 / first-viewport collapse (2026-08-31): on the pristine landing,
 * below xl there is no detail pane and the sheet must not auto-open — so
 * `hits[0]` must not stand in as an ambient preview. At xl+ the pane earns
 * an ambient preview even with zero explicit intent, so suppression lifts.
 * Every non-pristine state keeps the ordinary browsing default.
 */
export function shouldSuppressLandingAmbientPreview(isPristineLanding: boolean, isXlUp: boolean): boolean {
    return isPristineLanding && !isXlUp;
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
    | { status: "found"; job: PublicJob; descriptionPending: boolean }
    | { status: "not_found" }
    /** The check itself was inconclusive — backend unconfigured, or the
     *  request failed (e.g. `id` isn't a legal filter on this index yet —
     *  see `buildFilter` in lib/jobs/meilisearch.ts). Never treated as a
     *  "not found" — honesty requires the absence of proof to stay
     *  distinct from proof of absence. */
    | { status: "unknown" };

/**
 * True only when `result` is a COMPLETE, trustworthy envelope from the full
 * corpus — the single predicate every caller that needs to trust a
 * `JobSearchResult` (not just its hits) must go through, so the existence
 * check and any cache/no-cache decision over the same result can never
 * drift apart. Requires ALL of: a known-COMPLETE backend (`"meilisearch"` —
 * never `"snapshot-preview"`, a CAPPED SUBSET per lib/jobs/snapshot-preview.ts's
 * own header comment, or `"unconfigured"`), no error note (`search.ts`'s
 * outer `catch` is the only `JobSearchResult` constructor that ever sets one
 * on a `configured:true, backend:"meilisearch"` result — see
 * `classifyExistenceCheck`'s git history for the full trace), no
 * `unavailable` flag (a Meili-outage envelope with zero hits and no cached
 * fallback), and no `meta.degraded` (a served-from-cache response — stale by
 * construction, so "complete" but not "current"). Reads `meta` through
 * `servedMeta` (this file's one authorized cast past `JobSearchResult`'s
 * currently-declared shape) so a response with no `meta` at all — today's
 * live shape — reads as not-degraded, same default `degradedResultsNote`
 * uses.
 */
export function isAuthoritativeResult(result: JobSearchResult): boolean {
    return (
        result.configured &&
        result.backend === "meilisearch" &&
        !result.note &&
        !result.unavailable &&
        !servedMeta(result)?.degraded
    );
}

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
 * anything. `not_found` now requires `isAuthoritativeResult` PLUS zero hits.
 * Every other combination — including a `found` check's own preconditions
 * failing — falls through to `unknown` by construction (the function's LAST
 * line, not a special-cased branch), so a future new failure mode can't
 * silently reintroduce this bug by being routed to the wrong default again.
 */
export function classifyExistenceCheck(
    id: string,
    result: JobSearchResult & { descriptionPending?: boolean },
): ExistenceCheckStatus {
    const job = result.hits.find((h) => h.id === id) ?? null;
    if (job) return { status: "found", job, descriptionPending: Boolean(result.descriptionPending) };
    if (isAuthoritativeResult(result) && result.hits.length === 0) return { status: "not_found" };
    return { status: "unknown" };
}

/**
 * The one chokepoint every id-scoped detail fetch goes through (jobs/page.tsx's
 * dead-job check + on-demand hydrate, yours/[id]/page.tsx's open + retry).
 * `classifyExistenceCheck` above only ever sees a resolved `JobSearchResult`
 * — it has no opinion on the REQUEST itself throwing (dropped connection, a
 * server action rejecting). Every prior call site hand-rolled that try/catch
 * differently: one mapped a throw to `unknown`, another silently swallowed it
 * and left its caller's state untouched. This is that mapping, written once.
 *
 * Query shape is fixed at `{ id, limit: 1, offset: 0, hideGhosts: false }`
 * for every caller — `hideGhosts` must stay false so this sees the WHOLE
 * corpus, not just the non-ghost subset, or a genuinely live likely_ghost
 * posting would classify `not_found` and get declared dead (verified in
 * `buildFilter`, lib/jobs/meilisearch.ts).
 *
 * `search` is injected rather than importing `searchJobsAction` directly, so
 * this stays a plain unit-tested function with no Next server-action/runtime
 * dependency.
 *
 * Contract: never throws. The request failing is `unknown`, exactly like
 * every other inconclusive case `classifyExistenceCheck` already covers —
 * never a thrown error reaching the caller, and never a false `not_found`.
 */
export async function runExistenceCheck(
    id: string,
    search: (query: {
        id: string;
        limit: number;
        offset: number;
        hideGhosts: boolean;
    }) => Promise<JobSearchResult & { descriptionPending?: boolean }>,
): Promise<ExistenceCheckStatus> {
    try {
        const result = await search({ id, limit: 1, offset: 0, hideGhosts: false });
        return classifyExistenceCheck(id, result);
    } catch {
        return { status: "unknown" };
    }
}

/**
 * The empty-query landing state (page.tsx's `emptySearchState`, unit-tested
 * here rather than only inline in the component). Classifies the
 * query/filter state alone — before any fetch outcome is known — into one
 * of:
 *
 *   - `"results"` — there's a query or a fit ranking: render the ordinary
 *     results surface, nothing to do with the empty-search states below.
 *   - `"serp-ask"` — filters are active with no query: the visitor has
 *     already told us something, so this now drives an UNCACHED zero-query
 *     fetch (empty text, their filters applied) — see jobs/page.tsx's fetch
 *     effect and `resolveJobsRenderMode` below.
 *   - `"overlay-ask"` — the genuine first-screen prompt: nothing typed, no
 *     filters. Browse-by-default (2026-08-07 front-door reversal) drives
 *     THIS state through the cached, fixed-shape `getDefaultBrowseAction`
 *     instead (`actions/jobs.ts`) — the one shape cheap enough to share
 *     across every visitor in the same country.
 *
 * Both ask states now attempt a fetch (see `resolveJobsRenderMode`) —
 * neither name means "never fetches" anymore, only "which fetch shape."
 *
 * "Explore" (résumé-driven AI-suggested adjacent roles) moved to MCP
 * 2026-08-02 — this used to have a fourth outcome, `"auto-explore"`, that
 * auto-entered it on a résumé-holding visitor's first landing; removed along
 * with the page.tsx effect that acted on it (see git history if that
 * behavior is ever needed again).
 */
export type EmptySearchState = "results" | "overlay-ask" | "serp-ask";

export interface EmptySearchStateInput {
    hasQuery: boolean;
    fitActive: boolean;
    activeFilterCount: number;
    /**
     * A corpus narrowing is in play that is NOT one of the toolbar filters
     * `activeFilterCount` counts — a `board` allowlist or a single-employer
     * `companyDomain` (JobsUrlState).
     *
     * Load-bearing, not cosmetic: `"overlay-ask"` is the ONE state page.tsx
     * serves from `getDefaultBrowseAction` — a cached, fixed-shape browse
     * shared across every visitor in the same country, which by design does
     * not carry the caller's params. A scoped visit with no typed query
     * therefore rendered the ENTIRE corpus while the page displayed the
     * scope: measured locally 2026-08-16, `/jobs?company=harrods.com` showed
     * "721,946 roles" of unrelated employers under an "EMPLOYER harrods.com"
     * chip. `board` had the identical latent bug (`/jobs?board=elite` with no
     * query), which is why the input is a general "is the corpus narrowed"
     * fact rather than a companyDomain flag — the next scope is covered by
     * construction.
     */
    hasCorpusScope: boolean;
}

export function resolveEmptySearchState(input: EmptySearchStateInput): EmptySearchState {
    if (input.hasQuery || input.fitActive) return "results";
    return input.activeFilterCount > 0 || input.hasCorpusScope ? "serp-ask" : "overlay-ask";
}

/** The zero-query fetch's outcome, as far as `resolveJobsRenderMode` needs
 *  to know — deliberately NOT the raw `JobSearchResult`, so the decision
 *  stays testable without constructing one. */
export interface JobsFetchOutcome {
    /** A first-page fetch is currently in flight for this state. */
    loading: boolean;
    hitCount: number;
    /** The fetch concluded as a genuine failure (unavailable/unconfigured
     *  backend, thrown transport error) — never true merely because
     *  `hitCount` is zero; a real zero-match browse or search is not a
     *  failure. */
    failed: boolean;
}

/**
 * Browse-by-default's render decision (2026-08-07 front-door reversal). A
 * zero query used to mean an instant, un-fetched `"serp-ask"` seed list, full
 * stop (the removed rule §1). Zero-query states now ALSO attempt a fetch
 * (`resolveEmptySearchState` above decides which shape), so this only ever
 * falls back to the ask state once that fetch has DEFINITIVELY failed with
 * nothing to show — never merely because the query is empty, never while
 * still loading (that renders the ordinary loading skeleton through the same
 * results pipeline instead), and never merely because filters are active
 * (an `"serp-ask"`-classified state whose filtered fetch actually returned
 * hits still renders as results — filters no longer block the front page
 * from showing real jobs).
 */
export function resolveJobsRenderMode(
    emptySearchState: EmptySearchState,
    fetch: JobsFetchOutcome,
): "results" | "serp-ask" {
    if (emptySearchState === "results") return "results";
    if (fetch.loading || fetch.hitCount > 0) return "results";
    return fetch.failed ? "serp-ask" : "results";
}

/**
 * WHICH panel the results pane renders — the one decision behind what used
 * to be an inline five-way ternary in jobs/page.tsx. Same reason
 * `resolveDetailMountSite` above exists: two things were reading the SAME
 * state to decide independently what to show, and drifted out of mutual
 * exclusion.
 *
 * The drift (user-reported, prod screenshot 2026-08-08): a zero-results
 * search rendered "OR TRY …" TWICE — a standalone pivot seed row above the
 * pane (gated on `emptySearchState !== "results" && !isSerpAsk`) plus
 * `EmptyResults`' own seed row inside it. Nothing tied the two gates
 * together, so the overlap state (empty-search classification AND a
 * zero-hit fetch) satisfied both. The standalone row itself is gone now
 * (2026-08-15, ITEM H — its job folded into the search box's own
 * "Popular searches" dropdown), but this panel resolver stays: it's still
 * the one thing that decides which results-pane branch renders.
 *
 * Order is the ternary's own precedence, unchanged: the ask state, then
 * hard backend states, then loading, then empty, then the list.
 *
 * `loading` returns "loading" even when `hitCount > 0` (stale results from
 * the previous search are present). Showing irrelevant old rows during a new
 * query/filter/sort/location refresh confuses more than it helps: the rows
 * belong to a different search the user just changed. `blockingError` and
 * `notConnected` are only ever true at their declaration sites when
 * `hits.length === 0`, so the guard ordering already handles any overlap.
 */
export type JobsResultsPanel = "serp-ask" | "not-connected" | "error" | "loading" | "empty" | "list";

export function resolveJobsResultsPanel(input: {
    isSerpAsk: boolean;
    notConnected: boolean;
    blockingError: boolean;
    loading: boolean;
    hitCount: number;
}): JobsResultsPanel {
    if (input.isSerpAsk) return "serp-ask";
    if (input.notConnected) return "not-connected";
    if (input.blockingError) return "error";
    if (input.loading) return "loading";
    return input.hitCount === 0 ? "empty" : "list";
}

/**
 * A4 — the end-of-list line's honesty check. `hits.length` stops growing at
 * TWO different ceilings that page.tsx's own `hasMore` conflates into one
 * "no more to load" signal: the corpus is genuinely exhausted, OR pagination
 * hit `MAX_REACHABLE` (Meili's own `pagination.maxTotalHits`, mirrored as
 * `CORPUS_COUNT_CAP` in corpus-count.ts) while the corpus's honest resolved
 * total — `resolveCorpusCount`'s `.value`, which recovers the REAL number
 * from the `ghost_badge` facet sum once `total` itself saturates at the cap
 * — is far bigger. Before this, "You've reached the end — N roles" printed
 * that honest N (e.g. 1.7M, via the facet-sum recovery) even when only
 * `MAX_REACHABLE` (100,000) had actually been shown or could ever be
 * reached in this session — stating a real number in a sentence that implies
 * every one of them was just displayed.
 *
 * `total` here is the CALLER's already-resolved honest count (`totalCount
 * .value` from `resolveCorpusCount`, page.tsx), not the raw possibly-capped
 * `JobSearchResult.total` — this function has no opinion on HOW the count
 * was recovered, only on whether what's loaded (`hitsLength`) accounts for
 * all of it.
 *
 * Boundary (`hitsLength === total === maxReachable`): resolves to
 * `"genuine-end"`, not `"cap-reached"`. There is no number this function
 * could honestly show as "more exist" — the resolved total IS the reachable
 * cap, exact or floor — so claiming a cap was hit ahead of a bigger total
 * would itself be the lie this function exists to prevent.
 */
export function resolveEndOfListState(input: {
    hitsLength: number;
    total: number;
    maxReachable: number;
}): "genuine-end" | "cap-reached" | "more-available" {
    const { hitsLength, total, maxReachable } = input;
    if (hitsLength >= total) return "genuine-end";
    if (hitsLength >= maxReachable) return "cap-reached";
    return "more-available";
}
