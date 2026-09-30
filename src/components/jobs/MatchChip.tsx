"use client";

/**
 * "The Match Receipt" — the chip + disclosure for `scoreJobAgainstResume`'s
 * output (lib/match/score.ts). One component, three call sites: the SERP
 * card's meta column, the job-detail header, and (later, /co — Leg D) the
 * company page. All three render the SAME `MatchScore` through `matchBand`,
 * so they show the same Strong / Good / Stretch label for the same pair.
 *
 * Disclosure reuses `ContextHelp` (components/ui/context-help.tsx) — the
 * repo's existing tooltip-on-desktop / tap-to-expand-on-mobile primitive,
 * already used for exactly this kind of "explain a computed value" need
 * elsewhere in JobCard.
 */
import { Lock } from "@phosphor-icons/react";
import { ContextHelp } from "@/components/ui/context-help";
import { cn } from "@/lib/utils";
import { explainMatch } from "@/lib/match/explain";
import { matchBand, matchBandLabel, type MatchBand, type MatchScore } from "@/lib/match/score";
import { captureEvent } from "@/lib/analytics/events";
import { matchAnalyticsProps } from "@/lib/analytics/match-props";

/** The receipt's one static disclosure row — salary is not a scored
 *  component (location is, when the résumé has a place). Honesty statement
 *  that pay was not weighed. */
const NOT_COUNTED_DETAIL = "salary — your call to weigh";

function bandChipClass(band: MatchBand): string {
    if (band === "strong") {
        return "border-live-tint-border bg-live-tint-bg text-verdict-live";
    }
    if (band === "good") {
        return "border-border bg-verdict-good-bg text-verdict-good";
    }
    return "border-border bg-verdict-caution-bg text-verdict-caution";
}

export interface MatchChipProps {
    score: MatchScore;
    /** Résumé's stored update date, already formatted (e.g. "aug 27") — see `shortDate` in lib/jobs/presentation.ts. Omitted head line when unknown. */
    asOfDate?: string | null;
    className?: string;
    /** Fires `job_match_expanded` when the receipt disclosure opens. Optional
     *  because not every render site (yet) has a job id in scope; omit to
     *  render the chip without that capture rather than fabricate an id. */
    jobId?: string;
}

/** Locked teaser occupying the same footprint as {@link MatchChip}. */
export function MatchChipTeaser({ onClick, className }: { onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            data-testid="match-chip-teaser"
            aria-label="See how this role fits your experience"
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={cn(
                "mono-data inline-flex items-center gap-1 border border-border bg-chip px-2 ctl-sm ctl-button leading-none text-muted-foreground transition-colors hover:text-foreground",
                // control-type-allow: pill like the MatchChip badge whose footprint it holds; type still comes from the step
                "rounded-pill",
                className,
            )}
        >
            <Lock size={16} weight="bold" aria-hidden />
            Your fit
        </button>
    );
}

export function MatchChip({ score, asOfDate, className, jobId }: MatchChipProps) {
    const band = matchBand(score.total);
    const label = matchBandLabel(band);
    return (
        <ContextHelp
            side="bottom"
            content={<MatchReceipt score={score} asOfDate={asOfDate} label={label} />}
            onOpenChange={(open) => {
                if (open && jobId) {
                    captureEvent("job_match_expanded", {
                        job_id: jobId,
                        ...matchAnalyticsProps(score),
                    });
                }
            }}
        >
            <span
                data-testid="match-chip"
                aria-label={`${label} match`}
                className={cn(
                    "mono-data inline-block rounded-pill border px-2 py-0.5 text-xs font-semibold leading-none",
                    bandChipClass(band),
                    className,
                )}
            >
                {label}
            </span>
        </ContextHelp>
    );
}

function MatchReceipt({
    score,
    asOfDate,
    label,
}: {
    score: MatchScore;
    asOfDate?: string | null;
    label: string;
}) {
    return (
        <div className="min-w-[220px] max-w-xs">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
                Why {label}
                {asOfDate ? ` — against your résumé of ${asOfDate}` : ""}
            </div>
            <p data-testid="match-reason" className="mb-2 text-sm leading-snug text-foreground">
                {explainMatch(score)}
            </p>
            <div className="space-y-1.5">
                {score.components.map((component) => (
                    <ReceiptRow key={component.key} label={component.label} value={component.detail} />
                ))}
                <ReceiptRow label="Not counted" value={NOT_COUNTED_DETAIL} last />
            </div>
        </div>
    );
}

function ReceiptRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <div
            className={cn(
                "flex items-center justify-between gap-3 border-b border-border pb-1.5 text-xs",
                last && "border-0 pb-0",
            )}
        >
            <span>{label}</span>
            <span className="mono-data text-xs tabular-nums text-muted-foreground">{value}</span>
        </div>
    );
}
