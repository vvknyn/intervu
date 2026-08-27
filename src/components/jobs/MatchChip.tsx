"use client";

/**
 * "The Match Receipt" — the chip + disclosure for `scoreJobAgainstResume`'s
 * output (lib/match/score.ts). One component, three call sites: the SERP
 * card's meta column, the job-detail header, and (later, /co — Leg D) the
 * company page. All three render the SAME `MatchScore`, so they can never
 * show a different number for the same job/résumé pair.
 *
 * Disclosure reuses `ContextHelp` (components/ui/context-help.tsx) — the
 * repo's existing tooltip-on-desktop / tap-to-expand-on-mobile primitive,
 * already used for exactly this kind of "explain a computed value" need
 * elsewhere in JobCard.
 */
import { ContextHelp } from "@/components/ui/context-help";
import { cn } from "@/lib/utils";
import { MATCH_CHIP_BRAND_THRESHOLD, type MatchScore } from "@/lib/match/score";

/** The receipt's one static disclosure row — not a scored component (score.ts
 *  never touches location/salary), so it isn't a `MatchComponent`; it's the
 *  UI's honesty statement that these fields exist and were not weighed. */
const NOT_COUNTED_DETAIL = "location, salary — your call to weigh";

export interface MatchChipProps {
    score: MatchScore;
    /** Résumé's stored update date, already formatted (e.g. "aug 27") — see `shortDate` in lib/jobs/presentation.ts. Omitted head line when unknown. */
    asOfDate?: string | null;
    className?: string;
}

export function MatchChip({ score, asOfDate, className }: MatchChipProps) {
    const strong = score.total >= MATCH_CHIP_BRAND_THRESHOLD;
    return (
        <ContextHelp side="bottom" content={<MatchReceipt score={score} asOfDate={asOfDate} />}>
            <span
                data-testid="match-chip"
                className={cn(
                    "mono-data inline-block rounded-none border px-2 py-0.5 text-[10.5px] font-semibold leading-none tracking-wide",
                    strong ? "border-brand bg-card text-brand" : "border-border bg-chip text-foreground",
                    className,
                )}
            >
                match {score.total}
            </span>
        </ContextHelp>
    );
}

function MatchReceipt({ score, asOfDate }: { score: MatchScore; asOfDate?: string | null }) {
    return (
        <div className="min-w-[220px]">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Why {score.total}
                {asOfDate ? ` — against your résumé of ${asOfDate}` : ""}
            </div>
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
                "flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 text-xs",
                last && "border-0 pb-0",
            )}
        >
            <span>{label}</span>
            <span className="mono-data text-[11px] tabular-nums text-muted-foreground">{value}</span>
        </div>
    );
}
