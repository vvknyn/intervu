import { JobDetailSkeleton } from "@/components/jobs/JobDetail";
import { RouteLoadingFrame } from "@/components/layout/route-loading";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading job page"
            className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6"
        >
            <div className="skeleton-bar mb-4 h-5 w-40" />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
                <JobDetailSkeleton />
                <div className="skeleton-bar hidden h-64 lg:block" />
            </div>
        </RouteLoadingFrame>
    );
}
