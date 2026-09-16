"use client";

import { cn } from "@/lib/utils";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

export interface ForYouToggleProps {
    value: JobsHomeView;
    onChange: (view: JobsHomeView) => void;
    className?: string;
}

export function ForYouToggle({ value, onChange, className }: ForYouToggleProps) {
    return (
        <div
            role="tablist"
            aria-label="Jobs home view"
            data-testid="jobs-home-toggle"
            className={cn(
                "inline-flex border border-border bg-background",
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
                        onClick={() => onChange(tab)}
                        className={cn(
                            "inline-flex min-h-11 items-center px-4 text-xs font-semibold transition-colors motion-reduce:transition-none",
                            active
                                ? "border-b-2 border-foreground text-foreground"
                                : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
