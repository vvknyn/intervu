import { JobDetailSkeleton } from "@/components/jobs/JobDetail";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <main
            className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading job page</span>
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
                <JobDetailSkeleton />
                <Skeleton className="hidden h-64 lg:block" />
            </div>
        </main>
    );
}
