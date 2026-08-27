import { JobDetailSkeleton } from "@/components/jobs/JobDetail";

export default function Loading() {
    return (
        <main
            className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading job page</span>
            <div className="skeleton-bar mb-4 h-4 w-40" aria-hidden />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
                <JobDetailSkeleton />
                <div className="hidden lg:block skeleton-bar h-64" aria-hidden />
            </div>
        </main>
    );
}
