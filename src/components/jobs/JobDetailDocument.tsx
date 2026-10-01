"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowSquareOut, Check, MapPin, Minus, Warning } from "@phosphor-icons/react";
import { getCompanyRailAction } from "@/actions/jobs";
import { Button } from "@/components/ui/button";
import { jobActionSize } from "@/lib/jobs/toolbar-control-height";
import { ContextHelp } from "@/components/ui/context-help";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { FormattedJobDescription } from "@/components/jobs/JobDescription";
import { fetchRelatedJobs, JobDetailActionBar, KpiStat, MetaLine, NO_RELATED, PostingCheckHeader, PostingCheckSignalsGrid, RelatedJobsSection, type RelatedJobs } from "@/components/jobs/JobDetail";
import { MatchChip } from "@/components/jobs/MatchChip";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { TrackedStageLine } from "@/components/jobs/TrackedStageLine";
import { DotSeparated } from "@/components/ui/dot-separated";
import type { MatchScore } from "@/lib/match/score";
import { type EventSource } from "@/lib/analytics/events";
import { useJobViewedCapture } from "@/lib/analytics/use-job-viewed-capture";
import { ReportJobButton } from "@/components/jobs/ReportJobButton";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import {
    APPLY_BUTTON_LABEL,
    assessedGhostSignals,
    buildFactChips,
    deriveExposureBadges,
    deriveGhostSignals,
    ghostCheckedText,
    jobTrackRecord,
    pairedKpiChips,
} from "@/components/jobs/job-detail-facts";
import { shouldSuppressOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { buildCompanyJobsUrl, openCountText } from "@/lib/companies/presentation";
import { jobCompanyHref } from "@/lib/companies/paths";
import { formatDescription } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { relatedSeed } from "@/lib/jobs/related-jobs";
import {
    clampLocationSegments,
    decodeText,
    displayCompany,
    displayCompanyBrand,
    evidencedSkills,
    ghostMetaFor,
    locationText,
    salaryText,
    titleCaseDisplay,
    visibleTags,
} from "@/lib/jobs/presentation";
import { rowExceptionMark } from "@/lib/jobs/row-exception";
import { STATUS_PILL, LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";
import { LocalCustomizePanel } from "@/components/jobs/LocalCustomizePanel";
import { UPLOAD_TO_CUSTOMIZE_LABEL } from "@/lib/jobs/resume-cta-copy";
import type { ResumeData } from "@/types/resume";
import { PageTitle } from "@/components/ui/heading";

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
    const trackRecord = jobTrackRecord(job);

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
            {(showOpenCount || trackRecord != null) && (
                <div className="mt-4 flex flex-wrap gap-4">
                    {showOpenCount && openCount && (
                        <KpiStat
                            value={openCountText({ openCount: openCount.value, openCountIsLowerBound: openCount.isLowerBound })}
                            label="Live roles"
                            minWidthClassName="min-w-[90px]"
                        />
                    )}
                    {trackRecord &&
                        pairedKpiChips(trackRecord).map((chip) => (
                            <KpiStat key={chip.label} value={chip.value} label={chip.label} minWidthClassName="min-w-[110px]" />
                        ))}
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
 * Detail that folds behind "Show details" below `lg` and is always shown at
 * `lg`+. Not a native <details>: a closed one hides its content whatever the
 * children's CSS says, so the old `lg:!block` never showed the keywords or the
 * check rows on desktop (2026-09-30).
 */
function MobileDisclosure({ className, children }: { className?: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
        <div className={className}>
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="text-xs text-brand hover:underline lg:hidden">
                {open ? "Hide details" : "Show details"}
            </button>
            <div id={id} className={cn(open ? "block" : "hidden", "lg:block")}>
                {children}
            </div>
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
                // Progressive disclosure below `lg`: the verdict line above is
                // always visible, but the per-signal rows are detail, not the
                // headline, so they fold on a phone and show on desktop.
                <MobileDisclosure className="mt-1">
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
                                        {relistCaution ? (
                                            <Warning size={14} weight="bold" />
                                        ) : s.status === "favorable" ? (
                                            <Check size={14} weight="bold" />
                                        ) : s.status === "unfavorable" ? (
                                            <Minus size={14} weight="bold" />
                                        ) : null}
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
                </MobileDisclosure>
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
    saveSuccessPulse?: boolean;
    signedIn?: boolean;
    reportJobEnabled?: boolean;
    /** `scoreJobAgainstResume`'s output for this job, or `null` when there's
     *  no signed-in résumé or no comparable field — renders no chip, never a
     *  fabricated 0 (Rule 3, match-contract.md). Same value the SERP panel
     *  (`JobDetail`) and `sort=fit` read, computed once by `PublicJobDetail`. */
    matchScore?: MatchScore | null;
    /** The résumé's stored update date, pre-formatted (`shortDate(...).toLowerCase()`). */
    matchAsOfDate?: string | null;
    /** When true, defer `job_viewed` until auth + résumé reads settle (PublicJobDetail). */
    matchPending?: boolean;
    /** Local-AI résumé for on-device tailor — optional. */
    resume?: ResumeData | null;
    onUploadResume?: () => void;
    onSignInToSync?: () => void;
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
    saveSuccessPulse = false,
    signedIn = true,
    reportJobEnabled = false,
    matchScore = null,
    matchAsOfDate = null,
    matchPending = false,
    resume = null,
    onUploadResume,
    onSignInToSync,
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

    useJobViewedCapture({ job, source, signedIn, matchPending, matchScore, resume });

    const [related, setRelated] = useState<RelatedJobs>(NO_RELATED);
    // A string key, not the job object — see JobDetail.tsx.
    const relatedKey = JSON.stringify(relatedSeed(job));
    useEffect(() => {
        let cancelled = false;
        setRelated(NO_RELATED);
        // Ungated by `signedIn` — unlike the SERP panel's related fetch, this
        // is a standalone page with no modal to gate behind sign-in; the
        // page's own live open-count query (EmployerCard above) already
        // serves anonymous visitors the same company-scoped data with no
        // gate, so gating this one query type differently on this page would
        // be arbitrary rather than a real access boundary.
        fetchRelatedJobs(relatedKey)
            .then((data) => {
                if (!cancelled) setRelated(data);
            })
            .catch(() => {
                /* "More like this" is an accelerant, not a source of error */
            });
        return () => {
            cancelled = true;
        };
    }, [relatedKey]);

    const heroEl = (
        <div className="pb-6">
            <div className="flex items-start gap-4">
                <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                <div className="min-w-0 flex-1">
                    <PageTitle>{jobTitle}</PageTitle>
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
                                    <span key={i} className="block" data-testid="job-location">{segment}</span>
                                ))}
                                <button type="button" onClick={() => setLocationExpanded((v) => !v)} className="mt-0.5 block text-xs text-brand hover:underline">
                                    {locationExpanded ? "Show less" : `+ ${locationDisclosure.hidden.length} more locations`}
                                </button>
                            </>
                        ) : (
                            <span data-testid="job-location">{location}</span>
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

            <TrackedStageLine pursuit={pursuit} nowMs={now} className="mt-3" />

            {visibleTags(evidencedSkills(job, "must_have_skills"), 12).length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                    {/* Rulebook item c's pattern applied to this chip list too:
                        a sentence-case label + one flowing secondary line, no
                        bordered chips. */}
                    <div className="mb-1 text-sm font-semibold text-foreground">Must-have skills</div>
                    <div className="mono-data text-sm text-muted-foreground">
                        {visibleTags(evidencedSkills(job, "must_have_skills"), 12).join(" · ")}
                    </div>
                </div>
            )}
        </div>
    );

    // Customize (with a résumé) or Upload (without): full width on its own
    // row, since it doesn't fit beside Apply and Save in the 320px rail or in
    // a phone's sticky bar (both ran past their edge, 2026-09-30).
    const customizeEl = closed ? null : resume != null ? (
        <LocalCustomizePanel
            job={job}
            resume={resume}
            signedIn={signedIn}
            onSignInToSync={onSignInToSync}
        />
    ) : onUploadResume ? (
        <Button size={jobActionSize}
            type="button"
            variant="outline"
            data-testid="job-detail-upload-to-customize"
            onClick={onUploadResume}
            className="shrink-0"
        >
            {UPLOAD_TO_CUSTOMIZE_LABEL}
        </Button>
    ) : null;

    const applyCardEl = closed ? (
        <div data-testid="job-detail-apply-card" className="border-t border-border py-4">
            <p className="mb-3 text-sm text-muted-foreground">This role is closed — it&apos;s no longer accepting applications.</p>
            {job.company_domain && (
                <Button asChild className="w-full gap-2 bg-brand text-brand-foreground hover:bg-brand">
                    <Link href={buildCompanyJobsUrl({ domain: job.company_domain.trim() })}>See open roles at {companyBrand || cleanedCompany}</Link>
                </Button>
            )}
        </div>
    ) : (
        // Below `lg` only the Customize row shows here: the sticky
        // `JobDetailActionBar` at the foot of the mobile stack is the one
        // filled Apply button + bookmark for that viewport, so the viewport
        // never shows two filled buttons at once. With nothing to customize
        // the card is desktop-only. The report-listing control is its own
        // block (`reportControlEl` below) with its own mobile position.
        <div data-testid="job-detail-apply-card" className={cn("border-t border-border py-4", !customizeEl && "hidden lg:block")}>
            <div className="hidden items-center gap-2 lg:flex">
                {job.apply_url && (
                    <Button size={jobActionSize} onClick={onOpenPosting} className="flex-1 gap-2 bg-brand text-brand-foreground hover:bg-brand">
                        <ArrowSquareOut size={16} />
                        {APPLY_BUTTON_LABEL}
                    </Button>
                )}
                {/* Rulebook item f: Save outline → the same icon-only
                    ghost bookmark control every other surface (JobDetail's
                    action row, JobCard's row) already uses — one chokepoint,
                    no independent restyle. */}
                <RowBookmarkButton
                    pursuit={pursuit}
                    onGoAfter={onGoAfter}
                    successPulse={saveSuccessPulse}
                />
            </div>
            {/* A column so the trigger stretches to the card's width. */}
            {customizeEl && <div className="flex flex-col lg:mt-2">{customizeEl}</div>}
        </div>
    );

    const receiptEl = <Receipt job={job} now={now} />;

    // Report-listing control (F1: its own mobile step, near the end, after
    // the employer numbers) — split out of applyCardEl above so it can carry
    // an independent `max-lg:order-*` instead of being pinned to the apply
    // card's mobile position. Never rendered for a closed job (unchanged
    // from the prior nested placement, which only ever appeared in the
    // non-closed `applyCardEl` branch) or without a real posting URL to
    // report.
    const reportControlEl = !closed && reportJobEnabled && job.apply_url && (
        <div className="border-t border-border py-4">
            <ReportJobButton
                jobUrl={job.apply_url}
                jobTitle={jobTitle}
            />
        </div>
    );

    const postingEl = (
        <div data-testid="job-detail-posting" className="border-t border-border py-6">
            <h2 className="mb-2 text-sm font-semibold text-foreground">About this role</h2>
            {blocks.length > 0 ? (
                <div className="max-w-[640px]">
                    <FormattedJobDescription description={job.description} headingLevel={3} />
                </div>
            ) : (
                <p className="max-w-[640px] text-base leading-normal text-foreground">
                    No description was captured for this role.{" "}
                    {job.apply_url ? `Use ${APPLY_BUTTON_LABEL} to read the full details on the employer's site.` : "Try the original posting for full details."}
                </p>
            )}
            {visibleTags(job.tags, 16).length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                    {/* Rulebook item c: label + one flowing secondary line, no
                        bordered chips. Label stays visible; only the tag list
                        itself collapses below `lg` — same disclosure idiom as
                        the posting-check signal rows above (Receipt). */}
                    <div className="mb-1 text-sm font-semibold text-foreground">Keywords from the posting</div>
                    <MobileDisclosure>
                        <div data-testid="job-detail-keywords" className="mono-data text-sm text-muted-foreground">
                            {visibleTags(job.tags, 16).join(" · ")}
                        </div>
                    </MobileDisclosure>
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

    // Already deduped and self-excluded by `getRelatedJobsAction`; the block
    // itself is shared with the board's pane (JobDetail.tsx).
    const relatedEl = related.jobs.length > 0 && (
        <RelatedJobsSection
            jobs={related.jobs}
            basis={related.basis}
            companyBrand={companyBrand}
            now={now}
            linkToPages
            headingLevel="h2"
        />
    );

    // Mobile reading order (F1, <lg): title/company/location/posted → apply
    // card → description → posting check → employer numbers → report
    // control → More like this → AI handoff (not itself part of the spec'd
    // order — placed last, after every fact-bearing section). Desktop order
    // is unchanged (still plain source order below — no `lg:order-*`
    // overrides exist in this file): apply → posting check → employer →
    // report → AI, with the content column's posting/related sections
    // alongside in the left column.
    //
    // Closed postings keep their own special case: "more like this" moves
    // ahead of the (now purely reference) posting text — see spec annotation
    // #10 — so its mobile order sits right after the apply card, before
    // posting/receipt/employer.
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
                    {closed && <div className="max-lg:order-3">{relatedEl}</div>}
                    <div className="max-lg:order-4">{postingEl}</div>
                    {!closed && <div className="max-lg:order-8">{relatedEl}</div>}
                </div>
                <div className="flex flex-col max-lg:contents lg:sticky lg:top-6">
                    <div className="max-lg:order-2">{applyCardEl}</div>
                    <div className="max-lg:order-5">{receiptEl}</div>
                    <div className="max-lg:order-6">{employerCardEl}</div>
                    <div className="max-lg:order-7">{reportControlEl}</div>
                    <div className="max-lg:order-9">{aiBoxEl}</div>
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
                that state. It's `sticky` (base class in JobDetail.tsx),
                overridden here to `bottom-12`: it sticks 48px above the
                viewport bottom — above MobileTabBar — while the document
                is in view. Mounted after the padded two-column container,
                so its rest position at full scroll sits directly above
                the Footer, and that container's `max-lg:pb-12` is what
                keeps 48px of clearance between the last in-flow block and
                the bar. `lg:hidden` since the rail's apply card covers this
                surface at `lg`+. */}
            {!closed && (
                <JobDetailActionBar
                    job={job}
                    signedIn={signedIn}
                    onOpenPosting={onOpenPosting}
                    onGoAfter={onGoAfter}
                    pursuit={pursuit}
                    saveSuccessPulse={saveSuccessPulse}
                    className="bottom-12 lg:hidden"
                />
            )}
        </div>
    );
}
