"use client";

import { useMemo } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { JobDescription } from "@/components/jobs/JobDetail";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { Badge } from "@/components/ui/badge";
import { chipVariants } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { displayCompanyBrand, locationText, prettyEnum } from "@/lib/jobs/presentation";
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
 * above the title, "Fit score" / "What we inferred" / "The position" /
 * description subheads) — a single quiet-caps class instead of each spot
 * picking its own size/weight, reused verbatim from the house convention
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

function FitBreakdown({ score, strong }: { score: MatchScore; strong: boolean }) {
    return (
        <div>
            <p className={SECTION_LABEL}>Fit score</p>
            <div className="mt-1 flex items-baseline gap-1">
                <span
                    className={cn(
                        "text-title-sm font-semibold tabular-nums",
                        strong ? "text-brand" : "text-foreground",
                    )}
                >
                    {score.total}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            <div className="mt-3 space-y-3">
                {score.components.map((component) => (
                    <div key={component.key}>
                        <p className="text-sm font-medium text-foreground">{component.label}</p>
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
    const loc = locationText(displayJob);
    const workType = prettyEnum(displayJob.work_type);
    const employment = prettyEnum(displayJob.employment_type);
    const strongFit = matchScore != null && matchScore.total >= MATCH_CHIP_BRAND_THRESHOLD;
    const paneState = descriptionPaneState(descriptionPending, sections);

    return (
        <div
            data-testid="for-you-pack"
            className={cn(
                "flex h-full max-h-full min-h-0 flex-col overflow-hidden border border-border bg-card lg:flex-row",
                className,
            )}
        >
            <div
                data-pack-meta-scroll
                className="flex max-h-[40%] min-h-0 min-w-0 shrink-0 flex-col overflow-y-auto overscroll-contain border-b border-border p-4 custom-scrollbar lg:max-h-none lg:shrink lg:flex-1 lg:border-b-0 lg:border-r lg:p-6"
            >
                {/*
                    Fit score total repeated here as a compact glance badge (Badge is
                    text-only, no container) so a 390px viewport — where the meta pane
                    is height-capped and the full Fit breakdown below can require a
                    scroll — still shows the number without it. The full breakdown
                    with per-component detail remains the single place that explains it.
                */}
                <div className="flex items-center justify-between gap-2">
                    <p className={SECTION_LABEL}>{company}</p>
                    {matchScore && (
                        <Badge variant={strongFit ? "brand" : "default"}>Fit {matchScore.total}</Badge>
                    )}
                </div>
                <h2 className="text-title mt-1 font-semibold text-foreground">{displayJob.title}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                    {loc && <span className={STATED_CHIP_CLASS}>{loc}</span>}
                    {workType && <span className={STATED_CHIP_CLASS}>{workType}</span>}
                    {employment && <span className={STATED_CHIP_CLASS}>{employment}</span>}
                </div>

                {matchScore && (
                    <div className="mt-6">
                        <FitBreakdown score={matchScore} strong={strongFit} />
                    </div>
                )}

                {(reasons.bullets.length > 0 || reasons.chips.length > 0) && (
                    <div className="mt-6">
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
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 lg:p-6">
                <h3 className={cn(SECTION_LABEL, "shrink-0")}>The position</h3>
                <div className="mt-2 flex shrink-0 flex-wrap gap-2">
                    {factChips.map((chip) => {
                        const Icon = FACT_CHIP_ICON[chip.kind];
                        return (
                            <span key={chip.kind} className={cn(STATED_CHIP_CLASS, "gap-1.5")}>
                                {Icon && <Icon size={14} weight="bold" className="shrink-0" aria-hidden />}
                                {chip.label}
                            </span>
                        );
                    })}
                </div>

                <div
                    data-pack-scroll
                    className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
                >
                    {paneState === "loading" ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CircleNotch size={16} className="animate-spin" aria-hidden />
                            Loading description…
                        </p>
                    ) : paneState === "empty" ? (
                        <p className="text-sm text-muted-foreground">No description available for this role.</p>
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
            </div>
        </div>
    );
}
