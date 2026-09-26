"use client";

import { cn } from "@/lib/utils";

export interface QuietSearchLinkProps {
    onClick: () => void;
    className?: string;
}

/**
 * Quiet Advanced-search entry for packs-home chrome — not a twin tab of For you.
 * Reaches the same Search SERP as hub footer Advanced search → / `view=search`.
 */
export function QuietSearchLink({ onClick, className }: QuietSearchLinkProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid="jobs-quiet-search-link"
            className={cn(
                "inline-flex min-h-11 items-center text-xs font-semibold text-muted-foreground transition-colors hover:text-brand",
                className,
            )}
        >
            Advanced search →
        </button>
    );
}
