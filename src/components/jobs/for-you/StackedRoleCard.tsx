"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { FormattedJobDescription } from "@/components/jobs/JobDescription";
import { DescriptionLoadingStatus } from "@/components/jobs/for-you/DescriptionLoadingStatus";
import { useJobViewedCapture } from "@/lib/analytics/use-job-viewed-capture";
import { descriptionNeedsFill } from "@/lib/jobs/fill-description";
import { inferReasons } from "@/lib/jobs/for-you/infer-reasons";
import {
    stackCardDetails,
    stackCardPlace,
    stackInferredRows,
    type InferredTone,
} from "@/lib/jobs/for-you/stack-card-signals";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { displayCompanyBrand } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { buildDeterministicJdTemplate, jdTemplateIsThin } from "@/lib/local-ai/format-job-description";
import { matchBand, matchBandLabel, type MatchScore } from "@/lib/match/score";
import { presentJob } from "@/lib/presentation";
import type { ResumeData } from "@/types/resume";
import { cn } from "@/lib/utils";

const SECTION_LABEL = "text-xs font-semibold text-muted-foreground";

const TONE_DOT: Record<InferredTone, string> = {
    good: "bg-live",
    neutral: "bg-muted-foreground",
    caution: "bg-verdict-caution",
};

const TONE_WORD: Record<InferredTone, string> = {
    good: "In your favour",
    neutral: "Worth knowing",
    caution: "Worth checking",
};

function bandClass(band: ReturnType<typeof matchBand>): string {
    if (band === "strong") return "border-live-tint-border bg-live-tint-bg text-verdict-live";
    if (band === "good") return "border-border bg-verdict-good-bg text-verdict-good";
    return "border-border bg-verdict-caution-bg text-verdict-caution";
}

function blocksText(blocks: DescBlock[]): string {
    return blocks
        .map((block) => (block.type === "list" && block.items ? block.items.join(" ") : (block.text ?? "")))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Records the job view once the card is the open role, same event as the detail pane it replaces. */
function ViewedCapture({ job, matchScore, resume }: { job: PublicJob; matchScore: MatchScore | null; resume: ResumeData | null }) {
    useJobViewedCapture({ job, source: "serp", signedIn: true, matchScore, resume });
    return null;
}

/**
 * One role in the opened pack's stack, in two parts (Vivek, 2026-09-30):
 * the left is the summary and what Velai inferred about the role against the
 * résumé; the right is what the posting states, its details and description.
 * On a phone the two stack in one scroll and the actions stay pinned to the
 * card's bottom edge; from `lg` they sit side by side and each scrolls alone.
 */
export function StackedRoleCard({
    job,
    active,
    nowMs,
    matchScore,
    resume,
    descriptionPending,
    onRetryDescription,
    onOpenPosting,
    actions,
}: {
    job: PublicJob;
    active: boolean;
    nowMs: number;
    matchScore: MatchScore | null;
    resume: ResumeData | null;
    descriptionPending: boolean;
    onRetryDescription?: () => void;
    onOpenPosting: () => void;
    actions: ReactNode;
}) {
    const presented = presentJob(job);
    const company = displayCompanyBrand(job.company, job.company_domain, job.title);
    const place = stackCardPlace(job);
    const band = matchScore ? matchBand(matchScore.total) : null;
    const freshness = classifyPostingFreshness(job, nowMs);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), nowMs) : null;
    const fullBlocks = useMemo(() => formatDescription(job.description), [job.description]);
    // The Summary is the posting's own first sentence, never a model's
    // rewrite: the card states it as the role's, so it has to be word for word.
    const template = useMemo(() => buildDeterministicJdTemplate(job.description), [job.description]);

    const pending = descriptionPending && fullBlocks.length === 0;
    const thin = jdTemplateIsThin(template, job.description);
    const stub = descriptionNeedsFill(job.description);
    const summary = !thin && template.hook.length > 0 ? blocksText(template.hook) : stub ? presented.descriptionLede : "";

    const inferred = stackInferredRows({
        job,
        score: matchScore,
        resume,
        freshness,
        descBlockCount: fullBlocks.length,
        nowMs,
    });
    const skills = inferReasons(job, matchScore, resume).chips;
    const details = stackCardDetails(job, postedRelative);

    // Each scroller here starts its own touch-action scope, so it repeats the
    // stage's pan-y. Without it a sideways swipe inside the card goes to the
    // browser (Chrome on Android takes it as Back) instead of changing role.
    return (
        <div
            data-testid={active ? "for-you-pack" : undefined}
            className={cn(
                "flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom flex-col overflow-y-auto",
                "lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:overflow-hidden",
            )}
        >
            {active ? <ViewedCapture job={job} matchScore={matchScore} resume={resume} /> : null}

            <section className="flex touch-pan-y touch-pinch-zoom flex-col gap-5 p-5 lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:p-6">
                <div className="flex items-center gap-3">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
                    <p className="min-w-0 flex-1 truncate font-semibold text-foreground">{company || "Unknown company"}</p>
                    {band ? (
                        <span
                            data-testid={active ? "match-chip" : undefined}
                            aria-label={`${matchBandLabel(band)} match`}
                            className={cn(
                                "mono-data inline-block shrink-0 rounded-pill border px-2 py-0.5 text-xs font-semibold leading-none",
                                bandClass(band),
                            )}
                        >
                            {matchBandLabel(band)}
                        </span>
                    ) : null}
                </div>

                <div>
                    {/* page-scale-allow: a job's title heads its role card at the page-title step; the h1 is the page masthead */}
                    <h2 className="font-display text-2xl font-semibold leading-tight text-balance text-foreground">
                        {presented.title}
                    </h2>
                    {place ? (
                        <p className="mt-1 text-sm text-muted-foreground" data-testid="role-card-place">
                            {place}
                        </p>
                    ) : null}
                </div>

                {summary ? (
                    <div>
                        <p className={SECTION_LABEL}>Summary</p>
                        <p className="mt-1.5 line-clamp-6 text-sm leading-relaxed text-foreground">{summary}</p>
                    </div>
                ) : null}

                <div
                    className="flex flex-col gap-2.5 rounded-panel border border-border bg-background p-4"
                    data-testid={active ? "role-card-inferred" : undefined}
                >
                    <p className={SECTION_LABEL}>What we inferred</p>
                    <ul className="flex flex-col gap-2">
                        {inferred.map((row) => (
                            <li key={row.text} className="flex items-start gap-2.5 text-sm leading-snug text-foreground">
                                <span className={cn("mt-1.5 size-2 shrink-0 rounded-pill", TONE_DOT[row.tone])} aria-hidden />
                                <span className="sr-only">{TONE_WORD[row.tone]}: </span>
                                <span className="min-w-0">{row.text}</span>
                            </li>
                        ))}
                    </ul>
                    {skills.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Skills you share with this role">
                            {skills.map((skill) => (
                                <li
                                    key={skill}
                                    className="rounded-pill border border-live-tint-border bg-live-tint-bg px-2.5 py-0.5 text-xs text-verdict-good"
                                >
                                    {skill}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            </section>

            <section className="flex touch-pan-y touch-pinch-zoom flex-col gap-5 border-t border-border bg-background p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-7">
                <div className="flex items-start justify-between gap-3">
                    <p className={SECTION_LABEL}>Details</p>
                    {job.apply_url ? (
                        <button
                            type="button"
                            onClick={onOpenPosting}
                            data-testid={active ? "role-card-open-posting" : undefined}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                        >
                            Open the posting
                            <ArrowSquareOut size={16} aria-hidden />
                        </button>
                    ) : null}
                </div>
                {details.length > 0 ? (
                    <dl className="-mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                        {details.map((detail) => (
                            <div key={detail.label} className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{detail.label}</dt>
                                <dd className="mt-0.5 text-sm font-semibold text-foreground">{detail.value}</dd>
                            </div>
                        ))}
                    </dl>
                ) : null}

                <div className="border-t border-border pt-5">
                    <p className={SECTION_LABEL}>Job description</p>
                    <div className="mt-3 flex max-w-prose flex-col gap-6 text-foreground" data-testid={active ? "role-card-description" : undefined}>
                        {pending ? (
                            <DescriptionLoadingStatus onRetry={onRetryDescription} />
                        ) : fullBlocks.length > 0 && (!stub || !thin) ? (
                            // The whole posting in its own sections, as the job pane shows it.
                            // The open card's lines go to the on-device model first; the
                            // cards waiting behind it get laid out in the background.
                            <FormattedJobDescription
                                description={job.description}
                                headingLevel={3}
                                priority={active ? "visible" : "background"}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {job.description?.trim()
                                    ? "The full description isn't available yet. Open the posting to read the role."
                                    : "No description captured for this posting yet."}
                            </p>
                        )}
                    </div>
                </div>
            </section>

            <div className="sticky bottom-0 border-t border-border bg-card p-4 lg:static lg:col-start-1 lg:row-start-2 lg:px-6 lg:pb-6">
                {actions}
            </div>
        </div>
    );
}
