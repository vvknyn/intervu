"use client";

import { useMemo } from "react";
import { MatchChip } from "@/components/jobs/MatchChip";
import { chipVariants } from "@/components/ui/chip";
import { buildFitReasonRows, fitReasonSourcesFromComponents } from "@/lib/jobs/for-you/fit-reasons";
import { inferReasons } from "@/lib/jobs/for-you/infer-reasons";
import type { MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
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
    "h-auto min-h-7 max-w-full min-w-0 shrink whitespace-normal break-words px-2.5 py-1 text-xs",
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
    const reasons = useMemo(() => inferReasons(job, score, resume), [job, score, resume]);

    return (
        <details data-tour="jobs-fit-reasons" className="group mb-4 rounded-panel bg-card px-4 py-3.5" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Why this fits</span>
                <span className="flex items-center gap-2">
                    <MatchChip score={score} asOfDate={asOfDate} jobId={jobId} />
                    <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180" aria-hidden>
                        ▾
                    </span>
                </span>
            </summary>

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
        </details>
    );
}
