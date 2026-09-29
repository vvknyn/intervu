"use client";

import { useEffect, useState } from "react";
import {  } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";
import { DETAIL_FETCH_TIMEOUT_MS } from "@/lib/jobs/detail-fetch";
import {
    DESCRIPTION_STALL_COPY_MS,
    DESCRIPTION_WAIT_COPY_MS,
    descriptionWaitCopy,
    descriptionWaitPhase,
} from "@/lib/jobs/for-you/description-wait-copy";
import { RotatingLoadingCopy } from "@/components/jobs/for-you/RotatingLoadingCopy";

/**
 * Thin I/O wrapper around `descriptionWaitPhase`/`descriptionWaitCopy`
 * (lib/jobs/for-you/description-wait-copy.ts, unit-tested) — this component
 * owns only the elapsed-ms clock, not the copy decision. Remounts with the
 * rest of `ForYouPack` on every `key={activePack.id}` change (ForYouDeck.tsx),
 * so the clock always starts fresh for whichever card is loading.
 *
 * While start/wait: rotating quirky-encouraging JD lines (breaks spinner monotony).
 * Stall/failed stay fixed — those are honesty signals, not ambience.
 *
 * `onRetry` is optional: when the copy ladder reaches "failed" (past the
 * fetch deadline), a "Try again" control re-kicks the caller's hydrate
 * instead of leaving "Couldn't load the full posting right now." forever.
 */
export function DescriptionLoadingStatus({ onRetry }: { onRetry?: () => void } = {}) {
    const [elapsedMs, setElapsedMs] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const timers = [DESCRIPTION_WAIT_COPY_MS, DESCRIPTION_STALL_COPY_MS, DETAIL_FETCH_TIMEOUT_MS].map((ms) =>
            setTimeout(() => setElapsedMs(Date.now() - startedAt), ms),
        );
        return () => timers.forEach(clearTimeout);
    }, []);

    const phase = descriptionWaitPhase(elapsedMs, DETAIL_FETCH_TIMEOUT_MS);
    const copy = descriptionWaitCopy(phase);

    if (phase === "failed") {
        return (
            <div className="space-y-2" data-testid="for-you-jd-load-failed">
                <p className="text-sm text-muted-foreground">{copy}</p>
                {onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        data-testid="for-you-jd-retry"
                        className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
                    >
                        Try again
                    </button>
                ) : null}
            </div>
        );
    }

    if (phase === "stall") {
        return (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="for-you-jd-load-stall">
                <InlineSpinner size={16} />
                {copy}
            </p>
        );
    }

    return (
        <RotatingLoadingCopy
            variant="jd"
            leading={<InlineSpinner size={16} className="shrink-0" />}
        />
    );
}
