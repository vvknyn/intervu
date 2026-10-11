"use client";

import { Button } from "@/components/ui/button";
import { InlineSpinner } from "@/components/ui/wait-state";

/**
 * Where sealed AI's read of the résumé stands. The quick (rules) read is
 * already on screen; this strip says what the model is doing and offers the way out.
 */
export type EnhancementPhase = "loading" | "skipped" | "unimproved" | "slow" | "not-needed" | "improved-pending";

interface Props {
    phase: EnhancementPhase;
    onSkip: () => void;
    onUseImproved: () => void;
}

export function ModelEnhancementStrip({ phase, onSkip, onUseImproved }: Props) {
    if (phase === "improved-pending") {
        return (
            <div className="px-6" data-testid="resume-model-strip" data-phase={phase}>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface-2 p-3">
                    <p className="text-sm text-foreground">A better read from sealed AI is ready.</p>
                    <Button type="button" variant="outline" onClick={onUseImproved} data-testid="resume-model-use-improved">
                        Use improved parse (replaces your edits)
                    </Button>
                </div>
            </div>
        );
    }

    if (phase === "skipped" || phase === "unimproved" || phase === "slow" || phase === "not-needed") {
        return (
            <p className="px-6 text-xs text-muted-foreground" data-testid="resume-model-strip" data-phase={phase}>
                {phase === "skipped"
                    ? "Skipped — keeping the quick match."
                    : phase === "slow"
                      ? "Sealed AI was taking too long, so we kept the quick match."
                      : phase === "not-needed"
                        ? "The quick read found everything ranking uses, so no AI read was needed."
                        : "Sealed AI couldn't improve this read — keeping the quick match."}
            </p>
        );
    }

    return (
        <div className="px-6" data-testid="resume-model-strip" data-phase={phase}>
            <div className="space-y-2 rounded-panel border border-border bg-surface-2 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <InlineSpinner />
                    Reading your résumé with sealed AI
                </p>
                <p className="text-xs text-muted-foreground">Your quick match is ready to edit meanwhile.</p>
                <Button
                    type="button"
                    variant="link"
                    size="link"
                    onClick={onSkip}
                    data-testid="resume-model-skip"
                    // control-type-allow: an inline text link (size="link") set with the 12px note above it
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                    Skip — use quick match
                </Button>
            </div>
        </div>
    );
}
