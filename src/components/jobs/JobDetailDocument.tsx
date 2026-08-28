"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowSquareOut, BookmarkSimple, Check, MapPin } from "@phosphor-icons/react";
import { getCompanyRailAction, getRelatedJobsAction } from "@/actions/jobs";
import { Button } from "@/components/ui/button";
import { ContextHelp } from "@/components/ui/context-help";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { JobDescription, RelatedJobRow } from "@/components/jobs/JobDetail";
import { MatchChip } from "@/components/jobs/MatchChip";
import type { MatchScore } from "@/lib/match/score";
import { captureEvent, type EventSource } from "@/lib/analytics/events";
import { ReportJobButton } from "@/components/jobs/ReportJobButton";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import {
    assessedGhostSignals,
    buildFactChips,
    deriveExposureBadges,
    deriveGhostSignals,
    ghostCheckedText,
} from "@/components/jobs/job-detail-facts";
import { shouldSuppressOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { buildCompanyJobsUrl, openCountText } from "@/lib/companies/presentation";
import { jobCompanyHref } from "@/lib/companies/paths";
import { formatDescription } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import {
    clampLocationSegments,
    decodeText,
    displayCompany,
    displayCompanyBrand,
    ghostMetaFor,
    locationText,
} from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { countryToFlag } from "@/lib/jobs/country-flag";
import { STATUS_PILL, LISTING_STATE_CHIP } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";

/** The employer rail — live open-role count, opened/closed 90d, and a
 *  postings-sourced about line (`getCompanyRailAction`, one shared query
 *  window). Renders only what actually resolved; never a placeholder number. */
function EmployerCard({ job, companyBrand, cleanedCompany }: { job: PublicJob; companyBrand: string; cleanedCompany: string }) {
    const [rail, setRail] = useState<{ openCount: OpenCount | null; aboutLine: string | null } | null>(null);
    useEffect(() => {
        let cancelled = false;
        setRail(null);
        if (!job.company_domain) return;
        getCompanyRailAction(job.company_domain, companyBrand || cleanedCompany)
            .then((data) => {
                if (!cancelled) setRail(data);
            })
            .catch(() => {
                /* presentation only — card still renders the link-out below */
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.company_domain]);

    const openCount = rail?.openCount ?? null;
    // Same resolve-then-suppress idiom as JobDetail.tsx's identity header:
    // an honest live 0 must not render "0 open roles" on a page that is
    // itself one of that company's open postings (see
    // `shouldSuppressOpenCount`'s doc comment for the closed-job carve-out).
    const showOpenCount = openCount != null && !shouldSuppressOpenCount(openCount.value, job.vacancy_status === "closed");
    const hasTrackRecord = typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number";

    return (
        <div data-testid="job-detail-employer-card" className="border border-border bg-card p-4 sm:p-5">
            <div className="mono-data text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {companyBrand || "This company"}
            </div>
            {rail?.aboutLine && <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{rail.aboutLine}</p>}
            {(showOpenCount || hasTrackRecord) && (
                <div className="mt-3.5 flex flex-wrap gap-4 border-t border-border/80 pt-3.5">
                    {showOpenCount && openCount && (
                        <div className="min-w-[90px]">
                            <div className="text-xl font-extrabold tabular-nums tracking-tight text-foreground">
                                {openCountText({ openCount: openCount.value, openCountIsLowerBound: openCount.isLowerBound })}
                            </div>
                            <div className="mono-data mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                                Open roles
                            </div>
                        </div>
                    )}
                    {typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number" && (
                        <div className="min-w-[110px]">
                            <div className="text-xl font-extrabold tabular-nums tracking-tight text-foreground">
                                {job.company_opened_90d.toLocaleString()}/{job.company_closed_90d.toLocaleString()}
                            </div>
                            <div className="mono-data mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                                Opened / closed, 90d
                            </div>
                        </div>
                    )}
                </div>
            )}
            {cleanedCompany && (
                <Link
                    href={
                        job.company_domain?.trim()
                            ? buildCompanyJobsUrl({ domain: job.company_domain.trim() })
                            : jobCompanyHref(cleanedCompany, job.company_domain)
                    }
                    className="mt-3.5 inline-block text-[13px] font-medium text-foreground underline underline-offset-[3px] hover:opacity-80"
                >
                    All jobs at {companyBrand || cleanedCompany} →
                </Link>
            )}
        </div>
    );
}

/**
 * The posting-check ledger, restyled as a receipt (spec Section 2, `.receipt`
 * grammar) — same derivation as JobDetail.tsx's glass-panel ghost module
 * (`deriveGhostSignals`/`assessedGhostSignals`/`ghostCheckedText`, all pure,
 * unchanged), a different box. The verdict pill reuses `ghost.cls`
 * (STATUS_PILL, via `ghostBadgeTone`) rather than `Badge variant="verdict-*"`
 * — that variant set only covers two of the three real ghost states
 * (good/caution; there is no "verdict-bad"), and STATUS_PILL is already the
 * one map with all three (offer/intv/closed) wired to dark mode. Introducing
 * a second, narrower status system for this one pill would be the drift
 * `lib/ui/status-tokens.ts`'s own doc comment describes fixing.
 */
function Receipt({ job, now }: { job: PublicJob; now: number }) {
    const freshness = classifyPostingFreshness(job, now);
    const blocks = formatDescription(job.description);
    const ghost = ghostMetaFor(job, now) ?? {
        label: "Not yet scored",
        cls: STATUS_PILL.saved,
        explain: "This posting hasn't been checked yet — the signals below are the facts we can already state.",
    };
    const signals = deriveGhostSignals(job, freshness, blocks.length, now);
    const assessed = assessedGhostSignals(signals);
    const favorableCount = assessed.filter((s) => s.status === "favorable").length;
    const unknownCount = signals.length - assessed.length;
    const checkedText = ghostCheckedText(job, now);
    const exposureBadges = deriveExposureBadges(job, now);

    return (
        <div data-testid="job-detail-receipt" className="border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <span className="mono-data text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Posting check</span>
                <span className={cn("inline-flex items-center px-2 py-0.5 text-xs font-bold uppercase tracking-wider", ghost.cls)}>{ghost.label}</span>
            </div>
            {signals.length > 0 && (
                <div className="mono-data divide-y divide-border/70">
                    {signals.map((s) => {
                        const relistCaution = s.kind === "freshness" && freshness.kind === "relisted";
                        const glyph = relistCaution ? "!" : s.status === "favorable" ? "✓" : s.status === "unknown" ? "·" : "—";
                        return (
                            <div key={s.text} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
                                <span
                                    className={cn(
                                        "mt-0.5 w-3 shrink-0 text-center font-bold",
                                        relistCaution
                                            ? "text-violet-600 dark:text-violet-400"
                                            : s.status === "favorable"
                                              ? "text-emerald-600 dark:text-emerald-400"
                                              : "text-muted-foreground",
                                    )}
                                >
                                    {glyph}
                                </span>
                                <div className="min-w-0 flex-1 leading-snug">
                                    <b className="mr-1.5 font-bold uppercase tracking-wide text-foreground">{s.kind}</b>
                                    <span className="text-muted-foreground">{s.text}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3">
                <span className="mono-data text-xs font-medium text-muted-foreground">
                    {assessed.length > 0 ? `${favorableCount}/${assessed.length} favorable` : "not yet scored"}
                    {unknownCount > 0 && <> · {unknownCount} not tracked</>}
                </span>
                <span className="text-xs text-muted-foreground">{checkedText.charAt(0).toLowerCase()}{checkedText.slice(1)}</span>
            </div>
            {exposureBadges.length > 0 && (
                <div className="mono-data flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-2.5 text-xs">
                    {exposureBadges.map((b) => (
                        <span key={b.label} className="inline-flex items-center border border-border px-2 py-1 font-medium text-muted-foreground">
                            {b.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export interface JobDetailDocumentProps {
    job: PublicJob;
    now: number;
    /** Where this page was reached from — fires `job_viewed` once per job.id mount. */
    source: EventSource;
    onOpenPosting: () => void;
    onGoAfter: () => void;
    pursuit: Pursuit | undefined;
    goingAfter: boolean;
    signedIn?: boolean;
    onRequestSignIn?: () => void;
    onOpenRelated?: (jobId: string, job?: PublicJob) => void;
    reportJobEnabled?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). Same value the SERP panel
     *  (`JobDetail`) and `sort=fit` read, computed once by `PublicJobDetail`. */
    matchScore?: MatchScore | null;
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`). */
    matchAsOfDate?: string | null;
}

/**
 * `/jobs/[slug]` standalone document layout (job-page-redesign.html spec) —
 * a sibling rendering of the same job data `JobDetail` shows in the SERP
 * panel/modal, not a fork of its logic: every derived fact here comes from
 * the same pure helpers (`job-detail-facts.ts`, `presentation.ts`,
 * `posting-freshness.ts`) JobDetail already calls, so a signal can never
 * read differently on the two surfaces.
 *
 * Each section is built once as a JSX variable and referenced from BOTH a
 * mobile single-column stack (the spec's required reading order) and a
 * desktop two-column grid — content is defined once, only the arrangement
 * differs, so there is nothing to keep in sync between breakpoints.
 *
 * Deliberately narrower than `JobDetail`'s prop surface: `variants`/`onClose`/
 * `collapseDescription` are panel-only concerns (cluster-variant chip, modal
 * dismiss, height-constrained clamp) that don't apply to a full-page
 * document — this page's `/jobs/[slug]` call site never passed them either.
 */
export function JobDetailDocument({
    job,
    now,
    source,
    onOpenPosting,
    onGoAfter,
    pursuit,
    goingAfter,
    signedIn = true,
    onRequestSignIn,
    onOpenRelated,
    reportJobEnabled = false,
    matchScore = null,
    matchAsOfDate = null,
}: JobDetailDocumentProps) {
    const closed = job.vacancy_status === "closed";
    const freshness = classifyPostingFreshness(job, now);
    const postedRelative = freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), now) : null;
    const firstSeenRelative = freshness.firstSeenMs != null ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), now) : null;
    const chips = buildFactChips(job, postedRelative, firstSeenRelative);
    const cleanedCompany = displayCompany(job.company, job.company_domain);
    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);
    const countryFlag = countryToFlag(job.location_country);
    const location = locationText(job);
    const locationDisclosure = clampLocationSegments(location);
    const locationClamped = locationDisclosure.hidden.length > 0;
    const [locationExpanded, setLocationExpanded] = useState(false);
    const blocks = formatDescription(job.description);
    const exceptionMark = rowExceptionMark(job, now);

    useEffect(() => {
        captureEvent("job_viewed", { job_id: job.id, company_domain: job.company_domain, source });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.id, source]);

    const [related, setRelated] = useState<PublicJob[]>([]);
    useEffect(() => {
        let cancelled = false;
        setRelated([]);
        // Ungated by `signedIn` — unlike the SERP panel's related fetch, this
        // is a standalone page with no modal to gate behind sign-in; the
        // page's own live open-count query (EmployerCard above) already
        // serves anonymous visitors the same company-scoped data with no
        // gate, so gating this one query type differently on this page would
        // be arbitrary rather than a real access boundary.
        getRelatedJobsAction(job.id, job.company_domain, job.title)
            .then((data) => {
                if (!cancelled) setRelated(data.jobs);
            })
            .catch(() => {
                /* "More like this" is an accelerant, not a source of error */
            });
        return () => {
            cancelled = true;
        };
    }, [job.id, job.company_domain, job.title]);

    const heroEl = (
        <div className="border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start gap-3.5 sm:gap-4">
                <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-bold leading-snug tracking-tight text-foreground sm:text-2xl">{decodeText(job.title)}</h1>
                    {matchScore && (
                        <div className="mt-1.5">
                            <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />
                        </div>
                    )}
                    <div className="mt-1.5 text-sm font-medium text-muted-foreground">
                        {cleanedCompany ? (
                            <Link href={jobCompanyHref(cleanedCompany, job.company_domain)} className="font-semibold text-foreground hover:underline">
                                {companyBrand}
                            </Link>
                        ) : (
                            "Unknown company"
                        )}
                        {" · "}
                        {countryFlag && <span aria-hidden className="mr-1">{countryFlag}</span>}
                        <MapPin size={13} className="mr-0.5 inline-block align-[-1px] text-muted-foreground/70" aria-hidden />
                        {locationClamped ? (
                            <>
                                {(locationExpanded ? [...locationDisclosure.visible, ...locationDisclosure.hidden] : locationDisclosure.visible).map((segment, i) => (
                                    <span key={i} className="block">{segment}</span>
                                ))}
                                <button type="button" onClick={() => setLocationExpanded((v) => !v)} className="mt-0.5 block text-xs font-medium text-brand hover:underline">
                                    {locationExpanded ? "Show less" : `+ ${locationDisclosure.hidden.length} more locations`}
                                </button>
                            </>
                        ) : (
                            location
                        )}
                    </div>
                </div>
            </div>

            {exceptionMark && (
                <div
                    className={cn(
                        "mt-3.5 border px-3 py-2 text-xs font-medium",
                        exceptionMark.kind === "both" || exceptionMark.kind === "stale"
                            ? STATUS_PILL.closed
                            : exceptionMark.kind === "relisted"
                              ? LISTING_STATE_CHIP.relisted
                              : "border-border/80 bg-background/50",
                    )}
                >
                    <ContextHelp content={exceptionMark.explain} side="right">
                        <span className="inline-flex flex-wrap items-center gap-x-1">
                            {exceptionMark.parts.map((part, i) => (
                                <span key={part.text} className="inline-flex items-center">
                                    {i > 0 && <span className="mx-1 text-muted-foreground/60" aria-hidden>·</span>}
                                    <span className={part.className}>{part.text}</span>
                                </span>
                            ))}
                        </span>
                    </ContextHelp>
                </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
                {chips.map((c) => {
                    const Icon = FACT_CHIP_ICON[c.kind];
                    return (
                        <span key={c.kind} className="inline-flex items-center gap-1.5 border border-border/80 bg-background/50 px-2.5 py-1 text-xs font-medium text-foreground">
                            <Icon size={13} weight="bold" className="text-muted-foreground" aria-hidden />
                            {c.label}
                        </span>
                    );
                })}
            </div>

            {job.must_have_skills && job.must_have_skills.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/70 pt-4">
                    {job.must_have_skills.slice(0, 12).map((skill) => (
                        <span key={skill} className="mono-data border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
                            {decodeText(skill)}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );

    const applyCardEl = closed ? (
        <div data-testid="job-detail-apply-card" className="border border-border bg-card p-4">
            <p className="mb-3 text-[13px] text-muted-foreground">This role is closed — it's no longer accepting applications.</p>
            {job.company_domain && (
                <Button asChild className="h-11 w-full gap-2 rounded-none bg-brand text-brand-foreground text-xs font-bold uppercase tracking-wider hover:bg-brand/90">
                    <Link href={buildCompanyJobsUrl({ domain: job.company_domain.trim() })}>See open roles at {companyBrand || cleanedCompany} →</Link>
                </Button>
            )}
        </div>
    ) : (
        <div data-testid="job-detail-apply-card" className="border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
                {job.apply_url && (
                    <Button onClick={onOpenPosting} className="h-10 flex-1 gap-2 rounded-none bg-brand text-brand-foreground text-xs font-bold uppercase tracking-wider hover:bg-brand/90">
                        <ArrowSquareOut size={16} />
                        {signedIn ? "Apply on Company Site" : "Sign in to apply"}
                    </Button>
                )}
                {pursuit ? (
                    <Link href={`/yours/${pursuit.id}`} className="glass-tint-emerald inline-flex h-10 items-center gap-1.5 rounded-none px-4 text-xs font-bold uppercase tracking-wider">
                        <Check size={16} weight="bold" />
                        Saved
                    </Link>
                ) : (
                    <Button variant="outline" onClick={onGoAfter} disabled={goingAfter} className="h-10 gap-2 rounded-none px-4 text-xs font-bold uppercase tracking-wider">
                        <BookmarkSimple size={16} />
                        {goingAfter ? "Saving…" : "Save"}
                    </Button>
                )}
            </div>
            {reportJobEnabled && job.apply_url && (
                <ReportJobButton jobUrl={job.apply_url} jobTitle={job.title} onRequireAuth={() => onRequestSignIn?.()} className="mt-2" />
            )}
        </div>
    );

    const receiptEl = <Receipt job={job} now={now} />;

    const postingEl = (
        <div data-testid="job-detail-posting" className="border border-border bg-card p-5 sm:p-6">
            <div className="mb-3 text-[13px] font-semibold text-foreground">About this role</div>
            {blocks.length > 0 ? (
                <JobDescription blocks={blocks} />
            ) : (
                <p className="text-[13.5px] text-muted-foreground">
                    No description was captured for this role.{" "}
                    {job.apply_url ? "Use Apply to read the full details on the employer's site." : "Try the original posting for full details."}
                </p>
            )}
            {job.tags && job.tags.length > 0 && (
                <div className="mt-5 border-t border-border/70 pt-4">
                    <div className="mb-2.5 text-[13px] font-semibold text-foreground">Keywords from the posting</div>
                    <div className="flex flex-wrap gap-2">
                        {job.tags.slice(0, 16).map((tag) => (
                            <span key={tag} className="mono-data rounded-md border border-slate-300 bg-slate-100/90 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {decodeText(tag)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    const employerCardEl = <EmployerCard job={job} companyBrand={companyBrand} cleanedCompany={cleanedCompany ?? ""} />;

    const aiBoxEl = (
        <McpHandoffNote
            job={{
                id: job.id,
                title: decodeText(job.title),
                company: companyBrand || job.company || "Unknown company",
                location: locationText(job) || null,
            }}
        />
    );

    const relatedEl = related.length > 0 && (
        <div data-testid="job-detail-related">
            <div className="mono-data mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">More like this</div>
            <div className="flex flex-col gap-1.5">
                {related.map((r) => (
                    <RelatedJobRow key={r.id} job={r} now={now} onClick={() => onOpenRelated?.(r.id, r)} />
                ))}
            </div>
        </div>
    );

    // Closed postings: "more like this" moves ahead of the (now purely
    // reference) posting text — see spec annotation #10. Open postings keep
    // the ordinary reading order (apply → check → posting → employer → ai →
    // related).
    return (
        <div data-testid="job-detail-document">
            {/* Mobile / tablet: single column, spec reading order. */}
            <div className="flex flex-col gap-4 lg:hidden">
                {heroEl}
                {applyCardEl}
                {receiptEl}
                {closed && relatedEl}
                {postingEl}
                {employerCardEl}
                {aiBoxEl}
                {!closed && relatedEl}
            </div>

            {/* Desktop: two-column document, rail sticky. */}
            <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
                <div className="flex min-w-0 flex-col gap-4">
                    {heroEl}
                    {closed && relatedEl}
                    {postingEl}
                    {!closed && relatedEl}
                </div>
                <div className="sticky top-6 flex flex-col gap-4">
                    {applyCardEl}
                    {receiptEl}
                    {employerCardEl}
                    {aiBoxEl}
                </div>
            </div>
        </div>
    );
}
