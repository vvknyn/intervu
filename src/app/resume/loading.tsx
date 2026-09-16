import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10" role="status" aria-busy="true">
            <span className="sr-only">Loading resume page</span>
            <div aria-hidden className="space-y-6">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-5 w-full max-w-md" />
                <div className="border border-border bg-card p-8">
                    <div className="mx-auto max-w-sm space-y-3">
                        <Skeleton className="mx-auto h-12 w-12" />
                        <Skeleton className="mx-auto h-4 w-48" />
                        <Skeleton className="mx-auto h-3 w-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}
