"use client";

import { cn } from "@/lib/utils";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

export interface ForYouToggleProps {
    value: JobsHomeView;
    onChange: (view: JobsHomeView) => void;
    className?: string;
}

/**
 * For you ⇄ Search mode control: an iOS/Material-style pill segmented
 * control (ui-patterns "Module Tabs") — a filled `rounded-pill` track with
 * two `rounded-pill` segments, active = raised `bg-surface` chip, inactive =
 * plain text. No underline, no tab-strip treatment.
 */
export function ForYouToggle({ value, onChange, className }: ForYouToggleProps) {
    return (
        <div
            role="tablist"
            aria-label="Jobs home view"
            data-testid="jobs-home-toggle"
            className={cn("inline-flex min-h-11 items-center gap-0.5 rounded-pill border border-border bg-muted p-0.5", className)}
        >
            {(["for-you", "search"] as const).map((tab) => {
                const active = value === tab;
                const label = tab === "for-you" ? "For you · résumé" : "Search all jobs";
                return (
                    <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(tab)}
                        className={cn(
                            "inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2",
                            active ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
