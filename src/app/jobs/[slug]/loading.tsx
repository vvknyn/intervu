import { JobDetailSkeleton } from "@/components/jobs/JobDetail";

export default function Loading() {
    return (
        <main
            className="mx-auto max-w-[900px] px-4 py-8 sm:px-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading job page</span>
            <div className="skeleton-bar mb-4 h-8 w-2/3 max-w-xl" aria-hidden />
            <JobDetailSkeleton />
        </main>
    );
}
