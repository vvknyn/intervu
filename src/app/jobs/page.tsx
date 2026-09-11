"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    MagnifyingGlass,
    WarningCircle,
    Compass,
    CaretDown,
    CaretUp,
    MapPin,
    X,
    Check,
    Question,
    CircleNotch,
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
import { useAuthGate } from "@/components/auth/use-auth-gate";
import { GUEST_SERP_TIP } from "@/components/marketing/openclaw-content";
import { getMarketingStatsAction } from "@/actions/marketing";
import { useSearchDock } from "@/components/layout/SearchDockContext";
import { FooterLinks } from "@/components/layout/Footer";
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
import { recordJobViewAction } from "@/actions/views";
import { usePursuits, invalidatePursuitsCache, syncGuestPursuitsToServer } from "@/lib/pursuits/use-pursuits";
import { useViewed } from "@/lib/views/use-viewed";
import { buildViewedSet, applyViewedFilter } from "@/lib/views/viewed-set";
import { listGuestPursuits, addGuestPursuit } from "@/lib/pursuits/guest-store";
import { syncGuestFollowsToServer } from "@/lib/follows/use-follows";
import { BoardVisitBanner } from "@/components/jobs/BoardVisitBanner";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { hasReachedStage, buildJobSnapshot, type Pursuit } from "@/lib/pursuits/types";
import { withSettleGuard } from "@/lib/jobs/settle-guard";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { pickExceptionJit } from "@/lib/jobs/should-show-relist-jit";
import { LISTING_STATE_CHIP, LISTING_STATE_CHIP_LABEL } from "@/lib/ui/status-tokens";
import {
    decodeText,
    displayCompanyBrand,
    locationText,
    LOCATION_UNKNOWN_TEXT,
    postedAgeShort,
    searchResultLine,
    firstMentionIndex,
    interleaveByCompany,
    partitionByTitleMatch,
    resolveHeadlineTotal,
    seamSummary,
    shortDate,
    tieredSeamIndex,
} from "@/lib/jobs/presentation";
import { presentJob } from "@/lib/presentation";
import { ContextHelp } from "@/components/ui/context-help";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { scoreJobAgainstResume, type MatchScore } from "@/lib/match/score";
import { MatchChip } from "@/components/jobs/MatchChip";
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
import { jobsUrlStateFromSavedHref, suggestSavedSearchName } from "@/lib/jobs/saved-searches";
import { useSavedSearches, syncGuestSavedSearchesToServer } from "@/lib/jobs/use-saved-searches";
import {
    subscribeSuppressLocationDefault,
    getSuppressLocationDefaultSnapshot,
    getSuppressLocationDefaultServerSnapshot,
    suppressLocationDefault,
    restoreLocationDefault,
    shouldShowLocationDefaultChip,
    regionDisplayName,
    buildDockedChips,
    DEFAULT_LOCATION_CHIP_KEY,
} from "@/lib/jobs/location-default-preference";
import { detectedLocationLabel } from "@/lib/jobs/location-label";
import { countryToFlag } from "@/lib/jobs/country-flag";
import { chipVariants, ChipDismiss, filterCountBadgeClass } from "@/components/ui/chip";
import { SavedSearchesPanel } from "@/components/jobs/SavedSearchesPanel";
import { LandingMarketingShowcase, indexCategories } from "@/components/jobs/LandingMarketingShowcase";
import { JOBS_USP } from "@/lib/jobs/jobs-usp-copy";
import { useTour } from "@/hooks/use-tour";
import { toolbarControlHeight } from "@/lib/jobs/toolbar-control-height";
import { captureEvent } from "@/lib/analytics/events";
import { useResultImpressions } from "@/lib/jobs/use-result-impressions";
import {
    activeFilterEntries,
    appliedPostedBucket,
    entriesNeedingOwnChip,
    chipLabelForEntry,
    toggleFacetValue,
    changedFilterFacets,
    PRISTINE_FILTER_STATE,
    applyLocationSheetDraft,
    locationTriggerLabel,
    LOCATION_TRIGGER_PLACEHOLDER,
    type FilterState,
    type LocationSheetDraft,
} from "@/components/jobs/FilterPanel";
import { FilterChipsRow, pickRemoteFacetValue } from "@/components/jobs/FilterChipsRow";
import { LocationPickerSheet } from "@/components/jobs/LocationPickerSheet";
import { LocationCombobox } from "@/components/jobs/LocationCombobox";
import { addLocationValue, type SuggestField } from "@/lib/jobs/location-suggest";
import { SerpFilters } from "@/components/jobs/SerpFilters";
import { ApplyIntentDialog } from "@/components/jobs/ApplyIntentDialog";
import { shouldPromptApplyIntent } from "@/lib/jobs/apply-intent";
import { FacetBar, facetBarRepresents } from "@/components/jobs/FacetBar";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { JobDetail, JobDetailActionBar, JobDetailSkeleton, MetaLine } from "@/components/jobs/JobDetail";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { rowTrustChip } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { derivePostedTs, LOCATION_FACET_FIELDS } from "@/lib/jobs/meilisearch";
import { resolveCorpusCount, formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { resolveBeyondWindow } from "@/lib/jobs/beyond-window";
import { needsResumeEntry } from "@/lib/jobs/resume-entry";
import { JobsPaginationGeneration } from "@/lib/jobs/pagination-generation";
import { detailFetcher } from "@/lib/jobs/detail-fetch";
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    type ExistenceCheckStatus,
    resolveEmptySearchState,
    resolveJobsRenderMode,
    resolveJobsResultsPanel,
    DEAD_JOB_TOMBSTONE_TEXT,
    SEARCH_UNAVAILABLE_MESSAGE,
    shouldClearStaleJobUrl,
    shouldBackOnDetailSheetClose,
    resolveDetailMountSite,
    shouldSuppressLandingAmbientPreview,
    degradedResultsNote,
    unmatchedPlaceNote,
    buildZeroResultPayload,
    resolveEndOfListState,
    shouldShowMobileSearchCta,
} from "@/lib/jobs/result-state";
import { isDetailFetchInFlight, resolveDetailDescriptionPending } from "@/lib/jobs/description-section-state";
import { parseWorkTypeTokens } from "@/lib/jobs/query-understanding";
import { saveAgentPreferencesAction } from "@/actions/agent-preferences";
import { recordOnboardingInteraction, getOnboardingInteractionCount } from "@/lib/jobs/onboarding-prompt";
import {
    dismissEmailNudge,
    isEmailNudgeDismissed,
    shouldPromptEmailNudge,
} from "@/lib/jobs/email-nudge";
import {
    dismissSearchAlertCapture,
    isSearchAlertDismissed,
    isSearchAlertSubmitted,
    shouldShowSearchAlertCapture,
} from "@/lib/jobs/search-alert-capture";
import { resolveFacetsMountSite, showsFiltersToggle } from "@/lib/jobs/serp-density";
import { getAccountEmailStateAction } from "@/actions/account-email";
import { AccountEmailPrompt } from "@/components/account/AccountEmailPrompt";
import { SearchAlertCapture } from "@/components/jobs/SearchAlertCapture";
import type { EmailNudgeState } from "@/lib/auth/account-email";
import { useApplyReturnPrompt, ApplyReturnPrompt, type ApplyReturnJob } from "@/components/jobs/ApplyReturnPrompt";
import { clusterJobs, clusterToggleLabel } from "@/lib/jobs/cluster";
import { coerceSortToSupported, resolveEffectiveSort, shouldScopeTextMatchToTitle } from "@/lib/jobs/sort";
import {
    type FacetKey,
    type JobSearchParams,
    type JobSortMode,
    type PostedBucket,
    type PublicJob,
    type YearsExperienceBucket,
} from "@/lib/jobs/types";
import {
    parseJobsUrl,
    serializeJobsUrl,
    DEFAULT_URL_STATE,
    urlSortToMode,
    shouldResetSortOnQueryChange,
    type JobsUrlState,
    type UrlSort,
} from "@/lib/jobs/url-state";
import { FitIntentGuard } from "@/lib/jobs/fit-intent";
import { buildJobSearchPayload } from "@/lib/jobs/search-payload";
import { domainToSlug } from "@/lib/boards/slug";
import { jobPath } from "@/lib/jobs/job-slug";
import type { BoardId } from "@/lib/boards/types";
import { buildMatchQuery, mergeFacets } from "@/lib/jobs/resume-match";
import { resolveApplyClickDecision } from "@/lib/jobs/pending-actions";
import { toast } from "@/lib/toast";
import { classifySentinel } from "@/lib/llm/sentinels";
import type { ResumeData } from "@/types/resume";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { useResumePresence } from "@/lib/resume/use-resume-presence";
import {
    formatAuthGateValueLine,
    GUEST_SAVE_TOAST,
    SIGNUP_SUBCOPY,
    type AuthGateReason,
} from "@/lib/auth/auth-gate-copy";
import {
    getGuestSaveCount,
    recordGuestSave,
    isGuestSaveBannerDismissed,
    dismissGuestSaveBanner,
} from "@/lib/auth/guest-save-gate";
import {
    dismissGuestEngageNudge,
    getGuestJobViewCount,
    getGuestResultClickCount,
    isGuestEngageNudgeDismissed,
    recordGuestResultClick,
    shouldShowGuestEngageNudge,
    subscribeGuestEngageNudge,
} from "@/lib/auth/guest-engage-nudge";
import { ANONYMOUS_DEPTH_GATE_MESSAGE } from "@/lib/shield/depth-cap";
import { interpretLoadMoreResponse } from "@/lib/jobs/load-more-outcome";

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
/**
 * Where reading content stops widening. The page shell itself is edge to edge
 * — Vivek picked "full-bleed chrome, capped results" on /mock/surface
 * (2026-08-24) after asking to lose the empty margins on either side — so the
 * search shell and the toolbar run the full window and only the results grid
 * takes this cap.
 *
 * 1600 is a ceiling, not a width: below it this class does nothing at all, so
 * every laptop viewport renders exactly as it did. It exists for the wide
 * monitor, where an uncapped three-pane grid put the description pane at
 * ~110 characters per line — well past the 65–75 a person reads without
 * losing their place on the return sweep.
 */
const cappedContentClass = "mx-auto w-full max-w-[1600px]";

/** Shared by the hero search box and its docked copy in the header (see the
 *  dock effect below) — one string, so the two can never read differently. */
const SEARCH_PLACEHOLDER = "What kind of work are you looking for?";

function ToolbarSegment({
    label,
    pressed,
    onClick,
    pending = false,
    title,
}: {
    label: string;
    pressed: boolean;
    onClick: () => void;
    pending?: boolean;
    title?: string;
}) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            aria-busy={pending || undefined}
            disabled={pending}
            onClick={onClick}
            title={title}
            className={cn(
                "inline-flex self-stretch min-h-6 box-border items-center justify-center gap-2 rounded-none px-3 text-xs font-semibold leading-none transition-all duration-150",
                pressed ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
        >
            {pending && <CircleNotch size={16} className="animate-spin shrink-0" aria-hidden />}
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
function DefaultLocationChip({ iso2, onClear }: { iso2: string; onClear: () => void }) {
    const flag = countryToFlag(iso2);
    const name = useMemo(() => regionDisplayName(iso2), [iso2]);
    return (
        <span
            data-testid="default-location-chip"
            className={cn(chipVariants({ active: false }), toolbarControlHeight, "mono-data inline-flex items-center justify-center gap-1.5 text-xs leading-none")}
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
            <span className="mr-1 whitespace-nowrap text-xs font-semibold text-muted-foreground">Popular searches:</span>
            {seeds.map((seed) => (
                <button
                    key={seed}
                    type="button"
                    data-testid="serp-ask-seed"
                    title={`Search for ${seed}`}
                    onClick={() => onSubmit(seed)}
                    className="inline-flex items-center rounded-none border border-border bg-muted px-2.5 py-1 text-left text-xs text-foreground transition-all hover:border-border hover:bg-border hover:text-foreground dark:border-border dark:bg-border dark:text-foreground dark:hover:border-border dark:hover:bg-border"
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

/**
 * Quiet replay for the /jobs guided tour — lives on the filters row, not
 *  the global floating pill (which collides with SIGN IN TO APPLY). */
function JobsTourReplayButton() {
    const { startTour } = useTour();
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        data-testid="jobs-tour-replay"
                        aria-label="How these listings work"
                        onClick={() => startTour()}
                        className={cn(
                            toolbarControlHeight,
                            "inline-flex w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-none p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:w-7",
                        )}
                    >
                        <Question size={16} weight="bold" aria-hidden />
                    </button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">How these listings work</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

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
export function JobCard({
    job,
    active,
    opened,
    onClick,
    onCompany,
    now,
    variantCount = 0,
    clusterLabel = "",
    expanded = false,
    onToggleExpand,
    dense = false,
    tourAnchor = false,
    matchScore = null,
    matchAsOfDate = null,
    pursuit,
    onGoAfter,
    goingAfter = false,
    position,
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
    /** Collapsed-state pill text ("+N locations"/"+N openings"), computed
     *  by `clusterToggleLabel` (lib/jobs/cluster.ts) at the call site — the
     *  card just renders it, never derives it. */
    clusterLabel?: string;
    expanded?: boolean;
    onToggleExpand?: () => void;
    /** Accepted-but-unused: comfortable layout is the only SERP density now. */
    dense?: boolean;
    /** First visible result row — anchor for the jobs guided tour. */
    tourAnchor?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). */
    matchScore?: MatchScore | null;
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`) — the receipt's "against your résumé of {date}" line. */
    matchAsOfDate?: string | null;
    /** Existing pursuit for this job, if any — same contract JobDetail's
     *  bookmark reads. Optional (unlike JobDetail's required prop): the
     *  direct-construction unit test (jobs-card-posted-age.test.ts) renders
     *  `JobCard` without wiring pursuits, and the row's bookmark control
     *  simply doesn't render without a save handler rather than faking one. */
    pursuit?: Pursuit;
    onGoAfter?: () => void;
    goingAfter?: boolean;
    /** 1-based index of this row in the current search's rendered list
     *  (`hits`, jobs/page.tsx) — stamped as `data-position` for
     *  `useResultImpressions` to read off the DOM (SPEC §5's position-
     *  corrected-CTR requirement). Omitted when the card isn't rendered from
     *  a tracked search list, so no attribute is written and the row is
     *  simply not impression-tracked rather than tracked with a fake `0`. */
    position?: number;
}) {
    const presented = presentJob(job);
    const accessibleName = `${presented.title} at ${presented.company.name}`;
    const exceptionMark = rowExceptionMark(job, now);
    const age = postedAgeShort(derivePostedTs(job), now);
    // `presented.location` (locationSummary(locationText(job))) passes the
    // `LOCATION_UNKNOWN_TEXT` sentinel through unchanged when nothing usable
    // came off the posting — that's an absence, not a value, so the fact
    // chip renders only when it's something OTHER than that (remote is
    // always a known value even when the underlying location is unknown,
    // since `locationText`'s remote branch never surfaces the sentinel).
    const locationKnown = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
    // Icon-fact grammar (board-redesign.html §rollout stage 1) — same
    // `buildFactChips` chokepoint JobDetail uses, so a card and the pane it
    // opens can never disagree about how a given fact's label reads. `null,
    // null` skips the posted/first_seen kinds (`age`, below, already covers
    // that on the row, in its own untouched format — folding buildFactChips'
    // `Posted ${age}` label in here would reintroduce the literal "Posted"
    // string jobs-card-posted-age.test.ts forbids). The rulebook's list-row
    // anatomy names exactly two facts for this line — pay, work mode — so
    // employment_type/experience_level (still shown in the detail pane) are
    // filtered out here rather than in the shared chokepoint. Work-type is
    // its own chip here, so location is deliberately plain (no
    // `locationWithMode` fold-in) — showing "Hybrid" in both the location
    // text AND its own chip would say the same fact twice.
    const factChips = buildFactChips(job, null, null).filter((c) => c.kind === "work_type" || c.kind === "salary");
    const freshness = classifyPostingFreshness(job, now);
    // Positive-only trust signal (mirrors `rowTrustChip`'s own doc comment:
    // "review"/"ghost" verdicts already surface via `exceptionMark` above,
    // not duplicated here).
    const activelyPosted = rowTrustChip(job, now) === "clear";

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={active}
            aria-label={`View ${accessibleName}`}
            data-job-row
            data-job-id={job.id}
            {...(position ? { "data-position": position } : {})}
            data-testid="job-row"
            {...(tourAnchor ? { "data-tour": "jobs-card" } : {})}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className={cn(
                // Rows are hairline-separated, not bordered cards (rulebook
                // item h): the divider lives on the content wrapper below,
                // inset past the tile, so this outer grid carries no border
                // or bottom margin of its own — rows touch, the line between
                // them starts at the title's x, not the tile's.
                "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] rounded-none bg-card text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand gap-x-3 px-4 pt-4",
                active && "border-l-[3px] border-l-brand bg-muted text-brand",
            )}
        >
            <div className="self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-border pb-4">
            <div className="min-w-0">
                <span className="inline-flex flex-wrap items-baseline gap-x-1">
                    <Link
                        href={jobPath(job)}
                        data-testid="job-title"
                        className={cn(
                            "text-lg leading-snug hover:underline",
                            opened ? "text-muted-foreground" : "font-semibold text-foreground",
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
                        {presented.title}
                    </Link>
                    {/* Exception-only word marks beside the title (ATTENTION.md
                        channel 4) — `rowExceptionMark` is the single
                        chokepoint; default rows stay unmarked. */}
                    {exceptionMark && (
                        <span
                            data-testid="row-exception"
                            data-tour="row-exception"
                            data-exception={exceptionMark.kind}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex shrink-0 items-center whitespace-nowrap text-xs font-semibold leading-none"
                        >
                            <ContextHelp content={exceptionMark.explain} side="right">
                                {exceptionMark.parts.map((part, i) => (
                                    <span key={part.text} className="inline-flex items-center">
                                        {i > 0 && (
                                            <span className="mx-1 text-muted-foreground" aria-hidden>
                                                ·
                                            </span>
                                        )}
                                        <span className={part.className}>{part.text}</span>
                                    </span>
                                ))}
                            </ContextHelp>
                        </span>
                    )}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-left text-sm text-muted-foreground">
                    {onCompany ? (
                        <button
                            type="button"
                            className="text-left hover:text-foreground hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCompany(job);
                            }}
                        >
                            {presented.company.name}
                        </button>
                    ) : (
                        <span>{presented.company.name}</span>
                    )}
                    {/* Location joins the identity line, not the facts line
                        below — a pin prefix is the one icon the rulebook's
                        row anatomy allows ("HIG prefix before the place,
                        never icon+word for the same fact twice"), so it's
                        marked exempt from the list region's zero-icon count
                        rather than counted as a "fact icon." No "·" before
                        it — the pin icon already separates it from the
                        company name, and at narrow widths the location
                        wraps to its own line, leaving a lone "·" dangling
                        at the end of the company line above it. */}
                    {locationKnown && (
                        <span data-rulebook-exempt className="inline-flex items-center gap-1">
                            <FACT_CHIP_ICON.location size={14} className="shrink-0" aria-hidden />
                            {presented.location}
                        </span>
                    )}
                </div>
                {/* Facts + status, one 14/20-scale secondary line joined by
                    the shared `MetaLine` "· " seam (JobDetail.tsx) — no
                    per-fact icons, no boxes/pills. Salary is the one bold
                    value (matches JobDetail's own facts row treatment);
                    status words carry their state in color alone, same as
                    the detail pane's verdict word — sharing this line with
                    the facts (instead of a second row) is what keeps the
                    comfortable row inside the rulebook's 96-112px band. */}
                {(factChips.length > 0 || freshness.kind === "fresh" || activelyPosted || variantCount > 0) && (
                    <div className="mt-1 flex flex-wrap items-baseline text-xs text-muted-foreground">
                        <MetaLine
                            items={[
                                ...factChips.map((c) => (
                                    <span key={c.kind} className={cn(c.kind === "salary" && "font-semibold text-foreground")}>
                                        {c.label}
                                    </span>
                                )),
                                // "New" reads the SAME 7-day `classifyPostingFreshness`
                                // window everything else on the row already uses.
                                freshness.kind === "fresh" && (
                                    <span data-testid="freshness-badge" className="font-semibold text-muted-foreground">
                                        New
                                    </span>
                                ),
                                activelyPosted && <span className="text-live dark:text-live">Actively posted</span>,
                                // "+N location(s)"/"+N opening(s)" joins the same
                                // flowing meta line as plain text (rulebook item k)
                                // instead of a boxed chip — still the cluster
                                // expand/collapse control, just unstyled as a button.
                                variantCount > 0 && (
                                    <button
                                        type="button"
                                        data-testid="cluster-toggle"
                                        className="hover:text-foreground hover:underline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onToggleExpand?.();
                                        }}
                                    >
                                        {expanded ? "hide" : clusterLabel}
                                    </button>
                                ),
                            ]}
                        />
                    </div>
                )}
            </div>
            {/* Right meta column: bookmark (rulebook's 40px icon-only row
                control) sits above match receipt and posted age so this
                column's height tracks the mid column's text instead of
                driving the row past the rulebook's 96-112px band. The
                bookmark is a real interactive control, not a decorative
                fact icon — exempted from the list region's svg count the
                same way ContextHelp's sr-only text and CompanyLogo already
                are. Report is a detail-only action (GROUP-C, standard one-
                entry-point-per-listing) — no row-level mount here. */}
            <span className="flex h-fit flex-col items-end gap-1 self-start">
                <span className="flex items-center gap-1">
                    {onGoAfter && (
                        <span data-rulebook-exempt>
                            <RowBookmarkButton pursuit={pursuit} onGoAfter={onGoAfter} goingAfter={goingAfter} />
                        </span>
                    )}
                </span>
                {matchScore && <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />}
                {age && (
                    <span
                        data-testid="posted-age"
                        className={cn(
                            "mono-data text-xs leading-none",
                            "text-muted-foreground",
                        )}
                    >
                        {age}
                    </span>
                )}
            </span>
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
            <Compass />
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
        <div className="flex flex-col items-center justify-center rounded-none border border-dashed border-border bg-card px-6 py-16 text-center">
            <WarningCircle size={24} className="mb-3 text-muted-foreground" />
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
        <div className="flex flex-col items-center justify-center rounded-none border border-dashed border-border bg-card px-6 py-16 text-center">
            {checking ? (
                <span className="mb-3 h-5 w-5 animate-spin rounded-none border-2 border-brand border-t-brand" />
            ) : (
                <MagnifyingGlass size={24} className="mb-3 text-muted-foreground" />
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
const PAGE = 20;
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
        <div aria-hidden="true" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 rounded-none bg-card pt-4">
            <div className="self-start">
                <div className="skeleton-bar h-12 w-12 rounded-none" />
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-2 border-b border-border pb-4">
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
            <p className="pt-8 text-sm text-muted-foreground">
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
                    className="font-semibold text-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
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
                    className="text-left underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                >
                    ✕ clear {entry.label}
                </button>
            ))}
            {locationDefault && (
                <button
                    type="button"
                    data-testid={chipTestId}
                    onClick={locationDefault.onClear}
                    className="text-left underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
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
    searchAlertSlot,
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
    searchAlertSlot?: React.ReactNode;
}) {
    const hasQuery = query.trim().length > 0;
    const hasFilters = entries.length > 0 || !!locationDefault;
    return (
        <div className="py-8 text-left">
            <p className="text-sm text-foreground">
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
            {searchAlertSlot}
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
                <p className="text-xs text-muted-foreground">
                    Showing the first {MAX_REACHABLE.toLocaleString()} of{" "}
                    {formatCorpusCount(totalCount)} — add a search or filter to narrow.
                </p>
            ) : (
                <p className="text-xs text-muted-foreground">
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
    const [postedExplicit, setPostedExplicit] = useState(initialUrlState.postedExplicit ?? false);
    const [yearsExperience, setYearsExperience] = useState<YearsExperienceBucket | undefined>(
        initialUrlState.yearsExperience,
    );
    // First-screen default: exclude likely_ghost from results. `ghosts=show` in
    // the URL flips it. No UI toggle wired yet (Task 6 — Trust toolbar).
    const [hideGhosts, setHideGhosts] = useState(initialUrlState.hideGhosts);
    // SERP "Hide already viewed" toggle (job_views history feature). Kept out
    // of `filterState` deliberately — unlike the fields above, view status is
    // a client-only post-filter never sent to `buildJobSearchPayload` (the
    // search index has no notion of it), so it's persisted via the same
    // `JobsUrlState` mechanism without joining the server-facing filter set.
    const [hideViewed, setHideViewed] = useState(initialUrlState.hideViewed);
    const [board, setBoard] = useState<BoardId | null>(initialUrlState.board);
    // Single-employer scope, arriving from `/co/[slug]`'s "View all N jobs"
    // CTA (`buildCompanyJobsUrl`). Held next to `board` because they are the
    // same concern — see `scope` below.
    const [companyDomain, setCompanyDomain] = useState<string | null>(initialUrlState.companyDomain);
    // Declared here (not down near `clearAll`/the rail JSX, where it used to
    // live) so the search effect below can read ONE `filterState` for this
    // render instead of five separate primitives — review fix, 2026-07-19,
    // needed so `buildJobSearchPayload` has a single FilterState to take.
    const filterState: FilterState = {
        facets,
        salaryMin,
        visaOnly,
        postedBucket,
        postedExplicit: postedExplicit || undefined,
        yearsExperience,
        hideGhosts,
        board,
        companyDomain,
    };
    /**
     * The date window actually filtering these results — never the raw
     * `postedBucket`, which still holds the fresh-visit "30d" nobody chose
     * and `buildJobSearchPayload` deliberately never sends. Everything that
     * SPEAKS about the window (the count sentence, the beyond-window reveal
     * and its probe) reads this, so the page can't caption an unfiltered
     * result set "from the last 30 days" or offer to reveal roles it is
     * already showing.
     */
    const appliedPosted = appliedPostedBucket(filterState);
    /**
     * The places this search is filtered to. Read off `filterState` rather
     * than mirrored into a second piece of state: the location box is an
     * ENTRY field now, not the filter itself, so its text answers "what is
     * being typed", never "what is being filtered on". Everything that needs
     * the latter — the docked search chip, the saved-preference write, the
     * applied-default disclosure — asks here.
     *
     * Spans every location field (`LOCATION_FACET_FIELDS`), not just
     * `location_country`: a city or state picked from the typeahead now
     * lands in its own field's bucket (see `addLocation` below), so reading
     * only `location_country` here would miss it — an already-chosen city
     * would show no checkmark, and an active city-only filter would read as
     * "no location chosen" to the IP-default chip and the saved preference.
     */
    const chosenLocations = LOCATION_FACET_FIELDS.flatMap((field) => filterState.facets[field] ?? []);
    // Explicit sort override; null = auto (newest with no query, relevance with a query —
    // see buildSort in lib/jobs/meilisearch.ts). Not a "filter", so it's kept out of
    // activeCount/clearAll. See `resolveUrlSort` for the sort=fit handling.
    const [sortOverride, setSortOverride] = useState<JobSortMode | null>(resolveUrlSort(initialUrlState.sort));
    // "Ranked by your résumé" — mirrors `sort=fit` in the URL. Kept separate
    // from `sortOverride` (a real backend `JobSortMode`) because "fit" isn't
    // one; the backend sort stays whatever `resolveUrlSort` resolves it to
    // (relevance, via the résumé-derived query — see `applyFit`).
    const [fitActive, setFitActive] = useState(initialUrlState.sort === "fit");
    const [fitResolving, setFitResolving] = useState(false);
    // Mirrors `fitActive` for read access from callbacks that can outlive the
    // render that defined them (the debounced search-fetch callback below) —
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
    // Entry text only — deliberately NOT seeded from the URL's places. Landing
    // on `?country=toronto,montreal` cannot be shown in one box, and showing
    // just the first would under-report the filter that is actually running.
    // The chips row renders every chosen place and can remove any one.
    const [locationDraft, setLocationDraft] = useState("");
    const [locationSheetOpen, setLocationSheetOpen] = useState(false);
    const [mobileResultsEngaged, setMobileResultsEngaged] = useState(false);
    // Item 7a (2026-08-21 front-door audit): narrower and earlier than
    // `mobileResultsEngaged` — that one flips on SUBMIT, this one flips on
    // FOCUS, so the masthead gets out of the way the moment a mobile visitor
    // starts typing rather than after they finish. Same one-way-ratchet
    // shape (set once, never reset) as `mobileResultsEngaged` above, for the
    // same reason: a blur mid-edit (e.g. tapping the location field next to
    // it) must not un-collapse the masthead under a query the visitor is
    // still composing.
    const [mobileSearchFocused, setMobileSearchFocused] = useState(false);
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
        postedExplicit: postedExplicit || undefined,
        yearsExperience,
        hideGhosts,
        hideViewed,
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

    // --- docked search ---------------------------------------------------
    // The header carries a live, typeable copy of this search once one is
    // active (see the effect near `activeCount`/`filtersOpen` below — it
    // needs both, so it lives after them). `setDocked` is pulled out here so
    // the unmount cleanup can sit next to the rest of this page's setup.
    const { setDocked } = useSearchDock();

    // The provider outlives this page, so a dock left set would follow the
    // person onto /resume or /trends and offer to edit a search they left.
    useEffect(() => () => setDocked(null), [setDocked]);

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
        // Step 1 of the funnel (docs/analytics/FUNNEL.md). Placed at this one
        // submit chokepoint for the same reason the dropdown is closed here:
        // Enter, a suggestion pick, the external Search button and the
        // category/seed chips all route through it, so a future entry point is
        // counted automatically instead of being silently invisible.
        //
        // The raw query text goes to the ledger ONLY (this repo's own
        // Postgres-backed telemetry store, keyed to the account server-side)
        // via the third `ledgerOnly` argument below — it is never passed to
        // PostHog; PostHog gets only `query_length` and the other ordinary
        // props. `activeFilterEntries` is re-derived here rather than read
        // from the render-scope binding so this does not depend on
        // declaration order.
        captureEvent(
            "search_submitted",
            {
                query_length: q.trim().length,
                has_location: chosenLocations.length > 0,
                filter_count: activeFilterEntries(filterState).length,
            },
            { query_text: q },
        );
        // Searches run in this browser. Counted HERE, at the one submit
        // chokepoint, which is what stops a future search entry point from
        // being invisible to either prompt — and counted for signed-in
        // visitors too, because the email nudge needs the same "has this
        // person actually shown intent" signal the wizard does.
        //
        // Both offers are decided here rather than in an effect on the count,
        // so each can only ever follow a search the visitor JUST ran. The
        // counter persists across visits, so an effect would fire on mount
        // for anyone already past the threshold — a prompt on arrival, before
        // they've done anything, which is the version of this pattern
        // everyone hates. This way a returning visitor who searched twice
        // yesterday is asked on today's first search.
        const interactions = recordOnboardingInteraction();
        setSearchInteractions(interactions);

        if (user) {
            void saveAgentPreferencesAction({
                search: {
                    // The saved-preference model holds ONE location, so a
                    // multi-place search saves its first. Joining them into a
                    // single string would write a value place resolution has
                    // never been asked to parse back.
                    query: q.trim() || undefined,
                    location: chosenLocations[0]?.trim() || undefined,
                },
            }).catch(() => {});
            // `accountEmailState === null` means the lookup hasn't answered
            // yet — not "reachable". Treating unknown as fine is what keeps a
            // slow round trip from silently suppressing the banner forever.
            if (
                accountEmailState !== null &&
                shouldPromptEmailNudge({
                    signedIn: true,
                    needsEmail: accountEmailState !== "reachable",
                    dismissed: emailNudgeDismissed,
                    interactions,
                })
            ) {
                setEmailNudgeOpen(true);
            }
        }
    };

    // `docked.onSubmit` (below) can fire long after the render that captured
    // it — the dock effect only re-runs when its own dependencies change,
    // not on every render, so a closure taken straight from that render
    // would read stale `user`/`chosenLocations`/etc. the way `fitActiveRef`
    // above guards `fitActive` against for callbacks that outlive a render.
    const submitSearchRef = useRef(submitSearch);
    submitSearchRef.current = submitSearch;

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
    // Set once `loadMore` hits the anonymous depth wall (`meta.gated`, see
    // `interpretLoadMoreResponse`) — holds the server's own note verbatim so
    // the sentinel below can swap "Show N more" for a sign-in CTA instead of
    // silently doing nothing forever. Reset alongside `loadingMore` whenever
    // a new first-page search starts.
    const [depthGateNote, setDepthGateNote] = useState<string | null>(null);
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
    // The signed-in email nudge: an account whose only address is a minted
    // <username>@intervu.cc can't receive anything we send. Value lives in
    // localStorage and is read post-mount, so it starts at the SUPPRESSED
    // end — true until the browser says otherwise — rather than risk
    // offering the nudge to someone who already said no. Same idiom as
    // `guestSaveBannerDismissed` above.
    const [emailNudgeDismissed, setEmailNudgeDismissed] = useState(true);
    const [emailNudgeOpen, setEmailNudgeOpen] = useState(false);
    const [accountEmailState, setAccountEmailState] = useState<EmailNudgeState | null>(null);
    const [accountPendingEmail, setAccountPendingEmail] = useState<string | null>(null);
    useEffect(() => {
        setEmailNudgeDismissed(isEmailNudgeDismissed());
    }, []);
    // Resolved from the server, never guessed from the client-side user
    // object: `user.email` is non-empty for exactly the accounts this serves
    // (that is the bug), so only `isReachableEmail` on the session can answer
    // it. Cleared on sign-out so a previous account's state can't leak into
    // the next one's banner.
    useEffect(() => {
        if (!user) {
            setAccountEmailState(null);
            setAccountPendingEmail(null);
            setEmailNudgeOpen(false);
            return;
        }
        void getAccountEmailStateAction().then((res) => {
            if (!res.data) return;
            setAccountEmailState(res.data.state);
            setAccountPendingEmail(res.data.pendingEmail);
        });
    }, [user?.uid]);
    const [guestTipDismissed, setGuestTipDismissed] = useState(false);
    // Progressive guest save gating — initialized post-mount (localStorage
    // is not available during SSR). `guestSaveCount` drives both the banner
    // (≥ 1) and the gate (≥ 1 → require sign-in on the next save).
    const [guestSaveCount, setGuestSaveCount] = useState(0);
    const [guestSaveBannerDismissed, setGuestSaveBannerDismissed] = useState(true);
    const [guestEngageResultClicks, setGuestEngageResultClicks] = useState(0);
    const [guestEngageJobViews, setGuestEngageJobViews] = useState(0);
    const [guestEngageNudgeDismissed, setGuestEngageNudgeDismissed] = useState(true);
    useEffect(() => {
        setGuestSaveCount(getGuestSaveCount());
        setGuestSaveBannerDismissed(isGuestSaveBannerDismissed());
        setGuestEngageResultClicks(getGuestResultClickCount());
        setGuestEngageJobViews(getGuestJobViewCount());
        setGuestEngageNudgeDismissed(isGuestEngageNudgeDismissed());
        return subscribeGuestEngageNudge(() => {
            setGuestEngageResultClicks(getGuestResultClickCount());
            setGuestEngageJobViews(getGuestJobViewCount());
        });
    }, []);
    const [searchAlertDismissed, setSearchAlertDismissed] = useState(true);
    const [searchAlertSubmitted, setSearchAlertSubmitted] = useState(true);
    const [searchInteractions, setSearchInteractions] = useState(0);
    useEffect(() => {
        setSearchAlertDismissed(isSearchAlertDismissed());
        setSearchAlertSubmitted(isSearchAlertSubmitted());
        setSearchInteractions(getOnboardingInteractionCount());
    }, []);
    const searchAlertVerifiedRef = useRef(false);
    // The masthead's provenance sentence is a constant now
    // (`LANDING_PROVENANCE_LINE`) — it holds no number, so it needs no fetch
    // and no state, and it renders on the server instead of appearing a beat
    // late.
    //
    // The count itself comes from this one already-cached call: it labels the
    // link above the search box that used to be the TopBar ticker. Stays `null`
    // on the failure path so the link is absent rather than claiming a count we
    // don't have.
    // `CorpusCount`, not a number: the count carries its own exact/approximate
    // kind and `formatCorpusCount` renders "100,000+" vs "12,345" from it.
    // Flattening it to a number here would quietly turn an approximation into
    // a precise-looking claim.
    const [liveJobsCount, setLiveJobsCount] = useState<CorpusCount | null>(null);
    useEffect(() => {
        let cancelled = false;
        getMarketingStatsAction()
            .then((stats) => {
                if (cancelled) return;
                setLiveJobsCount(stats?.liveJobs ?? null);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);
    // Replaces the old session-only `appliedIds` state (forgot on reload) —
    // one shared, cached fetch that also serves TopBar and /yours.
    const { byJobId: pursuitsByJobId } = usePursuits();
    const { viewedIds, markViewed } = useViewed();
    const [goingAfterId, setGoingAfterId] = useState<string | null>(null);
    const guestPursuitSyncRef = useRef(false);
    const guestSyncInFlightRef = useRef(false);

    // The resume backing "Rank by fit" and the import modal. `mode` (browse
    // vs the now-removed "explore") and the in-flight Explore call's state
    // (`exploringRaw`/`exploreFailed`) are gone — MCP handoff, 2026-08-02.
    const [resume, setResume] = useState<ResumeData | null>(null);
    // The stored `resume_last_updated` behind the match-score toolbar's
    // "scored against your résumé of {date}" line (see `fetchResumeData`,
    // actions/resume.ts) — kept alongside `resume` itself, set at the same
    // two call sites, so the two can never point at different résumés.
    const [resumeUpdatedAt, setResumeUpdatedAt] = useState<string | null>(null);
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

    // Which auth value-line reason class to show (apply / generic).
    // Set by the call site that opened the popover; null = no value line.
    const [authGateReason, setAuthGateReason] = useState<AuthGateReason | null>(null);
    // Controls the report dialog from outside `ReportJobButton` so a
    // post-auth replay (see `useAuthGate` below) can reopen the exact
    // dialog the user was filling out before sign-in.
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    // The one auth gate (`use-auth-gate.ts`): signed in → run the handler
    // now; signed out → persist the action (survives both in-place login and
    // a hard OAuth/passkey navigation away and back) and open the popover.
    // Handlers below reference `doMarkApplied`/`replayApplyGate`, declared
    // later in this component — safe because these are arrow functions, not
    // calls: the reference resolves only when the auth gate invokes them,
    // long after this component has finished its first render.
    const { gate, authOpen, setAuthOpen, onAuthed } = useAuthGate<PublicJob, PublicJob>({
        handlers: {
            apply: (action) => void doMarkApplied(action.payload),
            gate: (action) => void replayApplyGate(action.payload),
            upload: () => {
                setImportOpen(true);
            },
            // Reopening the dialog isn't enough on its own — the page's
            // current overlay may be showing a DIFFERENT job than the one
            // reported (browser back/forward while the auth popover was
            // open). Re-select the reported job by id via the same `openJob`
            // every SERP row/permalink uses (declared below — safe for the
            // same closure reason as `doMarkApplied`/`replayApplyGate`
            // above), and skip the dialog entirely if it can't be identified.
            report: (action) => {
                if (!action.payload?.id) return;
                openJob(action.payload.id);
                setReportDialogOpen(true);
            },
        },
        user,
    });

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

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
                postedExplicit: postedExplicit || undefined,
                yearsExperience,
                hideGhosts,
                board,
                companyDomain,
                sort: sortOverride ? modeToUrlSort(sortOverride) : null,
                jobId: null,
                // Client-only post-filter, unknown to the search index — same
                // reason `jobId` above is hardcoded rather than threaded in: it
                // must never appear in `searchKey` or it would trigger a refetch.
                hideViewed: false,
            }) + (postedDateSupported ? "" : "&nodatesort"),
        // `postedDateSupported` participates because it changes the sort the
        // backend is asked for: when the probe resolves, the date sort becomes
        // real and the results must be re-fetched in the new order.
        [
            query,
            facets,
            salaryMin,
            visaOnly,
            postedBucket,
            postedExplicit,
            yearsExperience,
            hideGhosts,
            board,
            companyDomain,
            sortOverride,
            postedDateSupported,
        ],
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

    // Whether the sort control's résumé-aware "Best match" segment (below)
    // should treat a résumé as on file — `hasUsableResume` (session-local:
    // just uploaded, or already resolved for a fit application) wins
    // outright when true; otherwise this is `resumeKnownOnServer`'s
    // tri-state answer as-is, `null` included.
    const resumeOnFile: boolean | null = hasUsableResume || resumeKnownOnServer;

    // Single gate behind every résumé invite on this page (band ghost word,
    // sort menu's fourth item, résumé-moment card) — see `needsResumeEntry`'s
    // own doc comment for why it reads `resumeOnFile` (server-aware) rather
    // than `hasUsableResume` (local-only): the latter told a returning
    // signed-in user with a résumé already on the server to "add" one.
    const showResumeEntry = needsResumeEntry({ signedIn: !!user, resumeOnFile, fitActive });

    // Single source for "what filters are currently active" — the toolbar
    // pill's count and `emptySearchState` below both read this ONE call
    // instead of a second `activeFilterEntries(filterState)` per render.
    const activeEntries = activeFilterEntries(filterState);

    // A STRING derived from `activeEntries`, not the array itself — the dock
    // effect below depends on this the same way it depends on `filtersOpen`:
    // `activeEntries` is a fresh array every render even when its content
    // hasn't changed, and listing IT in a dependency array is the same
    // React #185 loop `filterState` caused (see that effect's own comment).
    const activeChipsKey = activeEntries.map((e) => `${e.key}=${chipLabelForEntry(e)}`).join("|");

    // The active filters the FacetBar has no control for — see
    // `FACET_BAR_FACETS`. The toolbar names these itself, because for them
    // the 2026-08-15 "duplicate information" removal had nothing to be a
    // duplicate OF: `location_country` is set from the location box and
    // appears on no chip, so "Clear filters (1)" was the only trace that a
    // search had been narrowed at all.
    const unnamedEntries = entriesNeedingOwnChip(activeEntries, facetBarRepresents(postedDateSupported));
    const dockChipsKey = unnamedEntries.map((e) => `${e.key}=${chipLabelForEntry(e)}`).join("|");

    // Same disclosure gate `DefaultLocationChip`/the zero-result entry use
    // (`shouldShowLocationDefaultChip`), collapsed to the ISO2 or `null` so
    // the dock effect below can take it as ONE primitive dependency instead
    // of re-deriving the verdict from `result`/`chosenLocations` objects —
    // see that effect's own React #185 comment for why.
    const dockedDefaultLocationIso2 = shouldShowLocationDefaultChip(result?.defaultedLocation, chosenLocations)
        ? result!.defaultedLocation!
        : null;

    // The zero-result state's per-filter clear chips (Task 11) read a SEPARATE
    // call to the same `activeFilterEntries` chokepoint, with
    // `includeQuietDefaults: true` — a silently-applied default (today, only
    // the pristine "30d" posted-bucket) narrowed the result set just as much
    // as an explicit filter, so a zero-result explanation has to name it even
    // though the toolbar pill keeps it quiet. Same function, same clear
    // semantics, one extra opt-in — not a second parallel "what's active"
    // derivation.
    const emptyStateEntries = activeFilterEntries(filterState, { includeQuietDefaults: true });

    const searchAlertUrlState: JobsUrlState = useMemo(
        () => ({
            q: query,
            facets,
            salaryMin,
            visaOnly,
            postedBucket,
            postedExplicit: postedExplicit || undefined,
            yearsExperience,
            hideGhosts,
            board,
            companyDomain,
            sort: sortOverride ? modeToUrlSort(sortOverride) : null,
            jobId: null,
            hideViewed: false,
        }),
        [
            query,
            facets,
            salaryMin,
            visaOnly,
            postedBucket,
            postedExplicit,
            yearsExperience,
            hideGhosts,
            board,
            companyDomain,
            sortOverride,
        ],
    );
    const searchAlertHref = useMemo(() => {
        const qs = serializeJobsUrl(searchAlertUrlState);
        return qs ? `/jobs${qs}` : "/jobs";
    }, [searchAlertUrlState]);
    const searchAlertName = useMemo(() => suggestSavedSearchName(searchAlertUrlState), [searchAlertUrlState]);

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
        hasCorpusScope: Boolean(filterState.board || filterState.companyDomain),
    });
    // `!searchParams.get("job")` — the RAW url param, not `selectedId` (whose
    // default-browse auto-selection of `hits[0]` is not a deliberate pick —
    // see `resolveSelectionAfterRefresh`, lib/jobs/result-state.ts — and
    // never writes `job=`, per `jobs-split-view.spec.ts`'s "no ?job=" case).
    // A deliberate deep link/row click DOES write `job=`, and the hero has no
    // business sitting over an open job's detail (Vivek, "once I start
    // searching, why is it still there").
    // `board`/`companyDomain` are NOT re-tested here: they are members of
    // `filterState`, so `activeEntries.length === 0` already covers them. The
    // hand-written `&& !board && !companyDomain` that used to sit here was the
    // tell that scope was a second, parallel source of "is anything narrowing
    // this?" — every OTHER reader of that question (chips, clear, clear-all)
    // asked `activeFilterEntries` and got "no".
    const isPristineLanding = emptySearchState === "overlay-ask" && !query.trim() && activeEntries.length === 0 && !fitActive && !searchParams.get("job");
    // Single gate for "the header owns this search now" — lg+ always docks,
    // including the pristine default browse; mobile keeps the in-page well.
    const headerDockActive = isLgUp;
    const showLandingMarketing = isPristineLanding && !mobileResultsEngaged;
    const showToolbarFilters = isLgUp || !showLandingMarketing;

    const { startTour, hasSeenTour, isActive: tourActive, pageId: tourPageId } = useTour();
    const [dockedFacetsMount, setDockedFacetsMount] = useState<HTMLElement | null>(null);
    const [dockedFieldDirectoryMount, setDockedFieldDirectoryMount] = useState<HTMLElement | null>(null);
    const [dockedQueryMount, setDockedQueryMount] = useState<HTMLElement | null>(null);
    const [dockedLocationMount, setDockedLocationMount] = useState<HTMLElement | null>(null);
    const [dockedSortMount, setDockedSortMount] = useState<HTMLElement | null>(null);
    const [dockedExtrasMount, setDockedExtrasMount] = useState<HTMLElement | null>(null);
    const [dockedClearFiltersMount, setDockedClearFiltersMount] = useState<HTMLElement | null>(null);
    const [dockedSaveSearchMount, setDockedSaveSearchMount] = useState<HTMLElement | null>(null);

    useLayoutEffect(() => {
        if (!headerDockActive) {
            setDockedFacetsMount(null);
            setDockedFieldDirectoryMount(null);
            setDockedQueryMount(null);
            setDockedLocationMount(null);
            setDockedSortMount(null);
            setDockedExtrasMount(null);
            setDockedClearFiltersMount(null);
            setDockedSaveSearchMount(null);
            return;
        }
        const sync = () => {
            setDockedFacetsMount(document.querySelector('[data-testid="topbar-docked-facets"]') as HTMLElement | null);
            setDockedFieldDirectoryMount(document.querySelector('[data-testid="topbar-docked-field-directory"]') as HTMLElement | null);
            setDockedQueryMount(document.querySelector('[data-testid="topbar-docked-query"]') as HTMLElement | null);
            setDockedLocationMount(document.querySelector('[data-testid="topbar-docked-location"]') as HTMLElement | null);
            setDockedSortMount(document.querySelector('[data-testid="topbar-docked-sort"]') as HTMLElement | null);
            setDockedExtrasMount(document.querySelector('[data-testid="topbar-docked-extras"]') as HTMLElement | null);
            setDockedClearFiltersMount(document.querySelector('[data-testid="topbar-docked-clear-filters"]') as HTMLElement | null);
            setDockedSaveSearchMount(document.querySelector('[data-testid="topbar-docked-save-search"]') as HTMLElement | null);
        };
        sync();
        const id = requestAnimationFrame(sync);
        return () => cancelAnimationFrame(id);
    }, [headerDockActive]);

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
        setDepthGateNote(null);
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
                              ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, locationDefaultSuppressed),
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
                // Item 4 (2026-08-21 front-door audit): reorder THIS page's
                // hits so no more than 2 consecutive rows share a company —
                // live prod showed 10 straight from one employer. Applied
                // once, here, at ingestion — not recomputed over the whole
                // accumulated list on every render, which would reshuffle
                // rows already seen every time a later page loads. Every
                // downstream read of "this fetch's hits" below uses the same
                // interleaved array so "hits[0]" means the same row the list
                // actually renders first.
                const interleavedHits = interleaveByCompany(r.hits);
                setResult({ ...r, hits: interleavedHits });
                // A real search (not the pristine zero-query landing) that
                // comes back empty — the denominator for "how often does
                // search fail someone," not every empty render (a fresh
                // pristine mount is not a failed search).
                if (interleavedHits.length === 0 && !isPristineLanding) {
                    // `buildZeroResultPayload` (lib/jobs/result-state.ts) is
                    // the pure builder — `r.defaultedLocation`/
                    // `r.unmatchedPlaceMentions` are the two location-
                    // resolver outputs `searchJobsAction` actually returns
                    // (see that function's doc comment for why the full
                    // resolved-place interpretation isn't among them).
                    captureEvent("search_zero_results", buildZeroResultPayload(filterState, query, {
                        defaultedLocation: r.defaultedLocation,
                        unmatchedPlaceMentions: r.unmatchedPlaceMentions,
                    }));
                }
                const selection = resolveSelectionAfterRefresh(previousSelectedId, interleavedHits, { wasConfirmed });
                // Review fix: gate on the id ACTUALLY being absent from this
                // fetch's fresh hits, not merely on `selection.preserveDeliberateDetail`
                // — that flag is also true for a genuinely-FOUND id (the
                // first branch inside `resolveSelectionAfterRefresh`), so a
                // live page-1 deep link being checked for the first time
                // (`wasConfirmed` false, but found immediately) was
                // spuriously burning its one free pass on a job that was
                // never actually missing.
                const foundInFreshHits = previousSelectedId
                    ? interleavedHits.some((h) => h.id === previousSelectedId)
                    : false;
                if (previousSelectedId && !wasConfirmed && !foundInFreshHits) {
                    firstUnresolvedDeadLinkIdRef.current = previousSelectedId;
                }
                // Item 5 (2026-08-21 front-door audit): `resolveSelectionAfterRefresh`
                // defaulting to `hits[0]` is right for every OTHER case (a
                // dropped selection after a new search/filter, a search that
                // just returned its first page) — but on the pristine,
                // zero-intent landing below xl there is no pane and no sheet
                // auto-open, so that default reads as an arbitrary pick.
                // `preserveDeliberateDetail` is false exactly when `selection`
                // used that default branch, so a deliberate selection (deep
                // link, or one carried over from a real search) is never
                // suppressed here — only the bare default is, and only when
                // `shouldSuppressLandingAmbientPreview` says so.
                setSelectedId(
                    shouldSuppressLandingAmbientPreview(isPristineLanding, isXlUp) && !selection.preserveDeliberateDetail
                        ? null
                        : selection.selectedId,
                );
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
                if (appliedPosted === "30d") {
                    searchJobsAction({
                        ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, locationDefaultSuppressed),
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
        // Prime the description fetch FIRST, before any telemetry dispatch
        // below — Next's client action queue runs server actions strictly
        // serially (app-router-instance.js runAction/runRemainingActions), so
        // whichever POST is dispatched first is the one that lands first.
        // `detailFetcher` (lib/jobs/detail-fetch.ts) dedupes by id, so the
        // hydration effect further down just joins this same in-flight
        // request instead of queuing a second one behind the telemetry below.
        const hit = resultRef.current?.hits.find((h) => h.id === id);
        if (hit?.description === undefined && hydratedDetail?.id !== id) {
            void detailFetcher.fetch(id, searchJobsActionRaw);
        }
        // Telemetry before navigation: the rank is only knowable against the
        // result set currently on screen. A miss yields -1, which the action
        // drops — so a job opened from a URL rather than a search logs nothing
        // rather than logging a fake position.
        const rank = resultRef.current?.hits.findIndex((h) => h.id === id) ?? -1;
        void recordJobOpenedAction(lastSearchId, id, rank);
        // Same -1 rule as the line above, for the same reason: a job opened
        // from a URL has no rank in the current result set, and a fabricated
        // `position: -1` would quietly poison every position-ranked insight.
        // Not firing is the honest answer.
        //
        // One call site covers both SERP rows and the detail pane's "also in"
        // rail, because `onOpenRelated` is wired to this same function.
        if (rank >= 0) {
            captureEvent("result_clicked", {
                position: rank,
                job_id: id,
                source: "serp",
                // `resultRef.current?.searchId`, NOT `lastSearchId`: a
                // load-more page fetch mints its own `lastSearchId` but
                // `setResult` never overwrites `searchId` when appending a
                // page (see `loadMore`'s updater) — `result.searchId` is the
                // stable id for the WHOLE rendered list a row's position was
                // computed against, the same value `useResultImpressions` is
                // armed with below. That's the id a click must carry to join
                // back to the impression it came from (SPEC §5).
                ...(resultRef.current?.searchId ? { query_id: resultRef.current.searchId } : {}),
            });
            if (!user) recordGuestResultClick();
        }
        setOpensThisSession((n) => n + 1);
        const alreadyOpened = openedIds.has(id);
        setOpenedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
        if (hit) {
            recordRecentlyViewedJob({ id, title: hit.title, company: hit.company ?? "" });
        } else {
            const cached = getRecentlyViewedSnapshot().find((v) => v.id === id);
            if (cached) recordRecentlyViewedJob(cached);
        }
        // Viewed-jobs history (job_views): record the FIRST open of this job
        // this session only — a re-open of an already-`openedIds` job just
        // re-dims (existing behavior above), it shouldn't re-fire the write.
        // Fire-and-forget: `openJob` isn't async and the SERP shouldn't ever
        // block navigation on this. No snapshot to record when `hit` is
        // missing (a URL-opened job outside the current result set) — same
        // "don't fabricate" rule the rank telemetry above already follows.
        if (!alreadyOpened && hit) {
            markViewed(id);
            void recordJobViewAction(id, buildJobSnapshot(hit)).catch(() => {});
        }
        applyUrlState(buildUrlState({ jobId: id }), "push");
    };

    // "Hide already viewed" (job_views history feature) — the single choke
    // point every downstream derived list (`displayHits`, `clusters`,
    // `renderedClusters`) flows from, so the filter never needs re-applying
    // at each stage. `resultRef.current.hits` (rank/telemetry, `resultTotal`)
    // stays untouched — it reads straight off `result`, not this memo.
    // `openedIds` is folded in alongside the hook's own server+local
    // `viewedIds` so a job opened THIS render (before the round trip lands)
    // disappears immediately too, same as it already dims immediately below.
    const hits = useMemo(() => {
        const raw = result?.hits ?? [];
        // `viewedIds` (the hook's own server+local merge) union'd with this
        // render's `openedIds` — belt-and-suspenders so a just-opened job is
        // excluded even before the optimistic `markViewed` state re-renders.
        return applyViewedFilter(raw, buildViewedSet(viewedIds, openedIds, []), hideViewed);
    }, [result?.hits, viewedIds, openedIds, hideViewed]);

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

    // Whether to partition hits into titled vs mention blocks for display —
    // retrieval is whole-document; this flag is seam UI only
    // (`shouldScopeTextMatchToTitle`, sort.ts). Relevance ranking (explicit
    // or auto-defaulted) skips the partition.
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
    // Tiered-retrieval result (per-hit `tier` present — see
    // `runTieredRetrieval`, meilisearch.ts): the federation already ranks
    // strict-scope hits ahead of mention-only ones under every sort (verified
    // live, leg 7 A2-A5), so `hits` needs no client-side reordering — only a
    // seam index, placed by `tieredSeamIndex` from each hit's OWN `tier`
    // (never from `tier1Total`, an absolute count over the unfiltered pool —
    // `hits` here has already passed through `hideViewed` filtering above, so
    // indexing by a carried count lands on the wrong row whenever a filter
    // removes rows ahead of the seam). `null` means this isn't a tiered
    // result at all — fall back to the mention-based seam below.
    const { hits: displayHits, seamIndex } = useMemo(() => {
        const tieredSeam = tieredSeamIndex(hits);
        if (tieredSeam !== null) return { hits, seamIndex: tieredSeam };
        const q = result?.effectiveQ ?? "";
        if (sortScopedSeam) return partitionByTitleMatch(hits, q);
        return { hits, seamIndex: firstMentionIndex(hits.map((h) => decodeText(h.title)), q) };
    }, [hits, result, sortScopedSeam]);

    // Deliverable 3 — collapse repeat postings (same title, same company —
    // e.g. one role cross-posted at several locations) into one card each,
    // ranked at the earliest/best-ranked copy's position. `clusterJobs` is
    // pure (lib/jobs/cluster.ts); reads `displayHits`, not raw `hits`.
    const clusters = useMemo(() => clusterJobs(displayHits), [displayHits]);

    // The one scoring function (`scoreJobAgainstResume`, lib/match/score.ts)
    // computed once per result set, keyed by job id. Both the card chip
    // (JobCard below) and the `fitActive` resort just below reuse this SAME
    // map — the frozen "one scoring function" rule means the chip and the
    // visible order can never disagree about a job's score. `null` (no
    // résumé) short-circuits to no map at all, not a map of nulls.
    const matchScores = useMemo(() => {
        if (!resume) return null;
        const map = new Map<string, MatchScore | null>();
        for (const h of hits) map.set(h.id, scoreJobAgainstResume(resume, h));
        return map;
    }, [resume, hits]);

    // The receipt/toolbar's "against your résumé of {date}" text — formatted
    // once here (`shortDate`, presentation.ts, UTC-pinned) rather than at
    // each chip, then lowercased at this copy layer only: the design's "aug
    // 27" is a deliberate literal-lowercase style choice, not a locale
    // default, so it stays out of the shared date formatter.
    const resumeAsOfDate = useMemo(() => {
        if (!resumeUpdatedAt) return null;
        const ms = Date.parse(resumeUpdatedAt);
        return Number.isFinite(ms) ? shortDate(ms).toLowerCase() : null;
    }, [resumeUpdatedAt]);

    // `sort=fit`'s visible order: a stable resort of `clusters` by the same
    // per-job score above, applied client-side only while `fitActive`. This
    // is layered ON TOP of `clusters` rather than folded into the
    // `hits`/`displayHits`/`seamIndex` pipeline above — that machinery still
    // drives relevance-mode recall and the "titled it" seam exactly as
    // before. `sort=fit`'s actual backend mechanism is résumé-derived query
    // text (`applyFit` → `buildMatchQuery`) feeding ordinary relevance
    // ranking (see `resolveUrlSort`'s doc comment above) — this only
    // reorders what relevance already retrieved, so recall is untouched and
    // the visible order now matches the chip. `Array.prototype.sort` is
    // stable (ES2019+), so a tie (or a cluster with no score, -1) keeps its
    // original relevance position instead of shuffling.
    const renderedClusters = useMemo(() => {
        if (!fitActive || !matchScores) return clusters;
        return [...clusters].sort(
            (a, b) => (matchScores.get(b.primary.id)?.total ?? -1) - (matchScores.get(a.primary.id)?.total ?? -1),
        );
    }, [clusters, fitActive, matchScores]);

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
    // every cluster's primary, plus its variants only while expanded, in
    // `renderedClusters`' order (== `clusters`' order outside `fitActive`).
    // `handleResultsKeyDown` below walks THIS, not raw `hits`: arrow-key nav
    // must never land on a collapsed variant with no visible row to show as
    // selected, and must step in the same order the rows actually appear.
    const visibleHits = useMemo(
        () => renderedClusters.flatMap((c) => [c.primary, ...(expandedClusters.has(c.primary.id) ? c.variants : [])]),
        [renderedClusters, expandedClusters],
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
            setPostedExplicit(parsed.postedExplicit ?? false);
            setYearsExperience(parsed.yearsExperience);
            setHideGhosts(parsed.hideGhosts);
            setHideViewed(parsed.hideViewed);
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
    // never URL-represented. EXCEPT on the pristine landing below xl (item 5,
    // 2026-08-21; xl+ lift 2026-08-31): `hits[0]` there is a zero-intent
    // visitor's own first page-1 row, not a result of anything they did, so
    // defaulting to it reads as an arbitrary pick — the fetch effect above
    // already keeps `selectedId` null for exactly this case via
    // `shouldSuppressLandingAmbientPreview`, this mirrors that same gate so
    // the two can't drift into disagreeing about what "no selection" renders.
    const selected = useMemo(() => {
        if (!selectedId) {
            return shouldSuppressLandingAmbientPreview(isPristineLanding, isXlUp) ? null : (hits[0] ?? null);
        }
        return hits.find((h) => h.id === selectedId) ?? null;
    }, [hits, selectedId, isPristineLanding, isXlUp]);

    // Task 11 — dead-link EXISTENCE-CHECK CANDIDATE: a deliberate URL
    // selection that the CURRENT search's first page has already resolved
    // and still doesn't contain. `hits` is one PAGE=20 window of the
    // current search, filters, and sort — being absent from it does NOT
    // mean the role is gone; it may just rank 21st, or the visitor may be
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
        { id: string; status: "checking" } | ({ id: string } & ExistenceCheckStatus) | null
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
            // `detailFetcher.fetch` (lib/jobs/detail-fetch.ts) wraps
            // `runExistenceCheck` (lib/jobs/result-state.ts, unit-tested),
            // which owns the query shape (including why `hideGhosts` stays
            // false) and the found/not_found/unknown classification,
            // including a thrown request — see its doc comment. "unknown" is
            // not hypothetical: verified live that `id = ...` currently 400s
            // against production until the index picks up the
            // `filterableAttributes` addition in meilisearch.ts. Going
            // through `detailFetcher` here means a same-id fetch already
            // primed by `openJob` is joined rather than re-dispatched.
            const check = await detailFetcher.fetch(id, searchJobsActionRaw);
            if (!deadJobGuardRef.current!.isCurrent(token)) return;
            setDeadJobCheck({ id, ...check });
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

    // List hits omit `description` for payload size — hydrate the selected
    // in-list job on demand (same id lookup as the dead-job existence check).
    // Also doubles as the direct-open (`/jobs?job=<id>`) path's retry target:
    // that path's job comes from the existence check above instead, but a
    // "try again" hydrate for it lands here the same way.
    const [hydratedDetail, setHydratedDetail] = useState<{ id: string; job: PublicJob; descriptionPending: boolean } | null>(null);
    const detailHydrationGuardRef = useRef<FitIntentGuard | null>(null);
    if (!detailHydrationGuardRef.current) detailHydrationGuardRef.current = new FitIntentGuard();
    // Set by `retryDescription` to force the hydration effect below to
    // re-run for the SAME job id after a timed-out fill (its deps otherwise
    // only change on id/description, neither of which moves on retry).
    const [retryRequest, setRetryRequest] = useState<{ id: string; nonce: number } | null>(null);
    useEffect(() => {
        setHydratedDetail((prev) => (prev && prev.id === selectedId ? prev : null));
    }, [selectedId]);

    // The job to actually render in the detail pane/sheet — `selected`
    // (in `hits`) first, else the existence check's confirmed-alive job.
    const detailJob = useMemo(() => {
        const base = selected ?? deadJobFoundJob;
        if (!base) return null;
        if (hydratedDetail?.id === base.id) return hydratedDetail.job;
        // A retry in flight for `base` has already cleared `hydratedDetail`,
        // but `base` itself (e.g. the direct-open existence check's job)
        // can still carry a resolved `description` from BEFORE the retry —
        // render it as not-yet-hydrated so the pane shows "loading" instead
        // of a stale pending/empty note until the retry's result lands. Cast
        // matches the same known type/runtime gap `as PublicJob[]` already
        // carries for this field (see `PublicJob.description`'s doc comment).
        if (isDetailFetchInFlight({ detailId: base.id, hydratedId: hydratedDetail?.id ?? null, retryId: retryRequest?.id ?? null })) {
            return { ...base, description: undefined } as unknown as PublicJob;
        }
        return base;
    }, [selected, deadJobFoundJob, hydratedDetail, retryRequest]);

    useEffect(() => {
        const base = selected ?? deadJobFoundJob;
        if (!base) return;
        const fetchInFlight = isDetailFetchInFlight({
            detailId: base.id,
            hydratedId: hydratedDetail?.id ?? null,
            retryId: retryRequest?.id ?? null,
        });
        if (base.description !== undefined && !fetchInFlight) return;
        if (hydratedDetail?.id === base.id) return;
        const id = base.id;
        const token = detailHydrationGuardRef.current!.begin();
        void (async () => {
            // Joins the in-flight fetch `openJob`/`retryDescription` already
            // primed for this id (`detailFetcher`, lib/jobs/detail-fetch.ts)
            // instead of dispatching a second POST behind it in Next's
            // serial client-action queue.
            const check = await detailFetcher.fetch(id, searchJobsActionRaw);
            if (!detailHydrationGuardRef.current!.isCurrent(token)) return;
            if (check.status === "found") {
                setHydratedDetail({ id, job: check.job, descriptionPending: check.descriptionPending });
                // Consume the retry now that its fetch has landed — leaving it
                // set would re-trip `isDetailFetchInFlight` (and the loading
                // skeleton) every time this id is reselected for the rest of
                // the session, since `retryRequest` otherwise never clears.
                setRetryRequest((prev) => (prev?.id === id ? null : prev));
                return;
            }
            // A failed request or a genuine no-hit both still hydrate `base`
            // (its `description` moves from `undefined` to `null`, so the
            // guard above stops re-firing every render) rather than leaving
            // the pane on an endless skeleton with no retry affordance.
            // "unknown" marks it pending (retryable, same note the timeout
            // path shows); "not_found" marks it resolved-empty.
            setHydratedDetail({
                id,
                job: { ...base, description: null },
                descriptionPending: check.status === "unknown",
            });
            setRetryRequest((prev) => (prev?.id === id ? null : prev));
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id ?? deadJobFoundJob?.id, selected?.description ?? deadJobFoundJob?.description, retryRequest]);
    // Clears the cached (timed-out) hydrate and requests a fresh fetch for
    // whichever job is currently in the detail pane — wired to the pending
    // note's "try again" button, for both the SERP-hydrate and direct-open
    // (existence-check) sources.
    const retryDescription = useCallback(() => {
        const id = detailJob?.id;
        if (!id) return;
        // Prime the retry fetch FIRST, before the state updates below queue
        // any re-render work — same reasoning as `openJob`'s priming call:
        // Next's client action queue is strictly serial, so this POST must
        // be the one dispatched first. The hydration effect's own
        // `detailFetcher.fetch` call joins this same in-flight request.
        void detailFetcher.fetch(id, searchJobsActionRaw);
        setHydratedDetail(null);
        setRetryRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
    }, [detailJob?.id]);

    // Whichever source produced `detailJob` supplies its pending flag: the
    // most recent hydrate for this id if one landed, else the existence
    // check's own answer (direct-open path) — see
    // `resolveDetailDescriptionPending`'s doc comment.
    const detailDescriptionPending = useMemo(
        () =>
            resolveDetailDescriptionPending({
                detailId: detailJob?.id ?? null,
                hydrated: hydratedDetail ? { id: hydratedDetail.id, pending: hydratedDetail.descriptionPending } : null,
                found:
                    deadJobResolved?.status === "found"
                        ? { id: deadJobResolved.id, pending: deadJobResolved.descriptionPending }
                        : null,
            }),
        [detailJob?.id, hydratedDetail, deadJobResolved],
    );
    const detailPursuit = detailJob ? pursuitsByJobId.get(detailJob.id) : undefined;

    const mainJobsTourActive = tourActive && tourPageId === "jobs";

    useEffect(() => {
        const EXCEPTION_TOURS = ["jobs-relist", "jobs-stale", "jobs-exception-both"] as const;
        const exceptionTourActive =
            tourActive && EXCEPTION_TOURS.includes(tourPageId as (typeof EXCEPTION_TOURS)[number]);
        if (exceptionTourActive) return;

        const bothInDom = !!document.querySelector('[data-exception="both"]');
        const staleInDom = !!document.querySelector('[data-exception="stale"]');
        const relistInDom = !!document.querySelector('[data-exception="relisted"]');
        const kind = pickExceptionJit({
            mainTourActive: mainJobsTourActive,
            hasSeenMainTour: hasSeenTour("jobs"),
            exceptionTourActive: tourActive && exceptionTourActive,
            hasSeenBoth: hasSeenTour("jobs-exception-both"),
            hasSeenStale: hasSeenTour("jobs-stale"),
            hasSeenRelist: hasSeenTour("jobs-relist"),
            bothInDom,
            staleInDom,
            relistInDom,
            listingsVisible: hits.length > 0,
        });
        if (!kind) return;

        const tourId =
            kind === "both" ? "jobs-exception-both" : kind === "stale" ? "jobs-stale" : "jobs-relist";
        const id = requestAnimationFrame(() => startTour(tourId));
        return () => cancelAnimationFrame(id);
    }, [mainJobsTourActive, hasSeenTour, startTour, tourActive, tourPageId, selectedId, hits.length, detailJob?.id]);

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

    const total = result ? resolveHeadlineTotal(result) : 0;
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
    // #jobs-results-list container — the one mount point `useResultImpressions`
    // watches for rows crossing 50% visible (see the ref attached below).
    const resultsListRef = useRef<HTMLDivElement | null>(null);
    // `result?.searchId`, not `lastSearchId`: this is the id `loadMore`
    // leaves untouched when it appends a page (`setResult` spreads `...prev`
    // without overwriting `searchId` — see `loadMore` below), so it stays
    // the same rendered-result-set id across pagination and the hook does
    // NOT re-arm (already-seen rows on an appended page must not be
    // double-counted). A brand-new search/refinement replaces `result`
    // wholesale with a fresh `searchId`, which DOES re-arm — exactly the
    // "REFINED query" case SPEC §5 requires. This is the same value
    // `result_clicked`/`apply_clicked` read (via `resultRef.current
    // ?.searchId`) so impressions and the clicks they produce always join
    // on one query_id.
    useResultImpressions(resultsListRef, "serp", result?.searchId ?? "");

    // Fetch the next page and append it only while its monotonic generation is current.
    const loadMore = useCallback(async () => {
        // Once the anonymous depth wall has refused a page, the sentinel's
        // own IntersectionObserver keeps re-firing on every scroll (`total`
        // never drops below `hits.length` from a gated response — see the
        // `setResult` updater below, which never touches `total`). Without
        // this guard that would mean one refused request per re-intersect,
        // forever. Cleared only by `setDepthGateNote(null)` on a new search.
        if (depthGateNote) return;
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
                ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, locationDefaultSuppressed),
                limit: PAGE,
                offset: ticket.offset,
            });
            if (!paginationRef.current!.completeLoadMore(ticket)) return;
            // The ONLY gate signal is this response's own `meta.gated` — no
            // client-side copy of the depth-cap's 90/30 constants (see
            // load-more-outcome.ts's own doc comment).
            const outcome = interpretLoadMoreResponse({
                gated: r.meta?.gated === true,
                received: r.hits.length,
                requested: PAGE,
            });
            if (outcome === "gated") {
                // Refused, not searched — `r.hits`/`r.total` are not a real
                // (if empty) page, so `setResult` must never see them: doing
                // so would clobber the real total this search already has.
                setDepthGateNote(r.note ?? ANONYMOUS_DEPTH_GATE_MESSAGE);
                return;
            }
            // "depth" = which page this load-more just fetched (1-indexed);
            // fired once per genuinely-served page, never for a gated refusal.
            captureEvent("search_results_paged", { depth: Math.floor(ticket.offset / PAGE) + 1 });
            setResult((prev) => {
                if (!prev) return prev;
                // React may run this updater after another first-page generation
                // starts; check again at commit time before touching its results.
                if (!paginationRef.current!.isCurrentGeneration(ticket.generation)) return prev;
                const seen = new Set(prev.hits.map((h) => h.id));
                // Item 4: interleave just this newly-fetched page before
                // appending — the same chokepoint as the first-page fetch
                // above, applied per-page rather than over the whole
                // accumulated list (see `interleaveByCompany`'s doc comment).
                const fresh = interleaveByCompany(r.hits.filter((h) => !seen.has(h.id)));
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
        // session already cleared. `depthGateNote` added for the guard above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result, query, facets, salaryMin, visaOnly, postedBucket, yearsExperience, hideGhosts, board, companyDomain, sortOverride, postedDateSupported, locationDefaultSuppressed, depthGateNote]);

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

    const onHideViewed = (v: boolean) => {
        setHideViewed(v);
        applyUrlState(buildUrlState({ hideViewed: v }), "replace");
    };

    // Routed through `applyFilterState` (the per-render funnel) rather than the
    // memoized `applyFilterStateWithIntent`: that wrapper is a `useCallback`
    // keyed on `[flushSearchIntent]`, so it can hold a `buildUrlState` from an
    // earlier render and write a stale `sort`/`job` back into the URL. The
    // intent bookends are spelled out here for the same reason they were
    // before — this mutator engages mobile results and flushes a typed draft.
    const onBoardChange = (next: BoardId | null) => {
        setMobileResultsEngaged(true);
        applyFilterState({ ...filterState, board: next });
        flushSearchIntent();
    };

    /**
     * Widen a single-employer browse back to the whole corpus — the ✕ on the
     * employer token below.
     *
     * This used to be deliberately OUTSIDE `FilterState`, on the reasoning
     * that a "Clear filters" which dumped you out of the company you arrived
     * for was itself an undisclosed scope change. Reversed 2026-08-24 (Vivek):
     * holding corpus scope outside the one collection that means "everything
     * narrowing this search" is what let `board=elite` survive every query and
     * every clear while capping results at a few hundred domains, with nothing
     * on screen naming it. Scope is now a filter — visible, and reachable by
     * clear. The employer token stays as its own richer disclosure (see
     * `activeFilterEntries` on why it emits no second chip).
     */
    const clearCompanyScope = () => {
        applyFilterState({ ...filterState, companyDomain: null });
    };

    // (The effect that mirrored `facets.location_country[0]` back into the box
    //  was removed with the multi-place control: it would re-fill the field
    //  with the place just committed, so the next commit would add it twice.)

    // Sets every local FilterState field + pushes the matching URL replace in
    // one shot — the shared tail of both `clearAll` and a single chip's
    // `onRemove` (via `activeFilterEntries(...).clear`), so the two can never
    // drift on which fields a "clear" touches.
    const applyFilterState = (next: FilterState) => {
        for (const facet of changedFilterFacets(filterState, next)) {
            captureEvent("search_filter_applied", { facet });
        }
        setFacets(next.facets);
        setSalaryMin(next.salaryMin);
        setVisaOnly(next.visaOnly);
        setPostedBucket(next.postedBucket);
        setPostedExplicit(next.postedExplicit ?? false);
        setYearsExperience(next.yearsExperience);
        setHideGhosts(next.hideGhosts);
        setBoard(next.board);
        setCompanyDomain(next.companyDomain);
        applyUrlState(
            buildUrlState({
                facets: next.facets,
                salaryMin: next.salaryMin,
                visaOnly: next.visaOnly,
                postedBucket: next.postedBucket,
                postedExplicit: next.postedExplicit,
                yearsExperience: next.yearsExperience,
                hideGhosts: next.hideGhosts,
                board: next.board,
                companyDomain: next.companyDomain,
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

    /**
     * ADD a place to the filter, rather than replace the one already there.
     *
     * The corpus, the URL (`?country=a,b`) and place resolution have all
     * carried a LIST the whole time — `resolveLocationFacet` walks every
     * value and ORs the resolved clauses. Only this control collapsed it to
     * one, which is why "Canada and remote" could not be asked for.
     *
     * Adding is folded-compared (`addLocationValue`), so committing
     * "Montreal" when "Montréal" is already chosen is a no-op rather than a
     * second filter for the same city.
     *
     * Split from `clearLocations` below on purpose: the old single entry
     * point took `""` to mean "clear" and any other string to mean "set",
     * which is one parameter carrying two meanings — harmless while setting
     * replaced, actively wrong once it appends.
     */
    const addLocation = useCallback((value: string, field?: SuggestField) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (field === "work_type") {
            // The bare-work-mode suggestion ("Remote — anywhere") targets the
            // GLOBAL work_type facet directly, not a place — see
            // `planLocationQuery`'s `workModeOnly` branch. Add-only, matching
            // this function's own idempotent semantics for places: a second
            // click on an already-active mode is a no-op, never a removal
            // (unlike `toggleFacetValue`, which the Work-mode checkbox uses).
            const current = filterState.facets.work_type ?? [];
            const next = [...new Set([...current, ...parseWorkTypeTokens(trimmed).workTypes])];
            if (next.length === current.length) return;
            applyFilterStateWithIntent({ ...filterState, facets: { ...filterState.facets, work_type: next } });
            return;
        }
        // A suggestion carries the field it was advertised on
        // (`SuggestField`) — write into THAT field's own bucket, so it's
        // filtered as the exact literal it was counted as
        // (`resolvePickedFacetValue`, query-understanding.ts) instead of
        // being re-resolved as free text through the gazetteer, which is
        // what let a composite value ("US CA San Diego") or an ambiguous
        // bare name ("San Jose") mis-resolve against the wrong field/country
        // — the advertised count and the delivered count could disagree.
        // Free-typed text (`field` undefined) and a picked COUNTRY value
        // both fall back to the same `location_country` bucket they always
        // used, so neither one's behavior changes.
        const targetKey = field ?? "location_country";
        const current = filterState.facets[targetKey] ?? [];
        const next = addLocationValue(current, trimmed);
        if (next === current) return; // already filtered on this place
        applyFilterStateWithIntent({
            ...filterState,
            facets: { ...filterState.facets, [targetKey]: next },
        });
        if (user && query.trim()) {
            void saveAgentPreferencesAction({
                search: { query: query.trim(), location: next[0]?.trim() || undefined },
            }).catch(() => {});
        }
    }, [filterState, user, query, applyFilterStateWithIntent]);

    /** Drop every chosen place — what the field's own "✕ clear location"
     *  means. Removing ONE place is the chips row's job, which already has a
     *  ✕ per chip and needs no second affordance here. Clears every location
     *  field (`LOCATION_FACET_FIELDS`), matching `chosenLocations` above —
     *  a picked city/state lives in its own bucket, not just
     *  `location_country`. */
    const clearLocations = useCallback(() => {
        const nextFacets = { ...filterState.facets };
        for (const field of LOCATION_FACET_FIELDS) delete nextFacets[field];
        applyFilterStateWithIntent({ ...filterState, facets: nextFacets });
        if (user && query.trim()) {
            void saveAgentPreferencesAction({
                search: { query: query.trim(), location: undefined },
            }).catch(() => {});
        }
    }, [filterState, user, query, applyFilterStateWithIntent]);

    const handleLocationSheetContinue = useCallback(
        (draft: LocationSheetDraft, opts: { suppressDefault: boolean }) => {
            if (opts.suppressDefault) suppressLocationDefault();
            else if (draft.useDetected && locationDefaultSuppressed) restoreLocationDefault();
            const remoteValue = pickRemoteFacetValue(result?.facetDistribution);
            const next = applyLocationSheetDraft(draft, filterState, remoteValue);
            // Mirrors `addLocation`: the saved preference holds ONE location, so
            // it takes the first chosen place — read off the COMMITTED result
            // rather than re-derived from the draft's branches, so "what did we
            // filter on" has one answer instead of two that can disagree.
            const loc = next.facets.location_country?.[0]?.trim() ?? "";
            // The sheet writes the FACET (via `applyLocationSheetDraft`); the
            // entry box just goes back to empty rather than mirroring it.
            setLocationDraft("");
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

    // `docked.onClearChip` (below) has the same staleness risk `submitSearchRef`
    // above guards `submitSearch` against — `applyFilterState` closes over
    // `buildUrlState`'s many fields, and a clear fired from a stale render's
    // closure would push a stale `query`/`sort` back into the URL. `filterState`
    // itself needs the same guard: the dock effect only refires when
    // `activeChipsKey` changes, but a field like `companyDomain` mutates
    // `filterState` without touching any chip, so a clear fired between two
    // dock-effect runs must still start from the CURRENT full state, not the
    // one closed over at the last run.
    const applyFilterStateRef = useRef(applyFilterState);
    applyFilterStateRef.current = applyFilterState;
    const filterStateRef = useRef(filterState);
    filterStateRef.current = filterState;

    // --- docked search (header) ------------------------------------------
    // Once a search is active the header carries a live, typeable copy of
    // it — present immediately, no scrolling required, so the hero and the
    // header are never both offering a search at once (see `headerDockActive`
    // above and the hero/toolbar JSX that stand down on it).
    useEffect(() => {
        if (!headerDockActive) {
            setDocked(null);
            return;
        }
        setDocked({
            value: queryDraft,
            onChange: setQueryDraft,
            onSubmit: (v) => {
                searchAutocompleteRef.current?.close();
                submitSearchRef.current(v);
            },
            placeholder: SEARCH_PLACEHOLDER,
            // FacetBar-owned filters (salary, posted, work mode, experience)
            // render as dropdown chips — only the leftovers become dismiss chips.
            // The applied-location-default chip is PREPENDED by the same
            // `buildDockedChips` helper the mobile row's disclosure logic
            // shares, so this row never silently narrows results without a
            // visible, clearable chip the way the pre-dock-refactor bug did.
            chips: buildDockedChips(dockedDefaultLocationIso2, unnamedEntries.map((entry) => ({ key: entry.key, label: chipLabelForEntry(entry) }))),
            onClearChip: (key) => {
                if (key === DEFAULT_LOCATION_CHIP_KEY) {
                    suppressLocationDefault();
                    return;
                }
                const entry = unnamedEntries.find((e) => e.key === key);
                if (entry) applyFilterStateRef.current(entry.clear(filterStateRef.current));
            },
            filterCount: activeCount,
            filtersExpanded: filtersOpen,
            onOpenFilters: () => setFiltersOpen((v) => !v),
            // Live corpus count in the docked toolbar is deferred (2026-08-24) —
            // the row was cluttered; `/trends` still owns the full count story.
        });
        // `queryDraft` and `activeChipsKey`/`activeCount` — a STRING and
        // primitives — never `filterState`/`activeEntries` themselves. This
        // effect writes to a provider that lives above this component, so
        // its own `setDocked` re-renders us; an object/array literal rebuilt
        // every render would make the effect re-run on its own output
        // forever (React #185, "Maximum update depth exceeded" — the exact
        // defect this replaced, see the git history on this file). A
        // derived primitive changes only when the rendered content does.
    }, [headerDockActive, queryDraft, activeChipsKey, dockChipsKey, dockedDefaultLocationIso2, activeCount, filtersOpen, setDocked]);

    const facetsMountSite = resolveFacetsMountSite({ isXlUp, isLgUp, filtersOpen });
    const panelToggleFacet = (key: FacetKey, value: string) =>
        applyFilterStateWithIntent({ ...filterState, facets: toggleFacetValue(filterState.facets, key, value) });
    // Same guard `FilterChipsRow`'s own remote chip uses (`remoteValue ==
    // null` disables it) — the corpus's actual remote facet VALUE is never a
    // hardcoded "remote" literal, since it comes from live facet data.
    const onSelectRemote = () => {
        const remoteValue = pickRemoteFacetValue(result?.facetDistribution);
        if (remoteValue) panelToggleFacet("work_type", remoteValue);
    };
    const panelSalaryMin = (v: number) => applyFilterStateWithIntent({ ...filterState, salaryMin: v });
    const panelVisaOnly = (v: boolean) => applyFilterStateWithIntent({ ...filterState, visaOnly: v });
    const panelPostedBucket = (v: PostedBucket | undefined) =>
        applyFilterStateWithIntent({ ...filterState, postedBucket: v, postedExplicit: true });
    const panelYearsExperience = (v: YearsExperienceBucket | undefined) =>
        applyFilterStateWithIntent({ ...filterState, yearsExperience: v });
    const panelClearAll = () => applyFilterStateWithIntent(PRISTINE_FILTER_STATE);

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
        !upsellDismissed && !fitActive && opensThisSession >= RESUME_MOMENT_OPENS && !tourActive;

    // Guest save upsell banner — shown after the first anonymous save (either
    // "Go after" or a saved search) until dismissed. Signed-in users never see
    // it; the `guestSaveCount` and `guestSaveBannerDismissed` states are
    // seeded from localStorage post-mount so there's no SSR mismatch.
    const showGuestSaveBanner = !user && guestSaveCount >= 1 && !guestSaveBannerDismissed;
    const handleDismissGuestSaveBanner = () => {
        dismissGuestSaveBanner();
        setGuestSaveBannerDismissed(true);
    };
    const showGuestEngageNudge = shouldShowGuestEngageNudge({
        signedIn: Boolean(user),
        dismissed: guestEngageNudgeDismissed,
        showingSaveBanner: showGuestSaveBanner,
        resultClicks: guestEngageResultClicks,
        jobViews: guestEngageJobViews,
    });
    const handleDismissGuestEngageNudge = () => {
        dismissGuestEngageNudge();
        setGuestEngageNudgeDismissed(true);
    };

    // The job whose apply click is currently held open by the AI hand-off
    // prompt. Holding the job rather than a boolean keeps the dialog's content
    // and its "continue" target the same object the click started from.
    const [applyIntentJob, setApplyIntentJob] = useState<PublicJob | null>(null);

    // "Apply with tailored resume" / the fit-check drawer moved to MCP
    // 2026-08-02 — openTailor/handleTailor and the FitDrawer/
    // TailorAnalysisSheet mounts they drove are gone; guest Apply now opens
    // the ATS first, then auth for tracking (see `handleOpenPosting`).
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
        // A1 — only a signed-in departure arms the return prompt; guests
        // already left via this same call but auth for tracking is separate.
        if (user) armApplyReturnJob(job);
        window.open(job.apply_url, "_blank", "noopener,noreferrer");
    };

    const handleOpenPosting = (job: PublicJob) => {
        // Fired BEFORE the auth gate and the AI hand-off prompt, because the
        // event means "clicked Apply", not "reached the posting". Counting only
        // the clicks that survive both interstitials would hide exactly the
        // number worth knowing: comparing this against actual opens is what
        // measures the gate's drop-off. Moving it below either early return
        // would make that drop-off invisible.
        captureEvent("apply_clicked", {
            job_id: job.id,
            source: "serp",
            // Same `resultRef.current?.searchId` contract as `openJob`'s
            // `result_clicked` above — the id `useResultImpressions` is
            // armed with for the currently-rendered result set (SPEC §5).
            ...(resultRef.current?.searchId ? { query_id: resultRef.current.searchId } : {}),
        });
        const decision = resolveApplyClickDecision(Boolean(user));
        if (decision === "open-then-auth") {
            // ATS first — must stay synchronous in the click gesture; auth
            // after only marks applied (no second navigation).
            if (job.apply_url) openPostingNow(job);
            setAuthGateReason("apply");
            gate({ kind: "apply", payload: job });
            return;
        }
        // Offer the AI hand-off once, at the only moment it is worth anything.
        // Guests skip this path entirely (hollow without a résumé); signed-in
        // only.
        if (job.apply_url && shouldPromptApplyIntent()) {
            setApplyIntentJob(job);
            return;
        }
        openPostingNow(job);
    };

    const doMarkApplied = async (job: ApplyReturnJob) => {
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
            captureEvent("job_marked_applied", { job_id: job.id });
            toast.success("Marked as applied");
        } catch (e) {
            if (classifySentinel(e) === "auth") {
                setAuthOpen(true);
            } else {
                toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    };

    // A1 — apply-return capture (Zeigarnik Effect). Shared hook (board +
    // standalone `PublicJobDetail.tsx` both mount it — see its own comment):
    // `openPostingNow` above arms it on departure; it self-registers
    // visibilitychange/focus listeners and owns the one-shot decision. This
    // surface's "already applied" is the tracker's `pursuitsByJobId` map;
    // marking applied from the prompt reuses `doMarkApplied`, the exact
    // write "Mark as applied" uses, not a second copy of it.
    const { prompt: applyReturnPrompt, arm: armApplyReturnJob, markApplied: markApplyReturnApplied, dismiss: dismissApplyReturn } =
        useApplyReturnPrompt({
            isAlreadyApplied: (jobId) => {
                const pursuit = pursuitsByJobId.get(jobId);
                return !!pursuit && hasReachedStage(pursuit, "applied");
            },
            onMarkApplied: doMarkApplied,
        });

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

    // "Save" — signed out writes to the guest store immediately for the FIRST
    // save; on the second+ guest save, require sign-in so the list isn't
    // silently lost (progressive gating spec). Guest Apply no longer brick-
    // walls here (2026-09-10): `handleOpenPosting` opens ATS first, then
    // `gate({ kind: "apply" })` for tracking only — Save's 2nd-gate stays.
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
            // A guest's first save is a real save, so it counts. Fired here and
            // not at the top of the handler: the branch above this one opens the
            // auth popover instead of saving, and counting that click would
            // inflate saves with the exact clicks the gate rejected.
            captureEvent("job_saved", { job_id: job.id });
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
                // The signed-in save, counted only once the action came back
                // clean — the `res.error` branch above returns, and a thrown
                // error lands in the catch, so neither reaches this line.
                captureEvent("job_saved", { job_id: job.id });
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

    // Open the auth popover for a reason that has no replay of its own (only
    // shows a value line) — "save"'s guest-gate prompts below. Anything that
    // DOES need to replay after sign-in goes through `gate(...)` instead
    // (see `handleOpenPosting`'s guest branch, `beginResumeUpload`, the report
    // gate below),
    // which persists the action itself; this just opens the popover.
    const openAuth = (reason: AuthGateReason | null = null) => {
        setAuthGateReason(reason);
        setAuthOpen(true);
    };

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
    // alternate path/dismiss, same invariant the auth gate's own persisted
    // action keeps: only the latest intent survives. (A second variant,
    // `{ kind: "explore" }`,
    // existed here through 2026-08-02 — removed with the feature.)
    const resumeActionAfterImportRef = useRef<{ kind: "fit"; fitToken: number } | null>(null);

    // A successful in-place auth's replay (`handlers.upload` → `setImportOpen`)
    // reads `resumeActionAfterImportRef` moments before AuthPopover's own
    // `onOpenChange(false)` fires as it visually closes — unconditionally
    // clearing the ref on every close (via `clearPendingGate` below) would
    // wipe out what the replay just relied on. This flag distinguishes that
    // case from an actual dismiss-without-auth; it's a résumé-continuation
    // lifecycle concern, unrelated to the auth gate's own (sessionStorage)
    // pending-action bookkeeping.
    const justAuthedRef = useRef(false);

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
        setAuthOpen(false);
        resumeActionAfterImportRef.current = null;
    };

    // A usable résumé for a résumé-driven action (fit), fetched on demand.
    // Task 4 removed the mount-time auto-fetch, so `resume` local
    // state can still be empty for a returning user with one saved — check it
    // first (fast path, no network round-trip), else ask the server. Mirrors
    // `resumeIsUsable`'s bar exactly.
    const resolveUsableResume = async (): Promise<ResumeData | null> => {
        if (resume && resumeIsUsable(resume)) return resume;
        const { data, updatedAt } = await fetchResumeData();
        if (data && resumeIsUsable(data)) {
            setResume(data);
            setResumeUpdatedAt(updatedAt ?? null);
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
        const { q, facets: derived } = buildMatchQuery(r);
        const merged = mergeFacets(facets, derived);
        setFacets(merged);
        setQueryDraft(q);
        setQuery(q);
        setSortOverride(null);
        setFitActive(true);
        applyUrlState(buildUrlState({ q, facets: merged, sort: "fit" }), "replace");
    };

    // Resolve a usable résumé and apply fit if one is found — the guarded
    // core `resolve` callback `handleRankByFit` (below) passes to its own
    // fallback-to-uploader logic when this comes back `false`.
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
        setFitResolving(true);
        try {
            const token = fitIntentRef.current!.begin();
            const r = await resolveUsableResume();
            if (!fitIntentRef.current!.isCurrent(token)) return true;
            if (r) {
                applyFit(r);
                return true;
            }
            return false;
        } finally {
            setFitResolving(false);
        }
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

    // The segmented sort control's third segment: résumé-aware "Best match"
    // when one is on file, plain "Relevance" otherwise (see the ToolbarSegment
    // mount sites below for the label/title split on `resumeOnFile`).
    const chooseBestMatch = () => {
        fitIntentRef.current!.begin();
        if (resumeOnFile === true) {
            void resolveAndApplyFit();
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
    // résumé", the setup wizard's "Add résumé", any future one) must go
    // through `beginResumeUpload`, not `setImportOpen(true)`
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
    const beginResumeUpload = () => {
        clearPendingGate();
        resumeActionAfterImportRef.current = { kind: "fit", fitToken: fitIntentRef.current!.begin() };
        if (!user) {
            setAuthGateReason("generic");
            gate({ kind: "upload", payload: true });
            return;
        }
        setImportOpen(true);
    };

    // Every OTHER résumé-upload entry point (the fit-rank fallback above, the
    // résumé-moment card, the "update to rescore" link) goes through this
    // name — it is just `beginResumeUpload` under a stable identifier so
    // those call sites don't need to change.
    const handleUploadClick = () => {
        beginResumeUpload();
    };

    const handleImport = (data: ResumeData, source: "pdf" | "docx" | "text", confidence: number) => {
        setResume(data);
        // Saved in the same beat, just below — the on-screen "as of" date is
        // this moment, not whatever `saveResumeData`'s fire-and-forget write
        // eventually timestamps server-side.
        setResumeUpdatedAt(new Date().toISOString());
        setImportOpen(false);
        // Persist to the profile so returning users skip the upload step (best-effort).
        // The capture rides the SAME promise, not a synchronous fire — a failed
        // save must not report a success that didn't happen.
        void saveResumeData(data, source, confidence)
            .then(() => captureEvent("resume_uploaded", {}))
            .catch(() => {});
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

    const searchAlertFilterCount = activeEntries.length;
    const searchAlertQueryLength = query.trim().length;
    const showZeroResultsSearchAlert =
        !user &&
        shouldShowSearchAlertCapture({
            signedIn: !!user,
            dismissed: searchAlertDismissed,
            submitted: searchAlertSubmitted,
            interactions: searchInteractions,
            hasResults: false,
        });
    const hasResultsPanel =
        resultsPanel !== "empty" &&
        resultsPanel !== "loading" &&
        resultsPanel !== "error" &&
        resultsPanel !== "not-connected" &&
        resultsPanel !== "serp-ask";
    const showResultsSearchAlert =
        !user &&
        hasResultsPanel &&
        shouldShowSearchAlertCapture({
            signedIn: !!user,
            dismissed: searchAlertDismissed,
            submitted: searchAlertSubmitted,
            interactions: searchInteractions,
            hasResults: true,
        });

    const handleDismissSearchAlert = useCallback(() => {
        dismissSearchAlertCapture();
        setSearchAlertDismissed(true);
    }, []);

    useEffect(() => {
        if (searchParams.get("search_alert") !== "1") return;
        if (searchAlertVerifiedRef.current) return;
        searchAlertVerifiedRef.current = true;
        captureEvent("search_alert_verified", {
            surface: resultsPanel === "empty" ? "zero_results" : "results",
            query_length: searchAlertQueryLength,
            filter_count: searchAlertFilterCount,
            has_results: resultsPanel !== "empty",
        });
    }, [searchParams, resultsPanel, searchAlertQueryLength, searchAlertFilterCount]);

    // SERP-ask's tappable seeds — recent searches first, then the curated
    // fallback list, deduped to ~8 (lib/jobs/recent-searches.ts,
    // unit-tested). Cheap and pure, so computed unconditionally rather than
    // gated on `isSerpAsk` — matches this file's other render-prep consts.
    const searchSeeds = resolveSearchSeeds(recentSearches);

    const mobileLocationLabel = locationTriggerLabel(filterState, result?.defaultedLocation);
    // The category chip whose search query matches the current COMMITTED query
    // (case-insensitive) AND whose text also matches the draft (i.e. the user
    // has not yet typed something different in the search box without
    // submitting). Both guards are necessary: `query` alone would leave the
    // chip highlighted while the user is mid-edit typing an unrelated term,
    // which is the exact ambiguity the "active chip only when committed query
    // matches" rule exists to prevent (req 4). When non-null, "Searching:
    // [title]" renders near the chips row to bridge the gap between the
    // human field name (e.g. "Nursing and patient care") and the underlying
    // search query (e.g. "Registered Nurse").
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
            ? searchResultLine({ count: totalCount, postedBucket: appliedPosted, lastUpdated, nowMs })
            : null;

    // "N more beyond 30 days — show all" affordance (2026-08-12) — gated on
    // `resultCountLine` being present so the affordance can never appear
    // before the FIRST real result for the active filters has landed —
    // `totalCount` defaults to an exact zero before that,
    // which would otherwise let `resolveBeyondWindow` render a spurious
    // number the moment `beyondWindowCount` resolves ahead of `totalCount`.
    const beyondWindow = resultCountLine
        ? resolveBeyondWindow(appliedPosted, totalCount, beyondWindowCount)
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

    // Deliverable 2 — a typed location phrase this corpus couldn't filter on
    // (see `unmatchedPlaceNote`, result-state.ts) got dropped rather than
    // kept as a doomed exact-facet predicate; this is the honest caption for
    // that, same shape as `degradedNote` above.
    const unmatchedNote = unmatchedPlaceNote(result?.unmatchedPlaceMentions);

    // Two-Panel Selector (master-detail) — single source of truth for where
    // the shared detail ternary mounts (Sheet below xl, pane at xl+, and —
    // 2026-08-14 auto-preview — the pane again for the ambient first result
    // when nothing is explicitly open; see resolveDetailMountSite's doc
    // comment for the render-only/telemetry contract). `Boolean(detailJob)`,
    // not `hits.length > 0` — there being hits to LIST is a different fact
    // from there being a job to PREVIEW; below xl on pristine landing those
    // diverge (hits present, preview suppressed), at xl+ they converge again
    // via ambient `hits[0]` without writing `?job=`.
    const detailMountSite = resolveDetailMountSite(isXlUp, detailSheetOpen, Boolean(detailJob));
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
        clusterProps?: { variantCount: number; clusterLabel: string; expanded: boolean; onToggleExpand: () => void },
        tourAnchor = false,
    ) => {
        // 1-based position in `hits` — the same rendered list `openJob`'s
        // click-rank reads (findIndex against the currently-shown result
        // set), just re-based to 1 for the impression-tracking contract.
        // -1 (a variant row whose job_id isn't itself an entry in `hits`)
        // becomes 0, which JobCard treats as "don't stamp data-position" —
        // the same rows `openJob`'s rank already can't attribute a click to.
        const rank = hits.findIndex((h) => h.id === j.id);
        return (
            <JobCard
                key={j.id}
                job={j}
                active={activeRowId === j.id}
                opened={openedIds.has(j.id) || viewedIds.has(j.id)}
                onClick={() => openJob(j.id)}
                onCompany={j.company_domain ? handleCompany : undefined}
                onOpenPosting={handleOpenPosting}
                now={nowMs}
                elite={board === "elite"}
                variantCount={clusterProps?.variantCount ?? 0}
                clusterLabel={clusterProps?.clusterLabel ?? ""}
                expanded={clusterProps?.expanded ?? false}
                onToggleExpand={clusterProps?.onToggleExpand}
                tourAnchor={tourAnchor}
                matchScore={matchScores?.get(j.id) ?? null}
                matchAsOfDate={resumeAsOfDate}
                pursuit={pursuitsByJobId.get(j.id)}
                onGoAfter={() => handleGoAfter(j)}
                goingAfter={goingAfterId === j.id}
                position={rank >= 0 ? rank + 1 : undefined}
            />
        );
    };

    const handleClearSearch = () => {
        setQueryDraft("");
        setQuery("");
        setLocationDraft("");
        applyUrlState(buildUrlState({ q: "" }), "replace");
        const nextFacets = { ...filterState.facets };
        delete nextFacets.location_country;
        // Clearing the search clears the scope it ran against. Guarded (rather
        // than applied unconditionally) only to keep a no-op clear from
        // issuing a redundant URL replace — the same reason the facet-count
        // comparison was here before scope joined it.
        const droppedLocation = Object.keys(nextFacets).length !== Object.keys(filterState.facets).length;
        const hadScope = filterState.board !== null || filterState.companyDomain !== null;
        if (droppedLocation || hadScope) {
            applyFilterState({ ...filterState, facets: nextFacets, board: null, companyDomain: null });
        }
    };

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
                    source="serp"
                    signedIn={Boolean(user)}
                    onRequestSignIn={() => {
                        setAuthGateReason("generic");
                        gate({ kind: "report", payload: detailJob });
                    }}
                    onOpenPosting={() => handleOpenPosting(detailJob)}
                    onGoAfter={() => handleGoAfter(detailJob)}
                    onOpenRelated={openJob}
                    variants={detailVariants}
                    pursuit={detailPursuit}
                    goingAfter={goingAfterId === detailJob.id}
                    onClose={onClose}
                    reportJobEnabled={reportJobEnabled}
                    reportDialogOpen={reportDialogOpen}
                    onReportDialogOpenChange={setReportDialogOpen}
                    collapseDescription={collapseDescription}
                    className="border-0 bg-transparent"
                    descriptionPending={detailDescriptionPending}
                    onRetryDescription={retryDescription}
                />
                {!collapseDescription && (
                <JobDetailActionBar
                    job={detailJob}
                    signedIn={Boolean(user)}
                    onOpenPosting={() => handleOpenPosting(detailJob)}
                    onGoAfter={() => handleGoAfter(detailJob)}
                    pursuit={detailPursuit}
                    goingAfter={goingAfterId === detailJob.id}
                />
                )}
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
    /**
     * The filter controls, written once for all three mount sites (expand,
     * bottom sheet, dense rail). Only `layout` differs — see SerpFilters's own
     * prop doc for why the rail cannot just be a narrower panel.
     */
    const renderFiltersPanel = (layout: "panel" | "rail" = "panel") => (
        <>
            {result?.configured && (
                <div role="group" aria-label="Sort" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 lg:hidden">
                    {postedDateSupported && (
                        <ToolbarSegment
                            label="freshest"
                            pressed={!fitActive && effectiveSort === "newest"}
                            onClick={() => chooseSort("newest")}
                        />
                    )}
                    <ToolbarSegment
                        label="top pay"
                        pressed={!fitActive && effectiveSort === "salary_desc"}
                        onClick={() => chooseSort("salary_desc")}
                    />
                    <ToolbarSegment
                        label={resumeOnFile === true ? "best match" : "relevance"}
                        title={resumeOnFile === true ? "Matched by your résumé" : undefined}
                        pressed={fitActive || (!fitActive && effectiveSort === "relevance")}
                        onClick={chooseBestMatch}
                        pending={fitResolving}
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
                onYearsExperience={panelYearsExperience}
                onClearAll={panelClearAll}
                hideGhosts={hideGhosts}
                onHideGhosts={onHideGhosts}
                ghostHiddenCount={ghostHiddenCount}
                hideViewed={hideViewed}
                onHideViewed={onHideViewed}
                board={board === "elite" ? "elite" : "all"}
                onBoardChange={(b) => onBoardChange(b === "elite" ? "elite" : null)}
                layout={layout}
            />
        </>
    );

    /**
     * The "Browse by field" replace-query shortcut, defined once because it
     * has two mount sites and only ever one at a time: inside the hero well
     * when the well is the search, and on the toolbar's control line once the
     * header owns the search (`headerDockActive`) and the well no longer
     * renders. Each site supplies its own wrapper — this is just the control,
     * so neither site inherits the other's spacing. Extracted rather than
     * copied: two literal copies of a menu is two places for its item list to
     * drift apart.
     */
    const fieldDirectoryMenu = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    data-testid="field-directory-trigger"
                    className={cn(
                        chipVariants({ active: activeCategory != null }),
                        toolbarControlHeight,
                        "inline-flex box-border shrink-0 items-center justify-center gap-1 whitespace-nowrap px-3 text-xs font-semibold leading-none transition-colors lg:px-2",
                    )}
                >
                    {activeCategory ? activeCategory.title : "Browse by field"}
                    <CaretDown size={16} weight="bold" aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]">
                {indexCategories.map((cat) => {
                    const isMatch =
                        query.toLowerCase() === cat.q.toLowerCase() &&
                        queryDraft.toLowerCase() === cat.q.toLowerCase();
                    return (
                        <DropdownMenuItem
                            key={cat.q}
                            onSelect={() => submitSearch(cat.q)}
                            className="flex items-center justify-between gap-3 text-sm"
                        >
                            <span>{cat.title}</span>
                            {isMatch && <Check weight="bold" aria-hidden />}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const savedSearchControl = canSaveSearch ? (
        <SavedSearchesPanel
            saved={savedSearches}
            urlState={buildUrlState()}
            canSave={canSaveSearch}
            onApply={applySavedSearch}
            onBeforeGuestSave={!user ? handleBeforeGuestSavedSearch : undefined}
            compact
        />
    ) : null;

    // Band ghost word — the résumé entry point that replaces the deleted
    // foot-of-list invite. Same look as `SavedSearchesPanel`'s own compact
    // trigger (SavedSearchesPanel.tsx's `save-search-trigger`): a ghost
    // word, no icon, brand text. `handleRankByFit` already falls through to
    // the uploader when no résumé resolves, so this is the one call every
    // other résumé entry point on this page also uses.
    //
    // Composed at the two `savedSearchControl` mount sites below rather
    // than folded into that variable itself: `savedSearchControl` is `null`
    // whenever `canSaveSearch` is false (the pristine landing, no query/
    // filters/sort yet) — exactly the moment a résumé-less visitor most
    // needs this entry — and a THIRD mount site (the "active-category-
    // indicator" row above) has its own outer render gate keyed to the
    // documented `savedSearchControl ⟺ canSaveSearch` equivalence; folding
    // this in there would either hide the word on that first landing or
    // silently invalidate that gate. `savedSearchMountEl` carries both
    // without touching either.
    const rankByFitEl = showResumeEntry ? (
        <button
            type="button"
            data-testid="jobs-rank-by-fit"
            title="Add your résumé to rank these roles by fit"
            onClick={() => void handleRankByFit()}
            className={cn(
                chipVariants({ active: false }),
                toolbarControlHeight,
                "inline-flex box-border shrink-0 items-center justify-center whitespace-nowrap leading-none rounded-none px-3 lg:px-2",
            )}
        >
            Rank by fit
        </button>
    ) : null;

    const savedSearchMountEl =
        rankByFitEl || savedSearchControl ? (
            <>
                {rankByFitEl}
                {savedSearchControl}
            </>
        ) : null;

    const clearFiltersEl = activeCount > 0 ? (
        <button
            type="button"
            data-testid="results-clear-filters"
            onClick={panelClearAll}
            className={cn(
                toolbarControlHeight,
                "inline-flex shrink-0 items-center whitespace-nowrap px-2 text-xs text-danger-text transition-colors hover:opacity-80",
            )}
        >
            Clear ({activeCount})
        </button>
    ) : null;

    const facetBarEl = (
        <FacetBar
            distribution={result?.facetDistribution}
            state={filterState}
            postedDateSupported={postedDateSupported}
            onToggleFacet={panelToggleFacet}
            onSalaryMin={panelSalaryMin}
            onPostedBucket={panelPostedBucket}
        />
    );

    const tourReplayEl = <JobsTourReplayButton />;

    // Where the depth-gate CTA's "Sign in" link returns to — this exact
    // SERP, filters and all. Same `/login?next=` shape used everywhere else
    // sign-in is a detour rather than a destination (e.g. CompanyExhaustGate).
    const depthGateSignInHref = `/login?next=${encodeURIComponent(`${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`)}`;

    const dockedQueryEl = (
        <div className="relative flex h-full w-full items-center">
            <SearchAutocomplete
                ref={searchAutocompleteRef}
                value={queryDraft}
                onChange={setQueryDraft}
                onSearch={() => {
                    searchAutocompleteRef.current?.close();
                    submitSearch(queryDraft);
                }}
                onClear={() => {
                    setQueryDraft("");
                    submitSearch("");
                }}
                suggest={suggestForBox}
                seeds={searchSeeds}
                placeholder={SEARCH_PLACEHOLDER}
                className="h-full min-h-0 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:border-0 focus-visible:bg-transparent"
                containerClassName="h-full min-w-0 flex-1 overflow-visible"
            />
        </div>
    );

    const dockedLocationEl = (
        <div className="relative flex h-full w-full items-center">
            <LocationCombobox
                value={locationDraft}
                onChange={setLocationDraft}
                onCommit={addLocation}
                selected={chosenLocations}
                data-testid="topbar-docked-location-input"
                className="h-full min-h-0 min-w-0 flex-1 rounded-none border-0 bg-transparent pl-1 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0"
                containerClassName="h-full min-w-0 flex-1 overflow-visible"
            />
            {(locationDraft || chosenLocations.length > 0) && (
                <button
                    type="button"
                    data-testid="topbar-docked-location-clear"
                    aria-label="Clear location"
                    title="Clear location"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        setLocationDraft("");
                        clearLocations();
                    }}
                    className="mr-1 flex h-6 w-6 shrink-0 self-center items-center justify-center rounded-none text-muted-foreground transition-colors hover:text-foreground"
                >
                    <X size={20} aria-hidden />
                </button>
            )}
        </div>
    );

    // "Sort: Relevance" text + chevron opening the standard DropdownMenu
    // primitive (rulebook: a menu, not a segmented/pressed control — a
    // segmented group always has exactly one filled segment, which reads as
    // a filled button living in a region required to carry zero).
    const relevanceLabel = resumeOnFile === true ? "Best match" : "Relevance";
    const sortLabel =
        !fitActive && effectiveSort === "newest"
            ? "Freshest"
            : !fitActive && effectiveSort === "salary_desc"
              ? "Top pay"
              : relevanceLabel;
    const sortEl = result?.configured ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Sort"
                    data-testid="jobs-sort-trigger"
                    className="hidden shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-foreground transition-colors hover:text-brand lg:inline-flex"
                >
                    {fitResolving && <CircleNotch size={16} className="animate-spin shrink-0" aria-hidden />}
                    Sort: {sortLabel}
                    <CaretDown size={16} aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {postedDateSupported && (
                    <DropdownMenuItem
                        data-testid="jobs-sort-newest"
                        onSelect={() => chooseSort("newest")}
                        className="flex items-center justify-between gap-3 text-sm"
                    >
                        <span>Freshest</span>
                        {!fitActive && effectiveSort === "newest" && <Check weight="bold" aria-hidden />}
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem
                    data-testid="jobs-sort-salary"
                    onSelect={() => chooseSort("salary_desc")}
                    className="flex items-center justify-between gap-3 text-sm"
                >
                    <span>Top pay</span>
                    {!fitActive && effectiveSort === "salary_desc" && <Check weight="bold" aria-hidden />}
                </DropdownMenuItem>
                <DropdownMenuItem
                    data-testid="jobs-sort-relevance"
                    onSelect={chooseBestMatch}
                    title={resumeOnFile === true ? "Matched by your résumé" : undefined}
                    className="flex items-center justify-between gap-3 text-sm"
                >
                    <span>{relevanceLabel}</span>
                    {(fitActive || (!fitActive && effectiveSort === "relevance")) && (
                        <Check weight="bold" aria-hidden />
                    )}
                </DropdownMenuItem>
                {showResumeEntry && (
                    <DropdownMenuItem
                        data-testid="jobs-sort-fit"
                        onSelect={() => void handleRankByFit()}
                        className="flex items-center justify-between gap-3 text-sm"
                    >
                        <span>Rank by fit</span>
                        <span className="text-xs text-muted-foreground">add résumé</span>
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null;

    // "scored against your résumé of {date} · update to rescore" — the
    // match-score receipt's one-time-parse honesty statement (design's
    // `.asof`, right-aligned in the toolbar). Gated on `hasUsableResume`
    // (same bar every other résumé-driven control here uses) rather than
    // `fitActive`: chips render on every card whenever a résumé is loaded,
    // not only while sorted by fit, so this line's gate matches the chips',
    // not the sort control's. `handleUploadClick` is the SAME "open the
    // importer" entry point "Add résumé"/"My résumé" already use — updating
    // is the one act that re-runs the AI parse, so it's the only place this
    // date can move.
    const asOfEl =
        hasUsableResume && resumeAsOfDate ? (
            <span
                data-testid="resume-as-of"
                className="mono-data hidden shrink-0 items-center gap-1 text-xs text-muted-foreground lg:inline-flex"
            >
                scored against your résumé of {resumeAsOfDate} ·{" "}
                <button type="button" onClick={handleUploadClick} className="text-brand hover:underline">
                    update to rescore
                </button>
            </span>
        ) : null;

    const showJobsToolbarRow = !headerDockActive;
    const showJobsToolbarSection =
        showJobsToolbarRow || (!headerDockActive && facetsMountSite !== null);

    /**
     * The live-count link, same markup regardless of where it renders. Two
     * call sites need it: the mobile search well below (only once the
     * landing masthead has stopped owning it) and the masthead itself, which
     * is the only place this count appears on lg+ now that the TopBar ticker
     * is gone (2026-08-24) — extracted so neither site can drift from the
     * other's copy or styling.
     */
    const liveCountEl = liveJobsCount !== null && (
        <Link
            href="/trends"
            data-testid="search-live-count"
            className="mb-2 inline-flex items-center gap-1.5 whitespace-nowrap mono-data text-xs font-semibold text-brand transition-colors hover:text-brand"
        >
            <span aria-hidden className="h-1.5 w-1.5 rounded-none bg-live" />
            {formatCorpusCount(liveJobsCount)} live roles
        </Link>
    );

    /**
     * `/jobs` renders one layout, not two: the search line, filter toggle,
     * and result count stay mounted whether the query is empty
     * (`isSerpAsk` — tappable search seeds, chrome preserved) or has
     * results. The full-screen automation-first hero lives on `/`
     * (`src/app/page.tsx`), not on this route.
     */
    return (
        <div className="min-h-screen">
            {/* `data-shell="bleed"` is this page ASKING for the full window;
                globals.css turns that into `--shell-max: none` for the header
                and footer too, so all three left edges stay together. Each
                child then decides whether it caps itself
                (`cappedContentClass`) — masthead, search shell and toolbar
                deliberately don't, so they line up against the same gutter,
                and the results grid is the one thing that stops widening. */}
            <div data-shell="bleed" className="shell-row flex min-h-screen flex-col pb-20 pt-2 sm:pt-3">
                {/* Landing masthead — mounts only for a zero-intent pristine
                    visitor (`showLandingMarketing`), at every width, not just
                    mobile: the header's docked search took over the box on
                    lg+ but never stated what the corpus IS or where it's
                    from. Was authored (`LandingMasthead`) but never mounted
                    anywhere on this route (2026-08-21 front-door audit, item
                    2; frozen front-door redesign, 2026-08-26). Once a search
                    runs, this unmounts in favor of the sr-only heading so the
                    page still carries exactly one h1. */}
                {showLandingMarketing ? (
                    <div className="pb-2">
                        <div className="border-b border-border py-2 sm:py-3">
                            <p className="mb-2 text-xs font-semibold text-brand">
                                Live from employer career pages
                            </p>
                            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
                                {JOBS_USP.mastheadTitle}
                            </h1>
                            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                                {JOBS_USP.searchDescription}
                            </p>
                            {liveCountEl}
                        </div>
                    </div>
                ) : (
                    <h1 className="sr-only">Jobs</h1>
                )}
                <a
                    href="#jobs-results-list"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:border focus:border-foreground focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
                >
                    Skip to results
                </a>

                {/* Stands down entirely once the header owns the search
                    (2026-08-24, Vivek: the docked version left this well on
                    screen holding a count and one dropdown). Gating only the
                    inner search line — which is what the dock originally did —
                    kept painting the raised fill, the accent rule and the
                    padding around an empty box, so the page's single strongest
                    emphasis pointed at nothing and the height the dock claimed
                    to reclaim was never actually reclaimed. The children that
                    outlive the search line have their own homes on the header
                    row and the toolbar; see `status` on the dock payload and
                    `fieldDirectoryMenu`. */}
                {!headerDockActive && (
                <section
                    className="rounded-none border border-border bg-card p-2 sm:p-2.5 transition-colors"
                >
                    {/* The live count, moved here off the TopBar. Same /trends
                        destination it always had — it is a way into the report,
                        not a badge. Absent until a real count resolves.
                        Suppressed during the landing masthead, which already
                        renders this same `liveCountEl` itself — otherwise a
                        mobile pristine visitor would see the count twice. */}
                    {!showLandingMarketing && liveCountEl}
                    {/* Collapses once the header carries a live copy of this
                        search (`headerDockActive`, lg+ only) — the reclaimed
                        height goes straight to results instead of two typing
                        surfaces sitting on screen at once. Below `lg`,
                        `headerDockActive` is always false (the header dock
                        never shows there — see TopBar), so this row stays
                        put and the sticky mobile CTA keeps owning search. */}
                    {!headerDockActive && (
                    <div data-search-line className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2.5">
                        {/* `bg-card`, not `bg-background`: inside the raised well
                            the field has to be the brightest thing on the page,
                            which is the only direction contrast can go on a
                            light ground. */}
                        <div
                            data-tour="jobs-search"
                            // Item 7a: React's `onFocus` listens on `focusin`
                            // under the hood (unlike the native DOM `focus`
                            // event), so it bubbles from either child input —
                            // one handler here covers both without changing
                            // `SearchAutocomplete`'s own props.
                            onFocus={() => setMobileSearchFocused(true)}
                            className="flex flex-col rounded-none border border-border bg-card divide-y divide-border focus-within:border-foreground focus-within:ring-1 focus-within:ring-foreground sm:flex-1 sm:flex-row sm:divide-y-0 sm:divide-x">
                            <div className="relative flex min-w-0 w-full sm:flex-1 items-center">
                                <SearchAutocomplete
                                    ref={searchAutocompleteRef}
                                    value={queryDraft}
                                    onChange={(v) => {
                                        setQueryDraft(v);
                                    }}
                                    onSearch={() => submitSearch(queryDraft)}
                                    // NOT `results-clear-query` — that is the toolbar's
                                    // "✕ clear search", which also drops the location draft
                                    // and the location_country facet. This one empties the
                                    // field and re-runs, nothing else. Two behaviours behind
                                    // one testid made either selector ambiguous.
                                    onClear={() => {
                                        setQueryDraft("");
                                        submitSearch("");
                                    }}
                                    suggest={suggestForBox}
                                    seeds={searchSeeds}
                                    placeholder={SEARCH_PLACEHOLDER}
                                    leadingIcon={<MagnifyingGlass size={16} weight="bold" />}
                                    className="h-11 sm:h-[56px] w-full min-w-0 rounded-none border-0 bg-transparent px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:border-0"
                                    containerClassName="min-w-0 w-full"
                                />
                            </div>
                            {/* Glyph as a row sibling, not an absolute overlay +
                                `pl-*` on the field — same reason as
                                SearchAutocomplete's (see its doc comment): padding
                                is a shared tailwind-merge axis and an overlay only
                                stays clear of the text while nobody touches it. */}
                            <div className="relative flex w-full items-center sm:max-w-[210px] sm:flex-[0_1_210px]">
                                <span aria-hidden className="pointer-events-none flex shrink-0 items-center pl-3.5 text-muted-foreground">
                                    <MapPin size={16} weight="bold" />
                                </span>
                                <button
                                    type="button"
                                    data-testid="location-picker-trigger"
                                    aria-label={mobileLocationLabel}
                                    title={mobileLocationLabel}
                                    onClick={() => setLocationSheetOpen(true)}
                                    className="flex h-11 min-w-0 flex-1 items-center truncate rounded-none border-0 bg-transparent px-3 text-left text-base text-foreground lg:hidden"
                                >
                                    <span className={cn("truncate", mobileLocationLabel === "City, state, or remote" && "text-muted-foreground")}>
                                        {mobileLocationLabel}
                                    </span>
                                </button>
                                {/* Desktop only — below lg this field is replaced by
                                    `location-picker-trigger` and its sheet. The
                                    combobox owns its own dropdown, so the hiding
                                    moves to its container: an absolutely-positioned
                                    panel has to hang off the same box that is being
                                    shown or hidden. */}
                                <LocationCombobox
                                    value={locationDraft}
                                    onChange={setLocationDraft}
                                    onCommit={addLocation}
                                    selected={chosenLocations}
                                    containerClassName="hidden lg:flex"
                                    className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 sm:h-[56px]"
                                />
                                {/* Location's own one-tap clear, matching the query
                                    field's `search-input-clear`. The toolbar's "✕ clear
                                    search" chip used to be the only one-tap way to empty
                                    this; with that chip gone the affordance moves into
                                    the field it acts on, which is where a searcher looks
                                    for it anyway. A flex sibling rather than an absolute
                                    overlay — this row owns its own layout (see the pin
                                    glyph above), so it needs no reserved padding to
                                    avoid the text.

                                    `lg:flex` matches the input's own visibility: below
                                    lg this field is replaced by `location-picker-trigger`
                                    and its sheet, which carries its own clear. */}
                                {(locationDraft || chosenLocations.length > 0) && (
                                    <button
                                        type="button"
                                        data-testid="location-input-clear"
                                        aria-label="Clear location"
                                        title="Clear location"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            setLocationDraft("");
                                            clearLocations();
                                        }}
                                        className="mr-2 hidden h-6 w-6 shrink-0 items-center justify-center rounded-none bg-muted text-muted-foreground transition-colors hover:text-foreground lg:flex"
                                    >
                                        <X size={20} aria-hidden />
                                    </button>
                                )}
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
                                className="h-11 sm:h-[56px] w-full rounded-none bg-primary px-6 text-xs font-semibold text-primary-foreground hover:bg-primary sm:w-auto transition-colors"
                            >
                                Search
                            </Button>
                        </div>
                    </div>
                    )}

                    {/* Category & Filter Dropdowns. Item 7b (2026-08-21
                        front-door audit): lg+ only once engaged — on mobile
                        this "Browse by field" replace-query shortcut was
                        one more full-width row stacked above the fold, on
                        top of the quick-chip row and the toolbar, pushing
                        result rows out of the first viewport after a real
                        search already ran. The field directory is still
                        reachable pre-search, and typing a new query or
                        "clear ✕" (active-category row below) both still
                        work post-search — this only drops the one-tap
                        shortcut's permanent screen space on a phone.
                        Desktop keeps it; vertical space isn't scarce there. */}
                    {!showLandingMarketing && isLgUp && (
                        <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2 lg:mt-2 lg:pt-1.5">
                            {/* Field dropdown — radio-like, REPLACE query on click */}
                            {fieldDirectoryMenu}
                        </div>
                    )}
                    {/* Active-category indicator: the dropdown label (e.g. "Nursing
                        and patient care") is the human field name; the query it
                        runs (e.g. "Registered Nurse") is what appears in the
                        search box. Without this, the connection between the
                        highlighted chip and the search bar text is opaque. Clicking a category REPLACES the query (radio-like), unlike
                        the filter toggles to its right which AND onto existing results.
                        `handleClearSearch` is the same path the "✕ clear search" toolbar
                        button uses — reused, not a third clear path. */}
                    {/* Outer gate mirrors the OR of what the two children below
                        actually render (`activeCategory`, and
                        `!showJobsToolbarRow && savedSearchControl` — the latter
                        is exactly `!showJobsToolbarRow && canSaveSearch` since
                        `savedSearchControl` is `canSaveSearch ? ... : null`).
                        A looser `canSaveSearch` alone let this div render with
                        forced `min-h-[2.75rem]` and zero visible children
                        whenever the toolbar row below (which shows its own
                        `savedSearchControl`) was already the one rendering it —
                        the mobile SERP's blank ~44px band under the search bar. */}
                    {!showLandingMarketing && (activeCategory || (!showJobsToolbarRow && canSaveSearch)) && (
                        /* Chip rows separate by `gap` on purpose — a glyph
                           separator as its own flex item lands at the start
                           of a wrapped line; `DotSeparated` is for inline
                           text runs, not chips. */
                        <div
                            data-testid="active-category-indicator"
                            className="mt-1 flex min-h-[2.75rem] flex-wrap items-center gap-1.5 px-0.5 text-xs text-muted-foreground sm:min-h-0"
                        >
                            {activeCategory && (
                                <>
                                    <span className="font-semibold text-foreground">
                                        Searching:
                                    </span>
                                    <span>{activeCategory.title}</span>
                                    <button
                                        type="button"
                                        onClick={handleClearSearch}
                                        className="-my-1.5 py-1.5 underline underline-offset-2 transition-colors hover:text-foreground"
                                    >
                                        clear ✕
                                    </button>
                                </>
                            )}
                            {!showJobsToolbarRow && savedSearchControl}
                        </div>
                    )}
                </section>
                )}

                {headerDockActive && facetsMountSite === "inline" && (
                    <div
                        id="filters-panel"
                        data-testid="filters-panel"
                        className="panel-enter max-h-[min(62dvh,520px)] overflow-y-auto overscroll-contain rounded-none border border-border bg-card p-2.5 text-foreground custom-scrollbar"
                    >
                        {renderFiltersPanel()}
                        {/* The global `Footer` is mounted below this infinite feed and
                            never scrolls into view here — this is the only reachable
                            desktop filter surface on /jobs, so the footer links live
                            at its end too. */}
                        <div className="mt-3 border-t border-border pt-3">
                            <FooterLinks />
                        </div>
                    </div>
                )}
                {showJobsToolbarSection && (
                <section
                    data-testid="jobs-toolbar"
                    className={cn(
                        showJobsToolbarRow &&
                            "mt-3 border-y border-border bg-muted py-2 lg:px-0.5 lg:py-1.5",
                    )}
                >
                    {showJobsToolbarRow && (
                    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain lg:gap-3">
                        {showToolbarFilters && (
                            <FilterChipsRow
                                state={filterState}
                                distribution={result?.facetDistribution}
                                onPostedBucket={panelPostedBucket}
                                onToggleFacet={panelToggleFacet}
                                onSalaryMin={panelSalaryMin}
                                postedDateSupported={postedDateSupported}
                            />
                        )}
                        {showsFiltersToggle(facetsMountSite) && !headerDockActive && (
                        <button
                            type="button"
                            data-testid="filters-toggle"
                            aria-expanded={filtersOpen}
                            aria-haspopup="true"
                            aria-controls="filters-panel"
                            onClick={() => setFiltersOpen((v) => !v)}
                            className={cn(
                                chipVariants({ active: filtersOpen || activeCount > 0 }),
                                toolbarControlHeight,
                                "box-border shrink-0 px-3.5 rounded-none font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs leading-none transition-colors lg:px-3",
                            )}
                        >
                            <span className="lg:hidden">Filters</span>
                            <span className="hidden lg:inline">All filters</span>
                            {activeCount > 0 && (
                                <span className={cn("ml-0.5", filterCountBadgeClass)}>
                                    {activeCount}
                                </span>
                            )}
                            {filtersOpen ? <CaretUp size={16} weight="bold" aria-hidden /> : <CaretDown size={16} weight="bold" aria-hidden />}
                        </button>
                        )}
                        {!showLandingMarketing && !headerDockActive && fieldDirectoryMenu}
                        {!headerDockActive && facetBarEl}
                        {showToolbarFilters && (
                        <>
                        {shouldShowLocationDefaultChip(result?.defaultedLocation, chosenLocations) && (
                            <DefaultLocationChip iso2={result!.defaultedLocation!} onClear={suppressLocationDefault} />
                        )}
                        {!headerDockActive && clearFiltersEl}
                        {!headerDockActive && savedSearchMountEl}
                        </>
                        )}
                        {!headerDockActive && <div className="min-w-0 flex-1" aria-hidden />}
                        {!headerDockActive && sortEl}
                        {!headerDockActive && tourReplayEl}
                        {!headerDockActive && asOfEl}
                    </div>
                    )}
                    {!headerDockActive && unnamedEntries.length > 0 && (
                        <div
                            data-testid="active-filter-row"
                            className="mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain border-t border-border pt-2"
                        >
                            {!headerDockActive && unnamedEntries.map((entry) => (
                                <span
                                    key={entry.key}
                                    data-testid="active-filter-chip"
                                    className={cn(chipVariants({ active: true }), toolbarControlHeight, "mono-data inline-flex shrink-0 items-center justify-center gap-1.5 px-3 text-xs leading-none lg:px-2")}
                                >
                                    {chipLabelForEntry(entry)}
                                    <ChipDismiss
                                        label={`Clear ${chipLabelForEntry(entry)}`}
                                        onClick={() => applyFilterState(entry.clear(filterState))}
                                    />
                                </span>
                            ))}
                        </div>
                    )}

                    {facetsMountSite === "inline" && !headerDockActive ? (
                        <div
                            id="filters-panel"
                            data-testid="filters-panel"
                            className="panel-enter mt-3 max-h-[min(62dvh,520px)] overflow-y-auto overscroll-contain rounded-none border border-border bg-card p-2.5 text-foreground custom-scrollbar"
                        >
                            {renderFiltersPanel()}
                        </div>
                    ) : facetsMountSite === "sheet" ? (
                        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                            <SheetContent
                                side="bottom"
                                className="mx-auto max-h-[85dvh] w-full max-w-[720px] overflow-hidden border-border p-0"
                            >
                                <SheetTitle className="sr-only">Filters</SheetTitle>
                                <div
                                    id="filters-panel"
                                    data-testid="filters-panel"
                                    className="max-h-[85dvh] overflow-y-auto overscroll-contain bg-card p-4 pb-[env(safe-area-inset-bottom,16px)] text-foreground custom-scrollbar"
                                >
                                    {renderFiltersPanel()}
                                    {/* Same reachability gap as the desktop inline panel
                                        above — the global `Footer` never scrolls into view
                                        below the mobile infinite feed either. */}
                                    <div className="mt-3 border-t border-border pt-3">
                                        <FooterLinks />
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                    ) : null}
                </section>
                )}

                {/* Browse entry points for a zero-intent visitor — field
                    directory + "start with a filter" shortcuts. Was authored
                    but never mounted anywhere (2026-08-21 front-door audit,
                    item 3): the pristine landing had no browse affordance
                    on first paint at all, only after a search ran. Now
                    mounts at every width (frozen front-door redesign,
                    2026-08-26) — standard flow is search → refine filters →
                    browse shortcuts → results; sits below the filter toolbar. */}
                {showLandingMarketing && (
                    <LandingMarketingShowcase
                        onSelectQuery={submitSearch}
                        onSelectRemote={onSelectRemote}
                        onSelectSalaryMin={panelSalaryMin}
                        onSelectBoard={onBoardChange}
                    />
                )}

                {headerDockActive && !showLandingMarketing && dockedFieldDirectoryMount &&
                    createPortal(fieldDirectoryMenu, dockedFieldDirectoryMount)}
                {headerDockActive && dockedQueryMount && createPortal(dockedQueryEl, dockedQueryMount)}
                {headerDockActive && dockedLocationMount && createPortal(dockedLocationEl, dockedLocationMount)}
                {headerDockActive && dockedFacetsMount && createPortal(facetBarEl, dockedFacetsMount)}
                {headerDockActive && showToolbarFilters && dockedClearFiltersMount && clearFiltersEl &&
                    createPortal(clearFiltersEl, dockedClearFiltersMount)}
                {headerDockActive && dockedSaveSearchMount && savedSearchMountEl &&
                    createPortal(savedSearchMountEl, dockedSaveSearchMount)}
                {headerDockActive && dockedSortMount && sortEl && createPortal(sortEl, dockedSortMount)}
                {headerDockActive && dockedExtrasMount &&
                    createPortal(
                        tourReplayEl,
                        dockedExtrasMount,
                    )}

                <div className={cn(
                    headerDockActive
                        ? "pt-[var(--jobs-bar-content-gap)] pb-[var(--jobs-bar-content-gap)]"
                        : "mt-4",
                    "flex min-h-0 flex-1 flex-col",
                    cappedContentClass,
                    // Item 5 (2026-08-21): was gated on `!isPristineLanding`,
                    // hiding the split (and the pane below) for the whole
                    // pristine landing even at xl+ with a full page of hits
                    // already listed. Now keyed on the same fact the pane
                    // itself needs — is there a list to pair a pane with —
                    // so browsing the default corpus gets the same preview
                    // layout a search does, just with nothing selected yet.
                    hits.length > 0 && "xl:grid xl:grid-cols-[minmax(0,37%)_minmax(0,63%)] xl:gap-6"
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
                    {hits.length > 0 && (
                        <div
                            data-testid="detail-pane"
                            className="hidden xl:order-2 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:sticky xl:top-[var(--jobs-sticky-offset)] xl:max-h-[calc(100dvh-var(--jobs-sticky-offset)-var(--jobs-sticky-gap))] xl:min-w-0 xl:rounded-none xl:border-l xl:border-border"
                        >
                            {detailMountSite === "pane" ? (
                                renderDetailSurface(detailSheetOpen ? () => router.back() : undefined)
                            ) : loading ? (
                                <div className="p-4">
                                    <JobDetailSkeleton />
                                </div>
                            ) : (
                                <p className="p-6 text-xs text-muted-foreground" data-testid="detail-pane-placeholder">
                                    Select a role to read it here.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex min-h-0 flex-1 flex-col xl:min-w-0">
                        {/* Mobile cold visitors already get a seeded default browse
                            (overlay-ask); hiding the results column forced an extra
                            typed query / "Show jobs" tap before result_clicked /
                            job_viewed, dropping the funnel at pageview. */}
                        <div className="flex min-h-0 flex-1 flex-col">
                            <>
                                <BoardVisitBanner />

                                {/* Post-first-save upsell — appears once the anonymous visitor
                                    has made their first save (Go after or saved search). Calm
                                    inline style matching the résumé-moment card below. Dismissed
                                    state is persisted so the banner doesn't reappear on reload.
                                    Signed-in users never see it (`showGuestSaveBanner` is false
                                    whenever `user` is truthy). */}
                                {showGuestSaveBanner && (
                                    <div
                                        data-testid="guest-save-banner"
                                        className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-4 pb-2 text-sm text-muted-foreground"
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

                                {showGuestEngageNudge && (
                                    <div
                                        data-testid="guest-engage-banner"
                                        className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-4 pb-2 text-sm text-muted-foreground"
                                    >
                                        <span>{SIGNUP_SUBCOPY} —</span>
                                        <button
                                            type="button"
                                            onClick={() => openAuth("generic")}
                                            className="text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70"
                                        >
                                            sign in
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDismissGuestEngageNudge}
                                            className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                        >
                                            not now
                                        </button>
                                    </div>
                                )}

                                {/* The signed-in counterpart of the banner above, and its exact
                                    complement: that one asks an anonymous visitor to sign in,
                                    this one asks someone who ALREADY did for an address we can
                                    reach. They can never both show — one requires `!user`, the
                                    other requires a resolved session. */}
                                {emailNudgeOpen && accountEmailState && accountEmailState !== "reachable" && (
                                    <AccountEmailPrompt
                                        state={accountEmailState}
                                        pendingEmail={accountPendingEmail}
                                        onPending={(email) => {
                                            setAccountPendingEmail(email);
                                            setAccountEmailState("pending-confirmation");
                                        }}
                                        onDismiss={() => {
                                            dismissEmailNudge();
                                            setEmailNudgeDismissed(true);
                                            setEmailNudgeOpen(false);
                                        }}
                                        className="mb-3 border-t border-border pt-4 pb-2"
                                    />
                                )}

                                {showResultsSearchAlert && (
                                    <div className="mb-3 border-t border-border pt-4 pb-2">
                                        <SearchAlertCapture
                                            surface="results"
                                            searchName={searchAlertName}
                                            searchHref={searchAlertHref}
                                            filterCount={searchAlertFilterCount}
                                            queryLength={searchAlertQueryLength}
                                            hasResults
                                            onDismiss={handleDismissSearchAlert}
                                        />
                                    </div>
                                )}

                        {/* Screen 4 — the relaxed pass. `widened` now means the STRICT
                            whole-document pass matched nothing and the engine fell back
                            to word-dropping (`shouldRelaxSearch`, lib/jobs/meilisearch.ts).
                            One honest sentence says so; the count line is suppressed for
                            this state (see `resultCountLine`) because the relaxed total
                            counts word-dropped matches — a number that doesn't describe
                            the query the user actually typed. */}
                        {!loading && result?.widened && (
                            <p data-testid="widened-note" className="mb-3 text-sm text-muted-foreground">
                                Nothing matches every word of that — showing the closest matches.
                            </p>
                        )}

                        {!loading && degradedNote && (
                            <p data-testid="degraded-note" className="mb-3 text-sm text-muted-foreground">
                                {degradedNote}
                            </p>
                        )}

                        {!loading && unmatchedNote && (
                            <p data-testid="unmatched-place-note" className="mb-3 text-sm text-muted-foreground">
                                {unmatchedNote}
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
                                    <p className="text-xs text-faint">
                                        Suggested roles
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
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
                                                className="max-w-[min(100%,14rem)] truncate text-xs text-foreground underline underline-offset-[3px] transition-opacity duration-100 hover:opacity-80"
                                            >
                                                {seed}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : resultsPanel === "not-connected" ? (
                                <div className="border-l-2 border-foreground py-6 pl-4 text-left">
                                    <p className="text-xs text-foreground">Job search is being connected.</p>
                                    <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
                                        We&apos;re wiring velai up to Subspace&apos;s live job corpus — including the posting check
                                        that flags roles that aren&apos;t really hiring.
                                    </p>
                                    {result?.note && (
                                        <p className="mt-1 max-w-md text-xs text-muted-foreground">{result.note}</p>
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
                                    <p className="text-xs text-foreground">We can&apos;t load results right now.</p>
                                    <p className="mt-1.5 max-w-md text-xs text-muted-foreground">{searchError}</p>
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
                                        shouldShowLocationDefaultChip(result?.defaultedLocation, chosenLocations)
                                            ? { label: `near ${regionDisplayName(result!.defaultedLocation!)}`, onClear: suppressLocationDefault }
                                            : undefined
                                    }
                                    ghostRevealCount={ghostRevealCount}
                                    onRevealGhosts={() => onHideGhosts(false)}
                                    seeds={searchSeeds}
                                    onSubmitSeed={submitSearch}
                                    searchAlertSlot={
                                        showZeroResultsSearchAlert ? (
                                            <SearchAlertCapture
                                                surface="zero_results"
                                                searchName={searchAlertName}
                                                searchHref={searchAlertHref}
                                                filterCount={searchAlertFilterCount}
                                                queryLength={searchAlertQueryLength}
                                                hasResults={false}
                                                onDismiss={handleDismissSearchAlert}
                                            />
                                        ) : null
                                    }
                                />
                            ) : (
                                <>
                                    {!isSerpAsk && (
                                        <>
                                            {/* Count line: plain secondary text, no panel (rulebook
                                                item i) — "Show all" reads as the one Klein text link. */}
                                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 py-2 text-sm text-muted-foreground">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span
                                                        data-testid="result-line"
                                                        className="font-semibold text-foreground tabular-nums"
                                                    >
                                                        {resultCountLine}
                                                    </span>
                                                    {beyondWindow.show && (
                                                        <span className="flex items-center gap-1.5">
                                                            {beyondWindowText}
                                                            <span aria-hidden>·</span>
                                                            <button
                                                                type="button"
                                                                data-testid="beyond-window-show-all"
                                                                onClick={() => panelPostedBucket(undefined)}
                                                                className="text-brand hover:underline"
                                                            >
                                                                Show all
                                                            </button>
                                                        </span>
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
                                                        <span data-testid="company-scope-chip" className="flex items-center gap-2">
                                                            <span className="whitespace-nowrap font-semibold text-foreground">
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
                                    data-region="list"
                                    ref={resultsListRef}
                                    tabIndex={0}
                                    role="listbox"
                                    aria-label="Job results"
                                    onKeyDown={handleResultsKeyDown}
                                    className={cn(
                                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                                        board === "elite" && "elite-signal",
                                    )}
                                >
                                    {board === "elite" && (
                                        <div className="mb-3.5 flex items-baseline justify-between gap-3">
                                            <h2 className="font-display text-lg font-semibold">
                                                Elite matches
                                                <span className="ml-2 text-xs font-normal text-[color:var(--elite-muted)]">
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
                                        {renderedClusters.flatMap((cluster, i) => {
                                            const expanded = expandedClusters.has(cluster.primary.id);
                                            const rows = [
                                                renderJobRow(
                                                    cluster.primary,
                                                    cluster.variants.length > 0
                                                        ? {
                                                              variantCount: cluster.variants.length,
                                                              clusterLabel: clusterToggleLabel(cluster.primary, cluster.variants),
                                                              expanded,
                                                              onToggleExpand: () => toggleClusterExpanded(cluster.primary.id),
                                                          }
                                                        : undefined,
                                                    i === 0,
                                                ),
                                                ...(expanded ? cluster.variants.map((v) => renderJobRow(v)) : []),
                                            ];
                                            // Under `fitActive` the visible order is the
                                            // match-score resort above, not relevance —
                                            // the "titled it vs mentions it" seam text no
                                            // longer describes anything real, so it's
                                            // suppressed rather than drawn at a now-
                                            // meaningless position.
                                            if (fitActive || i !== clusterSeamIndex) return rows;
                                            return [
                                                <p
                                                    key="seam"
                                                    data-testid="relevance-seam"
                                                    className="mb-1 border-t border-border pt-4 pb-1 text-xs text-muted-foreground"
                                                >
                                                    {seamSummary(seamIndex, total, displayHits.length)}
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
                                    {showResumeMoment && (
                                        <div
                                            data-testid="resume-moment"
                                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border py-5 text-sm text-muted-foreground"
                                        >
                                            <span>Want these ranked against your actual experience?</span>
                                            <button
                                                type="button"
                                                onClick={() => void handleRankByFit()}
                                                className="text-foreground underline underline-offset-2 transition-opacity duration-100 hover:opacity-70"
                                            >
                                                {showResumeEntry ? "drop your résumé" : "use the résumé on file"}
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
                                            {depthGateNote ? (
                                                // The anonymous depth wall refused the next page
                                                // (`loadMore`'s `interpretLoadMoreResponse` → "gated").
                                                // The sentinel div stays mounted (harmless — `loadMore`
                                                // itself now guards on `depthGateNote` so re-intersecting
                                                // it is a no-op) but the "Show N more" button is gone:
                                                // clicking it could never have worked past this point.
                                                <p className="text-xs text-muted-foreground">
                                                    {depthGateNote}{" "}
                                                    <a
                                                        href={depthGateSignInHref}
                                                        className="text-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                                    >
                                                        Sign in
                                                    </a>
                                                </p>
                                            ) : loadingMore ? (
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
            </div>

            <LocationPickerSheet
                open={locationSheetOpen}
                onOpenChange={setLocationSheetOpen}
                state={filterState}
                distribution={result?.facetDistribution}
                defaultedIso2={result?.defaultedLocation}
                detectedLabel={result?.defaultedLocation ? detectedLocationLabel(result.defaultedLocation) : undefined}
                locationDefaultSuppressed={locationDefaultSuppressed}
                onRestoreDetected={restoreLocationDefault}
                onContinue={handleLocationSheetContinue}
            />

            {!isLgUp && !detailSheetOpen && !locationSheetOpen && shouldShowMobileSearchCta(showLandingMarketing, queryDraft, query) && (
                <div
                    data-testid="mobile-search-cta"
                    className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+3.25rem)] z-[180] border-t border-border bg-card px-4 py-2.5 lg:hidden"
                >
                    <Button
                        type="button"
                        onClick={handleMobilePrimaryCta}
                        className="h-11 w-full rounded-none bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary"
                    >
                        {mobilePrimaryCtaLabel}
                    </Button>
                </div>
            )}

            <AuthPopover
                open={authOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setAuthGateReason(null);
                        // A close WITHOUT a preceding successful auth
                        // (`justAuthedRef`, set by `onAuthed` below) is a
                        // dismissal — also drop the résumé-continuation ref so
                        // it can't fire on a later, unrelated sign-in. When it
                        // WAS a successful auth, skip this: the hook's own
                        // replay (`handlers.upload` → `setImportOpen`) may
                        // have just read that ref, moments before this fires.
                        // Either branch sets `authOpen` exactly once —
                        // `clearPendingGate()` already does it on the dismiss
                        // path, so this must not also fall through to the
                        // unconditional `setAuthOpen(open)` below.
                        if (justAuthedRef.current) {
                            setAuthOpen(false);
                        } else {
                            clearPendingGate();
                        }
                        justAuthedRef.current = false;
                        return;
                    }
                    setAuthOpen(open);
                }}
                onAuthed={() => {
                    justAuthedRef.current = true;
                    onAuthed();
                }}
                showTrigger={false}
                valueLine={
                    authGateReason
                        ? formatAuthGateValueLine(authGateReason, listGuestPursuits().length)
                        : undefined
                }
                defaultTab={authGateReason === "apply" ? "signup" : "login"}
                reason={authGateReason ?? undefined}
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
                    className="left-1/2 flex max-h-[min(88dvh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden border border-border border-b-0 p-0 data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
                >
                    <div className="shrink-0 border-b border-border">
                        <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
                            <span className="h-1.5 w-10 rounded-none bg-border dark:bg-border" />
                        </div>
                        <div className="flex items-center gap-2 px-4 pb-3">
                            <div className="min-w-0 flex-1">
                                {detailJob ? (
                                    <>
                                        <p className="truncate text-base font-semibold text-foreground">
                                            {decodeText(detailJob.title)}
                                        </p>
                                        <p className="truncate text-meta text-muted-foreground">
                                            {displayCompanyBrand(detailJob.company, detailJob.company_domain, detailJob.title)}
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
                        {detailJob ? `${decodeText(detailJob.title)} at ${displayCompanyBrand(detailJob.company, detailJob.company_domain, detailJob.title)}` : "Job details"}
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
                job={applyIntentJob}
                open={Boolean(applyIntentJob)}
                onOpenChange={(next) => {
                    if (!next) setApplyIntentJob(null);
                }}
                onContinue={() => {
                    if (applyIntentJob) openPostingNow(applyIntentJob);
                }}
            />

            <ApplyReturnPrompt
                record={applyReturnPrompt}
                onMarkApplied={markApplyReturnApplied}
                onDismiss={dismissApplyReturn}
            />
        </div>
    );
}

function JobsLoading() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-none border-2 border-brand border-t-brand" />
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
