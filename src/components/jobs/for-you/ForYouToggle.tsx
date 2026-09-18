"use client";

import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

export interface ForYouToggleProps {
    value: JobsHomeView;
    onChange: (view: JobsHomeView) => void;
    className?: string;
}

/**
 * For you ⇄ Search mode control (mock B5): a pill segmented control built
 * directly on `chipVariants` — the same pill primitive as every other chip
 * in the results toolbar (chip.tsx), not a parallel tab-strip treatment.
 * `active` marks the selected segment (filled surface + border), and both
 * segments carry `interactive` since either is always clickable.
 */
export function ForYouToggle({ value, onChange, className }: ForYouToggleProps) {
    return (
        <div
            role="tablist"
            aria-label="Jobs home view"
            data-testid="jobs-home-toggle"
            className={cn("inline-flex min-h-11 gap-1 rounded-pill border border-border bg-muted p-1", className)}
        >
            {(["for-you", "search"] as const).map((tab) => {
                const active = value === tab;
                const label = tab === "for-you" ? "For you" : "Search";
                return (
                    <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(tab)}
                        className={cn(
                            chipVariants({ active, interactive: true }),
                            "min-h-11 justify-center border-transparent px-4 font-semibold",
                            active ? "bg-background" : "bg-transparent text-muted-foreground",
                        )}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
