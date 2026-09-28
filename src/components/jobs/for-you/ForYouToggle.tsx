"use client";

import { cn } from "@/lib/utils";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

export interface ForYouToggleProps {
    value: JobsHomeView;
    onChange: (view: JobsHomeView) => void;
    className?: string;
}

/**
 * Bottom-bar switch: For you (personalized packs) ↔ Search.
 * Active segment matches the resolved home view.
 */
export function ForYouToggle({ value, onChange, className }: ForYouToggleProps) {
    return (
        <div
            role="tablist"
            aria-label="For you or Search"
            data-testid="jobs-home-toggle"
            className={cn(
                "inline-flex min-h-11 items-center gap-0.5 rounded-pill border border-border bg-muted p-0.5",
                className,
            )}
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
                        data-testid={tab === "for-you" ? "jobs-home-for-you" : "jobs-home-search"}
                        onClick={() => onChange(tab)}
                        className={cn(
                            "inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2",
                            active ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
