"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { InlineSpinner } from "@/components/ui/wait-state";
import { ModelLoadProgress } from "@/components/local-ai/ModelLoadProgress";
import { getModelLoadState, subscribeModelLoad } from "@/lib/local-ai/ladder";

/**
 * Where the background model upgrade stands. The quick (rules) parse is already
 * on screen; this strip reports the model's real progress and offers the way out.
 */
export type EnhancementPhase = "loading" | "skipped" | "unimproved" | "improved-pending";

interface Props {
    phase: EnhancementPhase;
    onSkip: () => void;
    onUseImproved: () => void;
}

export function ModelEnhancementStrip({ phase, onSkip, onUseImproved }: Props) {
    const load = useSyncExternalStore(subscribeModelLoad, getModelLoadState, getModelLoadState);

    if (phase === "improved-pending") {
        return (
            <div className="px-6" data-testid="resume-model-strip" data-phase={phase}>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface-2 p-3">
                    <p className="text-sm text-foreground">A better parse from the on-device model is ready.</p>
                    <Button type="button" variant="outline" onClick={onUseImproved} data-testid="resume-model-use-improved">
                        Use improved parse (replaces your edits)
                    </Button>
                </div>
            </div>
        );
    }

    if (phase === "skipped" || phase === "unimproved") {
        const downloading = phase === "skipped" && load.phase === "loading" && !load.cached;
        return (
            <p className="px-6 text-xs text-muted-foreground" data-testid="resume-model-strip" data-phase={phase}>
                {phase === "skipped" ? "Skipped — keeping the quick match." : "The on-device model couldn't improve this parse — keeping the quick match."}
                {downloading ? " The download finishes in the background so it's cached for next time." : ""}
            </p>
        );
    }

    // "loading" — a download/cache load in flight, then the model reading the résumé.
    const stage = load.phase === "loading" ? "loading-model" : load.phase === "ready" ? "reading" : "preparing";
    return (
        <div className="px-6" data-testid="resume-model-strip" data-phase={phase} data-stage={stage}>
            <div className="space-y-2 rounded-panel border border-border bg-surface-2 p-3">
                {stage === "loading-model" ? (
                    <ModelLoadProgress />
                ) : (
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <InlineSpinner />
                        {stage === "reading" ? "Reading your résumé with the on-device model" : "Checking this device for an on-device model"}
                    </p>
                )}
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
