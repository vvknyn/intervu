import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div
            className="mx-auto w-full max-w-[var(--shell-max)] px-[var(--list-inset)] pb-16 pt-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading jobs</span>
            <div aria-hidden className="space-y-6">
                <Skeleton className="h-10 w-full max-w-md" />
                <Skeleton className="h-6 w-48" />
                <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="rounded-panel border border-border bg-card p-4 shadow-[var(--shadow-bevel-highlight)]"
                        >
                            <Skeleton className="h-5 w-3/4 max-w-sm" />
                            <Skeleton className="mt-2 h-4 w-1/2 max-w-xs" />
                            <Skeleton className="mt-3 h-3 w-full max-w-lg" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
