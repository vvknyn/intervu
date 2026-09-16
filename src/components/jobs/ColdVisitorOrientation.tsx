"use client";

import { useSyncExternalStore, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Sparkle, MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

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
}

export function ColdVisitorOrientation({
    onRankByFit,
    className,
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

    return (
        <div
            data-testid="cold-visitor-orientation"
            className={cn(
                "relative mb-4 rounded-none border border-border bg-card p-4 sm:p-5 transition-all",
                className,
            )}
        >
            <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss welcome guide"
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
                <X size={16} weight="bold" aria-hidden />
            </button>

            <div className="max-w-2xl pr-8">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand mb-1">
                    <Sparkle size={16} weight="fill" aria-hidden />
                    <span>Welcome to Velai</span>
                </div>
                <h2 className="text-base sm:text-lg font-semibold text-foreground">
                    Two ways to find your next role
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Search every verified live job directly from employer career pages, or match roles instantly against your résumé.
                </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-none border border-border bg-muted p-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-background text-foreground border border-border">
                        <MagnifyingGlass size={16} weight="bold" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Search every live role</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Filter by title, company, work mode, and verified salary.
                        </p>
                    </div>
                </div>

                <div className="flex items-start justify-between gap-3 rounded-none border border-border bg-muted p-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-brand text-brand-foreground">
                            <Sparkle size={16} weight="bold" aria-hidden />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">Rank by résumé fit</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                See roles scored by your skills, experience & seniority.
                            </p>
                        </div>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        onClick={onRankByFit}
                        data-testid="orientation-rank-by-fit"
                        className="shrink-0 text-xs font-semibold rounded-none"
                    >
                        Rank by fit
                    </Button>
                </div>
            </div>
        </div>
    );
}
