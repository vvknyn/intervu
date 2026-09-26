import { RouteLoadingFrame } from "@/components/layout/route-loading";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading resume page"
            className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10"
        >
            <div className="space-y-6">
                <div className="skeleton-bar h-7 w-32" />
                <div className="skeleton-bar h-5 w-full max-w-md" />
                <div className="rounded-panel border border-border bg-surface p-8 shadow-[var(--shadow-bevel-highlight)]">
                    <div className="mx-auto max-w-sm space-y-3">
                        <div className="skeleton-bar mx-auto h-12 w-12" />
                        <div className="skeleton-bar mx-auto h-4 w-48" />
                        <div className="skeleton-bar mx-auto h-3 w-full" />
                    </div>
                </div>
            </div>
        </RouteLoadingFrame>
    );
}
