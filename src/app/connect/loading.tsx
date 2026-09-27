import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div
            data-testid="connect-page"
            className="mx-auto max-w-6xl xl:max-w-7xl px-4 sm:px-8 py-10"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading agents page</span>
            <div aria-hidden className="space-y-6">
                <Skeleton className="h-7 w-56" />
                <Skeleton className="h-10 w-full max-w-2xl" />
                <Skeleton className="h-5 w-full max-w-3xl" />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Skeleton className="h-64 w-full rounded-panel border border-border" />
                    <Skeleton className="h-64 w-full rounded-panel border border-border" />
                </div>
            </div>
        </div>
    );
}
