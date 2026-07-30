"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    MagnifyingGlass,
    ArrowSquareOut,
    WarningCircle,
    Lightning,
    Compass,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchAutocomplete } from "@/components/search/SearchAutocomplete";
import type { SearchSuggestion } from "@/lib/search-suggestions";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    searchJobsAction as searchJobsActionRaw,
    markJobAppliedAction,
    suggestAdjacentRolesAction,
    getJobsFreshnessAction,
    getPostedDateFilterSupportAction,
    suggestJobsAction,
    recordJobOpenedAction,
} from "@/actions/jobs";
import { goAfterJobAction, createManualPursuit } from "@/actions/application";
import { usePursuits, invalidatePursuitsCache, syncGuestPursuitsToServer } from "@/lib/pursuits/use-pursuits";
import { syncGuestFollowsToServer, useFollows } from "@/lib/follows/use-follows";
import { FollowAlertsCard } from "@/components/follows/FollowAlertsCard";
import { addGuestPursuit, addManualGuestPursuit } from "@/lib/pursuits/guest-store";
import { hasReachedStage } from "@/lib/pursuits/types";
import { withSettleGuard, EXPLORE_SUGGEST_TIMEOUT_MS } from "@/lib/jobs/settle-guard";
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
    activeFilterEntries,
    toggleFacetValue,
    PRISTINE_FILTER_STATE,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import { SerpFilters } from "@/components/jobs/SerpFilters";
import { TailorAnalysisSheet, type TailorJob } from "@/components/jobs/TailorAnalysisSheet";
import { FitDrawer } from "@/components/jobs/FitDrawer";
import { JobDetail } from "@/components/jobs/JobDetail";
import { CompanyInitialTile } from "@/components/jobs/CompanyLogo";
import { CompanyIntelStrip } from "@/components/jobs/CompanyIntelStrip";
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
} from "@/lib/jobs/result-state";
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
import { buildMatchQuery, resolveExploreOutcome, topSkills, seniorityFromYears } from "@/lib/jobs/resume-match";
import {
    emptyPending,
    queuePending,
    clearPending,
    takeReplay,
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
 *  because every search on this page — first page, retry, load-more, Explore
 *  — already funnels through this one wrapper, and an open is only ever
 *  attributable to the latest result set the user is looking at. */
let lastSearchId = "";

const searchJobsAction = (params: JobSearchParams): Promise<JobSearchResult> =>
    withSettleGuard(
        searchJobsActionRaw(params).then((r) => {
            lastSearchId = r.searchId;
            return r;
        }),
    );

/**
 * Same chokepoint shape as `searchJobsAction` above, for Explore's AI-
 * suggestion call — the other Server Action on this page that can hang
 * without ever resolving/rejecting. See `EXPLORE_SUGGEST_TIMEOUT_MS`
 * (settle-guard.ts) for why it gets a longer, separately-named deadline
 * instead of reusing `ACTION_SETTLE_TIMEOUT_MS`.
 */
const suggestAdjacentRoles = (
    input: Parameters<typeof suggestAdjacentRolesAction>[0],
): ReturnType<typeof suggestAdjacentRolesAction> =>
    withSettleGuard(suggestAdjacentRolesAction(input), EXPLORE_SUGGEST_TIMEOUT_MS);

/* ----------------------------- helpers ----------------------------- */

/** Reverse of `urlSortToMode`, for writing the URL from an in-app sort choice. */
function modeToUrlSort(mode: JobSortMode): UrlSort {
    return mode === "salary_desc" ? "salary" : mode;
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

const DESKTOP_MQ = "(min-width: 1024px)";
function subscribeDesktopMq(onStoreChange: () => void) {
    if (typeof window === "undefined") return () => {};
    const mq = window.matchMedia(DESKTOP_MQ);
    mq.addEventListener("change", onStoreChange);
    return () => mq.removeEventListener("change", onStoreChange);
}
function getDesktopMqSnapshot() {
    return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}
function getDesktopMqServerSnapshot() {
    return false;
}

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
    onFit,
    onCompany,
    onOpenPosting,
    now,
    elite = false,
}: {
    job: PublicJob;
    active: boolean;
    opened: boolean;
    onClick: () => void;
    onFit?: (job: PublicJob) => void;
    onCompany?: (job: PublicJob) => void;
    onOpenPosting?: (job: PublicJob) => void;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    /** Elite board intel strip styling (board=elite). */
    elite?: boolean;
}) {
    const accessibleName = `${decodeText(job.title)} at ${cleanCompany(job.company) || "Unknown company"}`;
    const verdict = verdictFor(job, now);
    const flagged = verdict.tone === "warn" || verdict.tone === "danger";
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), now);
    const level = prettyEnum(job.experience_level);
    const clearGhost = !flagged && (job.ghost_badge === "clear" || !job.ghost_badge);

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
                "group mb-2.5 grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_72px] gap-3 rounded-[14px] border border-border bg-card p-4 text-left shadow-sm transition-colors duration-100 hover:border-foreground/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/60 focus-visible:-outline-offset-2",
                active && "border-brand bg-brand/5",
            )}
        >
            <CompanyInitialTile name={job.company} className="h-12 w-12 rounded-[10px] text-[17px]" />
            <div className="min-w-0">
                <div
                    data-testid="job-title"
                    className={cn(
                        "text-[15px] leading-snug tracking-tight",
                        opened ? "font-medium text-muted-foreground" : "font-semibold",
                    )}
                >
                    {decodeText(job.title)}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
                    {onCompany ? (
                        <button
                            type="button"
                            className="font-medium text-brand hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCompany(job);
                            }}
                        >
                            {cleanCompany(job.company) || "Unknown company"}
                        </button>
                    ) : (
                        <span className="font-medium text-brand">{cleanCompany(job.company) || "Unknown company"}</span>
                    )}
                    <span>{locationText(job)}</span>
                    {salary && <span className="font-mono text-[12px]">{salary}</span>}
                    {level && <span className="font-mono text-[12px]">{level}</span>}
                </div>
                {clearGhost && (
                    <div className="mt-2 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden />
                        <span className="font-mono text-[12px] font-medium text-brand">Live · no ghost signals</span>
                    </div>
                )}
                {flagged && (
                    <div className={cn("mt-2 font-mono text-[12px]", VERDICT_TONE_CLASS[verdict.tone])}>
                        {verdict.code.toLowerCase()}
                    </div>
                )}
                {onFit && (
                    <button
                        type="button"
                        data-testid="am-i-a-fit"
                        className="mt-2 text-[13px] font-medium text-brand hover:underline"
                        onClick={(e) => {
                            e.stopPropagation();
                            onFit(job);
                        }}
                    >
                        Am I a fit? →
                    </button>
                )}
                <div className="mt-2.5 border-t border-border pt-2.5">
                    <CompanyIntelStrip job={job} elite={elite} />
                </div>
            </div>
            <div className="flex flex-col items-center justify-start gap-2">
                {job.apply_url && onOpenPosting && (
                    <button
                        type="button"
                        className="w-full rounded-lg border border-foreground/20 px-2 py-1.5 text-[12px] font-semibold text-foreground transition-colors group-hover:border-foreground group-hover:bg-foreground group-hover:text-background"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenPosting(job);
                        }}
                    >
                        Apply
                    </button>
                )}
                {age && <div className="font-mono text-[11.5px] text-muted-foreground">{age}</div>}
            </div>
        </div>
    );
}

/* ------------------------- description renderer ------------------------- */


/* ----------------------------- detail panel ----------------------------- */


/**
 * Shared CTA for both dead-job detail states below. The label is honest
 * about what actually happens on click — review fix: it used to always say
 * "See similar roles" and call straight into `handleExploreClick`, but for
 * a COLD visitor with no usable résumé on hand (the common case for someone
 * following a shared link cold, not already signed into the app),
 * `handleExploreClick` doesn't show similar roles at all — it opens a
 * sign-in or résumé-upload gate. `canShowSimilar` (computed by the caller
 * from `resumeIsUsable(resume)`, the SAME bar the résumé-upsell card uses)
 * decides which promise this button actually keeps.
 */
function SimilarRolesCta({
    onClick,
    exploring,
    canShowSimilar,
}: {
    onClick: () => void;
    exploring: boolean;
    canShowSimilar: boolean;
}) {
    return (
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" disabled={exploring} onClick={onClick}>
            <Compass size={14} />
            {exploring ? "Finding similar roles…" : canShowSimilar ? "See similar roles" : "Browse live roles"}
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
 * brief specified. The CTA (`SimilarRolesCta` above) reuses the Explore
 * entry point when a résumé is on hand, or falls back to a plain browse
 * otherwise — via a wrapper that first clears the dead `job=` param (see
 * `handleTombstoneSimilarRoles`): Explore only rewrites the URL when
 * "ranked by résumé" was previously active, so a plain query-less dead link
 * would otherwise leave `job=<dead-id>` in place and the tombstone
 * re-asserting itself over Explore's fresh results.
 */
function DeadJobTombstone({
    onSimilarRoles,
    exploring,
    canShowSimilar,
}: {
    onSimilarRoles: () => void;
    exploring: boolean;
    canShowSimilar: boolean;
}) {
    return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <WarningCircle size={22} className="mb-3 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{DEAD_JOB_TOMBSTONE_TEXT}</h3>
            <SimilarRolesCta onClick={onSimilarRoles} exploring={exploring} canShowSimilar={canShowSimilar} />
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
    exploring,
    canShowSimilar,
    checking,
}: {
    onSimilarRoles: () => void;
    exploring: boolean;
    canShowSimilar: boolean;
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
            <SimilarRolesCta onClick={onSimilarRoles} exploring={exploring} canShowSimilar={canShowSimilar} />
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

/** Left-aligned loading line shown while the ledger's first page loads —
 *  no centered card, no decorative icon (anti-marker 5/6). */
function JobsListSplash() {
    return (
        <p className="py-8 font-mono text-[13px] text-muted-foreground">
            Finding live roles… screening each posting for ghost-job signals.
        </p>
    );
}

/* ----------------------------- results mode ----------------------------- */

/**
 * Results-view mode for /jobs. Jobs render on first paint for everyone —
 * there is no entry gate — so `mode` only ever tracks which results view is
 * active; it always starts at `"browse"`. `explore` is triggered by the
 * compact Explore button beside the search input (see `enterExplore`
 * below). The old Match mode is gone: "Rank by fit" is no longer a
 * page-wide mode, it's a sort choice — `buildMatchQuery`'s pipeline is
 * re-homed onto `sort=fit` + a dismissible chip (see `applyFit`).
 *
 * Whole-branch review fix — a `"search"` mode used to exist here (a
 * dedicated empty-query prompt state), but every `setMode` call site sets
 * either `"browse"` or `"explore"`; nothing in this file ever set `"search"`.
 * Removed as dead code, along with what that made unreachable: `SearchPrompt`
 * (its only render site), `MODE_META.search`, and the `shouldFetch`
 * early-return branch in the search effect below that existed solely to
 * skip fetching while `mode === "search"` and the query was empty.
 */
type Mode = "explore" | "browse";

/** A resume is "usable" for matching if it has a profession or at least one skill. */
function resumeIsUsable(d: ResumeData | undefined): boolean {
    if (!d) return false;
    if ((d.profile?.profession ?? "").trim()) return true;
    return (d.competencies ?? []).some((c) => (c.skills ?? []).some((s) => (s ?? "").trim()));
}

const PREP_MOVED_DISMISSED_KEY = "intervu.flip.note.dismissed";

// PrepMovedNote reads localStorage — a client-only external system — so it's
// wired through useSyncExternalStore rather than a mount effect + setState:
// the server snapshot (false) matches what SSR renders, and the real value
// applies on the client without a hydration mismatch. `dismiss()` below
// writes localStorage then notifies this one listener set directly, since
// nothing else needs to react to the flag changing.
const prepMovedListeners = new Set<() => void>();
function notifyPrepMovedChanged() {
    prepMovedListeners.forEach((cb) => cb());
}
function subscribePrepMoved(onChange: () => void) {
    prepMovedListeners.add(onChange);
    return () => prepMovedListeners.delete(onChange);
}
function getPrepMovedSnapshot(): boolean {
    try {
        const dismissed = localStorage.getItem(PREP_MOVED_DISMISSED_KEY) != null;
        const hadPrep = Object.keys(localStorage).some((k) => k.startsWith("intervu_prep_"));
        return !dismissed && hadPrep;
    } catch {
        // localStorage unavailable (private mode, etc.) — nothing to detect,
        // so stay silent rather than guess.
        return false;
    }
}
function getPrepMovedServerSnapshot(): boolean {
    return false;
}

/**
 * One-time note for returning prep users after the jobs-first flip (PR 1):
 * prep moved from `/` to `/prep`. Detects prior prep usage by localStorage
 * key prefix — `src/lib/prep/session-progress.ts` and `plan-list.ts` both
 * write keys under `intervu_prep_` — so jobs-only and brand-new visitors
 * never see it. Client-only: no server state, no cookies.
 */
function PrepMovedNote() {
    const visible = useSyncExternalStore(subscribePrepMoved, getPrepMovedSnapshot, getPrepMovedServerSnapshot);

    if (!visible) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(PREP_MOVED_DISMISSED_KEY, "1");
        } catch {
            /* best-effort — worst case the note reappears next visit */
        }
        notifyPrepMovedChanged();
    };

    return (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[13px] text-muted-foreground sm:px-6">
            <span>
                Interview prep moved — it now lives at{" "}
                <Link href="/prep" className="font-medium text-foreground underline underline-offset-2">
                    /prep
                </Link>
                .
            </span>
            <button
                onClick={dismiss}
                aria-label="Dismiss"
                className="shrink-0 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
                ✕
            </button>
        </div>
    );
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

function EmptyResults({
    entries,
    onClearEntry,
    query,
    onClearQuery,
    ghostRevealCount,
    onRevealGhosts,
}: {
    entries: FilterEntry[];
    onClearEntry: (entry: FilterEntry) => void;
    query: string;
    onClearQuery: () => void;
    ghostRevealCount: number | null;
    onRevealGhosts: () => void;
}) {
    const hasQuery = query.trim().length > 0;
    return (
        <div className="py-8 text-left">
            <p className="text-[14px] text-foreground">No roles match.</p>
            {(hasQuery || entries.length > 0) && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                    {hasQuery && (
                        <button
                            type="button"
                            data-testid="empty-state-clear-query"
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
                            data-testid="empty-state-clear-chip"
                            onClick={() => onClearEntry(entry)}
                            className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                        >
                            ✕ clear {entry.label}
                        </button>
                    ))}
                </p>
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
 * every other manual pursuit) and the caller routes straight into /prep for
 * it — see `handleSeedSubmit` below.
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
    // same reason `resultRef`/`selectedIdRef` exist below. Used by
    // `activateExplore` (review fix, 2026-07-18) so Explore reliably clears a
    // stale fit claim even via the post-auth replay path.
    const fitActiveRef = useRef(fitActive);
    fitActiveRef.current = fitActive;
    const [detailSheetOpen, setDetailSheetOpen] = useState(false);
    const isDesktop = useSyncExternalStore(subscribeDesktopMq, getDesktopMqSnapshot, getDesktopMqServerSnapshot);
    const [locationDraft, setLocationDraft] = useState(() => initialUrlState.facets.location_country?.[0] ?? "");
    const [fitJob, setFitJob] = useState<PublicJob | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchRetry, setSearchRetry] = useState(0);
    // S2 — recent-searches chips on the empty-query landing state.
    const recentSearches = useSyncExternalStore(
        subscribeRecentSearches,
        getRecentSearchesSnapshot,
        getRecentSearchesServerSnapshot,
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
    // Replaces the old session-only `appliedIds` state (forgot on reload) —
    // one shared, cached fetch that also serves TopBar and /yours.
    const { byJobId: pursuitsByJobId } = usePursuits();
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const [goingAfterId, setGoingAfterId] = useState<string | null>(null);
    const [seedSubmitting, setSeedSubmitting] = useState(false);
    const guestPursuitSyncRef = useRef(false);
    const guestSyncInFlightRef = useRef(false);
    const [tailorOpen, setTailorOpen] = useState(false);
    const [tailorJob, setTailorJob] = useState<TailorJob | null>(null);

    // Which results mode we're in, the resume backing Match/Explore, the
    // import modal, and the in-flight Explore call + its suggested titles.
    const [mode, setMode] = useState<Mode>("browse");
    // Mirrors `mode` for read access from the URL-reconcile effect below
    // (keyed on `[searchParams]` only, so it deliberately reads stale
    // closures for everything else — same idiom as `fitActiveRef`).
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const [resume, setResume] = useState<ResumeData | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    // Raw in-flight flag, written only by `runExplore`. Never read directly
    // outside this file's own derivation of `exploring` below — every
    // consumer (the toolbar button, the tombstone/empty-state CTAs) reads
    // the DERIVED `exploring` const instead, which also accounts for a
    // superseding action.
    const [exploringRaw, setExploringRaw] = useState(false);
    // Set when `runExplore`'s AI-suggestion call times out or throws (see
    // `EXPLORE_SUGGEST_TIMEOUT_MS`) — distinct from the action's own
    // `res.error` sentinels (auth/credits/no-suggestions), which already
    // have a graceful degrade path. This is the unexpected-failure case, so
    // it gets a real, visible error state instead of a silent fallback —
    // rendered as a band in the results area (below) with Retry + Browse.
    const [exploreFailed, setExploreFailed] = useState(false);

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

    // All four "run this after the user signs in" actions (apply / tailor /
    // upload / explore) live in one pure pending-state ref so only the LATEST
    // intent is ever queued and a dismissed action can never replay. See
    // lib/jobs/pending-actions.ts. `authedRef` is the deterministic success
    // signal from this page's AuthPopover (`onAuthed`) — replay fires only when
    // it's set, so an unrelated later sign-in (e.g. the sidebar "Log in", which
    // never touches this popover) replays nothing, race-free regardless of
    // whether `setUser(true)` or the popover-close lands first.
    const pendingRef = useRef<PendingState<PublicJob, PublicJob, ResumeData>>(
        emptyPending<PublicJob, PublicJob, ResumeData>(),
    );
    const authedRef = useRef(false);

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

    // Single source: résumé usable AND, for the auto-explore path below,
    // the sign-in this actually needs already satisfied — hoisted here
    // (instead of `resumeIsUsable(resume ?? undefined)` at each call site)
    // so `emptySearchState`'s auto-explore gate and the two later CTA
    // gates (`canShowSimilarRoles`/`hasUsableResume`, résumé-moment +
    // tombstone) share one computation. `resumeIsUsable` reads LOCAL state
    // only (no mount fetch) — see those two call sites' own doc comments
    // for why that's an accepted trade-off, not a bug.
    const hasUsableResume = resumeIsUsable(resume ?? undefined);

    // Single source for "what filters are currently active" — the toolbar
    // pill's count, the empty-state's per-filter clear chips, and
    // `emptySearchState` below all read this ONE call instead of a second
    // `activeFilterEntries(filterState)` per render.
    const activeEntries = activeFilterEntries(filterState);

    // One-way latch: false forever once either (a) this visit's query has
    // held real text — so landing back on empty is an intentional
    // in-session clear, never the first screen again — or (b) an
    // auto-explore attempt has actually fired (set by the effect near
    // `handleExploreClick` below), so an outcome that doesn't itself move
    // query/mode/exploreFailed (e.g. `resolveExploreOutcome`'s "no-fallback"
    // toast) can't re-select `"auto-explore"` forever. Mutated during
    // render like `fitActiveRef`/`modeRef` above, read by both effects.
    const initialLoadRef = useRef(true);
    if (query.trim()) initialLoadRef.current = false;

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
    const skipCorpusFetch = mode === "browse" && !query.trim();

    /**
     * The empty-query landing state (`lib/jobs/result-state.ts`,
     * unit-tested there) — replaces the old binary `showAsk` with the four
     * outcomes the product spec actually needs: ordinary `"results"`, the
     * full-screen first-ask overlay, the chrome-preserving `"serp-ask"` for
     * an already-filtered empty query, or an automatic hand-off into
     * Explore when a usable résumé is already on hand. `page.tsx` branches
     * on this value everywhere below instead of re-deriving the same
     * conditions inline.
     */
    const emptySearchState = resolveEmptySearchState({
        hasQuery: Boolean(query.trim()),
        fitActive,
        mode,
        activeFilterCount: activeEntries.length,
        hasUsableResume: hasUsableResume && Boolean(user),
        isInitialLoad: initialLoadRef.current,
        exploreFailed,
    });
    const isOverlayAsk = emptySearchState === "overlay-ask";
    const isSerpAsk = emptySearchState === "serp-ask";

    /**
     * Autofocus the line on desktop only (Screen 1 — the full-screen
     * overlay ask specifically, not the chrome-preserving SERP-ask). On a
     * phone, focusing on arrival throws the keyboard up over the question
     * before it can be read — and being read is that screen's entire job.
     *
     * Imperative rather than React's `autoFocus` prop because the viewport
     * test can only run on the client: deriving the prop from a media
     * query would disagree with the server-rendered markup and trip
     * hydration.
     */
    useEffect(() => {
        if (!isOverlayAsk) return;
        if (!window.matchMedia("(min-width: 640px)").matches) return;
        document.querySelector<HTMLInputElement>("[data-search-line] input")?.focus();
    }, [isOverlayAsk]);

    /** TopBar watches this so the masthead brand can morph from the hero. */
    useEffect(() => {
        const root = document.documentElement;
        if (isOverlayAsk) {
            root.setAttribute("data-jobs-overlay-ask", "1");
        } else {
            root.removeAttribute("data-jobs-overlay-ask");
        }
        return () => root.removeAttribute("data-jobs-overlay-ask");
    }, [isOverlayAsk]);

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
        const generation = paginationRef.current!.beginFirstPage();
        setSearchError(null);
        // Any new search (query/facet/sort/etc. change) supersedes a stale
        // Explore failure band — the user has already moved on.
        setExploreFailed(false);
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
                    setSearchError(r.note ?? "Job search is temporarily unavailable.");
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
                    setSearchError(SEARCH_UNAVAILABLE_MESSAGE);
                    // A thrown transport error is not an unconfigured backend
                    // or a successful empty result. Preserve prior data (if
                    // any) and let the explicit error state own first load.
                }
            } finally {
                if (
                    !cancelled &&
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
        // refetch rule without duplicating every field in this array. `mode`
        // is deliberately NOT listed: every `setMode` call site (applyFit,
        // activateExplore, enterBrowse, startOver) always pairs it with a
        // query/facets change in the same render, which `searchKey` already
        // covers — the dead `"search"`-mode branch that used to justify
        // `mode` being here directly is gone (whole-branch review fix).
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
            // Explore is ephemeral, non-URL state (`activateExplore` below
            // deliberately writes a browse-default URL — empty q, no
            // facets — while local `query`/`facets` hold the real explore-
            // derived values, by design). Re-deriving q/facets from the URL
            // here while explore is active would immediately stomp that
            // local state back to the URL's empty defaults — undoing
            // Explore the instant `activateExplore`'s OWN url-reset write
            // reaches this effect. `modeRef` (not the `mode` closure — this
            // effect only depends on `[searchParams]`) reads the latest
            // value. Every other field below stays reconciled unconditionally:
            // none of them are part of Explore's ephemeral contract.
            if (modeRef.current !== "explore") {
                setQuery(parsed.q);
                // Facets are an object, not a primitive — a same-content-but-new-
                // reference set would still be a needless render, so gate it on
                // serialized equality rather than setting unconditionally.
                const facetsChanged =
                    serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: parsed.facets }) !==
                    serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: current.facets });
                if (facetsChanged) setFacets(parsed.facets);
            }
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
        // Portal redesign: mobile uses bottom sheet; lg+ uses sticky inline pane.
        const jobId = parsed.jobId;
        setSelectedId(jobId);
        setDetailSheetOpen(Boolean(jobId) && !getDesktopMqSnapshot());
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
    // Review fix — the tombstone/unresolved CTA can only genuinely deliver
    // "similar roles" when a usable résumé is already on hand (the SAME bar
    // the résumé-upsell card uses, `resumeIsUsable`): with no résumé,
    // `handleExploreClick` doesn't explore anything — it opens a sign-in or
    // upload gate instead. `handleTombstoneSimilarRoles` (below) branches on
    // this; `SimilarRolesCta` labels the button accordingly. Aliases the
    // `hasUsableResume` hoisted above (single source — see its own comment)
    // rather than a second `resumeIsUsable(resume ?? undefined)` call.
    const canShowSimilarRoles = hasUsableResume;

    const handleResultsKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const idx = hits.findIndex((h) => h.id === selectedId);
            const base = idx < 0 ? 0 : idx;
            const next =
                e.key === "ArrowDown"
                    ? Math.min(base + 1, hits.length - 1)
                    : Math.max(base - 1, 0);
            if (hits[next]) selectJob(hits[next].id);
        },
        [hits, selectedId, selectJob],
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

    // Open the in-place analysis slideout for a job. Tailoring is AI-backed
    // (login-gated), so prompt sign-in first and resume once authenticated.
    const openTailor = (job: PublicJob) => {
        setTailorJob({
            company: cleanCompany(job.company),
            position: decodeText(job.title),
            description: job.description ?? "",
            url: job.apply_url || undefined,
        });
        setTailorOpen(true);
    };
    const handleTailor = (job: PublicJob) => {
        if (!user) {
            pendingRef.current = queuePending(pendingRef.current, { kind: "tailor", payload: job });
            openAuth();
            return;
        }
        openTailor(job);
    };
    const handlePrep = (job: PublicJob) => {
        const p = new URLSearchParams();
        p.set("company", job.company ?? "");
        p.set("position", job.title);
        p.set("round", "Technical");
        p.set("searched", "true");
        router.push(`/prep?${p.toString()}`);
    };
    const handleCompany = (job: PublicJob) => {
        if (!job.company_domain) return;
        router.push(`/co/${domainToSlug(job.company_domain)}`);
    };
    const handleOpenPosting = (job: PublicJob) => {
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
        if (!user) {
            pendingRef.current = queuePending(pendingRef.current, { kind: "apply", payload: job });
            openAuth();
            return;
        }
        void doMarkApplied(job);
    };

    // "Go after this job" (spec §3) — the one verb, no auth wall: signed out
    // writes straight to the guest store (merged at sign-in, see
    // `guestPursuitSyncRef` below); signed in calls the server chokepoint.
    const handleGoAfter = (job: PublicJob) => {
        if (!user) {
            addGuestPursuit(job);
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
    // create), and unlike go-after this always routes on to /prep once the
    // pursuit exists — `round` defaults to "Technical" for the same reason
    // `handlePrep` above does: DashboardContainer's URL-restore only loads a
    // session when company/position/round/searched are ALL present.
    const handleSeedSubmit = (company: string, position: string) => {
        const goToPrep = (pursuitId: string) => {
            const p = new URLSearchParams();
            p.set("company", company);
            p.set("position", position);
            p.set("round", "Technical");
            p.set("searched", "true");
            p.set("pursuitId", pursuitId);
            router.push(`/prep?${p.toString()}`);
        };

        if (!user) {
            goToPrep(addManualGuestPursuit(company, position).id);
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
                goToPrep(res.data.id);
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
    // never sets `authedRef`, so a stale apply/tailor/upload/explore can't fire.
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
            case "tailor":
                openTailor(action.payload);
                break;
            case "upload":
                setImportOpen(true);
                break;
            case "explore":
                void runExplore(action.payload);
                break;
        }
        // doMarkApplied / openTailor / runExplore read no changing component
        // state (only stable setters + the action payload), so capturing the
        // first render's closures here is safe — keep a stable identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Open the auth popover for a freshly-queued action. Resetting `authedRef`
    // here scopes the "success" signal to THIS attempt, so a prior confirmed
    // sign-in can't be mistaken for the new one.
    const openAuth = () => {
        authedRef.current = false;
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
            void (async () => {
                try {
                    const [pursuitsOk, followsOk] = await Promise.all([
                        syncGuestPursuitsToServer(),
                        syncGuestFollowsToServer(),
                    ]);
                    if (pursuitsOk && followsOk) {
                        guestPursuitSyncRef.current = true;
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
    // latest intent survives.
    const resumeActionAfterImportRef = useRef<{ kind: "fit"; fitToken: number } | { kind: "explore" } | null>(null);

    // Guards `handleRankByFit`'s async résumé fetch against being superseded
    // by a LATER sort choice (fit again, or any other sort option) made
    // while the fetch is still in flight — see lib/jobs/fit-intent.ts.
    // Instantiated once, mirroring the `paginationRef` idiom below.
    // (review fix, 2026-07-18)
    const fitIntentRef = useRef<FitIntentGuard | null>(null);
    if (!fitIntentRef.current) fitIntentRef.current = new FitIntentGuard();

    // Same guard, dedicated to Explore's own async gap: `runExplore` awaits
    // the (now deadline-bound, up to `EXPLORE_SUGGEST_TIMEOUT_MS`) AI-suggest
    // call before committing results. Without this, a slow/timed-out explore
    // that finally settles after the user has already moved on — to "Rank by
    // fit" (`applyFit`), a plain browse (`enterBrowse`), or "Start over"
    // (`startOver`), all of which bump this same guard — would clobber
    // whatever they're looking at now. `begin()` at the top of `runExplore`
    // also means a second Explore click supersedes an in-flight first one.
    const exploreIntentRef = useRef<FitIntentGuard | null>(null);
    if (!exploreIntentRef.current) exploreIntentRef.current = new FitIntentGuard();

    // Which `exploreIntentRef` generation `exploringRaw` currently belongs
    // to — set by `runExplore` the moment it begins. Read by the `exploring`
    // derivation directly below.
    const exploringTokenRef = useRef<number | null>(null);

    // The spinner/disabled-state every caller actually reads (the toolbar
    // Explore button, the tombstone/empty-state CTAs). Deriving it — rather
    // than scattering a clear-the-flag call into every superseding handler
    // (applyFit, enterBrowse/enterBrowseAndSync, startOver, typing
    // mid-explore) — is the chokepoint fix: ALL of those already call
    // `exploreIntentRef.current!.begin()` to supersede a stale in-flight
    // explore (see the doc comment above); this just reads that same guard
    // instead of writing to it a second time, so `exploring` goes false the
    // instant any of them fires, not just when `runExplore`'s own `finally`
    // eventually runs (previously: up to `EXPLORE_SUGGEST_TIMEOUT_MS`, 25s,
    // during which the button stayed disabled/spinning over whatever the
    // user actually navigated to). A future superseding action gets this
    // for free just by bumping the existing guard — no new call site to
    // remember. `exploringRaw` still requires `runExplore`'s OWN
    // `setExploringRaw(false)` in `finally` for the ordinary end-of-request
    // case, which this derivation alone doesn't cover.
    const exploring = exploringRaw && exploreIntentRef.current!.isCurrent(exploringTokenRef.current ?? -1);

    // Closes the gap between a click and `exploring` actually flipping true
    // (that state only flips inside `runExplore`, well after
    // `resolveUsableResume()`'s await resolves) — without this, a rapid
    // double-click on the Explore button could fire `enterExplore` twice and
    // double-spend a credit. (review fix, 2026-07-18)
    const exploreInFlightRef = useRef(false);

    // Cancel ANY action queued for after sign-in (apply / tailor / upload /
    // explore) so a later, unrelated login can't hijack the user into it — or
    // silently spend an Explore credit / write a phantom application they didn't
    // ask for. Called by every alternate path (results-mode entry, gate choice)
    // and on a dismiss of the popover. (code review, 2026-06-07; pending-state
    // unified + apply/tailor leak closed, 2026-06-08)
    const clearPendingGate = () => {
        pendingRef.current = clearPending(pendingRef.current);
        resumeActionAfterImportRef.current = null;
    };

    // A usable résumé for a résumé-driven action (fit or explore), fetched on
    // demand. Task 4 removed the mount-time auto-fetch, so `resume` local
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
        // Supersede a stale in-flight Explore before this résumé-driven mode
        // takes over — see `exploreIntentRef`'s doc comment above.
        exploreIntentRef.current!.begin();
        setMode("browse");
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

    // Shared "explore results are now showing" step for both the AI-suggested
    // path and the skill-based broaden fallback in `runExplore` below. Also
    // clears any stale "ranked by résumé" framing locally (the chip, the
    // Select's label) since Explore's query no longer reflects the fit
    // pipeline once this runs. Reads `fitActiveRef` (not the `fitActive`
    // closure) so this stays correct even invoked through `maybeReplay`'s
    // stable, first-render-captured `runExplore` reference.
    //
    // EXPLORE IS EPHEMERAL, SESSION-ONLY STATE (design decision, 2026-07-21
    // review) — the URL deliberately does NOT represent it. The prior
    // design (writing the derived `q` to the URL, gated on
    // `fitActiveRef.current`) had two proven bugs: (1) the write only fired
    // when clearing a STALE fit claim, so the far more common path —
    // Explore from plain browse — left the address bar completely
    // unmoved, silently desynced from what was actually showing; (2) even
    // when it DID fire, `mode` itself was never URL-represented, so
    // reloading a "synced" explore URL landed on `mode === "browse"` and
    // rendered the derived query VERBATIM in the search box — contradicting
    // this file's own task-(b) fix (never show query soup). Persisting
    // `mode` in the URL to close that gap would need a new param, a
    // reconcile-effect change, and a back-compat story — too much surface
    // for this fix. Ephemeral is the smaller, honest alternative: a refresh
    // or a shared link during Explore always lands on plain browse (30d
    // default) — truthful, since the URL never claimed to be showing
    // explore results in the first place.
    //
    // The write below always resets q/facets/sort to browse-default via
    // EXPLICIT overrides (not gated on `fitActiveRef` — that gate is
    // exactly what left the address bar stale in the common path above).
    // `jobId` is left alone (`buildUrlState`'s own default: whatever the
    // URL currently holds). On an already-default URL (the common case)
    // this is a no-op — `applyUrlState`'s own same-URL guard skips writing.
    // The URL-reconcile effect (keyed on `[searchParams]`, `modeRef` gate)
    // is what keeps this write from immediately stomping the `query`/
    // `facets` state just set above back to the URL's now-empty values.
    const activateExplore = (q: string) => {
        setFacets({});
        setQuery(q);
        setMode("explore");
        if (fitActiveRef.current) setFitActive(false);
        applyUrlState(buildUrlState({ q: "", facets: {}, sort: null }), "replace");
    };

    // Explore: ask the model for adjacent titles (1 credit). On auth →
    // popover + retry; on credits/empty → free skill-based broaden so the user
    // still gets a result. The auth GATE lives here; the authenticated body is
    // `runExplore` so the post-auth replay can re-run it without re-reading a
    // (possibly stale) `user` from a captured closure.
    const enterExplore = async (r: ResumeData) => {
        clearPendingGate();
        if (!user) {
            pendingRef.current = queuePending(pendingRef.current, { kind: "explore", payload: r });
            openAuth();
            return;
        }
        await runExplore(r);
    };

    // The authenticated Explore work. Reads no mutable component state beyond
    // its `r` argument + stable setters, so it is safe to invoke from the
    // stable-identity `maybeReplay` closure.
    //
    // The AI-suggest call goes through `suggestAdjacentRoles` (this file's
    // `withSettleGuard` chokepoint, `EXPLORE_SUGGEST_TIMEOUT_MS`), so the
    // `await` below is now GUARANTEED to settle — closing the class of "the
    // request never resolves and the spinner never stops" (prod bug: infinite
    // "Finding live roles…"). `finally` unconditionally clears `exploringRaw`,
    // so there is no path out of THIS function that leaves loading stuck. A
    // DIFFERENT action superseding this one (applyFit/enterBrowse/startOver/
    // typing mid-explore, all of which bump `exploreIntentRef`) is handled
    // separately — see the `exploring` derivation below, not here.
    //
    // The branching itself (success / auth / credits-or-soft-error fallback /
    // no-fallback-possible / hard failure) is `resolveExploreOutcome`
    // (lib/jobs/resume-match.ts) — a pure function, unit-tested there. Explore
    // is auth-gated, so this path can't be exercised by an anonymous browser
    // check; the pure-function extraction is what makes it verifiable at all.
    // `settled: null` (timeout or thrown rejection) maps to `"failed"`, a
    // real visible error band (`exploreFailed`) — never silently reported as
    // one of the action's own soft-error sentinels below it (no-lying-
    // fallbacks: a hung request isn't a "no suggestions" case).
    const runExplore = async (r: ResumeData) => {
        const token = exploreIntentRef.current!.begin();
        // Recorded so the `exploring` derivation (below) can tell whether
        // THIS specific attempt is still the current one.
        exploringTokenRef.current = token;
        setExploringRaw(true);
        setExploreFailed(false);
        try {
            let settled: Awaited<ReturnType<typeof suggestAdjacentRolesAction>> | null;
            try {
                settled = await suggestAdjacentRoles({
                    profession: r.profile?.profession ?? "",
                    skills: topSkills(r, 12),
                    seniority: seniorityFromYears(r.profile?.yearsOfExperience ?? 0),
                });
            } catch {
                settled = null;
            }
            if (!exploreIntentRef.current!.isCurrent(token)) return;
            const outcome = resolveExploreOutcome(
                settled,
                r,
                settled?.error ? classifySentinel(settled.error) : null,
            );
            switch (outcome.kind) {
                case "failed":
                    setExploreFailed(true);
                    return;
                case "auth":
                    pendingRef.current = queuePending(pendingRef.current, { kind: "explore", payload: r });
                    openAuth();
                    return;
                case "no-fallback":
                    toast.error("Couldn't build an explore view — try Rank by fit or search instead.");
                    return;
                case "fallback":
                    activateExplore(outcome.q);
                    toast.info(
                        outcome.credits
                            ? "Out of AI credits — showing skill-based matches instead."
                            : "Showing roles related to your skills.",
                    );
                    return;
                case "success":
                    activateExplore(outcome.q);
                    return;
            }
        } finally {
            setExploringRaw(false);
        }
    };

    // Sort menu → "Rank by fit" click. A résumé already on hand applies
    // immediately; otherwise queue the résumé importer (via the existing
    // `handleUploadClick` upload-gate, defaulting to a "fit" continuation —
    // see its doc comment) and apply fit the moment it completes (see
    // `handleImport`'s `resumeActionAfterImportRef` check).
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

    // Compact Explore button beside the search input. Same on-demand résumé
    // resolution as fit; the actual gating (auth/credits) is `enterExplore`/
    // `runExplore`, reused verbatim and unmodified. `exploreInFlightRef`
    // closes the click-to-`exploring`-state gap so a rapid double-click can't
    // fire `enterExplore` (and its 1-credit spend) twice before the button's
    // own `disabled={exploring}` has a chance to engage. (review fix,
    // 2026-07-18)
    const handleExploreClick = async () => {
        if (exploreInFlightRef.current) return;
        exploreInFlightRef.current = true;
        try {
            const r = await resolveUsableResume();
            if (r) {
                await enterExplore(r);
                return;
            }
            handleUploadClick("explore");
        } finally {
            exploreInFlightRef.current = false;
        }
    };

    // Resume auto-entry: the moment `emptySearchState` (above) decides the
    // empty-query landing should skip both asks and hand off to Explore, do
    // exactly that — reusing `handleExploreClick` VERBATIM, the same
    // function the toolbar's "explore roles like mine" affordance calls, so
    // auto-entry can never drift from a manual click's behavior (résumé
    // resolution, the exploreInFlight double-fire guard, credits/soft-error
    // fallback). `initialLoadRef.current = false` fires unconditionally and
    // FIRST — before `handleExploreClick` even resolves — so an outcome
    // that doesn't itself change query/mode/exploreFailed (e.g. a
    // "no-fallback" toast) still lands on the seeded ask on the next
    // render instead of re-deciding `"auto-explore"` forever; see
    // `initialLoadRef`'s own comment above.
    //
    // Effect (not inline in render) because entering Explore is a real
    // side effect (a network call, a mode/URL change) — `emptySearchState`
    // itself stays a pure read. The dependency is the single decided
    // string, so this fires exactly once per entry into `"auto-explore"`,
    // never on an unrelated re-render while it holds.
    useEffect(() => {
        if (emptySearchState !== "auto-explore") return;
        initialLoadRef.current = false;
        void handleExploreClick();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [emptySearchState]);

    // Task 11 review fix — the tombstone's "similar roles" CTA can't just
    // call `handleExploreClick` bare: the common dead link is a bare
    // `/?job=<id>` with no query, so `job=<dead-id>` is still the URL's
    // `job` param when this fires. `activateExplore` (above) only rewrites
    // the URL when "ranked by résumé" was active, so for this — the
    // overwhelmingly common — path it would leave `job=<dead-id>` in the
    // address bar untouched while local `query`/`mode` moved on to Explore;
    // the still-present dead id then re-triggers the existence-check
    // candidacy and the tombstone re-asserts itself over Explore's fresh
    // results. Clearing the job selection first (local state + URL) avoids
    // that: `selectedId` becomes null, so `isDeadJobCandidate` goes false
    // and any in-flight/stale `deadJobCheck` for the old id stops matching.
    //
    // Second review fix: `handleExploreClick` is résumé-gated — with no
    // usable résumé on hand (`canShowSimilarRoles` false, computed above),
    // it doesn't explore anything, it opens a sign-in/upload modal. Forcing
    // that on a cold visitor who just followed a now-dead shared link is
    // both a bait-and-switch on the button's own label AND an unwanted
    // gate for a low-intent moment, so this only calls into Explore when a
    // résumé is genuinely on hand; otherwise it falls back to a plain,
    // ungated browse of live roles (`enterBrowse`, the same helper
    // `SearchPrompt`'s "or browse all live roles" already uses) —
    // `SimilarRolesCta` labels the button to match whichever this resolves to.
    //
    // Third review fix — CTA-ordering: `enterBrowse()` clears `query`/
    // `facets` LOCALLY only (`setQuery("")`/`setFacets({})`), it never
    // touches the URL. Reordering the two calls alone wouldn't fix a stale
    // address bar either — `buildUrlState()` still reads THIS render's
    // `query`/`facets` closure regardless of call order within the same
    // synchronous handler, since React state setters don't apply
    // mid-function. So a visitor mid-search (`?q=eng`) clicking this CTA
    // used to end up with an EMPTY query box (state cleared) but `?q=eng`
    // still sitting in the address bar (URL never told about the clear) —
    // the same "closure doesn't see its own pending update" class as the
    // `fitActiveRef` fix a few lines up, just for `enterBrowse`'s fields
    // instead of `fitActive`. Fixed by mirroring `enterBrowse`'s exact
    // local writes (`q`/`facets`) as EXPLICIT overrides in the SAME
    // `applyUrlState` call, rather than relying on a second implicit read.
    const handleTombstoneSimilarRoles = () => {
        setSelectedId(null);
        if (canShowSimilarRoles) {
            applyUrlState(buildUrlState({ jobId: null }), "replace");
            void handleExploreClick();
        } else {
            enterBrowseAndSync({ jobId: null });
        }
    };

    const enterBrowse = () => {
        // Supersede a stale in-flight Explore — see `exploreIntentRef`'s doc
        // comment above.
        exploreIntentRef.current!.begin();
        clearPendingGate();
        setFacets({});
        setQuery("");
        setMode("browse");
    };

    // `enterBrowse()` only touches LOCAL state — every caller that means to
    // abandon a non-default query/facets (Explore's error-band escape, the
    // "Exploring…" chip's dismiss, the tombstone's ungated fallback above)
    // pairs it with the SAME explicit `q`/`facets` URL override, so the
    // address bar can't lag behind local state (the closure-staleness class
    // `handleTombstoneSimilarRoles` used to hit before this was extracted —
    // see the CTA-ordering review-fix history on that function). `overrides`
    // lets the tombstone also clear `jobId`, which the other two callers
    // don't need.
    const enterBrowseAndSync = (overrides: Partial<JobsUrlState> = {}) => {
        enterBrowse();
        applyUrlState(buildUrlState({ q: "", facets: {}, ...overrides }), "replace");
    };

    // THE single entry point for opening the résumé importer from this page —
    // every caller (sort menu "Rank by fit", the compact Explore button, the
    // upsell card's "Upload résumé", any future one) must go through this,
    // not `setImportOpen(true)` directly, because this is also the one place
    // that queues `resumeActionAfterImportRef` — what `handleImport` (below)
    // runs once the upload actually completes. Bug this fixes: the upsell
    // card used to call `handleUploadClick` bare with no follow-up wiring,
    // so an upload started FROM the card queued nothing — the modal closed
    // and nothing visibly happened, no re-rank, no chip (user-reported).
    //
    // Defaults to `"fit"` — product contract: ANY upload initiated from
    // /jobs ends in ranked results, not a silent no-op. `handleExploreClick`
    // is the one caller that overrides it to `"explore"`; every other
    // caller (including the upsell card) gets the default for free, so a
    // future entry point can't forget this by construction.
    //
    // `clearPendingGate()` runs FIRST (it zeroes this same ref), so the
    // queue write below has to come after it, not before.
    //
    // For `"fit"`, `fitIntentRef.current!.begin()` pins the CURRENT guard
    // generation into the queued continuation (`fitToken`) — `handleImport`
    // checks it's still current before applying. Without this, a sort
    // choice made WHILE the upload modal is still open (which bumps this
    // same guard — see the Select's `onValueChange` below — but does NOT
    // clear this ref) would get silently clobbered once the upload finally
    // completes, minutes later. `"explore"` doesn't need an equivalent: the
    // eventual `enterExplore`→`runExplore` call begins its OWN fresh
    // `exploreIntentRef` token when it actually runs, which already
    // supersedes anything stale by construction.
    const handleUploadClick = (intent: "fit" | "explore" = "fit") => {
        clearPendingGate();
        resumeActionAfterImportRef.current =
            intent === "fit" ? { kind: "fit", fitToken: fitIntentRef.current!.begin() } : { kind: "explore" };
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
        } else if (queuedAction?.kind === "explore") {
            void enterExplore(data);
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



    /**
     * The route is ONE tree with two layouts, not two trees.
     *
     * Screen 1 (the line) and Screen 3 (the pinned line over results) render
     * the SAME `SearchAutocomplete` element at the same position, with only
     * the layout around it changing. That is load-bearing, not tidiness:
     * React keeps a component's identity by its position in the element tree,
     * so rendering the two screens as separate returns made the first
     * keystroke unmount the input and mount a different one. Focus went with
     * it and the rest of the sentence was typed into nothing — verified live,
     * "product manager" arrived as "p".
     *
     * Screen 1 covers the app masthead with a fixed layer rather than asking
     * the shell to hide it: the masthead belongs to every route, and a route
     * reaching up to reconfigure the frame around it is how one page's
     * redesign quietly becomes every page's problem. That is also why this
     * route no longer uses `PageLayout` — its shell is genuinely its own now.
     */
    return (
        <div
            className={cn(
                "bg-background",
                isOverlayAsk
                    ? "fixed inset-0 z-50 flex flex-col items-center overflow-y-auto px-6"
                    // The viewport pin lives on the SHELL, which starts below the
                    // 3.5rem masthead. Putting it on the results pane instead
                    // double-counts the chrome and pushes the document one band
                    // past the viewport (measured: 1051 vs 900 at 1440x900).
                    : "flex min-h-screen flex-col lg:h-[calc(100dvh-3.5rem)] lg:min-h-0 lg:overflow-hidden",
            )}
        >
            <div
                className={cn(
                    "w-full shrink-0",
                    isOverlayAsk ? "max-w-2xl pb-16 pt-[28dvh]" : "border-b border-border bg-card",
                )}
            >
                <div className={isOverlayAsk ? undefined : "mx-auto max-w-[1280px] px-4 pb-4 pt-5 lg:px-8 lg:pt-6"}>
                    {/* Empty ask: brand above the line as one composition.
                        Shared layoutIds morph into TopBar when results load. */}
                    {isOverlayAsk && (
                        <div className="mb-5 flex items-center gap-2.5 px-0.5">
                            <motion.span
                                layoutId="intervu-brand"
                                transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
                                className="font-display text-[28px] font-extrabold leading-none tracking-tight text-foreground sm:text-[32px]"
                            >
                                intervu
                            </motion.span>
                            <motion.span
                                layoutId="intervu-beta"
                                transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
                                className="rounded border border-border px-[5px] py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-faint"
                            >
                                beta
                            </motion.span>
                        </div>
                    )}
                    <div
                        data-search-line
                        className={cn(
                            isOverlayAsk ? "flex items-center gap-4" : "flex flex-col gap-3 lg:grid lg:grid-cols-[1.35fr_0.65fr_auto] lg:items-center lg:gap-3",
                        )}
                    >
                        <SearchAutocomplete
                            // Explore mode's `query` state carries the résumé-derived
                            // search string (AI-suggested titles, capped — see
                            // `capExploreTerms`), which used to render raw in this box:
                            // an unreadable wall of query soup. The "exploring roles
                            // adjacent to your résumé" affordance on the result line
                            // communicates that state instead; the box itself shows
                            // empty-with-placeholder while explore is active.
                            //
                            // Explore is ephemeral, session-only state — the URL
                            // deliberately does NOT represent it (see `activateExplore`'s
                            // doc comment): a refresh or a shared link during Explore
                            // lands on plain browse, never on this derived query. So
                            // gating just the DISPLAYED value on mode wouldn't be enough
                            // on its own — the box's `value` here and the URL are both
                            // intentionally out of sync with the underlying `query`
                            // state while exploring, by design, not by omission.
                            value={mode === "explore" ? "" : query}
                            onChange={(v) => {
                                if (mode === "explore") {
                                    // A manual edit is the user taking over from
                                    // Explore — supersede any stale in-flight explore
                                    // (see `exploreIntentRef`) before dropping back to
                                    // an ordinary browse-mode query.
                                    exploreIntentRef.current!.begin();
                                    setMode("browse");
                                }
                                setQuery(v);
                                // Continuous input is filter-like — `replace`, not `push` (a
                                // "push" per keystroke would make the back button undo one
                                // character at a time). Discrete submit (Enter, or picking a
                                // suggestion) uses `push` instead — see `onSearch` below.
                                applyUrlState(buildUrlState({ q: v }), "replace");
                            }}
                            onSearch={() => submitSearch(query)}
                            suggest={suggestForBox}
                            placeholder="What kind of work are you looking for?"
                            className={cn(
                                "h-11 rounded-xl border border-border bg-muted/40 px-3 shadow-none focus-visible:border-foreground focus-visible:ring-0",
                                isOverlayAsk ? "text-[19px]" : "text-[15px]",
                            )}
                            containerClassName="min-w-0 flex-1"
                        />
                        {!isOverlayAsk && (
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
                                className="h-11 rounded-xl border border-border bg-muted/40 px-3 shadow-none focus-visible:border-foreground focus-visible:ring-0"
                            />
                        )}
                        {!isOverlayAsk && (
                            <Button
                                type="button"
                                onClick={() => submitSearch(query)}
                                className="h-11 rounded-xl bg-foreground px-5 font-bold text-background hover:bg-foreground/90"
                            >
                                Search
                            </Button>
                        )}
                    </div>

                    {!isOverlayAsk && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    data-testid="filters-toggle"
                                    aria-expanded={filtersOpen}
                                    onClick={() => setFiltersOpen((v) => !v)}
                                    className={cn(
                                        "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-colors duration-100",
                                        filtersOpen
                                            ? "border-foreground bg-foreground text-background"
                                            : "border-border bg-card text-foreground hover:border-foreground/40",
                                    )}
                                >
                                    Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                                </button>
                                {activeEntries.map((entry) => (
                                    <span
                                        key={entry.key}
                                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 text-xs font-semibold text-brand"
                                    >
                                        {entry.label}
                                        <button
                                            type="button"
                                            aria-label={`Remove ${entry.label}`}
                                            onClick={() => applyFilterState(entry.clear(filterState))}
                                            className="leading-none opacity-70 hover:opacity-100"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                                {activeCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={panelClearAll}
                                        className="text-xs font-medium text-muted-foreground hover:text-foreground"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                                <span data-testid="result-line" className="tabular-nums">
                                    {loading && hits.length > 0 ? "updating…" : resultCountLine}
                                </span>
                                {mode === "explore" ? (
                                    <button
                                        type="button"
                                        onClick={() => enterBrowseAndSync()}
                                        className="text-foreground underline underline-offset-2"
                                    >
                                        exploring roles adjacent to your résumé ✕
                                    </button>
                                ) : fitActive ? (
                                    <button
                                        type="button"
                                        onClick={clearFit}
                                        className="text-foreground underline underline-offset-2"
                                    >
                                        ranked by your résumé ✕
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={exploring}
                                        onClick={() => void handleExploreClick()}
                                        className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground disabled:opacity-50"
                                    >
                                        {exploring ? "exploring…" : "explore roles like mine"}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {isOverlayAsk ? (
                        /* Returning visitor: their own previous sentences, as plain
                           grey lines. No heading, no chips — a heading would be the
                           page talking about itself on the one screen that isn't. */
                        recentSearches.length > 0 && (
                            <div className="mt-6 flex flex-col items-start gap-1.5">
                                {recentSearches.slice(0, 3).map((q) => (
                                    <button
                                        key={q}
                                        type="button"
                                        data-testid="recent-search-chip"
                                        onClick={() => submitSearch(q)}
                                        className="text-left text-[14px] text-muted-foreground transition-colors duration-100 hover:text-foreground"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        )
                    ) : null}

                    {/* The collapsible filter band (Vivek, 2026-07-26). Lives in
                        the pinned band so it never scrolls away from the line it
                        modifies; capped height with its own scroll so a long facet
                        list can't push the results off screen. Editorial affordance
                        band (SerpFilters), wired to the same single
                        `applyFilterState` funnel the old FilterPanel card used. */}
                    {!isOverlayAsk && filtersOpen && (
                        <div
                            data-testid="filters-panel"
                            className="mt-3 max-h-[45dvh] overflow-y-auto overscroll-contain rounded-[14px] border border-border bg-muted/30 p-5 custom-scrollbar"
                        >
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
                </div>
            </div>

            {!isOverlayAsk && (
                <main className="mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-1 gap-5 px-4 pb-6 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden lg:px-8">
                <div className="flex min-h-0 min-w-0 flex-col">
                <a
                    href="#jobs-results-list"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:border focus:border-foreground focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
                >
                    Skip to results
                </a>
                <PrepMovedNote />
                <div className="flex min-h-0 max-w-[880px] flex-1 flex-col pt-4 lg:max-w-none">
                    <div className="flex min-h-0 flex-col">
                        {/* Screen 4 — the relaxed pass. `widened` now means the STRICT
                            whole-document pass matched nothing and the engine fell back
                            to word-dropping (`shouldRelaxSearch`, lib/jobs/meilisearch.ts).
                            One honest sentence says so; the count line is suppressed for
                            this state (see `resultCountLine`) because the relaxed total
                            counts word-dropped matches — a number that doesn't describe
                            the query the user actually typed. */}
                        {!isOverlayAsk && hasFollows && (
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
                                   active (or a prior auto-explore attempt didn't pan
                                   out — see `resolveEmptySearchState`), so the chrome
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
                                <div className="py-8 text-left" data-testid="serp-ask">
                                    <p className="text-[14px] text-muted-foreground">which role? your filters stay on</p>
                                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                                        {searchSeeds.map((seed) => (
                                            <button
                                                key={seed}
                                                type="button"
                                                data-testid="serp-ask-seed"
                                                onClick={() => submitSearch(seed)}
                                                className="font-mono text-xs text-muted-foreground transition-colors duration-100 hover:text-foreground"
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
                            ) : exploreFailed ? (
                                <div role="alert" className="border-l-2 border-verdict-risk py-6 pl-4 text-left">
                                    <p className="font-mono text-[13px] text-foreground">Couldn&apos;t finish exploring — try again.</p>
                                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
                                        The request took too long or failed. Try again, or browse the live board instead.
                                    </p>
                                    <div className="mt-3 flex gap-4 font-mono text-xs">
                                        <button
                                            onClick={() => void handleExploreClick()}
                                            className="text-foreground underline underline-offset-2"
                                        >
                                            Retry
                                        </button>
                                        <button
                                            onClick={() => enterBrowseAndSync()}
                                            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                        >
                                            Browse all roles
                                        </button>
                                    </div>
                                </div>
                            ) : blockingError ? (
                                <div role="alert" className="border-l-2 border-verdict-risk py-6 pl-4 text-left">
                                    <p className="font-mono text-[13px] text-foreground">Job search is temporarily unavailable.</p>
                                    <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">{searchError}</p>
                                    <button
                                        onClick={() => setSearchRetry((n) => n + 1)}
                                        className="mt-3 font-mono text-xs text-foreground underline underline-offset-2"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : (loading || emptySearchState === "auto-explore") && hits.length === 0 ? (
                                // The `"auto-explore"` arm covers the gap between the
                                // resolver deciding to hand off (this render — the
                                // effect above hasn't fired yet) and the outcome
                                // landing: `mode`/`query` haven't changed yet, so
                                // there's nothing in `hits` to show, but this is not
                                // an empty-results moment either — reusing the
                                // ordinary loading splash instead of `EmptyResults`
                                // is what keeps this window from flashing "No roles
                                // match" over a fetch that never ran.
                                <JobsListSplash />
                            ) : hits.length === 0 ? (
                                <EmptyResults
                                    entries={activeEntries}
                                    onClearEntry={(entry) => applyFilterState(entry.clear(filterState))}
                                    query={query}
                                    onClearQuery={() => {
                                        setQuery("");
                                        applyUrlState(buildUrlState({ q: "" }), "replace");
                                    }}
                                    ghostRevealCount={ghostRevealCount}
                                    onRevealGhosts={() => onHideGhosts(false)}
                                />
                            ) : (
                                <div
                                    id="jobs-results-list"
                                    tabIndex={0}
                                    role="listbox"
                                    aria-label="Job results"
                                    onKeyDown={handleResultsKeyDown}
                                    className={cn(
                                        "min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar [scrollbar-gutter:stable] pr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2",
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
                                        {hits.flatMap((job, i) => {
                                            const row = (
                                                <JobCard
                                                    key={job.id}
                                                    job={job}
                                                    active={selectedId === job.id}
                                                    opened={openedIds.has(job.id)}
                                                    onClick={() => openJob(job.id)}
                                                    onFit={setFitJob}
                                                    onCompany={job.company_domain ? handleCompany : undefined}
                                                    onOpenPosting={handleOpenPosting}
                                                    now={nowMs}
                                                    elite={board === "elite"}
                                                />
                                            );
                                            if (i !== seamIndex) return [row];
                                            return [
                                                <p
                                                    key="seam"
                                                    data-testid="relevance-seam"
                                                    className="border-t border-border pt-4 pb-1 mb-1 font-mono text-[11px] text-muted-foreground"
                                                >
                                                    {seamSummary(seamIndex, total, hits.length)}
                                                </p>,
                                                row,
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
                            )}
                        </div>
                    </div>
                </div>
                </div>

                {isDesktop && selectedId && (
                    <aside className="hidden min-h-0 pt-4 lg:block">
                        <div className="sticky top-4 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-[14px] border border-border bg-card shadow-sm custom-scrollbar">
                            <div className="relative">
                                <button
                                    type="button"
                                    aria-label="Close job details"
                                    onClick={() => router.back()}
                                    className="absolute right-3 top-3 z-10 rounded-full border border-border bg-card/90 px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                                >
                                    ×
                                </button>
                                {detailJob ? (
                                    <>
                                        <JobDetail
                                            key={detailJob.id}
                                            job={detailJob}
                                            now={nowMs}
                                            applied={!!detailPursuit && hasReachedStage(detailPursuit, "applied")}
                                            applying={applyingId === detailJob.id}
                                            onTailor={() => handleTailor(detailJob)}
                                            onOpenPosting={() => handleOpenPosting(detailJob)}
                                            onMarkApplied={() => handleMarkApplied(detailJob)}
                                            onPrep={() => handlePrep(detailJob)}
                                            onGoAfter={() => handleGoAfter(detailJob)}
                                            pursuit={detailPursuit}
                                            goingAfter={goingAfterId === detailJob.id}
                                        />
                                        <div className="sticky bottom-0 z-10 flex gap-2 border-t border-border bg-card/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                                            {detailJob.apply_url && (
                                                <Button
                                                    variant="outline"
                                                    className="flex-1 gap-1.5"
                                                    onClick={() => handleOpenPosting(detailJob)}
                                                >
                                                    <ArrowSquareOut size={16} />
                                                    Apply ↗
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                className="flex-1 gap-1.5"
                                                onClick={() => handlePrep(detailJob)}
                                            >
                                                <Lightning size={14} weight="fill" />
                                                Prep for this
                                            </Button>
                                        </div>
                                    </>
                                ) : isDeadJobConfirmed ? (
                                    <div className="p-4">
                                        <DeadJobTombstone
                                            onSimilarRoles={handleTombstoneSimilarRoles}
                                            exploring={exploring}
                                            canShowSimilar={canShowSimilarRoles}
                                        />
                                    </div>
                                ) : showUnresolvedDetail ? (
                                    <div className="p-4">
                                        <DeadJobUnresolved
                                            onSimilarRoles={handleTombstoneSimilarRoles}
                                            exploring={exploring}
                                            canShowSimilar={canShowSimilarRoles}
                                            checking={isDeadJobChecking}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </aside>
                )}
                </main>
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
                    setAuthOpen(open);
                }}
                onAuthed={handleAuthed}
                showTrigger={false}
            />
            <TailorAnalysisSheet
                open={tailorOpen}
                onOpenChange={setTailorOpen}
                job={tailorJob}
                onAuthRequired={() => setAuthOpen(true)}
            />
            <FitDrawer
                open={!!fitJob}
                job={fitJob}
                onOpenChange={(open) => {
                    if (!open) setFitJob(null);
                }}
                onTailor={() => fitJob && handleTailor(fitJob)}
                onPrep={() => fitJob && handlePrep(fitJob)}
                onApply={() => fitJob && handleMarkApplied(fitJob)}
                onAuthRequired={openAuth}
            />
            <ResumeImportModal
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onImport={handleImport}
                confirmLabel="Rank my jobs"
            />
            <Sheet
                open={detailSheetOpen && !isDesktop}
                onOpenChange={(open) => {
                    // Opening is driven entirely by the URL-derived-selection
                    // effect above. A close (X button, overlay click, swipe,
                    // Esc) must go back through the URL — `job` was pushed
                    // when this job opened, so `router.back()` is the close.
                    if (!open) router.back();
                }}
            >
                <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto custom-scrollbar rounded-t-2xl p-0">
                    <SheetTitle className="sr-only">
                        {detailJob ? `${decodeText(detailJob.title)} at ${cleanCompany(detailJob.company)}` : "Job details"}
                    </SheetTitle>
                    {detailJob ? (
                        <>
                            <JobDetail
                                key={detailJob.id}
                                job={detailJob}
                                now={nowMs}
                                applied={!!detailPursuit && hasReachedStage(detailPursuit, "applied")}
                                applying={applyingId === detailJob.id}
                                onTailor={() => handleTailor(detailJob)}
                                onOpenPosting={() => handleOpenPosting(detailJob)}
                                onMarkApplied={() => handleMarkApplied(detailJob)}
                                onPrep={() => handlePrep(detailJob)}
                                onGoAfter={() => handleGoAfter(detailJob)}
                                pursuit={detailPursuit}
                                goingAfter={goingAfterId === detailJob.id}
                            />
                            {/* Task 10 — thumb-zone sticky bar. Reuses the SAME
                                onOpenPosting/onPrep handlers passed to JobDetail
                                just above (no new handlers) — JobDetail's own CTAs
                                live at the top and scroll out of view on a long
                                description; this keeps Apply/Prep reachable. */}
                            <div className="sticky bottom-0 z-10 flex gap-2 border-t border-border bg-card/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                                {detailJob.apply_url && (
                                    <Button
                                        variant="outline"
                                        className="flex-1 gap-1.5"
                                        onClick={() => handleOpenPosting(detailJob)}
                                    >
                                        <ArrowSquareOut size={16} />
                                        Apply ↗
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    className="flex-1 gap-1.5"
                                    onClick={() => handlePrep(detailJob)}
                                >
                                    <Lightning size={14} weight="fill" />
                                    Prep for this
                                </Button>
                            </div>
                        </>
                    ) : isDeadJobConfirmed ? (
                        <div className="p-4">
                            <DeadJobTombstone
                                onSimilarRoles={handleTombstoneSimilarRoles}
                                exploring={exploring}
                                canShowSimilar={canShowSimilarRoles}
                            />
                        </div>
                    ) : showUnresolvedDetail ? (
                        <div className="p-4">
                            <DeadJobUnresolved
                                onSimilarRoles={handleTombstoneSimilarRoles}
                                exploring={exploring}
                                canShowSimilar={canShowSimilarRoles}
                                checking={isDeadJobChecking}
                            />
                        </div>
                    ) : null}
                </SheetContent>
            </Sheet>
        </div>
    );
}

function JobsLoading() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                <p className="text-sm text-muted-foreground">Loading jobs…</p>
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
