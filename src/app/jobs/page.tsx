"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
    MagnifyingGlass,
    Funnel,
    X,
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
    ArrowLeft,
    ArrowRight,
    CaretRight,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
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
import { PageHeader } from "@/components/layout/PageHeader";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import {
    searchJobsAction,
    markJobAppliedAction,
    suggestAdjacentRolesAction,
    getJobsFreshnessAction,
    suggestJobsAction,
} from "@/actions/jobs";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { formatRelativeAge, isStale } from "@/lib/jobs/freshness";
import { badgeFor } from "@/lib/jobs/badges";
import { FilterPanel, activeFilterEntries, type FilterState } from "@/components/jobs/FilterPanel";
import { TailorAnalysisSheet, type TailorJob } from "@/components/jobs/TailorAnalysisSheet";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ResumeUpsellCard } from "@/components/jobs/ResumeUpsellCard";
import { ResumeImportModal } from "@/components/resume-builder/ResumeImportModal";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { JobsPaginationGeneration } from "@/lib/jobs/pagination-generation";
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
} from "@/lib/jobs/result-state";
import { resolveEffectiveSort } from "@/lib/jobs/sort";
import {
    type FacetKey,
    type GhostBadge,
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
    composeExploreActivationUrlState,
    type JobsUrlState,
    type UrlSort,
} from "@/lib/jobs/url-state";
import { FitIntentGuard } from "@/lib/jobs/fit-intent";
import { buildMatchQuery, buildExploreBroadenQuery, topSkills, seniorityFromYears } from "@/lib/jobs/resume-match";
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
 */
function postedAge(ts: number | null): string | null {
    if (ts == null) return null;
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "1d";
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}

// `text` is the compact row-badge string from `badgeFor` (lib/jobs/badges.ts)
// — a pure function of (ghost_badge, updated_at, posted_ts, now), unit-tested
// in tests/unit/jobs-badges.test.ts. GHOST_META still owns the styling
// (cls/dot) and the longer descriptive copy used elsewhere (JobDetail's
// banner); this chip only renders the short row-level text.
function GhostChip({ badge, text }: { badge: GhostBadge; text: string }) {
    const meta = GHOST_META[badge];
    if (!meta) return null;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
            {text}
        </span>
    );
}

function sortModeLabel(mode: JobSortMode, hasQuery: boolean): string {
    if (mode === "salary_desc") return "Salary high to low";
    if (mode === "newest") return "Date posted";
    return hasQuery ? "Best match" : "Date posted";
}

function sortCountSuffix(mode: JobSortMode, hasQuery: boolean): string {
    if (mode === "salary_desc") return " · highest salary first";
    if (mode === "newest") return " · newest first";
    return hasQuery ? " · best match" : "";
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

/* ----------------------------- job row ----------------------------- */

function JobRow({
    job,
    active,
    onClick,
}: {
    job: PublicJob;
    active: boolean;
    onClick: () => void;
}) {
    const postedTs = derivePostedTs(job);
    const age = postedAge(postedTs);
    const sal = salaryText(job);
    // Task 8 row badge: clear → "✓ live {age}" (from updated_at), caution →
    // "⚠ {daysOpen} days open" (from posted_ts), likely_ghost → "✕ likely
    // ghost", unscored → null (renders nothing, same as the old
    // `GHOST_META[job.ghost_badge] &&` gate this replaces).
    const badgeText = badgeFor(job.ghost_badge, job.updated_at, postedTs, Date.now());
    const accessibleName = `${decodeText(job.title)} at ${cleanCompany(job.company) || "Unknown company"}`;
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            aria-label={`View ${accessibleName}`}
            data-job-row
            data-testid="job-row"
            onClick={onClick}
            className={cn(
                "block w-full rounded-xl border p-4 text-left transition-all",
                active
                    ? "border-brand/50 bg-brand/5 shadow-sm ring-1 ring-brand/25 border-l-[3px] border-l-brand"
                    : "border-border bg-card hover:border-brand/30 hover:shadow-sm",
            )}
        >
            <div className="flex items-start gap-3">
                <CompanyLogo domain={job.company_domain} name={job.company} size="sm" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{decodeText(job.title)}</span>
                        {age && <span className="shrink-0 text-xs text-muted-foreground">{age}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {cleanCompany(job.company) || "Unknown company"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <MapPin size={13} /> {locationText(job)}
                        </span>
                        {sal && (
                            <span className="inline-flex items-center gap-1">
                                <CurrencyDollar size={13} /> {sal}
                            </span>
                        )}
                    </div>
                    {badgeText && (
                        <div className="mt-2.5">
                            <GhostChip badge={job.ghost_badge} text={badgeText} />
                        </div>
                    )}
                </div>
            </div>
        </button>
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
    onTailor,
    onOpenPosting,
    onMarkApplied,
    onPrep,
    applied,
    applying,
}: {
    job: PublicJob;
    onTailor: () => void;
    onOpenPosting: () => void;
    onMarkApplied: () => void;
    onPrep: () => void;
    applied: boolean;
    applying: boolean;
}) {
    const ghost = GHOST_META[job.ghost_badge];
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

                <div className="mt-5 flex flex-wrap gap-2">
                    <Button onClick={onTailor} className="gap-2">
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
                        {job.ghost_badge === "clear" ? (
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

/* ----------------------------- page ----------------------------- */

/** Page size for the results list + each infinite-scroll fetch. */
const PAGE = 30;
/** Meili `pagination.maxTotalHits` — the deepest reachable result in page mode. */
const MAX_REACHABLE = 100_000;

/** Branded splash shown while the jobs list is loading its first page. */
function JobsListSplash() {
    return (
        <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5 rounded-2xl border border-border bg-card/40 py-20 text-center">
            <div className="relative flex h-14 w-14 items-center justify-center">
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                <Briefcase size={22} className="text-brand" weight="duotone" />
            </div>
            <div>
                <p className="text-sm font-semibold">Finding live roles…</p>
                <p className="mt-1 text-xs text-muted-foreground">Screening each posting for ghost-job signals</p>
            </div>
        </div>
    );
}

/* ----------------------------- results mode ----------------------------- */

/**
 * Results-view mode for /jobs. Jobs render on first paint for everyone —
 * there is no entry gate — so `mode` only ever tracks which results view is
 * active; it always starts at `"browse"`. `search` is special — it shows a
 * prompt and only fetches once a query is typed. `explore` is triggered by
 * the compact Explore button beside the search input (see `enterExplore`
 * below). The old Match mode is gone: "Rank by fit" is no longer a
 * page-wide mode, it's a sort choice — `buildMatchQuery`'s pipeline is
 * re-homed onto `sort=fit` + a dismissible chip (see `applyFit`).
 */
type Mode = "explore" | "search" | "browse";

/** A resume is "usable" for matching if it has a profession or at least one skill. */
function resumeIsUsable(d: ResumeData | undefined): boolean {
    if (!d) return false;
    if ((d.profile?.profession ?? "").trim()) return true;
    return (d.competencies ?? []).some((c) => (c.skills ?? []).some((s) => (s ?? "").trim()));
}

const MODE_META: Record<Mode, { label: string; Icon: typeof Target }> = {
    explore: { label: "Exploring adjacent roles", Icon: Compass },
    search: { label: "Search", Icon: MagnifyingGlass },
    browse: { label: "Browsing all live roles", Icon: Briefcase },
};

/** Slim bar above the results that names the active mode + offers "Start over". */
function ModeBar({ mode, onStartOver }: { mode: Mode; onStartOver: () => void }) {
    const meta = MODE_META[mode];
    if (!meta) return null;
    return (
        <div className="mb-3 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <meta.Icon size={16} weight="duotone" className="text-brand" />
                {meta.label}
            </span>
            <button
                onClick={onStartOver}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft size={12} /> Start over
            </button>
        </div>
    );
}

/** Empty state for search-only mode before the user has typed anything. */
function SearchPrompt({ onBrowseAll }: { onBrowseAll: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <MagnifyingGlass size={26} />
            </div>
            <h3 className="mb-1.5 text-lg font-semibold">Search for the kind of role you want</h3>
            <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
                Try something like <span className="font-medium text-foreground">&ldquo;staff product designer,
                remote&rdquo;</span> or <span className="font-medium text-foreground">&ldquo;backend engineer
                fintech&rdquo;</span> in the box above.
            </p>
            <button
                onClick={onBrowseAll}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
                or browse all live roles <ArrowRight size={12} />
            </button>
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

    const [query, setQuery] = useState(initialUrlState.q);
    const [facets, setFacets] = useState<Partial<Record<FacetKey, string[]>>>(initialUrlState.facets);
    const [salaryMin, setSalaryMin] = useState(initialUrlState.salaryMin);
    const [visaOnly, setVisaOnly] = useState(initialUrlState.visaOnly);
    const [postedBucket, setPostedBucket] = useState<PostedBucket | undefined>(initialUrlState.postedBucket);
    // First-screen default: exclude likely_ghost from results. `ghosts=show` in
    // the URL flips it. No UI toggle wired yet (Task 6 — Trust toolbar).
    const [hideGhosts, setHideGhosts] = useState(initialUrlState.hideGhosts);
    // Explicit sort override; null = auto (newest with no query, relevance with a query —
    // see buildSort in lib/jobs/meilisearch.ts). Not a "filter", so it's kept out of
    // activeCount/activeChips/clearAll. See `resolveUrlSort` for the sort=fit handling.
    const [sortOverride, setSortOverride] = useState<JobSortMode | null>(resolveUrlSort(initialUrlState.sort));
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
    const [showFiltersMobile, setShowFiltersMobile] = useState(false);
    const [detailSheetOpen, setDetailSheetOpen] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchRetry, setSearchRetry] = useState(0);
    const userPickedDetailRef = useRef(false);

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
    const applyUrlState = (next: JobsUrlState, history: "replace" | "push") => {
        const target = `${pathname}${serializeJobsUrl(next)}`;
        if (history === "push") router.push(target, { scroll: false });
        else router.replace(target, { scroll: false });
    };

    const [result, setResult] = useState<JobSearchResult | null>(null);
    const resultRef = useRef<JobSearchResult | null>(null);
    resultRef.current = result;
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedIdRef = useRef<string | null>(null);
    selectedIdRef.current = selectedId;

    // Live corpus size for the search placeholder ("Search 12,345 live-checked
    // roles…") and Task 8's upsell copy. Captured opportunistically from the
    // FIRST all-defaults search response (never a dedicated count request) —
    // `corpusTotalCapturedRef` makes that one-shot regardless of effect
    // re-runs. A deep link that already carries filters on first load never
    // fills this in; the placeholder just stays generic.
    const [corpusTotal, setCorpusTotal] = useState<number | null>(null);
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

    // Effective sort: shared resolver normalizes relevance-without-query to newest.
    const effectiveSort: JobSortMode = resolveEffectiveSort({
        q: query,
        sort: sortOverride ?? undefined,
    });

    const hasQuery = query.trim().length > 0;

    // A monotonic generation makes stale pagination unambiguous, including
    // reversible A→B→A query changes where signatures alone are insufficient.
    const paginationRef = useRef<JobsPaginationGeneration | null>(null);
    if (!paginationRef.current) paginationRef.current = new JobsPaginationGeneration();

    const [user, setUser] = useState<User | null>(null);
    const [authOpen, setAuthOpen] = useState(false);
    const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const [tailorOpen, setTailorOpen] = useState(false);
    const [tailorJob, setTailorJob] = useState<TailorJob | null>(null);

    // Which results mode we're in, the resume backing Match/Explore, the
    // import modal, and the in-flight Explore call + its suggested titles.
    const [mode, setMode] = useState<Mode>("browse");
    const [resume, setResume] = useState<ResumeData | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [exploring, setExploring] = useState(false);
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
            }),
        [query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, sortOverride],
    );

    // Debounced search on query / facet / salary / visa changes. In `search`
    // mode we wait for a non-empty query (empty → the SearchPrompt, no fetch).
    useEffect(() => {
        const shouldFetch = mode !== "search" || query.trim().length > 0;
        if (!shouldFetch) {
            paginationRef.current!.invalidate();
            setLoading(false);
            setLoadingMore(false);
            if (mode === "search") {
                setResult(null); // empty search → prompt, not stale hits
                setSelectedId(null);
                setDetailSheetOpen(false);
                userPickedDetailRef.current = false;
            }
            return;
        }
        let cancelled = false;
        let firstPageSucceeded = false;
        const generation = paginationRef.current!.beginFirstPage();
        setSearchError(null);
        setLoadingMore(false);
        // `loading` means any first-page request is in flight. Rendering still
        // distinguishes first load (`hits.length === 0`) from background refresh.
        setLoading(true);
        const t = setTimeout(async () => {
            try {
                const r = await searchJobsAction({
                    q: query.trim() || undefined,
                    facets,
                    salaryMin: salaryMin || undefined,
                    visaOnly: visaOnly || undefined,
                    postedBucket,
                    hideGhosts,
                    sort: sortOverride ?? undefined,
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
                firstPageSucceeded = true;
                setResult(r);
                // `searchKey === ""` is exactly the all-defaults JobsUrlState
                // (ignoring jobId) — the same subset it's built from. One-shot
                // via the ref so this never fires again once captured.
                if (!corpusTotalCapturedRef.current && searchKey === "") {
                    corpusTotalCapturedRef.current = true;
                    setCorpusTotal(r.total);
                }
                const selection = resolveSelectionAfterRefresh(selectedIdRef.current, r.hits);
                setSelectedId(selection.selectedId);
                if (!selection.preserveDeliberateDetail) {
                    setDetailSheetOpen(false);
                    userPickedDetailRef.current = false;
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
                        q: query.trim() || undefined,
                        facets: { ...facets, ghost_badge: undefined },
                        salaryMin: salaryMin || undefined,
                        visaOnly: visaOnly || undefined,
                        postedBucket,
                        hideGhosts: false,
                        sort: sortOverride ?? undefined,
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
                    const msg = e instanceof Error ? e.message : String(e);
                    setSearchError(msg);
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
        // above — so listing it alone (plus mode/searchRetry) satisfies the
        // refetch rule without duplicating every field in this array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchKey, mode, searchRetry]);

    // Relevance is meaningless without a query — drop the override rather than send it.
    useEffect(() => {
        if (!hasQuery && sortOverride === "relevance") {
            setSortOverride(null);
            applyUrlState(buildUrlState({ sort: null }), "replace");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasQuery, sortOverride]);

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
            setSortOverride(resolveUrlSort(parsed.sort));
            setFitActive(parsed.sort === "fit");
        }

        // Selected job stays derived from the URL's `job` param — the
        // reactive source of truth. Row click pushes it (`openJob`); this
        // picks it back up on mount (deep link), on browser back/forward
        // (popstate needs no bespoke handling — Next's router already
        // updates `searchParams`), and closes the mobile sheet when `job`
        // disappears (detail close calls `router.back()`, see the Sheet
        // below). Deliberately unconditional (not gated behind the subset
        // check above) — a job-only URL change must still update selection
        // even when nothing else in the subset changed.
        const jobId = parsed.jobId;
        setSelectedId(jobId);
        if (jobId) {
            userPickedDetailRef.current = true;
            if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
                setDetailSheetOpen(true);
            }
        } else {
            userPickedDetailRef.current = false;
            setDetailSheetOpen(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // `selectedId` set (deliberately, from the URL) but not among the loaded
    // hits leaves the pane empty rather than stealing a fallback job — Task 11
    // adds the single-job fetch tombstone for that case. No explicit
    // selection at all (ambient "browsing" default) still falls back to the
    // first hit, exactly like before Task 5 — that default is never
    // URL-represented.
    const selected = useMemo(() => {
        if (!selectedId) return hits[0] ?? null;
        return hits.find((h) => h.id === selectedId) ?? null;
    }, [hits, selectedId]);

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
            const r = await searchJobsAction({
                q: query.trim() || undefined,
                facets,
                salaryMin: salaryMin || undefined,
                visaOnly: visaOnly || undefined,
                postedBucket,
                hideGhosts,
                sort: sortOverride ?? undefined,
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
    }, [result, query, facets, salaryMin, visaOnly, postedBucket, hideGhosts, sortOverride]);

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
    useEffect(() => () => observerRef.current?.disconnect(), []);

    // Every filter/sort mutation below routes through `applyUrlState` with
    // `"replace"` — a filter toggle must never grow browser history.
    const toggleFacet = (key: FacetKey, value: string) => {
        const cur = facets[key] ?? [];
        const nextValues = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
        const nextFacets = { ...facets };
        if (nextValues.length) nextFacets[key] = nextValues;
        else delete nextFacets[key];
        setFacets(nextFacets);
        applyUrlState(buildUrlState({ facets: nextFacets }), "replace");
    };

    const applySalaryMin = (v: number) => {
        setSalaryMin(v);
        applyUrlState(buildUrlState({ salaryMin: v }), "replace");
    };
    const applyVisaOnly = (v: boolean) => {
        setVisaOnly(v);
        applyUrlState(buildUrlState({ visaOnly: v }), "replace");
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

    const filterState: FilterState = { facets, salaryMin, visaOnly, postedBucket, hideGhosts };

    const clearAll = () => {
        applyFilterState({ facets: {}, salaryMin: 0, visaOnly: false, postedBucket: undefined, hideGhosts: true });
    };

    // `activeFilterEntries` (FilterPanel.tsx) is the single source for "what's
    // active" — the toolbar chips below, the count badges (mobile Filters
    // button + rail's "Clear all (N)"), and Tasks 10-11's sheet/empty state
    // all read from it so they can never disagree.
    const activeEntries = activeFilterEntries(filterState);
    const activeCount = activeEntries.length;
    const activeChips = activeEntries.map((entry) => ({
        label: entry.label,
        onRemove: () => applyFilterState(entry.clear(filterState)),
    }));

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
            setAppliedIds((prev) => new Set(prev).add(job.id));
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
    // résumé importer completes — set right before `handleUploadClick()` by
    // `handleRankByFit`/`handleExploreClick`'s no-usable-résumé fallback.
    // `clearPendingGate` (below) resets it on every alternate path/dismiss,
    // same invariant as `pendingRef`: only the latest intent survives.
    const resumeActionAfterImportRef = useRef<"fit" | "explore" | null>(null);

    // Guards `handleRankByFit`'s async résumé fetch against being superseded
    // by a LATER sort choice (fit again, or any other sort option) made
    // while the fetch is still in flight — see lib/jobs/fit-intent.ts.
    // Instantiated once, mirroring the `paginationRef` idiom below.
    // (review fix, 2026-07-18)
    const fitIntentRef = useRef<FitIntentGuard | null>(null);
    if (!fitIntentRef.current) fitIntentRef.current = new FitIntentGuard();

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
    // clears any stale "ranked by résumé" framing — chip, Select label, and
    // `sort=fit` in the URL — since Explore's query no longer reflects the
    // fit pipeline once this runs. Mirrors `applyFit`'s own cross-clear of
    // `exploreTitles` in the opposite direction. Reads `fitActiveRef` (not
    // the `fitActive` closure) so this stays correct even invoked through
    // `maybeReplay`'s stable, first-render-captured `runExplore` reference.
    // (review fix, 2026-07-18 — Explore used to leave the fit chip/Select
    // label/URL sort stuck after activating.)
    //
    // The URL write goes through `composeExploreActivationUrlState` (pure,
    // unit-tested in lib/jobs/url-state.ts), not a bare `buildUrlState()` —
    // `setQuery`/`setFacets` just above are async state setters, so
    // `buildUrlState()` alone would still read this render's pre-explore
    // closure (the STALE résumé q/facets), not the values just set.
    // `composeExploreActivationUrlState` sidesteps that by construction: it
    // always OVERWRITES q/facets/sort in its own body from the `exploreQuery`
    // argument, regardless of what the snapshot it's given contains for
    // those fields — so it can't reproduce this bug even if a future caller
    // forgets to pass overrides into `buildUrlState()` itself. (2nd review
    // fix, 2026-07-18 — the first pass fixed WHERE fit gets cleared but not
    // this staleness.)
    const activateExplore = (q: string, titles: string[]) => {
        setExploreTitles(titles);
        setFacets({});
        setQuery(q);
        setMode("explore");
        if (fitActiveRef.current) {
            setFitActive(false);
            applyUrlState(composeExploreActivationUrlState(buildUrlState(), q), "replace");
        }
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
    // stable-identity `maybeReplay` closure. A server-reported auth error
    // (session expired) re-queues + reopens auth.
    const runExplore = async (r: ResumeData) => {
        setExploring(true);
        try {
            const res = await suggestAdjacentRolesAction({
                profession: r.profile?.profession ?? "",
                skills: topSkills(r, 12),
                seniority: seniorityFromYears(r.profile?.yearsOfExperience ?? 0),
            });
            if (res.error) {
                if (classifySentinel(res.error) === "auth") {
                    pendingRef.current = queuePending(pendingRef.current, { kind: "explore", payload: r });
                    openAuth();
                    return;
                }
                const { q } = buildExploreBroadenQuery(r);
                if (!q) {
                    toast.error("Couldn't build an explore view — try Rank by fit or search instead.");
                    return;
                }
                activateExplore(q, []);
                toast.info(
                    classifySentinel(res.error) === "credits"
                        ? "Out of AI credits — showing skill-based matches instead."
                        : "Showing roles related to your skills.",
                );
                return;
            }
            const titles = res.titles ?? [];
            const q = titles.join(" ");
            activateExplore(q, titles);
        } finally {
            setExploring(false);
        }
    };

    // Sort menu → "Rank by fit" click. A résumé already on hand applies
    // immediately; otherwise queue the résumé importer (via the existing
    // `handleUploadClick` upload-gate) and apply fit the moment it completes
    // (see `handleImport`'s `resumeActionAfterImportRef` check). The ref is
    // set AFTER `handleUploadClick()` runs, not before — that call's own
    // `clearPendingGate()` would otherwise wipe it immediately.
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
        resumeActionAfterImportRef.current = "fit";
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
            handleUploadClick();
            resumeActionAfterImportRef.current = "explore";
        } finally {
            exploreInFlightRef.current = false;
        }
    };

    const enterBrowse = () => {
        clearPendingGate();
        setExploreTitles([]);
        setFacets({});
        setQuery("");
        setMode("browse");
    };

    const handleUploadClick = () => {
        clearPendingGate();
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
        // Rank-by-fit / Explore queued this import because no usable résumé
        // was on hand yet — finish what they asked for now that one exists.
        const queuedAction = resumeActionAfterImportRef.current;
        resumeActionAfterImportRef.current = null;
        if (queuedAction === "fit") applyFit(data);
        else if (queuedAction === "explore") void enterExplore(data);
    };

    const startOver = () => {
        setExploreTitles([]);
        setFacets({});
        setSalaryMin(0);
        setVisaOnly(false);
        setPostedBucket(undefined);
        setSortOverride(null);
        setHideGhosts(true);
        setQuery("");
        setSearchError(null);
        setDetailSheetOpen(false);
        userPickedDetailRef.current = false;
        setMode("browse");
        applyUrlState(DEFAULT_URL_STATE, "replace");
    };

    const notConnected = result != null && !result.configured && result.backend === "unconfigured";
    const blockingError = searchError != null && hits.length === 0;
    const backgroundError = searchError != null && hits.length > 0;

    const filterPanel = (
        <FilterPanel
            distribution={result?.facetDistribution}
            state={filterState}
            activeCount={activeCount}
            onToggleFacet={toggleFacet}
            onSalaryMin={applySalaryMin}
            onVisaOnly={applyVisaOnly}
            onPostedBucket={applyPostedBucket}
            onClearAll={clearAll}
            hideGhosts={hideGhosts}
            onHideGhosts={onHideGhosts}
            ghostHiddenCount={ghostHiddenCount}
        />
    );

    return (
        <PageLayout
            fullWidth
            className="w-full max-w-[1700px] px-4 py-6 sm:px-6 lg:flex lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:flex-none lg:flex-col lg:overflow-hidden"
            header={
                <PageHeader
                    title="Find jobs"
                    description="Search live roles — flagged for ghost-job risk before you spend time on them."
                />
            }
        >
            <>
                <a
                    href="#jobs-results-list"
                    className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-[60] focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
                >
                    Skip to results
                </a>
                <div className="shrink-0">
                    <ModeBar mode={mode} onStartOver={startOver} />
                </div>
                <div className="flex min-h-0 flex-col lg:flex-1">
            {/* Search + Explore */}
            <div className="mb-3.5 flex shrink-0 items-center gap-2">
                <SearchAutocomplete
                    value={query}
                    onChange={(v) => {
                        setQuery(v);
                        // Continuous input is filter-like — `replace`, not `push` (a
                        // "push" per keystroke would make the back button undo one
                        // character at a time). Discrete submit (Enter, or picking a
                        // suggestion) uses `push` instead — see `onSearch` below.
                        applyUrlState(buildUrlState({ q: v }), "replace");
                    }}
                    onSearch={() => applyUrlState(buildUrlState({ q: query }), "push")}
                    suggest={(q) => suggestJobsAction(q).then(mapToSuggestions)}
                    placeholder={
                        corpusTotal != null
                            ? `Search ${corpusTotal.toLocaleString()} live-checked roles…`
                            : "Search live-checked roles…"
                    }
                    className="h-11 bg-card"
                    containerClassName="min-w-0 flex-1"
                />
                {/* Re-homed from the old entry-gate's "Explore adjacent roles" choice.
                    Credit/auth gating (enterExplore/runExplore) is reused verbatim. */}
                <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 gap-1.5"
                    disabled={exploring}
                    onClick={() => void handleExploreClick()}
                >
                    {exploring ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                    ) : (
                        <Compass size={16} />
                    )}
                    Explore
                </Button>
            </div>

            {/* Explore: AI-suggested adjacent titles — click one to narrow to it. */}
            {mode === "explore" && exploreTitles.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-xs text-muted-foreground">Exploring:</span>
                    {exploreTitles.map((t) => {
                        const active = query.trim() === t;
                        return (
                            <button
                                key={t}
                                onClick={() => setQuery(active ? exploreTitles.join(" ") : t)}
                                className={cn(
                                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                    active
                                        ? "border-brand bg-brand/10 text-brand"
                                        : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground",
                                )}
                            >
                                {t}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Toolbar: mobile Filters button + active-filter chips + count */}
            <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 lg:hidden"
                    onClick={() => setShowFiltersMobile((v) => !v)}
                >
                    <Funnel size={14} /> Filters
                    {activeCount > 0 && (
                        <span className="ml-0.5 rounded-full bg-brand/15 px-1.5 text-[11px] font-semibold text-brand">
                            {activeCount}
                        </span>
                    )}
                </Button>
                {activeChips.map((c, i) => (
                    <button
                        key={i}
                        data-testid="active-filter-chip"
                        onClick={c.onRemove}
                        className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                    >
                        {c.label}
                        <X size={12} />
                    </button>
                ))}
                {activeChips.length > 0 && (
                    <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground">
                        Clear all
                    </button>
                )}
                {fitActive && (
                    <button
                        onClick={clearFit}
                        className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
                    >
                        Ranked by your résumé
                        <X size={12} />
                    </button>
                )}
                <span className="flex-1" />
                {result?.configured && (
                    <Select
                        value={fitActive ? "fit" : effectiveSort}
                        onValueChange={(v) => {
                            if (v === "fit") {
                                void handleRankByFit();
                                return;
                            }
                            // Any OTHER sort choice also supersedes an
                            // in-flight `handleRankByFit` résumé fetch, not
                            // just re-picking fit — see fit-intent.ts.
                            fitIntentRef.current!.begin();
                            const nextMode = v as JobSortMode;
                            setFitActive(false);
                            setSortOverride(nextMode);
                            applyUrlState(buildUrlState({ sort: modeToUrlSort(nextMode) }), "replace");
                        }}
                    >
                        <SelectTrigger
                            size="sm"
                            className="h-8 w-auto min-w-[9.5rem] gap-1.5 border-border bg-card px-2.5 text-xs"
                            aria-label="Sort results"
                        >
                            <span className="text-muted-foreground">Sort:</span>
                            <SelectValue>{fitActive ? "Rank by fit" : sortModeLabel(effectiveSort, hasQuery)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end">
                            <SelectItem value="relevance" disabled={!hasQuery}>
                                Best match
                            </SelectItem>
                            <SelectItem value="newest">Date posted</SelectItem>
                            <SelectItem value="salary_desc">Salary high to low</SelectItem>
                            <SelectItem value="fit">Rank by fit</SelectItem>
                        </SelectContent>
                    </Select>
                )}
                {loading && hits.length > 0 && (
                    <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                        Updating…
                    </span>
                )}
                {!loading && result?.configured && (
                    <span className="text-[13px] text-muted-foreground">
                        {result.total.toLocaleString()} {result.total === 1 ? "role" : "roles"}
                        {fitActive ? " · ranked by fit" : sortCountSuffix(effectiveSort, hasQuery)}
                    </span>
                )}
                {lastUpdated !== undefined && (
                    <span
                        className="text-xs tabular-nums text-muted-foreground data-[stale=true]:text-amber-600 dark:data-[stale=true]:text-amber-400"
                        data-stale={isStale(lastUpdated, Date.now())}
                        title={lastUpdated ?? "freshness unknown"}
                    >
                        {lastUpdated ? `updated ${formatRelativeAge(lastUpdated, Date.now())}` : "freshness unknown"}
                    </span>
                )}
            </div>

            {result?.preview && result.note && (
                <div className="mb-4 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    {result.note}
                </div>
            )}

            {backgroundError && (
                <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                    <span>{searchError}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => setSearchRetry((n) => n + 1)}
                    >
                        Retry
                    </Button>
                </div>
            )}

            <div className="min-h-0 flex-1">
            {mode === "search" && !query.trim() ? (
                <SearchPrompt onBrowseAll={enterBrowse} />
            ) : notConnected ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-20 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        <MagnifyingGlass size={26} />
                    </div>
                    <h3 className="mb-1.5 text-lg font-semibold">Job search is being connected</h3>
                    <p className="mx-auto mb-1 max-w-md text-sm text-muted-foreground">
                        We&apos;re wiring intervu up to Subspace&apos;s live job corpus — including the ghost-job
                        signal that flags postings that aren&apos;t really hiring.
                    </p>
                    <p className="mx-auto max-w-md text-xs text-muted-foreground/70">{result?.note}</p>
                </div>
            ) : blockingError ? (
                <div
                    role="alert"
                    className="flex h-full flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center"
                >
                    <WarningCircle size={28} className="mb-3 text-destructive" />
                    <h3 className="text-lg font-semibold">Job search is temporarily unavailable</h3>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">{searchError}</p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => setSearchRetry((n) => n + 1)}
                    >
                        Retry
                    </Button>
                </div>
            ) : (
                <div className="relative grid h-full min-h-0 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
                    {/* lg+: visible filter/list/detail three-pane workspace (Task 7 — was xl). */}
                    <aside
                        role="region"
                        aria-label="Job filters"
                        className="hidden min-h-0 overflow-y-auto overscroll-contain custom-scrollbar lg:block"
                    >
                        {filterPanel}
                    </aside>
                    {/* <lg only: rail is hidden, so Filters opens a bounded overlay instead (Task 7 — was lg–xl). */}
                    {showFiltersMobile && (
                        <aside
                            role="region"
                            aria-label="Job filters"
                            className="max-h-[40vh] min-h-0 overflow-y-auto overscroll-contain rounded-xl bg-background shadow-lg custom-scrollbar lg:hidden"
                        >
                            {filterPanel}
                        </aside>
                    )}

                    {/* lg: two-pane list/detail workspace; lg also adds the filter pane (Task 7 — was xl). */}
                    <div className="flex min-h-0 flex-col">
                        {loading && hits.length === 0 ? (
                            <JobsListSplash />
                        ) : hits.length === 0 ? (
                            <div className="rounded-2xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
                                No roles match those filters. Try clearing a filter or broadening your search.
                            </div>
                        ) : (
                            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                                <div
                                    id="jobs-results-list"
                                    tabIndex={0}
                                    role="listbox"
                                    aria-label="Job results"
                                    onKeyDown={handleResultsKeyDown}
                                    className="min-h-0 overflow-y-auto overscroll-contain custom-scrollbar focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2"
                                >
                                    <div className="space-y-2.5 pr-1">
                                        {hits.flatMap((job, idx) => {
                                            const row = (
                                                <JobRow
                                                    key={job.id}
                                                    job={job}
                                                    active={selected?.id === job.id}
                                                    onClick={() => openJob(job.id)}
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
                                                        total={corpusTotal}
                                                        onUpload={handleUploadClick}
                                                        onDismiss={dismissUpsell}
                                                    />,
                                                ];
                                            }
                                            return [row];
                                        })}
                                    </div>
                                    {hasMore ? (
                                        <div ref={sentinelRef} className="flex items-center justify-center py-6">
                                            {loadingMore && (
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                                                    Loading more roles…
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="py-6 text-center text-xs text-muted-foreground/70">
                                            You&apos;ve reached the end — {total.toLocaleString()}{" "}
                                            {total === 1 ? "role" : "roles"}.
                                        </p>
                                    )}
                                </div>
                                <aside
                                    role="region"
                                    aria-label={
                                        selected
                                            ? `Job details: ${decodeText(selected.title)} at ${cleanCompany(selected.company) || "Unknown company"}`
                                            : "Job details"
                                    }
                                    className="hidden min-h-0 overflow-y-auto overscroll-contain custom-scrollbar lg:block"
                                >
                                    {selected ? (
                                        <JobDetail
                                            key={selected.id}
                                            job={selected}
                                            applied={appliedIds.has(selected.id)}
                                            applying={applyingId === selected.id}
                                            onTailor={() => handleTailor(selected)}
                                            onOpenPosting={() => handleOpenPosting(selected)}
                                            onMarkApplied={() => handleMarkApplied(selected)}
                                            onPrep={() => handlePrep(selected)}
                                        />
                                    ) : null}
                                </aside>
                            </div>
                        )}
                    </div>
                </div>
            )}
            </div>
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
                        {selected ? `${decodeText(selected.title)} at ${cleanCompany(selected.company)}` : "Job details"}
                    </SheetTitle>
                    {selected ? (
                        <JobDetail
                            key={selected.id}
                            job={selected}
                            applied={appliedIds.has(selected.id)}
                            applying={applyingId === selected.id}
                            onTailor={() => handleTailor(selected)}
                            onOpenPosting={() => handleOpenPosting(selected)}
                            onMarkApplied={() => handleMarkApplied(selected)}
                            onPrep={() => handlePrep(selected)}
                        />
                    ) : null}
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
