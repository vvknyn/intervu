"use client";

import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
    WAIT_PATIENCE_LINE,
    WAIT_STAGE_STARTS,
    waitViewFor,
    type WaitStage,
} from "@/lib/wait-state/ladder";

/**
 * The ONE loading primitive. Every skeleton, spinner and "Loading…" line in
 * src/ goes through this file (tests/unit/wait-state-gate.test.ts fails on a
 * raw one). The timing ladder lives in lib/wait-state/ladder.ts.
 */

/** Geometry block for a skeleton. Compose these into the final layout's shape and pass the result as `skeleton`. */
export function WaitBar({ className, ...props }: React.ComponentProps<"div">) {
    // wait-state-ok: the primitive's own bar
    return <div data-slot="skeleton" className={cn("skeleton-bar", className)} {...props} />;
}

/** Subtle inline spinner — the pending mark inside buttons, rows and inputs. Sizes like an icon (1em) unless told otherwise. */
export function InlineSpinner({ size, className }: { size?: number; className?: string }) {
    // wait-state-ok: the primitive's own spinner
    return <CircleNotch size={size} className={cn("animate-spin", className)} aria-hidden />;
}

/** Determinate when `fraction` is 0..1, indeterminate (pulsing) when null. */
export function WaitProgressBar({
    fraction,
    label,
    className,
}: {
    fraction: number | null;
    label: string;
    className?: string;
}) {
    const percent = fraction === null ? undefined : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    return <progress className={cn("wait-progress", className)} aria-label={label} max={100} value={percent} />;
}

/** Mount = the wait started; unmount = it ended. Advances one stage per timer. */
function useWaitStage(pinned?: WaitStage): WaitStage {
    const [stage, setStage] = useState<WaitStage>("quiet");
    useEffect(() => {
        if (pinned) return;
        const timers = WAIT_STAGE_STARTS.map(([name, startsAt]) => setTimeout(() => setStage(name), startsAt));
        return () => timers.forEach(clearTimeout);
    }, [pinned]);
    return pinned ?? stage;
}

export interface WaitStateProps extends Omit<React.ComponentProps<"div">, "children"> {
    /** What is loading, as a fact ("Loading your tracker"). Always read by assistive tech. */
    label: string;
    /** Only when it matches the final layout's geometry. */
    skeleton?: React.ReactNode;
    /** A true progress line from a real event ("Reading your résumé…"). Shown after 2 s in place of `label`. */
    status?: string;
    /** Freeze the ladder at one stage (design mocks and screenshots). */
    stage?: WaitStage;
    /** Center the wait in a page-sized area — Suspense fallbacks for a whole route. */
    fill?: boolean;
}

export function WaitState({ label, skeleton, status, stage: pinned, fill, className, ...rest }: WaitStateProps) {
    const stage = useWaitStage(pinned);
    const view = waitViewFor(stage, skeleton !== undefined);
    return (
        <div
            role="status"
            aria-busy="true"
            data-wait-stage={stage}
            className={cn(fill && "flex min-h-[40vh] flex-col items-center justify-center gap-2", className)}
            {...rest}
        >
            <span className="sr-only">{label}</span>
            {view.skeleton !== "none" ? (
                <div aria-hidden className={view.skeleton === "hidden" ? "invisible" : undefined}>
                    {skeleton}
                </div>
            ) : null}
            {/* After the skeleton, so its arrival never moves the placeholder. */}
            {view.spinner ? (
                <div className="space-y-1 text-sm text-muted-foreground" aria-hidden>
                    <p className="flex items-center gap-2">
                        <InlineSpinner />
                        {view.text ? <span data-testid="wait-state-line">{status ?? label}</span> : null}
                    </p>
                    {view.patience ? <p data-testid="wait-state-patience">{WAIT_PATIENCE_LINE}</p> : null}
                </div>
            ) : null}
        </div>
    );
}
