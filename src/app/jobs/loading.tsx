import {
    posterListInsetClassName,
    RouteLoadingFrame,
    shellMaxWidthClassName,
} from "@/components/layout/route-loading";
import { JobsListSplash } from "@/components/jobs/JobsListSplash";
import { cn } from "@/lib/utils";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading jobs"
            className={cn("mx-auto w-full pb-16", shellMaxWidthClassName, posterListInsetClassName)}
        >
            <JobsListSplash />
        </RouteLoadingFrame>
    );
}
