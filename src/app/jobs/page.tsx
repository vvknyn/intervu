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
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchAutocomplete } from "@/components/search/SearchAutocomplete";
import type { SearchSuggestion } from "@/lib/search-suggestions";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AuthPopover } from "@/components/auth/auth-popover";
import { GUEST_SERP_TIP } from "@/components/marketing/openclaw-content";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    searchJobsAction as searchJobsActionRaw,
    markJobAppliedAction,
    getJobsFreshnessAction,
    getPostedDateFilterSupportAction,
    suggestJobsAction,
    recordJobOpenedAction,
} from "@/actions/jobs";
import { goAfterJobAction, createManualPursuit } from "@/actions/application";
import { usePursuits, invalidatePursuitsCache, syncGuestPursuitsToServer } from "@/lib/pursuits/use-pursuits";
import { listGuestPursuits } from "@/lib/pursuits/guest-store";
import { syncGuestFollowsToServer, useFollows } from "@/lib/follows/use-follows";
import { FollowAlertsCard } from "@/components/follows/FollowAlertsCard";
import { addManualGuestPursuit } from "@/lib/pursuits/guest-store";
import { hasReachedStage } from "@/lib/pursuits/types";
import { withSettleGuard } from "@/lib/jobs/settle-guard";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { checkFreshness, daysOpenFrom } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import {
    decodeText,
    cleanCompany,
    locationText,
    salaryText,
    postedAgeShort,
    searchResultLine,
    firstMentionIndex,
    seamSummary,
    prettyEnum,
} from "@/lib/jobs/presentation";
import {
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
    recordRecentSearch,
    resolveSearchSeeds,
} from "@/lib/jobs/recent-searches";
import {
    subscribeSavedSearches,
    getSavedSearchesSnapshot,
    getSavedSearchesServerSnapshot,
} from "@/lib/jobs/saved-searches";
import { SavedSearchesPanel } from "@/components/jobs/SavedSearchesPanel";
import {
    activeFilterEntries,
    toggleFacetValue,
    PRISTINE_FILTER_STATE,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import { SerpFilters } from "@/components/jobs/SerpFilters";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { JobDetail, JobDetailActionBar, JobDetailSkeleton } from "@/components/jobs/JobDetail";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { resolveCorpusCount, formatCorpusCount } from "@/lib/jobs/corpus-count";
import { JobsPaginationGeneration } from "@/lib/jobs/pagination-generation";
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    classifyExistenceCheck,
    resolveEmptySearchState,
    DEAD_JOB_TOMBSTONE_TEXT,
    SEARCH_UNAVAILABLE_MESSAGE,
    shouldClearStaleJobUrl,
    shouldBackOnDetailSheetClose,
    degradedResultsNote,
} from "@/lib/jobs/result-state";
import { clusterJobs } from "@/lib/jobs/cluster";
import { coerceSortToSupported, resolveEffectiveSort } from "@/lib/jobs/sort";
import {
    type FacetKey,
    type JobSearchParams,
    type JobSearchResult,
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

const searchJobsAction = (params: JobSearchParams): Promise<JobSearchResult> =>
    withSettleGuard(
        searchJobsActionRaw(params).then((r) => {
            lastSearchId = r.searchId;
            return r;
        }),
    );

/* ----------------------------- helpers ----------------------------- */

/** Reverse of `urlSortToMode`, for writing the URL from an in-app sort choice. */
function modeToUrlSort(mode: JobSortMode): UrlSort {
    return mode === "salary_desc" ? "salary" : mode;
}

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
                "font-mono text-[11px] uppercase tracking-[0.04em] transition-colors",
                pressed ? "text-[#ececec] underline underline-offset-[3px]" : "text-[#aeb4bd] hover:text-[#ececec]",
            )}
        >
            {label}
        </button>
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
 * The ledger's VERDICT CELL (editorial pass spec — the signature: mono,
 * colored, fixed-width, e.g. "■ LIVE · 2H" / "▲ REPOST" / "✕ RISK · STALE
 * 47D" / "— UNSCORED"). Renamed from the portal pass's `flagRowFor` (which
 * composed a dot + prose label) — same real signals, same pure primitives
 * (`checkFreshness`, `classifyPostingFreshness`, `daysOpenFrom`), just a
 * denser glyph+code grammar instead of prose. `ghostMetaFor` above stays the
 * JobDetail banner's separate (longer-copy) source — this function never
 * re-derives a signal itself, only composes the code text + tone.
 */
type FlagTone = "live" | "warn" | "danger" | "faint";
interface Verdict {
    tone: FlagTone;
    code: string;
}
/** Verdict-channel color only (anti-marker: color appears ONLY here). `faint`
 *  reuses the existing neutral `--faint` token rather than a new one. */
const VERDICT_TONE_CLASS: Record<FlagTone, string> = {
    live: "text-verdict-live",
    warn: "text-verdict-caution",
    danger: "text-verdict-risk",
    faint: "text-faint",
};

/** "relisted" (a stated fact from `classifyPostingFreshness`) wins over a
 *  plain staleness count — both are real signals, but a relist is the more
 *  specific/explanatory one when both happen to be present. `null` when
 *  neither signal fires — callers fall back to a generic qualifier-free
 *  label rather than inventing one. */
function ghostQualifier(job: PublicJob, now: number): string | null {
    if (classifyPostingFreshness(job, now).kind === "relisted") return "relisted";
    const days = daysOpenFrom(derivePostedTs(job), now);
    return days != null ? `stale ${days}d` : null;
}

/** Compact uppercase age for the verdict cell ("2H"/"3D"), distinct from
 *  `formatRelativeAge`'s prose form ("2h ago") used in JobDetail — same
 *  bucketing thresholds (freshness.ts), a denser rendering for the ledger. */
function shortAge(iso: string, now: number): string {
    const ms = Math.max(0, now - Date.parse(iso));
    if (ms < 60_000) return "NOW";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}M`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}H`;
    return `${Math.floor(ms / 86_400_000)}D`;
}

function verdictFor(job: PublicJob, now: number): Verdict {
    const updatedAt = job.updated_at;
    const age = updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? shortAge(updatedAt, now) : null;
    switch (job.ghost_badge) {
        case "clear": {
            if (checkFreshness(updatedAt, now) === "fresh") {
                return { tone: "live", code: age ? `LIVE · ${age}` : "LIVE" };
            }
            return { tone: "live", code: age ? `CHECKED · ${age}` : "CHECKED" };
        }
        case "caution": {
            const q = ghostQualifier(job, now);
            if (q === "relisted") return { tone: "warn", code: "REPOST" };
            return { tone: "warn", code: q ? `CAUTION · ${q.toUpperCase()}` : "CAUTION" };
        }
        case "likely_ghost": {
            const q = ghostQualifier(job, now);
            return { tone: "danger", code: q ? `RISK · ${q.toUpperCase()}` : "RISK" };
        }
        case "unscored":
        default:
            return { tone: "faint", code: "UNSCORED" };
    }
}


/**
 * Task 9 — typeahead: adapt `suggestJobsAction`'s plain `{ titles, companies }`
 * into `SearchAutocomplete`'s `SearchSuggestion` shape. Companies are tagged
 * `'company'` so the dropdown renders them with a distinct icon (Buildings,
 * vs. the default magnifying-glass for titles) — the type field doubles as
 * both the render hint and the semantic label; no counts (see
 * `suggestJobsAction`, company isn't a facet).
 */
function mapToSuggestions(data: { titles: string[]; companies: string[] }): SearchSuggestion[] {
    return [
        ...data.titles.map((text): SearchSuggestion => ({ text, type: "role" })),
        ...data.companies.map((text): SearchSuggestion => ({ text, type: "company" })),
    ];
}

/* ----------------------------- ledger row ----------------------------- */

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
    const accessibleName = `${decodeText(job.title)} at ${cleanCompany(job.company) || "Unknown company"}`;
    const verdict = verdictFor(job, now);
    const flagged = verdict.tone === "warn" || verdict.tone === "danger";
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    const level = prettyEnum(job.experience_level);
    const employment = prettyEnum(job.employment_type);
    const loc = locationText(job);
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
                "group mb-2 grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[14px] border border-border bg-card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[#c0c8d2] hover:shadow-[0_8px_24px_rgba(18,21,26,0.05)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/60 focus-visible:-outline-offset-2",
                active && "border-foreground shadow-[0_0_0_1px_hsl(var(--foreground))]",
            )}
        >
            <div className="row-span-2 self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="min-w-0">
                <div
                    data-testid="job-title"
                    className={cn(
                        "text-[15px] leading-snug tracking-tight",
                        opened ? "font-medium text-muted-foreground" : "font-semibold text-foreground",
                    )}
                >
                    {decodeText(job.title)}
                </div>
                <div className="mt-1 text-[13px] text-muted-foreground">
                    {onCompany ? (
                        <button
                            type="button"
                            className="hover:text-foreground hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCompany(job);
                            }}
                        >
                            {cleanCompany(job.company) || "Unknown company"}
                        </button>
                    ) : (
                        cleanCompany(job.company) || "Unknown company"
                    )}
                </div>
            </div>
            <span
                className={cn(
                    "inline-flex h-fit items-center gap-1 self-start rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em]",
                    flagged
                        ? "border-border bg-card text-muted-foreground"
                        : "border-green-tint-border bg-green-tint-bg text-verdict-live",
                )}
            >
                {flagged ? "review" : "verified"}
            </span>
            <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
                <span>{locationLine}</span>
                {age && (
                    <>
                        <span aria-hidden>·</span>
                        <span>{age}</span>
                    </>
                )}
                <span aria-hidden>·</span>
                <span>{salary ? `from ${salary}` : "pay n/a"}</span>
                {level && (
                    <span className="inline-flex items-center rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
                        {level}
                    </span>
                )}
                {employment &&
                    employment.toLowerCase() !== "full-time" &&
                    employment.toLowerCase() !== "full time" && (
                        <span className="inline-flex items-center rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
                            {employment}
                        </span>
                    )}
                {variantCount > 0 && (
                    <button
                        type="button"
                        data-testid="cluster-toggle"
                        className="inline-flex items-center rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
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
            className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[14px] border border-border bg-card p-4"
        >
            <div className="row-span-2 self-start">
                <div className="skeleton-bar h-12 w-12 rounded-[10px]" />
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
            <p className="pt-8 font-mono text-[13px] text-muted-foreground">
                Finding live roles… screening each posting for ghost-job signals.
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

/** A resume is "usable" for matching if it has a profession or at least one skill. */
function resumeIsUsable(d: ResumeData | undefined): boolean {
    if (!d) return false;
    if ((d.profile?.profession ?? "").trim()) return true;
    return (d.competencies ?? []).some((c) => (c.skills ?? []).some((s) => (s ?? "").trim()));
}

/**
 * Task 11 — zero-results state. Names the specific excluders instead of a
 * generic "try broadening your search": one clear-chip per
 * `activeFilterEntries(state)` (FilterPanel.tsx) — the SAME source the
 * toolbar chips and mobile sheet read from, so this can never list a
 * different "what's active" than what's actually applied (no parallel
 * list). `onClearEntry` routes through the caller's `applyFilterState` —
 * the identical apply path the toolbar chips' `onRemove` already uses — so
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
 */
/** Review fix: one source for the `activeFilterEntries` element shape, instead of spelling it out twice below. */
type FilterEntry = ReturnType<typeof activeFilterEntries>[number];

function ActiveFilterActions({
    entries,
    onClearEntry,
    onClearFilters,
    query,
    onClearQuery,
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
    className?: string;
    clearFiltersTestId?: string;
    clearQueryTestId?: string;
    chipTestId?: string;
}) {
    const hasQuery = (query ?? "").trim().length > 0;
    const hasFilters = entries.length > 0;
    if (!hasQuery && !hasFilters) return null;
    return (
        <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground", className)}>
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
        </p>
    );
}

function EmptyResults({
    entries,
    onClearEntry,
    onClearFilters,
    query,
    onClearQuery,
    ghostRevealCount,
    onRevealGhosts,
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
    ghostRevealCount: number | null;
    onRevealGhosts: () => void;
}) {
    const hasQuery = query.trim().length > 0;
    const hasFilters = entries.length > 0;
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
                />
            )}
            {ghostRevealCount != null && (
                <button
                    type="button"
                    onClick={onRevealGhosts}
                    className="mt-2 font-mono text-xs text-foreground underline underline-offset-2"
                >
                    {ghostRevealCount.toLocaleString()} roles hidden as likely-ghost — show them
                </button>
            )}
        </div>
    );
}

/**
 * The search seed line (spec §3 "outside interviews") — for the visitor
 * who's already mid-interview-loop somewhere, not job hunting on this page at
 * all. Rendered once, after the load-more sentinel / end-of-list line inside
 * the scrolling results container (Ledger redesign) — it's the last thing a
 * reader who scrolls through the whole page reaches, not a permanent fixture
 * competing with the results above it. Collapsed to a single quiet line by
 * default; one click expands the two-field form in place. Submitting creates
 * an "interviewing"-stage pursuit with no job_id (typed company/role only, no
 * live listing behind it — same shape `buildManualPursuitSnapshot` gives
 * every other manual pursuit) and the caller routes to the tracker — see
 * `handleSeedSubmit` below.
 */
function SearchSeedLine({
    onSubmit,
    submitting,
}: {
    onSubmit: (company: string, position: string) => void;
    submitting: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [company, setCompanyInput] = useState("");
    const [position, setPositionInput] = useState("");

    if (!open) {
        return (
            <div data-testid="prep-seed-line" className="shrink-0 border-t border-border py-3 text-left">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="text-[13px] text-muted-foreground transition-colors duration-100 hover:text-foreground"
                >
                    Already interviewing somewhere? <span className="font-medium text-foreground underline underline-offset-2">Prep for it.</span>
                </button>
            </div>
        );
    }

    return (
        <form
            data-testid="prep-seed-form"
            onSubmit={(e) => {
                e.preventDefault();
                const c = company.trim();
                const p = position.trim();
                if (!c || !p) return;
                onSubmit(c, p);
            }}
            className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border py-3"
        >
            <span className="text-[13px] text-muted-foreground">Already interviewing somewhere?</span>
            <Input
                value={company}
                onChange={(e) => setCompanyInput(e.target.value)}
                placeholder="Company"
                required
                aria-label="Company"
                className="h-8 w-36 text-[13px]"
            />
            <Input
                value={position}
                onChange={(e) => setPositionInput(e.target.value)}
                placeholder="Role"
                required
                aria-label="Role"
                className="h-8 w-40 text-[13px]"
            />
            <Button type="submit" size="sm" disabled={submitting} className="h-8">
                {submitting ? "Prepping…" : "Prep for it"}
            </Button>
            <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
            >
                Cancel
            </button>
        </form>
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
    // (JobCard's `postedAge`/`verdictFor`) or inside JSX (the freshness stamp's
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
    const [facets, setFacets] = useState<Partial<Record<FacetKey, string[]>>>(initialUrlState.facets);
    const [salaryMin, setSalaryMin] = useState(initialUrlState.salaryMin);
    const [visaOnly, setVisaOnly] = useState(initialUrlState.visaOnly);
    const [postedBucket, setPostedBucket] = useState<PostedBucket | undefined>(initialUrlState.postedBucket);
    // First-screen default: exclude likely_ghost from results. `ghosts=show` in
    // the URL flips it. No UI toggle wired yet (Task 6 — Trust toolbar).
    const [hideGhosts, setHideGhosts] = useState(initialUrlState.hideGhosts);
    const [board, setBoard] = useState<BoardId | null>(initialUrlState.board);
    // Declared here (not down near `clearAll`/the rail JSX, where it used to
    // live) so the search effect below can read ONE `filterState` for this
    // render instead of five separate primitives — review fix, 2026-07-19,
    // needed so `buildJobSearchPayload` has a single FilterState to take.
    const filterState: FilterState = { facets, salaryMin, visaOnly, postedBucket, hideGhosts };
    // Explicit sort override; null = auto (newest with no query, relevance with a query —
    // see buildSort in lib/jobs/meilisearch.ts). Not a "filter", so it's kept out of
    // activeCount/clearAll. See `resolveUrlSort` for the sort=fit handling.
    const [sortOverride, setSortOverride] = useState<JobSortMode | null>(resolveUrlSort(initialUrlState.sort));
    // Previous-render snapshot of `query`, read by the sort-reset effect
    // below (`shouldResetSortOnQueryChange`) to tell "a new query just
    // arrived" from "everything else about this render changed".
    const lastQueryRef = useRef(query);
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
    const [locationDraft, setLocationDraft] = useState(() => initialUrlState.facets.location_country?.[0] ?? "");
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchRetry, setSearchRetry] = useState(0);
    // S2 — recent-searches chips on the empty-query landing state.
    const recentSearches = useSyncExternalStore(
        subscribeRecentSearches,
        getRecentSearchesSnapshot,
        getRecentSearchesServerSnapshot,
    );
    const savedSearches = useSyncExternalStore(
        subscribeSavedSearches,
        getSavedSearchesSnapshot,
        getSavedSearchesServerSnapshot,
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
    const applyUrlState = (next: JobsUrlState, history: "replace" | "push") => {
        const target = `${pathname}${serializeJobsUrl(next)}`;
        if (typeof window !== "undefined" && target === `${window.location.pathname}${window.location.search}`) {
            return;
        }
        if (history === "push") router.push(target, { scroll: false });
        else router.replace(target, { scroll: false });
    };

    // Single chokepoint for a SUBMITTED (not per-keystroke) search — the
    // search box's Enter/suggestion-pick and a recent-search chip click both
    // route through here, so both record the query the same way.
    const submitSearch = (q: string) => {
        setQuery(q);
        recordRecentSearch(q);
        applyUrlState(buildUrlState({ q }), "push");
    };

    const [result, setResult] = useState<JobSearchResult | null>(null);
    const resultRef = useRef<JobSearchResult | null>(null);
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
    const [authOpen, setAuthOpen] = useState(false);
    const [guestTipDismissed, setGuestTipDismissed] = useState(false);
    // Replaces the old session-only `appliedIds` state (forgot on reload) —
    // one shared, cached fetch that also serves TopBar and /yours.
    const { byJobId: pursuitsByJobId, pursuits: trackedPursuits } = usePursuits();
    const trackedCount = trackedPursuits.length;
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const [goingAfterId, setGoingAfterId] = useState<string | null>(null);
    const [seedSubmitting, setSeedSubmitting] = useState(false);
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
    // True only while the currently-open auth dialog was opened by
    // `handleApplyGate` below — the ONLY path that promises "we'll take you
    // to the posting and start tracking this application" (the value line
    // rendered above the dialog). `openAuth` resets it to false on every
    // open; `handleApplyGate` is the one call site that then flips it back
    // on, so a "Mark as applied" gate or a session-expiry re-auth never
    // show it.
    const [authGateValueLine, setAuthGateValueLine] = useState(false);

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
                hideGhosts,
                board,
                sort: sortOverride ? modeToUrlSort(sortOverride) : null,
                jobId: null,
            }) + (postedDateSupported ? "" : "&nodatesort"),
        // `postedDateSupported` participates because it changes the sort the
        // backend is asked for: when the probe resolves, the date sort becomes
        // real and the results must be re-fetched in the new order.
        [query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, board, sortOverride, postedDateSupported],
    );

    // Single source: résumé usable, hoisted here (instead of
    // `resumeIsUsable(resume ?? undefined)` at each call site) so the two
    // later CTA gates (résumé-moment + the "use the résumé on file" upsell)
    // share one computation. `resumeIsUsable` reads LOCAL state only (no
    // mount fetch) — see that call site's own doc comment for why that's an
    // accepted trade-off, not a bug.
    const hasUsableResume = resumeIsUsable(resume ?? undefined);

    // Single source for "what filters are currently active" — the toolbar
    // pill's count, the empty-state's per-filter clear chips, and
    // `emptySearchState` below all read this ONE call instead of a second
    // `activeFilterEntries(filterState)` per render.
    const activeEntries = activeFilterEntries(filterState);

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
    const skipCorpusFetch = !query.trim();

    /**
     * The empty-query landing state (`lib/jobs/result-state.ts`,
     * unit-tested there) — three outcomes: ordinary `"results"`, the
     * full-screen front-door overlay (owned by `/`, not this route — see
     * `src/app/page.tsx`), or the chrome-preserving `"serp-ask"` for an
     * empty query. `/jobs` never renders the overlay; any non-"results"
     * state falls back to the chrome-preserving SERP-ask so a bare `/jobs`
     * visit still shows filters + seeds instead of the marketing hero.
     */
    const emptySearchState = resolveEmptySearchState({
        hasQuery: Boolean(query.trim()),
        fitActive,
        activeFilterCount: activeEntries.length,
    });
    const isSerpAsk = emptySearchState !== "results";

    // Debounced search on query / facet / salary / visa changes.
    useEffect(() => {
        if (skipCorpusFetch) {
            // Nothing to search. Drop any previous result so returning to an
            // empty query lands back on an ask state rather than stale rows.
            setLoading(false);
            setSearchError(null);
            setResult(null);
            return;
        }

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
                const r = await searchJobsAction({
                    ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, board),
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
                            board,
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchKey, searchRetry, skipCorpusFetch]);

    // Sort-reset (Phase 1-a #3): a genuinely new, non-empty query always
    // starts on Best match rather than silently inheriting whatever sort was
    // active for a different (or absent) prior query — see
    // `shouldResetSortOnQueryChange`'s doc comment for the two triggers this
    // unifies (a changed non-empty query, or an emptied query that only
    // makes "relevance" meaningless). Depends on `query` alone, so a facet/
    // salary/visa/ghost change never resets an explicit sort.
    useEffect(() => {
        const prevQuery = lastQueryRef.current;
        lastQueryRef.current = query;
        if (shouldResetSortOnQueryChange(prevQuery, query, sortOverride)) {
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
        applyUrlState(buildUrlState({ jobId: id }), "push");
    };

    const hits = useMemo(() => result?.hits ?? [], [result?.hits]);

    // The relevance seam (Task A) — where the "titled it" block of results
    // ends and the "mentions it" block begins. Tiers against the SERVER's
    // residual query (`result.effectiveQ`), not the client's `query` state:
    // the client query can still hold place words (e.g. "canada") that query
    // understanding already stripped server-side, and tiering against those
    // would wrongly demote a title that correctly omits the place word.
    const seamIndex = useMemo(
        () => firstMentionIndex(hits.map((h) => decodeText(h.title)), result?.effectiveQ ?? ""),
        [hits, result],
    );

    // Deliverable 3 — collapse repeat postings (same title, same company —
    // e.g. one role cross-posted at several locations) into one card each,
    // ranked at the earliest/best-ranked copy's position. `clusterJobs` is
    // pure (lib/jobs/cluster.ts); this just threads `hits` through it.
    const clusters = useMemo(() => clusterJobs(hits), [hits]);

    // The seam paragraph (above) is inserted at an EXACT `hits` index; after
    // clustering, positions no longer line up 1:1. Every member of one
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
                ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported, board),
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result, query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, board, sortOverride, postedDateSupported]);

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
    // debounce effect used to key off that reference. `suggestJobsAction`
    // and `mapToSuggestions` are both stable (server action import + a
    // module-level pure function), so `[]` deps are correct — this callback
    // itself never needs to change.
    const suggestForBox = useCallback(
        (q: string) => suggestJobsAction(q).then(mapToSuggestions),
        [],
    );
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
        applyUrlState(buildUrlState({ board: next }), "replace");
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

    const commitLocation = useCallback(() => {
        const trimmed = locationDraft.trim();
        const nextFacets = { ...filterState.facets };
        if (trimmed) nextFacets.location_country = [trimmed];
        else delete nextFacets.location_country;
        applyFilterState({ ...filterState, facets: nextFacets });
    }, [locationDraft, filterState]);

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
        applyFilterState({ ...filterState, facets: toggleFacetValue(filterState.facets, key, value) });
    const panelSalaryMin = (v: number) => applyFilterState({ ...filterState, salaryMin: v });
    const panelVisaOnly = (v: boolean) => applyFilterState({ ...filterState, visaOnly: v });
    const panelPostedBucket = (v: PostedBucket | undefined) =>
        applyFilterState({ ...filterState, postedBucket: v });
    const panelClearAll = () => applyFilterState(PRISTINE_FILTER_STATE);

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
    const handleOpenPosting = (job: PublicJob) => {
        if (resolveApplyGateDecision(Boolean(user)) === "gate") {
            handleApplyGate(job);
            return;
        }
        if (job.apply_url) window.open(job.apply_url, "_blank", "noopener,noreferrer");
    };

    const doMarkApplied = async (job: PublicJob) => {
        setApplyingId(job.id);
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
        } catch (e) {
            if (classifySentinel(e) === "auth") {
                setAuthOpen(true);
            } else {
                toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
            }
        } finally {
            setApplyingId(null);
        }
    };
    const handleMarkApplied = (job: PublicJob) => {
        if (resolveApplyGateDecision(Boolean(user)) === "gate") {
            pendingRef.current = queuePending(pendingRef.current, { kind: "apply", payload: job });
            openAuth();
            return;
        }
        void doMarkApplied(job);
    };

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
        openAuth();
        setAuthGateValueLine(true);
    };

    // "Go after this job" (spec §3) — used to write straight to the guest
    // store with no auth wall at all; Job 2 (2026-08-01) overrides that for
    // THIS button specifically (account creation before applying), so
    // signed out it now gates like the other three apply-adjacent CTAs.
    // Signed in: unchanged, still the server chokepoint below.
    const handleGoAfter = (job: PublicJob) => {
        if (resolveApplyGateDecision(Boolean(user)) === "gate") {
            handleApplyGate(job);
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

    // The search seed line (spec §3 "outside interviews") — same signed-out
    // vs. signed-in split as `handleGoAfter` above, but there's no job_id to
    // find-or-create by (`createManualPursuit`/`addManualGuestPursuit` always
    // create), then routes to the pursuit on /yours once it exists.
    const handleSeedSubmit = (company: string, position: string) => {
        const goToTracker = (pursuitId: string) => {
            toast.success("Added to your tracker");
            router.push(`/yours/${pursuitId}`);
        };

        if (!user) {
            goToTracker(addManualGuestPursuit(company, position).id);
            return;
        }

        void (async () => {
            setSeedSubmitting(true);
            try {
                const res = await createManualPursuit({ company, position });
                if (res.error || !res.data) {
                    if (classifySentinel(res.error) === "auth") {
                        setAuthOpen(true);
                    } else {
                        toast.error(`Could not save: ${res.error ?? "Failed to create pursuit"}`);
                    }
                    return;
                }
                invalidatePursuitsCache();
                goToTracker(res.data.id);
            } catch (e) {
                if (classifySentinel(e) === "auth") {
                    setAuthOpen(true);
                } else {
                    toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
                }
            } finally {
                setSeedSubmitting(false);
            }
        })();
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
    const openAuth = () => {
        authedRef.current = false;
        setAuthGateValueLine(false);
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

    // Guest→auth merge (pursuits + follows) — at most once per load; only mark
    // done after both merges succeed so a failed sign-in sync retries.
    useEffect(() => {
        if (user && !guestPursuitSyncRef.current && !guestSyncInFlightRef.current) {
            guestSyncInFlightRef.current = true;
            const guestPursuitCount = listGuestPursuits().length;
            void (async () => {
                try {
                    const [pursuitsOk, followsOk] = await Promise.all([
                        syncGuestPursuitsToServer(),
                        syncGuestFollowsToServer(),
                    ]);
                    if (pursuitsOk && followsOk) {
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

    // Sort menu → "Rank by fit" click. A résumé already on hand applies
    // immediately; otherwise queue the résumé importer (via the existing
    // `handleUploadClick` upload-gate) and apply fit the moment it completes
    // (see `handleImport`'s `resumeActionAfterImportRef` check).
    //
    // `fitIntentRef` guards the await: `resolveUsableResume()` is a network
    // round-trip, and the Select's `onValueChange` bumps the SAME guard for
    // every sort choice (fit or otherwise, see the toolbar JSX below), so a
    // user who picks a different sort — or clicks "Rank by fit" again —
    // before this resolves gets their newer choice honored instead of a
    // stale, late-arriving fit application clobbering it. (review fix,
    // 2026-07-18)
    const handleRankByFit = async () => {
        const token = fitIntentRef.current!.begin();
        const r = await resolveUsableResume();
        if (!fitIntentRef.current!.isCurrent(token)) return;
        if (r) {
            applyFit(r);
            return;
        }
        handleUploadClick();
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
        router.push(`/jobs${href.startsWith("?") ? href : `?${href}`}`);
    };

    const canSaveSearch = Boolean(
        query.trim() || activeCount > 0 || fitActive || sortOverride || board,
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
        clearPendingGate();
        resumeActionAfterImportRef.current = { kind: "fit", fitToken: fitIntentRef.current!.begin() };
        if (!user) {
            pendingRef.current = queuePending(pendingRef.current, { kind: "upload", payload: true });
            openAuth();
            return;
        }
        setImportOpen(true);
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

    // SERP-ask's tappable seeds — recent searches first, then the curated
    // fallback list, deduped to ~8 (lib/jobs/recent-searches.ts,
    // unit-tested). Cheap and pure, so computed unconditionally rather than
    // gated on `isSerpAsk` — matches this file's other render-prep consts.
    const searchSeeds = resolveSearchSeeds(recentSearches);

    const searchPlaceholder = "What kind of work are you looking for?";

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

    // Deliverable 1 — results render normally on a degraded (served-from-cache)
    // response; this is just the honest caption for it. See
    // `degradedResultsNote` (result-state.ts) for what `meta.degraded` means
    // and why an absent `meta` reads as live, never as degraded.
    const degradedNote = result ? degradedResultsNote(result) : null;

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
            active={selectedId === j.id}
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
        setQuery("");
        setLocationDraft("");
        applyUrlState(buildUrlState({ q: "" }), "replace");
        const nextFacets = { ...filterState.facets };
        delete nextFacets.location_country;
        if (Object.keys(nextFacets).length !== Object.keys(filterState.facets).length) {
            applyFilterState({ ...filterState, facets: nextFacets });
        }
    };

    const resultsCountLabel =
        loading && hits.length > 0 ? "updating…" : resultCountLine;

    /**
     * `/jobs` renders one layout, not two: the search line, filter toggle,
     * and result count stay mounted whether the query is empty
     * (`isSerpAsk` — tappable search seeds, chrome preserved) or has
     * results. The full-screen automation-first hero lives on `/`
     * (`src/app/page.tsx`), not on this route.
     */
    return (
        <div
            className="min-h-screen text-foreground"
            style={{
                background:
                    "radial-gradient(900px 500px at 50% 20%, #1a1f27 0%, transparent 55%), #12151a",
            }}
        >
            <main className="mx-auto flex min-h-screen w-full max-w-[920px] flex-col px-4 pb-20 pt-7 sm:px-5">
                <a
                    href="#jobs-results-list"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:border focus:border-foreground focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
                >
                    Skip to results
                </a>

                <section className="rounded-none border border-white/10 bg-black/30 p-3 backdrop-blur-[18px]">
                    <div data-search-line className="flex flex-wrap gap-2">
                        <SearchAutocomplete
                            value={query}
                            onChange={(v) => {
                                setQuery(v);
                                applyUrlState(buildUrlState({ q: v }), "replace");
                            }}
                            onSearch={() => submitSearch(query)}
                            suggest={suggestForBox}
                            placeholder={searchPlaceholder}
                            className="h-[46px] min-w-[260px] flex-[1_1_260px] rounded-none border-0 bg-black/40 px-3.5 text-sm text-[#ececec] shadow-none placeholder:text-[#5c636e] focus-visible:border-0 focus-visible:bg-black/40 focus-visible:ring-0"
                            containerClassName="min-w-0 flex-1"
                        />
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
                            className="h-[46px] max-w-[200px] flex-[0_1_200px] rounded-none border-0 bg-black/40 px-3.5 text-sm text-[#ececec] shadow-none placeholder:text-[#5c636e] focus-visible:border-0 focus-visible:bg-black/40 focus-visible:ring-0"
                        />
                        <Button
                            type="button"
                            onClick={() => submitSearch(query)}
                            className="h-[46px] rounded-none bg-[#ececec] px-[18px] text-[13px] font-semibold text-[#12151a] hover:opacity-90"
                        >
                            Search
                        </Button>
                    </div>
                </section>

                <section
                    data-testid="jobs-toolbar"
                    className="mt-5 rounded-none border border-[#8b919a] bg-[#2a313c] px-3 py-3"
                >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <button
                            type="button"
                            data-testid="filters-toggle"
                            aria-expanded={filtersOpen}
                            aria-haspopup="true"
                            aria-controls="filters-panel"
                            onClick={() => setFiltersOpen((v) => !v)}
                            className={cn(
                                "inline-flex h-9 items-center gap-1.5 rounded-none border-2 border-[#ececec] bg-transparent px-3 text-[13px] font-semibold text-[#ececec] hover:bg-[#ececec]/12",
                                filtersOpen && "border-[#ececec] bg-[#ececec] text-[#12151a] hover:bg-[#ececec]",
                                activeCount > 0 && "has-active",
                            )}
                        >
                            <FunnelSimple size={14} weight="bold" aria-hidden />
                            Filters
                            {activeCount > 0 && (
                                <span className="font-mono text-[10px] opacity-80">· {activeCount}</span>
                            )}
                            {filtersOpen ? <CaretUp size={12} weight="bold" aria-hidden /> : <CaretDown size={12} weight="bold" aria-hidden />}
                        </button>
                        {fitActive && (
                            <button
                                type="button"
                                onClick={clearFit}
                                className="text-xs text-[#c4c9d1] underline underline-offset-2 hover:text-[#ececec]"
                            >
                                ranked by your résumé ✕
                            </button>
                        )}
                        {trackedCount > 0 && (
                            <Link
                                href="/yours"
                                data-testid="jobs-tracked-count"
                                className="font-mono text-[12px] font-medium text-[#c4c9d1] underline underline-offset-[3px] hover:text-[#ececec]"
                            >
                                {trackedCount} tracked
                            </Link>
                        )}
                        {result?.configured && (
                            <div
                                role="group"
                                aria-label="Sort"
                                className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1"
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

                    {!isSerpAsk && (
                        <Link
                            href="/"
                            className="mt-2 inline-block text-[12px] text-[#8b919a] underline underline-offset-[3px] hover:text-[#c4c9d1]"
                        >
                            There&apos;s a version of this that works while you sleep →
                        </Link>
                    )}

                    {filtersOpen && (
                        <div
                            id="filters-panel"
                            data-testid="filters-panel"
                            className="panel-enter mt-3 max-h-[min(62vh,520px)] overflow-y-auto overscroll-contain rounded-none border border-[#5c636e] bg-[#12151a] p-4 text-[#ececec] custom-scrollbar"
                        >
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
                                        pressed={
                                            fitActive || (!fitActive && effectiveSort === "relevance" && !!query.trim())
                                        }
                                        onClick={chooseBestMatch}
                                    />
                                </div>
                            )}
                            <SerpFilters
                                distribution={result?.facetDistribution}
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
                        </div>
                    )}

                    <SavedSearchesPanel
                        saved={savedSearches}
                        urlState={buildUrlState()}
                        canSave={canSaveSearch}
                        onApply={applySavedSearch}
                        className="mt-2 px-0.5"
                    />
                </section>

                <div className="mt-9 flex min-h-0 flex-1 flex-col">
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
                            <div className="mb-3 shrink-0 border-l-2 border-verdict-caution pl-3 font-mono text-xs text-verdict-caution">
                                {result.note}
                            </div>
                        )}

                        {backgroundError && (
                            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-l-2 border-verdict-risk pl-3 font-mono text-xs text-verdict-risk">
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
                            {isSerpAsk ? (
                                /* Screen 3's SERP-ask (product spec §2): filters are
                                   active (see `resolveEmptySearchState`), so the chrome
                                   above stays up — search line, filter band — but
                                   there is genuinely nothing to list (rule §1: an
                                   empty query never fetches the corpus). Seeds =
                                   recent searches first, then the curated fallback
                                   list, deduped — `resolveSearchSeeds`
                                   (lib/jobs/recent-searches.ts, unit-tested). Tapping
                                   one goes through the exact same `submitSearch`
                                   chokepoint a typed Enter/suggestion-pick uses, so
                                   the URL write and recent-searches recording can't
                                   drift from a real search. Styled like SerpFilters'
                                   own `Affordance` grammar — no pills, no buttons. */
                                <div className="text-left" data-testid="serp-ask">
                                    <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#aeb4bd]">
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
                                                className="max-w-[min(100%,14rem)] truncate text-[13px] font-medium text-[#ececec] underline underline-offset-[3px] transition-opacity duration-100 hover:opacity-80"
                                            >
                                                {seed}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : notConnected ? (
                                <div className="border-l-2 border-foreground py-6 pl-4 text-left">
                                    <p className="font-mono text-[13px] text-foreground">Job search is being connected.</p>
                                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
                                        We&apos;re wiring intervu up to Subspace&apos;s live job corpus — including the ghost-job
                                        signal that flags postings that aren&apos;t really hiring.
                                    </p>
                                    {result?.note && (
                                        <p className="mt-1 max-w-md font-mono text-xs text-muted-foreground/70">{result.note}</p>
                                    )}
                                </div>
                            ) : blockingError ? (
                                // Deliverable 1 — the only remaining hard-stop state: a
                                // search genuinely has no results available at all (a
                                // served-but-stale response renders normally with
                                // `degradedNote` instead, above). Calmer headline than
                                // the old static "Job search is temporarily
                                // unavailable." repeated right above `searchError`,
                                // which itself often already opens with that same
                                // backend-supplied phrase — this no longer says it twice.
                                <div role="alert" className="border-l-2 border-verdict-risk py-6 pl-4 text-left">
                                    <p className="font-mono text-[13px] text-foreground">We can&apos;t load results right now.</p>
                                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">{searchError}</p>
                                    <button
                                        onClick={() => setSearchRetry((n) => n + 1)}
                                        className="mt-3 font-mono text-xs text-foreground underline underline-offset-2"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : loading && hits.length === 0 ? (
                                <JobsListSplash />
                            ) : hits.length === 0 ? (
                                <EmptyResults
                                    entries={activeEntries}
                                    onClearEntry={(entry) => applyFilterState(entry.clear(filterState))}
                                    onClearFilters={panelClearAll}
                                    query={query}
                                    onClearQuery={handleClearSearch}
                                    ghostRevealCount={ghostRevealCount}
                                    onRevealGhosts={() => onHideGhosts(false)}
                                />
                            ) : (
                                <>
                                    {!isSerpAsk && (
                                        <>
                                            {!user && !guestTipDismissed && (
                                                <div
                                                    data-testid="guest-serp-tip"
                                                    className="mb-3 flex items-baseline justify-between gap-3 font-mono text-[11px] text-faint"
                                                >
                                                    <span>{GUEST_SERP_TIP}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setGuestTipDismissed(true)}
                                                        className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            )}
                                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                                                <span
                                                    data-testid="result-line"
                                                    className="text-[13px] text-muted-foreground tabular-nums"
                                                >
                                                    {resultsCountLabel}
                                                </span>
                                                {(query.trim() || activeCount > 0) && (
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                        {activeCount > 0 && (
                                                            <button
                                                                type="button"
                                                                data-testid="results-clear-filters"
                                                                onClick={panelClearAll}
                                                                className="text-[13px] font-medium text-foreground underline underline-offset-[3px]"
                                                            >
                                                                Clear filters
                                                                {activeCount > 1 ? (
                                                                    <span className="ml-1 font-mono text-[11px] opacity-75">
                                                                        · {activeCount}
                                                                    </span>
                                                                ) : null}
                                                            </button>
                                                        )}
                                                        {query.trim() && (
                                                            <button
                                                                type="button"
                                                                data-testid="results-clear-query"
                                                                onClick={handleClearSearch}
                                                                className="text-[13px] font-medium text-foreground underline underline-offset-[3px]"
                                                            >
                                                                ✕ clear search
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {activeCount > 0 && (
                                                <ActiveFilterActions
                                                    className="mb-3"
                                                    entries={activeEntries}
                                                    onClearEntry={(entry) => applyFilterState(entry.clear(filterState))}
                                                    clearFiltersTestId="results-clear-filters-chip-row"
                                                    clearQueryTestId="results-clear-query-chip-row"
                                                    chipTestId="results-clear-chip"
                                                />
                                            )}
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
                                                <span className="ml-2 font-mono text-[12.5px] font-normal text-[color:var(--elite-muted)]">
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
                                                    className="border-t border-border pt-4 pb-1 mb-1 font-mono text-[11px] text-muted-foreground"
                                                >
                                                    {seamSummary(seamIndex, total, hits.length)}
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
                                    {hasMore ? (
                                        <div ref={sentinelRef} className="flex items-center justify-center py-5">
                                            {loadingMore ? (
                                                <span className="font-mono text-xs text-muted-foreground">Loading more roles…</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => void loadMore()}
                                                    className="font-mono text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                                >
                                                    Show {Math.min(PAGE, Math.max(total - hits.length, 0)) || PAGE} more ↓
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="py-5 text-left font-mono text-xs text-muted-foreground/70">
                                            You&apos;ve reached the end — {formatCorpusCount(totalCount)}{" "}
                                            {totalCount.value === 1 ? "role" : "roles"}.
                                        </p>
                                    )}
                                    <SearchSeedLine onSubmit={handleSeedSubmit} submitting={seedSubmitting} />
                                </div>
                                </>
                            )}
                        </div>
                </div>
            </main>

            <AuthPopover
                open={authOpen}
                onOpenChange={(open) => {
                    // A close WITHOUT a preceding `onAuthed` (handleAuthed sets
                    // authedRef before this fires on success) is a dismissal —
                    // drop any queued action so it can't replay on a later,
                    // unrelated sign-in. Race-free: this reads authedRef, never
                    // the relative timing of setUser / setAuthOpen.
                    if (!open && !authedRef.current) clearPendingGate();
                    setAuthOpen(open);
                }}
                onAuthed={handleAuthed}
                showTrigger={false}
                valueLine={
                    authGateValueLine && (
                        <>
                            <b className="text-foreground">Create a free account</b> — we&apos;ll take you straight
                            to the posting and start tracking this application.
                        </>
                    )
                }
            />
            <ResumeImportModal
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onImport={handleImport}
                confirmLabel="Rank my jobs"
            />
            <Sheet
                open={detailSheetOpen}
                onOpenChange={(open) => {
                    if (shouldBackOnDetailSheetClose(open, searchParams.get("job"))) router.back();
                }}
            >
                <SheetContent
                    side="bottom"
                    hideCloseButton
                    overlayClassName="bg-[rgba(18,21,26,0.42)]"
                    className="left-1/2 flex max-h-[min(88vh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden rounded-t-[18px] border border-border border-b-0 p-0 shadow-[0_-18px_50px_rgba(18,21,26,0.18)] data-[state=open]:duration-[var(--transition-panel)] data-[state=closed]:duration-[var(--transition-panel)]"
                >
                    <div className="flex shrink-0 justify-center py-2.5 pt-2.5" aria-hidden>
                        <span className="h-1 w-9 rounded-full bg-[#d0d6de]" />
                    </div>
                    <SheetTitle className="sr-only">
                        {detailJob ? `${decodeText(detailJob.title)} at ${cleanCompany(detailJob.company)}` : "Job details"}
                    </SheetTitle>
                    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    {detailJob ? (
                        <>
                            <JobDetail
                                key={detailJob.id}
                                job={detailJob}
                                now={nowMs}
                                applied={!!detailPursuit && hasReachedStage(detailPursuit, "applied")}
                                applying={applyingId === detailJob.id}
                                signedIn={Boolean(user)}
                                onRequestSignIn={() => {
                                    setAuthGateValueLine(true);
                                    setAuthOpen(true);
                                }}
                                onOpenPosting={() => handleOpenPosting(detailJob)}
                                onMarkApplied={() => handleMarkApplied(detailJob)}
                                onGoAfter={() => handleGoAfter(detailJob)}
                                variants={detailVariants}
                                pursuit={detailPursuit}
                                goingAfter={goingAfterId === detailJob.id}
                                onClose={() => router.back()}
                                className="border-0 bg-transparent shadow-none"
                            />
                            {user ? (
                            <JobDetailActionBar
                                job={detailJob}
                                signedIn
                                onOpenPosting={() => handleOpenPosting(detailJob)}
                            />
                            ) : null}
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
                    ) : null}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}

function JobsLoading() {
    return (
        <div
            className="flex min-h-screen items-center justify-center text-[#8b919a]"
            style={{ background: "#12151a" }}
        >
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#7cb87a]/20 border-t-[#7cb87a]" />
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
