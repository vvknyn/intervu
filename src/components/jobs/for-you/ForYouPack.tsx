"use client";

import { useMemo } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { JobDescription } from "@/components/jobs/JobDetail";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { chipVariants } from "@/components/ui/chip";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { displayCompanyBrand, locationText, prettyEnum } from "@/lib/jobs/presentation";
import { inferReasons } from "@/lib/jobs/for-you/infer-reasons";
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

function FitScoreMark({ score }: { score: MatchScore }) {
    const strong = score.total >= MATCH_CHIP_BRAND_THRESHOLD;
    return (
        <div
            className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums",
                strong ? "border-brand text-brand" : "border-border text-foreground",
            )}
            aria-label={`Fit score ${score.total}`}
        >
            {score.total}
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

    return (
        <div
            data-testid="for-you-pack"
            className={cn(
                "flex h-full max-h-full min-h-0 flex-col overflow-hidden border border-border bg-card lg:flex-row",
                className,
            )}
        >
            <div className="flex max-h-[40%] min-h-0 min-w-0 shrink-0 flex-col overflow-y-auto overscroll-contain border-b border-border p-4 custom-scrollbar lg:max-h-none lg:shrink lg:flex-1 lg:border-b-0 lg:border-r lg:p-6">
                <p className="text-xs font-semibold text-muted-foreground">
                    {company}
                </p>
                <h2 className="text-title mt-2 font-semibold text-foreground">{displayJob.title}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                    {loc && (
                        <span className={cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs")}>
                            {loc}
                        </span>
                    )}
                    {workType && (
                        <span className={cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs")}>
                            {workType}
                        </span>
                    )}
                    {employment && (
                        <span className={cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs")}>
                            {employment}
                        </span>
                    )}
                </div>

                {matchScore && (
                    <div className="mt-6 flex items-center gap-3">
                        <FitScoreMark score={matchScore} />
                        <div>
                            <p className="text-xs font-semibold text-foreground">Fit</p>
                            <p className="text-xs text-muted-foreground">
                                Inferred from your résumé against this listing.
                            </p>
                        </div>
                    </div>
                )}

                <div className="mt-6">
                    <h3 className="text-xs font-semibold text-foreground">What we inferred</h3>
                    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                        {reasons.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                        ))}
                    </ul>
                    {reasons.chips.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {reasons.chips.map((chip) => (
                                <span
                                    key={chip}
                                    className={cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs text-brand")}
                                >
                                    {chip}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 lg:p-6">
                <h3 className="shrink-0 text-xs font-semibold text-foreground">The position</h3>
                <div className="mt-2 flex shrink-0 flex-wrap gap-2">
                    {factChips.map((chip) => {
                        const Icon = FACT_CHIP_ICON[chip.kind];
                        return (
                            <span
                                key={chip.kind}
                                className={cn(chipVariants({ active: false }), "h-7 gap-1.5 px-2.5 text-xs")}
                            >
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
                    {descriptionPending && displayJob.description === undefined ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CircleNotch size={16} className="animate-spin" aria-hidden />
                            Loading description…
                        </p>
                    ) : sections.about.length + sections.responsibilities.length + sections.requirements.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No description available for this role.</p>
                    ) : (
                        <div className="space-y-6">
                            {sections.about.length > 0 && (
                                <section>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">About</h4>
                                    <JobDescription blocks={sections.about} headingLevel={4} />
                                </section>
                            )}
                            {sections.responsibilities.length > 0 && (
                                <section>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">Responsibilities</h4>
                                    <JobDescription blocks={sections.responsibilities} headingLevel={4} />
                                </section>
                            )}
                            {sections.requirements.length > 0 && (
                                <section>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">Requirements</h4>
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
