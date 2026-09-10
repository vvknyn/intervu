"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowSquareOut, MapPin } from "@phosphor-icons/react";
import { getCompanyRailAction, getRelatedJobsAction } from "@/actions/jobs";
import { Button } from "@/components/ui/button";
import { ContextHelp } from "@/components/ui/context-help";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { JobDescription, JobDetailActionBar, MetaLine, PostingCheckHeader, PostingCheckSignalsGrid, RelatedJobRow } from "@/components/jobs/JobDetail";
import { MatchChip } from "@/components/jobs/MatchChip";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { DotSeparated } from "@/components/ui/dot-separated";
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
    salaryText,
    titleCaseDisplay,
} from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { STATUS_PILL, LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
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

    // Rulebook item g: keep the content, render on page bg with a hairline
    // top divider instead of a bordered/bg panel; name 16/22 600 ink,
    // numbers 20/28 600 ink, captions 14/20 secondary, links as plain Klein
    // text with no forced underline decoration.
    return (
        <div data-testid="job-detail-employer-card" className="border-t border-border py-6">
            <h2 className="text-base font-semibold text-foreground">
                {companyBrand || "This company"}
            </h2>
            {rail?.aboutLine && <p className="mt-2 max-w-[640px] text-sm leading-relaxed text-muted-foreground">{rail.aboutLine}</p>}
            {(showOpenCount || hasTrackRecord) && (
                <div className="mt-4 flex flex-wrap gap-4">
                    {showOpenCount && openCount && (
                        <div className="min-w-[90px]">
                            <div className="text-xl font-semibold tabular-nums text-foreground">
                                {openCountText({ openCount: openCount.value, openCountIsLowerBound: openCount.isLowerBound })}
                            </div>
                            <div className="mono-data mt-0.5 text-sm text-muted-foreground">
                                Live roles
                            </div>
                        </div>
                    )}
                    {typeof job.company_opened_90d === "number" && typeof job.company_closed_90d === "number" && (
                        <div className="min-w-[110px]">
                            <div className="text-xl font-semibold tabular-nums text-foreground">
                                {job.company_opened_90d.toLocaleString()}/{job.company_closed_90d.toLocaleString()}
                            </div>
                            <div className="mono-data mt-0.5 text-sm text-muted-foreground">
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
                    className="mt-4 inline-block text-sm text-brand hover:underline"
                >
                    All jobs at {companyBrand || cleanedCompany}
                </Link>
            )}
        </div>
    );
}

/**
 * The posting-check ledger, restyled as a receipt (spec Section 2, `.receipt`
 * grammar) — same derivation as JobDetail.tsx's glass-panel ghost module
 * (`deriveGhostSignals`/`assessedGhostSignals`/`ghostCheckedText`, all pure,
 * unchanged), a different box. The verdict reuses `ghost.cls`'s `text-*`
 * class (STATUS_PILL, via `ghostBadgeTone`) rather than `Badge
 * variant="verdict-*"` — that variant set only covers two of the three real
 * ghost states (good/caution; there is no "verdict-bad"), and STATUS_PILL is
 * already the one map with all three (offer/intv/closed) wired to dark mode.
 * Introducing a second, narrower status system for this word would be the
 * drift `lib/ui/status-tokens.ts`'s own doc comment describes fixing.
 * Rendered as a plain colored WORD, not the bordered/soft-bg pill `ghost.cls`
 * also carries — same rulebook call, same idiom, as JobDetail.tsx's own
 * verdict line (see its doc comment there).
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

    // Rulebook item e: plain flowing text, no card/panel and no segmented
    // progress bar — the ratio and per-signal rows carry the same facts as
    // sentence-case text instead.
    return (
        <div data-testid="job-detail-receipt" className="border-t border-border py-6">
            <PostingCheckHeader
                favorableCount={favorableCount}
                assessedCount={assessed.length}
                unknownCount={unknownCount}
                verdictLabel={ghost.label}
                verdictClassName={ghost.cls.split(" ").find((c) => c.startsWith("text-")) ?? ""}
                headingLevel={2}
                checkedText={checkedText}
            />
            {signals.length > 0 && (
                <PostingCheckSignalsGrid>
                    {signals.map((s) => {
                        const relistCaution = s.kind === "freshness" && freshness.kind === "relisted";
                        return (
                            <div key={s.text} className="flex items-start gap-2">
                                {/* "not tracked" (unknown) renders no glyph at all
                                    (rulebook item e) — the ratio above already
                                    states it as "N not tracked". */}
                                <span
                                    className={cn(
                                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-sm font-semibold",
                                        relistCaution ? LISTING_STATE_TEXT.relisted : s.status === "favorable" ? "text-live" : "text-muted-foreground",
                                    )}
                                    aria-hidden={s.status !== "unknown"}
                                >
                                    {relistCaution ? "!" : s.status === "favorable" ? "✓" : s.status === "unfavorable" ? "—" : null}
                                </span>
                                <div className="min-w-0 flex-1 leading-snug">
                                    {/* `s.kind` (job-detail-facts.ts) is always
                                        lowercase — sentence case applied here at
                                        the render call site, same as JobDetail.tsx. */}
                                    <b className="mr-2 text-sm font-semibold capitalize text-foreground">{s.kind}</b>
                                    <span className={cn("text-sm", relistCaution ? LISTING_STATE_TEXT.relisted : "text-muted-foreground")}>{s.text}</span>
                                </div>
                            </div>
                        );
                    })}
                </PostingCheckSignalsGrid>
            )}
            {exposureBadges.length > 0 && (
                <div className="mono-data mt-3 text-xs text-muted-foreground">
                    <DotSeparated items={exposureBadges.map((b) => b.label)} />
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
    // Meta-line ordering (rulebook item a: "location · work mode · level ·
    // pay · posted · first seen") — same preSalary/postSalary split as
    // JobDetail.tsx's SERP panel, so the two "job detail column" surfaces
    // read identically.
    const nonSalaryChips = chips.filter((c) => c.kind !== "salary");
    const preSalaryChips = nonSalaryChips.filter((c) => c.kind !== "posted" && c.kind !== "first_seen");
    const postSalaryChips = nonSalaryChips.filter((c) => c.kind === "posted" || c.kind === "first_seen");
    const salary = salaryText(job);
    const cleanedCompany = displayCompany(job.company, job.company_domain);
    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);
    const jobTitle = titleCaseDisplay(decodeText(job.title));
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
        <div className="pb-6">
            <div className="flex items-start gap-4">
                <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-semibold leading-snug text-foreground sm:text-2xl">{jobTitle}</h1>
                    {matchScore && (
                        <div className="mt-2">
                            <MatchChip score={matchScore} asOfDate={matchAsOfDate} jobId={job.id} />
                        </div>
                    )}
                    <div className="mt-2 text-sm text-muted-foreground">
                        {cleanedCompany ? (
                            <Link href={jobCompanyHref(cleanedCompany, job.company_domain)} className="font-semibold text-foreground hover:underline">
                                {companyBrand}
                            </Link>
                        ) : (
                            "Unknown company"
                        )}
                        {/* Rulebook item b: at most one 16px pin as HIG prefix,
                            no flag emoji ahead of it. No "·" before it — the
                            pin already separates this from the company name
                            above, and a wrap at narrow widths otherwise
                            leaves a lone "·" dangling at the end of the
                            company line. */}
                        {" "}
                        <MapPin size={16} className="mr-0.5 inline-block align-[-1px] text-muted-foreground" aria-hidden />
                        {locationClamped ? (
                            <>
                                {(locationExpanded ? [...locationDisclosure.visible, ...locationDisclosure.hidden] : locationDisclosure.visible).map((segment, i) => (
                                    <span key={i} className="block">{segment}</span>
                                ))}
                                <button type="button" onClick={() => setLocationExpanded((v) => !v)} className="mt-0.5 block text-xs text-brand hover:underline">
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
                // Status reads as a plain colored WORD, not a bordered/bg pill
                // (rulebook) — each part already carries its own tone via
                // `part.className` (row-exception.ts).
                <div className="mt-4 text-xs font-semibold">
                    <ContextHelp content={exceptionMark.explain} side="right">
                        <DotSeparated
                            items={exceptionMark.parts.map((part) => (
                                <span className={part.className}>{part.text}</span>
                            ))}
                        />
                    </ContextHelp>
                </div>
            )}

            {/* Meta line (rulebook item a): every fact as flowing text joined
                by the shared `MetaLine` "· " seam (JobDetail.tsx), no
                per-fact icon or box. */}
            <div className="mt-3 flex flex-wrap items-baseline text-sm text-muted-foreground">
                <MetaLine
                    items={[
                        ...preSalaryChips.map((c) => <span key={c.kind}>{c.label}</span>),
                        salary && (
                            <span data-tour="jobs-pay" className="font-semibold text-foreground">
                                {salary}
                            </span>
                        ),
                        ...postSalaryChips.map((c) => {
                            const caution = c.kind === "posted" && freshness.kind === "relisted";
                            return (
                                <span key={c.kind} className={caution ? LISTING_STATE_TEXT.relisted : undefined}>
                                    {c.label}
                                </span>
                            );
                        }),
                    ]}
                />
            </div>

            {job.must_have_skills && job.must_have_skills.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                    {/* Rulebook item c's pattern applied to this chip list too:
                        a sentence-case label + one flowing secondary line, no
                        bordered chips. */}
                    <div className="mb-1 text-sm font-semibold text-foreground">Must-have skills</div>
                    <div className="mono-data text-sm text-muted-foreground">
                        {job.must_have_skills.slice(0, 12).map(decodeText).join(" · ")}
                    </div>
                </div>
            )}
        </div>
    );

    const applyCardEl = closed ? (
        <div data-testid="job-detail-apply-card" className="border-t border-border py-4">
            <p className="mb-3 text-sm text-muted-foreground">This role is closed — it&apos;s no longer accepting applications.</p>
            {job.company_domain && (
                <Button asChild className="h-11 w-full gap-2 rounded-none bg-brand text-brand-foreground text-xs font-semibold hover:bg-brand">
                    <Link href={buildCompanyJobsUrl({ domain: job.company_domain.trim() })}>See open roles at {companyBrand || cleanedCompany}</Link>
                </Button>
            )}
        </div>
    ) : (
        <div
            data-testid="job-detail-apply-card"
            className={cn(
                "border-t border-border py-4",
                // Below `lg` the inline pair below is hidden (the sticky
                // `JobDetailActionBar` mounted at the foot of the mobile
                // stack is the one filled button + bookmark for that
                // viewport, so the viewport never shows two filled buttons
                // at once) and the report button is the only thing this
                // card can show there — hide the WRAPPER itself (border +
                // padding included) whenever that won't render either, or
                // mobile gets a hairline-and-padding "dead" gap between
                // Must-have skills and Posting check with nothing inside it.
                !(reportJobEnabled && job.apply_url) && "hidden lg:block",
            )}
        >
            <div className="hidden items-center gap-2 lg:flex">
                {job.apply_url && (
                    <Button onClick={onOpenPosting} className="h-10 flex-1 gap-2 rounded-none bg-brand text-brand-foreground text-xs font-semibold hover:bg-brand">
                        <ArrowSquareOut size={16} />
                        {signedIn ? "Apply on Company Site" : "Sign in to apply"}
                    </Button>
                )}
                {/* Rulebook item f: Save outline → the same 40px icon-only
                    ghost bookmark control every other surface (JobDetail's
                    action row, JobCard's row) already uses — one chokepoint,
                    no independent restyle. */}
                <RowBookmarkButton pursuit={pursuit} onGoAfter={onGoAfter} goingAfter={goingAfter} />
            </div>
            {reportJobEnabled && job.apply_url && (
                <ReportJobButton jobUrl={job.apply_url} jobTitle={jobTitle} onRequireAuth={() => onRequestSignIn?.()} className="mt-2" />
            )}
        </div>
    );

    const receiptEl = <Receipt job={job} now={now} />;

    const postingEl = (
        <div data-testid="job-detail-posting" className="border-t border-border py-6">
            <h2 className="mb-2 text-sm font-semibold text-foreground">About this role</h2>
            {blocks.length > 0 ? (
                <div className="max-w-[640px]">
                    <JobDescription blocks={blocks} headingLevel={3} />
                </div>
            ) : (
                <p className="max-w-[640px] text-base leading-normal text-foreground">
                    No description was captured for this role.{" "}
                    {job.apply_url ? "Use Apply to read the full details on the employer's site." : "Try the original posting for full details."}
                </p>
            )}
            {job.tags && job.tags.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                    {/* Rulebook item c: label + one flowing secondary line, no
                        bordered chips. */}
                    <div className="mb-1 text-sm font-semibold text-foreground">Keywords from the posting</div>
                    <div className="mono-data text-sm text-muted-foreground">
                        {job.tags.slice(0, 16).map(decodeText).join(" · ")}
                    </div>
                </div>
            )}
        </div>
    );

    const employerCardEl = <EmployerCard job={job} companyBrand={companyBrand} cleanedCompany={cleanedCompany ?? ""} />;

    const aiBoxEl = (
        <div className="border-t border-border py-6">
            {/* Rulebook item f: exactly one filled Klein button per region —
                Apply above is it, so this CTA reads as plain Klein text, no
                fill/border. Same call-site override as JobDetail.tsx's SERP
                panel (see its doc comment); the shared component and its
                other mount are left alone. */}
            <McpHandoffNote
                className="border-0 bg-transparent p-0 [&_button.bg-brand]:!border-0 [&_button.bg-brand]:!bg-transparent [&_button.bg-brand]:!px-0 [&_button.bg-brand]:!text-brand [&_button.bg-brand]:hover:!bg-transparent [&_button.bg-brand]:hover:!underline"
                job={{
                    id: job.id,
                    title: jobTitle,
                    company: companyBrand || job.company || "Unknown company",
                    location: locationText(job) || null,
                }}
            />
        </div>
    );

    const relatedEl = related.length > 0 && (
        <div data-testid="job-detail-related" className="border-t border-border py-6">
            <h2 className="mb-2 text-sm font-semibold text-foreground">More like this</h2>
            {/* Rulebook item h: rows separated only by a hairline, not
                bordered cards — RelatedJobRow itself carries no border now
                (see JobDetail.tsx), so this wrapper supplies the dividers. */}
            <div className="divide-y divide-border">
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
            {/* Single render, CSS-only reordering: below `lg`, `max-lg:contents`
                on both wrappers unwraps them so their children become direct
                items of this flex column, ordered by each block's own
                `max-lg:order-*` (mobile reading order below); at `lg`+ this
                becomes the real two-column grid (content + sticky rail) and
                the wrappers govern layout again. Every block mounts exactly
                once — previously the mobile stack and desktop grid each
                mounted the same elements, doubling every effect and the
                served HTML, including the page heading. */}
            <div className={cn("flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6", !closed && "max-lg:pb-12")}>
                <div className="flex min-w-0 flex-col max-lg:contents">
                    <div className="max-lg:order-1">{heroEl}</div>
                    {closed && <div className="max-lg:order-4">{relatedEl}</div>}
                    <div className="max-lg:order-5">{postingEl}</div>
                    {!closed && <div className="max-lg:order-8">{relatedEl}</div>}
                </div>
                <div className="flex flex-col max-lg:contents lg:sticky lg:top-6">
                    <div className="max-lg:order-2">{applyCardEl}</div>
                    <div className="max-lg:order-3">{receiptEl}</div>
                    <div className="max-lg:order-6">{employerCardEl}</div>
                    <div className="max-lg:order-7">{aiBoxEl}</div>
                </div>
            </div>

            {/* Sticky mobile action bar (rulebook "sticky mobile action
                bar"): the same chokepoint the SERP Sheet's mobile detail
                already mounts (JobDetail.tsx doc comment), stacked
                `bottom-12` — above the sitewide `MobileTabBar`'s 48px
                base height — since this document scrolls the real page,
                unlike the Sheet's own `overflow-y-auto` container that
                paints over the tab bar. `max-lg:pb-12` above gives the last
                in-flow content the same clearance so nothing sits under
                either bar at full scroll. Closed jobs keep their own
                "See open roles" card inline — this bar doesn't model
                that state. It's fixed-position, so its place in the DOM
                (after, not inside, the reordered column) doesn't affect
                layout; `lg:hidden` since the rail's apply card covers this
                surface at `lg`+. */}
            {!closed && (
                <JobDetailActionBar
                    job={job}
                    signedIn={signedIn}
                    onOpenPosting={onOpenPosting}
                    onGoAfter={onGoAfter}
                    pursuit={pursuit}
                    goingAfter={goingAfter}
                    className="bottom-12 lg:hidden"
                />
            )}
        </div>
    );
}
