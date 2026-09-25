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
 * Quiet close-the-loop chip after return from the employer posting.
 * Yes → mark applied (caller writes tracker + `job_marked_applied`).
 * Not yet / Skip → dismiss once, no nag. Not a modal wall — fixed chip
 * above the mobile tab bar with safe-area inset.
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
            className="fixed inset-x-3 z-40 mx-auto flex w-auto max-w-sm flex-col gap-3 rounded-panel border border-border bg-card px-4 py-3 shadow-[0_8px_24px_rgb(var(--foreground)/0.06)] bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+0.75rem)] sm:inset-x-auto sm:right-4 sm:left-auto lg:bottom-24"
        >
            <div className="min-w-0">
                <div className="text-xs font-semibold tracking-[-0.01em] text-foreground">Did you apply?</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{decodeText(record.title)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    data-testid="apply-return-mark-applied"
                    onClick={onMarkApplied}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-ctl border border-border bg-brand px-3 text-xs font-semibold text-brand-foreground hover:bg-brand-hover sm:flex-none"
                >
                    Yes
                </button>
                <button
                    type="button"
                    data-testid="apply-return-not-yet"
                    onClick={onDismiss}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-ctl border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted sm:flex-none"
                >
                    Not yet
                </button>
                <button
                    type="button"
                    data-testid="apply-return-skip"
                    onClick={onDismiss}
                    className="inline-flex min-h-11 items-center justify-center px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                    Skip
                </button>
            </div>
        </div>
    );
}
