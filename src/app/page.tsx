"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    MagnifyingGlass,
    Check,
    MapPin,
    CurrencyDollar,
    Briefcase,
    Target,
    ArrowSquareOut,
    WarningCircle,
    ShieldCheck,
    Lightning,
    Sparkle,
    Compass,
    CaretRight,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchAutocomplete } from "@/components/search/SearchAutocomplete";
import type { SearchSuggestion } from "@/lib/search-suggestions";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PageLayout } from "@/components/layout/PageLayout";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    searchJobsAction as searchJobsActionRaw,
    markJobAppliedAction,
    suggestAdjacentRolesAction,
    getJobsFreshnessAction,
    getPostedDateFilterSupportAction,
    suggestJobsAction,
} from "@/actions/jobs";
import { goAfterJobAction, createManualPursuit } from "@/actions/application";
import { usePursuits, invalidatePursuitsCache, syncGuestPursuitsToServer } from "@/lib/pursuits/use-pursuits";
import { addGuestPursuit, addManualGuestPursuit } from "@/lib/pursuits/guest-store";
import { hasReachedStage, type Pursuit } from "@/lib/pursuits/types";
import { withSettleGuard, EXPLORE_SUGGEST_TIMEOUT_MS } from "@/lib/jobs/settle-guard";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { formatRelativeAge, isStale } from "@/lib/jobs/freshness";
import { checkFreshness, daysOpenFrom } from "@/lib/jobs/badges";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import {
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
    recordRecentSearch,
    clearAllRecentSearches,
} from "@/lib/jobs/recent-searches";
import {
    FilterPanel,
    activeFilterEntries,
    toggleFacetValue,
    isNoiseFacetValue,
    facetValueLabel,
    PRISTINE_FILTER_STATE,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import { TailorAnalysisSheet, type TailorJob } from "@/components/jobs/TailorAnalysisSheet";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ResumeUpsellCard } from "@/components/jobs/ResumeUpsellCard";
import { PipelineCard } from "@/components/jobs/PipelineCard";
import { GhostRadarCard } from "@/components/jobs/GhostRadarCard";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { resolveCorpusCount, formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { JobsPaginationGeneration } from "@/lib/jobs/pagination-generation";
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    classifyExistenceCheck,
    DEAD_JOB_TOMBSTONE_TEXT,
    SEARCH_UNAVAILABLE_MESSAGE,
    shouldClearStaleJobUrl,
} from "@/lib/jobs/result-state";
import { coerceSortToSupported, resolveEffectiveSort } from "@/lib/jobs/sort";
import {
    type FacetKey,
    type GhostBadge,
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
import { buildMatchQuery, resolveExploreOutcome, topSkills, seniorityFromYears } from "@/lib/jobs/resume-match";
import {
    emptyPending,
    queuePending,
    clearPending,
    takeReplay,
    type PendingState,
} from "@/lib/jobs/pending-actions";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { toast } from "@/lib/toast";
import { classifySentinel } from "@/lib/llm/sentinels";
import { STATUS_PILL } from "@/lib/ui/status-tokens";
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
const searchJobsAction = (params: JobSearchParams): Promise<JobSearchResult> =>
    withSettleGuard(searchJobsActionRaw(params));

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

// Ghost-badge presentation. Colors route through the shared status-token
// chokepoint (lib/ui/status-tokens.ts): caution/likely_ghost → intv (amber),
// clear → offer (green). Token classes carry both light + dark values, so the
// per-state dark: overrides are no longer needed.
const GHOST_META: Record<GhostBadge, { label: string; cls: string; dot: string; explain: string } | null> = {
    likely_ghost: {
        label: "Possible ghost job",
        cls: STATUS_PILL.intv,
        dot: "bg-st-intv",
        explain:
            "Subspace's signals flag this posting as a possible ghost job — it may be stale, evergreen, or not actively hiring. Worth verifying before you invest time.",
    },
    caution: {
        label: "Worth verifying",
        cls: STATUS_PILL.intv,
        dot: "bg-st-intv/80",
        explain: "Some signals suggest this posting is worth a quick sanity-check before you apply.",
    },
    clear: {
        label: "No ghost signals",
        cls: STATUS_PILL.offer,
        dot: "bg-st-offer",
        explain: "No ghost-risk signals — this posting looks active.",
    },
    unscored: null,
};

/**
 * Neutral "hasn't been re-checked" stand-in for `GHOST_META.clear` (Phase
 * 1-a #5) — same shape, used instead of it whenever `checkFreshness` says
 * the check backing a "clear" verdict is stale. Keeps the positive, green
 * "no ghost signals" claim from surviving past the point the data behind it
 * stopped being current (the observed bug: a green badge on a 99-112-day-old
 * check sitting next to a dead apply link).
 */
const STALE_CLEAR_META: NonNullable<(typeof GHOST_META)["clear"]> = {
    label: "Not recently verified",
    cls: STATUS_PILL.intv,
    dot: "bg-st-intv/60",
    explain: "This posting hasn't been re-checked recently — we can't confirm it's still active. Worth a quick sanity-check before you apply.",
};

/**
 * Single chokepoint for which `GHOST_META` entry a job's row badge AND
 * detail-panel banner render from — so the two surfaces can never disagree
 * about whether a "clear" verdict is still current.
 */
function ghostMetaFor(ghostBadge: GhostBadge, stale: boolean) {
    return ghostBadge === "clear" && stale ? STALE_CLEAR_META : GHOST_META[ghostBadge];
}

function prettyEnum(s: string | null | undefined): string {
    if (!s || s === "unknown") return "";
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Decode URL-encoded source data (e.g. "Wisdom%20AI" → "Wisdom AI") safely. */
function decodeText(s: string | null | undefined): string {
    if (!s) return "";
    if (!s.includes("%")) return s;
    try {
        return decodeURIComponent(s);
    } catch {
        return s.replace(/%20/g, " ");
    }
}

/** Company names sometimes carry a leading req/location code (e.g. "USA102 Acme Inc"). Strip it. */
function cleanCompany(s: string | null | undefined): string {
    return decodeText(s).replace(/^[A-Z]{2,5}\d{2,6}\s+/, "").trim();
}

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

function locationText(j: PublicJob): string {
    if (j.location) return decodeText(j.location);
    const parts = [j.location_city, j.location_state, j.location_country].map(decodeText).filter(Boolean);
    if (parts.length) return parts.join(", ");
    if (j.work_type === "remote") return "Remote";
    return "Location not listed";
}

const SALARY_PERIOD: Record<string, string> = {
    yearly: "yr", year: "yr", annual: "yr", annually: "yr",
    hourly: "hr", hour: "hr", monthly: "mo", month: "mo", weekly: "wk", daily: "day",
};

function salaryText(j: PublicJob): string | null {
    if (j.salary_min == null && j.salary_max == null) return null;
    const cur = j.salary_currency ? `${j.salary_currency} ` : "";
    const period = j.salary_period ? SALARY_PERIOD[j.salary_period.toLowerCase()] ?? j.salary_period : "";
    const per = period ? `/${period}` : "";
    const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
    if (j.salary_min != null && j.salary_max != null) {
        return `${cur}${fmt(j.salary_min)}–${fmt(j.salary_max)}${per}`;
    }
    const one = (j.salary_min ?? j.salary_max) as number;
    return `${cur}${fmt(one)}${per}`;
}

/**
 * Format a sanitized posted timestamp as a relative age. Takes the epoch-ms
 * `posted_ts` (via `derivePostedTs`) rather than the raw `posted_at` string so
 * a future-dated posting (measured live: sentinels like 2030-01-31) never
 * renders as "today" — it falls back to `first_seen_at` instead.
 *
 * `now` is threaded in by the caller (JobCard, from JobsContent's single
 * per-render-pass `nowMs`) rather than sampled here with `Date.now()` — this
 * function runs from JobCard's render body, so an internal clock read would
 * be exactly the impure-render-call class `react-hooks/purity` flags at a
 * pure-derivation call site, just one level removed from the component itself.
 */
function postedAge(ts: number | null, now: number): string | null {
    if (ts == null) return null;
    const days = Math.floor((now - ts) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "1d";
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}

/** Compact "Jul 23"-style date for JobDetail's relisted disclosure sentence —
 *  the one place S2 names a calendar date rather than a relative age. */
function shortDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
/** Subtle full-row bg tint (spec: "on caution/risk only") — `live`/`faint`
 *  intentionally have no entry, so the row falls back to the plain hover bg. */
const VERDICT_ROW_BG_CLASS: Partial<Record<FlagTone, string>> = {
    warn: "bg-verdict-caution-bg",
    danger: "bg-verdict-risk-bg",
};
const VERDICT_GLYPH: Record<FlagTone, string> = {
    live: "■",
    warn: "▲",
    danger: "✕",
    faint: "—",
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
 * Shared active/inactive visual for every text affordance in the control
 * band — the legend line's four filter toggles AND the sort trio (spec:
 * both are "text, underlined when active"). Editorial pass replaces the
 * portal pass's two near-identical pill/segment components (`FilterPill`,
 * `SortSegment`) with this one — same toggle shape, no reason for two.
 */
function MonoToggle({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                "font-mono text-[12px] transition-colors duration-100",
                active
                    ? "text-foreground underline underline-offset-4"
                    : "text-muted-foreground hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
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

function JobCard({
    job,
    active,
    onClick,
    now,
    pursuit,
    goingAfter,
    onGoAfter,
    onOpenPosting,
}: {
    job: PublicJob;
    active: boolean;
    onClick: () => void;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    /** The existing pursuit for this job, if the user already went after it — drives the filled heart. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
    onGoAfter: () => void;
    onOpenPosting: () => void;
}) {
    const postedTs = derivePostedTs(job);
    const age = postedAge(postedTs, now);
    const sal = salaryText(job);
    const level = prettyEnum(job.experience_level);
    const workLoc = [prettyEnum(job.work_type), locationText(job)].filter(Boolean).join(" · ");
    const verdict = verdictFor(job, now);
    const accessibleName = `${decodeText(job.title)} at ${cleanCompany(job.company) || "Unknown company"}`;
    const saved = Boolean(pursuit);
    // Selection wins over the verdict tint (spec: tint is caution/risk-only
    // background texture, not a state indicator) — falls back to no tint at
    // all for live/unscored rows, where hover alone (below) carries the
    // interaction feedback.
    const rowBg = active ? "bg-muted" : VERDICT_ROW_BG_CLASS[verdict.tone];
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
                "flex cursor-pointer flex-col gap-1 border-b border-border py-3 text-left transition-colors duration-100 hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
                rowBg,
            )}
        >
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span data-testid="job-title" className="truncate text-[15px] font-semibold tracking-tight">
                        {decodeText(job.title)}
                    </span>
                    <span className="truncate text-[13px] font-medium text-text-2">
                        {cleanCompany(job.company) || "Unknown company"}
                    </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 font-mono text-[11.5px] text-muted-foreground">
                        {workLoc && <span>{workLoc}</span>}
                        <span>{sal ?? "salary not listed"}</span>
                        {level && <span>{level}</span>}
                        {age && <span className="text-faint">{age}</span>}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11.5px]">
                        <button
                            type="button"
                            aria-label={saved ? "Saved to your pipeline" : "Save this job"}
                            aria-pressed={saved}
                            disabled={goingAfter}
                            onClick={(e) => {
                                e.stopPropagation();
                                onGoAfter();
                            }}
                            className={cn(
                                "underline underline-offset-2 transition-colors duration-100 disabled:opacity-50",
                                saved ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {saved ? "saved" : "save"}
                        </button>
                        {job.apply_url && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenPosting();
                                }}
                                className="text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                            >
                                apply
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <div
                className={cn(
                    "shrink-0 text-left font-mono text-[12px] font-medium sm:w-[150px] sm:text-right",
                    VERDICT_TONE_CLASS[verdict.tone],
                )}
            >
                {VERDICT_GLYPH[verdict.tone]} {verdict.code}
            </div>
        </div>
    );
}

/* ------------------------- description renderer ------------------------- */

/** Render structured description blocks (heading / para / list). Descriptions
 *  arrive flattened from the Subspace feed; `formatDescription` reconstructs
 *  the structure. See lib/jobs/format-description.ts. */
function JobDescription({ blocks }: { blocks: DescBlock[] }) {
    return (
        <div className="text-[13.5px] leading-relaxed text-muted-foreground">
            {blocks.map((b, i) => {
                if (b.type === "heading") {
                    return (
                        <h4
                            key={i}
                            className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground first:mt-0"
                        >
                            {b.text}
                        </h4>
                    );
                }
                if (b.type === "list") {
                    return (
                        <ul key={i} className="mb-3 list-disc space-y-1 pl-5 last:mb-0">
                            {(b.items ?? []).map((it, j) => (
                                <li key={j}>{it}</li>
                            ))}
                        </ul>
                    );
                }
                return (
                    <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
                        {b.text}
                    </p>
                );
            })}
        </div>
    );
}

/* ----------------------------- detail panel ----------------------------- */

function JobDetail({
    job,
    now,
    onTailor,
    onOpenPosting,
    onMarkApplied,
    onPrep,
    onGoAfter,
    applied,
    applying,
    pursuit,
    goingAfter,
}: {
    job: PublicJob;
    /** Single per-render-pass "now" from JobsContent — see the `nowMs` comment there. */
    now: number;
    onTailor: () => void;
    onOpenPosting: () => void;
    onMarkApplied: () => void;
    onPrep: () => void;
    onGoAfter: () => void;
    applied: boolean;
    applying: boolean;
    /** The existing pursuit for this job, if the user already went after it. */
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
}) {
    const staleCheck = checkFreshness(job.updated_at, now) === "stale";
    const ghost = ghostMetaFor(job.ghost_badge, staleCheck);
    // S2 — HONESTY RULE: the row badge states a fact ("Fresh"/"Relisted");
    // this facts line is where the underlying dates it's based on live.
    const freshness = classifyPostingFreshness(job, now);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), now) : null;
    const firstSeenRelative =
        freshness.firstSeenMs != null ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), now) : null;
    const [descExpanded, setDescExpanded] = useState(false);
    const blocks = useMemo(() => formatDescription(job.description), [job.description]);
    // Long descriptions are clamped behind a "Show more" toggle so the sticky
    // detail panel doesn't run thousands of pixels tall.
    const collapsible = (job.description?.length ?? 0) > 700;
    const facts: { icon: React.ReactNode; label: string }[] = [];
    if (prettyEnum(job.work_type)) facts.push({ icon: <MapPin size={13} />, label: prettyEnum(job.work_type) });
    if (prettyEnum(job.employment_type))
        facts.push({ icon: <Briefcase size={13} />, label: prettyEnum(job.employment_type) });
    if (prettyEnum(job.experience_level))
        facts.push({ icon: <Target size={13} />, label: prettyEnum(job.experience_level) });
    const sal = salaryText(job);
    if (sal) facts.push({ icon: <CurrencyDollar size={13} />, label: sal });

    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border p-6">
                <div className="flex items-start gap-4">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-bold leading-tight tracking-tight">{decodeText(job.title)}</h2>
                        <div className="mt-1 text-sm text-muted-foreground">
                            {cleanCompany(job.company) || "Unknown company"} · {locationText(job)}
                        </div>
                        {(postedRelative || firstSeenRelative) && (
                            <div className="mt-1 text-sm text-muted-foreground">
                                {[
                                    postedRelative ? `Posted ${postedRelative}` : null,
                                    firstSeenRelative ? `First seen by us ${firstSeenRelative}` : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                {freshness.kind === "relisted" && freshness.postedMs != null && firstSeenRelative && (
                                    <div className="mt-0.5">
                                        Listed as new on {shortDate(freshness.postedMs)}, but this role first
                                        appeared {firstSeenRelative} — often a repost.
                                    </div>
                                )}
                            </div>
                        )}
                        {facts.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {facts.map((f, i) => (
                                    <span
                                        key={i}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                                    >
                                        {f.icon}
                                        {f.label}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                    {/* The one verb (spec §2/§3): "Go after this job" is the primary
                        action. Once a pursuit exists, it becomes a quiet confirmation
                        link instead — pressing it again would be meaningless. */}
                    {pursuit ? (
                        <Link
                            href={`/yours/${pursuit.id}`}
                            className="text-sm font-medium text-brand hover:underline"
                        >
                            In Yours ✓ — view
                        </Link>
                    ) : (
                        <Button onClick={onGoAfter} disabled={goingAfter} className="gap-2">
                            <Check size={16} weight="bold" />
                            {goingAfter ? "Saving…" : "Go after this job"}
                        </Button>
                    )}
                    <Button variant="outline" onClick={onTailor} className="gap-2">
                        <Sparkle size={16} weight="fill" />
                        Apply with tailored resume
                    </Button>
                    {job.apply_url && (
                        <Button variant="outline" onClick={onOpenPosting} className="gap-2">
                            <ArrowSquareOut size={16} />
                            Open posting
                        </Button>
                    )}
                    <Button variant="outline" onClick={onMarkApplied} disabled={applied || applying} className="gap-2">
                        <Check size={16} />
                        {applied ? "Tracked" : applying ? "Saving…" : "Mark as applied"}
                    </Button>
                </div>
            </div>

            <div className="p-6">
                {ghost && (
                    <div className={cn("mb-5 flex items-start gap-2.5 rounded-xl border p-3.5", ghost.cls)}>
                        {job.ghost_badge === "clear" && !staleCheck ? (
                            <ShieldCheck size={18} className="mt-0.5 shrink-0" weight="fill" />
                        ) : (
                            <WarningCircle size={18} className="mt-0.5 shrink-0" weight="fill" />
                        )}
                        <div>
                            <div className="text-[13px] font-semibold">{ghost.label}</div>
                            <div className="mt-0.5 text-xs leading-relaxed opacity-90">{ghost.explain}</div>
                        </div>
                    </div>
                )}

                <div className="mb-5">
                    <div className="mb-2 text-[13px] font-semibold">About this role</div>
                    {blocks.length > 0 ? (
                        <>
                            <div className={cn("relative", collapsible && !descExpanded && "max-h-[20rem] overflow-hidden")}>
                                <JobDescription blocks={blocks} />
                                {collapsible && !descExpanded && (
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                                )}
                            </div>
                            {collapsible && (
                                <button
                                    onClick={() => setDescExpanded((v) => !v)}
                                    className="mt-2 text-xs font-medium text-brand hover:underline"
                                >
                                    {descExpanded ? "Show less" : "Show full description"}
                                </button>
                            )}
                        </>
                    ) : (
                        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-3 text-[13px] text-muted-foreground">
                            No description was captured for this role.{" "}
                            {job.apply_url ? (
                                <>
                                    Use <span className="font-medium text-foreground">Open posting</span> to read the
                                    full details on the employer&apos;s site.
                                </>
                            ) : (
                                "Try the original posting for full details."
                            )}
                        </div>
                    )}
                </div>

                {job.tags && job.tags.length > 0 && (
                    <>
                        <div className="mb-2.5 text-[13px] font-semibold">Keywords from the posting</div>
                        <div className="flex flex-wrap gap-2">
                            {job.tags.slice(0, 16).map((tag) => (
                                <span
                                    key={tag}
                                    className="rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                                >
                                    {decodeText(tag)}
                                </span>
                            ))}
                        </div>
                    </>
                )}

                <button
                    onClick={onPrep}
                    className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                >
                    <Lightning size={14} weight="fill" />
                    Prep for interview at {cleanCompany(job.company) || "this company"}
                    <CaretRight size={13} />
                </button>
            </div>
        </div>
    );
}

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

const MODE_META: Record<Mode, { label: string }> = {
    explore: { label: "Exploring adjacent roles" },
    browse: { label: "Browsing all live roles" },
};

/** Slim bar above the results that names the active mode + offers "Start over". */
function ModeBar({ mode, onStartOver }: { mode: Mode; onStartOver: () => void }) {
    const meta = MODE_META[mode];
    if (!meta) return null;
    return (
        <div className="mb-3 flex items-center justify-between gap-2 font-mono text-xs">
            <span className="text-foreground">{meta.label}</span>
            <button
                onClick={onStartOver}
                className="text-muted-foreground transition-colors duration-100 hover:text-foreground"
            >
                ← Start over
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
 * The search seed line (spec §3 "outside interviews"): ALWAYS present below
 * the results pane — for the visitor who's already mid-interview-loop
 * somewhere, not job hunting on this page at all. Collapsed to a single
 * quiet line by default (it must not compete with the results above it);
 * one click expands the two-field form in place. Submitting creates an
 * "interviewing"-stage pursuit with no job_id (typed company/role only, no
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
    // Task 10: mobile filter sheet. `pendingFilterState` is a scratch copy of
    // FilterState the sheet mutates locally — it never touches the URL/live
    // state until "Show N roles" is tapped (resolution #3). Seeded from the
    // URL like every other field above; `openFilterSheet` (below, once
    // `filterState` exists) re-snapshots it from the live state on each open.
    const [filterSheetOpen, setFilterSheetOpen] = useState(false);
    const [pendingFilterState, setPendingFilterState] = useState<FilterState>({
        facets: initialUrlState.facets,
        salaryMin: initialUrlState.salaryMin,
        visaOnly: initialUrlState.visaOnly,
        postedBucket: initialUrlState.postedBucket,
        hideGhosts: initialUrlState.hideGhosts,
    });
    // Live, debounced "Show N roles" count for the sheet's apply button —
    // reflects `pendingFilterState`, not the applied filters.
    const [sheetCount, setSheetCount] = useState<number | null>(null);
    const [detailSheetOpen, setDetailSheetOpen] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchRetry, setSearchRetry] = useState(0);
    // S2 — recent-searches chips on the empty-query landing state.
    const recentSearches = useSyncExternalStore(
        subscribeRecentSearches,
        getRecentSearchesSnapshot,
        getRecentSearchesServerSnapshot,
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
        hideGhosts,
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
    // roles…") and Task 8's upsell copy. Captured opportunistically from the
    // FIRST all-defaults search response (never a dedicated count request) —
    // `corpusTotalCapturedRef` makes that one-shot regardless of effect
    // re-runs. A deep link that already carries filters on first load never
    // fills this in; the placeholder just stays generic.
    //
    // Whole-branch review fix — this used to store the raw `r.total`, which
    // is `body.totalHits ?? body.estimatedTotalHits` straight off
    // Meilisearch (see searchMeili, lib/jobs/meilisearch.ts), both capped by
    // `JOBS_INDEX_SETTINGS.pagination.maxTotalHits` (100,000). Verified live:
    // the real corpus is ~1.77M docs, so that cap was being printed as an
    // exact fact — "Search 100,000 live-checked roles…" — right next to the
    // UNCAPPED "N hidden ghosts" figure elsewhere on this page, two numbers
    // on different denominators presented as if they were comparable. Now
    // stores the resolved `CorpusCount` (lib/jobs/corpus-count.ts) instead,
    // so every consumer renders through `formatCorpusCount` and a capped
    // value can only ever show as a floor ("100,000+"), never a bare number.
    const [corpusCount, setCorpusCount] = useState<CorpusCount | null>(null);
    const corpusTotalCapturedRef = useRef(false);

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

    const hasQuery = query.trim().length > 0;

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
    const [exploreTitles, setExploreTitles] = useState<string[]>([]);

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
                sort: sortOverride ? modeToUrlSort(sortOverride) : null,
                jobId: null,
            }) + (postedDateSupported ? "" : "&nodatesort"),
        // `postedDateSupported` participates because it changes the sort the
        // backend is asked for: when the probe resolves, the date sort becomes
        // real and the results must be re-fetched in the new order.
        [query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, sortOverride, postedDateSupported],
    );

    // Debounced search on query / facet / salary / visa changes.
    useEffect(() => {
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
                    ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported),
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
                // `searchKey === ""` is exactly the all-defaults JobsUrlState
                // (ignoring jobId) — the same subset it's built from. One-shot
                // via the ref so this never fires again once captured.
                if (!corpusTotalCapturedRef.current && searchKey === "") {
                    corpusTotalCapturedRef.current = true;
                    setCorpusCount(resolveCorpusCount(r, MAX_REACHABLE));
                }
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
                // `shouldClearDeadLinkUrl` predicate's own case (still kept,
                // independently unit-tested, for its own documented
                // history) — see `shouldClearStaleJobUrl`'s doc comment for
                // the full reasoning.
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
    }, [searchKey, searchRetry]);

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

    // Deliberate job open: pushes `?job=<id>` so back-button + refresh both
    // work (picked back up by the URL-derived-selection effect below).
    const openJob = (id: string) => {
        applyUrlState(buildUrlState({ jobId: id }), "push");
    };

    const hits = useMemo(() => result?.hits ?? [], [result?.hits]);

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
        // Portal redesign: the sheet is now the ONLY detail surface at every
        // breakpoint (the old lg+ three-pane layout's inline detail column
        // is gone — the new design has no room reserved for one), so this
        // used to gate on `matchMedia("(max-width: 1023px)")`; that gate is
        // dropped, not just hidden, since a desktop viewport opening the
        // sheet is now the intended behavior, not a mobile-only fallback.
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
    // this; `SimilarRolesCta` labels the button accordingly.
    const canShowSimilarRoles = resumeIsUsable(resume ?? undefined);

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
                ...buildJobSearchPayload(filterState, query, backendSort, postedDateSupported),
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
    }, [result, query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, sortOverride, postedDateSupported]);

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
    const toggleFacet = (key: FacetKey, value: string) => {
        const nextFacets = toggleFacetValue(facets, key, value);
        setFacets(nextFacets);
        applyUrlState(buildUrlState({ facets: nextFacets }), "replace");
    };

    const applySalaryMin = (v: number) => {
        setSalaryMin(v);
        applyUrlState(buildUrlState({ salaryMin: v }), "replace");
    };
    const applyPostedBucket = (v: PostedBucket | undefined) => {
        setPostedBucket(v);
        applyUrlState(buildUrlState({ postedBucket: v }), "replace");
    };
    // Task 7: setLocal-then-applyUrlState, mirroring every other mutator here
    // (see the ordering rule in this file's header comment / composer
    // precedent in url-state.ts).
    const onHideGhosts = (v: boolean) => {
        setHideGhosts(v);
        applyUrlState(buildUrlState({ hideGhosts: v }), "replace");
    };

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

    const clearAll = () => {
        applyFilterState(PRISTINE_FILTER_STATE);
    };

    // `activeFilterEntries` (FilterPanel.tsx) is the single source for "what's
    // active" — the "All filters (N)" pill's count, the empty state's
    // per-filter clear chips, and the sheet's own count all read from it so
    // they can never disagree.
    const activeEntries = activeFilterEntries(filterState);
    const activeCount = activeEntries.length;

    // Task 11 — empty state's ghost-reveal line. Pure gate (lib/jobs/
    // result-state.ts, unit-tested there) so it can't drift from the same
    // "hideGhosts && ghostHiddenCount > 0" rule the controller specified.
    const ghostRevealCount = resolveGhostReveal(hideGhosts, ghostHiddenCount);

    // Task 10 — filter sheet (portal redesign: the ONLY filter surface at
    // every breakpoint now — see the "All filters" pill above). Every
    // pending mutator below mirrors one of the LIVE mutators above
    // (toggleFacet/applySalaryMin/applyPostedBucket/onHideGhosts) field-for-
    // field, but writes into
    // `pendingFilterState` instead of local+URL state — the sheet's own
    // FilterPanel instance passes these as its callback props, so toggling
    // inside the sheet can only ever change pending state + the live count
    // (resolution #3), never the applied filters.
    const pendingToggleFacet = (key: FacetKey, value: string) =>
        setPendingFilterState((prev) => ({ ...prev, facets: toggleFacetValue(prev.facets, key, value) }));
    const pendingSalaryMin = (v: number) => setPendingFilterState((prev) => ({ ...prev, salaryMin: v }));
    const pendingVisaOnly = (v: boolean) => setPendingFilterState((prev) => ({ ...prev, visaOnly: v }));
    const pendingPostedBucket = (v: PostedBucket | undefined) =>
        setPendingFilterState((prev) => ({ ...prev, postedBucket: v }));
    const pendingHideGhosts = (v: boolean) => setPendingFilterState((prev) => ({ ...prev, hideGhosts: v }));
    const pendingClearAll = () => setPendingFilterState(PRISTINE_FILTER_STATE);
    const pendingActiveCount = activeFilterEntries(pendingFilterState).length;

    // Snapshot the live filters into the sheet's scratch state on open —
    // seeding `sheetCount` from the already-known live total too, so the
    // apply button reads correctly on the very first paint instead of a
    // blank/placeholder state until the debounced re-count below resolves.
    const openFilterSheet = () => {
        setPendingFilterState(filterState);
        setSheetCount(result?.total ?? null);
        setFilterSheetOpen(true);
    };
    // Tapping "Show N roles" is the ONLY thing that commits pending state —
    // reuses `applyFilterState` verbatim (the same funnel clearAll/chip-
    // remove already share), so there is exactly one place that turns a
    // FilterState into local state + a URL replace.
    const applyPendingFilters = () => {
        applyFilterState(pendingFilterState);
        setFilterSheetOpen(false);
    };

    // Sheet live count (resolution #2): 250ms-debounced re-count as pending
    // filters change while the sheet is open. Reuses `FitIntentGuard`
    // verbatim rather than adding a bespoke guard class — it's already the
    // generic "one monotonic counter, no ticket bookkeeping" shape this
    // needs (fit-intent.ts), just guarding a different async race (a stale
    // count response landing after a newer pending edit) than its
    // sort-menu origin. A fresh instance, independent of `fitIntentRef`.
    const sheetCountGuardRef = useRef<FitIntentGuard | null>(null);
    if (!sheetCountGuardRef.current) sheetCountGuardRef.current = new FitIntentGuard();
    useEffect(() => {
        // `begin()` runs on EVERY effect re-run, including the one triggered
        // by the sheet CLOSING — not just while open. Review fix (2026-07-19):
        // with `begin()` only called past the early return below, closing the
        // sheet mid-request never advanced the guard, so a still-in-flight
        // count from the just-discarded session stayed "current" and could
        // land after a fresh re-open had already reseeded `sheetCount` —
        // clobbering the honest just-opened value with a stale one.
        const token = sheetCountGuardRef.current!.begin();
        if (!filterSheetOpen) return;
        const t = setTimeout(async () => {
            try {
                const r = await searchJobsAction({
                    ...buildJobSearchPayload(pendingFilterState, query, backendSort, postedDateSupported),
                    limit: 1,
                    offset: 0,
                });
                if (!sheetCountGuardRef.current!.isCurrent(token)) return;
                if (!isUnavailableJobsResult(r)) setSheetCount(r.total);
            } catch {
                /* best-effort — the apply button keeps its last-known count */
            }
        }, 250);
        return () => clearTimeout(t);
        // `backendSort` rather than the raw `sortOverride`: it also carries the
        // date-sort coercion, so the pending count re-runs if the support probe
        // resolves while the sheet is open. `postedDateSupported` is ALSO
        // listed directly (Phase 1-a #4): `buildJobSearchPayload` reads it to
        // gate `postedBucket` independent of whatever `backendSort` is.
    }, [filterSheetOpen, pendingFilterState, query, backendSort, postedDateSupported]);

    // Task 8 résumé upsell card gate: not dismissed AND no usable résumé in
    // LOCAL state (no new mount fetch — see the state block above). A user
    // with a server-side résumé they haven't loaded this session still sees
    // the card until dismissed; accepted trade-off, not a bug.
    const showUpsell = !upsellDismissed && !resumeIsUsable(resume ?? undefined);

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
        router.push(`/?${p.toString()}`);
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

    // Guest→auth pursuit merge (spec §3/§7) — at most once per load.
    useEffect(() => {
        if (user && !guestPursuitSyncRef.current) {
            guestPursuitSyncRef.current = true;
            void syncGuestPursuitsToServer();
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
        setExploreTitles([]);
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
    const activateExplore = (q: string, titles: string[]) => {
        setExploreTitles(titles);
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
                    activateExplore(outcome.q, []);
                    toast.info(
                        outcome.credits
                            ? "Out of AI credits — showing skill-based matches instead."
                            : "Showing roles related to your skills.",
                    );
                    return;
                case "success":
                    activateExplore(outcome.q, outcome.titles);
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
        setExploreTitles([]);
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

    const startOver = () => {
        // Supersede a stale in-flight Explore — see `exploreIntentRef`'s doc
        // comment above.
        exploreIntentRef.current!.begin();
        setExploreTitles([]);
        setFacets({});
        setSalaryMin(0);
        setVisaOnly(false);
        // References the shared default (PRISTINE_FILTER_STATE), not a
        // literal — "30d" is now the fresh-load default, and this is the ONE
        // reset path that doesn't already go through `applyFilterState`
        // (clearAll/pendingClearAll do), so it's the one place that could
        // silently drift from it.
        setPostedBucket(PRISTINE_FILTER_STATE.postedBucket);
        setSortOverride(null);
        setHideGhosts(true);
        setQuery("");
        setSearchError(null);
        setDetailSheetOpen(false);
        setMode("browse");
        // Review fix — these two used to rely entirely on the URL-reconcile
        // effect (keyed on `searchParams`) re-deriving them a tick later
        // from `DEFAULT_URL_STATE` below (which carries neither `sort=fit`
        // nor a `job` id): correct in the end, but explicit here matches
        // every other field in this function and removes the one-frame gap
        // where local state and the fresh URL disagree.
        setFitActive(false);
        setSelectedId(null);
        applyUrlState(DEFAULT_URL_STATE, "replace");
    };

    const notConnected = result != null && !result.configured && result.backend === "unconfigured";
    const blockingError = searchError != null && hits.length === 0;
    const backgroundError = searchError != null && hits.length > 0;

    // Hero search row's location/mode selects (spec: "no city-level filter
    // exists — do NOT fake one") — single-value pickers over the real
    // `location_country`/`work_type` facets, sharing the exact toggle
    // mechanics `toggleFacet` already uses, just replacing (not adding to)
    // whatever was selected for that key, since a plain <select> can only
    // hold one value at a time.
    const setSingleFacet = (key: FacetKey, value: string | null) => {
        const nextFacets = { ...facets, [key]: value ? [value] : undefined };
        setFacets(nextFacets);
        applyUrlState(buildUrlState({ facets: nextFacets }), "replace");
    };
    const facetOptions = (key: FacetKey): { value: string; label: string; count: number }[] =>
        Object.entries(result?.facetDistribution?.[key] ?? {})
            .filter(([v]) => !isNoiseFacetValue(key, v))
            .sort((a, b) => b[1] - a[1])
            .map(([value, count]) => ({ value, label: facetValueLabel(key, value), count }));
    const countryOptions = facetOptions("location_country");
    const workTypeOptions = facetOptions("work_type");

    // Result-count line (spec: "N roles · M flagged this search", mono, above
    // the column heads). `ghostHiddenCount`/`totalCount` are the SAME sources
    // the rail's "N hidden" toggle copy and corpus-count already read — no
    // second fetch, and the line can never disagree with those.
    const resultCountLine =
        result?.configured && !loading
            ? `${formatCorpusCount(totalCount)} ${totalCount.value === 1 ? "role" : "roles"}${
                  ghostHiddenCount != null && ghostHiddenCount > 0
                      ? ` · ${ghostHiddenCount.toLocaleString()} flagged this search`
                      : ""
              }`
            : null;

    // Trust-toolbar pills (spec: "each mapped to existing JobsUrlState
    // only"). Each toggle mirrors the shape `toggleFacet`/`applyPostedBucket`/
    // `applySalaryMin`/`onHideGhosts` already use elsewhere on this page —
    // no parallel filter-mutation path, just a second, quicker entry point
    // onto the SAME state those mutators own.
    const seniorActive = (facets.experience_level ?? []).includes("senior");
    const salary100kActive = salaryMin >= 100_000;
    const newThisWeekActive = postedBucket === "7d";

    // Sort segmented control (results header). `chooseSort` mirrors the old
    // Select's onValueChange for a real backend `JobSortMode`; "best match"
    // collapses TWO of the old dropdown's options into one segment (spec:
    // "plus best match ← relevance/fit so no existing mode is lost") — with
    // a query, that's plain relevance; with none, "best match" IS "ranked by
    // your résumé" (the old separate "Rank by fit" option), since relevance
    // has nothing to rank without a query.
    const chooseSort = (nextMode: JobSortMode) => {
        fitIntentRef.current!.begin();
        setFitActive(false);
        setSortOverride(nextMode);
        applyUrlState(buildUrlState({ sort: modeToUrlSort(nextMode) }), "replace");
    };
    const chooseBestMatch = () => {
        if (hasQuery) chooseSort("relevance");
        else void handleRankByFit();
    };
    const bestMatchActive = fitActive || (!fitActive && effectiveSort === "relevance");

    return (
        <PageLayout
            fullWidth
            // The viewport pin belongs on the SHELL, which starts directly below
            // the 3.5rem masthead. It used to sit on `main` instead — but `main`
            // renders BELOW the control band, so `calc(100dvh-3.5rem)` there
            // counted the masthead only and ignored the band, leaving the
            // document exactly one band taller than the viewport (measured:
            // 1051 vs 900 at 1440x900, 919 vs 768 at 1024). `main` now flexes
            // into whatever the band leaves, so the band can wrap or grow
            // without anyone re-deriving a height.
            shellClassName="lg:h-[calc(100dvh-3.5rem)] lg:min-h-0 lg:overflow-hidden"
            className="w-full max-w-[1700px] px-4 pb-6 sm:px-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden lg:px-14"
            header={
                <div className="border-b border-foreground bg-background">
                    <div className="mx-auto max-w-[1700px] px-4 pb-4 pt-5 sm:px-6 lg:px-14 lg:pt-6">
                        {/* Document-line search: a bottom rule, not a box — the working
                            surface starts immediately, no marketing headline above it. */}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
                            <SearchAutocomplete
                                // Explore mode's `query` state carries the résumé-derived
                                // search string (AI-suggested titles, capped — see
                                // `capExploreTerms`), which used to render raw in this box:
                                // an unreadable wall of query soup. The dismissible
                                // "Exploring roles adjacent to your résumé" legend item below
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
                                        setExploreTitles([]);
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
                                placeholder={
                                    corpusCount != null
                                        ? `Search ${formatCorpusCount(corpusCount)} live-checked roles…`
                                        : "Search live-checked roles…"
                                }
                                className="h-9 rounded-none border-0 border-b border-border-strong bg-transparent px-0 text-[16px] shadow-none focus-visible:border-foreground focus-visible:ring-0 focus-visible:shadow-none"
                                containerClassName="min-w-0 flex-1"
                            />
                            <div className="flex shrink-0 items-center gap-4 pb-0.5">
                                {/* Re-homed from the old entry-gate's "Explore adjacent roles"
                                    choice. Credit/auth gating (enterExplore/runExplore) is
                                    reused verbatim. */}
                                <button
                                    type="button"
                                    disabled={exploring}
                                    onClick={() => void handleExploreClick()}
                                    className="font-mono text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground disabled:opacity-50"
                                >
                                    {exploring ? "exploring…" : "explore"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => submitSearch(query)}
                                    className="h-8 shrink-0 bg-foreground px-5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-background transition-opacity duration-100 hover:opacity-85"
                                >
                                    Search
                                </button>
                            </div>
                        </div>

                        {/* Location + work mode: inline text-selects (location_country /
                            work_type facets — no city-level filter exists). */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs">
                            <Select
                                value={facets.location_country?.[0] ?? "__any__"}
                                onValueChange={(v) => setSingleFacet("location_country", v === "__any__" ? null : v)}
                            >
                                <SelectTrigger
                                    className="h-auto w-fit gap-1 rounded-none border-0 bg-transparent p-0 font-mono text-xs text-muted-foreground shadow-none underline underline-offset-4 hover:text-foreground data-[state=open]:text-foreground"
                                    aria-label="Location"
                                >
                                    <SelectValue placeholder="any location" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__any__">Any location</SelectItem>
                                    {countryOptions.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={facets.work_type?.[0] ?? "__any__"}
                                onValueChange={(v) => setSingleFacet("work_type", v === "__any__" ? null : v)}
                            >
                                <SelectTrigger
                                    className="h-auto w-fit gap-1 rounded-none border-0 bg-transparent p-0 font-mono text-xs text-muted-foreground shadow-none underline underline-offset-4 hover:text-foreground data-[state=open]:text-foreground"
                                    aria-label="Work mode"
                                >
                                    <SelectValue placeholder="any work mode" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__any__">Any work mode</SelectItem>
                                    {workTypeOptions.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* S2 — recent searches: quiet text list shown only on the
                            empty-query landing state (browse mode, nothing typed yet,
                            store non-empty). */}
                        {mode === "browse" && !query.trim() && recentSearches.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
                                <span>recent:</span>
                                {recentSearches.map((q, i) => (
                                    <span key={q} className="flex items-center gap-x-2">
                                        {i > 0 && <span>·</span>}
                                        <button
                                            type="button"
                                            data-testid="recent-search-chip"
                                            onClick={() => submitSearch(q)}
                                            className="underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                                        >
                                            {q}
                                        </button>
                                    </span>
                                ))}
                                <button
                                    type="button"
                                    aria-label="Clear recent searches"
                                    onClick={() => clearAllRecentSearches()}
                                    className="transition-colors duration-100 hover:text-foreground"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* Explore: AI-suggested adjacent titles — click one to narrow to it. */}
                        {mode === "explore" && exploreTitles.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
                                <span>exploring:</span>
                                {exploreTitles.map((t, i) => {
                                    const active = query.trim() === t;
                                    return (
                                        <span key={t} className="flex items-center gap-x-2">
                                            {i > 0 && <span>·</span>}
                                            <button
                                                onClick={() => setQuery(active ? exploreTitles.join(" ") : t)}
                                                className={cn(
                                                    "underline underline-offset-2 transition-colors duration-100",
                                                    active ? "text-foreground" : "hover:text-foreground",
                                                )}
                                            >
                                                {t}
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}

                        {/* Legend line (spec): active filters as underlined text with
                            counts, same URL-state wiring as before — text affordances
                            1:1 with the portal pass's pill row. */}
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
                            <MonoToggle active={hideGhosts} onClick={() => onHideGhosts(!hideGhosts)}>
                                ghost-risk hidden{hideGhosts && ghostHiddenCount ? ` (−${ghostHiddenCount.toLocaleString()})` : ""}
                            </MonoToggle>
                            <MonoToggle
                                active={newThisWeekActive}
                                onClick={() =>
                                    applyPostedBucket(newThisWeekActive ? PRISTINE_FILTER_STATE.postedBucket : "7d")
                                }
                            >
                                new this week
                            </MonoToggle>
                            <MonoToggle
                                active={salary100kActive}
                                onClick={() => applySalaryMin(salary100kActive ? 0 : 100_000)}
                            >
                                salary $100k+
                            </MonoToggle>
                            <MonoToggle active={seniorActive} onClick={() => toggleFacet("experience_level", "senior")}>
                                senior
                            </MonoToggle>
                            <button
                                type="button"
                                onClick={openFilterSheet}
                                className="text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                            >
                                filters +{activeCount > 0 ? ` (${activeCount})` : ""}
                            </button>
                            {fitActive && (
                                <button
                                    onClick={clearFit}
                                    className="text-foreground underline underline-offset-2"
                                >
                                    ranked by your résumé ✕
                                </button>
                            )}
                            {/* Mirrors the "ranked by your résumé" item above — communicates
                                explore mode without rendering its derived query raw in the
                                search box (see the box's `value` comment above). */}
                            {mode === "explore" && (
                                <button
                                    onClick={() => enterBrowseAndSync()}
                                    className="text-foreground underline underline-offset-2"
                                >
                                    Exploring roles adjacent to your résumé ✕
                                </button>
                            )}
                            <span className="flex-1" />
                            <span className="text-border-strong">|</span>
                            <button
                                type="button"
                                onClick={clearAll}
                                className="text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
                            >
                                reset
                            </button>
                        </div>
                    </div>
                </div>
            }
        >
            <>
                <a
                    href="#jobs-results-list"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:border focus:border-foreground focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
                >
                    Skip to results
                </a>
                <PrepMovedNote />
                <div className="shrink-0 pt-5">
                    <ModeBar mode={mode} onStartOver={startOver} />
                </div>
                <div className="grid min-h-0 flex-1 gap-8 lg:grid-cols-[1fr_300px]">
                    <div className="flex min-h-0 flex-col">
                        {/* Result count (spec: "N roles · M flagged this search") + sort
                            trio — both mono, both above the column-head rule. */}
                        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs text-muted-foreground">
                            <span>{resultCountLine}</span>
                            {result?.configured && (
                                <div className="flex items-center gap-3">
                                    {postedDateSupported && (
                                        <MonoToggle
                                            active={!fitActive && effectiveSort === "newest"}
                                            onClick={() => chooseSort("newest")}
                                        >
                                            freshest
                                        </MonoToggle>
                                    )}
                                    <MonoToggle
                                        active={!fitActive && effectiveSort === "salary_desc"}
                                        onClick={() => chooseSort("salary_desc")}
                                    >
                                        top pay
                                    </MonoToggle>
                                    <MonoToggle active={bestMatchActive} onClick={chooseBestMatch}>
                                        best match
                                    </MonoToggle>
                                </div>
                            )}
                        </div>
                        <div className="mb-2 flex min-h-[1.1rem] flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                            {/* Single slot for the search's live/stamped state — "updating…"
                                while a fetch is in flight, else the corpus freshness stamp.
                                One span, never both, so this line can't ever show two
                                simultaneous status fragments. */}
                            {loading && hits.length > 0 ? (
                                <span>Updating…</span>
                            ) : (
                                lastUpdated !== undefined && (
                                    <span
                                        className="tabular-nums data-[stale=true]:text-verdict-caution"
                                        data-stale={isStale(lastUpdated, nowMs)}
                                        title={lastUpdated ?? "freshness unknown"}
                                    >
                                        {lastUpdated ? `updated ${formatRelativeAge(lastUpdated, nowMs)}` : "freshness unknown"}
                                    </span>
                                )
                            )}
                            {!loading && result?.widened && (
                                <span data-testid="widened-note">Few exact title matches — also showing broader matches.</span>
                            )}
                        </div>

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

                        {hits.length > 0 && (
                            <div className="flex items-center justify-between border-b border-foreground pb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                <span>role · company · terms · posted</span>
                                <span>verdict</span>
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
                            {notConnected ? (
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
                            ) : loading && hits.length === 0 ? (
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
                                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2"
                                >
                                    <div>
                                        {hits.flatMap((job, idx) => {
                                            const row = (
                                                <JobCard
                                                    key={job.id}
                                                    job={job}
                                                    active={selected?.id === job.id}
                                                    onClick={() => openJob(job.id)}
                                                    now={nowMs}
                                                    pursuit={pursuitsByJobId.get(job.id)}
                                                    goingAfter={goingAfterId === job.id}
                                                    onGoAfter={() => handleGoAfter(job)}
                                                    onOpenPosting={() => handleOpenPosting(job)}
                                                />
                                            );
                                            // After the FIRST row only (idx 0) — `hits` is the
                                            // full accumulated list across infinite-scroll pages,
                                            // so this never re-fires for later pages and never
                                            // renders when `hits` is empty (that branch is gated
                                            // above by the `hits.length === 0` check).
                                            if (idx === 0 && showUpsell) {
                                                return [
                                                    row,
                                                    <ResumeUpsellCard
                                                        key="resume-upsell"
                                                        count={corpusCount}
                                                        // Explicit no-arg call, not a bare
                                                        // `handleUploadClick` reference — `onUpload`'s
                                                        // own type is `() => void`, but wiring it to a
                                                        // DOM `onClick` (ResumeUpsellCard.tsx) means
                                                        // React would otherwise pass the click event
                                                        // through as `handleUploadClick`'s first
                                                        // argument, clobbering its `intent` param.
                                                        onUpload={() => handleUploadClick()}
                                                        onDismiss={dismissUpsell}
                                                    />,
                                                ];
                                            }
                                            return [row];
                                        })}
                                    </div>
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
                                </div>
                            )}
                        </div>
                        <SearchSeedLine onSubmit={handleSeedSubmit} submitting={seedSubmitting} />
                    </div>

                    {/* Rail: real pipeline counts + this search's ghost-risk stats
                        (spec cuts the mock's Weekly-alert card entirely — no alert
                        backend), separated by a vertical hairline — not a card stack.
                        Detail opens exclusively via the Sheet below, at every
                        breakpoint. */}
                    <aside className="flex flex-col gap-6 border-t border-border pb-4 pt-5 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pb-6 lg:pl-6 lg:pt-0">
                        <PipelineCard nowMs={nowMs} />
                        <GhostRadarCard distribution={result?.facetDistribution} total={totalCount} />
                    </aside>
                </div>
            </>

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
            <ResumeImportModal
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onImport={handleImport}
                confirmLabel="Rank my jobs"
            />
            <Sheet
                open={detailSheetOpen}
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
            {/* Task 10 — mobile filter sheet. Pending-state FilterPanel instance:
                same component/model as the rail + chips row, wired to the
                pendingFilterState mutators above (see resolution #3). Tapping
                "Show N roles" applies via `applyFilterState` and closes;
                dismissing (X/overlay/swipe/Esc) discards the pending edits. */}
            <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
                <SheetContent
                    side="bottom"
                    className="flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl p-0"
                >
                    <SheetTitle className="sr-only">Filters</SheetTitle>
                    <div
                        role="region"
                        aria-label="Job filters"
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-4 pt-10"
                    >
                        <FilterPanel
                            distribution={result?.facetDistribution}
                            postedDateSupported={postedDateSupported}
                            state={pendingFilterState}
                            activeCount={pendingActiveCount}
                            onToggleFacet={pendingToggleFacet}
                            onSalaryMin={pendingSalaryMin}
                            onVisaOnly={pendingVisaOnly}
                            onPostedBucket={pendingPostedBucket}
                            onClearAll={pendingClearAll}
                            hideGhosts={pendingFilterState.hideGhosts}
                            onHideGhosts={pendingHideGhosts}
                            // Best-effort reuse of the APPLIED filters' honest
                            // ghost-hidden count (Task 7) rather than a second
                            // debounced count request scoped to pending state —
                            // matches this count's existing "fire and forget,
                            // omit the suffix rather than block" contract.
                            ghostHiddenCount={ghostHiddenCount}
                        />
                    </div>
                    <div className="shrink-0 border-t border-border bg-card p-3">
                        <Button className="w-full" onClick={applyPendingFilters}>
                            {sheetCount != null ? `Show ${sheetCount.toLocaleString()} roles` : "Show roles"}
                        </Button>
                    </div>
                </SheetContent>
            </Sheet>
        </PageLayout>
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
