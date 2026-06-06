"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
    CaretRight,
} from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { searchJobsAction, markJobAppliedAction } from "@/actions/jobs";
import { FilterPanel, facetValueLabel } from "@/components/jobs/FilterPanel";
import { FACETABLE_KEYS, type FacetKey, type GhostBadge, type JobSearchResult, type PublicJob } from "@/lib/jobs/types";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";

/* ----------------------------- helpers ----------------------------- */

const GHOST_META: Record<GhostBadge, { label: string; cls: string; dot: string; explain: string } | null> = {
    likely_ghost: {
        label: "Possible ghost job",
        cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25",
        dot: "bg-amber-500",
        explain:
            "Subspace's signals flag this posting as a possible ghost job — it may be stale, evergreen, or not actively hiring. Worth verifying before you invest time.",
    },
    caution: {
        label: "Worth verifying",
        cls: "bg-amber-50/70 text-amber-700 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300/90 dark:border-amber-500/20",
        dot: "bg-amber-400",
        explain: "Some signals suggest this posting is worth a quick sanity-check before you apply.",
    },
    clear: {
        label: "No ghost signals",
        cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25",
        dot: "bg-emerald-500",
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

function companyInitial(name: string | null): string {
    const n = cleanCompany(name).trim();
    return n ? n[0].toUpperCase() : "?";
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

function postedAge(iso: string | null): string | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const days = Math.floor((Date.now() - t) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "1d";
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}

function GhostChip({ badge }: { badge: GhostBadge }) {
    const meta = GHOST_META[badge];
    if (!meta) return null;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
            {meta.label}
        </span>
    );
}

/* ----------------------------- job row ----------------------------- */

function JobRow({ job, active, onClick }: { job: PublicJob; active: boolean; onClick: () => void }) {
    const age = postedAge(job.posted_at ?? job.first_seen_at);
    const sal = salaryText(job);
    return (
        <button
            onClick={onClick}
            className={cn(
                "block w-full rounded-xl border p-4 text-left transition-all",
                active
                    ? "border-brand/40 bg-brand/5 shadow-sm"
                    : "border-border bg-card hover:border-brand/30 hover:shadow-sm",
            )}
        >
            <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-base font-bold text-brand">
                    {companyInitial(job.company)}
                </div>
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
                    {GHOST_META[job.ghost_badge] && (
                        <div className="mt-2.5">
                            <GhostChip badge={job.ghost_badge} />
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
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-xl font-bold text-brand">
                        {companyInitial(job.company)}
                    </div>
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

function JobsContent() {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [facets, setFacets] = useState<Partial<Record<FacetKey, string[]>>>({});
    const [salaryMin, setSalaryMin] = useState(0);
    const [visaOnly, setVisaOnly] = useState(false);
    const [showFiltersMobile, setShowFiltersMobile] = useState(false);

    const [result, setResult] = useState<JobSearchResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Infinite scroll: how many pages are loaded, and a signature of the active
    // query so a slow load-more can't append onto a result from newer filters.
    const pagesLoadedRef = useRef(1);
    const searchSig = useMemo(
        () => JSON.stringify({ query: query.trim(), facets, salaryMin, visaOnly }),
        [query, facets, salaryMin, visaOnly],
    );
    const searchSigRef = useRef(searchSig);
    searchSigRef.current = searchSig;

    const [user, setUser] = useState<User | null>(null);
    const [authOpen, setAuthOpen] = useState(false);
    const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const pendingApply = useRef<PublicJob | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

    // Debounced search on query / facet / salary / visa changes.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const t = setTimeout(async () => {
            try {
                const r = await searchJobsAction({
                    q: query.trim() || undefined,
                    facets,
                    salaryMin: salaryMin || undefined,
                    visaOnly: visaOnly || undefined,
                    withFacets: true,
                    limit: PAGE,
                    offset: 0,
                });
                if (cancelled) return;
                pagesLoadedRef.current = 1;
                setLoadingMore(false);
                setResult(r);
                setSelectedId((prev) =>
                    prev && r.hits.some((h) => h.id === prev) ? prev : r.hits[0]?.id ?? null,
                );
            } catch (e) {
                if (!cancelled)
                    setResult({
                        hits: [],
                        total: 0,
                        backend: "unconfigured",
                        configured: false,
                        note: e instanceof Error ? e.message : String(e),
                    });
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, facets, salaryMin, visaOnly]);

    const hits = result?.hits ?? [];
    const selected = useMemo(
        () => hits.find((h) => h.id === selectedId) ?? hits[0] ?? null,
        [hits, selectedId],
    );

    const total = result?.total ?? 0;
    const hasMore =
        result?.configured === true && hits.length > 0 && hits.length < total && hits.length < MAX_REACHABLE;

    // Single-flight guard + observer handle (refs so we never rebind the observer).
    const inFlightRef = useRef(false);
    const observerRef = useRef<IntersectionObserver | null>(null);

    // Fetch the next page and append it. Discards its result if the filters
    // changed mid-flight, and de-dupes against what's already loaded.
    const loadMore = useCallback(async () => {
        if (inFlightRef.current) return;
        const cur = result;
        if (!cur || !cur.configured) return;
        if (cur.hits.length >= cur.total || cur.hits.length >= MAX_REACHABLE) return;
        const sig = searchSigRef.current;
        const offset = pagesLoadedRef.current * PAGE;
        inFlightRef.current = true;
        setLoadingMore(true);
        try {
            const r = await searchJobsAction({
                q: query.trim() || undefined,
                facets,
                salaryMin: salaryMin || undefined,
                visaOnly: visaOnly || undefined,
                limit: PAGE,
                offset,
            });
            if (searchSigRef.current !== sig) return; // newer search won — drop this page
            pagesLoadedRef.current += 1;
            setResult((prev) => {
                if (!prev) return prev;
                const seen = new Set(prev.hits.map((h) => h.id));
                const fresh = r.hits.filter((h) => !seen.has(h.id));
                return fresh.length ? { ...prev, hits: [...prev.hits, ...fresh] } : prev;
            });
        } catch {
            /* transient — the sentinel re-fires on the next scroll */
        } finally {
            inFlightRef.current = false;
            setLoadingMore(false);
        }
    }, [result, query, facets, salaryMin, visaOnly]);

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

    const toggleFacet = (key: FacetKey, value: string) =>
        setFacets((prev) => {
            const cur = prev[key] ?? [];
            const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
            const out = { ...prev };
            if (next.length) out[key] = next;
            else delete out[key];
            return out;
        });

    const clearAll = () => {
        setFacets({});
        setSalaryMin(0);
        setVisaOnly(false);
    };

    const activeCount =
        Object.values(facets).reduce((n, vs) => n + (vs?.length ?? 0), 0) +
        (salaryMin > 0 ? 1 : 0) +
        (visaOnly ? 1 : 0);

    const activeChips: { label: string; onRemove: () => void }[] = [];
    for (const key of FACETABLE_KEYS) {
        for (const v of facets[key] ?? []) {
            activeChips.push({ label: facetValueLabel(key, v), onRemove: () => toggleFacet(key, v) });
        }
    }
    if (salaryMin > 0) activeChips.push({ label: `≥ $${Math.round(salaryMin / 1000)}k`, onRemove: () => setSalaryMin(0) });
    if (visaOnly) activeChips.push({ label: "Sponsors visas", onRemove: () => setVisaOnly(false) });

    const handleTailor = (job: PublicJob) => {
        // Carry the full job description into the tailor flow (too long for a URL param).
        try {
            sessionStorage.setItem(
                "intervu:tailor-job",
                JSON.stringify({
                    company: cleanCompany(job.company),
                    position: decodeText(job.title),
                    description: job.description ?? "",
                }),
            );
        } catch {
            /* sessionStorage unavailable — fall back to params only */
        }
        const p = new URLSearchParams();
        p.set("company", cleanCompany(job.company));
        p.set("position", decodeText(job.title));
        router.push(`/resume-tailor?${p.toString()}`);
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
                alert(`Could not save: ${res.error}`);
                return;
            }
            setAppliedIds((prev) => new Set(prev).add(job.id));
        } catch (e) {
            alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setApplyingId(null);
        }
    };
    const handleMarkApplied = (job: PublicJob) => {
        if (!user) {
            pendingApply.current = job;
            setAuthOpen(true);
            return;
        }
        void doMarkApplied(job);
    };
    useEffect(() => {
        if (user && pendingApply.current) {
            const job = pendingApply.current;
            pendingApply.current = null;
            void doMarkApplied(job);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const notConnected = result != null && !result.configured;

    const filterPanel = (
        <FilterPanel
            distribution={result?.facetDistribution}
            state={{ facets, salaryMin, visaOnly }}
            activeCount={activeCount}
            onToggleFacet={toggleFacet}
            onSalaryMin={setSalaryMin}
            onVisaOnly={setVisaOnly}
            onClearAll={clearAll}
        />
    );

    return (
        <PageLayout
            fullWidth
            className="w-full max-w-[1700px] px-4 sm:px-6 py-6"
            header={
                <PageHeader
                    title="Find jobs"
                    description="Search live roles — flagged for ghost-job risk before you spend time on them."
                />
            }
        >
            {/* Search */}
            <div className="relative mb-3.5">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search role, company, or skill…"
                    className="h-11 bg-card pl-10"
                />
            </div>

            {/* Toolbar: mobile Filters button + active-filter chips + count */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 xl:hidden"
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
                <span className="flex-1" />
                {loading && hits.length > 0 && (
                    <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                        Updating…
                    </span>
                )}
                {!loading && result?.configured && (
                    <span className="text-[13px] text-muted-foreground">
                        {result.total.toLocaleString()} {result.total === 1 ? "role" : "roles"}
                        {query.trim() ? "" : " · newest first"}
                    </span>
                )}
            </div>

            {result?.preview && result.note && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    {result.note}
                </div>
            )}

            {notConnected ? (
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
            ) : (
                <div className="grid items-start gap-5 xl:grid-cols-[230px_minmax(0,1fr)]">
                    {/* Filter rail (xl+) */}
                    <aside className="sticky top-4 hidden self-start xl:block">{filterPanel}</aside>
                    {/* Filter panel (mobile / tablet, toggled) */}
                    {showFiltersMobile && <div className="xl:hidden">{filterPanel}</div>}

                    {/* Results + detail */}
                    <div>
                        {loading && hits.length === 0 ? (
                            <JobsListSplash />
                        ) : hits.length === 0 ? (
                            <div className="rounded-2xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
                                No roles match those filters. Try clearing a filter or broadening your search.
                            </div>
                        ) : (
                            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                                <div>
                                    <div className="space-y-2.5">
                                        {hits.map((job) => (
                                            <JobRow
                                                key={job.id}
                                                job={job}
                                                active={selected?.id === job.id}
                                                onClick={() => setSelectedId(job.id)}
                                            />
                                        ))}
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
                                <div className="lg:sticky lg:top-4">
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
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <AuthPopover open={authOpen} onOpenChange={setAuthOpen} showTrigger={false} />
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
