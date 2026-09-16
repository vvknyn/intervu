"use client";

import { useMemo } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { JobDescription } from "@/components/jobs/JobDetail";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { chipVariants } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { displayCompanyBrand, locationText, placeWithWorkMode } from "@/lib/jobs/presentation";
import { inferReasons } from "@/lib/jobs/for-you/infer-reasons";
import { descriptionPaneState } from "@/lib/jobs/for-you/description-pane-state";
import { splitPackSections } from "@/lib/jobs/for-you/pack-sections";
import { MATCH_CHIP_BRAND_THRESHOLD, type MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

export interface ForYouPackProps {
    job: PublicJob;
    hydratedJob?: PublicJob | null;
    descriptionPending?: boolean;
    matchScore: MatchScore | null;
    resume: ResumeData | null;
    nowMs: number;
    className?: string;
}

/**
 * ONE micro-label treatment for every section heading in this pack (kicker
 * above the title, "Fit breakdown" / "What we inferred" / description
 * subheads) — a single quiet-caps class instead of each spot picking its
 * own size/weight, reused verbatim from the house convention
 * (BoardComparisonTable.tsx, careers hub page).
 */
const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";

/** Employer-stated fact — quiet/neutral, same chip primitive everywhere. */
const STATED_CHIP_CLASS = cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs");

/**
 * Product-derived/inferred chip — reuses the chip primitive's own "active"
 * treatment (brand blade + tinted fill) so a computed inference is visually
 * distinct from an employer-stated fact, not just a different text color.
 */
const DERIVED_CHIP_CLASS = cn(chipVariants({ active: true }), "h-7 px-2.5 text-xs");

/**
 * The card's headline number: big total + bar, brand tone once the score
 * clears the same threshold the SERP row's Fit chip uses (no new
 * red/amber semantics — at/above brand, below neutral). Lives in the
 * sticky header; the aside's `FitBreakdown` covers the per-component
 * detail below and does not repeat this total.
 */
function FitReadout({ score, strong }: { score: MatchScore; strong: boolean }) {
    return (
        <div className="shrink-0 text-right">
            <p className={SECTION_LABEL}>Fit</p>
            <p
                className={cn(
                    "text-title-sm font-semibold tabular-nums",
                    strong ? "text-brand" : "text-foreground",
                )}
            >
                {score.total}
            </p>
            <ProgressBar progress={score.total} className="mt-1 w-16" />
        </div>
    );
}

/** Per-component detail only — the total lives once, in the header's
 *  `FitReadout`, so this does not repeat it. */
function FitBreakdown({ score }: { score: MatchScore }) {
    return (
        <div>
            <p className={SECTION_LABEL}>Fit breakdown</p>
            <div className="mt-3 space-y-3">
                {score.components.map((component) => (
                    <div key={component.key}>
                        <p className="text-sm font-semibold text-foreground">{component.label}</p>
                        <ProgressBar progress={component.score * 100} className="mt-1" />
                        <p className="mt-1 text-xs text-muted-foreground">{component.detail}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ForYouPack({
    job,
    hydratedJob,
    descriptionPending,
    matchScore,
    resume,
    nowMs,
    className,
}: ForYouPackProps) {
    const displayJob = hydratedJob ?? job;
    const reasons = useMemo(() => inferReasons(job, matchScore, resume), [job, matchScore, resume]);

    const freshness = useMemo(
        () => classifyPostingFreshness(displayJob, nowMs),
        [displayJob, nowMs],
    );
    const postedRelative = freshness.postedMs
        ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), nowMs)
        : null;
    const firstSeenRelative =
        freshness.firstSeenMs != null
            ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), nowMs)
            : null;
    const factChips = useMemo(
        () => buildFactChips(displayJob, postedRelative, firstSeenRelative),
        [displayJob, postedRelative, firstSeenRelative],
    );

    const sections = useMemo(
        () => splitPackSections(displayJob.description),
        [displayJob.description],
    );

    const company = displayCompanyBrand(displayJob.company, displayJob.company_domain, displayJob.title);
    const place = placeWithWorkMode(locationText(displayJob), displayJob.work_type);
    const strongFit = matchScore != null && matchScore.total >= MATCH_CHIP_BRAND_THRESHOLD;
    const paneState = descriptionPaneState(descriptionPending, sections);
    const hasAside = matchScore != null || reasons.bullets.length > 0 || reasons.chips.length > 0;

    return (
        <div
            data-testid="for-you-pack"
            className={cn(
                "flex h-full max-h-full min-h-0 flex-col overflow-hidden border border-border bg-card",
                className,
            )}
        >
            <div
                data-pack-scroll
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
            >
                <div className="sticky top-0 z-10 border-b border-border bg-muted p-4 lg:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                            <CompanyLogo domain={displayJob.company_domain} name={displayJob.company} size="sm" />
                            <div className="min-w-0">
                                <p className={SECTION_LABEL}>{company}</p>
                                <h2 className="text-title-sm font-semibold text-foreground lg:text-title">
                                    {displayJob.title}
                                </h2>
                                {place && <p className="mt-0.5 text-sm text-muted-foreground">{place}</p>}
                            </div>
                        </div>
                        {matchScore && <FitReadout score={matchScore} strong={strongFit} />}
                    </div>
                    {factChips.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {factChips.map((chip) => {
                                const Icon = FACT_CHIP_ICON[chip.kind];
                                return (
                                    <span key={chip.kind} className={cn(STATED_CHIP_CLASS, "gap-1.5")}>
                                        {Icon && (
                                            <Icon size={14} weight="bold" className="shrink-0" aria-hidden />
                                        )}
                                        {chip.label}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className={cn("grid gap-6 p-4 lg:p-6", hasAside && "lg:grid-cols-[1fr_280px]")}>
                    <div className="min-w-0">
                        {paneState === "loading" ? (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                <CircleNotch size={16} className="animate-spin" aria-hidden />
                                Loading description…
                            </p>
                        ) : paneState === "empty" ? (
                            <p className="text-sm text-muted-foreground">
                                No description available for this role.
                            </p>
                        ) : (
                            <div className="space-y-6">
                                {sections.about.length > 0 && (
                                    <section>
                                        <h4 className={cn(SECTION_LABEL, "mb-2")}>About</h4>
                                        <JobDescription blocks={sections.about} headingLevel={4} />
                                    </section>
                                )}
                                {sections.responsibilities.length > 0 && (
                                    <section>
                                        <h4 className={cn(SECTION_LABEL, "mb-2")}>Responsibilities</h4>
                                        <JobDescription blocks={sections.responsibilities} headingLevel={4} />
                                    </section>
                                )}
                                {sections.requirements.length > 0 && (
                                    <section>
                                        <h4 className={cn(SECTION_LABEL, "mb-2")}>Requirements</h4>
                                        <JobDescription blocks={sections.requirements} headingLevel={4} />
                                    </section>
                                )}
                            </div>
                        )}
                    </div>

                    {hasAside && (
                        <aside className="min-w-0 space-y-6 border border-border bg-muted p-4">
                            {matchScore && <FitBreakdown score={matchScore} />}
                            {(reasons.bullets.length > 0 || reasons.chips.length > 0) && (
                                <div>
                                    <h3 className={SECTION_LABEL}>What we inferred</h3>
                                    {reasons.bullets.length > 0 && (
                                        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-foreground">
                                            {reasons.bullets.map((bullet) => (
                                                <li key={bullet}>{bullet}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {reasons.chips.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {reasons.chips.map((chip) => (
                                                <span key={chip} className={DERIVED_CHIP_CLASS}>
                                                    {chip}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </aside>
                    )}
                </div>
            </div>
        </div>
    );
}
