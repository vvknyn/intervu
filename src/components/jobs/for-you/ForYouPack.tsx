"use client";

import { useMemo } from "react";
import { JobDescription } from "@/components/jobs/JobDetail";
import { DescriptionLoadingStatus } from "@/components/jobs/for-you/DescriptionLoadingStatus";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { buildFactChips } from "@/components/jobs/job-detail-facts";
import { FACT_CHIP_ICON } from "@/components/jobs/fact-chip-icons";
import { chipVariants } from "@/components/ui/chip";
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
    jdSearchIndexSnippet,
    jdTemplateIsThin,
} from "@/lib/local-ai/format-job-description";
import { descriptionNeedsFill } from "@/lib/jobs/fill-description";
import { formatDescription } from "@/lib/jobs/format-description";
import { matchBand, matchBandLabel, type MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

export interface ForYouPackProps {
    job: PublicJob;
    hydratedJob?: PublicJob | null;
    descriptionPending?: boolean;
    /** Re-kick description hydrate after a soft-fail / timeout. */
    onRetryDescription?: () => void;
    matchScore: MatchScore | null;
    resume: ResumeData | null;
    nowMs: number;
    className?: string;
}

/**
 * ONE micro-label treatment for every section heading in this pack (kicker
 * above the title, "What we inferred" / description subheads) — a single
 * quiet-caps class instead of each spot picking its own size/weight, reused
 * verbatim from the house convention (BoardComparisonTable.tsx, careers hub).
 */
const SECTION_LABEL = "text-xs font-semibold text-surface-postcard-muted";
const POSTCARD_SHELL =
    "flex flex-col overflow-hidden rounded-panel bg-surface-postcard text-surface-postcard-foreground shadow-[var(--shadow-postcard)]";

/** JD column — the only inner scroller; capped so wheel events chain to the page at the ends. */
const JD_SCROLL_CLASS =
    "min-w-0 overflow-y-auto max-h-[min(60dvh,640px)] custom-scrollbar";

/** Employer-stated fact — quiet/neutral, same chip primitive everywhere. */
const STATED_CHIP_CLASS = cn(
    chipVariants({ active: false }),
    "h-7 px-2.5 text-xs bg-background text-foreground",
);

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
 * Strong (same band the SERP row's MatchChip uses). Lives in the header only;
 * pack tip surfaces do not show per-component Fit breakdown bars or MatchChip
 * numbers (band label only).
 */
function FitReadout({ score, strong }: { score: MatchScore; strong: boolean }) {
    const label = matchBandLabel(matchBand(score.total));
    return (
        <div className="shrink-0 text-right">
            <p className={SECTION_LABEL}>Fit</p>
            <p
                className={cn(
                    "text-title-sm font-semibold",
                    strong ? "text-live-on-postcard" : "text-surface-postcard-foreground",
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
            <p className="mt-1 text-xs text-surface-postcard-muted">{NO_SCORE_MESSAGES[reason]}</p>
        </div>
    );
}


export function ForYouPack({
    job,
    hydratedJob,
    descriptionPending,
    onRetryDescription,
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
    // Tip ship: no Fit breakdown bars / MatchChip numbers on pack deck — aside is inferences only.
    const hasAside = reasons.bullets.length > 0 || reasons.chips.length > 0;

    // Soft-fail sparse templates: never render a hook-only "✨ The role" card
    // with huge empty whitespace. When the SOURCE is still a teaser/stub,
    // fall back to title + company + apply + short snippet. When the source
    // is a full JD but the template mapper missed structure (Greenhouse
    // `\n \n` dumps, glued headings), show the scrollable formatted body
    // instead of truncating to a 280-char snippet — that truncate was the
    // HelloFresh "cuts mid-sentence then Apply at …" trust killer.
    const templateThin =
        paneState === "empty" ||
        (paneState === "content" && jdTemplateIsThin(template, displayJob.description));
    const sourceNeedsFill = descriptionNeedsFill(displayJob.description);
    const softFailSnippet = jdSearchIndexSnippet(displayJob.description);
    const applyHref = displayJob.apply_url?.trim() || null;
    const formattedFullBlocks = useMemo(
        () => (templateThin && !sourceNeedsFill ? formatDescription(displayJob.description) : []),
        [templateThin, sourceNeedsFill, displayJob.description],
    );

    const softFailPane = (
        <div className="space-y-4" data-testid="for-you-jd-soft-fail">
            <div>
                <p className={SECTION_LABEL}>Role</p>
                <p className="mt-1 text-sm font-semibold text-surface-postcard-foreground">{displayJob.title}</p>
                {company ? (
                    <p className="mt-0.5 text-sm text-surface-postcard-muted">{company}</p>
                ) : null}
            </div>
            {softFailSnippet ? (
                <p className="text-sm leading-relaxed text-surface-postcard-foreground">{softFailSnippet}</p>
            ) : (
                <p className="text-sm text-surface-postcard-muted">
                    Full description isn&apos;t available yet — open the posting to review the role.
                </p>
            )}
            {applyHref ? (
                <a
                    href={applyHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="for-you-jd-apply-link"
                    className="inline-flex text-sm font-semibold text-live underline-offset-4 hover:underline"
                >
                    Apply at {company || "company"}
                </a>
            ) : null}
        </div>
    );

    const fullBodyPane = (
        <div className="space-y-4" data-testid="for-you-jd-full-body">
            <p className={SECTION_LABEL}>About this role</p>
            <JobDescription blocks={formattedFullBlocks} headingLevel={4} />
            {applyHref ? (
                <a
                    href={applyHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="for-you-jd-apply-link"
                    className="inline-flex text-sm font-semibold text-live underline-offset-4 hover:underline"
                >
                    Apply at {company || "company"}
                </a>
            ) : null}
        </div>
    );

    const templatePane = (
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

    const descriptionPane =
        paneState === "loading" ? (
            <DescriptionLoadingStatus onRetry={onRetryDescription} />
        ) : templateThin && sourceNeedsFill ? (
            softFailPane
        ) : templateThin && formattedFullBlocks.length > 0 ? (
            fullBodyPane
        ) : templateThin ? (
            softFailPane
        ) : (
            templatePane
        );

    return (
        <div
            data-testid="for-you-pack"
            className={cn(POSTCARD_SHELL, className)}
        >
            <div className="border-b border-border py-4 px-4 lg:py-6 lg:px-8">
                <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                        <CompanyLogo domain={displayJob.company_domain} name={displayJob.company} size="sm" />
                        <div className="min-w-0 flex-1">
                            <p className={SECTION_LABEL}>{company}</p>
                            <h2 className="break-words text-title-sm font-semibold text-surface-postcard-foreground lg:text-title">
                                {displayJob.title}
                            </h2>
                            {place && <p className="mt-0.5 text-sm text-surface-postcard-muted">{place}</p>}
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
                    <aside className="min-w-0 space-y-6 rounded-ctl border border-border bg-surface-postcard p-4 shadow-[var(--shadow-bevel-inset)]">
                        <div>
                            <h3 className={SECTION_LABEL}>What we inferred</h3>
                            {reasons.bullets.length > 0 && (
                                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-surface-postcard-foreground">
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
                    </aside>
                )}

                <div data-pack-scroll className={JD_SCROLL_CLASS}>
                    {descriptionPane}
                </div>
            </div>
        </div>
    );
}
