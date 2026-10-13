"use client";

import { useCallback, useMemo, useState } from "react";
import { REASONS_FOR, roleName, type TuningReason } from "@/lib/jobs/for-you/tuning";
import { setNudgeReason } from "@/lib/jobs/for-you/tuning-store";
import { captureEvent } from "@/lib/analytics/events";
import type { PublicJob } from "@/lib/jobs/types";

/** A "more" or "fewer" tap waiting for the visitor to say why (or not). */
export interface PendingTuningReason {
    job: PublicJob;
    signal: "more" | "fewer";
    /** The list the role was tapped in: the reason's label and weights read the roles around it. */
    deck: readonly PublicJob[];
    /** The role is the candidate's own kind of role (tuning.ts `RoleFeatures.own`). */
    own: boolean;
}

export interface TuningReasonPrompt {
    signal: "more" | "fewer";
    jobId: string;
    /** The role as its title names it, for "Fewer like Technical Account Manager — why?". */
    role: string;
    reasons: readonly TuningReason[];
    choose: (reason: TuningReason) => void;
    dismiss: () => void;
}

/**
 * The optional "why?" after a "more / fewer like this" tap (tuning.ts
 * `TuningReason`). The tap has already nudged the list; answering narrows
 * what it steers by (`setNudgeReason`), ignoring it changes nothing. One
 * question at a time: a newer tap replaces it, any other move on the list
 * (`dismiss`) clears it.
 */
export function useTuningReason(surface: "deck" | "today") {
    const [pending, setPending] = useState<PendingTuningReason | null>(null);

    const ask = useCallback((next: PendingTuningReason) => setPending(next), []);
    const dismiss = useCallback(() => setPending(null), []);
    /** Clear the question only if it is about `jobId` (its tap was taken back). */
    const dismissFor = useCallback((jobId: string) => setPending((cur) => (cur?.job.id === jobId ? null : cur)), []);
    const choose = useCallback(
        (reason: TuningReason) => {
            if (!pending) return;
            setNudgeReason(pending.job, reason, pending.deck, { own: pending.own });
            captureEvent("tuning_reason_chosen", { signal: pending.signal, reason, surface, job_id: pending.job.id });
            setPending(null);
        },
        [pending, surface],
    );

    const prompt = useMemo<TuningReasonPrompt | null>(
        () =>
            pending
                ? {
                      signal: pending.signal,
                      jobId: pending.job.id,
                      role: roleName(pending.job.title),
                      reasons: REASONS_FOR[pending.signal],
                      choose,
                      dismiss,
                  }
                : null,
        [pending, choose, dismiss],
    );

    return { prompt, ask, dismiss, dismissFor };
}
