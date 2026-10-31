import { JobDetailSkeletonBlocks } from "@/components/jobs/JobDetail";
import { WaitBar, WaitState } from "@/components/ui/wait-state";

/**
 * The job page's wait skeleton, the Suspense fallback in `app/jobs/[slug]/page.tsx`.
 * Not a route-level `loading.tsx`: that commits HTTP 200 before `notFound()`
 * can run, so an unknown job id became a soft 404.
 */
export function JobPageSkeleton() {
    return (
        <WaitState
            label="Loading job page"
            className="shell-row page-top pb-6"
            skeleton={
                <>
                    <WaitBar className="mb-4 h-5 w-40" />
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
                        <JobDetailSkeletonBlocks />
                        <WaitBar className="hidden h-64 lg:block" />
                    </div>
                </>
            }
        />
    );
}
