/** Concept A step index — plain tabular number, secondary weight (see /connect). */
export function OnboardingStepLabel({ step, total = 3 }: { step: number; total?: number }) {
    return (
        <span className="text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums">{step}.</span> of {total}
        </span>
    );
}
