"use client";

import { useEffect, useState } from "react";
import {
    PACKS_LOADING_ROTATE_MS,
    packsLoadingLine,
    type PacksLoadingVariant,
} from "@/lib/jobs/for-you/loading-status-copy";
import { cn } from "@/lib/utils";

export interface RotatingLoadingCopyProps {
    variant: PacksLoadingVariant;
    className?: string;
    /** Optional leading control (spinner). */
    leading?: React.ReactNode;
    /** Override rotate interval (tests). */
    intervalMs?: number;
    /** Stable test id; defaults by variant. */
    "data-testid"?: string;
}

/**
 * Calm rotating status for packs load surfaces. Keeps skeleton/shimmer
 * elsewhere; this only breaks monotony with honest progress language.
 * Honors prefers-reduced-motion: first line only, no timer.
 */
export function RotatingLoadingCopy({
    variant,
    className,
    leading,
    intervalMs = PACKS_LOADING_ROTATE_MS,
    "data-testid": testId,
}: RotatingLoadingCopyProps) {
    const [tick, setTick] = useState(0);
    const [fading, setFading] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) return;

        const id = window.setInterval(() => {
            setFading(true);
            window.setTimeout(() => {
                setTick((t) => t + 1);
                setFading(false);
            }, 220);
        }, intervalMs);
        return () => window.clearInterval(id);
    }, [intervalMs]);

    const copy = packsLoadingLine(variant, tick);
    const resolvedTestId =
        testId ??
        (variant === "hub"
            ? "hub-matching-status"
            : variant === "deck"
              ? "for-you-loading-copy"
              : "for-you-jd-loading-copy");

    return (
        <p
            role="status"
            aria-live="polite"
            data-testid={resolvedTestId}
            data-loading-variant={variant}
            className={cn(
                "flex items-center gap-2 text-sm text-muted-foreground transition-opacity duration-200",
                fading ? "opacity-0" : "opacity-100",
                className,
            )}
        >
            {leading}
            <span>{copy}</span>
        </p>
    );
}
