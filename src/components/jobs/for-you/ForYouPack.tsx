"use client";

import { useMemo } from "react";
import { JobDescription } from "@/components/jobs/JobDetail";
import { DescriptionLoadingStatus } from "@/components/jobs/for-you/DescriptionLoadingStatus";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { chipVariants } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useAiJobDescription } from "@/hooks/use-ai-job-description";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { displayCompanyBrand, locationText, placeWithWorkMode, stripRemoteSegmentsFromPlace } from "@/lib/jobs/presentation";
import { inferReasons, noScoreReason, NO_SCORE_MESSAGES, type NoScoreReason } from "@/lib/jobs/for-you/infer-reasons";
import { descriptionPaneState } from "@/lib/jobs/for-you/description-pane-state";
import { splitPackSections } from "@/lib/jobs/for-you/pack-sections";
import {
    JD_TEMPLATE_LABELS,
    JD_TEMPLATE_ORDER,
} from "@/lib/local-ai/format-job-description";
import { matchBand, matchBandLabel, type MatchScore } from "@/lib/match/score";
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
const SECTION_LABEL = "text-xs font-semibold text-muted-foreground";

/** JD column — the only inner scroller; capped so wheel events chain to the page at the ends. */
const JD_SCROLL_CLASS =
    "min-w-0 overflow-y-auto max-h-[min(60dvh,640px)] custom-scrollbar";

/** Employer-stated fact — quiet/neutral, same chip primitive everywhere. */
const STATED_CHIP_CLASS = cn(chipVariants({ active: false }), "h-7 px-2.5 text-xs");

/**
 * Product-derived/inferred chip — reuses the chip primitive's own "active"
 * treatment (brand blade + tinted fill) so a computed inference is visually
 * distinct from an employer-stated fact, not just a different text color.
 */
const DERIVED_CHIP_CLASS = cn(
    chipVariants({ active: true }),
    // Long inferred titles (e.g. "Technical Account Manager | …") must stay
    // inside the FIT column — override chip `shrink-0` / `whitespace-nowrap`.
    "h-auto min-h-7 max-w-full min-w-0 shrink whitespace-normal break-words px-2.5 py-1 text-xs",
);

/**
 * The card's headline fit label — Strong / Good / Stretch, brand tone for
 * Strong (same band the SERP row's MatchChip uses). Lives in the header;
 * the aside's `FitBreakdown` covers per-component detail below and does not
 * repeat this label.
 */
function FitReadout({ score, strong }: { score: MatchScore; strong: boolean }) {
    const label = matchBandLabel(matchBand(score.total));
    return (
        <div className="shrink-0 text-right">
            <p className={SECTION_LABEL}>Fit</p>
            <p
                className={cn(
                    "text-title-sm font-semibold",
                    strong ? "text-brand" : "text-foreground",
                )}
            >
                {label}
            </p>
        </div>
    );
}

/** Explicit stand-in for `FitReadout` when there is no fit score at all —
 *  never an omitted chip, always says why (no résumé text vs. no posting
 *  description to compare against). */
function NoScoreReadout({ reason }: { reason: NoScoreReason }) {
    return (
        <div className="shrink-0 max-w-[9rem] text-right">
            <p className={SECTION_LABEL}>Fit</p>
            <p className="mt-1 text-xs text-muted-foreground">{NO_SCORE_MESSAGES[reason]}</p>
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
                        <ProgressBar progress={component.score * 100} className="mt-1" radius="ctl" />
                        <p className="mt-1 text-xs text-muted-foreground">{component.detail}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Explicit stand-in for `FitBreakdown` when there is no fit score at all. */
function NoScoreBreakdown({ reason }: { reason: NoScoreReason }) {
    return (
        <div>
            <p className={SECTION_LABEL}>Fit breakdown</p>
            <p className="mt-2 text-sm text-muted-foreground">{NO_SCORE_MESSAGES[reason]}</p>
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

    // Pane loading/empty still keyed off the legacy pack split so hydration
    // semantics stay unchanged; the visible body uses the shared JD template
    // (deterministic immediately, on-device AI upgrade when enabled).
    const sections = useMemo(
        () => splitPackSections(displayJob.description),
        [displayJob.description],
    );
    const { template, enhancing } = useAiJobDescription(displayJob.id, displayJob.description);

    const company = displayCompanyBrand(displayJob.company, displayJob.company_domain, displayJob.title);
    const rawPlace = locationText(displayJob);
    const place =
        displayJob.work_type === "remote"
            ? stripRemoteSegmentsFromPlace(rawPlace)
            : placeWithWorkMode(rawPlace, displayJob.work_type);
    const strongFit = matchScore != null && matchBand(matchScore.total) === "strong";
    const noScore = matchScore == null ? noScoreReason(resume) : null;
    const paneState = descriptionPaneState(descriptionPending, sections);
    const hasAside = matchScore != null || reasons.bullets.length > 0 || reasons.chips.length > 0;

    const descriptionPane =
        paneState === "loading" ? (
            <DescriptionLoadingStatus />
        ) : paneState === "empty" ? (
            <p className="text-sm text-muted-foreground">No description available for this role.</p>
        ) : (
            <div
                className="space-y-6"
                data-testid="for-you-jd-template"
                data-jd-enhancing={enhancing ? "1" : "0"}
            >
                {JD_TEMPLATE_ORDER.map((key) => {
                    const blocks = template[key];
                    if (!blocks.length) return null;
                    return (
                        <section key={key} data-jd-section={key}>
                            <h4 className={cn(SECTION_LABEL, "mb-2")}>{JD_TEMPLATE_LABELS[key]}</h4>
                            <JobDescription blocks={blocks} headingLevel={4} />
                        </section>
                    );
                })}
            </div>
        );

    return (
        <div
            data-testid="for-you-pack"
            className={cn("flex flex-col overflow-hidden rounded-panel border border-border bg-card", className)}
        >
            <div className="border-b border-border bg-muted py-4 px-4 lg:py-6 lg:px-8">
                <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                        <CompanyLogo domain={displayJob.company_domain} name={displayJob.company} size="sm" />
                        <div className="min-w-0 flex-1">
                            <p className={SECTION_LABEL}>{company}</p>
                            <h2 className="break-words text-title-sm font-semibold text-foreground lg:text-title">
                                {displayJob.title}
                            </h2>
                            {place && <p className="mt-0.5 text-sm text-muted-foreground">{place}</p>}
                        </div>
                        {matchScore ? (
                            <FitReadout score={matchScore} strong={strongFit} />
                        ) : (
                            <NoScoreReadout reason={noScore!} />
                        )}
                    </div>
                    {factChips.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {factChips.map((chip) => {
                                const Icon = FACT_CHIP_ICON[chip.kind];
                                return (
                                    <span key={chip.kind} className={cn(STATED_CHIP_CLASS, "gap-1.5")}>
                                        {Icon && (
                                            <Icon size={16} weight="bold" className="shrink-0" aria-hidden />
                                        )}
                                        {chip.label}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className={cn("grid gap-6 py-4 px-4 lg:py-6 lg:px-8", hasAside && "lg:grid-cols-[280px_1fr]")}>
                {hasAside && (
                    <aside className="min-w-0 space-y-6 rounded-panel border border-border bg-muted p-4">
                        {matchScore ? (
                            <FitBreakdown score={matchScore} />
                        ) : (
                            <NoScoreBreakdown reason={noScore!} />
                        )}
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
                                    <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                                        {reasons.chips.map((chip) => (
                                            <span key={chip} className={DERIVED_CHIP_CLASS} title={chip}>
                                                {chip}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </aside>
                )}

                <div data-pack-scroll className={JD_SCROLL_CLASS}>
                    {descriptionPane}
                </div>
            </div>
        </div>
    );
}
