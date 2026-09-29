"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one "this read failed" surface for a list or count. Renders where the
 * surface's empty state would otherwise claim "nothing here" for a request
 * that never answered (see `LoadResult`, lib/load-result.ts).
 */
export function LoadFailedState({
    title = "We can't load this right now.",
    detail,
    onRetry,
    testId = "load-failed",
    className,
}: {
    title?: string;
    detail?: string | null;
    onRetry: () => void;
    testId?: string;
    className?: string;
}) {
    return (
        <div
            role="alert"
            data-testid={testId}
            className={cn("border-l-2 border-verdict-risk py-6 pl-4 text-left", className)}
        >
            <p className="text-xs text-foreground">{title}</p>
            {detail ? <p className="mt-1.5 max-w-md text-xs text-muted-foreground">{detail}</p> : null}
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry} data-testid={`${testId}-retry`}>
                Retry
            </Button>
        </div>
    );
}
