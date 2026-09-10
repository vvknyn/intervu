"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    armApplyReturn,
    clearApplyReturn,
    evaluateApplyReturn,
    type ApplyReturnRecord,
} from "@/lib/jobs/apply-return";
import { decodeText } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/** The fields `doMarkApplied` (page.tsx AND PublicJobDetail.tsx — each
 *  mount owns its own, this only names the shape) actually reads off a
 *  job — not a full `PublicJob`, so the hook can hand one back after a
 *  page reload with nothing on hand but the `sessionStorage` record. */
export type ApplyReturnJob = Pick<PublicJob, "id" | "title" | "company" | "apply_url">;

/**
 * Shared "did you apply?" mechanism (jobs board + standalone `/jobs/[slug]`
 * and `/co` panel — see `ApplyReturnPrompt`'s own comment). Owns arming,
 * return detection, and the one-shot decision; the caller owns what
 * "already applied" means for its own surface (`isAlreadyApplied`) and what
 * marking a job applied actually does (`onMarkApplied` — the write + its
 * own toast/telemetry).
 *
 * Return detection listens on BOTH `visibilitychange`→visible and window
 * `focus`: a same-tab switch away fires the former, but an employer link
 * opened in a new WINDOW never changes this tab's visibility — only
 * `focus` fires when the visitor clicks back. `evaluateApplyReturn` is
 * idempotent (see its own comment), so both listeners can safely call the
 * same check without a debounce.
 */
export function useApplyReturnPrompt({
    isAlreadyApplied,
    onMarkApplied,
}: {
    isAlreadyApplied: (jobId: string) => boolean;
    onMarkApplied: (job: ApplyReturnJob) => void;
}) {
    const [pending, setPending] = useState<ApplyReturnRecord | null>(null);
    // Fresh on every check without re-registering the listeners — same
    // "stable listener, live ref" shape the old mount-only handler used.
    const isAlreadyAppliedRef = useRef(isAlreadyApplied);
    isAlreadyAppliedRef.current = isAlreadyApplied;

    useEffect(() => {
        const checkReturn = () => {
            if (document.visibilityState !== "visible") return;
            const record = evaluateApplyReturn(window.sessionStorage, Date.now(), (jobId) =>
                isAlreadyAppliedRef.current(jobId),
            );
            if (record) setPending(record);
        };
        // Also check once on mount, not just on the listeners' first fire: a
        // reload of the armed tab (e.g. iOS Safari discarding a background
        // tab) after the threshold already elapsed never fires
        // visibilitychange/focus, so without this the return goes undetected.
        checkReturn();
        document.addEventListener("visibilitychange", checkReturn);
        window.addEventListener("focus", checkReturn);
        return () => {
            document.removeEventListener("visibilitychange", checkReturn);
            window.removeEventListener("focus", checkReturn);
        };
    }, []);

    const arm = useCallback((job: { id: string; title: string; company: string | null }) => {
        armApplyReturn(window.sessionStorage, { jobId: job.id, title: job.title, company: job.company }, Date.now());
    }, []);

    const markApplied = useCallback(() => {
        if (!pending) return;
        clearApplyReturn(window.sessionStorage);
        setPending(null);
        onMarkApplied({ id: pending.jobId, title: pending.title, company: pending.company, apply_url: "" });
    }, [pending, onMarkApplied]);

    const dismiss = useCallback(() => {
        clearApplyReturn(window.sessionStorage);
        setPending(null);
    }, []);

    return { prompt: pending, arm, markApplied, dismiss };
}

/**
 * The visible box — same fixed placement/testid/role the board's old inline
 * implementation used. "I applied" / "Not yet" (no ×): a return prompt is a
 * yes/no question, not a dismissible notice, so the negative answer gets
 * the same weight as the positive one instead of an anonymous close glyph.
 */
export function ApplyReturnPrompt({
    record,
    onMarkApplied,
    onDismiss,
}: {
    record: ApplyReturnRecord | null;
    onMarkApplied: () => void;
    onDismiss: () => void;
}) {
    if (!record) return null;
    return (
        <div
            data-testid="apply-return-prompt"
            role="status"
            className="fixed bottom-24 right-4 z-[190] flex w-full max-w-sm items-start gap-3 border border-border bg-card px-4 py-3"
        >
            <div className="min-w-0 flex-1">
                <div className="mono-data whitespace-nowrap text-xs text-muted-foreground">Did you apply?</div>
                <div className="mt-0.5 truncate text-meta text-foreground">{decodeText(record.title)}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                    type="button"
                    data-testid="apply-return-mark-applied"
                    onClick={onMarkApplied}
                    className="border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-muted"
                >
                    I applied
                </button>
                <button
                    type="button"
                    data-testid="apply-return-not-yet"
                    onClick={onDismiss}
                    className="text-xs text-muted-foreground hover:text-foreground"
                >
                    Not yet
                </button>
            </div>
        </div>
    );
}
