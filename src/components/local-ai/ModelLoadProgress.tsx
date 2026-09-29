"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { WaitProgressBar } from "@/components/ui/wait-state";
import { getModelLoadState, probeBestDownload, subscribeModelLoad } from "@/lib/local-ai/ladder";
import { describeModelLoad, downloadSizeLine, modelLoadView } from "@/lib/local-ai/model-load";

/** A 1 s clock while a download is live, so the ETA re-derives from real elapsed time. */
function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const id = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(id);
    }, [active]);
    return now;
}

/**
 * The on-device model's load, wherever it was started (résumé import, Settings,
 * Customize, a pre-warm): real bytes / fraction from the engine's own progress
 * callback, a cached-load label when the weights are already on this device.
 * Renders nothing unless a load is in flight.
 */
export function ModelLoadProgress({ className }: { className?: string }) {
    const state = useSyncExternalStore(subscribeModelLoad, getModelLoadState, getModelLoadState);
    const now = useNow(state.phase === "loading");
    const view = modelLoadView(state, now);
    if (!view) return null;

    const title = view.cached ? "Loading cached model" : "Downloading the on-device model";
    const detail = view.cached ? "" : describeModelLoad(view);
    return (
        <div className={className} data-testid="model-load-progress" data-cached={view.cached}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {detail ? (
                    <p className="text-xs tabular-nums text-muted-foreground" data-testid="model-load-progress-text">
                        {detail}
                    </p>
                ) : null}
            </div>
            <WaitProgressBar className="mt-2" fraction={view.fraction} label={title} />
            {view.cached ? null : (
                <p className="mt-2 text-xs text-muted-foreground">One-time download, cached for next time.</p>
            )}
        </div>
    );
}

/** Consent copy: how big the model this device would download is (see `downloadSizeLine`). Touches no network. */
export function ModelDownloadSize() {
    const [line, setLine] = useState("");
    useEffect(() => {
        let live = true;
        void probeBestDownload().then((best) => live && setLine(downloadSizeLine(best)));
        return () => {
            live = false;
        };
    }, []);
    return line ? <span data-testid="model-download-size"> {line}</span> : null;
}
