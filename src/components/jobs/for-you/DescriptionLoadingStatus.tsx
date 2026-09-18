"use client";

import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { DETAIL_FETCH_TIMEOUT_MS } from "@/lib/jobs/detail-fetch";
import {
    DESCRIPTION_STALL_COPY_MS,
    DESCRIPTION_WAIT_COPY_MS,
    descriptionWaitCopy,
    descriptionWaitPhase,
} from "@/lib/jobs/for-you/description-wait-copy";

/**
 * Thin I/O wrapper around `descriptionWaitPhase`/`descriptionWaitCopy`
 * (lib/jobs/for-you/description-wait-copy.ts, unit-tested) — this component
 * owns only the elapsed-ms clock, not the copy decision. Remounts with the
 * rest of `ForYouPack` on every `key={activePack.id}` change (ForYouDeck.tsx),
 * so the clock always starts fresh for whichever card is loading.
 */
export function DescriptionLoadingStatus() {
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
        return <p className="text-sm text-muted-foreground">{copy}</p>;
    }

    return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleNotch size={16} className="animate-spin" aria-hidden />
            {copy}
        </p>
    );
}
