"use client";

import { useMemo } from "react";
import { MatchChip } from "@/components/jobs/MatchChip";
import { Button } from "@/components/ui/button";
import { Disclosure, DisclosureCaret, DisclosureSummary } from "@/components/ui/disclosure";
import { chipVariants } from "@/components/ui/chip";
import { buildFitReasonRows, fitReasonSourcesFromComponents } from "@/lib/jobs/for-you/fit-reasons";
import { inferReasons, TITLE_OVERLAP_LEAD } from "@/lib/jobs/for-you/infer-reasons";
import { labelNamesPlace, type MatchScore } from "@/lib/match/score";
import { fitTerms } from "@/lib/match/fit-terms";
import { SignalChip } from "@/components/jobs/SignalChip";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { UPLOAD_TO_CUSTOMIZE_LABEL } from "@/lib/jobs/resume-cta-copy";
import { jobActionSize } from "@/lib/jobs/toolbar-control-height";
import { cn } from "@/lib/utils";

/** Quiet row-label treatment: sentence case, normal tracking, on-scale size
 *  (rulebook: no uppercase, tracking utilities, or arbitrary sizes outside
 *  the wordmark exemption — see tests/unit/design-language.test.ts). */
const SECTION_LABEL = "text-xs font-semibold text-muted-foreground";

/** Product-derived/inferred chip — the chip primitive's "active" treatment,
 *  matching the existing convention for a computed inference vs. a stated fact. */
const DERIVED_CHIP_CLASS = cn(
    chipVariants({ active: true }),
    // Long inferred titles (e.g. "Technical Account Manager | …") must stay
    // inside the FIT column — override chip `shrink-0` / `whitespace-nowrap`.
    "ctl-grow max-w-full min-w-0 shrink whitespace-normal break-words px-2.5 text-xs",
);

export interface FitReasonsProps {
    job: PublicJob;
    score: MatchScore;
    asOfDate?: string | null;
    resume: ResumeData | null;
    jobId?: string;
}

/**
 * "Why this fits" card (mock B5) — a `<details>` disclosure between the pay
 * card and the posting-check card. Its summary carries the SAME `MatchChip`
 * already mounted in the title row (one receipt, reused, never a second
 * "Fit N" pill), so opening it never contradicts the number shown above.
 * Rows come from `buildFitReasonRows` (single-column for every real
 * `MatchComponent` today; two-column only if a future score ever supplies
 * split resume/posting text). `inferReasons` folds in as the card's last
 * section, unchanged from where it already rendered.
 */
export function FitReasons({ job, score, asOfDate, resume, jobId }: FitReasonsProps) {
    const rows = useMemo(
        () => buildFitReasonRows(fitReasonSourcesFromComponents(score.components)),
        [score.components],
    );
    // The terms the relevance row counts, ✓ on the résumé or ✗ not: the same
    // chips the extension shows under its fit label (2026-10-10, after
    // Autodesk's "Relevant" + matched-skill chips).
    const terms = useMemo(() => (resume ? fitTerms(resume, job) : null), [resume, job]);
    const reasons = useMemo(() => {
        const inferred = inferReasons(job, score, resume);
        if (!terms) return inferred;
        // The ✓ chips already name the title and tag words the résumé shares,
        // so the overlap bullet and the matched-skill chips would say it twice.
        return { bullets: inferred.bullets.filter((bullet) => !bullet.startsWith(TITLE_OVERLAP_LEAD)), chips: [] };
    }, [job, score, resume, terms]);

    return (
        <Disclosure data-tour="jobs-fit-reasons" className="mb-4 rounded-panel bg-surface px-4 py-3.5" open>
            <DisclosureSummary marker={false} className="flex items-center justify-between gap-3">
                {/* A role outside where they can work, or one that doesn't say where it hires, carries no fit word (`matchLabel`), so the heading doesn't claim one. */}
                <span className="text-sm font-semibold text-foreground">{labelNamesPlace(score) ? "How this compares" : "Why this fits"}</span>
                <span className="flex items-center gap-2">
                    <MatchChip score={score} asOfDate={asOfDate} jobId={jobId} />
                    <DisclosureCaret className="text-muted-foreground" />
                </span>
            </DisclosureSummary>

            <div className="mt-3 space-y-3 border-t border-border pt-3">
                {rows.map((row) =>
                    row.columns === "two" ? (
                        <div key={row.key} className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                                <p className={SECTION_LABEL}>{row.label} · Your résumé</p>
                                <p className="mt-1 text-foreground">{row.resumeText}</p>
                            </div>
                            <div>
                                <p className={SECTION_LABEL}>{row.label} · This posting</p>
                                <p className="mt-1 text-foreground">{row.postingText}</p>
                            </div>
                        </div>
                    ) : (
                        <div key={row.key}>
                            <p className={SECTION_LABEL}>{row.label}</p>
                            <p className="mt-1 text-sm text-foreground">{row.singleText}</p>
                            {row.key === "relevance" && terms && (
                                <ul data-testid="fit-terms" aria-label="Terms this role names" className="mt-2 flex min-w-0 flex-wrap gap-2">
                                    {terms.matched.map((term) => (
                                        <SignalChip key={`has-${term}`} tone="good" title="On your résumé" srNote="on your résumé">
                                            {term}
                                        </SignalChip>
                                    ))}
                                    {terms.missing.map((term) => (
                                        <SignalChip key={`lacks-${term}`} tone="lacking" title="Not on your résumé" srNote="not on your résumé">
                                            {term}
                                        </SignalChip>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ),
                )}

                {(reasons.bullets.length > 0 || reasons.chips.length > 0) && (
                    <div>
                        <p className={SECTION_LABEL}>What we inferred</p>
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
            </div>
        </Disclosure>
    );
}

/**
 * The one place a role's detail asks a visitor without a résumé for one: the
 * "Why this fits" section it would fill. Replaces the same button that used to
 * repeat in every role's action row.
 */
export function FitReasonsUploadSlot({ onUploadResume }: { onUploadResume: () => void }) {
    return (
        <section data-testid="fit-upload-slot" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel bg-surface px-4 py-3.5">
            <h3 className="text-sm font-semibold text-foreground">Why this fits</h3>
            <Button
                size={jobActionSize}
                type="button"
                variant="outline"
                data-testid="job-detail-upload-to-customize"
                onClick={onUploadResume}
                className="shrink-0"
            >
                {UPLOAD_TO_CUSTOMIZE_LABEL}
            </Button>
        </section>
    );
}
