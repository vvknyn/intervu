"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    MagnifyingGlass,
    WarningCircle,
    Compass,
    CaretDown,
    CaretUp,
    FunnelSimple,
    MapPin,
    X,
    Check,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { SearchAutocomplete, type SearchAutocompleteHandle } from "@/components/search/SearchAutocomplete";
import type { SearchSuggestion } from "@/lib/search-suggestions";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AuthPopover } from "@/components/auth/auth-popover";
import { GUEST_SERP_TIP } from "@/components/marketing/openclaw-content";
import { marketingClaim } from "@/lib/marketing-stats";
import { getMarketingStatsAction } from "@/actions/marketing";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    searchJobsAction as searchJobsActionRaw,
    getDefaultBrowseAction,
    markJobAppliedAction,
    getJobsFreshnessAction,
    getPostedDateFilterSupportAction,
    recordJobOpenedAction,
} from "@/actions/jobs";
import { goAfterJobAction } from "@/actions/application";
import { reportJobEnabledAction } from "@/actions/report-job";
import { usePursuits, invalidatePursuitsCache, syncGuestPursuitsToServer } from "@/lib/pursuits/use-pursuits";
import { listGuestPursuits, addGuestPursuit } from "@/lib/pursuits/guest-store";
import { syncGuestFollowsToServer, useFollows } from "@/lib/follows/use-follows";
import { FollowAlertsCard } from "@/components/follows/FollowAlertsCard";
import { BoardVisitBanner } from "@/components/jobs/BoardVisitBanner";
import { hasReachedStage } from "@/lib/pursuits/types";
import { withSettleGuard } from "@/lib/jobs/settle-guard";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { rowTrustChip, type RowTrustChip } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { LISTING_STATE_CHIP, LISTING_STATE_CHIP_LABEL } from "@/lib/ui/status-tokens";
import {
    decodeText,
    displayCompanyBrand,
    locationText,
    salaryText,
    postedAgeShort,
    searchResultLine,
    firstMentionIndex,
    partitionByTitleMatch,
    seamSummary,
    seamSummarySorted,
    prettyEnum,
    ghostMetaFor,
    GHOST_META,
} from "@/lib/jobs/presentation";
import { ContextHelp } from "@/components/ui/context-help";
import {
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
    recordRecentSearch,
    resolveSearchSeeds,
} from "@/lib/jobs/recent-searches";
import {
    subscribeRecentlyViewed,
    getRecentlyViewedSnapshot,
    getRecentlyViewedServerSnapshot,
    recordRecentlyViewedJob,
} from "@/lib/jobs/recently-viewed";
import { jobsUrlStateFromSavedHref } from "@/lib/jobs/saved-searches";
import { useSavedSearches, syncGuestSavedSearchesToServer } from "@/lib/jobs/use-saved-searches";
import {
    subscribeSuppressLocationDefault,
    getSuppressLocationDefaultSnapshot,
    getSuppressLocationDefaultServerSnapshot,
    suppressLocationDefault,
    restoreLocationDefault,
    shouldShowLocationDefaultChip,
} from "@/lib/jobs/location-default-preference";
import { countryToFlag } from "@/lib/jobs/country-flag";
import { chipVariants, ChipDismiss } from "@/components/ui/chip";
import { SavedSearchesPanel } from "@/components/jobs/SavedSearchesPanel";
import { LandingMasthead, indexCategories } from "@/components/jobs/LandingMarketingShowcase";
import {
    activeFilterEntries,
    entriesNeedingOwnChip,
    chipLabelForEntry,
    toggleFacetValue,
    PRISTINE_FILTER_STATE,
    applyLocationSheetDraft,
    locationTriggerLabel,
    type FilterState,
    type LocationSheetDraft,
} from "@/components/jobs/FilterPanel";
import { FilterChipsRow, pickRemoteFacetValue } from "@/components/jobs/FilterChipsRow";
import { LocationPickerSheet } from "@/components/jobs/LocationPickerSheet";
import { SerpFilters } from "@/components/jobs/SerpFilters";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
import { shouldPromptApplyIntent } from "@/lib/jobs/apply-intent";
import { FacetBar, facetBarRepresents } from "@/components/jobs/FacetBar";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { JobDetail, JobDetailActionBar, JobDetailSkeleton } from "@/components/jobs/JobDetail";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { resolveCorpusCount, formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { resolveBeyondWindow } from "@/lib/jobs/beyond-window";
import { JobsPaginationGeneration } from "@/lib/jobs/pagination-generation";
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    classifyExistenceCheck,
    resolveEmptySearchState,
    resolveJobsRenderMode,
    resolveJobsResultsPanel,
    DEAD_JOB_TOMBSTONE_TEXT,
    SEARCH_UNAVAILABLE_MESSAGE,
    shouldClearStaleJobUrl,
    shouldBackOnDetailSheetClose,
    resolveDetailMountSite,
    degradedResultsNote,
    resolveEndOfListState,
    resolveResumeControlState,
    runResumeControlClick,
    hasSearchPrefs,
    shouldPromptSearchPrefsInsteadOfResume,
} from "@/lib/jobs/result-state";
import { parseWorkTypeTokens } from "@/lib/jobs/query-understanding";
import { fetchAgentPreferencesAction, saveAgentPreferencesAction, type AgentPreferences } from "@/actions/agent-preferences";
import { SearchPrefsSetup, type SearchPrefsValues } from "@/components/jobs/SearchPrefsSetup";
import { shouldPromptApplyReturn } from "@/lib/jobs/apply-return";
import { clusterJobs } from "@/lib/jobs/cluster";
import { coerceSortToSupported, resolveEffectiveSort, shouldScopeTextMatchToTitle } from "@/lib/jobs/sort";
import {
    type FacetKey,
    type JobSearchParams,
    type JobSortMode,
    type PostedBucket,
    type PublicJob,
} from "@/lib/jobs/types";
import {
    parseJobsUrl,
    serializeJobsUrl,
    DEFAULT_URL_STATE,
    urlSortToMode,
    withSortCleared,
    shouldResetSortOnQueryChange,
    type JobsUrlState,
    type UrlSort,
} from "@/lib/jobs/url-state";
import { FitIntentGuard } from "@/lib/jobs/fit-intent";
import { buildJobSearchPayload } from "@/lib/jobs/search-payload";
import { domainToSlug } from "@/lib/boards/slug";
import { jobPath } from "@/lib/jobs/job-slug";
import type { BoardId } from "@/lib/boards/types";
import { buildMatchQuery } from "@/lib/jobs/resume-match";
import {
    emptyPending,
    queuePending,
    clearPending,
    takeReplay,
    resolveApplyGateDecision,
    type PendingState,
} from "@/lib/jobs/pending-actions";
import { toast } from "@/lib/toast";
import { classifySentinel } from "@/lib/llm/sentinels";
import type { ResumeData } from "@/types/resume";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { useResumePresence } from "@/lib/resume/use-resume-presence";
import {
    formatAuthGateValueLine,
    GUEST_SAVE_TOAST,
    type AuthGateReason,
} from "@/lib/auth/auth-gate-copy";
import {
    getGuestSaveCount,
    recordGuestSave,
    isGuestSaveBannerDismissed,
    dismissGuestSaveBanner,
} from "@/lib/auth/guest-save-gate";

/**
 * Every search-action call on this page goes through this one
 * rebinding, not the raw import — a single chokepoint (writing-lean-code
 * rule 3) rather than wrapping each of this file's several call sites
 * individually. See settle-guard.ts for why: an edge-level 503 can drop a
 * Server Action POST without ever resolving OR rejecting on the client,
 * which — unguarded — leaves whichever call made it stuck (most visibly,
 * the first-page search's `loading` spinner, since its `finally` never
 * runs). A timeout rejects instead, so every existing catch block here
 * (already routing thrown errors into `searchError` → the Retry UI) handles
 * it for free.
 */
/** The id of the most recent search, so an open can be attributed to the
 *  search that produced it. Captured HERE rather than in component state
 *  because every search on this page — first page, retry, load-more —
 *  already funnels through this one wrapper, and an open is only ever
 *  attributable to the latest result set the user is looking at. */
let lastSearchId = "";

/** Whatever `searchJobsActionRaw` (actions/jobs.ts) actually returns —
 *  `JobSearchResult` plus its additive fields (`searchId`, `meta`,
 *  `defaultedLocation`), derived rather than hand-copied so a new field
 *  there is visible here for free instead of needing a second widened type
 *  kept in sync by hand. */
type JobsSearchActionResult = Awaited<ReturnType<typeof searchJobsActionRaw>>;

const searchJobsAction = (params: JobSearchParams): Promise<JobsSearchActionResult> =>
    withSettleGuard(
        searchJobsActionRaw(params).then((r) => {
            lastSearchId = r.searchId;
            return r;
        }),
    );

/** Same settle-guard + `lastSearchId` bookkeeping as `searchJobsAction`
 *  above, for the cached default-browse action the zero-query landing fetch
 *  calls instead (see `emptySearchState` / the fetch effect below).
 *  `getDefaultBrowseAction`'s return type is structurally a
 *  `JobsSearchActionResult` (every field present; `meta` just never carries
 *  the `gated` field a live shield-gated search can), so it type-checks
 *  through the same result state the rest of this page reads. */
const getDefaultBrowseActionGuarded = (suppressLocationDefault: boolean): Promise<JobsSearchActionResult> =>
    withSettleGuard(
        getDefaultBrowseAction(suppressLocationDefault).then((r) => {
            lastSearchId = r.searchId;
            return r;
        }),
    );

/* ----------------------------- helpers ----------------------------- */

/** Reverse of `urlSortToMode`, for writing the URL from an in-app sort choice. */
function modeToUrlSort(mode: JobSortMode): UrlSort {
    return mode === "salary_desc" ? "salary" : mode;
}

/**
 * Real segmented control on the repo's squared chip primitive
 * (`chipVariants`, components/ui/chip.tsx) — previously a bare 11px text
 * button with a ~15px hit target (measured on prod, below the 24px WCAG
 * floor) and "pressed" conveyed by underline alone. Active/pressed now
 * reuses the SAME live-tint chip state every other active chip in the app
 * uses, rather than a one-off text treatment.
 */
/** Peers of the Filters control — h-11 on mobile, chip-primitive density on lg. */
const toolbarChipClass =
    "inline-flex items-center justify-center h-11 px-3 text-[13px] font-medium rounded-none lg:h-7 lg:px-2 lg:text-[11px]";

function SortSegment({
    label,
    pressed,
    onClick,
}: {
    label: string;
    pressed: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
                "h-7 px-3 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all duration-150",
                pressed
                    ? "bg-white text-slate-950 shadow-xs dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-700"
                    : "text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
            )}
        >
            {label}
        </button>
    );
}

/**
 * The IP-based location default's own honesty affordance — lives IN the
 * location control now (G3, Grok UX wave), not downstream in the results
 * row: whenever the CURRENT result set was silently narrowed to the
 * searcher's own country (`result.defaultedLocation`, an ISO2 the server
 * only ever sets when it applied that default — see lib/geo/ip-default.ts)
 * AND the location box is still empty (`shouldShowLocationDefaultChip`,
 * lib/jobs/location-default-preference.ts), this renders right next to the
 * location input so the narrowing is disclosed where a searcher would
 * actually look to change it, not just noted after the fact in the results.
 *
 * The country NAME is resolved client-side via the built-in
 * `Intl.DisplayNames` rather than shipping any of the gazetteer's ~70k-row
 * data to the browser for a lookup this small — `iso2` is the only thing
 * the server sends. `countryToFlag` (lib/jobs/country-flag.ts) already
 * accepts a bare ISO2 (JobDetail's flag chip uses the same function on a
 * corpus country name), so the flag needs no separate lookup either.
 *
 * Squared `chipVariants`/`ChipDismiss` (components/ui/chip.tsx) — the SAME
 * shared chip primitive JobDetail's "also in" chip and FilterChipsRow use —
 * rather than a one-off style, per the docs-mockup squared-chip system.
 * `active: false` keeps it quiet (no green tint): this is a passive fact
 * about the result set, not a selected/verified state. `onClear` is the
 * SAME `suppressLocationDefault` write path the old results-row chip used —
 * REUSED, not a second suppression flag.
 */
/** Country name for an ISO2 via the browser's own region-name table, with a
 *  bare-code fallback if `Intl.DisplayNames` throws. Shared by
 *  `DefaultLocationChip` and the zero-result state's geo-default entry
 *  (below) so there is exactly one place that resolves this, not a second
 *  copy of the same try/catch. */
function regionDisplayName(iso2: string): string {
    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2) ?? iso2;
    } catch {
        return iso2;
    }
}

function DefaultLocationChip({ iso2, onClear }: { iso2: string; onClear: () => void }) {
    const flag = countryToFlag(iso2);
    const name = useMemo(() => regionDisplayName(iso2), [iso2]);
    return (
        <span
            data-testid="default-location-chip"
            className={cn(chipVariants({ active: false }), "mono-data h-7 gap-1.5 text-[12px]")}
        >
            {flag && <span aria-hidden>{flag}</span>}
            near {name}
            <ChipDismiss label={`Stop defaulting to ${name}`} onClick={onClear} />
        </span>
    );
}

/**
 * Compact pivot row rendered ABOVE default-browse results (browse-by-default,
 * 2026-08-07 front-door reversal) — the seed chips no longer disappear once
 * the zero-query landing shows real jobs, they just shrink from the full
 * serp-ask block into a one-line row of shortcuts sitting on top of the
 * results they used to stand in for. Same seeds (`resolveSearchSeeds`), same
 * `submitSearch` chokepoint, same `serp-ask-seed` testid as the full block
 * below — one write path, one thing e2e has to know about, in either
 * rendering context.
 */
function BrowseSeedRow({ seeds, onSubmit }: { seeds: string[]; onSubmit: (seed: string) => void }) {
    if (seeds.length === 0) return null;
    return (
        <div
            data-testid="browse-seed-row"
            className="mb-4 flex flex-wrap items-center gap-1.5 text-left"
        >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Popular searches:</span>
            {seeds.map((seed) => (
                <button
                    key={seed}
                    type="button"
                    data-testid="serp-ask-seed"
                    title={`Search for ${seed}`}
                    onClick={() => onSubmit(seed)}
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-xs font-medium text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/80 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-700 shadow-2xs"
                >
                    {seed}
                </button>
            ))}
        </div>
    );
}

/**
 * Resolve the URL's `sort` to the backend `JobSortMode` this page sends to
 * `searchJobsAction`. `fit` isn't a backend sort mode — "ranked by résumé"
 * is achieved by putting the résumé-derived text into `query` (see
 * `applyFit`) and letting relevance ranking do the work, exactly like the
 * old Match mode did. So `fit` resolves to `null` here (no override), and
 * `resolveEffectiveSort` naturally lands on "relevance" once that query is
 * non-empty. Whether "ranked by résumé" is ACTIVE (for the Select label +
 * dismissible chip) is tracked separately by the `fitActive` state, derived
 * straight from the raw URL value — see its declaration below. This is the
 * ONE call site for `urlSortToMode`, so this is the only place sort=fit
 * needs handling.
 */
function resolveUrlSort(s: UrlSort | null): JobSortMode | null {
    if (!s) return null;
    const mode = urlSortToMode(s);
    return mode === "fit" ? null : mode;
}

/**
 * Task 9 — typeahead: adapt `/api/jobs/suggest`'s plain `{ titles, companies }`
 * into `SearchAutocomplete`'s `SearchSuggestion` shape. Companies are tagged
 * `'company'` so the dropdown renders them with a distinct icon (Buildings,
 * vs. the default magnifying-glass for titles) — the type field doubles as
 * both the render hint and the semantic label; no counts (company isn't a
 * facet — see `JobSuggestions`, lib/jobs/types.ts).
 */
function mapToSuggestions(data: { titles: string[]; companies: string[] }): SearchSuggestion[] {
    return [
        ...data.titles.map((text): SearchSuggestion => ({ text, type: "role" })),
        ...data.companies.map((text): SearchSuggestion => ({ text, type: "company" })),
    ];
}

/* ----------------------------- ledger row ----------------------------- */

/** Squared mono `key value` fact-chip base */
const FACT_BOX = "inline-flex items-center gap-1.5 rounded-none px-2.5 py-0.5 text-[12px] leading-tight font-medium glass-tint-muted transition-colors";

/**
 * How each `rowTrustChip` state renders as the small icon beside the job
 * title — one table instead of one hand-written glyph+color pair per state
 * (same reasoning the old chip-box table this replaces had — see git
 * history). Per the house attention system (docs/design/ATTENTION.md,
 * channel 4): semantic color marks EXCEPTIONS only, so `clear`/`checked` —
 * the "nothing to flag" states — carry no glyph at all. A green checkmark on
 * every row was exactly the "✓ ACTIVELY POSTED" wallpaper this table used to
 * produce; only `review` and `ghost` are actual exceptions worth a mark.
 *
 * `ghost`/`clear` reuse `GHOST_META`'s labels (not a second word for the same
 * state — see `rowTrustChip`'s doc comment) so the row and the detail panel
 * stay one vocabulary by construction.
 */
const TRUST_CHIP: Record<RowTrustChip, { label: string; glyph: string | null; glyphCls: string }> = {
    ghost: {
        label: GHOST_META.likely_ghost!.label,
        glyph: "✕",
        glyphCls: "text-red-600 dark:text-red-400",
    },
    review: {
        label: GHOST_META.caution!.label,
        glyph: "⚠",
        glyphCls: "text-amber-600 dark:text-amber-400",
    },
    clear: {
        label: GHOST_META.clear!.label,
        glyph: null,
        glyphCls: "",
    },
    checked: {
        label: "checked",
        glyph: null,
        glyphCls: "",
    },
};

/** Same "employer's posted date was likely refreshed" claim JobDetail's
 *  relisted disclosure sentence makes (JobDetail.tsx) — reused verbatim
 *  rather than a second wording for the same fact. */
const RELISTED_EXPLAIN =
    "Employer's posted date is newer than when we first found this role — the date was likely refreshed.";

/**
 * One result. Title + company/location on the left, a fixed-width data rail
 * (salary, ghost flag, age — top to bottom, whichever apply) on the right.
 * Two anchors, not a single stacked block: the left identity answers "what
 * is this, who's it at, where," the right rail answers "what's it worth,
 * anything to watch for, how stale" — different questions, so they read as
 * different columns rather than one run-on line.
 *
 * The title dominates for a ranking reason: `searchableAttributes` order puts
 * `title` first (JOBS_INDEX_SETTINGS, lib/jobs/meilisearch.ts), so the
 * engine's attribute rule ranks title matches above description matches —
 * making the title the loudest thing means the eye lands on the very text the
 * engine ranked. When visual hierarchy and ranking disagree, even correct
 * results feel arbitrary.
 *
 * `opened` (session-only, see `openedIds` in JobsContent) recesses a
 * previously-opened row's title to muted-medium instead of bold — a plain
 * "already read" signal, distinct from `active` (the row whose detail is
 * OPEN right now).
 */
function JobCard({
    job,
    active,
    opened,
    onClick,
    onCompany,
    now,
    variantCount = 0,
    expanded = false,
    onToggleExpand,
}: {
    job: PublicJob;
    active: boolean;
    opened: boolean;
    onClick: () => void;
    onCompany?: (job: PublicJob) => void;
    /** Accepted-but-unused: kept so call sites don't need editing. */
    onOpenPosting?: (job: PublicJob) => void;
    now: number;
    /** Accepted-but-unused: elite board styling removed from row chrome. */
    elite?: boolean;
    variantCount?: number;
    expanded?: boolean;
    onToggleExpand?: () => void;
}) {
    const accessibleName = `${decodeText(job.title)} at ${displayCompanyBrand(job.company, job.company_domain) || "Unknown company"}`;
    const trust = rowTrustChip(job, now);
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    // Relist caution (Task 3, Vivek request; retitled ITEM T 2026-08-15 — a
    // relist is a posted-date refresh, NOT a repost/close-reopen) — same
    // classifier JobDetail's own posted-chip reads, so the SERP row and the
    // detail panel can never disagree about which postings are re-stamped.
    const relisted = classifyPostingFreshness(job, now).kind === "relisted";
    const level = prettyEnum(job.experience_level);
    const employment = prettyEnum(job.employment_type);
    const loc = locationText(job);
    // `locationText` degrades to "Location not listed" (never throws, never
    // guesses) when nothing usable came off the posting — that sentinel is
    // an absence, not a value, so the LOCATION chip below renders only when
    // it's something OTHER than that (remote is always a known value, even
    // when the underlying `loc` is unknown, since `locationLine` never
    // surfaces the sentinel in the remote branch).
    const locationKnown = job.work_type === "remote" || loc !== "Location not listed";
    const modeLabel = job.work_type === "remote" ? "Remote" : job.work_type ? prettyEnum(job.work_type) : null;
    const locationLine =
        job.work_type === "remote" ? "Remote" : modeLabel ? `${loc} · ${modeLabel}` : loc;

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={active}
            aria-label={`View ${accessibleName}`}
            data-job-row
            data-testid="job-row"
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className={cn(
                "group mb-2.5 grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3.5 gap-y-2 rounded-none glass-card px-4 py-3 text-left transition-all duration-150 hover:border-foreground/50",
                active && "border-brand border-l-4 border-l-brand glass-tint-blue",
            )}
        >
            <div className="row-span-2 self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="min-w-0">
                <span className="inline-flex flex-wrap items-baseline gap-x-1">
                    <Link
                        href={jobPath(job)}
                        data-testid="job-title"
                        className={cn(
                            "text-[17px] leading-snug tracking-tight hover:underline",
                            opened ? "font-medium text-muted-foreground" : "font-semibold text-foreground",
                        )}
                        onClick={(e) => {
                            // A real href is what makes the row crawlable and
                            // middle-click/copy-link-able. But a plain click must
                            // keep opening the in-page panel (no full navigation)
                            // — the row's own onClick already does that, so stop
                            // it from ALSO firing via bubbling (would double the
                            // telemetry + history push) and drive it from here
                            // instead. Modified clicks (new tab, etc.) and
                            // non-primary buttons are left alone to use the
                            // anchor's native behavior.
                            e.stopPropagation();
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            e.preventDefault();
                            onClick();
                        }}
                    >
                        {decodeText(job.title)}
                    </Link>
                    {/* Exception-only trust icon, immediately after the title
                        (badge inversion, Task C1 — replaces the old
                        "✓ ACTIVELY POSTED" wallpaper chip that used to sit in
                        the top-right slot). `clear`/`checked` render nothing:
                        the default, nothing-to-flag state is unmarked per
                        ATTENTION.md channel 4. The icon IS the tooltip
                        trigger (`ContextHelp`'s `icon` override) rather than a
                        separate "?" mark beside a separate colored chip. */}
                    {trust && TRUST_CHIP[trust].glyph && (
                        <span
                            data-testid="row-trust-icon"
                            data-trust={trust}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center leading-none"
                        >
                            <ContextHelp
                                content={ghostMetaFor(job, now)?.explain ?? TRUST_CHIP[trust].label}
                                side="right"
                                className={TRUST_CHIP[trust].glyphCls}
                                icon={<span aria-hidden className="text-[13px] font-bold leading-none">{TRUST_CHIP[trust].glyph}</span>}
                            />
                        </span>
                    )}
                    {/* Relist caution — orthogonal to `trust` (a posting can
                        be both "clear" and relisted), so it's its own icon
                        rather than folded into the TRUST_CHIP table. */}
                    {relisted && (
                        <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center leading-none">
                            <ContextHelp
                                content={RELISTED_EXPLAIN}
                                side="right"
                                className="text-amber-600 dark:text-amber-400"
                                icon={<span aria-hidden className="text-[13px] font-bold leading-none">⟳</span>}
                            />
                        </span>
                    )}
                </span>
                <div className="mt-1 text-[14px] font-medium text-muted-foreground">
                    {onCompany ? (
                        <button
                            type="button"
                            className="hover:text-foreground hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCompany(job);
                            }}
                        >
                            {displayCompanyBrand(job.company, job.company_domain) || "Unknown company"}
                        </button>
                    ) : (
                        displayCompanyBrand(job.company, job.company_domain) || "Unknown company"
                    )}
                </div>
            </div>
            {/* Posted age, not a trust chip (badge inversion, Task C1) —
                the trust state is now the icon beside the title above; this
                slot is purely "how stale," reads as metadata rather than a
                claim. Monospace is reserved for <code> (see typography.test);
                `.mono-data` gets the same "figures line up" property from
                tabular-nums on the sans face instead. */}
            <span className="flex h-fit items-start self-start">
                {age && (
                    <span
                        data-testid="posted-age"
                        className={cn(
                            "mono-data text-[12px] leading-none",
                            relisted ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                        )}
                    >
                        {age}
                    </span>
                )}
            </span>
            <div className="col-span-full flex flex-wrap items-center gap-1.5 pt-0.5">
                {salary && (
                    <span className="inline-flex items-center rounded-none border border-emerald-500/40 bg-emerald-500/10 text-[12px] overflow-hidden">
                        <span className="bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-300 border-r border-emerald-500/30">PAY</span>
                        <span className="px-1.5 py-0.5 font-bold tabular-nums text-foreground">{salary}</span>
                    </span>
                )}
                {/* Never a chip for an unknown value — a job whose location
                    genuinely isn't known gets no LOCATION chip at all rather
                    than one reading "Location not listed". */}
                {locationKnown && (
                    <span className="inline-flex items-center rounded-none border border-border/80 bg-background/50 text-[12px] overflow-hidden">
                        <span className="bg-muted/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border/80">LOCATION</span>
                        <span className="px-1.5 py-0.5 font-medium text-foreground">{locationLine}</span>
                    </span>
                )}
                {level && (
                    <span className="inline-flex items-center rounded-none border border-border/80 bg-background/50 text-[12px] overflow-hidden">
                        <span className="bg-muted/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border/80">LEVEL</span>
                        <span className="px-1.5 py-0.5 font-medium text-foreground">{level}</span>
                    </span>
                )}
                {employment &&
                    employment.toLowerCase() !== "full-time" &&
                    employment.toLowerCase() !== "full time" && (
                        <span className="inline-flex items-center rounded-none border border-border/80 bg-background/50 text-[12px] overflow-hidden">
                            <span className="bg-muted/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border/80">TYPE</span>
                            <span className="px-1.5 py-0.5 font-medium text-foreground">{employment}</span>
                        </span>
                    )}
                {variantCount > 0 && (
                    <button
                        type="button"
                        data-testid="cluster-toggle"
                        className={cn(FACT_BOX, "border-slate-300/80 bg-slate-100/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200/80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand?.();
                        }}
                    >
                        {expanded ? "hide" : `+${variantCount} location${variantCount === 1 ? "" : "s"}`}
                    </button>
                )}
            </div>
        </div>
    );
}

/* ------------------------- description renderer ------------------------- */


/* ----------------------------- detail panel ----------------------------- */


/**
 * Shared CTA for both dead-job detail states below. Used to say "See
 * similar roles" and call into `handleExploreClick` (résumé-driven
 * AI-suggested adjacent roles) when a usable résumé was on hand — that
 * moved to MCP 2026-08-02, so this is now always the plain, ungated
 * "Browse live roles" fallback it used to degrade to.
 */
function SimilarRolesCta({ onClick }: { onClick: () => void }) {
    return (
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={onClick}>
            <Compass size={14} />
            Browse live roles
        </Button>
    );
}

/**
 * Task 11 — dead-link tombstone. Rendered only once a targeted existence
 * check (see the `deadJobCheck` effect below) has actually confirmed the
 * URL's `job` id is gone — being absent from the CURRENT page of results
 * alone is not enough (it may just rank off page 1, or the visitor's own
 * filters may exclude it — review fix). `PublicJob` (lib/jobs/types.ts)
 * carries no per-job takedown timestamp — verified before writing this —
 * so the copy never claims a date or guesses at a cause, only the fact the
 * brief specified. The CTA (`SimilarRolesCta` above) clears the dead
 * `job=` param and drops back to a plain browse (see
 * `handleTombstoneSimilarRoles`).
 */
function DeadJobTombstone({ onSimilarRoles }: { onSimilarRoles: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <WarningCircle size={22} className="mb-3 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{DEAD_JOB_TOMBSTONE_TEXT}</h3>
            <SimilarRolesCta onClick={onSimilarRoles} />
        </div>
    );
}

/**
 * Task 11 review fix — the THIRD, non-assertive detail-pane state: a
 * deliberate URL/deep-link selection that hasn't been confirmed either way
 * yet (`checking`) or couldn't be confirmed at all (`unknown` — the actual
 * production reality today, see `classifyExistenceCheck`'s doc comment).
 * Claims NOTHING about the job's status — no "available", no "gone" — only
 * that this app can't currently say. Fixes a real regression the first
 * review-fix pass introduced: before this, `checking`/`unknown` rendered
 * `null` in BOTH panes — permanently blank on desktop, and on mobile a
 * content-less bottom sheet (only the sr-only "Job details" title) sitting
 * over the results, since the fetch path deliberately skips closing it on
 * the id's first unresolved pass. This also covers the "confirmed alive but
 * ranks off the current page" moment right before `deadJobFoundJob` lands.
 */
function DeadJobUnresolved({
    onSimilarRoles,
    checking,
}: {
    onSimilarRoles: () => void;
    checking: boolean;
}) {
    return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            {checking ? (
                <span className="mb-3 h-5 w-5 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
            ) : (
                <MagnifyingGlass size={22} className="mb-3 text-muted-foreground" />
            )}
            <h3 className="text-sm font-semibold">
                {checking ? "Checking this role…" : "Can't confirm this role's status right now."}
            </h3>
            <SimilarRolesCta onClick={onSimilarRoles} />
        </div>
    );
}

/* ----------------------------- page ----------------------------- */

/** Page size for the results list + each infinite-scroll fetch. */
const PAGE = 30;
/** Meili `pagination.maxTotalHits` — the deepest reachable result in page mode. */
const MAX_REACHABLE = 100_000;

/** Jobs opened in a session before the résumé is offered (Screen 9). Three is
 *  the point where someone is demonstrably reading rather than glancing. */
const RESUME_MOMENT_OPENS = 3;

/**
 * One skeleton row shaped like `JobCard` below (same grid, same avatar/
 * title/meta proportions) — kept next to `JobsListSplash`, its only caller,
 * so the two shapes can't silently drift apart.
 */
function JobCardSkeleton() {
    return (
        <div
            aria-hidden="true"
            className="mb-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3.5 gap-y-2 rounded-none glass-card p-4"
        >
            <div className="row-span-2 self-start">
                <div className="skeleton-bar h-12 w-12 rounded-xl" />
            </div>
            <div className="min-w-0 space-y-2">
                <div className="skeleton-bar h-4 w-3/4" />
                <div className="skeleton-bar h-3 w-1/3" />
            </div>
            <div className="skeleton-bar h-5 w-14 self-start" />
            <div className="col-span-full flex gap-2">
                <div className="skeleton-bar h-3 w-24" />
                <div className="skeleton-bar h-3 w-16" />
            </div>
        </div>
    );
}

/** Left-aligned loading line shown while the ledger's first page loads —
 *  no centered card, no decorative icon (anti-marker 5/6). Job 1a
 *  (2026-08-01) added 5 shaped skeleton rows below the existing copy line
 *  (kept verbatim) so the wait reads as "results are shaped like this,
 *  arriving" instead of a bare sentence. */
function JobsListSplash() {
    return (
        <div>
            <p className="pt-8 text-[13px] text-muted-foreground">
                Finding live roles… checking each posting is still active.
            </p>
            <div className="mt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                    <JobCardSkeleton key={i} />
                ))}
            </div>
        </div>
    );
}

/* ----------------------------- results mode ----------------------------- */

/**
 * There is no entry gate — jobs render on first paint for everyone. This
 * page used to track a page-wide results-view `Mode` ("browse" plus,
 * earlier, "search"; most recently "explore" too). "Search" was removed
 * first (dead: nothing ever set it — see git history). "Explore"
 * (résumé-driven AI-suggested adjacent roles, `enterExplore`/`runExplore`)
 * moved to MCP 2026-08-02 and was the last other value, so the `Mode` type
 * and its `mode`/`setMode` state are gone too — every render branch that
 * used to key off it is now just the "browse" behavior, unconditionally.
 * "Rank by fit" was never part of this: it's a sort choice, not a
 * page-wide mode — `buildMatchQuery`'s pipeline is re-homed onto `sort=fit`
 * + a dismissible chip (see `applyFit`).
 */

/**
 * Task 11 — zero-results state. Names the specific excluders instead of a
 * generic "try broadening your search": one clear-chip per
 * `activeFilterEntries(state, { includeQuietDefaults: true })`
 * (FilterPanel.tsx) — the SAME chokepoint the toolbar chips and mobile sheet
 * read from (they omit the opt), so this can never list a different "what's
 * active" than what's actually applied, it just additionally names the
 * pristine "30d" posted-bucket default the toolbar keeps quiet (no parallel
 * list). `onClearEntry` routes through the caller's `applyFilterState` — the
 * identical apply path the toolbar chips' `onRemove` already uses — so
 * there's exactly one place a FilterState clear becomes local state + a URL
 * write, not a third one. `ghostRevealCount` arrives pre-gated from
 * `resolveGhostReveal` (lib/jobs/result-state.ts): non-null here already
 * means hideGhosts is on and the count is positive.
 *
 * Whole-branch review fix — `entries` only ever covers FILTERS
 * (`activeFilterEntries` reads `FilterState`, never `query`), so a
 * zero-result *search* with no filters active at all rendered a bare "No
 * roles match" with nothing tappable to recover from — the query itself had
 * no one-tap clear. `query`/`onClearQuery` add that as its own chip,
 * first-in-order (the thing most likely to be over-narrowing a search-driven
 * empty state) alongside the existing filter chips.
 *
 * `locationDefault` (below) is the one excluder outside `FilterState`
 * entirely — the IP-geo default (`DefaultLocationChip`'s seam, above) — so it
 * rides alongside `entries` as its own prop rather than being folded into the
 * FilterState-shaped list.
 */
/** Review fix: one source for the `activeFilterEntries` element shape, instead of spelling it out twice below. */
type FilterEntry = ReturnType<typeof activeFilterEntries>[number];

function ActiveFilterActions({
    entries,
    onClearEntry,
    onClearFilters,
    query,
    onClearQuery,
    locationDefault,
    className,
    clearFiltersTestId = "empty-state-clear-filters",
    clearQueryTestId = "empty-state-clear-query",
    chipTestId = "empty-state-clear-chip",
}: {
    entries: FilterEntry[];
    onClearEntry: (entry: FilterEntry) => void;
    onClearFilters?: () => void;
    query?: string;
    onClearQuery?: () => void;
    /** The IP-geo default (`DefaultLocationChip`'s own seam, above) isn't
     *  part of `FilterState` at all, so it can't travel through `entries`'s
     *  state-transform `clear`. Same rendered chip, same "✕ clear {label}"
     *  grammar, resolved `onClear` supplied by the caller instead of a pure
     *  `(s: FilterState) => FilterState`. */
    locationDefault?: { label: string; onClear: () => void };
    className?: string;
    clearFiltersTestId?: string;
    clearQueryTestId?: string;
    chipTestId?: string;
}) {
    const hasQuery = (query ?? "").trim().length > 0;
    const hasFilters = entries.length > 0;
    if (!hasQuery && !hasFilters && !locationDefault) return null;
    return (
        <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
            {hasFilters && onClearFilters && (
                <button
                    type="button"
                    data-testid={clearFiltersTestId}
                    onClick={onClearFilters}
                    className="font-semibold text-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground/70"
                >
                    Clear filters
                </button>
            )}
            {hasQuery && onClearQuery && (
                <button
                    type="button"
                    data-testid={clearQueryTestId}
                    onClick={onClearQuery}
                    className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                >
                    ✕ clear search
                </button>
            )}
            {entries.map((entry) => (
                <button
                    key={entry.key}
                    type="button"
                    data-testid={chipTestId}
                    onClick={() => onClearEntry(entry)}
                    className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                >
                    ✕ clear {entry.label}
                </button>
            ))}
            {locationDefault && (
                <button
                    type="button"
                    data-testid={chipTestId}
                    onClick={locationDefault.onClear}
                    className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                >
                    ✕ clear {locationDefault.label}
                </button>
            )}
        </p>
    );
}

function EmptyResults({
    entries,
    onClearEntry,
    onClearFilters,
    query,
    onClearQuery,
    locationDefault,
    ghostRevealCount,
    onRevealGhosts,
    seeds,
    onSubmitSeed,
}: {
    entries: FilterEntry[];
    onClearEntry: (entry: FilterEntry) => void;
    /** Job 1c — the existing all-filters-reset funnel (`panelClearAll` /
     *  `applyFilterState(PRISTINE_FILTER_STATE)`, page.tsx), passed through
     *  rather than re-derived here so there is exactly one place that knows
     *  how to reset a `FilterState` to pristine. */
    onClearFilters: () => void;
    query: string;
    onClearQuery: () => void;
    /** The IP-geo default excluder — see `ActiveFilterActions`'s own doc
     *  comment for why this travels separately from `entries`. */
    locationDefault?: { label: string; onClear: () => void };
    ghostRevealCount: number | null;
    onRevealGhosts: () => void;
    /** A3 — the SAME seed list `BrowseSeedRow` renders everywhere else on
     *  this page (`resolveSearchSeeds`, recent-searches.ts). A zero-hit
     *  query/filter combo previously dead-ended here: clear-filters,
     *  clear-search, and ghost-reveal were the only ways out. */
    seeds: string[];
    onSubmitSeed: (seed: string) => void;
}) {
    const hasQuery = query.trim().length > 0;
    const hasFilters = entries.length > 0 || !!locationDefault;
    return (
        <div className="py-8 text-left">
            <p className="text-[14px] text-foreground">
                {hasFilters ? "Nothing matches these filters." : "No roles match."}
            </p>
            {(hasQuery || hasFilters) && (
                <ActiveFilterActions
                    className="mt-2"
                    entries={entries}
                    onClearEntry={onClearEntry}
                    onClearFilters={onClearFilters}
                    query={query}
                    onClearQuery={onClearQuery}
                    locationDefault={locationDefault}
                />
            )}
            {ghostRevealCount != null && (
                <button
                    type="button"
                    onClick={onRevealGhosts}
                    className="mt-2 text-xs text-foreground underline underline-offset-2"
                >
                    {ghostRevealCount.toLocaleString()} roles hidden as possibly stale — show them
                </button>
            )}
            {/* A3 — same component, same `submitSearch` chokepoint, same
                testids as `ListTail`'s own seed row below; not a fork. The
                standalone pivot row that used to sit above the results pane
                is gone (2026-08-15, ITEM H — folded into the search box's
                own "Popular searches" dropdown), so this is now one of two
                remaining BrowseSeedRow call sites, both genuine no-results/
                end-of-list surfaces. */}
            <BrowseSeedRow seeds={seeds} onSubmit={onSubmitSeed} />
        </div>
    );
}

/**
 * Everything rendered at the FOOT of the results list, below the load-more
 * sentinel — the class fix (jobs-list-tail): affordances used to sit there
 * unconditionally, after the tail ternary, reachable only once `hasMore`
 * happened to be false, which browse-by-default's broad default result set
 * never is. Same structural anchor `showResumeMoment`'s own comment (above,
 * "the foot of what has actually been READ") already established for the
 * résumé moment, applied to the tail this time instead of the read-foot: an
 * affordance placed below infinite scroll must be GATED on the list having
 * genuinely ended, not just positioned there.
 *
 * Takes the already-computed `endOfListState` (`resolveEndOfListState`,
 * lib/jobs/result-state.ts — the single resolver for "why did loading
 * stop," reused rather than re-derived) and early-returns `null` on
 * `"more-available"` before rendering anything, so the guard holds
 * structurally even if a future caller stops re-gating this on `hasMore`
 * at the call site — there is no way to reach `BrowseSeedRow` here while
 * the list can still grow.
 */
function ListTail({
    endOfListState,
    totalCount,
    seeds,
    onSubmitSeed,
}: {
    endOfListState: "genuine-end" | "cap-reached" | "more-available";
    totalCount: CorpusCount;
    seeds: string[];
    onSubmitSeed: (seed: string) => void;
}) {
    if (endOfListState === "more-available") return null;
    return (
        <div className="py-5 text-left">
            {endOfListState === "cap-reached" ? (
                // A4 — the honest cap-reached line: `hasMore` stopped
                // because pagination hit MAX_REACHABLE, not because the
                // corpus ran out. Saying "reached the end" here would
                // print the real, bigger total right next to a claim
                // that's false for it — see `resolveEndOfListState`.
                <p className="text-xs text-muted-foreground/70">
                    Showing the first {MAX_REACHABLE.toLocaleString()} of{" "}
                    {formatCorpusCount(totalCount)} — add a search or filter to narrow.
                </p>
            ) : (
                <p className="text-xs text-muted-foreground/70">
                    You&apos;ve reached the end — {formatCorpusCount(totalCount)}{" "}
                    {totalCount.value === 1 ? "role" : "roles"}.
                </p>
            )}
            <BrowseSeedRow seeds={seeds} onSubmit={onSubmitSeed} />
        </div>
    );
}

function JobsContent() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Parsed once from the URL present at mount, to seed the state hooks below.
    // The URL stays authoritative afterwards, bidirectionally: every mutation
    // routes out through `applyUrlState` (replace for filters/sort/ghost,
    // push for opening a job), AND every `searchParams` change routes back in
    // through the reconcile effect near `selected`, below — so history
    // navigation (Back/Forward), a typed address bar, or an external link all
    // fully reconstruct the screen, not just the selected job.
    const initialUrlState = useMemo(() => parseJobsUrl(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps

    // Review fix (2026-07-19) — ONE "now" for this entire render pass,
    // seeded once via useState's lazy initializer (the documented-sanctioned
    // way to do one-time impure work during render — see React's "components
    // and hooks must be idempotent" doc the `react-hooks/purity` lint rule
    // links to) instead of `Date.now()` being called directly inside render
    // (JobCard's `postedAge`/`rowTrustChip`) or inside JSX (the freshness stamp's
    // `isStale`/`formatRelativeAge`). Threading a single value down means the
    // row badge's age and the freshness stamp's age can never disagree about
    // what instant "now" was for this paint, and render stays pure — the
    // exact defect `react-hooks/purity` flagged at the old row-badge call
    // site and Task 8's review separately flagged as "dual
    // Date.now() per row render" (postedAge's own internal call was the
    // second one, never caught by the linter because it's one level removed
    // from the render body, but the same bug).
    const [nowMs] = useState(() => Date.now());

    const [query, setQuery] = useState(initialUrlState.q);
    const [queryDraft, setQueryDraft] = useState(initialUrlState.q);
    const [facets, setFacets] = useState<Partial<Record<FacetKey, string[]>>>(initialUrlState.facets);
    const [salaryMin, setSalaryMin] = useState(initialUrlState.salaryMin);
    const [visaOnly, setVisaOnly] = useState(initialUrlState.visaOnly);
    const [postedBucket, setPostedBucket] = useState<PostedBucket | undefined>(initialUrlState.postedBucket);
    // First-screen default: exclude likely_ghost from results. `ghosts=show` in
    // the URL flips it. No UI toggle wired yet (Task 6 — Trust toolbar).
    const [hideGhosts, setHideGhosts] = useState(initialUrlState.hideGhosts);
    const [board, setBoard] = useState<BoardId | null>(initialUrlState.board);
    // Single-employer scope, arriving from `/co/[slug]`'s "View all N jobs"
    // CTA (`buildCompanyJobsUrl`). Held next to `board` because they are the
    // same concern — see `scope` below.
    const [companyDomain, setCompanyDomain] = useState<string | null>(initialUrlState.companyDomain);
    // Declared here (not down near `clearAll`/the rail JSX, where it used to
    // live) so the search effect below can read ONE `filterState` for this
    // render instead of five separate primitives — review fix, 2026-07-19,
    // needed so `buildJobSearchPayload` has a single FilterState to take.
    const filterState: FilterState = { facets, salaryMin, visaOnly, postedBucket, hideGhosts };
    // The corpus narrowings that aren't user-picked filters, in one object so
    // the four `buildJobSearchPayload` call sites below can't pick up one and
    // forget the other — the same single-source rule `filterState` above
    // exists for. Plain object, same as `filterState`: it's only ever spread
    // into a payload, never a hook dependency.
    const scope = { board, companyDomain };
    // Explicit sort override; null = auto (newest with no query, relevance with a query —
    // see buildSort in lib/jobs/meilisearch.ts). Not a "filter", so it's kept out of
    // activeCount/clearAll. See `resolveUrlSort` for the sort=fit handling.
    const [sortOverride, setSortOverride] = useState<JobSortMode | null>(resolveUrlSort(initialUrlState.sort));
    // "Ranked by your résumé" — mirrors `sort=fit` in the URL. Kept separate
    // from `sortOverride` (a real backend `JobSortMode`) because "fit" isn't
    // one; the backend sort stays whatever `resolveUrlSort` resolves it to
    // (relevance, via the résumé-derived query — see `applyFit`).
    const [fitActive, setFitActive] = useState(initialUrlState.sort === "fit");
    // Mirrors `fitActive` for read access from callbacks that can outlive the
    // render that defined them (`maybeReplay`'s stable-identity closure) —
    // same reason `resultRef`/`selectedIdRef` exist below.
    const fitActiveRef = useRef(fitActive);
    fitActiveRef.current = fitActive;
    const [detailSheetOpen, setDetailSheetOpen] = useState(false);
    // Two-Panel Selector (desktop split view) — 1280 must literally match
    // Tailwind's default `xl:` breakpoint (this repo's CSS-based Tailwind v4
    // config, src/app/globals.css `@theme`, has no `--breakpoint-xl`
    // override, so `xl:` IS the default 1280px). SSR/first-paint default is
    // `false` (below-xl/sheet) — see use-media-query.ts.
    const isXlUp = useMediaQuery("(min-width: 1280px)");
    // G5b (Grok UX wave): the filters panel presents in a bottom sheet below
    // `lg` (1024px — matches every other mobile/desktop split in this file,
    // e.g. FilterChipsRow's own `lg:hidden`), inline exactly as before at
    // `lg` and up.
    const isLgUp = useMediaQuery("(min-width: 1024px)");
    const [locationDraft, setLocationDraft] = useState(() => initialUrlState.facets.location_country?.[0] ?? "");
    const [locationSheetOpen, setLocationSheetOpen] = useState(false);
    const [mobileResultsEngaged, setMobileResultsEngaged] = useState(false);
    const [detectedOptedIn, setDetectedOptedIn] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchRetry, setSearchRetry] = useState(0);
    // S2 — recent-searches chips on the empty-query landing state.
    const recentSearches = useSyncExternalStore(
        subscribeRecentSearches,
        getRecentSearchesSnapshot,
        getRecentSearchesServerSnapshot,
    );
    const recentlyViewed = useSyncExternalStore(
        subscribeRecentlyViewed,
        getRecentlyViewedSnapshot,
        getRecentlyViewedServerSnapshot,
    );
    const { saved: savedSearches } = useSavedSearches();
    // Persistent "don't default my location" override (default-location
    // chip's "×") — see location-default-preference.ts. Part of the search
    // effect's own dependency list below (not folded into `searchKey`,
    // which is URL state; this is a client-local preference), so clearing
    // it immediately refetches without the default.
    const locationDefaultSuppressed = useSyncExternalStore(
        subscribeSuppressLocationDefault,
        getSuppressLocationDefaultSnapshot,
        getSuppressLocationDefaultServerSnapshot,
    );
    const { follows, hasAny: hasFollows } = useFollows();

    // Assembles the full URL-state object from current component state, with
    // `overrides` layered on top for the field(s) actually changing at the
    // call site. `jobId` defaults to whatever the URL currently holds, so a
    // filter/sort/ghost `replace` never accidentally drops an open job.
    const buildUrlState = (overrides: Partial<JobsUrlState> = {}): JobsUrlState => ({
        q: query,
        facets,
        salaryMin,
        visaOnly,
        postedBucket,
        hideGhosts,
        board,
        companyDomain,
        // `fitActive` wins the default so `sort=fit` survives unrelated
        // mutations (a facet toggle, a job open) that rebuild the URL via
        // `buildUrlState({...})` without an explicit `sort` override.
        sort: fitActive ? "fit" : sortOverride ? modeToUrlSort(sortOverride) : null,
        jobId: searchParams.get("job"),
        ...overrides,
    });

    // The single navigation contract Tasks 6-11 build on. `replace` for
    // filter/sort/ghost changes (no history spam); `push` for a search submit
    // or opening a job (back-button-correct).
    //
    // Chokepoint guard (Task 9 review): typing already `replace`s the URL to
    // match on every keystroke, so an Enter/suggestion-pick `push` right
    // after typing computes the SAME target that the last `replace` just
    // wrote — without this check that's a byte-identical duplicate entry, so
    // Back needs two presses to see anything actually different. Comparing
    // against the browser's real current URL (not React state, which can lag
    // a tick behind a just-applied navigation) and skipping the no-op
    // protects every call site — present and future — not just `onSearch`.
    //
    // Native `history.pushState`/`replaceState` instead of `router.push`/
    // `router.replace` (prod bug, verified with a headless repro): /jobs's
    // server payload never depends on its search params — the reconcile
    // effect below is what actually reacts to a URL change — so routing
    // every filter/sort/job-open keystroke through the Next router bought
    // nothing but cost RSC round-trips on every one. Worse, closing the job
    // sheet (`router.back()`) landed back on a URL the router considered
    // stale enough to force a FULL document reload, wiping all component
    // state and re-running the whole search on every open→close cycle.
    // `useSearchParams`/`usePathname` read from the History API directly, so
    // a native history write keeps them in sync with zero server round-trip.
    // Native history never scrolls on its own, so the old `{ scroll: false
    // }` is simply the default now, not something to replicate.
    const applyUrlState = (next: JobsUrlState, history: "replace" | "push") => {
        const target = `${pathname}${serializeJobsUrl(next)}`;
        if (typeof window !== "undefined" && target === `${window.location.pathname}${window.location.search}`) {
            return;
        }
        if (history === "push") window.history.pushState(null, "", target);
        else window.history.replaceState(null, "", target);
    };

    const searchAutocompleteRef = useRef<SearchAutocompleteHandle>(null);

    // Single chokepoint for a SUBMITTED (not per-keystroke) search — the
    // search box's Enter/suggestion-pick and a recent-search chip click both
    // route through here, so both record the query the same way.
    const submitSearch = (q: string) => {
        // Every submit path funnels through here (the box's own Enter/
        // suggestion-pick already self-closes; this covers the ones that
        // don't — the external "Search" button, category chips, seed
        // clicks), so closing here is the ONE place a submitted search
        // dismisses a dropdown left open from typing, not one fix per
        // caller.
        searchAutocompleteRef.current?.close();
        setQueryDraft(q);
        setQuery(q);
        setMobileResultsEngaged(true);
        recordRecentSearch(q);
        applyUrlState(buildUrlState({ q }), "push");
        if (user) {
            void saveAgentPreferencesAction({
                search: {
                    query: q.trim() || undefined,
                    location: locationDraft.trim() || undefined,
                },
            }).catch(() => {});
        }
    };

    /** Commits a typed-but-unsubmitted query when a filter/location chip fires search. */
    const flushSearchIntent = useCallback(() => {
        const draft = queryDraft.trim();
        if (draft !== query.trim()) submitSearch(queryDraft);
    }, [queryDraft, query, submitSearch]);

    const [result, setResult] = useState<JobsSearchActionResult | null>(null);
    const resultRef = useRef<JobsSearchActionResult | null>(null);
    resultRef.current = result;
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedIdRef = useRef<string | null>(null);
    selectedIdRef.current = selectedId;
    // Task 11 review fix — records which id has already used its ONE free
    // "preserve, don't reassign" pass in the search effect below (see
    // `resolveSelectionAfterRefresh`'s `wasConfirmed` option in
    // lib/jobs/result-state.ts). Never explicitly cleared: a stale value
    // for a since-superseded id simply stops matching `previousSelectedId`
    // once the user selects something else, which is all the "reset" this
    // needs.
    const firstUnresolvedDeadLinkIdRef = useRef<string | null>(null);

    /**
     * Deliverable 1 — which `searchKey` has already burned its one automatic
     * retry (see the fetch effect below). A hard failure no longer shows the
     * error state immediately: the first failure for a given search schedules
     * one retry ~4s out and waits, so a genuine one-off blip never reaches the
     * dead-end UI at all. Keyed on `searchKey` rather than a plain boolean so
     * a NEW search (different query/filters) always gets its own fresh
     * attempt — same never-explicitly-cleared pattern as
     * `firstUnresolvedDeadLinkIdRef` above: a stale value for a
     * since-superseded key simply stops matching.
     */
    const autoRetriedSearchKeyRef = useRef<string | null>(null);

    // Live corpus size for the search placeholder ("Search 12,345 live-checked

    // Honest count for the rail's "Hide likely-ghost" toggle (Task 7) — how
    // many likely_ghost postings the CURRENT filters are hiding right now.
    // `null` = not resolved yet, or not applicable (ghosts shown) — either
    // way FilterPanel only renders the count suffix when non-null and > 0.
    const [ghostHiddenCount, setGhostHiddenCount] = useState<number | null>(null);

    // Beyond-window probe (2026-08-12): the honest corpus count with the
    // 30d posted-bucket filter lifted, for the results line's "N more
    // beyond 30 days — show all" affordance. The 30d default hides real
    // inventory (measured: 2,294 shown vs 7,199 matching roles, ~68%
    // hidden) — this surfaces the gap rather than fabricating one; `null`
    // means "not applicable right now" (bucket isn't 30d, probe unresolved,
    // or the probe failed) and `resolveBeyondWindow` (lib/jobs/beyond-
    // window.ts) is the single place that turns this + the visible
    // `totalCount` into the show/hide + number decision.
    const [beyondWindowCount, setBeyondWindowCount] = useState<CorpusCount | null>(null);

    // Corpus freshness stamp ("updated 3h ago"). Fetched once on mount.
    // `undefined` = not resolved yet (render nothing); `null` = resolved but
    // the backend has no known sync time (render "freshness unknown" — never
    // a fabricated time).
    const [lastUpdated, setLastUpdated] = useState<string | null | undefined>(undefined);
    useEffect(() => {
        let cancelled = false;
        getJobsFreshnessAction()
            .then((iso) => {
                if (!cancelled) setLastUpdated(iso);
            })
            .catch(() => {
                if (!cancelled) setLastUpdated(null);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Can the corpus answer an age-bucket question? Optimistic default: the
    // sync writes `posted_ts` at full population (verified Jul 2026), and the
    // fresh-visit default filter is `posted=30d` — starting `false` made every
    // first load (and every load while the probe was in flight or failing)
    // ship the match-all browse instead, the corpus's heaviest query shape.
    // The probe now demotes ONLY on a successful measurement of insufficient
    // population (regression guard); `null` (probe failed — unknown) keeps
    // the optimistic default rather than stripping the filter exactly when
    // the box is degraded (Jul 24 incident).
    const [postedDateSupported, setPostedDateSupported] = useState(true);
    useEffect(() => {
        let cancelled = false;
        getPostedDateFilterSupportAction()
            .then((ok) => {
                if (!cancelled && ok !== null) setPostedDateSupported(ok);
            })
            .catch(() => {
                /* transport failure — unknown; keep the optimistic default */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // ITEM O-FE (2026-08-15) — the flags endpoint isn't deployed yet.
    // Defaults to hidden (unlike postedDateSupported's optimistic default
    // above) so "Report listing" never renders as a dead button while this
    // probe is in flight or fails.
    const [reportJobEnabled, setReportJobEnabled] = useState(false);
    useEffect(() => {
        let cancelled = false;
        reportJobEnabledAction()
            .then((ok) => {
                if (!cancelled) setReportJobEnabled(ok);
            })
            .catch(() => {
                /* transport failure — keep hidden */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Effective sort: shared resolver normalizes relevance-without-query to
    // newest, then the support coercion drops "newest" when the corpus carries
    // no `posted_ts` — otherwise the request ships a sort Meilisearch silently
    // ignores while the toolbar claims "newest first".
    const effectiveSort: JobSortMode = coerceSortToSupported(
        resolveEffectiveSort({ q: query, sort: sortOverride ?? undefined }),
        postedDateSupported,
    );

    // What every search request is actually sorted by. Derived from
    // `effectiveSort` rather than the raw `sortOverride` so the backend can't be
    // asked for a date sort the UI isn't claiming — the two must never disagree.
    const backendSort: JobSortMode = effectiveSort;


    // A monotonic generation makes stale pagination unambiguous, including
    // reversible A→B→A query changes where signatures alone are insufficient.
    const paginationRef = useRef<JobsPaginationGeneration | null>(null);
    if (!paginationRef.current) paginationRef.current = new JobsPaginationGeneration();

    const [user, setUser] = useState<User | null>(null);
    const [agentPrefs, setAgentPrefs] = useState<AgentPreferences | null>(null);
    const [searchPrefsDialogOpen, setSearchPrefsDialogOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [guestTipDismissed, setGuestTipDismissed] = useState(false);
    // Progressive guest save gating — initialized post-mount (localStorage
    // is not available during SSR). `guestSaveCount` drives both the banner
    // (≥ 1) and the gate (≥ 1 → require sign-in on the next save).
    const [guestSaveCount, setGuestSaveCount] = useState(0);
    const [guestSaveBannerDismissed, setGuestSaveBannerDismissed] = useState(true);
    useEffect(() => {
        setGuestSaveCount(getGuestSaveCount());
        setGuestSaveBannerDismissed(isGuestSaveBannerDismissed());
    }, []);
    // Honest-market claim shown alongside the guest SERP tip (front-door
    // spec, Task 2). Fetched once on mount, same cancelled-flag idiom as
    // `lastUpdated`/`postedDateSupported` above; `marketingClaim` degrades to
    // a claim without a live count on `null` rather than fabricating one.
    const [marketClaim, setMarketClaim] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        getMarketingStatsAction()
            .then((stats) => {
                if (!cancelled) setMarketClaim(marketingClaim(stats));
            })
            .catch(() => {
                if (!cancelled) setMarketClaim(marketingClaim(null));
            });
        return () => {
            cancelled = true;
        };
    }, []);
    // Replaces the old session-only `appliedIds` state (forgot on reload) —
    // one shared, cached fetch that also serves TopBar and /yours.
    const { byJobId: pursuitsByJobId, pursuits: trackedPursuits } = usePursuits();
    const trackedCount = trackedPursuits.length;
    const [goingAfterId, setGoingAfterId] = useState<string | null>(null);
    const guestPursuitSyncRef = useRef(false);
    const guestSyncInFlightRef = useRef(false);

    // The resume backing "Rank by fit" and the import modal. `mode` (browse
    // vs the now-removed "explore") and the in-flight Explore call's state
    // (`exploringRaw`/`exploreFailed`) are gone — MCP handoff, 2026-08-02.
    const [resume, setResume] = useState<ResumeData | null>(null);
    const [importOpen, setImportOpen] = useState(false);

    // Task 8 résumé upsell card dismissal — read once on mount (no new mount
    // fetch of the résumé itself; Task 4 removed that). The card's other gate
    // condition, `resumeIsUsable(resume)`, uses this same local `resume`
    // state reactively — a successful import sets it and hides the card
    // without any extra plumbing here.
    const [upsellDismissed, setUpsellDismissed] = useState(false);
    useEffect(() => {
        try {
            setUpsellDismissed(localStorage.getItem("intervu.jobs.upsell.dismissed") === "1");
        } catch {
            /* private mode */
        }
    }, []);
    const dismissUpsell = () => {
        setUpsellDismissed(true);
        try {
            localStorage.setItem("intervu.jobs.upsell.dismissed", "1");
        } catch {
            /* private mode */
        }
    };

    // All three "run this after the user signs in" actions (apply / gate /
    // upload) live in one pure pending-state ref so only the LATEST intent
    // is ever queued and a dismissed action can never replay. See
    // lib/jobs/pending-actions.ts — `gate` is the generic apply-intent gate
    // (Job 2, 2026-08-01) shared by every apply-adjacent CTA reachable signed
    // out. `authedRef` is the deterministic success signal from this page's
    // AuthPopover (`onAuthed`) — replay fires only when it's set, so an
    // unrelated later sign-in (e.g. the sidebar "Log in", which never
    // touches this popover) replays nothing, race-free regardless of
    // whether `setUser(true)` or the popover-close lands first.
    const pendingRef = useRef<PendingState<PublicJob, PublicJob>>(
        emptyPending<PublicJob, PublicJob>(),
    );
    const authedRef = useRef(false);
    // Which auth value-line reason class to show (apply / generic).
    // Set by the call site that opened the popover; null = no value line.
    const [authGateReason, setAuthGateReason] = useState<AuthGateReason | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) {
            setAgentPrefs(null);
            return;
        }
        let cancelled = false;
        void fetchAgentPreferencesAction().then((res) => {
            if (!cancelled && res.data) setAgentPrefs(res.data);
        });
        return () => {
            cancelled = true;
        };
    }, [user?.uid]);

    // Refetch rule: only the search-affecting subset should trigger a fetch.
    // `jobId` is deliberately omitted here, so opening/closing a job (a `job`-
    // only URL change) can never appear in this key — the fetch effect below
    // depends on `searchKey` instead of the individual fields, which is what
    // keeps a job-only change from ever re-running the search or resetting
    // list scroll. The serialized form is the single comparison Task 6+
    // extends when new search-affecting fields (e.g. resume-driven fit) land.
    const searchKey = useMemo(
        () =>
            serializeJobsUrl({
                q: query,
                facets,
                salaryMin,
                visaOnly,
                postedBucket,
                hideGhosts,
                board,
                companyDomain,
                sort: sortOverride ? modeToUrlSort(sortOverride) : null,
                jobId: null,
            }) + (postedDateSupported ? "" : "&nodatesort"),
        // `postedDateSupported` participates because it changes the sort the
        // backend is asked for: when the probe resolves, the date sort becomes
        // real and the results must be re-fetched in the new order.
        [query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, board, companyDomain, sortOverride, postedDateSupported],
    );

    // Single source: résumé usable, hoisted here (instead of
    // `resumeIsUsable(resume ?? undefined)` at each call site) so the two
    // later CTA gates (résumé-moment + the "use the résumé on file" upsell)
    // share one computation. `resumeIsUsable` reads LOCAL state only (no
    // mount fetch) — see that call site's own doc comment for why that's an
    // accepted trade-off, not a bug.
    const hasUsableResume = resumeIsUsable(resume ?? undefined);

    // Tri-state (`true`/`false`/`null` — "not known yet") presence signal
    // for a RETURNING user whose résumé lives only on the server this
    // session (see the hook's own doc comment for why `null` is a real,
    // distinct state, not folded into `false`) — called unconditionally,
    // every render, per the Rules of Hooks; combined with `hasUsableResume`
    // below rather than short-circuited into it.
    const resumeKnownOnServer = useResumePresence(user?.uid ?? null);

    // Whether the "My résumé" toolbar control (below) should treat a
    // résumé as on file — `hasUsableResume` (session-local: just uploaded,
    // or already resolved for a fit application) wins outright when true;
    // otherwise this is `resumeKnownOnServer`'s tri-state answer as-is,
    // `null` included. BOTH the control's visual state
    // (`resolveResumeControlState`) and its click behavior
    // (`runResumeControlClick`) read this SAME value, but only the click
    // decides on its truth — the render just borrows it as a hint (see
    // `runResumeControlClick`'s own doc comment, lib/jobs/result-state.ts).
    const resumeOnFile: boolean | null = hasUsableResume || resumeKnownOnServer;

    // The control's rendered state (see `resolveResumeControlState`'s own
    // doc comment for the three states) — one hoisted call instead of the
    // `fitActive`/`resumeOnFile` check inline in the JSX below.
    const resumeControlState = resolveResumeControlState({ fitActive, resumeOnFile });

    // Single source for "what filters are currently active" — the toolbar
    // pill's count and `emptySearchState` below both read this ONE call
    // instead of a second `activeFilterEntries(filterState)` per render.
    const activeEntries = activeFilterEntries(filterState);

    // The active filters the FacetBar has no control for — see
    // `FACET_BAR_FACETS`. The toolbar names these itself, because for them
    // the 2026-08-15 "duplicate information" removal had nothing to be a
    // duplicate OF: `location_country` is set from the location box and
    // appears on no chip, so "Clear filters (1)" was the only trace that a
    // search had been narrowed at all.
    const unnamedEntries = entriesNeedingOwnChip(activeEntries, facetBarRepresents(postedDateSupported));

    // The zero-result state's per-filter clear chips (Task 11) read a SEPARATE
    // call to the same `activeFilterEntries` chokepoint, with
    // `includeQuietDefaults: true` — a silently-applied default (today, only
    // the pristine "30d" posted-bucket) narrowed the result set just as much
    // as an explicit filter, so a zero-result explanation has to name it even
    // though the toolbar pill keeps it quiet. Same function, same clear
    // semantics, one extra opt-in — not a second parallel "what's active"
    // derivation.
    const emptyStateEntries = activeFilterEntries(filterState, { includeQuietDefaults: true });

    /**
     * No query ⇒ no corpus fetch, ever — regardless of filters or
     * `fitActive` (a résumé-derived query is never actually empty in
     * practice, so this stays the one simple rule). Same cost rationale as
     * the removed cold-visit browse-all below: the match-all query was the
     * most expensive one the app issues (whole corpus, ranked, with facet
     * distribution) and the one implicated in the search-unavailable
     * incidents. The `limit: 1, withFacets: false` corpus-count probe used
     * for the search line's placeholder is untouched by this.
     */
    /**
     * The empty-query landing state (`lib/jobs/result-state.ts`,
     * unit-tested there) — decides WHICH fetch shape a zero-query state
     * uses below: `"overlay-ask"` (pristine — no filters, no fit) drives the
     * cached `getDefaultBrowseAction`; `"serp-ask"` (filters active) drives
     * the ordinary uncached `searchJobsAction`, same as `"results"`. Browse-
     * by-default (2026-08-07 front-door reversal) means every state now
     * fetches something — see `resolveJobsRenderMode` (used below, once
     * `hits`/`loading` are in scope) for the separate render-fallback
     * decision.
     */
    const emptySearchState = resolveEmptySearchState({
        hasQuery: Boolean(query.trim()),
        fitActive,
        activeFilterCount: activeEntries.length,
        hasCorpusScope: Boolean(scope.board || scope.companyDomain),
    });
    // `!searchParams.get("job")` — the RAW url param, not `selectedId` (whose
    // default-browse auto-selection of `hits[0]` is not a deliberate pick —
    // see `resolveSelectionAfterRefresh`, lib/jobs/result-state.ts — and
    // never writes `job=`, per `jobs-split-view.spec.ts`'s "no ?job=" case).
    // A deliberate deep link/row click DOES write `job=`, and the hero has no
    // business sitting over an open job's detail (Vivek, "once I start
    // searching, why is it still there").
    const isPristineLanding = emptySearchState === "overlay-ask" && !query.trim() && activeEntries.length === 0 && !fitActive && !board && !companyDomain && !searchParams.get("job");
    const showLandingMarketing = isPristineLanding && !mobileResultsEngaged;
    const agentSearchPrefsSet = hasSearchPrefs(agentPrefs?.search);

    // Debounced search on query / facet / salary / visa changes. Zero query
    // no longer skips this — see `emptySearchState` above.
    useEffect(() => {
        let cancelled = false;
        let firstPageSucceeded = false;
        // Deliverable 1 — set when this run schedules the one automatic
        // retry instead of surfacing a failure; `finally` below reads it so
        // the pagination generation is left active (not finished) across the
        // retry wait, and `loading` stays true rather than flashing the
        // error UI on then off again ~4s later.
        let autoRetryScheduled = false;
        const generation = paginationRef.current!.beginFirstPage();
        setSearchError(null);
        setLoadingMore(false);
        // `loading` means any first-page request is in flight. Rendering still
        // distinguishes first load (`hits.length === 0`) from background refresh.
        setLoading(true);
        const t = setTimeout(async () => {
            try {
                // Browse-by-default (2026-08-07): the pristine zero-query
                // landing (`emptySearchState === "overlay-ask"` — no query,
                // no filters, no fit) goes through the cached, fixed-shape
                // default browse instead of the ordinary uncached search —
                // see `getDefaultBrowseAction`'s own doc comment
                // (actions/jobs.ts) for the cost-guard rationale. Every
                // other state (a real query, fit-active, or zero-query WITH
                // filters) is unchanged.
                const r =
                    emptySearchState === "overlay-ask"
                        ? await getDefaultBrowseActionGuarded(locationDefaultSuppressed)
                        : await searchJobsAction({
                              ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, scope, locationDefaultSuppressed),
                              withFacets: true,
                              limit: PAGE,
                              offset: 0,
                          });
                if (cancelled || !paginationRef.current!.isCurrentGeneration(generation)) return;
                if (isUnavailableJobsResult(r)) {
                    // Deliverable 1 — this exact `searchKey` gets ONE free
                    // automatic retry before the dead-end error state shows
                    // at all. Guarded on the ref so a second failure for the
                    // same search (the retry itself came back unavailable
                    // too) falls straight through to the error below instead
                    // of looping.
                    if (autoRetriedSearchKeyRef.current !== searchKey) {
                        autoRetriedSearchKeyRef.current = searchKey;
                        autoRetryScheduled = true;
                        setTimeout(() => {
                            if (!cancelled) setSearchRetry((n) => n + 1);
                        }, 4000);
                        return;
                    }
                    setSearchError(r.note ?? SEARCH_UNAVAILABLE_MESSAGE);
                    // An initial failure needs backend metadata for the error
                    // state. A background failure must not blank existing hits.
                    if (!(resultRef.current?.hits.length)) setResult(r);
                    return;
                }
                // Task 11 — snapshot BEFORE `setResult(r)` below overwrites
                // `resultRef.current`: was the pre-fetch selection actually
                // confirmed present a moment ago? `resultRef.current.hits`
                // is the FULL accumulated list across infinite-scroll pages
                // (loadMore concatenates via setResult, not a separate
                // array — verified below), so this is accurate for a
                // selection made from page 2+, not just page 1. Distinguishes
                // Task 5's "a live selection just dropped out of a NEW
                // search/filter" (falls back to hits[0] + closes detail,
                // via `resolveSelectionAfterRefresh` below) from a URL/
                // deep-link id this tab has never once confirmed — e.g.
                // mount straight onto `?job=<dead-id>`. Without this
                // distinction, `resolveSelectionAfterRefresh` silently swaps
                // a dead link for an unrelated `hits[0]` on the very first
                // fetch, which is exactly the bug that made the tombstone
                // unreachable (verified empirically: it rendered a
                // different job's detail instead of nothing).
                const previousSelectedId = selectedIdRef.current;
                // Snapshot the URL's OWN `job` id at the same moment —
                // needed below by `shouldClearStaleJobUrl` to tell "the
                // selection that just got reassigned away came from the
                // address bar" from "it came from local-only keyboard nav
                // (`selectJob`, which deliberately never touches the URL)."
                const urlJobIdAtFetchStart = searchParams.get("job");
                const wasConfirmedBeforeThisFetch = Boolean(
                    previousSelectedId && resultRef.current?.hits.some((h) => h.id === previousSelectedId),
                );
                // An unconfirmed id gets exactly ONE free pass across
                // fetches (review fix): without this, a dead id still in
                // the URL after the user starts a NEW search would keep
                // re-entering the "preserve, don't reassign" branch below
                // forever — `wasConfirmedBeforeThisFetch` can never become
                // true for a genuinely dead id, since it will never appear
                // in ANY result — leaving a stale mobile detail sheet stuck
                // open across every later result set. `firstUnresolvedDeadLinkIdRef`
                // is set (never explicitly cleared) the first time an id
                // uses its pass; a stale value for a DIFFERENT id simply
                // never matches, so no explicit reset is needed.
                const alreadyUsedItsPass = previousSelectedId != null
                    && firstUnresolvedDeadLinkIdRef.current === previousSelectedId;
                const wasConfirmed = wasConfirmedBeforeThisFetch || alreadyUsedItsPass;
                firstPageSucceeded = true;
                setResult(r);
                const selection = resolveSelectionAfterRefresh(previousSelectedId, r.hits, { wasConfirmed });
                // Review fix: gate on the id ACTUALLY being absent from this
                // fetch's fresh hits, not merely on `selection.preserveDeliberateDetail`
                // — that flag is also true for a genuinely-FOUND id (the
                // first branch inside `resolveSelectionAfterRefresh`), so a
                // live page-1 deep link being checked for the first time
                // (`wasConfirmed` false, but found immediately) was
                // spuriously burning its one free pass on a job that was
                // never actually missing.
                const foundInFreshHits = previousSelectedId
                    ? r.hits.some((h) => h.id === previousSelectedId)
                    : false;
                if (previousSelectedId && !wasConfirmed && !foundInFreshHits) {
                    firstUnresolvedDeadLinkIdRef.current = previousSelectedId;
                }
                setSelectedId(selection.selectedId);
                if (!selection.preserveDeliberateDetail) {
                    setDetailSheetOpen(false);
                }
                // Whichever way the selection just got reassigned away from
                // what's in the address bar — a dead link that used its
                // free pass (`alreadyUsedItsPass`, see the comment above),
                // OR a filter/query change that excluded an already-open,
                // previously-CONFIRMED job (`wasConfirmedBeforeThisFetch`,
                // which never touches the free-pass machinery at all, since
                // it was confirmed on its very first look) — nothing above
                // this point ever calls `applyUrlState` for that transition
                // (it lives inside a data-driven effect, not a user action).
                // A refreshed or re-shared URL would otherwise keep
                // reproducing a job the CURRENT filters exclude, or a dead
                // one, forever, even though the pane has already moved on
                // locally. Clearing `jobId` here converges the URL back to
                // ambient browsing — the URL-reconcile effect (keyed on
                // `searchParams`) then re-derives `selectedId` from the
                // now-jobless URL, which lands on the same `hits[0]`
                // `selection` already picked, just via the "no explicit
                // selection" path instead of a stale explicit one.
                //
                // `shouldClearStaleJobUrl` (lib/jobs/result-state.ts,
                // unit-tested): true exactly when there WAS an explicit
                // prior selection, this fetch did NOT preserve it
                // (`!selection.preserveDeliberateDetail`), and the URL — at
                // the moment this fetch started — still names that
                // now-abandoned id. That last check is what stops this from
                // clobbering an unrelated open job when the reassigned
                // selection came from local-only keyboard nav instead of the
                // address bar. Provably subsumes the narrower
                // narrower dead-link case it replaced — see
                // `shouldClearStaleJobUrl`'s doc comment for the full
                // reasoning.
                if (
                    shouldClearStaleJobUrl(
                        urlJobIdAtFetchStart,
                        previousSelectedId,
                        selection.preserveDeliberateDetail,
                    )
                ) {
                    // Explicit `sort` override reading `fitActiveRef.current`
                    // (not the closure's own `fitActive`, which — unlike
                    // every other `buildUrlState()` field here — is NOT
                    // covered by `searchKey`, so it's the one field that
                    // could have drifted during this fetch's debounce +
                    // network round trip without cancelling/superseding
                    // this generation. Every other field `buildUrlState()`
                    // reads (q/facets/salaryMin/visaOnly/postedBucket/
                    // hideGhosts/sortOverride) IS in `searchKey`'s
                    // dependency list, so any change to them would have
                    // invalidated this generation via the
                    // `isCurrentGeneration` check at the top of this
                    // callback — this code would never have reached here.
                    applyUrlState(
                        buildUrlState({
                            jobId: null,
                            sort: fitActiveRef.current ? "fit" : sortOverride ? modeToUrlSort(sortOverride) : null,
                        }),
                        "replace",
                    );
                }
                // Honest hidden-ghost count for the rail's toggle row (Task 7): one
                // extra limit-1, facets-only request with hideGhosts flipped off and
                // any explicit `ghost_badge` facet stripped, so it's counting against
                // the SAME other filters rather than a legacy-facet-narrowed set (see
                // controller resolution #2). Skipped entirely when ghosts are already
                // shown. Fire-and-forget — it must not block `loading`/`finally` below
                // — and reuses this closure's own `cancelled` flag plus the pagination
                // generation as its staleness guard (the same precedent
                // JobsPaginationGeneration/FitIntentGuard set elsewhere in this file),
                // rather than a bespoke guard class.
                if (hideGhosts) {
                    searchJobsAction({
                        ...buildJobSearchPayload(
                            { ...filterState, facets: { ...filterState.facets, ghost_badge: undefined }, hideGhosts: false },
                            query,
                            backendSort,
                            postedDateSupported,
                            scope,
                            locationDefaultSuppressed,
                        ),
                        withFacets: true,
                        limit: 1,
                        offset: 0,
                    })
                        .then((gr) => {
                            if (cancelled || !paginationRef.current!.isCurrentGeneration(generation)) return;
                            if (isUnavailableJobsResult(gr)) return;
                            setGhostHiddenCount(gr.facetDistribution?.ghost_badge?.["likely_ghost"] ?? 0);
                        })
                        .catch(() => {
                            /* best-effort — the toggle row just omits the count suffix */
                        });
                } else {
                    setGhostHiddenCount(null);
                }
                // Beyond-window probe: same shape as the ghost-hidden-count
                // probe above (fire-and-forget, same `cancelled`/generation
                // staleness guard), but only when the 30d default is the
                // ACTIVE bucket — any other bucket (including "Any") has
                // nothing further to reveal, so `resolveBeyondWindow` would
                // hide the affordance anyway and the request would be
                // wasted. `postedBucket: undefined` lifts the filter to
                // measure the corpus this same query/facets would match
                // with no date window; `limit: 0` because only `total` is
                // needed. Unlike the ghost probe, failure explicitly clears
                // to `null` — a stale prior-search count masquerading as
                // this search's "N more" would be exactly the fabricated
                // number the spec forbids.
                if (postedBucket === "30d") {
                    searchJobsAction({
                        ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, scope, locationDefaultSuppressed),
                        postedBucket: undefined,
                        limit: 0,
                        offset: 0,
                    })
                        .then((br) => {
                            if (cancelled || !paginationRef.current!.isCurrentGeneration(generation)) return;
                            if (isUnavailableJobsResult(br)) {
                                setBeyondWindowCount(null);
                                return;
                            }
                            setBeyondWindowCount(resolveCorpusCount(br, MAX_REACHABLE));
                        })
                        .catch(() => {
                            if (!cancelled) setBeyondWindowCount(null);
                        });
                } else {
                    setBeyondWindowCount(null);
                }
            } catch (e) {
                if (!cancelled) {
                    console.error("[jobs-search] action transport error:", e);
                    // Deliverable 1 — same one-free-retry guard as the
                    // `isUnavailableJobsResult` branch above, for a thrown
                    // transport error rather than a backend-reported one.
                    if (autoRetriedSearchKeyRef.current !== searchKey) {
                        autoRetriedSearchKeyRef.current = searchKey;
                        autoRetryScheduled = true;
                        setTimeout(() => {
                            if (!cancelled) setSearchRetry((n) => n + 1);
                        }, 4000);
                    } else {
                        setSearchError(SEARCH_UNAVAILABLE_MESSAGE);
                        // A thrown transport error is not an unconfigured backend
                        // or a successful empty result. Preserve prior data (if
                        // any) and let the explicit error state own first load.
                    }
                }
            } finally {
                if (
                    !cancelled &&
                    !autoRetryScheduled &&
                    paginationRef.current!.finishFirstPage(generation, firstPageSucceeded)
                ) {
                    setLoading(false);
                }
            }
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
        // `searchKey` is a faithful serialization of query/facets/salaryMin/
        // visaOnly/postedBucket/hideGhosts/sortOverride — see its definition
        // above — so listing it alone (plus searchRetry) satisfies the
        // refetch rule without duplicating every field in this array.
        // `emptySearchState` is listed explicitly since the callback now
        // branches on it directly (which fetch shape to use) — it's derived
        // from `query`/`fitActive`/`activeEntries.length`, all already
        // covered transitively by `searchKey`, so this never fires an extra
        // run on its own; it's here so the effect is never accused of
        // reading a value outside its own dependency list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchKey, searchRetry, emptySearchState, locationDefaultSuppressed]);

    // Sort-reset (approved product change, 2026-08-13): an explicit sort is
    // sticky across query edits now — the only remaining reset is the
    // invalid-combination case where the query is cleared out from under a
    // "relevance" override (meaningless without a query) — see
    // `shouldResetSortOnQueryChange`'s doc comment. Depends on `query`
    // alone, so a facet/salary/visa/ghost change never resets an explicit
    // sort.
    useEffect(() => {
        if (shouldResetSortOnQueryChange(query, sortOverride)) {
            setSortOverride(null);
            applyUrlState(buildUrlState({ sort: null }), "replace");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, sortOverride]);

    // Keyboard-only highlight (ArrowUp/ArrowDown in the results list).
    // Deliberately local-only: it must not touch the URL (no history spam)
    // or reopen the mobile sheet. A deliberate open goes through `openJob` →
    // `applyUrlState` push instead.
    const selectJob = useCallback((id: string) => {
        setSelectedId(id);
    }, []);

    /** Jobs opened this session — the trigger for the Screen 9 résumé moment.
     *  Deliberately not persisted: the moment is about the reading someone is
     *  doing right now, and a count carried across visits would fire it at
     *  someone who just arrived. */
    const [opensThisSession, setOpensThisSession] = useState(0);

    /** Ids whose detail has been opened this session — dims a row's title
     *  from bold to muted on re-scan (see `JobCard`'s `opened` prop).
     *  Deliberately session-only (no persistence, resets on reload): this is
     *  about what's been read on THIS visit, not a cross-visit read-history
     *  feature. Kept separate from `opensThisSession` above — that's a COUNT
     *  driving a different decision (the Screen 9 résumé-moment threshold);
     *  this is a SET answering a different question (has THIS row
     *  specifically been read) — same triggering event, two independent
     *  concerns, so one counter piggybacking both would be wrong. */
    const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());

    // Deliverable 3 — which duplicate-result clusters the visitor has opened
    // (see `clusters` below). Keyed on the cluster's primary job id, which is
    // stable across re-renders of the same result set. Session-only, same as
    // `openedIds` — a fresh search's clusters start collapsed.
    const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set());
    const toggleClusterExpanded = (primaryId: string) => {
        setExpandedClusters((prev) => {
            const next = new Set(prev);
            if (next.has(primaryId)) next.delete(primaryId);
            else next.add(primaryId);
            return next;
        });
    };

    // Deliberate job open: pushes `?job=<id>` so back-button + refresh both
    // work (picked back up by the URL-derived-selection effect below).
    const openJob = (id: string) => {
        // Telemetry before navigation: the rank is only knowable against the
        // result set currently on screen. A miss yields -1, which the action
        // drops — so a job opened from a URL rather than a search logs nothing
        // rather than logging a fake position.
        const rank = resultRef.current?.hits.findIndex((h) => h.id === id) ?? -1;
        void recordJobOpenedAction(lastSearchId, id, rank);
        setOpensThisSession((n) => n + 1);
        setOpenedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
        const hit = resultRef.current?.hits.find((h) => h.id === id);
        if (hit) {
            recordRecentlyViewedJob({ id, title: hit.title, company: hit.company ?? "" });
        } else {
            const cached = getRecentlyViewedSnapshot().find((v) => v.id === id);
            if (cached) recordRecentlyViewedJob(cached);
        }
        applyUrlState(buildUrlState({ jobId: id }), "push");
    };

    const hits = useMemo(() => result?.hits ?? [], [result?.hits]);

    /**
     * Render fallback for a zero-query state (`resolveJobsRenderMode`,
     * lib/jobs/result-state.ts, unit-tested there) — `"serp-ask"` only once
     * that state's own fetch (above) has DEFINITIVELY failed with nothing to
     * show; a real query/fit always renders results regardless. `failed`
     * mirrors the same unavailable/unconfigured signals `notConnected`/
     * `blockingError` below already read, so a zero-query fetch failure
     * lands on the calmer serp-ask fallback (tappable seeds) instead of
     * either of those harder error walls — never a fake-outage wall for the
     * landing state.
     */
    const zeroQueryFetchFailed =
        searchError != null || (result != null && (result.unavailable === true || result.configured === false));
    const isSerpAsk =
        resolveJobsRenderMode(emptySearchState, {
            loading,
            hitCount: hits.length,
            failed: zeroQueryFetchFailed,
        }) === "serp-ask";

    // Whether this render's search is scoped to title+company because an
    // explicit sort turned `sort` into a real ORDER BY — the identical
    // condition `buildSearchBody` used server-side to decide the SAME thing
    // (`shouldScopeTextMatchToTitle`, sort.ts). Relevance ranking (explicit
    // or auto-defaulted) never scopes, so it's false there exactly when it's
    // false here.
    const sortScopedSeam = shouldScopeTextMatchToTitle(effectiveSort, result?.effectiveQ ?? "");

    // The relevance seam (Task A) — where the "titled it" block of results
    // ends and the "mentions it" block begins, and the ordering `clusterJobs`
    // (below) groups. Tiers against the SERVER's residual query
    // (`result.effectiveQ`), not the client's `query` state: the client
    // query can still hold place words (e.g. "canada") that query
    // understanding already stripped server-side, and tiering against those
    // would wrongly demote a title that correctly omits the place word.
    //
    // `firstMentionIndex` finds the seam by counting hits' leading titled
    // run — correct ONLY under relevance ranking, which is the one mode
    // where every titled hit is guaranteed to sort before every non-titled
    // one. An explicit sort (fresh, salary) breaks that guarantee: title and
    // non-title hits interleave by date/pay instead, so a run-count stops at
    // the first interloper (see `partitionByTitleMatch`'s doc, presentation.ts,
    // for the live numbers). `partitionByTitleMatch` restores the property by
    // reordering `displayHits` — titled block first, each half keeping its
    // sorted order — instead of counting a run, so it's used in place of
    // `firstMentionIndex` for every sort mode other than relevance.
    const { hits: displayHits, seamIndex } = useMemo(() => {
        const q = result?.effectiveQ ?? "";
        if (sortScopedSeam) return partitionByTitleMatch(hits, q);
        return { hits, seamIndex: firstMentionIndex(hits.map((h) => decodeText(h.title)), q) };
    }, [hits, result, sortScopedSeam]);

    // Deliverable 3 — collapse repeat postings (same title, same company —
    // e.g. one role cross-posted at several locations) into one card each,
    // ranked at the earliest/best-ranked copy's position. `clusterJobs` is
    // pure (lib/jobs/cluster.ts); reads `displayHits`, not raw `hits`, so a
    // partitioned sort's reordering (above) survives clustering instead of
    // being clustered back into raw engine order.
    const clusters = useMemo(() => clusterJobs(displayHits), [displayHits]);

    // The seam paragraph (above) is inserted at an EXACT `displayHits` index;
    // after clustering, positions no longer line up 1:1. Every member of one
    // cluster shares the same title, so — since results already arrive
    // ranked with the "titled it" block first — a cluster can never straddle
    // the seam: it's entirely on one side or the other. This finds the first
    // clustered row whose best-ranked member's original index reaches the
    // seam, i.e. the same insertion point `firstMentionIndex` already chose,
    // translated into cluster-array coordinates. `seamIndex <= 0` (no seam,
    // `firstMentionIndex`'s only two return shapes) must short-circuit here
    // too — `primaryIndex >= 0` would otherwise always match at cluster 0.
    const clusterSeamIndex =
        seamIndex > 0 ? clusters.findIndex((c) => c.primaryIndex >= seamIndex) : -1;

    // The flat list of jobs actually rendered as their own row right now —
    // every cluster's primary, plus its variants only while expanded.
    // `handleResultsKeyDown` below walks THIS, not raw `hits`: arrow-key nav
    // must never land on a collapsed variant with no visible row to show as
    // selected.
    const visibleHits = useMemo(
        () => clusters.flatMap((c) => [c.primary, ...(expandedClusters.has(c.primary.id) ? c.variants : [])]),
        [clusters, expandedClusters],
    );

    // The URL is the reactive source of truth for the WHOLE screen, not just
    // `job` — this effect reconciles every parsed field back into local state
    // whenever `searchParams` changes. That covers Back/Forward, a typed
    // address bar, and an external link, none of which go through
    // `applyUrlState`. Without this, only `job` self-corrected on history
    // navigation; every other field (q/facets/salaryMin/visaOnly/
    // postedBucket/sort/hideGhosts) was seeded once at mount and never
    // re-derived, so Back after a `replace` could leave the screen showing
    // state the address bar no longer matches (e.g. push a job open, then
    // replace the query — Back only unwinds the top history entry, so the
    // URL reverts but the query text and results didn't).
    //
    // Loop safety: `applyUrlState`'s own writes must not bounce back here.
    // Every mutation call site in this file sets local state directly BEFORE
    // calling `applyUrlState`, so by the time the resulting `searchParams`
    // change reaches this effect, `buildUrlState()` (current local state,
    // reassembled) already serializes identically to the freshly parsed URL
    // — the comparison below finds them equal and the setters never run, so
    // there's no render loop and `searchKey` changes at most once per actual
    // user action.
    useEffect(() => {
        const parsed = parseJobsUrl(searchParams);
        const current = buildUrlState();
        // Compare everything except `job`: `job` is intentionally excluded
        // because `buildUrlState()` sources its `jobId` straight from
        // `searchParams.get("job")` (the same value `parsed.jobId` just
        // read), so the two would trivially match and mask a job-only URL
        // change from the equality check below.
        const parsedKey = serializeJobsUrl({ ...parsed, jobId: null });
        const currentKey = serializeJobsUrl({ ...current, jobId: null });
        if (parsedKey !== currentKey) {
            setQueryDraft(parsed.q);
            setQuery(parsed.q);
            // Facets are an object, not a primitive — a same-content-but-new-
            // reference set would still be a needless render, so gate it on
            // serialized equality rather than setting unconditionally.
            const facetsChanged =
                serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: parsed.facets }) !==
                serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: current.facets });
            if (facetsChanged) setFacets(parsed.facets);
            setSalaryMin(parsed.salaryMin);
            setVisaOnly(parsed.visaOnly);
            setPostedBucket(parsed.postedBucket);
            setHideGhosts(parsed.hideGhosts);
            setBoard(parsed.board);
            setCompanyDomain(parsed.companyDomain);
            setSortOverride(resolveUrlSort(parsed.sort));
            setFitActive(parsed.sort === "fit");
        }

        // Selected job stays derived from the URL's `job` param — the
        // reactive source of truth. Row click pushes it (`openJob`); this
        // picks it back up on mount (deep link), on browser back/forward
        // (popstate needs no bespoke handling — Next's router already
        // updates `searchParams`), and opens/closes the detail sheet when
        // `job` appears/disappears (detail close calls `router.back()`, see
        // the Sheet below). Deliberately unconditional (not gated behind the
        // subset check above) — a job-only URL change must still update
        // selection even when nothing else in the subset changed.
        //
        // Bottom sheet on all viewports when `job` appears/disappears (close
        // calls `router.back()`, see the Sheet below).
        const jobId = parsed.jobId;
        setSelectedId(jobId);
        setDetailSheetOpen(Boolean(jobId));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // `selectedId` set (deliberately, from the URL) but not among the loaded
    // hits leaves the pane empty rather than stealing a fallback job. No
    // explicit selection at all (ambient "browsing" default) still falls
    // back to the first hit, exactly like before Task 5 — that default is
    // never URL-represented.
    const selected = useMemo(() => {
        if (!selectedId) return hits[0] ?? null;
        return hits.find((h) => h.id === selectedId) ?? null;
    }, [hits, selectedId]);

    // Task 11 — dead-link EXISTENCE-CHECK CANDIDATE: a deliberate URL
    // selection that the CURRENT search's first page has already resolved
    // and still doesn't contain. `hits` is one PAGE=30 window of the
    // current search, filters, and sort — being absent from it does NOT
    // mean the role is gone; it may just rank 31st, or the visitor may be
    // browsing under different filters than whoever shared the link. So
    // this is only a CANDIDATE for the targeted existence check below, not
    // a verdict — review fix, the original `isDeadJob` asserted death here
    // directly. `!loading` is the "resolved, not mid-fetch" gate: while a
    // fetch for the current search key is in flight, "not found yet" and
    // "genuinely gone" are indistinguishable, so the check must wait it out
    // rather than fire mid-refetch.
    const isDeadJobCandidate = Boolean(selectedId) && !loading && !selected;

    // Targeted existence check: one `searchJobsAction({ id, limit: 1 })`
    // request per candidate id (no other facets/query/sort — see
    // `JobSearchParams.id`), generation-guarded with the same
    // `FitIntentGuard` precedent `handleRankByFit`/the sheet's live count
    // use, so a rapid id-to-id navigation can't let a stale response land.
    // Fires once per id: the effect's own deps skip re-firing for an
    // unchanged (candidate id, already checked/checking) pair, and the
    // guard inside additionally no-ops a re-entrant call. `deadJobCheck`
    // is read against the LIVE `selectedId` at render time (below), so a
    // stale result for a since-abandoned id can never render — no explicit
    // cleanup needed.
    const [deadJobCheck, setDeadJobCheck] = useState<
        | { id: string; status: "checking" | "not_found" | "unknown" }
        | { id: string; status: "found"; job: PublicJob }
        | null
    >(null);
    const deadJobGuardRef = useRef<FitIntentGuard | null>(null);
    if (!deadJobGuardRef.current) deadJobGuardRef.current = new FitIntentGuard();
    useEffect(() => {
        if (!isDeadJobCandidate || !selectedId) return;
        if (deadJobCheck && deadJobCheck.id === selectedId) return;
        const id = selectedId;
        const token = deadJobGuardRef.current!.begin();
        setDeadJobCheck({ id, status: "checking" });
        void (async () => {
            try {
                // Review fix — explicit `hideGhosts: false`: this must see
                // the WHOLE corpus, not just the non-ghost subset, or a
                // genuinely live likely_ghost posting would classify
                // not_found and get declared dead. Verified in
                // `buildFilter` (lib/jobs/meilisearch.ts): an omitted
                // `hideGhosts` is already falsy there (no ghost-exclusion
                // clause gets added either way) — so this wasn't silently
                // wrong today, but leaving it implicit relied on that one
                // line never changing. Every other field (facets/q/
                // salaryMin/visaOnly/postedBucket/sort) stays omitted on
                // purpose — see `JobSearchParams.id`'s own doc comment.
                const r = await searchJobsAction({ id, limit: 1, offset: 0, hideGhosts: false });
                if (!deadJobGuardRef.current!.isCurrent(token)) return;
                // `classifyExistenceCheck` (lib/jobs/result-state.ts,
                // unit-tested) treats an unconfigured backend OR a failed
                // request as "unknown" — neither confirms nor denies, so it
                // falls back to a NON-assertive state rather than claiming
                // the role is gone. That "unknown" branch is not
                // hypothetical: verified live that `id = ...` currently
                // 400s against production until the index picks up the
                // `filterableAttributes` addition in meilisearch.ts.
                setDeadJobCheck({ id, ...classifyExistenceCheck(id, r) });
            } catch {
                if (deadJobGuardRef.current!.isCurrent(token)) setDeadJobCheck({ id, status: "unknown" });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDeadJobCandidate, selectedId]);

    // Only trust `deadJobCheck` when it's answering for the CURRENTLY
    // selected id — a still-in-flight/stale result for an abandoned id
    // must never leak into what's rendered for the current one.
    const deadJobResolved = deadJobCheck && deadJobCheck.id === selectedId ? deadJobCheck : null;
    // Confirmed alive but off-page/filtered-out: render its real detail
    // instead of asserting death. Confirmed gone: the tombstone.
    const deadJobFoundJob = deadJobResolved?.status === "found" ? deadJobResolved.job : null;
    const isDeadJobConfirmed = deadJobResolved?.status === "not_found";
    // The job to actually render in the detail pane/sheet — `selected`
    // (in `hits`) first, else the existence check's confirmed-alive job.
    const detailJob = selected ?? deadJobFoundJob;
    const detailPursuit = detailJob ? pursuitsByJobId.get(detailJob.id) : undefined;
    // The detail panel's "also in" chip (docs-mockup.html Comp B2) reads the
    // SAME `clusters` the SERP rows already group `hits` into (cluster.ts) —
    // not a second lookup — so the two can never disagree about what counts
    // as a duplicate of this posting.
    const detailVariants = useMemo(() => {
        if (!detailJob) return [];
        const cluster = clusters.find(
            (c) => c.primary.id === detailJob.id || c.variants.some((v) => v.id === detailJob.id),
        );
        if (!cluster) return [];
        return [cluster.primary, ...cluster.variants].filter((j) => j.id !== detailJob.id);
    }, [clusters, detailJob]);
    // Review fix — still checking, or the check came back inconclusive
    // (`unknown` — the confirmed production reality until the Meilisearch
    // index gets `id` added to `filterableAttributes`, see
    // `classifyExistenceCheck`'s doc comment): neither confirmed dead nor
    // confirmed alive. `isDeadJobCandidate` already encodes "a deliberate
    // selection, first page resolved, not among the loaded hits" — combined
    // with "not confirmed dead," that's exactly the non-assertive gap
    // `DeadJobUnresolved` (below) now fills instead of rendering nothing.
    const showUnresolvedDetail = isDeadJobCandidate && !isDeadJobConfirmed;
    // Round-3 review fix: `deadJobResolved` is null (not just status
    // "checking") for the one render between `isDeadJobCandidate` flipping
    // true and the existence-check effect's OWN first `setDeadJobCheck({
    // status: "checking" })` call landing — a real, reachable gap, not a
    // hypothetical one (effects run strictly after the render that
    // triggered them). Without treating `null` as "checking" too, that one
    // frame painted the "can't confirm" copy — implying a completed,
    // inconclusive check — before any check had even started.
    const isDeadJobChecking = !deadJobResolved || deadJobResolved.status === "checking";

    const handleResultsKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const idx = visibleHits.findIndex((h) => h.id === selectedId);
            const base = idx < 0 ? 0 : idx;
            const next =
                e.key === "ArrowDown"
                    ? Math.min(base + 1, visibleHits.length - 1)
                    : Math.max(base - 1, 0);
            if (visibleHits[next]) selectJob(visibleHits[next].id);
        },
        [visibleHits, selectedId, selectJob],
    );

    const total = result?.total ?? 0;
    const hasMore =
        result?.configured === true && hits.length > 0 && hits.length < total && hits.length < MAX_REACHABLE;
    // Honest display count for THIS search's result total (result-count
    // toolbar text + the end-of-list line below) — distinct from `total`
    // above, which stays the raw Meili value on purpose: `hasMore`'s
    // pagination-boundary math is correct either way (whether `total` is
    // exact or capped, `hits.length < total` and `hits.length < MAX_REACHABLE`
    // both still hold), so only the DISPLAY sites route through the honest
    // resolver — see corpus-count.ts's header comment.
    const totalCount = resolveCorpusCount(result ?? { total: 0 }, MAX_REACHABLE);
    // A4 — once `hasMore` goes false, WHY it stopped matters: genuinely out
    // of results, or just out of MAX_REACHABLE reach while `totalCount` (the
    // honest, facet-sum-recovered total) is far bigger. See
    // `resolveEndOfListState`'s own doc comment for the bug this replaces.
    const endOfListState = resolveEndOfListState({
        hitsLength: hits.length,
        total: totalCount.value,
        maxReachable: MAX_REACHABLE,
    });

    // Observer handle stays stable; the generation coordinator owns request guards.
    const observerRef = useRef<IntersectionObserver | null>(null);

    // Fetch the next page and append it only while its monotonic generation is current.
    const loadMore = useCallback(async () => {
        const cur = result;
        if (!cur || !cur.configured) return;
        if (cur.hits.length >= cur.total || cur.hits.length >= MAX_REACHABLE) return;
        const ticket = paginationRef.current!.beginLoadMore(PAGE);
        if (!ticket) return; // first page active or another load-more owns the generation
        setLoadingMore(true);
        try {
            // Whole-branch review fix: this used to hand-build the same
            // (q/facets/salaryMin/visaOnly/postedBucket/hideGhosts/sort)
            // subset `buildJobSearchPayload` already owns — a duplicate the
            // module's own doc comment (search-payload.ts) explicitly warns
            // against, since a field the live search gains later could
            // silently go missing from this one. `filterState` (declared
            // near the top of this component) is reconstructed fresh every
            // render from the same facets/salaryMin/visaOnly/postedBucket/
            // hideGhosts state this callback already depends on, so this is
            // a behavior-preserving swap, not a functional change.
            const r = await searchJobsAction({
                ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, scope, locationDefaultSuppressed),
                limit: PAGE,
                offset: ticket.offset,
            });
            if (!paginationRef.current!.completeLoadMore(ticket)) return;
            setResult((prev) => {
                if (!prev) return prev;
                // React may run this updater after another first-page generation
                // starts; check again at commit time before touching its results.
                if (!paginationRef.current!.isCurrentGeneration(ticket.generation)) return prev;
                const seen = new Set(prev.hits.map((h) => h.id));
                const fresh = r.hits.filter((h) => !seen.has(h.id));
                return fresh.length ? { ...prev, hits: [...prev.hits, ...fresh] } : prev;
            });
        } catch {
            /* transient — the sentinel re-fires on the next scroll */
        } finally {
            if (paginationRef.current!.endLoadMore(ticket)) setLoadingMore(false);
        }
        // `filterState` isn't listed here on purpose: it's a plain object
        // literal rebuilt every render straight from facets/salaryMin/
        // visaOnly/postedBucket/hideGhosts — the exact fields already
        // listed below — so it's never stale relative to them, and adding
        // the (always-new-reference) object itself would only force this
        // callback to regenerate on every render for no behavioral gain.
        // Same precedent as `searchKey`'s effect above, which serializes a
        // superset of these same fields for an identical reason.
        // `postedDateSupported` added (Phase 1-a #4): `buildJobSearchPayload`
        // now reads it directly to decide whether `postedBucket` is even
        // eligible to ship, independent of whatever `backendSort` happens to
        // be — so this callback must regenerate when it changes, same as
        // every other field `buildJobSearchPayload` reads from this render.
        // `locationDefaultSuppressed` (default-location chip's "×"), same
        // reason: page 2+ must never silently reapply a default this
        // session already cleared.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result, query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, board, companyDomain, sortOverride, postedDateSupported, locationDefaultSuppressed]);

    const loadMoreRef = useRef(loadMore);
    loadMoreRef.current = loadMore;

    // Callback ref: (re)binds the observer exactly when the sentinel mounts.
    const sentinelRef = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        if (!node) return;
        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) void loadMoreRef.current();
            },
            { rootMargin: "600px" }, // prefetch the next page before the user hits the end
        );
        observerRef.current.observe(node);
    }, []);

    // Stable identity for `SearchAutocomplete`'s `suggest` prop (review fix,
    // Task 9): an inline arrow here would get a NEW reference on every
    // render of this component (which re-renders often — loading, result,
    // corpusCount capture, loadingMore all live here), and the box's
    // debounce effect used to key off that reference. This callback closes
    // over nothing from render scope (fetch + `mapToSuggestions`, a
    // module-level pure function), so `[]` deps are correct — it never needs
    // to change.
    //
    // A route handler (`/api/jobs/suggest`), not a Server Action, as of
    // 2026-08-14: the page's main search (`searchJobsActionRaw`) is itself a
    // Server Action, and Next serializes a client's action calls per
    // request — a typeahead action fired on every keystroke was queuing
    // behind whatever full search was already in flight. A plain fetch has
    // no such head-of-line block. Non-ok response or a network rejection
    // both degrade to empty suggestions — never surfaces as a box error.
    const suggestForBox = useCallback(async (q: string) => {
        try {
            const res = await fetch(`/api/jobs/suggest?q=${encodeURIComponent(q)}`);
            const data = res.ok ? await res.json() : { titles: [], companies: [] };
            return mapToSuggestions(data);
        } catch {
            return mapToSuggestions({ titles: [], companies: [] });
        }
    }, []);
    useEffect(() => () => observerRef.current?.disconnect(), []);

    // Every filter/sort mutation below routes through `applyUrlState` with
    // `"replace"` — a filter toggle must never grow browser history.
    // Task 7: setLocal-then-applyUrlState, mirroring every other mutator here
    // (see the ordering rule in this file's header comment / composer
    // precedent in url-state.ts).
    const onHideGhosts = (v: boolean) => {
        setHideGhosts(v);
        applyUrlState(buildUrlState({ hideGhosts: v }), "replace");
    };

    const onBoardChange = (next: BoardId | null) => {
        setBoard(next);
        setMobileResultsEngaged(true);
        applyUrlState(buildUrlState({ board: next }), "replace");
        flushSearchIntent();
    };

    /**
     * Widen a single-employer browse back to the whole corpus.
     *
     * Deliberately NOT folded into `panelClearAll` (which resets
     * `FilterState` only): the employer scope is the corpus this search runs
     * against, not a filter the searcher picked off the toolbar, and a
     * "Clear filters" that silently dumped them out of the company they
     * arrived for would be the same undisclosed-scope change the chip below
     * exists to prevent. One affordance, one meaning.
     */
    const clearCompanyScope = () => {
        setCompanyDomain(null);
        applyUrlState(buildUrlState({ companyDomain: null }), "replace");
    };

    useEffect(() => {
        setLocationDraft(filterState.facets.location_country?.[0] ?? "");
    }, [filterState.facets.location_country]);

    // Sets every local FilterState field + pushes the matching URL replace in
    // one shot — the shared tail of both `clearAll` and a single chip's
    // `onRemove` (via `activeFilterEntries(...).clear`), so the two can never
    // drift on which fields a "clear" touches.
    const applyFilterState = (next: FilterState) => {
        setFacets(next.facets);
        setSalaryMin(next.salaryMin);
        setVisaOnly(next.visaOnly);
        setPostedBucket(next.postedBucket);
        setHideGhosts(next.hideGhosts);
        applyUrlState(
            buildUrlState({
                facets: next.facets,
                salaryMin: next.salaryMin,
                visaOnly: next.visaOnly,
                postedBucket: next.postedBucket,
                hideGhosts: next.hideGhosts,
            }),
            "replace",
        );
    };

    const applyFilterStateWithIntent = useCallback(
        (next: FilterState) => {
            setMobileResultsEngaged(true);
            applyFilterState(next);
            flushSearchIntent();
        },
        [flushSearchIntent],
    );

    const commitLocation = useCallback(() => {
        const trimmed = locationDraft.trim();
        const nextFacets = { ...filterState.facets };
        if (trimmed) nextFacets.location_country = [trimmed];
        else delete nextFacets.location_country;
        applyFilterStateWithIntent({ ...filterState, facets: nextFacets });
        if (user && query.trim()) {
            void saveAgentPreferencesAction({
                search: {
                    query: query.trim(),
                    location: trimmed || undefined,
                },
            }).catch(() => {});
        }
    }, [locationDraft, filterState, user, query, applyFilterStateWithIntent]);

    const handleLocationSheetContinue = useCallback(
        (draft: LocationSheetDraft, opts: { suppressDefault: boolean }) => {
            if (opts.suppressDefault) suppressLocationDefault();
            else if (draft.useDetected && locationDefaultSuppressed) restoreLocationDefault();
            const remoteValue = pickRemoteFacetValue(result?.facetDistribution);
            const next = applyLocationSheetDraft(draft, filterState, remoteValue);
            const loc =
                draft.useDetected ? "" : draft.showOther ? draft.otherText.trim() : draft.country ?? "";
            setLocationDraft(loc);
            applyFilterStateWithIntent(next);
            setLocationSheetOpen(false);
            if (user && query.trim()) {
                void saveAgentPreferencesAction({
                    search: {
                        query: query.trim(),
                        location: loc || undefined,
                    },
                }).catch(() => {});
            }
        },
        [filterState, result?.facetDistribution, applyFilterStateWithIntent, user, query, locationDefaultSuppressed],
    );

    // `activeFilterEntries` (FilterPanel.tsx) is the single source for "what's
    // active" — the "All filters (N)" pill's count, the empty state's
    // per-filter clear chips, `emptySearchState` above, and the sheet's own
    // count all read from the ONE `activeEntries` hoisted earlier so they
    // can never disagree.
    const activeCount = activeEntries.length;

    /**
     * The SERP filter panel (collapsible, Vivek 2026-07-26). Every mutator is
     * a thin wrapper over `applyFilterState` — the ONE funnel that turns a
     * FilterState into local state + a URL replace — so the panel can never
     * grow a second, drifting mutation path.
     */
    const [filtersOpen, setFiltersOpen] = useState(false);
    const panelToggleFacet = (key: FacetKey, value: string) =>
        applyFilterStateWithIntent({ ...filterState, facets: toggleFacetValue(filterState.facets, key, value) });
    const panelSalaryMin = (v: number) => applyFilterStateWithIntent({ ...filterState, salaryMin: v });
    const panelVisaOnly = (v: boolean) => applyFilterStateWithIntent({ ...filterState, visaOnly: v });
    const panelPostedBucket = (v: PostedBucket | undefined) =>
        applyFilterStateWithIntent({ ...filterState, postedBucket: v });
    const panelClearAll = () => applyFilterStateWithIntent(PRISTINE_FILTER_STATE);

    const applySavedSearchPrefs = useCallback(
        (prefs: SearchPrefsValues) => {
            const rawQ = prefs.query.trim();
            const { residualQ, workTypes } = parseWorkTypeTokens(rawQ);
            const q = residualQ || rawQ;
            const loc = prefs.location.trim();
            const nextFacets = { ...filterState.facets };
            if (loc) nextFacets.location_country = [loc];
            else delete nextFacets.location_country;
            const types = [...workTypes];
            if (prefs.remoteOnly && !types.includes("remote")) types.push("remote");
            if (types.length > 0) nextFacets.work_type = types;
            else delete nextFacets.work_type;
            const nextSalary = prefs.salaryMin > 0 ? prefs.salaryMin : 0;
            setQueryDraft(q);
            setQuery(q);
            setFacets(nextFacets);
            setSalaryMin(nextSalary);
            setLocationDraft(loc);
            recordRecentSearch(q);
            setAgentPrefs((prev) => ({
                configured: true,
                search: {
                    query: rawQ,
                    location: loc || undefined,
                    remoteOnly: prefs.remoteOnly || undefined,
                    salaryMin: nextSalary || undefined,
                },
                answers: prev?.answers ?? { custom: {} },
                updated_at: new Date().toISOString(),
            }));
            applyUrlState(buildUrlState({ q, facets: nextFacets, salaryMin: nextSalary }), "push");
        },
        [filterState.facets, buildUrlState, applyUrlState],
    );

    // Task 11 — empty state's ghost-reveal line. Pure gate (lib/jobs/
    // result-state.ts, unit-tested there) so it can't drift from the same
    // "hideGhosts && ghostHiddenCount > 0" rule the controller specified.
    const ghostRevealCount = resolveGhostReveal(hideGhosts, ghostHiddenCount);


    /**
     * Screen 9's gate — the résumé moment.
     *
     * Three opens deep, not dismissed, and not already ranked by fit. It fires
     * for people who HAVE a résumé too, which is the whole reason this replaced
     * the old card: with the sort trio gone, "rank by fit" lost its only entry
     * point, so a returning user with a résumé on file had no way left to ask
     * for it. Whether we ask for a résumé or offer to use the one on hand is
     * decided at the call site — same moment, one sentence apart.
     *
     * `resumeIsUsable` reads LOCAL state only (no mount fetch), so someone with
     * a server-side résumé they haven't loaded this session is offered the
     * upload path. Accepted trade-off, not a bug. `hasUsableResume` itself is
     * hoisted near `emptySearchState` above — single source, see its comment.
     */
    const showResumeMoment =
        !upsellDismissed && !fitActive && opensThisSession >= RESUME_MOMENT_OPENS;

    // Personalization invite — the quiet bottom-of-list nudge that precedes
    // the résumé moment. Appears from the first search result (no opens gate),
    // disappears once a résumé exists, fit is active, or the user dismisses.
    // Never shown alongside `showResumeMoment` (which fires at 3 opens and
    // is more specific) — mutually exclusive by the `!showResumeMoment` guard.
    const showPersonalizationInvite =
        !upsellDismissed &&
        !fitActive &&
        !hasUsableResume &&
        !showResumeMoment;

    // Guest save upsell banner — shown after the first anonymous save (either
    // "Go after" or a saved search) until dismissed. Signed-in users never see
    // it; the `guestSaveCount` and `guestSaveBannerDismissed` states are
    // seeded from localStorage post-mount so there's no SSR mismatch.
    const showGuestSaveBanner = !user && guestSaveCount >= 1 && !guestSaveBannerDismissed;
    const handleDismissGuestSaveBanner = () => {
        dismissGuestSaveBanner();
        setGuestSaveBannerDismissed(true);
    };

    // A1 — apply-return capture (Zeigarnik Effect). `handleOpenPosting`
    // below stamps this the moment a signed-in visitor leaves for the
    // employer's site; the visibilitychange effect further down reads it
    // back on tab-return. Not React state — the away window has no render
    // of its own — and deliberately holds the whole `job`, not just the
    // `{jobId, title, leftAt}` triple: `doMarkApplied` (below) needs
    // `company`/`apply_url` too, and re-deriving those from an id would just
    // be a second lookup path for data already on hand here.
    const awayForApplyRef = useRef<{ job: PublicJob; leftAt: number } | null>(null);
    // One prompt max per job per session (brief) — ids that have already
    // shown the "did you apply?" prompt, regardless of outcome.
    const applyReturnPromptedRef = useRef<Set<string>>(new Set());
    // Latest `pursuitsByJobId` for the visibilitychange handler below, which
    // is registered once on mount (see its own comment) and would otherwise
    // close over a stale map — same mirroring idiom as `resultRef`/
    // `fitActiveRef` above.
    const pursuitsByJobIdRef = useRef(pursuitsByJobId);
    pursuitsByJobIdRef.current = pursuitsByJobId;
    const [applyReturnPrompt, setApplyReturnPrompt] = useState<PublicJob | null>(null);
    // The job whose apply click is currently held open by the AI hand-off
    // prompt. Holding the job rather than a boolean keeps the dialog's content
    // and its "continue" target the same object the click started from.
    const [applyIntentJob, setApplyIntentJob] = useState<PublicJob | null>(null);

    // "Apply with tailored resume" / the fit-check drawer moved to MCP
    // 2026-08-02 — openTailor/handleTailor and the FitDrawer/
    // TailorAnalysisSheet mounts they drove are gone; `handleApplyGate`
    // stays (Apply, Go after this job, and Open posting still gate through
    // it — see its own comment).
    const handleCompany = (job: PublicJob) => {
        if (!job.company_domain) return;
        router.push(`/co/${domainToSlug(job.company_domain)}`);
    };
    // Job 2 — the card "Apply" button and the detail panel's "Open posting"
    // button both call this (see JobCard's `onOpenPosting` prop and
    // JobDetail's `onOpenPosting` prop), so gating here covers both by
    // construction. Signed in: unchanged, new-tab `window.open` (safe —
    // this always runs synchronously inside the click's own gesture stack).
    // The departure itself, split out from the gating above so the apply-intent
    // dialog's "Continue to the posting" button can reach it. It must stay
    // callable straight from a click handler: `window.open` outside a user
    // gesture is what popup blockers exist to stop.
    const openPostingNow = (job: PublicJob) => {
        if (!job.apply_url) return;
        // A1 — only a real, signed-in departure to the employer's site arms the
        // return prompt; the gated branches return before reaching here, so
        // guests never do.
        awayForApplyRef.current = { job, leftAt: Date.now() };
        window.open(job.apply_url, "_blank", "noopener,noreferrer");
    };

    const handleOpenPosting = (job: PublicJob) => {
        if (resolveApplyGateDecision(Boolean(user)) === "gate") {
            handleApplyGate(job);
            return;
        }
        // Offer the AI hand-off once, at the only moment it is worth anything.
        // Ordered after the auth gate on purpose: a signed-out visitor has no
        // résumé or tracker for an assistant to read, so the offer would be
        // hollow, and two interruptions stacked on one click is worse than the
        // problem either solves.
        if (job.apply_url && shouldPromptApplyIntent()) {
            setApplyIntentJob(job);
            return;
        }
        openPostingNow(job);
    };

    const doMarkApplied = async (job: PublicJob) => {
        try {
            const res = await markJobAppliedAction({
                company: job.company ?? "",
                title: job.title,
                applyUrl: job.apply_url,
                jobId: job.id,
            });
            if (res.error) {
                // Session may have expired between login and save → reopen auth.
                if (classifySentinel(res.error) === "auth") {
                    setAuthOpen(true);
                } else {
                    toast.error(`Could not save: ${res.error}`);
                }
                return;
            }
            invalidatePursuitsCache();
            toast.success("Marked as applied");
        } catch (e) {
            if (classifySentinel(e) === "auth") {
                setAuthOpen(true);
            } else {
                toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    };

    // A1 — apply-return capture. Registered once (mount-only): the handler
    // reads `awayForApplyRef`/`applyReturnPromptedRef`/`pursuitsByJobIdRef`
    // fresh on every fire rather than closing over this render's values, so
    // there's no reason to tear down and re-add the listener on every
    // dependency change — same "stable listener, live refs" shape as the
    // IntersectionObserver setup below (`observerRef`/`loadMoreRef`).
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState !== "visible") return;
            const away = awayForApplyRef.current;
            if (!away) return;
            awayForApplyRef.current = null;
            const pursuit = pursuitsByJobIdRef.current.get(away.job.id);
            const alreadyApplied = !!pursuit && hasReachedStage(pursuit, "applied");
            const alreadyPrompted = applyReturnPromptedRef.current.has(away.job.id);
            if (
                shouldPromptApplyReturn({
                    awayMs: Date.now() - away.leftAt,
                    alreadyApplied,
                    alreadyPrompted,
                })
            ) {
                applyReturnPromptedRef.current.add(away.job.id);
                setApplyReturnPrompt(away.job);
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, []);

    // Job 2 replay: reuses `doMarkApplied` — the EXACT tracker-write
    // "Mark as applied" uses, not a second copy of it — then navigates
    // same-tab to the posting. `window.open` (used by the signed-in
    // `handleOpenPosting` above) would be popup-blocked here: this runs
    // asynchronously after the login round-trip completes, outside the
    // click's own gesture stack, which is exactly the condition browsers
    // block a new-tab popup under. Awaiting the write first (rather than
    // firing it and navigating immediately) also means the tab unloading
    // can't race the request and drop it silently.
    const replayApplyGate = async (job: PublicJob) => {
        await doMarkApplied(job);
        if (job.apply_url) window.location.href = job.apply_url;
    };

    // Job 2 (2026-08-01, Vivek: account creation BEFORE applying) — the ONE
    // gate every apply-adjacent CTA reachable signed out funnels through:
    // card "Apply", "Go after this job", "Open posting", and "Apply with
    // tailored resume" (see their own call sites above/below) all call this
    // instead of performing their own action or keeping their own pre-auth
    // behavior. A fifth gated button is covered by calling this too, not by
    // adding another branch here or another case in `maybeReplay` below.
    const handleApplyGate = (job: PublicJob) => {
        pendingRef.current = queuePending(pendingRef.current, { kind: "gate", payload: job });
        openAuth("apply");
    };

    // "Save" — signed out writes to the guest store immediately for the FIRST
    // save; on the second+ guest save, require sign-in so the list isn't
    // silently lost (progressive gating spec). Apply-adjacent CTAs still gate
    // via `handleApplyGate` above.
    const handleGoAfter = (job: PublicJob) => {
        if (!user) {
            if (getGuestSaveCount() >= 1) {
                openAuth("save");
                return;
            }
            addGuestPursuit(job);
            const newCount = recordGuestSave();
            setGuestSaveCount(newCount);
            toast.success(GUEST_SAVE_TOAST);
            return;
        }
        void (async () => {
            setGoingAfterId(job.id);
            try {
                const res = await goAfterJobAction(job);
                if (res.error) {
                    // Session may have expired between login and save → reopen auth.
                    if (classifySentinel(res.error) === "auth") {
                        setAuthOpen(true);
                    } else {
                        toast.error(`Could not save: ${res.error}`);
                    }
                    return;
                }
                invalidatePursuitsCache();
                toast.success(GUEST_SAVE_TOAST);
            } catch (e) {
                if (classifySentinel(e) === "auth") {
                    setAuthOpen(true);
                } else {
                    toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
                }
            } finally {
                setGoingAfterId(null);
            }
        })();
    };

    // Gate callback for SavedSearchesPanel's guest save path — mirrors
    // `handleGoAfter`'s own guest-save gate so both save types share the same
    // "first save free, second requires sign-in" rule with one counter.
    const handleBeforeGuestSavedSearch = (): "proceed" | "block" => {
        if (getGuestSaveCount() >= 1) {
            openAuth("save");
            return "block";
        }
        const newCount = recordGuestSave();
        setGuestSaveCount(newCount);
        return "proceed";
    };

    // Run whatever the user queued before signing in — exactly once, and ONLY
    // after this page's AuthPopover confirmed a real sign-in (`authedRef`). Any
    // other path to being logged-in (sidebar login, an already-signed-in tab)
    // never sets `authedRef`, so a stale apply/gate/upload can't fire.
    // `takeReplay` empties the state, so the dispatch is idempotent no matter
    // how many times this runs or in what order relative to `setUser`.
    const maybeReplay = useCallback(() => {
        if (!authedRef.current) return;
        const { next, action } = takeReplay(pendingRef.current);
        pendingRef.current = next;
        if (!action) return;
        switch (action.kind) {
            case "apply":
                void doMarkApplied(action.payload);
                break;
            case "gate":
                void replayApplyGate(action.payload);
                break;
            case "upload":
                setImportOpen(true);
                break;
        }
        // doMarkApplied / replayApplyGate read no changing
        // component state (only stable setters + the action payload), so
        // capturing the first render's closures here is safe — keep a
        // stable identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Open the auth popover for a freshly-queued action. Resetting `authedRef`
    // here scopes the "success" signal to THIS attempt, so a prior confirmed
    // sign-in can't be mistaken for the new one. Also resets the Job 2 value-
    // line flag — `handleApplyGate` (the only caller that wants it shown)
    // flips it back on immediately after calling this, synchronously in the
    // same handler, so the two writes land as one state update.
    const openAuth = (reason: AuthGateReason | null = null) => {
        authedRef.current = false;
        setAuthGateReason(reason);
        setAuthOpen(true);
    };

    // Fired by AuthPopover on a *successful* sign-in, before it closes. This is
    // the deterministic success signal; mark authed, then attempt the replay.
    const handleAuthed = () => {
        authedRef.current = true;
        maybeReplay();
    };

    // Defensive: if `user` flips truthy after `authedRef` was set but before the
    // direct replay could run (unusual ordering), this still fires it once.
    useEffect(() => {
        if (user) maybeReplay();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    // Guest→auth merge (pursuits + follows + saved searches) — at most once
    // per load; only mark done after every merge succeeds so a failed
    // sign-in sync retries.
    useEffect(() => {
        if (user && !guestPursuitSyncRef.current && !guestSyncInFlightRef.current) {
            guestSyncInFlightRef.current = true;
            const guestPursuitCount = listGuestPursuits().length;
            void (async () => {
                try {
                    const [pursuitsOk, followsOk, savedSearchesOk] = await Promise.all([
                        syncGuestPursuitsToServer(),
                        syncGuestFollowsToServer(),
                        syncGuestSavedSearchesToServer(),
                    ]);
                    if (pursuitsOk && followsOk && savedSearchesOk) {
                        guestPursuitSyncRef.current = true;
                        if (guestPursuitCount > 0) {
                            toast.success(
                                `Synced ${guestPursuitCount} guest role${guestPursuitCount === 1 ? "" : "s"}`,
                            );
                        }
                    }
                } finally {
                    guestSyncInFlightRef.current = false;
                }
            })();
        }
    }, [user]);

    /* ----------------------------- resume-driven actions ----------------------------- */

    // One-time cleanup: the entry gate used to persist the active mode under
    // this key so a reload could skip straight back to it. There is no gate to
    // skip anymore (results render unconditionally), so the key is now dead —
    // remove it for anyone still carrying it from before this change shipped.
    useEffect(() => {
        try {
            localStorage.removeItem("intervu.jobs.entry");
        } catch {
            /* private mode */
        }
    }, []);

    // Which résumé-driven action (if any) should auto-run the moment the
    // résumé importer completes — set BY `handleUploadClick` itself (below),
    // the one chokepoint every /jobs upload entry point routes through, so a
    // future entry point can't forget to wire this (the bug this ref exists
    // to prevent: the upsell card used to call `handleUploadClick` bare, so
    // an upload from THAT entry point queued nothing and silently did
    // nothing on completion). `fitToken` pins the `fitIntentRef` generation
    // at the moment "fit" was queued — see `handleUploadClick`'s doc
    // comment for why. `clearPendingGate` (below) resets it on every
    // alternate path/dismiss, same invariant as `pendingRef`: only the
    // latest intent survives. (A second variant, `{ kind: "explore" }`,
    // existed here through 2026-08-02 — removed with the feature.)
    const resumeActionAfterImportRef = useRef<{ kind: "fit"; fitToken: number } | null>(null);

    // Guards `handleRankByFit`'s async résumé fetch against being superseded
    // by a LATER sort choice (fit again, or any other sort option) made
    // while the fetch is still in flight — see lib/jobs/fit-intent.ts.
    // Instantiated once, mirroring the `paginationRef` idiom below.
    // (review fix, 2026-07-18)
    const fitIntentRef = useRef<FitIntentGuard | null>(null);
    if (!fitIntentRef.current) fitIntentRef.current = new FitIntentGuard();

    // Cancel ANY action queued for after sign-in (apply / gate / upload) so a
    // later, unrelated login can't hijack the user into it or write a
    // phantom application they didn't ask for. Called by every alternate
    // path (results-mode entry, gate choice) and on a dismiss of the
    // popover. (code review, 2026-06-07; pending-state unified + apply/
    // tailor leak closed, 2026-06-08; apply-gate added Job 2, 2026-08-01)
    const clearPendingGate = () => {
        pendingRef.current = clearPending(pendingRef.current);
        resumeActionAfterImportRef.current = null;
    };

    // A usable résumé for a résumé-driven action (fit), fetched on demand.
    // Task 4 removed the mount-time auto-fetch, so `resume` local
    // state can still be empty for a returning user with one saved — check it
    // first (fast path, no network round-trip), else ask the server. Mirrors
    // `resumeIsUsable`'s bar exactly.
    const resolveUsableResume = async (): Promise<ResumeData | null> => {
        if (resume && resumeIsUsable(resume)) return resume;
        const { data } = await fetchResumeData();
        if (data && resumeIsUsable(data)) {
            setResume(data);
            return data;
        }
        return null;
    };

    // Sort menu → "Rank by fit": re-homed from the old Match mode. Same
    // pipeline (`buildMatchQuery` → query + seniority facet), but expressed
    // as `sort=fit` + a dismissible chip instead of a whole-page mode — see
    // `resolveUrlSort` above for why the backend sort stays relevance, not a
    // literal "fit" value.
    const applyFit = (r: ResumeData) => {
        const { q, facets: f } = buildMatchQuery(r);
        setFacets(f);
        setQueryDraft(q);
        setQuery(q);
        setSortOverride(null);
        setFitActive(true);
        applyUrlState(buildUrlState({ q, facets: f, sort: "fit" }), "replace");
    };

    // Dismiss the "Ranked by your résumé" chip — per controller resolution
    // #1, only clears the sort; the résumé-derived query/facets stay as
    // ordinary, independently-editable search state.
    const clearFit = () => {
        setFitActive(false);
        applyUrlState(withSortCleared(buildUrlState()), "replace");
    };

    // Resolve a usable résumé and apply fit if one is found — the guarded
    // core `resolve` callback both `handleRankByFit` (below) and the "My
    // résumé" toolbar control's click (`runResumeControlClick`,
    // lib/jobs/result-state.ts) pass to their own fallback-to-uploader logic
    // when this comes back `false`.
    //
    // `fitIntentRef` guards the await: `resolveUsableResume()` is a network
    // round-trip, and the Select's `onValueChange` bumps the SAME guard for
    // every sort choice (fit or otherwise, see the toolbar JSX below), so a
    // user who picks a different sort — or triggers a fit resolve again —
    // before this resolves gets their newer choice honored instead of a
    // stale, late-arriving fit application clobbering it. (review fix,
    // 2026-07-18)
    //
    // @returns true once handled (fit applied, or superseded by a later
    // choice) — false only when no usable résumé was found, the signal a
    // caller uses to decide whether to fall back to the uploader.
    const resolveAndApplyFit = async (): Promise<boolean> => {
        const token = fitIntentRef.current!.begin();
        const r = await resolveUsableResume();
        if (!fitIntentRef.current!.isCurrent(token)) return true;
        if (r) {
            applyFit(r);
            return true;
        }
        return false;
    };

    // Sort menu → "Rank by fit" click. A résumé already on hand applies
    // immediately; otherwise queue the résumé importer (via the existing
    // `handleUploadClick` upload-gate) and apply fit the moment it completes
    // (see `handleImport`'s `resumeActionAfterImportRef` check).
    const handleRankByFit = async () => {
        const applied = await resolveAndApplyFit();
        if (!applied) handleUploadClick();
    };

    const chooseSort = (mode: JobSortMode) => {
        fitIntentRef.current!.begin();
        setFitActive(false);
        setSortOverride(mode);
        applyUrlState(buildUrlState({ sort: modeToUrlSort(mode) }), "replace");
    };

    const chooseBestMatch = () => {
        fitIntentRef.current!.begin();
        if (!query.trim()) {
            void handleRankByFit();
            return;
        }
        setFitActive(false);
        setSortOverride("relevance");
        applyUrlState(buildUrlState({ sort: "relevance" }), "replace");
    };

    const applySavedSearch = (href: string) => {
        // A saved search IS a full /jobs URL-state write — same chokepoint
        // as every other filter/sort/query mutation above, not a real
        // navigation, so it gets the same shallow (no server round-trip)
        // history write. The reconcile effect below picks up the resulting
        // `searchParams` change and re-derives every local field from it,
        // exactly as it already does for Back/Forward/a typed address bar.
        applyUrlState(jobsUrlStateFromSavedHref(href), "push");
    };

    const canSaveSearch = Boolean(
        query.trim() || activeCount > 0 || fitActive || sortOverride || board || companyDomain,
    );

    // Task 11 review fix — the tombstone's "similar roles" CTA clears the
    // job selection (local state + URL) before dropping back to a plain
    // browse: the common dead link is a bare `/?job=<id>` with no query, so
    // without this, `job=<dead-id>` would still be the URL's `job` param
    // after the CTA fires, the still-present dead id would re-trigger the
    // existence-check candidacy, and the tombstone would re-assert itself
    // over the fresh browse. Used to branch into "Explore" (résumé-driven
    // AI-suggested adjacent roles) when a usable résumé was on hand —
    // removed 2026-08-02 (MCP handoff); this is now always the plain,
    // ungated browse it used to degrade to.
    const handleTombstoneSimilarRoles = () => {
        setSelectedId(null);
        enterBrowseAndSync({ jobId: null });
    };

    const enterBrowse = () => {
        clearPendingGate();
        setFacets({});
        setQuery("");
    };

    // `enterBrowse()` only touches LOCAL state — every caller that means to
    // abandon a non-default query/facets (the tombstone's fallback above)
    // pairs it with the SAME explicit `q`/`facets` URL override, so the
    // address bar can't lag behind local state (the closure-staleness class
    // `handleTombstoneSimilarRoles` used to hit before this was extracted —
    // see the CTA-ordering review-fix history on that function). `overrides`
    // lets the tombstone also clear `jobId`.
    const enterBrowseAndSync = (overrides: Partial<JobsUrlState> = {}) => {
        enterBrowse();
        applyUrlState(buildUrlState({ q: "", facets: {}, ...overrides }), "replace");
    };

    // THE single entry point for opening the résumé importer from this page —
    // every caller (sort menu "Rank by fit", the upsell card's "Upload
    // résumé", any future one) must go through this, not `setImportOpen(true)`
    // directly, because this is also the one place that queues
    // `resumeActionAfterImportRef` — what `handleImport` (below) runs once
    // the upload actually completes. Bug this fixes: the upsell card used to
    // call `handleUploadClick` bare with no follow-up wiring, so an upload
    // started FROM the card queued nothing — the modal closed and nothing
    // visibly happened, no re-rank, no chip (user-reported). Product
    // contract: ANY upload initiated from /jobs ends in ranked results, not
    // a silent no-op — every caller gets that for free, so a future entry
    // point can't forget it by construction.
    //
    // `clearPendingGate()` runs FIRST (it zeroes this same ref), so the
    // queue write below has to come after it, not before.
    //
    // `fitIntentRef.current!.begin()` pins the CURRENT guard generation into
    // the queued continuation (`fitToken`) — `handleImport` checks it's
    // still current before applying. Without this, a sort choice made WHILE
    // the upload modal is still open (which bumps this same guard — see the
    // Select's `onValueChange` below — but does NOT clear this ref) would
    // get silently clobbered once the upload finally completes, minutes
    // later.
    const handleUploadClick = () => {
        if (user && shouldPromptSearchPrefsInsteadOfResume(resumeOnFile, agentSearchPrefsSet)) {
            setSearchPrefsDialogOpen(true);
            return;
        }
        clearPendingGate();
        resumeActionAfterImportRef.current = { kind: "fit", fitToken: fitIntentRef.current!.begin() };
        if (!user) {
            pendingRef.current = queuePending(pendingRef.current, { kind: "upload", payload: true });
            openAuth("generic");
            return;
        }
        setImportOpen(true);
    };

    const handleSearchPrefsComplete = (values: SearchPrefsValues) => {
        applySavedSearchPrefs(values);
    };

    const handleSearchPrefsAddResume = () => {
        clearPendingGate();
        resumeActionAfterImportRef.current = { kind: "fit", fitToken: fitIntentRef.current!.begin() };
        setImportOpen(true);
    };

    // "My résumé" toolbar control's click (JSX below). Deliberately does NOT
    // trust the control's own rendered STYLE to pick the branch — `resumeOnFile`
    // is tri-state, and while it's `null` ("not known yet") the control still
    // renders muted, but a click in that window is exactly the class of user
    // this whole change is FOR: skipping the resolve there would ask a
    // returning user with a résumé already on file to "upload" one again,
    // just narrowed to the few hundred ms before the presence check lands.
    // `runResumeControlClick` (lib/jobs/result-state.ts) decides on the
    // TRUTH of `resumeOnFile` instead: only a KNOWN-absent résumé (`false`)
    // skips straight to `handleUploadClick`; `true` or `null` always try
    // `resolveAndApplyFit` first and fall back to the uploader only if that
    // genuinely comes back empty — never a dead click, never a needless
    // reopen of the importer for a résumé that was there the whole time.
    const handleMyResumeClick = () => {
        void runResumeControlClick(resumeOnFile, resolveAndApplyFit, handleUploadClick);
    };

    const handleImport = (data: ResumeData, source: "pdf" | "docx" | "text", confidence: number) => {
        setResume(data);
        setImportOpen(false);
        // Persist to the profile so returning users skip the upload step (best-effort).
        void saveResumeData(data, source, confidence).catch(() => {});
        // `handleUploadClick` queued this because no usable résumé was on
        // hand yet — finish what they asked for now that one exists.
        const queuedAction = resumeActionAfterImportRef.current;
        resumeActionAfterImportRef.current = null;
        if (queuedAction?.kind === "fit") {
            // Stale-guard check (see `handleUploadClick`'s doc comment): a
            // sort choice made while the modal was open must win, not this.
            if (fitIntentRef.current!.isCurrent(queuedAction.fitToken)) applyFit(data);
        }
    };


    const notConnected = result != null && !result.configured && result.backend === "unconfigured";
    const blockingError = searchError != null && hits.length === 0;
    const backgroundError = searchError != null && hits.length > 0;

    // The ONE decision behind what the results pane renders (see
    // `resolveJobsResultsPanel`) — used to also gate a standalone pivot seed
    // row above the pane; that row is gone (2026-08-15, ITEM H), its job
    // folded into the search box's own "Popular searches" dropdown.
    const resultsPanel = resolveJobsResultsPanel({
        isSerpAsk,
        notConnected,
        blockingError,
        loading,
        hitCount: hits.length,
    });

    // SERP-ask's tappable seeds — recent searches first, then the curated
    // fallback list, deduped to ~8 (lib/jobs/recent-searches.ts,
    // unit-tested). Cheap and pure, so computed unconditionally rather than
    // gated on `isSerpAsk` — matches this file's other render-prep consts.
    const searchSeeds = resolveSearchSeeds(recentSearches);

    const searchPlaceholder = "What kind of work are you looking for?";

    const mobileLocationLabel = locationTriggerLabel(filterState, {
        defaultedIso2: result?.defaultedLocation,
        locationDefaultSuppressed,
        detectedName: result?.defaultedLocation ? regionDisplayName(result.defaultedLocation) : undefined,
        detectedOptedIn,
    });
    // The category chip whose search query matches the current COMMITTED query
    // (case-insensitive) AND whose text also matches the draft (i.e. the user
    // has not yet typed something different in the search box without
    // submitting). Both guards are necessary: `query` alone would leave the
    // chip highlighted while the user is mid-edit typing an unrelated term,
    // which is the exact ambiguity the "active chip only when committed query
    // matches" rule exists to prevent (req 4). When non-null, "Searching:
    // [title]" renders near the chips row to bridge the gap between the short
    // domain label (e.g. "HEALTHCARE") and the underlying search query (e.g.
    // "Registered Nurse").
    const activeCategory = useMemo(
        () =>
            indexCategories.find(
                (c) =>
                    c.q.toLowerCase() === query.toLowerCase() &&
                    c.q.toLowerCase() === queryDraft.toLowerCase(),
            ) ?? null,
        [query, queryDraft],
    );    const mobilePrimaryCtaLabel = showLandingMarketing && !query.trim() ? "Show jobs" : "Search";

    const handleMobilePrimaryCta = () => {
        if (showLandingMarketing && !queryDraft.trim()) {
            setMobileResultsEngaged(true);
            return;
        }
        submitSearch(queryDraft);
    };

    // The one grey line under the pinned box. It states the posted-date window
    // out loud because the redesigned route offers no control that reveals it
    // — see `searchResultLine` (lib/jobs/presentation.ts) for why an unnamed
    // window makes the count quietly wrong.
    //
    // Suppressed when the relaxed pass is showing (`widened`): its total counts
    // word-dropped partial matches — printing it would caption close-match
    // results with a number describing a different, looser query. The Screen 4
    // sentence carries that state instead.
    const resultCountLine =
        result?.configured && !loading && !result.widened
            ? searchResultLine({ count: totalCount, postedBucket, lastUpdated, nowMs })
            : null;

    // "N more beyond 30 days — show all" affordance (2026-08-12) — gated on
    // `resultCountLine` being present (not `resultsCountLabel`, which also
    // covers the background-refresh "updating…" state) so the affordance
    // can never appear before the FIRST real result for the active filters
    // has landed — `totalCount` defaults to an exact zero before that,
    // which would otherwise let `resolveBeyondWindow` render a spurious
    // number the moment `beyondWindowCount` resolves ahead of `totalCount`.
    const beyondWindow = resultCountLine
        ? resolveBeyondWindow(postedBucket, totalCount, beyondWindowCount)
        : { show: false, extra: null };
    const beyondWindowText =
        beyondWindow.extra !== null
            ? `${beyondWindow.extra.toLocaleString()} more beyond 30 days`
            : "more roles beyond 30 days";

    // Deliverable 1 — results render normally on a degraded (served-from-cache)
    // response; this is just the honest caption for it. See
    // `degradedResultsNote` (result-state.ts) for what `meta.degraded` means
    // and why an absent `meta` reads as live, never as degraded.
    const degradedNote = result ? degradedResultsNote(result) : null;

    // Two-Panel Selector (master-detail) — single source of truth for where
    // the shared detail ternary mounts (Sheet below xl, pane at xl+, and —
    // 2026-08-14 auto-preview — the pane again for the ambient first result
    // when nothing is explicitly open; see resolveDetailMountSite's doc
    // comment for the render-only/telemetry contract).
    const detailMountSite = resolveDetailMountSite(isXlUp, detailSheetOpen, hits.length > 0);
    // The row the pane is currently showing — explicit selection when one
    // exists, else the ambient auto-preview. Drives the list's active ring
    // so the highlighted row and the pane's content can never disagree.
    const activeRowId = detailMountSite === "pane" ? (detailJob?.id ?? null) : selectedId;

    // Deliverable 3 — one `JobCard` call site shared by a cluster's primary
    // row and its (optionally rendered) variant rows below, so the ~10 props
    // every card needs are written once, not copy-pasted per call site.
    // `clusterProps` is omitted entirely for a variant row — variants never
    // carry their own "+N locations" affordance, only the primary does.
    const renderJobRow = (
        j: PublicJob,
        clusterProps?: { variantCount: number; expanded: boolean; onToggleExpand: () => void },
    ) => (
        <JobCard
            key={j.id}
            job={j}
            active={activeRowId === j.id}
            opened={openedIds.has(j.id)}
            onClick={() => openJob(j.id)}
            onCompany={j.company_domain ? handleCompany : undefined}
            onOpenPosting={handleOpenPosting}
            now={nowMs}
            elite={board === "elite"}
            variantCount={clusterProps?.variantCount ?? 0}
            expanded={clusterProps?.expanded ?? false}
            onToggleExpand={clusterProps?.onToggleExpand}
        />
    );

    const handleClearSearch = () => {
        setQueryDraft("");
        setQuery("");
        setLocationDraft("");
        applyUrlState(buildUrlState({ q: "" }), "replace");
        const nextFacets = { ...filterState.facets };
        delete nextFacets.location_country;
        if (Object.keys(nextFacets).length !== Object.keys(filterState.facets).length) {
            applyFilterState({ ...filterState, facets: nextFacets });
        }
    };

    // Display-only extension of `resultCountLine` — never `resultCountLine`
    // itself, which also gates the "beyond window" affordance above and is a
    // locked pure-function contract shared with /co (searchResultLine,
    // lib/jobs/presentation.ts). One factual clause, reusing the "ghost
    // screen"/"may no longer be live" vocabulary `GHOST_META.likely_ghost`
    // already uses per-row (lib/jobs/presentation.ts) — stated once for the
    // whole result set rather than implied by a badge on every row.
    const resultsCountLabel = resultCountLine
        ? `${resultCountLine} · screened for postings that may no longer be live`
        : resultCountLine;

    // The detail ternary (real job / dead-job tombstone / unresolved /
    // loading skeleton) both mount sites render — extracted so the xl+ pane
    // can never silently drift from the sheet's own branches (writing-lean-
    // code rule 2, single source of truth). `onClose` is passed explicitly
    // by each call site (both currently `() => router.back()`) rather than
    // hardcoded here, keeping this decoupled from the router.
    //
    // `collapseDescription` defaults true (JobDetail's own default, unchanged
    // desktop behaviour) — the mobile bottom sheet call site below passes
    // `false`: that Sheet already owns an `overflow-y-auto` scroller
    // (:4107-ish, `overscroll-y-contain`), so JobDetail's own 20rem clamp was
    // hiding nearly every real description behind a click one scroller
    // *inside* an already-scrollable sheet (2026-08-18, mobile detail-scroll
    // fix part 2).
    const renderDetailSurface = (onClose: (() => void) | undefined, collapseDescription = true) =>
        detailJob ? (
            <>
                <JobDetail
                    key={detailJob.id}
                    job={detailJob}
                    now={nowMs}
                    signedIn={Boolean(user)}
                    onRequestSignIn={() => openAuth("generic")}
                    onOpenPosting={() => handleOpenPosting(detailJob)}
                    onGoAfter={() => handleGoAfter(detailJob)}
                    onOpenRelated={openJob}
                    variants={detailVariants}
                    pursuit={detailPursuit}
                    goingAfter={goingAfterId === detailJob.id}
                    onClose={onClose}
                    reportJobEnabled={reportJobEnabled}
                    collapseDescription={collapseDescription}
                    className="border-0 bg-transparent shadow-none"
                />
                {/* Rendered for guests too (founder call, 2026-08-15). /jobs is the
                    SEO front door, so most first-time readers arrive signed out —
                    and the inline Apply button scrolls out of view, leaving them
                    with no persistent CTA. `signedIn={false}` is the state this
                    component was already built for: the label reads "Sign in to
                    apply", and handleOpenPosting gates at resolveApplyGateDecision
                    (:2282) before any ATS departure, so the label never
                    over-promises what the tap delivers. */}
                <JobDetailActionBar
                    job={detailJob}
                    signedIn={Boolean(user)}
                    onOpenPosting={() => handleOpenPosting(detailJob)}
                />
            </>
        ) : isDeadJobConfirmed ? (
            <div className="p-4">
                <DeadJobTombstone onSimilarRoles={handleTombstoneSimilarRoles} />
            </div>
        ) : showUnresolvedDetail ? (
            <div className="p-4">
                <DeadJobUnresolved
                    onSimilarRoles={handleTombstoneSimilarRoles}
                    checking={isDeadJobChecking}
                />
            </div>
        ) : loading ? (
            <div className="p-4">
                <JobDetailSkeleton />
            </div>
        ) : null;

    // G5b (Grok UX wave): the filters panel's own content, shared verbatim
    // between the desktop inline expand and the mobile Sheet below — one
    // SerpFilters render, not two copies that could drift on props.
    const filtersPanelContent = (
        <>
            {result?.configured && (
                <div role="group" aria-label="Sort" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 lg:hidden">
                    {postedDateSupported && (
                        <SortSegment
                            label="freshest"
                            pressed={!fitActive && effectiveSort === "newest"}
                            onClick={() => chooseSort("newest")}
                        />
                    )}
                    <SortSegment
                        label="top pay"
                        pressed={!fitActive && effectiveSort === "salary_desc"}
                        onClick={() => chooseSort("salary_desc")}
                    />
                    <SortSegment
                        label="best match"
                        pressed={fitActive || (!fitActive && effectiveSort === "relevance" && !!query.trim())}
                        onClick={chooseBestMatch}
                    />
                </div>
            )}
            <SerpFilters
                distribution={result?.facetDistribution}
                resultTotal={result?.total}
                postedDateSupported={postedDateSupported}
                state={filterState}
                activeCount={activeCount}
                onToggleFacet={panelToggleFacet}
                onSalaryMin={panelSalaryMin}
                onVisaOnly={panelVisaOnly}
                onPostedBucket={panelPostedBucket}
                onClearAll={panelClearAll}
                hideGhosts={hideGhosts}
                onHideGhosts={onHideGhosts}
                ghostHiddenCount={ghostHiddenCount}
                board={board === "elite" ? "elite" : "all"}
                onBoardChange={(b) => onBoardChange(b === "elite" ? "elite" : null)}
            />
        </>
    );

    /**
     * `/jobs` renders one layout, not two: the search line, filter toggle,
     * and result count stay mounted whether the query is empty
     * (`isSerpAsk` — tappable search seeds, chrome preserved) or has
     * results. The full-screen automation-first hero lives on `/`
     * (`src/app/page.tsx`), not on this route.
     */
    return (
        <div
            className="min-h-screen"
            style={{
                // Was a literal rgba(16, 149, 106, …) — the retired emerald
                // --brand, frozen into the page wash where no theme could
                // reach it. Reads the token now, so the wash follows the
                // accent through light/dark instead of tinting the whole
                // results page a colour the palette had dropped.
                background:
                    "radial-gradient(ellipse 80% 40% at 50% -10%, rgb(var(--brand) / 0.12), transparent 70%), rgb(var(--background))",
            }}
        >
            <main className="mx-auto flex min-h-screen w-full max-w-6xl xl:max-w-7xl flex-col px-4 pb-20 pt-2 sm:px-8 sm:pt-3 xl:px-10">
                <a
                    href="#jobs-results-list"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:border focus:border-foreground focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
                >
                    Skip to results
                </a>

                {/* Landing masthead — ABOVE the search line, and NON-DESTRUCTIVE.
                    It stays mounted always; running a search collapses its row
                    to 0fr, so the search box travels up into the space it
                    vacates instead of the page swapping one layout for another.
                    That keeps the input's value, caret and focus intact across
                    the transition (a remount would drop all three mid-keystroke),
                    and clearing the query plays the same move in reverse.
                    `grid-rows-[0fr]→[1fr]` is the collapse idiom already used in
                    components/layout/Header.tsx; `motion-reduce` opts out because
                    globals.css' reduced-motion block is class-scoped, not blanket.
                    Safe to leave in the tree while collapsed only because
                    `LandingMasthead` holds no focusable node — see its doc. */}
                <div
                    aria-hidden={!showLandingMarketing}
                    data-landing-masthead={showLandingMarketing ? "open" : "collapsed"}
                    className={cn(
                        "grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none",
                        showLandingMarketing ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                >
                    <div className="min-h-0 overflow-hidden">
                        <LandingMasthead claim={marketClaim} />
                    </div>
                </div>

                {/* `glass-panel-raised` marks this as the page's focal surface.
                    Plain `glass-panel` left the search line indistinguishable
                    from the page behind it — see the class' note in globals.css.
                    This is the only raised surface on /jobs; if another one is
                    ever added here, neither will read as the primary action. */}
                <section className="rounded-none glass-panel glass-panel-raised p-2 sm:p-2.5 transition-colors">
                    <div data-search-line className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2.5">
                        {/* `bg-card`, not `bg-background`: inside the raised well
                            the field has to be the brightest thing on the page,
                            which is the only direction contrast can go on a
                            light ground. */}
                        <div className="flex flex-col rounded-none border border-border bg-card divide-y divide-border focus-within:border-foreground focus-within:ring-1 focus-within:ring-foreground sm:flex-1 sm:flex-row sm:divide-y-0 sm:divide-x">
                            <div className="relative flex min-w-0 w-full sm:flex-1 items-center">
                                <SearchAutocomplete
                                    ref={searchAutocompleteRef}
                                    value={queryDraft}
                                    onChange={(v) => {
                                        setQueryDraft(v);
                                    }}
                                    onSearch={() => submitSearch(queryDraft)}
                                    suggest={suggestForBox}
                                    seeds={searchSeeds}
                                    placeholder={searchPlaceholder}
                                    leadingIcon={<MagnifyingGlass size={16} weight="bold" />}
                                    className="h-11 sm:h-[46px] w-full min-w-0 rounded-none border-0 bg-transparent px-3 text-base md:text-sm text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:border-0 pr-8"
                                    containerClassName="min-w-0 w-full"
                                />
                                {/* NOT `results-clear-query` — that is the toolbar's
                                    "✕ clear search", which also drops the location draft
                                    and the location_country facet. This one empties the
                                    field and re-runs, nothing else. Two behaviours behind
                                    one testid made either selector ambiguous. */}
                                {queryDraft && (
                                    <button
                                        type="button"
                                        data-testid="search-input-clear"
                                        aria-label="Clear query"
                                        onClick={() => {
                                            setQueryDraft("");
                                            submitSearch("");
                                        }}
                                        className="absolute right-1.5 flex h-10 w-10 items-center justify-center rounded-none glass-tint-muted text-muted-foreground hover:text-foreground text-xs z-10 lg:right-2.5 lg:h-6 lg:w-6"
                                        title="Clear query"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                            {/* Glyph as a row sibling, not an absolute overlay +
                                `pl-*` on the field — same reason as
                                SearchAutocomplete's (see its doc comment): padding
                                is a shared tailwind-merge axis and an overlay only
                                stays clear of the text while nobody touches it. */}
                            <div className="relative flex w-full items-center sm:max-w-[210px] sm:flex-[0_1_210px]">
                                <span aria-hidden className="pointer-events-none flex shrink-0 items-center pl-3.5 text-muted-foreground/70">
                                    <MapPin size={16} weight="bold" />
                                </span>
                                <button
                                    type="button"
                                    data-testid="location-picker-trigger"
                                    onClick={() => setLocationSheetOpen(true)}
                                    className="flex h-11 min-w-0 flex-1 items-center truncate rounded-none border-0 bg-transparent px-3 text-left text-base text-foreground lg:hidden"
                                >
                                    <span className={cn("truncate", mobileLocationLabel === "City, state, or remote" && "text-muted-foreground/70")}>
                                        {mobileLocationLabel}
                                    </span>
                                </button>
                                <Input
                                    data-testid="location-input"
                                    type="text"
                                    placeholder="City, state, or remote"
                                    value={locationDraft}
                                    onChange={(e) => setLocationDraft(e.target.value)}
                                    onBlur={commitLocation}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            commitLocation();
                                        }
                                    }}
                                    className="hidden h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-base text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:border-0 focus-visible:ring-0 lg:flex sm:h-[46px] md:text-sm"
                                />
                            </div>
                        </div>
                        <div className={cn(
                            "hidden flex-wrap items-center gap-2",
                            // The sticky mobile-search-cta handles all search actions below
                            // lg — pristine landing, mid-search, and post-results states.
                            // Show inline Search only at lg+ so the two CTAs never coexist.
                            "lg:flex",
                        )}>                            <Button
                                type="button"
                                onClick={() => submitSearch(queryDraft)}
                                className="h-11 sm:h-[46px] w-full rounded-none bg-foreground px-6 text-xs font-bold uppercase tracking-wider text-background hover:bg-foreground/90 sm:w-auto transition-colors"
                            >
                                Search
                            </Button>
                        </div>
                    </div>

                    {/* Category & Filter Dropdowns */}
                    {!showLandingMarketing && (
                        <div className="mt-2.5 flex items-center gap-2 border-t border-border/70 pt-2 lg:mt-2 lg:pt-1.5">
                            {/* Field dropdown — radio-like, REPLACE query on click */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            "inline-flex h-9 items-center gap-1.5 rounded-none border px-3 text-[12px] uppercase tracking-wide transition-colors",
                                            activeCategory
                                                ? "border-foreground bg-foreground text-background font-bold"
                                                : "border-border/80 bg-background/50 text-muted-foreground hover:border-foreground hover:text-foreground"
                                        )}
                                    >
                                        {activeCategory ? activeCategory.domain : "Browse by field"}
                                        <CaretDown size={10} weight="bold" aria-hidden />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="min-w-[180px]">
                                    {indexCategories.map((cat) => {
                                        const isMatch =
                                            query.toLowerCase() === cat.q.toLowerCase() &&
                                            queryDraft.toLowerCase() === cat.q.toLowerCase();
                                        return (
                                            <DropdownMenuItem
                                                key={cat.num}
                                                onSelect={() => submitSearch(cat.q)}
                                                className="flex items-center justify-between gap-3 text-[12px] uppercase tracking-wide"
                                            >
                                                <span>{cat.domain}</span>
                                                {isMatch && <Check size={12} weight="bold" aria-hidden />}
                                            </DropdownMenuItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>

                        </div>
                    )}
                    {/* Active-category indicator: the chip label (e.g. "HEALTHCARE")
                        is a short domain tag; the query it runs (e.g. "Registered Nurse")
                        is what actually appears in the search box. Without this, the
                        connection between the highlighted chip and the search bar text is
                        opaque. Clicking a category REPLACES the query (radio-like), unlike
                        the filter toggles to its right which AND onto existing results.
                        `handleClearSearch` is the same path the "✕ clear search" toolbar
                        button uses — reused, not a third clear path. */}
                    {!showLandingMarketing && (activeCategory || canSaveSearch) && (
                        <div
                            data-testid="active-category-indicator"
                            className="mt-1 flex min-h-[2.75rem] flex-wrap items-center gap-1.5 px-0.5 text-[13px] text-muted-foreground sm:min-h-0"
                        >
                            {activeCategory && (
                                <>
                                    <span className="font-semibold uppercase tracking-wider text-foreground">
                                        Searching:
                                    </span>
                                    <span>{activeCategory.title}</span>
                                    <span aria-hidden className="text-border">·</span>
                                    <button
                                        type="button"
                                        onClick={handleClearSearch}
                                        className="-my-1.5 py-1.5 underline underline-offset-2 transition-colors hover:text-foreground"
                                    >
                                        clear ✕
                                    </button>
                                    {canSaveSearch && <span aria-hidden className="text-border">·</span>}
                                </>
                            )}
                            {canSaveSearch && (
                                <SavedSearchesPanel
                                    saved={savedSearches}
                                    urlState={buildUrlState()}
                                    canSave={canSaveSearch}
                                    onApply={applySavedSearch}
                                    onBeforeGuestSave={!user ? handleBeforeGuestSavedSearch : undefined}
                                    compact
                                />                            )}
                        </div>
                    )}
                </section>

                {!showLandingMarketing && (
                    <FilterChipsRow
                        state={filterState}
                        distribution={result?.facetDistribution}
                        activeCount={activeCount}
                        onPostedBucket={panelPostedBucket}
                        onToggleFacet={panelToggleFacet}
                        onSalaryMin={panelSalaryMin}
                        onOpenSheet={() => setFiltersOpen(true)}
                        postedDateSupported={postedDateSupported}
                    />
                )}
                <section
                    data-testid="jobs-toolbar"
                    className="mt-3 border-y border-border/50 bg-muted/[0.14] py-2 lg:px-0.5 lg:py-1.5"
                >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2.5 lg:gap-x-3 lg:gap-y-2">
                        {!showLandingMarketing && (
                            <FacetBar
                                distribution={result?.facetDistribution}
                                state={filterState}
                                postedDateSupported={postedDateSupported}
                                onToggleFacet={panelToggleFacet}
                                onSalaryMin={panelSalaryMin}
                                onPostedBucket={panelPostedBucket}
                            />
                        )}                        <button
                            type="button"
                            data-testid="filters-toggle"
                            aria-expanded={filtersOpen}
                            aria-haspopup="true"
                            aria-controls="filters-panel"
                            onClick={() => setFiltersOpen((v) => !v)}
                            className={cn(
                                chipVariants({ active: filtersOpen || activeCount > 0 }),
                                "h-11 px-3.5 rounded-none font-semibold text-foreground inline-flex items-center gap-1.5 text-[13px] transition-colors lg:h-9 lg:px-3 lg:text-[11px]",
                                filtersOpen && "border-foreground bg-foreground text-background ring-1 ring-foreground hover:border-foreground hover:bg-foreground",
                                activeCount > 0 && "has-active",
                            )}
                        >
                            <FunnelSimple size={14} weight="bold" aria-hidden />
                            <span className="lg:hidden">Filters</span>
                            <span className="hidden lg:inline">All filters</span>
                            {activeCount > 0 && (
                                <span className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-none border border-brand/40 bg-brand/10 px-1 text-[10px] font-bold leading-[16px] text-brand">
                                    {activeCount}
                                </span>
                            )}
                            {filtersOpen ? <CaretUp size={12} weight="bold" aria-hidden /> : <CaretDown size={12} weight="bold" aria-hidden />}
                        </button>
                        {/* Résumé toolbar control — sits next to Filters.
                            Label is context-aware: "Add résumé" when `resumeOnFile` is false
                            or null (uploader on click); "My résumé" when it is true (rank-by-fit
                            on click). Hidden once fit is already active — the
                            "ranked by your résumé ✕" chip owns that role. */}                        {resumeControlState !== "hidden" && (
                            <button
                                type="button"
                                onClick={() => handleMyResumeClick()}
                                data-testid="jobs-my-resume"
                                title={
                                    resumeControlState === "active"
                                        ? "Rank jobs by your résumé"
                                        : "Upload a résumé to personalize results"                                }
                                aria-label={
                                    resumeControlState === "active"
                                        ? "My résumé — rank jobs by fit"
                                        : "Add résumé — upload one to personalize results"                                }
                                className={cn(
                                    chipVariants({ active: resumeControlState === "active" }),
                                    toolbarChipClass,
                                )}
                            >
                                {resumeControlState === "active" ? "My résumé" : "Add résumé"}                            </button>
                        )}
                        {!showLandingMarketing && (
                        <>
                        {/* ITEM I (2026-08-15): moved here from the search row (was a
                            flex sibling between the location input and Search button).
                            It's filter state (suppressible, affects the fetched set),
                            so it belongs beside the other filter controls, not sitting
                            in the input line eating horizontal space from the fields
                            around it. Same component/props, same `flex-wrap` row, so
                            it wraps below on narrow widths like every other chip here
                            instead of overflowing. */}
                        {shouldShowLocationDefaultChip(result?.defaultedLocation, locationDraft) && (
                            <DefaultLocationChip iso2={result!.defaultedLocation!} onClear={suppressLocationDefault} />
                        )}
                        {fitActive && (
                            <button
                                type="button"
                                onClick={clearFit}
                                className={cn(chipVariants({ active: true }), toolbarChipClass)}
                            >
                                ranked by your résumé ✕
                            </button>
                        )}
                        {trackedCount > 0 && (
                            <Link
                                href="/yours"
                                data-testid="jobs-tracked-count"
                                className={cn(chipVariants({ active: false }), toolbarChipClass)}
                            >
                                {trackedCount} tracked
                            </Link>
                        )}
                        {unnamedEntries.map((entry) => (
                            <span
                                key={entry.key}
                                data-testid="active-filter-chip"
                                className={cn(chipVariants({ active: false }), "mono-data h-11 gap-1.5 px-3 text-[12px] lg:h-7 lg:px-2")}
                            >
                                {chipLabelForEntry(entry)}
                                <ChipDismiss
                                    label={`Clear ${chipLabelForEntry(entry)}`}
                                    onClick={() => applyFilterState(entry.clear(filterState))}
                                />
                            </span>
                        ))}
                        {activeCount > 0 && (
                            <button
                                type="button"
                                data-testid="results-clear-filters"
                                onClick={panelClearAll}
                                className={cn(
                                    chipVariants({ active: false }),
                                    toolbarChipClass,
                                    "font-bold text-brand hover:text-brand",
                                )}
                            >
                                Clear filters ({activeCount})
                            </button>
                        )}
                        {query.trim() && (
                            <button
                                type="button"
                                data-testid="results-clear-query"
                                onClick={handleClearSearch}
                                className={cn(chipVariants({ active: false }), toolbarChipClass)}
                            >
                                ✕ clear search
                            </button>
                        )}
                        </>
                        )}
                        {result?.configured && (
                            <div
                                role="group"
                                aria-label="Sort"
                                className="ml-auto hidden items-center rounded-none border border-border/80 bg-muted/40 p-0.5 lg:flex"
                            >
                                {postedDateSupported && (
                                    <SortSegment
                                        label="freshest"
                                        pressed={!fitActive && effectiveSort === "newest"}
                                        onClick={() => chooseSort("newest")}
                                    />
                                )}
                                <SortSegment
                                    label="top pay"
                                    pressed={!fitActive && effectiveSort === "salary_desc"}
                                    onClick={() => chooseSort("salary_desc")}
                                />
                                <SortSegment
                                    label="best match"
                                    pressed={
                                        fitActive || (!fitActive && effectiveSort === "relevance" && !!query.trim())
                                    }
                                    onClick={chooseBestMatch}
                                />
                            </div>
                        )}
                    </div>

                    {filtersOpen && (isLgUp ? (
                        <div
                            id="filters-panel"
                            data-testid="filters-panel"
                            className="panel-enter mt-3 max-h-[min(62dvh,520px)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-300/80 bg-card p-4 text-foreground custom-scrollbar shadow-md dark:border-slate-700"
                        >
                            {filtersPanelContent}
                        </div>
                    ) : (
                        // G5b (Grok UX wave): below `lg`, filters present in the
                        // SAME Sheet primitive the job detail panel uses (reused,
                        // not a second bottom-sheet implementation) — desktop's
                        // inline expand above is unchanged.
                        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                            <SheetContent
                                side="bottom"
                                className="mx-auto max-h-[85dvh] w-full max-w-[720px] overflow-hidden rounded-t-[18px] border-border p-0"
                            >
                                <SheetTitle className="sr-only">Filters</SheetTitle>
                                <div
                                    id="filters-panel"
                                    data-testid="filters-panel"
                                    className="max-h-[85dvh] overflow-y-auto overscroll-contain bg-card p-4 pb-[env(safe-area-inset-bottom,16px)] text-foreground custom-scrollbar"
                                >
                                    {filtersPanelContent}
                                </div>
                            </SheetContent>
                        </Sheet>
                    ))}
                </section>

                <div className={cn(
                    "mt-4 flex min-h-0 flex-1 flex-col",
                    !isPristineLanding && "xl:grid xl:grid-cols-[minmax(0,37%)_minmax(0,63%)] xl:gap-6"
                )}>
                    {/* Two-Panel Selector (master-detail) detail pane, xl+
                        only. Placed BEFORE the list column in source order —
                        the pane's JSX is full of buttons (JobDetail's own ×,
                        apply, related-role links) and
                        tests/unit/jobs-list-tail.test.ts's structural guard
                        asserts no interactive markup appears between the
                        ListTail element and the closing main tag; putting
                        the pane here keeps that span clean without touching
                        a locked test.
                        `xl:order-2` puts it on the right visually (the list
                        column below keeps the default order-0, so it sorts
                        first). `hidden` below xl reproduces today's
                        sheet-only behavior byte-for-byte — this box simply
                        isn't in the layout at all under 1280px. */}
                    {!isPristineLanding && (
                        <div
                            data-testid="detail-pane"
                            className="hidden xl:order-2 xl:block xl:sticky xl:top-[72px] xl:max-h-[calc(100dvh-88px)] xl:min-w-0 xl:overflow-y-auto xl:rounded-none xl:border xl:border-border xl:bg-card/75 xl:backdrop-blur-xl xl:backdrop-saturate-150 detail-pane-raised custom-scrollbar"
                        >
                            {detailMountSite === "pane" ? (
                                renderDetailSurface(detailSheetOpen ? () => router.back() : undefined)
                            ) : loading ? (
                                <div className="p-4">
                                    <JobDetailSkeleton />
                                </div>
                            ) : (
                                <p className="p-6 text-[13px] text-muted-foreground" data-testid="detail-pane-placeholder">
                                    Select a role to read it here.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex min-h-0 flex-1 flex-col xl:min-w-0">
                        {showLandingMarketing && user && !agentSearchPrefsSet && (
                            <div className="mb-6">
                                <Button
                                    variant="outline"
                                    type="button"
                                    onClick={() => setSearchPrefsDialogOpen(true)}
                                    className="rounded-none border-border/80 text-[13px] font-medium"
                                >
                                    Set up search preferences
                                </Button>
                            </div>
                        )}
                        <div
                            className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                showLandingMarketing && !isLgUp && "hidden",
                            )}
                            aria-hidden={showLandingMarketing && !isLgUp}                        >
                            <>
                                <BoardVisitBanner />

                                {/* Post-first-save upsell — appears once the anonymous visitor
                                    has made their first save (Go after or saved search). Calm
                                    inline style matching `showPersonalizationInvite`. Dismissed
                                    state is persisted so the banner doesn't reappear on reload.
                                    Signed-in users never see it (`showGuestSaveBanner` is false
                                    whenever `user` is truthy). */}
                                {showGuestSaveBanner && (
                                    <div
                                        data-testid="guest-save-banner"
                                        className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-4 pb-2 text-[13.5px] text-muted-foreground"
                                    >
                                        <span>Sign in to keep this list across devices and get alerts when new roles match —</span>
                                        <button
                                            type="button"
                                            onClick={() => openAuth("save")}
                                            className="text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70"
                                        >
                                            sign in
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDismissGuestSaveBanner}
                                            className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                        >
                                            not now
                                        </button>
                                    </div>
                                )}

                        {/* Screen 4 — the relaxed pass. `widened` now means the STRICT
                            whole-document pass matched nothing and the engine fell back
                            to word-dropping (`shouldRelaxSearch`, lib/jobs/meilisearch.ts).
                            One honest sentence says so; the count line is suppressed for
                            this state (see `resultCountLine`) because the relaxed total
                            counts word-dropped matches — a number that doesn't describe
                            the query the user actually typed. */}
                        {hasFollows && (
                            <FollowAlertsCard
                                follows={follows}
                                nowMs={nowMs}
                                board={board}
                                onViewAll={() => onBoardChange("elite")}
                            />
                        )}

                        {!loading && result?.widened && (
                            <p data-testid="widened-note" className="mb-3 text-[13.5px] text-muted-foreground">
                                Nothing matches every word of that — showing the closest matches.
                            </p>
                        )}

                        {!loading && degradedNote && (
                            <p data-testid="degraded-note" className="mb-3 text-[13.5px] text-muted-foreground">
                                {degradedNote}
                            </p>
                        )}

                        {result?.preview && result.note && (
                            <div className="mb-3 shrink-0 border-l-2 border-verdict-caution pl-3 text-xs text-verdict-caution">
                                {result.note}
                            </div>
                        )}

                        {backgroundError && (
                            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-l-2 border-verdict-risk pl-3 text-xs text-verdict-risk">
                                <span>{searchError}</span>
                                <button
                                    onClick={() => setSearchRetry((n) => n + 1)}
                                    className="underline underline-offset-2"
                                >
                                    Retry
                                </button>
                            </div>
                        )}


                        {/* Flex COLUMN, not a bare block. The results pane below is the
                            scroller for this whole surface, and a scroller only scrolls
                            if something gives it a definite height — as a block child it
                            resolves to `height: auto`, grows to the full height of every
                            loaded row, and quietly hands the overflow to `main`'s
                            `lg:overflow-hidden` to clip. `min-h-0` doesn't save it: that
                            only overrides `min-height: auto` on a flex/grid ITEM, which a
                            block child isn't. Column here + `flex-1` on the pane is the
                            same shape the detail Sheet's scroller already uses, and it
                            keeps holding if a sibling (header, notice) is ever added
                            alongside the pane in this wrapper. */}
                        <div className="flex min-h-0 flex-1 flex-col">
                            {/* The standalone pivot seed row that used to render here
                                (browse-by-default, 2026-08-07) is gone (2026-08-15,
                                ITEM H) — the same seeds now surface in the search
                                box's own focus dropdown (`SearchAutocomplete`'s
                                `seeds` prop, "Popular searches" section) instead of
                                a second row competing with it for the same screen
                                real estate. `EmptyResultsState` and `ListTail` still
                                render `BrowseSeedRow` for the genuine no-results /
                                end-of-list states — unrelated surfaces, left as-is. */}
                            {resultsPanel === "serp-ask" ? (
                                /* Fallback ask (product spec §2, revised 2026-08-07):
                                   the zero-query browse fetch above (see the debounced
                                   effect) has DEFINITIVELY failed with nothing to show
                                   (`resolveJobsRenderMode` → "serp-ask") — never shown
                                   merely because the query is empty anymore. Chrome
                                   stays up — search line, filter band — with the full
                                   seed list standing in for the market that couldn't
                                   load. Seeds = recent searches first, then the
                                   curated fallback list, deduped — `resolveSearchSeeds`
                                   (lib/jobs/recent-searches.ts, unit-tested). Tapping
                                   one goes through the exact same `submitSearch`
                                   chokepoint a typed Enter/suggestion-pick uses, so
                                   the URL write and recent-searches recording can't
                                   drift from a real search. Styled like SerpFilters'
                                   own `Affordance` grammar — no pills, no buttons. */
                                <div className="text-left" data-testid="serp-ask">
                                    <p className="text-[11px] uppercase tracking-[0.06em] text-faint">
                                        Suggested roles
                                    </p>
                                    <p className="mt-1 text-[13px] text-muted-foreground">
                                        Tap one to search — your filters stay on
                                    </p>
                                    <div className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-2.5" role="list" aria-label="Suggested roles">
                                        {searchSeeds.map((seed) => (
                                            <button
                                                key={seed}
                                                type="button"
                                                data-testid="serp-ask-seed"
                                                title={`Search for ${seed}`}
                                                onClick={() => submitSearch(seed)}
                                                className="max-w-[min(100%,14rem)] truncate text-[13px] font-medium text-foreground underline underline-offset-[3px] transition-opacity duration-100 hover:opacity-80"
                                            >
                                                {seed}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : resultsPanel === "not-connected" ? (
                                <div className="border-l-2 border-foreground py-6 pl-4 text-left">
                                    <p className="text-[13px] text-foreground">Job search is being connected.</p>
                                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
                                        We&apos;re wiring intervu up to Subspace&apos;s live job corpus — including the posting check
                                        that flags roles that aren&apos;t really hiring.
                                    </p>
                                    {result?.note && (
                                        <p className="mt-1 max-w-md text-xs text-muted-foreground/70">{result.note}</p>
                                    )}
                                </div>
                            ) : resultsPanel === "error" ? (
                                // Deliverable 1 — the only remaining hard-stop state: a
                                // search genuinely has no results available at all (a
                                // served-but-stale response renders normally with
                                // `degradedNote` instead, above). Calmer headline than
                                // the old static "Job search is temporarily
                                // unavailable." repeated right above `searchError`,
                                // which itself often already opens with that same
                                // backend-supplied phrase — this no longer says it twice.
                                <div role="alert" className="border-l-2 border-verdict-risk py-6 pl-4 text-left">
                                    <p className="text-[13px] text-foreground">We can&apos;t load results right now.</p>
                                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">{searchError}</p>
                                    <button
                                        onClick={() => setSearchRetry((n) => n + 1)}
                                        className="mt-3 text-xs text-foreground underline underline-offset-2"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : resultsPanel === "loading" ? (
                                <JobsListSplash />
                            ) : resultsPanel === "empty" ? (
                                <EmptyResults
                                    entries={emptyStateEntries}
                                    onClearEntry={(entry) => applyFilterState(entry.clear(filterState))}
                                    onClearFilters={panelClearAll}
                                    query={query}
                                    onClearQuery={handleClearSearch}
                                    // SAME `shouldShowLocationDefaultChip`/`suppressLocationDefault`
                                    // seam the location-control chip above uses (DefaultLocationChip's
                                    // doc comment) — reused, not a second source for "was a geo
                                    // default applied."
                                    locationDefault={
                                        shouldShowLocationDefaultChip(result?.defaultedLocation, locationDraft)
                                            ? { label: `near ${regionDisplayName(result!.defaultedLocation!)}`, onClear: suppressLocationDefault }
                                            : undefined
                                    }
                                    ghostRevealCount={ghostRevealCount}
                                    onRevealGhosts={() => onHideGhosts(false)}
                                    seeds={searchSeeds}
                                    onSubmitSeed={submitSearch}
                                />
                            ) : (
                                <>
                                    {!isSerpAsk && (
                                        <>
                                            {/* Consolidated Swiss Glass Status Ribbon */}
                                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-none border-b border-border/50 bg-muted/[0.18] px-3.5 py-2 text-[11px]">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span
                                                        data-testid="result-line"
                                                        className="font-bold uppercase tracking-wider text-foreground tabular-nums"
                                                    >
                                                        {resultsCountLabel}
                                                    </span>
                                                    {beyondWindow.show && (
                                                        <button
                                                            type="button"
                                                            data-testid="beyond-window-show-all"
                                                            onClick={() => panelPostedBucket(undefined)}
                                                            className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                                                        >
                                                            ({beyondWindowText} — show all)
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Employer-scope disclosure — the standard removable
                                                    filter-token pattern. Mounted OUTSIDE the
                                                    query/filter row below because the scope arrives from
                                                    a link (`/co/[slug]`'s CTA), not from anything the
                                                    searcher typed or toggled: with no token they'd see a
                                                    count far below the corpus with nothing on screen
                                                    saying why, and no way back out. Labelled with the
                                                    domain, which is the scope the search actually
                                                    applies — not a display name derived from the hits,
                                                    which would be absent in the one state where this
                                                    disclosure matters most (zero results). */}
                                                {companyDomain && (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span
                                                            data-testid="company-scope-chip"
                                                            className="inline-flex items-center gap-2 rounded-md border border-border bg-chip px-2 py-1 text-[11.5px]"
                                                        >
                                                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                                                                employer
                                                            </span>
                                                            <span className="text-foreground">{companyDomain}</span>
                                                            <button
                                                                type="button"
                                                                data-testid="company-scope-clear"
                                                                aria-label={`Show roles from all employers, not just ${companyDomain}`}
                                                                onClick={clearCompanyScope}
                                                                className="text-muted-foreground transition-colors hover:text-foreground"
                                                            >
                                                                ✕
                                                            </button>
                                                        </span>
                                                    </div>
                                                )}
                                                {/* 2026-08-17, Vivek: "too much happening in that small
                                                    box". Both clear controls moved up to the toolbar,
                                                    beside "All filters" — they undo what that row sets,
                                                    so that is where they belong (same reasoning as ITEM I
                                                    above). "Clear filters" was additionally a straight
                                                    DUPLICATE of the toolbar's own, down to a second copy
                                                    of `data-testid="results-clear-filters"`. What is left
                                                    here only reports: the count, the window, the scope. */}
                                            </div>
                                            {/* ITEM S (2026-08-15, Vivek: "duplicate information") — this
                                                used to render a second row of "✕ clear <facet>" chips
                                                restating exactly what "Clear filters · N" above already
                                                covers. Removed: the toolbar's FacetBar dropdowns (each
                                                facet chip → open → click the active option) already let a
                                                user remove one facet at a time in 1-2 clicks, so this was a
                                                second mechanism for the same job, not a missing one. */}
                                        </>
                                    )}
                                <div
                                    id="jobs-results-list"
                                    tabIndex={0}
                                    role="listbox"
                                    aria-label="Job results"
                                    onKeyDown={handleResultsKeyDown}
                                    className={cn(
                                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2",
                                        board === "elite" && "elite-signal",
                                    )}
                                >
                                    {board === "elite" && (
                                        <div className="mb-3.5 flex items-baseline justify-between gap-3">
                                            <h2 className="font-display text-[19px] font-semibold tracking-tight">
                                                Elite matches
                                                <span className="ml-2 text-[12.5px] font-normal text-[color:var(--elite-muted)]">
                                                    {result?.total != null
                                                        ? `${result.total.toLocaleString()} roles · board allowlist`
                                                        : "board allowlist"}
                                                </span>
                                            </h2>
                                        </div>
                                    )}
                                    <div>
                                        {/* Deliverable 3 — one row (the best-ranked
                                            member) per cluster, its variants inserted
                                            right below only while expanded. The seam
                                            uses `clusterSeamIndex`, not `i` against
                                            `seamIndex` directly — see its own comment
                                            above (`clusterJobs`, lib/jobs/cluster.ts)
                                            for why a cluster can never straddle it. */}
                                        {clusters.flatMap((cluster, i) => {
                                            const expanded = expandedClusters.has(cluster.primary.id);
                                            const rows = [
                                                renderJobRow(
                                                    cluster.primary,
                                                    cluster.variants.length > 0
                                                        ? {
                                                              variantCount: cluster.variants.length,
                                                              expanded,
                                                              onToggleExpand: () => toggleClusterExpanded(cluster.primary.id),
                                                          }
                                                        : undefined,
                                                ),
                                                ...(expanded ? cluster.variants.map((v) => renderJobRow(v)) : []),
                                            ];
                                            if (i !== clusterSeamIndex) return rows;
                                            return [
                                                <p
                                                    key="seam"
                                                    data-testid="relevance-seam"
                                                    className="border-t border-border pt-4 pb-1 mb-1 text-[11px] text-muted-foreground"
                                                >
                                                    {sortScopedSeam
                                                        ? seamSummarySorted(seamIndex)
                                                        : seamSummary(seamIndex, total, displayHits.length)}
                                                </p>,
                                                ...rows,
                                            ];
                                        })}
                                    </div>
                                    {/* Screen 9 — the résumé moment. Fires on the third job
                                        opened this session: not a timer and not scroll depth,
                                        because three opens is someone actually reading, and
                                        that is the first point where ranking by fit is worth
                                        more than the search they already know how to run.
                                        Never a modal, never mid-scroll, dismissible for good.

                                        Sits ABOVE the load-more sentinel, not below the
                                        end-of-list line: with infinite scroll over thousands
                                        of matches "the bottom of the list" is a place nobody
                                        ever arrives at, so anchoring it there meant it would
                                        never render. The foot of what has actually been READ
                                        is the reachable equivalent. */}
                                    {showPersonalizationInvite && (
                                        <div
                                            data-testid="resume-personalize-invite"
                                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border py-5 text-[13.5px] text-muted-foreground"
                                        >
                                            <span>See which of these roles actually fit your background —</span>
                                            <button
                                                type="button"
                                                onClick={handleUploadClick}
                                                className="text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70"
                                            >
                                                add your résumé to rank by fit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={dismissUpsell}
                                                className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                            >
                                                not now
                                            </button>
                                        </div>
                                    )}
                                    {showResumeMoment && (
                                        <div
                                            data-testid="resume-moment"
                                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border py-5 text-[13.5px] text-muted-foreground"
                                        >
                                            <span>Want these ranked against your actual experience?</span>
                                            <button
                                                type="button"
                                                onClick={() => (hasUsableResume ? void handleRankByFit() : handleUploadClick())}
                                                className="text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70"
                                            >
                                                {hasUsableResume ? "use the résumé on file" : "drop your résumé"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={dismissUpsell}
                                                className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                            >
                                                no thanks
                                            </button>
                                        </div>
                                    )}

                                    {/* Restyled "Show N more ↓" (spec) on the SAME infinite-scroll
                                        mechanism as before: `sentinelRef` still auto-fires on
                                        scroll-into-view, and the element is now ALSO a real button
                                        (`loadMore` is idempotent — guarded by
                                        `paginationRef`/`loadingMore` — so a click racing an
                                        in-flight auto-load is a safe no-op) for anyone who'd rather
                                        tap than scroll. */}
                                    {hasMore && (
                                        <div ref={sentinelRef} className="flex items-center justify-center py-5">
                                            {loadingMore ? (
                                                <span className="text-xs text-muted-foreground">Loading more roles…</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => void loadMore()}
                                                    className="text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                                >
                                                    Show {Math.min(PAGE, Math.max(total - hits.length, 0)) || PAGE} more ↓
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {/* The class fix (jobs-list-tail) — everything below the
                                        sentinel lives in `ListTail` now, called unconditionally:
                                        it self-guards on `endOfListState`, so nothing actionable
                                        here can ever render while `hasMore` is true (see its own
                                        doc comment, above). */}
                                    <ListTail
                                        endOfListState={endOfListState}
                                        totalCount={totalCount}
                                        seeds={searchSeeds}
                                        onSubmitSeed={submitSearch}
                                    />
                                </div>
                                </>
                            )}
                        </div>
                            </>
                        </div>
                    </div>
                </div>
            </main>

            <LocationPickerSheet
                open={locationSheetOpen}
                onOpenChange={setLocationSheetOpen}
                state={filterState}
                distribution={result?.facetDistribution}
                defaultedIso2={result?.defaultedLocation}
                detectedLabel={
                    result?.defaultedLocation
                        ? `Near ${regionDisplayName(result.defaultedLocation)} (detected)`
                        : undefined
                }
                locationDefaultSuppressed={locationDefaultSuppressed}
                onRestoreDetected={() => {
                    restoreLocationDefault();
                    setDetectedOptedIn(true);
                }}
                onContinue={handleLocationSheetContinue}
            />

            {!isLgUp && !detailSheetOpen && !locationSheetOpen && (
                <div
                    data-testid="mobile-search-cta"
                    className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+3.25rem)] z-[180] border-t border-border/80 bg-card/95 px-4 py-2.5 shadow-none backdrop-blur-xl lg:hidden"
                >
                    <Button
                        type="button"
                        onClick={handleMobilePrimaryCta}
                        className="h-11 w-full rounded-none bg-foreground text-xs font-bold uppercase tracking-wider text-background hover:bg-foreground/90"
                    >
                        {mobilePrimaryCtaLabel}
                    </Button>
                </div>
            )}

            <AuthPopover
                open={authOpen}
                onOpenChange={(open) => {
                    // A close WITHOUT a preceding `onAuthed` (handleAuthed sets
                    // authedRef before this fires on success) is a dismissal —
                    // drop any queued action so it can't replay on a later,
                    // unrelated sign-in. Race-free: this reads authedRef, never
                    // the relative timing of setUser / setAuthOpen.
                    if (!open && !authedRef.current) clearPendingGate();
                    if (!open) setAuthGateReason(null);
                    setAuthOpen(open);
                }}
                onAuthed={handleAuthed}
                showTrigger={false}
                valueLine={
                    authGateReason
                        ? formatAuthGateValueLine(authGateReason, listGuestPursuits().length)
                        : undefined
                }
                defaultTab={authGateReason === "apply" ? "signup" : "login"}
            />
            <ResumeImportModal
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onImport={handleImport}
                confirmLabel="Rank my jobs"
                title="Rank jobs by your résumé"
                description="Upload or paste your résumé — we'll rank this list by how well each role fits."
            />
            <Sheet
                // Two-Panel Selector: gated through `resolveDetailMountSite`
                // (same call the xl+ pane's render condition uses) rather
                // than `detailSheetOpen` directly, so the two mount sites
                // stay mutually exclusive by construction. Widening past xl
                // flips this to `false` via a plain prop change — Radix only
                // calls `onOpenChange` on a user-driven internal event (ESC,
                // overlay click, its own Close), never merely because a
                // controlled `open` prop changed — so a resize never fires
                // `router.back()` or touches history; the pane already shows
                // the same job. Narrowing back re-opens the sheet.
                open={detailMountSite === "sheet"}
                onOpenChange={(open) => {
                    if (shouldBackOnDetailSheetClose(open, searchParams.get("job"))) router.back();
                }}
            >
                <SheetContent
                    side="bottom"
                    hideCloseButton
                    overlayClassName="bg-[rgba(18,21,26,0.42)]"
                    className="left-1/2 flex max-h-[min(88dvh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden rounded-t-[18px] border border-border border-b-0 p-0 shadow-[0_-18px_50px_rgba(18,21,26,0.18)] data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
                >
                    <div className="shrink-0 border-b border-border">
                        <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
                            <span className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
                        </div>
                        <div className="flex items-center gap-2 px-4 pb-3">
                            <div className="min-w-0 flex-1">
                                {detailJob ? (
                                    <>
                                        <p className="truncate text-base font-semibold tracking-[-0.03em] text-foreground">
                                            {decodeText(detailJob.title)}
                                        </p>
                                        <p className="truncate text-[13px] text-muted-foreground">
                                            {displayCompanyBrand(detailJob.company, detailJob.company_domain)}
                                        </p>
                                    </>
                                ) : (
                                    <p className="truncate text-base font-semibold text-foreground">Job details</p>
                                )}
                            </div>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={() => router.back()}
                                className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none text-faint transition-opacity hover:opacity-80"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                    <SheetTitle className="sr-only">
                        {detailJob ? `${decodeText(detailJob.title)} at ${displayCompanyBrand(detailJob.company, detailJob.company_domain)}` : "Job details"}
                    </SheetTitle>
                    {/* G5a: safe-area bottom padding — the sheet already
                        paints OVER the fixed mobile tab bar when open (see
                        JobDetailActionBar's doc comment), but nothing
                        previously accounted for the DEVICE's own bottom
                        safe area (home-indicator gesture strip), so the
                        sticky action bar / last content could sit flush
                        against it. Same env() token MobileTabBar.tsx uses. */}
                    {/* `min-h-0 flex-1 overflow-y-auto` is what makes THIS
                        div (not its parent, not JobDetail) the actual
                        scroll container — same mechanism as the min-WIDTH
                        version documented in LandingMarketingShowcase.tsx:
                        a flex child's default `min-height: auto` refuses
                        to shrink below its content, so without `min-h-0`
                        the `overflow-y-auto` here would never have room to
                        engage and the sheet would grow past its
                        `max-h-[min(88dvh,760px)]` ancestor instead of
                        scrolling. `overscroll-y-contain` is the other half
                        (mobile detail-scroll fix, 2026-08-18): without it,
                        a touch-drag that reaches this div's top/bottom
                        edge and keeps going CHAINS the scroll gesture to
                        the next scrollable ancestor — the page behind the
                        sheet — on iOS Safari, even though `body` is
                        `overflow: hidden` (overflow:hidden alone doesn't
                        stop scroll-chaining out of a fixed-position
                        overlay's own inner scroller). `contain` stops the
                        chain at this div's boundary instead of letting it
                        escape to the page, which is what "the page behind
                        must not scroll while the sheet is open" requires. */}
                    <div
                        data-testid="mobile-detail-scroller"
                        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom,0px)] custom-scrollbar"
                    >
                        {/* `undefined`, not `() => router.back()` — the sheet chrome
                            above already renders its own × wired to the identical
                            `router.back()` (the button ~30 lines up). Passing a
                            handler here makes JobDetail render a SECOND × (its
                            `{onClose && ...}` gate at JobDetail.tsx:597), duplicating
                            the close control ~150px away from the first. Do not
                            "fix" this back — the desktop pane at :3223 is a
                            different mount site with no chrome × of its own, which
                            is why it still passes a real handler.

                            `collapseDescription={false}` — this Sheet IS the
                            scroller (see the div's own doc comment above); a
                            description-length-based inner clamp is a second,
                            redundant height cap one level deeper (mobile
                            detail-scroll fix part 2, 2026-08-18). */}
                        {renderDetailSurface(undefined, false)}
                    </div>
                </SheetContent>
            </Sheet>

            {/* A1 — apply-return capture. House skin (squared, quiet muted
                box, mono label) rather than the global `Toaster` (lib/toast.tsx,
                out of this change's ownership + no action-button support) —
                offset above the real toast stack's own corner so a
                concurrent "Marked as applied" success toast never stacks
                directly on top of it. */}
            {/* Held-open apply click. `onContinue` fires from a click inside
                the dialog, which keeps `window.open` inside a user gesture. */}
            <ApplyIntentDialog
                job={
                    applyIntentJob
                        ? {
                              // Same mapping JobDetail already uses for
                              // McpHandoffNote, so both entry points hand the
                              // assistant an identically shaped role.
                              id: applyIntentJob.id,
                              title: decodeText(applyIntentJob.title),
                              company: applyIntentJob.company || "Unknown company",
                              location: locationText(applyIntentJob) || null,
                          }
                        : null
                }
                open={Boolean(applyIntentJob)}
                onOpenChange={(next) => {
                    if (!next) setApplyIntentJob(null);
                }}
                onContinue={() => {
                    if (applyIntentJob) openPostingNow(applyIntentJob);
                }}
            />

            <SearchPrefsSetup
                variant="dialog"
                open={searchPrefsDialogOpen}
                onOpenChange={setSearchPrefsDialogOpen}
                onComplete={handleSearchPrefsComplete}
                onAddResume={handleSearchPrefsAddResume}
            />

            {applyReturnPrompt && (
                <div
                    data-testid="apply-return-prompt"
                    role="status"
                    className="fixed bottom-24 right-4 z-[190] flex w-full max-w-sm items-start gap-3 border border-border bg-card px-4 py-3 shadow-lg"
                >
                    <div className="min-w-0 flex-1">
                        <div className="mono-data text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                            Did you apply?
                        </div>
                        <div className="mt-0.5 truncate text-[13px] text-foreground">
                            {decodeText(applyReturnPrompt.title)}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const job = applyReturnPrompt;
                            setApplyReturnPrompt(null);
                            void doMarkApplied(job);
                        }}
                        className="shrink-0 border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
                    >
                        Mark applied
                    </button>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() => setApplyReturnPrompt(null)}
                        className="shrink-0 text-muted-foreground/60 hover:text-foreground"
                    >
                        ×
                    </button>
                </div>
            )}
        </div>
    );
}

function JobsLoading() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                <p className="text-sm">Loading jobs…</p>
            </div>
        </div>
    );
}

export default function JobsPage() {
    return (
        <Suspense fallback={<JobsLoading />}>
            <JobsContent />
        </Suspense>
    );
}
