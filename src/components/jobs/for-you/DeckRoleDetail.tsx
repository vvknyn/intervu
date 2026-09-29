"use client";

import { useMemo } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { JobDescription } from "@/components/jobs/JobDetail";
import { LocalCustomizePanel } from "@/components/jobs/LocalCustomizePanel";
import { RowBookmarkButton } from "@/components/jobs/RowBookmarkButton";
import { APPLY_BUTTON_LABEL } from "@/components/jobs/job-detail-facts";
import { DescriptionLoadingStatus } from "@/components/jobs/for-you/DescriptionLoadingStatus";
import { deckFactParts, deckOverlapSentence, deckRelistedWord } from "@/lib/jobs/for-you/deck-detail";
import { formatDescription } from "@/lib/jobs/format-description";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import { UPLOAD_TO_CUSTOMIZE_LABEL } from "@/lib/jobs/resume-cta-copy";
import { matchBand, matchBandLabel, type MatchScore } from "@/lib/match/score";
import { useJobViewedCapture } from "@/lib/analytics/use-job-viewed-capture";
import { presentJob } from "@/lib/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import type { Pursuit } from "@/lib/pursuits/types";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

function bandClass(band: ReturnType<typeof matchBand>): string {
    if (band === "strong") return "border-live-tint-border bg-live-tint-bg text-verdict-live";
    if (band === "good") return "border-border bg-verdict-good-bg text-verdict-good";
    return "border-border bg-verdict-caution-bg text-verdict-caution";
}

/**
 * Signed-in deck detail: a decision header and the posting.
 * No fit ledger, no inferred rail, no second column.
 */
export function DeckRoleDetail({
    job,
    now,
    onOpenPosting,
    onGoAfter,
    pursuit,
    saveSuccessPulse = false,
    matchScore = null,
    descriptionPending = false,
    onRetryDescription,
    resume = null,
    onUploadResume,
}: {
    job: PublicJob;
    now: number;
    onOpenPosting: () => void;
    onGoAfter: () => void;
    pursuit: Pursuit | undefined;
    saveSuccessPulse?: boolean;
    matchScore?: MatchScore | null;
    descriptionPending?: boolean;
    onRetryDescription?: () => void;
    resume?: ResumeData | null;
    onUploadResume?: () => void;
}) {
    useJobViewedCapture({ job, source: "serp", signedIn: true, matchScore, resume });
    const presented = presentJob(job);
    const companyBrand = displayCompanyBrand(job.company, job.company_domain, job.title);
    const freshness = classifyPostingFreshness(job, now);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), now) : null;
    const facts = deckFactParts(job, postedRelative);
    const relisted = deckRelistedWord(job, now);
    const overlap = deckOverlapSentence(job, resume);
    const blocks = useMemo(() => formatDescription(job.description), [job.description]);
    const band = matchScore ? matchBand(matchScore.total) : null;

    return (
        <div data-testid="deck-role" className="min-w-0">
            <div className="px-4 pt-4 sm:px-6">
                <div className="flex items-center gap-3">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
                    <p className="min-w-0 flex-1 truncate font-semibold text-foreground">
                        {companyBrand || "Unknown company"}
                    </p>
                </div>
                <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
                    <h2 className="min-w-0 flex-1 font-display text-title-lg font-semibold leading-tight text-balance text-foreground">
                        {presented.title}
                    </h2>
                    {band && (
                        <span
                            data-testid="match-chip"
                            className={cn(
                                "mono-data inline-block shrink-0 rounded-pill border px-2 py-0.5 text-xs font-semibold leading-none",
                                bandClass(band),
                            )}
                        >
                            {matchBandLabel(band)}
                        </span>
                    )}
                </div>
                {overlap ? (
                    <p className="mt-2 text-sm text-foreground" data-testid="deck-overlap">
                        {overlap}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6">
                {job.apply_url ? (
                    <Button size="lg"
                        onClick={onOpenPosting}
                        className="gap-2 rounded-ctl bg-foreground px-4 text-sm font-semibold text-background"
                    >
                        <ArrowSquareOut size={16} />
                        {APPLY_BUTTON_LABEL}
                    </Button>
                ) : null}
                {resume != null ? (
                    <LocalCustomizePanel job={job} resume={resume} compactTrigger signedIn />
                ) : onUploadResume ? (
                    <Button size="lg"
                        type="button"
                        variant="outline"
                        data-testid="job-detail-upload-to-customize"
                        onClick={onUploadResume}
                        className="shrink-0 rounded-ctl text-xs font-semibold"
                    >
                        {UPLOAD_TO_CUSTOMIZE_LABEL}
                    </Button>
                ) : null}
                <RowBookmarkButton
                    pursuit={pursuit}
                    onGoAfter={onGoAfter}
                    successPulse={saveSuccessPulse}
                    className="rounded-ctl border border-border bg-surface"
                />
            </div>

            {facts.length > 0 || relisted ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6">
                    {facts.map((part, index) => (
                        <span key={part}>
                            {index > 0 ? <span aria-hidden> · </span> : null}
                            {part}
                        </span>
                    ))}
                    {relisted ? (
                        <span className="text-muted-foreground">
                            {facts.length > 0 ? <span aria-hidden> · </span> : null}
                            {relisted}
                        </span>
                    ) : null}
                </p>
            ) : null}

            <div className="px-4 pb-6 sm:px-6">
                {descriptionPending && blocks.length === 0 ? (
                    <DescriptionLoadingStatus onRetry={onRetryDescription} />
                ) : blocks.length > 0 ? (
                    <JobDescription blocks={blocks} headingLevel={3} />
                ) : (
                    <p className="text-sm text-muted-foreground">No description captured for this posting yet.</p>
                )}
            </div>
        </div>
    );
}
