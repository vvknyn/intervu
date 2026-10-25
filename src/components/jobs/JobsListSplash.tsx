import { WaitBar, WaitState } from "@/components/ui/wait-state";

/** SERP first-page loading rows — shared by /jobs route loading.tsx and page splash. */

function JobCardSkeleton() {
    return (
        <div aria-hidden="true" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 rounded-none bg-surface pt-4">
            <div className="self-start">
                <WaitBar className="h-12 w-12 rounded-panel" />
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-2 border-b border-border pb-4">
                <div className="min-w-0 space-y-2">
                    <WaitBar className="h-4 w-3/4" />
                    <WaitBar className="h-3 w-1/3" />
                </div>
                <WaitBar className="h-5 w-14 self-start" />
                <div className="col-span-full flex gap-2">
                    <WaitBar className="h-3 w-24" />
                    <WaitBar className="h-3 w-16" />
                </div>
            </div>
        </div>
    );
}

/** Placeholder rows alone — the splash's rows and the "load more" tail share them. */
export function JobsListSkeletonRows({ count }: { count: number }) {
    return (
        <>
            {Array.from({ length: count }).map((_, i) => (
                <JobCardSkeleton key={i} />
            ))}
        </>
    );
}

export function JobsListSplash({ rowCount = 5 }: { rowCount?: number }) {
    return (
        <div className="px-[var(--list-inset)]">
            <p className="pt-8 text-sm text-muted-foreground">
                Finding live roles… checking each posting is still active.
            </p>
            <div className="mt-2">
                {/* Rows hold their space but paint only once the wait outlasts the ladder's first step. */}
                <WaitState label="Finding live roles" skeleton={<JobsListSkeletonRows count={rowCount} />} />
            </div>
        </div>
    );
}
