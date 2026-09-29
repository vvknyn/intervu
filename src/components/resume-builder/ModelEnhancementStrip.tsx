"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { WaitProgressBar } from "@/components/ui/wait-state";
import { getModelLoadState, subscribeModelLoad } from "@/lib/local-ai/ladder";
import { describeModelLoad, modelLoadView } from "@/lib/local-ai/model-load";

/**
 * Where the background model upgrade stands. The quick (rules) parse is already
 * on screen; this strip reports the model's real progress — bytes from the
 * download, or a cached-load label — and offers the way out.
 */
export type EnhancementPhase = "loading" | "skipped" | "unimproved" | "improved-pending";

interface Props {
    phase: EnhancementPhase;
    onSkip: () => void;
    onUseImproved: () => void;
}

/** A 1 s clock while the download is live, so the ETA re-derives from real elapsed time. */
function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const id = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(id);
    }, [active]);
    return now;
}

export function ModelEnhancementStrip({ phase, onSkip, onUseImproved }: Props) {
    const state = useSyncExternalStore(subscribeModelLoad, getModelLoadState, getModelLoadState);
    const now = useNow(phase === "loading" && state.phase === "loading");
    const view = modelLoadView(state, now);

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
        const keepsDownloading = phase === "skipped" && view !== null && !view.cached;
        return (
            <p className="px-6 text-xs text-muted-foreground" data-testid="resume-model-strip" data-phase={phase}>
                {phase === "skipped" ? "Skipped — keeping the quick match." : "The on-device model couldn't improve this parse — keeping the quick match."}
                {keepsDownloading ? " The download finishes in the background so it's cached for next time." : ""}
            </p>
        );
    }

    const reading = state.phase === "ready";
    const title = reading
        ? "Model loaded — reading your résumé with it"
        : view === null
          ? "Preparing the on-device model"
          : view.cached
            ? "Loading cached model"
            : "Downloading the on-device model";
    const detail = view ? describeModelLoad(view) : "";

    return (
        <div className="px-6" data-testid="resume-model-strip" data-phase={phase}>
            <div className="space-y-2 rounded-panel border border-border bg-surface-2 p-3">
                <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{title}</p>
                    {detail && !view?.cached ? (
                        <p className="text-xs tabular-nums text-muted-foreground" data-testid="resume-model-progress-text">
                            {detail}
                        </p>
                    ) : null}
                </div>
                <WaitProgressBar fraction={reading ? null : (view?.fraction ?? null)} label={title} />
                <p className="text-xs text-muted-foreground">
                    {view && !view.cached
                        ? "One-time download, cached for next time. Your quick match is ready to edit meanwhile."
                        : "Your quick match is ready to edit meanwhile."}
                </p>
                <Button
                    type="button"
                    variant="link"
                    onClick={onSkip}
                    data-testid="resume-model-skip"
                    className="h-auto min-h-11 justify-start px-0 py-2 text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                    Skip — use quick match
                </Button>
            </div>
        </div>
    );
}
