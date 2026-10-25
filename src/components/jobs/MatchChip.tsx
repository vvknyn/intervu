"use client";

/**
 * "The Match Receipt" — the chip + disclosure for `scoreJobAgainstResume`'s
 * output (lib/match/score.ts). One component, three call sites: the SERP
 * card's meta column, the job-detail header, and (later, /co — Leg D) the
 * company page. All three render the SAME `MatchScore` through `matchLabel`,
 * so they show the same Strong / Good / Stretch label for the same pair, or
 * the same "Outside Canada" for a role outside where the candidate can work.
 *
 * Disclosure reuses `ContextHelp` (components/ui/context-help.tsx) — the
 * repo's existing tooltip-on-desktop / tap-to-expand-on-mobile primitive,
 * already used for exactly this kind of "explain a computed value" need
 * elsewhere in JobCard.
 */
import { ContextHelp } from "@/components/ui/context-help";
import { cn } from "@/lib/utils";
import { explainMatch } from "@/lib/match/explain";
import { labelNamesPlace, matchBand, matchLabel, type MatchBand, type MatchScore } from "@/lib/match/score";
import { captureEvent } from "@/lib/analytics/events";
import { matchAnalyticsProps } from "@/lib/analytics/match-props";

/** The receipt's one static disclosure row — salary is not a scored
 *  component (location is, when the résumé has a place). Honesty statement
 *  that pay was not weighed. */
const NOT_COUNTED_DETAIL = "salary — your call to weigh";

/** A fit band, or `outside`: the label names the place, not a fit (`labelNamesPlace`: outside where the candidate can work, or not saying where it hires). */
type MatchTone = MatchBand | "outside";

function bandChipClass(band: MatchTone): string {
    if (band === "outside") {
        return "border-border bg-chip text-muted-foreground";
    }
    if (band === "strong") {
        return "border-live-tint-border bg-live-tint-bg text-verdict-live";
    }
    if (band === "good") {
        return "border-border bg-verdict-good-bg text-verdict-good";
    }
    return "border-border bg-verdict-caution-bg text-verdict-caution";
}

/** The band's colour alone, for the `text` variant that sits in a row's meta line. */
function bandTextClass(band: MatchTone): string {
    if (band === "outside") return "text-muted-foreground";
    return band === "strong" ? "text-verdict-live" : band === "good" ? "text-verdict-good" : "text-verdict-caution";
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
    /** The chip's test id; null leaves it off (a role card stacked behind the open one). */
    testId?: string | null;
    /**
     * `chip` (default): the bordered pill. `text`: the band word in its colour,
     * for a list where every row has one and a pill per row would crowd it
     * (the packs home's Today picks). Both open the same receipt.
     */
    variant?: "chip" | "text";
}

export function MatchChip({ score, asOfDate, className, jobId, testId = "match-chip", variant = "chip" }: MatchChipProps) {
    const namesPlace = labelNamesPlace(score);
    const band: MatchTone = namesPlace ? "outside" : matchBand(score.total);
    const label = matchLabel(score);
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
                data-testid={testId ?? undefined}
                aria-label={namesPlace ? label : `${label} match`}
                className={cn(
                    variant === "text"
                        ? cn("font-semibold", bandTextClass(band))
                        : cn("mono-data inline-block rounded-pill border px-2 py-0.5 text-xs font-semibold leading-none group-aria-[current=true]:bg-surface-3", bandChipClass(band)),
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
                Why {labelNamesPlace(score) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}
                {asOfDate ? ` — against your résumé of ${asOfDate}` : ""}
            </div>
            <p data-testid="match-reason" className="mb-2 text-sm leading-snug">
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
