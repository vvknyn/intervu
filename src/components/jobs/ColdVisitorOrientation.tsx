"use client";

import { useSyncExternalStore, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Sparkle, MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { RANK_SECONDARY_COPY } from "@/lib/jobs/resume-cta-copy";

export const COLD_ORIENTATION_DISMISSED_KEY = "velai.jobs.coldOrientationDismissed";

const listeners = new Set<() => void>();

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readColdOrientationDismissed(): boolean {
    const storage = getStorage();
    if (!storage) return false;
    try {
        return storage.getItem(COLD_ORIENTATION_DISMISSED_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeColdOrientationDismissed(): void {
    const storage = getStorage();
    if (storage) {
        try {
            storage.setItem(COLD_ORIENTATION_DISMISSED_KEY, "1");
        } catch {
            // Private mode or quota
        }
    }
    listeners.forEach((listener) => listener());
}

export function subscribeColdOrientation(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    if (typeof window !== "undefined") {
        window.addEventListener("storage", onStoreChange);
    }
    return () => {
        listeners.delete(onStoreChange);
        if (typeof window !== "undefined") {
            window.removeEventListener("storage", onStoreChange);
        }
    };
}

export interface ColdVisitorOrientationProps {
    onRankByFit: () => void;
    className?: string;
    /** A2 (desktop first screen): collapses the two-card welcome panel to one
     *  line — icon, a single sentence, the Rank-by-fit button, dismiss —
     *  so it can no longer push the first result row down the page. Only the
     *  desktop hero mount (jobs/page.tsx, `hidden lg:block`) passes this; the
     *  mobile mount (`lg:hidden`, after the 3rd result row) keeps the full
     *  card. Same dismissal state either way — `readColdOrientationDismissed`
     *  doesn't know or care which shape rendered. */
    compact?: boolean;
}

export function ColdVisitorOrientation({
    onRankByFit,
    className,
    compact,
}: ColdVisitorOrientationProps) {
    const dismissed = useSyncExternalStore(
        subscribeColdOrientation,
        readColdOrientationDismissed,
        () => true, // server snapshot: stay hidden on SSR to prevent layout shift
    );

    const handleDismiss = useCallback(() => {
        writeColdOrientationDismissed();
    }, []);

    if (dismissed) return null;

    if (compact) {
        return (
            <div
                data-testid="cold-visitor-orientation"
                data-compact="true"
                className={cn(
                    "flex items-center gap-3 rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] px-3 py-2 text-sm text-foreground",
                    className,
                )}
            >
                <Sparkle size={16} weight="fill" className="shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{RANK_SECONDARY_COPY}</span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRankByFit}
                    data-testid="orientation-rank-by-fit"
                    title={RANK_SECONDARY_COPY}
                    className="shrink-0"
                >
                    Rank with my résumé
                </Button>
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label="Dismiss welcome guide"
                    className="ctl-md ctl-button shrink-0 inline-flex ctl-square items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                    <X size={16} weight="bold" aria-hidden />
                </button>
            </div>
        );
    }

    return (
        <div
            data-testid="cold-visitor-orientation"
            className={cn(
                "relative mb-4 rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-4 sm:p-5 transition-all",
                className,
            )}
        >
            <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss welcome guide"
                className="ctl-md ctl-button absolute right-3 top-3 inline-flex ctl-square items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
                <X size={16} weight="bold" aria-hidden />
            </button>

            <div className="max-w-2xl pr-8">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand mb-1">
                    <Sparkle size={16} weight="fill" aria-hidden />
                    <span>Welcome to Velai</span>
                </div>
                <h2 className="text-base sm:text-xl font-semibold text-foreground">
                    Two ways to find your next role
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Search every verified live job directly from employer career pages, or match roles instantly against your résumé.
                </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-panel border border-border bg-muted p-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-panel bg-background text-foreground border border-border">
                        <MagnifyingGlass size={16} weight="bold" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Search every live role</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Filter by title, company, work mode, and verified salary.
                        </p>
                    </div>
                </div>

                <div className="flex items-start justify-between gap-3 rounded-panel border border-border bg-muted p-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-panel bg-background text-foreground border border-border">
                            <Sparkle size={16} weight="bold" aria-hidden />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">Rank by résumé fit</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{RANK_SECONDARY_COPY}</p>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRankByFit}
                        data-testid="orientation-rank-by-fit"
                        className="shrink-0"
                    >
                        Rank with my résumé
                    </Button>
                </div>
            </div>
        </div>
    );
}
