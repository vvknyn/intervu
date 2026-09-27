import {
    posterListInsetClassName,
    posterListPanelClassName,
    RouteLoadingFrame,
    shellMaxWidthClassName,
} from "@/components/layout/route-loading";
import { cn } from "@/lib/utils";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading jobs"
            className={cn(
                "mx-auto w-full pb-16 pt-6",
                shellMaxWidthClassName,
                posterListInsetClassName,
            )}
        >
            <div className="space-y-6">
                <div className="skeleton-bar h-10 w-full max-w-md" />
                <div className="skeleton-bar h-6 w-48" />
                <div className={posterListPanelClassName}>
                    <div className="divide-y divide-border">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className={cn(posterListInsetClassName, "py-4")}>
                                <div className="skeleton-bar h-5 w-3/4 max-w-sm" />
                                <div className="skeleton-bar mt-2 h-4 w-1/2 max-w-xs" />
                                <div className="skeleton-bar mt-3 h-3 w-full max-w-lg" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </RouteLoadingFrame>
    );
}
